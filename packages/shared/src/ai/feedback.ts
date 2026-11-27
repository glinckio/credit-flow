import type { Finding, FindingKind } from './comparison.js';

type ValueOf<T> = T[keyof T];

/**
 * The analyst's opinion on one finding of a run (stage B5). It measures how
 * often the analyst corrects the AI (roadmap §15); it never changes the
 * finding, the report, the review or the decision.
 */
export const FindingFeedbackVerdict = {
  /** The finding matches what the analyst sees in the document. */
  CORRECT: 'CORRECT',
  /** The finding is wrong (value misread, wrong kind, missed information...). */
  INCORRECT: 'INCORRECT',
} as const;
export type FindingFeedbackVerdict = ValueOf<typeof FindingFeedbackVerdict>;

export const FINDING_FEEDBACK_COMMENT_MAX = 500;

// ───────────────────────────── run diff ─────────────────────────────

export interface FindingChange {
  findingId: string;
  subject: Finding['subject'];
  documentId: string;
  from: FindingKind;
  to: FindingKind;
}

export interface FindingsDiff {
  /** Findings only in the newer run (e.g. a new document). */
  added: Finding[];
  /** Findings only in the older run (e.g. a removed document). */
  removed: Finding[];
  /** Same finding, different kind. */
  changed: FindingChange[];
  /** Same finding and kind, different values found in the document. */
  valuesChanged: string[];
  unchanged: number;
}

const sameValues = (a: Finding, b: Finding) =>
  JSON.stringify([...a.documentValues].sort((x, y) => x.field.localeCompare(y.field))) ===
  JSON.stringify([...b.documentValues].sort((x, y) => x.field.localeCompare(y.field)));

/**
 * Differences between the findings of two runs of the same application
 * (roadmap §16: earlier reports are kept and comparable). Findings are matched
 * by id (`<subject>:<documentId>`), so a replaced document shows up as one
 * finding removed and one added. Both sides must be computed against the same
 * declared data (the API recomputes them with the current data on read), so
 * only documents, model and pipeline explain a difference.
 */
export function diffFindings(older: readonly Finding[], newer: readonly Finding[]): FindingsDiff {
  const before = new Map(older.map((f) => [f.id, f]));
  const after = new Map(newer.map((f) => [f.id, f]));
  const diff: FindingsDiff = {
    added: [],
    removed: [],
    changed: [],
    valuesChanged: [],
    unchanged: 0,
  };
  for (const f of newer) {
    const prev = before.get(f.id);
    if (!prev) diff.added.push(f);
    else if (prev.kind !== f.kind)
      diff.changed.push({
        findingId: f.id,
        subject: f.subject,
        documentId: f.documentId,
        from: prev.kind,
        to: f.kind,
      });
    else if (!sameValues(prev, f)) diff.valuesChanged.push(f.id);
    else diff.unchanged++;
  }
  for (const f of older) if (!after.has(f.id)) diff.removed.push(f);
  return diff;
}

export function findingsDiffIsEmpty(d: FindingsDiff): boolean {
  return !d.added.length && !d.removed.length && !d.changed.length && !d.valuesChanged.length;
}
