import type {
  DocumentExtractor,
  ExtractionUsage,
} from '../../src/modules/ai-analysis/extraction/document-extractor.js';
import type { RecordedResponse } from '../../src/modules/ai-analysis/extraction/recorded-extractor.js';
import {
  type DocumentAssessment,
  assessExtraction,
} from '../../src/modules/ai-analysis/extraction/assess-extraction.js';
import type { DocumentTextReader } from '../../src/modules/ai-analysis/ai-analysis.tokens.js';
import { PdfJsTextReader } from '../../src/modules/ai-analysis/text/pdfjs-text-reader.js';
import { materialize } from '../dataset/builder.js';
import type { EvalCase, EvalDocument } from '../dataset/types.js';

export interface DocumentRun {
  caseId: string;
  document: EvalDocument;
  assessment: DocumentAssessment;
  model: string;
  usage: ExtractionUsage;
  latencyMs: number;
}

/** Recorded answers of the whole dataset, keyed by document sha256. Fails on hash collisions. */
export function recordingsFor(cases: readonly EvalCase[]): Map<string, RecordedResponse> {
  const map = new Map<string, RecordedResponse>();
  for (const c of cases) {
    for (const doc of c.documents) {
      const { sha256 } = materialize(doc);
      if (map.has(sha256)) throw new Error(`Duplicated document bytes: ${c.id}/${doc.id}`);
      map.set(sha256, doc.recorded);
    }
  }
  return map;
}

/**
 * Runs every document through the extractor and the deterministic assessment —
 * the same path the production pipeline will use. Sequential on purpose:
 * predictable cost and rate usage when a real provider is plugged in (B3).
 */
export async function runEval(
  cases: readonly EvalCase[],
  extractor: DocumentExtractor,
  /** Same reader as production (PDF.js): the evaluation measures the real pipeline. */
  textReader: DocumentTextReader = new PdfJsTextReader(),
): Promise<DocumentRun[]> {
  const runs: DocumentRun[] = [];
  for (const c of cases) {
    for (const doc of c.documents) {
      const m = materialize(doc);
      const result = await extractor.extract({
        documentId: `${c.id}/${doc.id}`,
        declaredType: doc.declaredType,
        mimeType: doc.mimeType,
        bytes: m.bytes,
        sha256: m.sha256,
        requestedFields: doc.requestedFields,
      });
      const assessment = assessExtraction({
        declaredType: doc.declaredType,
        requestedFields: doc.requestedFields,
        result,
        pageTexts: await textReader.readPages(m.bytes, doc.mimeType),
      });
      runs.push({
        caseId: c.id,
        document: doc,
        assessment,
        model: result.model,
        usage: result.usage,
        latencyMs: result.latencyMs,
      });
    }
  }
  return runs;
}
