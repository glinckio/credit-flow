import type { FindingKind, FindingSubject } from './comparison.js';
import type { DocumentExtractionStatus } from './extraction.js';
import type { NarrativeStatus } from './narrative.js';
import type { AiAnalysisRunStatus, AiAnalysisTrigger } from './run.js';

/**
 * Aggregated cost and quality of the AI analyses in a period (stage B6).
 * Counts and amounts only: never extracted values, quotes or comments.
 * Document, finding and narrative figures cover runs whose content has not
 * been purged yet (retention); run, cost and feedback figures cover all runs.
 */
export interface AiMetrics {
  from: string;
  to: string;
  days: number;
  runs: {
    total: number;
    byStatus: Partial<Record<AiAnalysisRunStatus, number>>;
    byTrigger: Partial<Record<AiAnalysisTrigger, number>>;
    /** Content already removed by the retention policy. */
    purged: number;
  };
  cost: {
    /** US$, estimated from token usage and the list price. */
    totalUsd: string;
    avgPerRunUsd: string | null;
    maxRunUsd: string | null;
  };
  tokens: { input: number; output: number };
  latencyMs: { avg: number | null; p95: number | null };
  documents: {
    total: number;
    byStatus: Partial<Record<DocumentExtractionStatus, number>>;
    injectionAlerts: number;
    withoutTextLayer: number;
  };
  findings: { byKind: Partial<Record<FindingKind, number>> };
  narrative: { byStatus: Partial<Record<NarrativeStatus | 'NONE', number>> };
  feedback: {
    total: number;
    correct: number;
    incorrect: number;
    /** incorrect / total; null without feedback. */
    correctionRate: number | null;
    incorrectBySubject: Partial<Record<FindingSubject, number>>;
  };
  /** One line per model + prompt + pipeline combination seen in the period. */
  byVersion: Array<{
    model: string;
    promptVersion: string;
    pipelineVersion: string;
    runs: number;
    failed: number;
    costUsd: string;
  }>;
}

export const AI_METRICS_MAX_DAYS = 365;
