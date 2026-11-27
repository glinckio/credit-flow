import Anthropic from '@anthropic-ai/sdk';
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { ApplicationsModule } from '../applications/applications.module.js';
import { AiAnalysisController } from './ai-analysis.controller.js';
import { AiAnalysisService } from './ai-analysis.service.js';
import {
  DOCUMENT_EXTRACTOR,
  DOCUMENT_TEXT_READER,
  type OptionalDocumentExtractor,
} from './ai-analysis.tokens.js';
import { AiAnalysisWorker } from './ai-analysis.worker.js';
import { AnthropicExtractor } from './extraction/anthropic-extractor.js';
import { PdfJsTextReader } from './text/pdfjs-text-reader.js';

/**
 * AI-assisted analysis (Part B, ADR-0011). Depends on the applications module
 * (visibility, assignee rule, status-change notifications); nothing depends on
 * it, so removing it leaves Part A intact.
 *
 * AI_PROVIDER=disabled → extractor null (nothing queued). AI_PROVIDER=anthropic
 * → Claude through the Messages API. Tests override DOCUMENT_EXTRACTOR with a
 * RecordedExtractor (no network, no cost).
 */
function extractorFactory(config: ConfigService<Env, true>): OptionalDocumentExtractor {
  if (config.get('AI_PROVIDER', { infer: true }) !== 'anthropic') return null;
  const logger = new Logger('AnthropicExtractor');
  const timeoutMs = config.get('AI_REQUEST_TIMEOUT_MS', { infer: true });
  const client = new Anthropic({
    apiKey: config.get('ANTHROPIC_API_KEY', { infer: true }) ?? undefined,
    // At most one retry, done by the SDK for transient errors; the app never retries.
    maxRetries: 1,
    timeout: timeoutMs,
  });
  return new AnthropicExtractor(client, {
    model: config.get('AI_MODEL', { infer: true }),
    effort: config.get('AI_EFFORT', { infer: true }),
    timeoutMs,
    onError: (info) => logger.warn(info, 'Provider call did not produce a usable answer'),
  });
}

@Module({
  imports: [ApplicationsModule],
  controllers: [AiAnalysisController],
  providers: [
    AiAnalysisService,
    AiAnalysisWorker,
    { provide: DOCUMENT_EXTRACTOR, inject: [ConfigService], useFactory: extractorFactory },
    { provide: DOCUMENT_TEXT_READER, useFactory: () => new PdfJsTextReader() },
  ],
  exports: [AiAnalysisWorker],
})
export class AiAnalysisModule {}
