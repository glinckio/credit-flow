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

/** Document outcomes that mean "the provider did not deliver a usable answer". */
export const FAILED_EXTRACTION_STATUSES: readonly DocumentExtractionStatus[] = [
  DocumentExtractionStatus.SCHEMA_INVALID,
  DocumentExtractionStatus.REFUSED,
  DocumentExtractionStatus.TIMEOUT,
  DocumentExtractionStatus.PROVIDER_ERROR,
];

/** Models a run may use. Anything else is refused at configuration time. */
export const ALLOWED_AI_MODELS = ['claude-haiku-5-5'] as const;
export type AllowedAiModel = (typeof ALLOWED_AI_MODELS)[number];

/** Bumped whenever the pipeline logic changes in a way that affects results. */
export const AI_PIPELINE_VERSION = 'pipeline-v1';

/** Enums mirrored by Prisma (see SHARED_ENUMS for the Part A ones). */
export const AI_SHARED_ENUMS = {
  AiAnalysisRunStatus,
  AiAnalysisTrigger,
  DocumentExtractionStatus,
} as const;
