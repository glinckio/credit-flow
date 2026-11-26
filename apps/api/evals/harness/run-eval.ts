import type {
  DocumentExtractor,
  ExtractionUsage,
} from '../../src/modules/ai-analysis/extraction/document-extractor.js';
import type { RecordedResponse } from '../../src/modules/ai-analysis/extraction/recorded-extractor.js';
import {
  type DocumentAssessment,
  assessExtraction,
} from '../../src/modules/ai-analysis/extraction/assess-extraction.js';
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
      // Stage B3 replaces `m.pageTexts` with the PDF library's text layer.
      const assessment = assessExtraction({
        declaredType: doc.declaredType,
        requestedFields: doc.requestedFields,
        result,
        pageTexts: m.pageTexts,
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
