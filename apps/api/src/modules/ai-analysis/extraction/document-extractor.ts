import type { DocumentType, ExtractedFieldKey } from '@creditflow/shared';

/**
 * Port for the model-backed document extraction (ADR-0011). Implementations:
 * `RecordedExtractor` (tests, CI and offline evaluation) and, from stage B3,
 * the Anthropic adapter. The port never throws for provider problems: every
 * failure is a typed result, so the pipeline can always fall back safely.
 */

export interface ExtractionRequest {
  documentId: string;
  declaredType: DocumentType;
  /** Content-detected MIME type (application/pdf, image/png, image/jpeg). */
  mimeType: string;
  bytes: Buffer;
  /** Integrity: must match the stored document's hash. */
  sha256: string;
  requestedFields: readonly ExtractedFieldKey[];
}

export interface ExtractionUsage {
  inputTokens: number;
  outputTokens: number;
}

export type ProviderErrorCode =
  /** Call exceeded the configured timeout. */
  | 'TIMEOUT'
  /** Provider unreachable, overloaded or returned a server error. */
  | 'UNAVAILABLE'
  /** Provider declined to answer (safety refusal). */
  | 'REFUSED'
  /** Provider answered, but not with parseable JSON (e.g. truncated output). */
  | 'INVALID_RESPONSE';

export type ExtractorResult =
  | {
      kind: 'ok';
      /** Untrusted JSON value; validated by `parseExtractionResult`. */
      output: unknown;
      model: string;
      usage: ExtractionUsage;
      latencyMs: number;
    }
  | {
      kind: 'error';
      code: ProviderErrorCode;
      model: string;
      usage: ExtractionUsage;
      latencyMs: number;
    };

export interface DocumentExtractor {
  /** Model identifier recorded with every run. */
  readonly model: string;
  /** Version of the prompt/adapter, recorded with every run ("none" when no prompt is used). */
  readonly promptVersion: string;
  extract(request: ExtractionRequest): Promise<ExtractorResult>;
}
