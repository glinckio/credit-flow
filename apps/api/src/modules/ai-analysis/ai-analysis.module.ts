import { Module } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module.js';
import { AiAnalysisController } from './ai-analysis.controller.js';
import { AiAnalysisService } from './ai-analysis.service.js';
import {
  DOCUMENT_EXTRACTOR,
  DOCUMENT_TEXT_READER,
  NoTextLayerReader,
  type OptionalDocumentExtractor,
} from './ai-analysis.tokens.js';
import { AiAnalysisWorker } from './ai-analysis.worker.js';

/**
 * AI-assisted analysis (Part B, ADR-0011). Depends on the applications module
 * (visibility, assignee rule, status-change notifications); nothing depends on
 * it, so removing it leaves Part A intact.
 *
 * Until stage B3 there is no real provider: AI_PROVIDER can only be
 * "disabled" (extractor = null). Tests override DOCUMENT_EXTRACTOR with a
 * RecordedExtractor and DOCUMENT_TEXT_READER with a reader of the synthetic PDFs.
 */
@Module({
  imports: [ApplicationsModule],
  controllers: [AiAnalysisController],
  providers: [
    AiAnalysisService,
    AiAnalysisWorker,
    { provide: DOCUMENT_EXTRACTOR, useValue: null satisfies OptionalDocumentExtractor },
    { provide: DOCUMENT_TEXT_READER, useClass: NoTextLayerReader },
  ],
  exports: [AiAnalysisWorker],
})
export class AiAnalysisModule {}
