import Anthropic from '@anthropic-ai/sdk';
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { ApplicationsModule } from '../applications/applications.module.js';
import { AiAnalysisController } from './ai-analysis.controller.js';
import { AiAnalysisService } from './ai-analysis.service.js';
import { AiMetricsService } from './ai-metrics.service.js';
import {
  DOCUMENT_EXTRACTOR,
  DOCUMENT_TEXT_READER,
  NARRATIVE_WRITER,
  type OptionalDocumentExtractor,
  type OptionalNarrativeWriter,
} from './ai-analysis.tokens.js';
import { AiAnalysisWorker } from './ai-analysis.worker.js';
import { resolveStorageRoot } from '../../infra/storage/storage.module.js';
import { AnthropicExtractor } from './extraction/anthropic-extractor.js';
import { DirectoryRecordedExtractor } from './extraction/directory-recorded-extractor.js';
import { AnthropicNarrativeWriter } from './narrative/anthropic-narrative-writer.js';
import { DeterministicNarrativeWriter } from './narrative/narrative-writer.js';
import { PdfJsTextReader } from './text/pdfjs-text-reader.js';

/**
 * AI-assisted analysis (Part B, ADR-0011). Depends on the applications module
 * (visibility, assignee rule, status-change notifications); nothing depends on
 * it, so removing it leaves Part A intact.
 *
 * AI_PROVIDER=disabled → extractor null (nothing queued). AI_PROVIDER=anthropic
 * → Claude through the Messages API. AI_PROVIDER=recorded (E2E, never in
 * production) → answers recorded in AI_RECORDINGS_DIR. Tests override DOCUMENT_EXTRACTOR with a
 * RecordedExtractor and NARRATIVE_WRITER with a DeterministicNarrativeWriter
 * (no network, no cost).
 */
const ANTHROPIC_CLIENT = Symbol('ANTHROPIC_CLIENT');

function clientFactory(config: ConfigService<Env, true>): Anthropic | null {
  if (config.get('AI_PROVIDER', { infer: true }) !== 'anthropic') return null;
  return new Anthropic({
    apiKey: config.get('ANTHROPIC_API_KEY', { infer: true }) ?? undefined,
    // At most one retry, done by the SDK for transient errors; the app never retries.
    maxRetries: 1,
    timeout: config.get('AI_REQUEST_TIMEOUT_MS', { infer: true }),
  });
}

function extractorFactory(
  config: ConfigService<Env, true>,
  client: Anthropic | null,
): OptionalDocumentExtractor {
  if (config.get('AI_PROVIDER', { infer: true }) === 'recorded') {
    return new DirectoryRecordedExtractor(
      resolveStorageRoot(config.get('AI_RECORDINGS_DIR', { infer: true })!),
    );
  }
  if (!client) return null;
  const logger = new Logger('AnthropicExtractor');
  const timeoutMs = config.get('AI_REQUEST_TIMEOUT_MS', { infer: true });
  return new AnthropicExtractor(client, {
    model: config.get('AI_MODEL', { infer: true }),
    effort: config.get('AI_EFFORT', { infer: true }),
    timeoutMs,
    onError: (info) => logger.warn(info, 'Provider call did not produce a usable answer'),
  });
}

/** Same model, effort and client as the extraction; receives only verified findings. */
function narrativeFactory(
  config: ConfigService<Env, true>,
  client: Anthropic | null,
): OptionalNarrativeWriter {
  if (config.get('AI_PROVIDER', { infer: true }) === 'recorded') {
    return new DeterministicNarrativeWriter();
  }
  if (!client) return null;
  const logger = new Logger('AnthropicNarrativeWriter');
  return new AnthropicNarrativeWriter(client, {
    model: config.get('AI_MODEL', { infer: true }),
    effort: config.get('AI_EFFORT', { infer: true }),
    timeoutMs: config.get('AI_REQUEST_TIMEOUT_MS', { infer: true }),
    onError: (info) => logger.warn(info, 'Narrative call did not produce a usable answer'),
  });
}

@Module({
  imports: [ApplicationsModule],
  controllers: [AiAnalysisController],
  providers: [
    AiAnalysisService,
    AiMetricsService,
    AiAnalysisWorker,
    { provide: ANTHROPIC_CLIENT, inject: [ConfigService], useFactory: clientFactory },
    {
      provide: DOCUMENT_EXTRACTOR,
      inject: [ConfigService, ANTHROPIC_CLIENT],
      useFactory: extractorFactory,
    },
    {
      provide: NARRATIVE_WRITER,
      inject: [ConfigService, ANTHROPIC_CLIENT],
      useFactory: narrativeFactory,
    },
    { provide: DOCUMENT_TEXT_READER, useFactory: () => new PdfJsTextReader() },
  ],
  exports: [AiAnalysisWorker],
})
export class AiAnalysisModule {}
