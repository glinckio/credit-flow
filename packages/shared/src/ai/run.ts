import { DocumentExtractionStatus } from './extraction.js';

/**
 * Lifecycle of one AI analysis run (ADR-0011). Values mirror the Prisma enums
 * (guarded by an integration test through `AI_SHARED_ENUMS`).
 */

type ValueOf<T> = T[keyof T];

export const AiAnalysisRunStatus = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  /** Every document produced a result (OK, UNSUPPORTED or UNREADABLE). */
  SUCCEEDED: 'SUCCEEDED',
  /** Some documents failed (provider error, timeout, refusal, invalid output). */
  PARTIAL: 'PARTIAL',
  /** No document could be processed, or the run itself failed. */
  FAILED: 'FAILED',
} as const;
export type AiAnalysisRunStatus = ValueOf<typeof AiAnalysisRunStatus>;

export const ACTIVE_RUN_STATUSES: readonly AiAnalysisRunStatus[] = [
  AiAnalysisRunStatus.QUEUED,
  AiAnalysisRunStatus.RUNNING,
];

export const AiAnalysisTrigger = {
  /** First time the application entered UNDER_REVIEW (automatic, once per application). */
  AUTO_FIRST_REVIEW: 'AUTO_FIRST_REVIEW',
  /** "Reprocessar" clicked by the assigned analyst. */
  MANUAL: 'MANUAL',
} as const;
export type AiAnalysisTrigger = ValueOf<typeof AiAnalysisTrigger>;

/** Why a run FAILED as a whole (per-document failures live on the extraction). */
export const AiRunErrorCode = {
  /** The worker stopped (crash/restart) while the run was in progress; never retried automatically. */
  INTERRUPTED: 'interrupted',
  /** A stored file no longer matches its recorded sha256. */
  DOCUMENT_INTEGRITY: 'document-integrity',
  /** Documents or application changed between request and processing. */
  INPUT_CHANGED: 'input-changed',
  /** Every document failed at the provider. */
  ALL_DOCUMENTS_FAILED: 'all-documents-failed',
  /** The application has more documents than a run may process. */
  TOO_MANY_DOCUMENTS: 'too-many-documents',
  INTERNAL_ERROR: 'internal-error',
} as const;
export type AiRunErrorCode = ValueOf<typeof AiRunErrorCode>;

/** Document outcomes meaning "not analysed" (provider failure or a cost guard). */
export const FAILED_EXTRACTION_STATUSES: readonly DocumentExtractionStatus[] = [
  DocumentExtractionStatus.SCHEMA_INVALID,
  DocumentExtractionStatus.REFUSED,
  DocumentExtractionStatus.TIMEOUT,
  DocumentExtractionStatus.PROVIDER_ERROR,
  DocumentExtractionStatus.TOO_LARGE,
  DocumentExtractionStatus.SKIPPED_BUDGET,
];

/**
 * US$ per million tokens (first-party API list price, checked 2026-11-26).
 * Claude Haiku 5.5: $0.10 / $0.50 for prompts up to 100K tokens; $0.50 / $2.50 above.
 * Update together with ALLOWED_AI_MODELS; the eval reports cost with this table.
 */
export const AI_MODEL_PRICING: Readonly<
  Record<AllowedAiModel, { upTo100k: [number, number]; above100k: [number, number] }>
> = {
  'claude-haiku-5-5': { upTo100k: [0.1, 0.5], above100k: [0.5, 2.5] },
};

/** Estimated cost of ONE request, in US$ (rounded to 6 decimals). */
export function requestCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = AI_MODEL_PRICING[model as AllowedAiModel];
  if (!price) return 0;
  const [inp, out] = inputTokens > 100_000 ? price.above100k : price.upTo100k;
  return Math.round(((inputTokens * inp + outputTokens * out) / 1_000_000) * 1e6) / 1e6;
}

/** Models a run may use. Anything else is refused at configuration time. */
export const ALLOWED_AI_MODELS = ['claude-haiku-5-5'] as const;
export type AllowedAiModel = (typeof ALLOWED_AI_MODELS)[number];

/** Bumped whenever the pipeline logic changes in a way that affects results. */
export const AI_PIPELINE_VERSION = 'pipeline-v2';

/** Enums mirrored by Prisma (see SHARED_ENUMS for the Part A ones). */
export const AI_SHARED_ENUMS = {
  AiAnalysisRunStatus,
  AiAnalysisTrigger,
  DocumentExtractionStatus,
} as const;
