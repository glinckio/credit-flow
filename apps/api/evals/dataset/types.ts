import type {
  CustomerType,
  DetectedDocumentType,
  DocumentExtractionStatus,
  DocumentType,
  ExtractedFieldKey,
  Legibility,
} from '@creditflow/shared';
import type { SyntheticPdfPage } from '../../prisma/seed/synthetic.js';
import type { RecordedResponse } from '../../src/modules/ai-analysis/extraction/recorded-extractor.js';

/** Ground truth for one requested field of one document. */
export type TruthField =
  /** Written once; `raw` exactly as printed, `quote` = the full printed line. */
  | { kind: 'present'; raw: string; page: number; quote: string; textLayer: boolean }
  | { kind: 'absent' }
  /** Written more than once with different values. */
  | { kind: 'ambiguous'; page: number; quote: string };

export interface DocumentTruth {
  detectedType: DetectedDocumentType;
  legibility: Legibility;
  /** The document contains text addressed to an AI/system. */
  injection: boolean;
  fields: Record<ExtractedFieldKey, TruthField>;
}

export interface DocumentExpectation {
  status: DocumentExtractionStatus;
  /**
   * Ideal outcome from the ground truth: canonical value that should become a
   * fact, or null when nothing may be accepted. Used by the quality metrics.
   */
  accepted: Partial<Record<ExtractedFieldKey, string | null>>;
  /**
   * Exact outcome given the RECORDED answer (ideal minus the fields the
   * scripted model mistakes make unacceptable). Asserted by the offline test.
   */
  acceptedWithRecording: Partial<Record<ExtractedFieldKey, string | null>>;
  injectionAlert: boolean;
}

export interface EvalDocument {
  id: string;
  declaredType: DocumentType;
  mimeType: 'application/pdf' | 'image/png';
  pages: SyntheticPdfPage[];
  requestedFields: readonly ExtractedFieldKey[];
  truth: DocumentTruth;
  expected: DocumentExpectation;
  /** What the recorded (fake) model answers for this document. */
  recorded: RecordedResponse;
}

/** Application/customer data the documents are compared with (stage B2). */
export interface SyntheticApplication {
  customerType: CustomerType;
  name: string;
  /** Digits only. */
  taxId: string;
  /** YYYY-MM-DD. */
  birthOrFoundationDate: string;
  address: { street: string; number: string; city: string; state: string; zipCode: string };
  /** Decimal string, e.g. "4100.00". */
  declaredMonthlyIncome: string;
}

/**
 * Expected comparison outcome (rules of ADR-0011, decision 5: tolerance zero;
 * income matches gross OR net; abbreviated name diverges; nothing is concluded
 * from unverified values).
 */
export interface ExpectedFinding {
  subject:
    'holderName' | 'holderTaxId' | 'birthDate' | 'monthlyIncome' | 'address' | 'documentType';
  documentId: string;
  kind: 'CONSISTENT' | 'DIVERGENT' | 'MISSING' | 'AMBIGUOUS' | 'UNVERIFIABLE';
}

export interface EvalCase {
  id: string;
  title: string;
  /** Roadmap §15 scenario(s) or risk the case covers. */
  covers: readonly string[];
  application: SyntheticApplication;
  documents: EvalDocument[];
  /** Ideal findings, from the ground truth (used by the quality metrics). */
  expectedFindings: ExpectedFinding[];
  /**
   * Exact findings given the RECORDED answers, when a scripted model mistake
   * changes them (defaults to expectedFindings). Asserted by the offline test.
   */
  expectedFindingsWithRecording?: ExpectedFinding[];
  /**
   * The case exists only to script a provider failure or an out-of-contract
   * answer (timeout, refusal, invalid JSON...). A real provider answers the
   * same document normally, so these cases run only with the recorded extractor.
   */
  simulatesProviderFailure?: true;
}
