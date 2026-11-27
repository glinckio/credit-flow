import {
  type DetectedDocumentType,
  type DocumentType,
  DocumentExtractionStatus,
  type EvidenceCheck,
  EvidenceStatus,
  type ExtractedFieldKey,
  FieldStatus,
  type InjectionScan,
  Legibility,
  UNKNOWN_DOCUMENT_TYPE,
  parseExtractionResult,
  scanForEmbeddedInstructions,
  verifyEvidence,
} from '@creditflow/shared';
import type { ExtractorResult, ProviderErrorCode } from './document-extractor.js';

/**
 * Turns one provider answer into a document assessment (ADR-0011). Pure and
 * deterministic: the same inputs always give the same assessment. Only values
 * whose evidence was VERIFIED become `acceptedValue` (a fact); everything else
 * stays visible to the analyst with the reason it was not accepted.
 */

export interface FieldAssessment {
  key: ExtractedFieldKey;
  /** What the model said about the field. */
  modelStatus: FieldStatus;
  /** Raw value/evidence as returned by the model (shown to the analyst). */
  modelValue: string | null;
  page: number | null;
  quote: string | null;
  /** Evidence check for FOUND fields; null otherwise. */
  evidence: EvidenceCheck | null;
  /** Canonical value, only when the evidence is VERIFIED and the document is not flagged. */
  acceptedValue: string | null;
  /** Why a VERIFIED value was still not accepted. */
  rejectedBy: 'document-flagged' | null;
}

export interface InjectionAssessment {
  /** Model's own `embeddedInstructionsDetected`; null when there is no parsed output. */
  modelFlag: boolean | null;
  /** Deterministic scan over the document text layer. */
  scan: InjectionScan;
  /** Either signal → alert the analyst. */
  alert: boolean;
}

export interface DocumentAssessment {
  status: DocumentExtractionStatus;
  detectedType: DetectedDocumentType | null;
  /** null when no type could be established. */
  typeMatchesDeclared: boolean | null;
  hasTextLayer: boolean;
  injection: InjectionAssessment;
  fields: FieldAssessment[];
  /** Contract violations (SCHEMA_INVALID only). Never contains document content. */
  schemaErrors: string[];
}

export interface AssessInput {
  declaredType: DocumentType;
  requestedFields: readonly ExtractedFieldKey[];
  result: ExtractorResult;
  /** Text layer per page; null for images (no text layer). */
  pageTexts: readonly string[] | null;
}

const ERROR_STATUS: Record<ProviderErrorCode, DocumentExtractionStatus> = {
  TIMEOUT: DocumentExtractionStatus.TIMEOUT,
  UNAVAILABLE: DocumentExtractionStatus.PROVIDER_ERROR,
  REFUSED: DocumentExtractionStatus.REFUSED,
  INVALID_RESPONSE: DocumentExtractionStatus.SCHEMA_INVALID,
};

export function assessExtraction(input: AssessInput): DocumentAssessment {
  const hasTextLayer = !!input.pageTexts?.some((t) => t.trim() !== '');
  const scan = hasTextLayer
    ? scanForEmbeddedInstructions(input.pageTexts ?? [])
    : { detected: false, patterns: [] };

  const bare = (
    status: DocumentExtractionStatus,
    schemaErrors: string[] = [],
    modelFlag: boolean | null = null,
    detectedType: DetectedDocumentType | null = null,
  ): DocumentAssessment => ({
    status,
    detectedType,
    typeMatchesDeclared:
      detectedType === null || detectedType === UNKNOWN_DOCUMENT_TYPE
        ? null
        : detectedType === input.declaredType,
    hasTextLayer,
    injection: { modelFlag, scan, alert: scan.detected || modelFlag === true },
    fields: [],
    schemaErrors,
  });

  if (input.result.kind === 'error') return bare(ERROR_STATUS[input.result.code]);

  const parsed = parseExtractionResult(input.result.output);
  if (!parsed.ok) return bare(DocumentExtractionStatus.SCHEMA_INVALID, parsed.errors);
  const out = parsed.value;

  // Strict: every requested field must be answered, and nothing else.
  const answered = new Set(out.fields.map((f) => f.key));
  const missing = input.requestedFields.filter((k) => !answered.has(k));
  const extra = out.fields.filter((f) => !input.requestedFields.includes(f.key)).map((f) => f.key);
  if (missing.length || extra.length) {
    return bare(DocumentExtractionStatus.SCHEMA_INVALID, [
      ...missing.map((k) => `fields: missing "${k}"`),
      ...extra.map((k) => `fields: not requested "${k}"`),
    ]);
  }

  const flag = out.embeddedInstructionsDetected;
  // Illegible first: a document nobody can read has no knowable type, so it
  // must never be reported as "a different type" (found by the first real run).
  if (out.legibility === Legibility.ILLEGIBLE) {
    return bare(DocumentExtractionStatus.UNREADABLE, [], flag, out.detectedType);
  }
  if (out.detectedType === UNKNOWN_DOCUMENT_TYPE) {
    return bare(DocumentExtractionStatus.UNSUPPORTED, [], flag, out.detectedType);
  }

  // A document whose text addresses an AI is evidence of tampering: nothing in
  // it becomes a fact, whatever the model answered (the analyst still sees it).
  const flagged = scan.detected;
  const fields = input.requestedFields.map((key): FieldAssessment => {
    const f = out.fields.find((x) => x.key === key)!;
    const evidence = f.status === FieldStatus.FOUND ? verifyEvidence(f, input.pageTexts) : null;
    const verified = evidence?.status === EvidenceStatus.VERIFIED ? evidence.normalizedValue : null;
    return {
      key,
      modelStatus: f.status,
      modelValue: f.value,
      page: f.page,
      quote: f.quote,
      evidence,
      acceptedValue: flagged ? null : verified,
      rejectedBy: flagged && verified !== null ? 'document-flagged' : null,
    };
  });

  return { ...bare(DocumentExtractionStatus.OK, [], flag, out.detectedType), fields };
}

/** Assessment of a document that was NOT sent to the model (cost guards). */
export function skippedAssessment(
  status:
    typeof DocumentExtractionStatus.TOO_LARGE | typeof DocumentExtractionStatus.SKIPPED_BUDGET,
  pageTexts: readonly string[] | null,
): DocumentAssessment {
  const hasTextLayer = !!pageTexts?.some((t) => t.trim() !== '');
  const scan = hasTextLayer
    ? scanForEmbeddedInstructions(pageTexts ?? [])
    : { detected: false, patterns: [] };
  return {
    status,
    detectedType: null,
    typeMatchesDeclared: null,
    hasTextLayer,
    injection: { modelFlag: null, scan, alert: scan.detected },
    fields: [],
    schemaErrors: [],
  };
}
