import {
  type DeclaredData,
  type Finding,
  FindingKind,
  compareWithDeclared,
} from '@creditflow/shared';
import { toAssessedDocument } from '../../src/modules/ai-analysis/extraction/to-assessed.js';
import type { EvalCase, ExpectedFinding } from '../dataset/types.js';
import type { Ratio } from './metrics.js';
import type { DocumentRun } from './run-eval.js';

export interface FindingDeviation {
  caseId: string;
  documentId: string;
  subject: string;
  expected: string;
  produced: string | null;
}

export interface FindingMetrics {
  /** Expected findings (ideal, from the truth) reproduced with the same kind. */
  findingAccuracy: Ratio;
  /** Produced DIVERGENT where the truth says otherwise (alarm without reason). */
  falseDivergences: number;
  /** Truth says DIVERGENT but the report does not (divergence the analyst would not see flagged). */
  missedDivergences: number;
  deviations: FindingDeviation[];
}

export function declaredOf(c: EvalCase): DeclaredData {
  return { ...c.application };
}

/** Findings of one case, from the assessments of its documents. */
export function caseFindings(c: EvalCase, runs: readonly DocumentRun[]): Finding[] {
  const docs = runs
    .filter((r) => r.caseId === c.id)
    .map((r) => toAssessedDocument(r.document.id, r.document.declaredType, r.assessment));
  return compareWithDeclared(declaredOf(c), docs);
}

export function computeFindingMetrics(
  cases: readonly EvalCase[],
  runs: readonly DocumentRun[],
  pick: (c: EvalCase) => readonly ExpectedFinding[] = (c) => c.expectedFindings,
): FindingMetrics {
  const m: FindingMetrics = {
    findingAccuracy: { hit: 0, total: 0 },
    falseDivergences: 0,
    missedDivergences: 0,
    deviations: [],
  };
  for (const c of cases) {
    const produced = caseFindings(c, runs);
    for (const e of pick(c)) {
      const p = produced.find((f) => f.subject === e.subject && f.documentId === e.documentId);
      m.findingAccuracy.total++;
      if (p?.kind === e.kind) m.findingAccuracy.hit++;
      else {
        m.deviations.push({
          caseId: c.id,
          documentId: e.documentId,
          subject: e.subject,
          expected: e.kind,
          produced: p?.kind ?? null,
        });
      }
      if (p?.kind === FindingKind.DIVERGENT && e.kind !== FindingKind.DIVERGENT)
        m.falseDivergences++;
      if (e.kind === FindingKind.DIVERGENT && p?.kind !== FindingKind.DIVERGENT)
        m.missedDivergences++;
    }
  }
  return m;
}
