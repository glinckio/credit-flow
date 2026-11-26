import { DocumentType } from '../enums.js';
import { ExtractedFieldKey } from './document-fields.js';

/**
 * Contract of one document extraction (ADR-0011). The model fills it through
 * structured output; the backend ALWAYS re-validates it with
 * `parseExtractionResult` before using anything — a provider-side schema is
 * a convenience, not a trust boundary.
 */

type ValueOf<T> = T[keyof T];

export const EXTRACTION_SCHEMA_VERSION = 'extraction-v1';

export const UNKNOWN_DOCUMENT_TYPE = 'UNKNOWN';
export type DetectedDocumentType = DocumentType | typeof UNKNOWN_DOCUMENT_TYPE;

export const Legibility = {
  OK: 'OK',
  PARTIAL: 'PARTIAL',
  ILLEGIBLE: 'ILLEGIBLE',
} as const;
export type Legibility = ValueOf<typeof Legibility>;

export const FieldStatus = {
  /** Value present; `value`, `page` and `quote` are mandatory. */
  FOUND: 'FOUND',
  /** The document does not contain the field. Never filled by assumption. */
  NOT_FOUND: 'NOT_FOUND',
  /** The document contains contradicting values; no value is chosen. */
  AMBIGUOUS: 'AMBIGUOUS',
  /** The field exists but cannot be read. */
  ILLEGIBLE: 'ILLEGIBLE',
} as const;
export type FieldStatus = ValueOf<typeof FieldStatus>;

export interface FieldExtraction {
  key: ExtractedFieldKey;
  status: FieldStatus;
  /** Exactly as written in the document (verbatim substring of `quote`). */
  value: string | null;
  /** 1-based page number. */
  page: number | null;
  /** Verbatim excerpt of the page that contains the label and the value. */
  quote: string | null;
}

export interface ExtractionResult {
  detectedType: DetectedDocumentType;
  legibility: Legibility;
  /** The model's own signal that the document addresses an AI/system. */
  embeddedInstructionsDetected: boolean;
  fields: FieldExtraction[];
}

/** Outcome of processing one document (persisted per document in stage B1). */
export const DocumentExtractionStatus = {
  /** Extraction parsed; each field carries its own evidence status. */
  OK: 'OK',
  /** The model could not identify a supported document type. */
  UNSUPPORTED: 'UNSUPPORTED',
  /** The model reported the document as illegible. */
  UNREADABLE: 'UNREADABLE',
  /** Provider output was not valid JSON or violated the contract. */
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  /** The provider declined the request (safety refusal). */
  REFUSED: 'REFUSED',
  TIMEOUT: 'TIMEOUT',
  /** Provider unavailable or unexpected provider error. */
  PROVIDER_ERROR: 'PROVIDER_ERROR',
} as const;
export type DocumentExtractionStatus = ValueOf<typeof DocumentExtractionStatus>;

export const MAX_EXTRACTED_TEXT_LENGTH = 500;
export const MAX_EXTRACTED_FIELDS = 30;

const DOCUMENT_TYPES = Object.values(DocumentType) as string[];
const DETECTED_TYPES = [...DOCUMENT_TYPES, UNKNOWN_DOCUMENT_TYPE];
const FIELD_KEYS = Object.values(ExtractedFieldKey) as string[];
const STATUSES = Object.values(FieldStatus) as string[];
const LEGIBILITY = Object.values(Legibility) as string[];

/**
 * JSON Schema handed to the provider's structured output. Restricted to the
 * fields requested for the declared document type. Kept to the basic keywords
 * (type, enum, properties, required, additionalProperties) — the subset to be
 * confirmed against the provider documentation in stage B3.
 */
export function extractionJsonSchema(keys: readonly ExtractedFieldKey[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['detectedType', 'legibility', 'embeddedInstructionsDetected', 'fields'],
    properties: {
      detectedType: { type: 'string', enum: DETECTED_TYPES },
      legibility: { type: 'string', enum: LEGIBILITY },
      embeddedInstructionsDetected: { type: 'boolean' },
      fields: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'status', 'value', 'page', 'quote'],
          properties: {
            key: { type: 'string', enum: [...keys] },
            status: { type: 'string', enum: STATUSES },
            value: { type: ['string', 'null'] },
            page: { type: ['integer', 'null'] },
            quote: { type: ['string', 'null'] },
          },
        },
      },
    },
  };
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function exactKeys(obj: Record<string, unknown>, keys: readonly string[], path: string): string[] {
  const errors: string[] = [];
  for (const k of Object.keys(obj)) if (!keys.includes(k)) errors.push(`${path}.${k}: unexpected`);
  for (const k of keys) if (!(k in obj)) errors.push(`${path}.${k}: required`);
  return errors;
}

function optionalText(v: unknown, path: string, errors: string[]): string | null {
  if (v === null) return null;
  if (typeof v !== 'string' || v.trim() === '' || v.length > MAX_EXTRACTED_TEXT_LENGTH) {
    errors.push(`${path}: must be null or a non-empty string up to ${MAX_EXTRACTED_TEXT_LENGTH}`);
    return null;
  }
  return v;
}

function parseField(raw: unknown, i: number, errors: string[]): FieldExtraction | null {
  const path = `fields[${i}]`;
  if (!isRecord(raw)) {
    errors.push(`${path}: must be an object`);
    return null;
  }
  const keyErrors = exactKeys(raw, ['key', 'status', 'value', 'page', 'quote'], path);
  if (keyErrors.length) {
    errors.push(...keyErrors);
    return null;
  }
  const before = errors.length;
  if (typeof raw.key !== 'string' || !FIELD_KEYS.includes(raw.key))
    errors.push(`${path}.key: unknown`);
  if (typeof raw.status !== 'string' || !STATUSES.includes(raw.status)) {
    errors.push(`${path}.status: unknown`);
  }
  const value = optionalText(raw.value, `${path}.value`, errors);
  const quote = optionalText(raw.quote, `${path}.quote`, errors);
  let page: number | null = null;
  if (raw.page !== null) {
    if (typeof raw.page !== 'number' || !Number.isInteger(raw.page) || raw.page < 1) {
      errors.push(`${path}.page: must be null or an integer >= 1`);
    } else page = raw.page;
  }
  if (errors.length > before) return null;

  const status = raw.status as FieldStatus;
  if (status === FieldStatus.FOUND && (value === null || page === null || quote === null)) {
    errors.push(`${path}: FOUND requires value, page and quote`);
    return null;
  }
  if (status !== FieldStatus.FOUND && value !== null) {
    errors.push(`${path}: only FOUND may carry a value`);
    return null;
  }
  if (status === FieldStatus.NOT_FOUND && (page !== null || quote !== null)) {
    errors.push(`${path}: NOT_FOUND must not carry evidence`);
    return null;
  }
  return { key: raw.key as ExtractedFieldKey, status, value, page, quote };
}

/** Strict validation of untrusted provider output. Unknown or missing properties are errors. */
export function parseExtractionResult(raw: unknown): ParseResult<ExtractionResult> {
  if (!isRecord(raw)) return { ok: false, errors: ['root: must be an object'] };
  const errors = exactKeys(
    raw,
    ['detectedType', 'legibility', 'embeddedInstructionsDetected', 'fields'],
    'root',
  );
  if (errors.length) return { ok: false, errors };

  if (typeof raw.detectedType !== 'string' || !DETECTED_TYPES.includes(raw.detectedType)) {
    errors.push('root.detectedType: unknown');
  }
  if (typeof raw.legibility !== 'string' || !LEGIBILITY.includes(raw.legibility)) {
    errors.push('root.legibility: unknown');
  }
  if (typeof raw.embeddedInstructionsDetected !== 'boolean') {
    errors.push('root.embeddedInstructionsDetected: must be boolean');
  }
  if (!Array.isArray(raw.fields) || raw.fields.length > MAX_EXTRACTED_FIELDS) {
    errors.push(`root.fields: must be an array of up to ${MAX_EXTRACTED_FIELDS}`);
    return { ok: false, errors };
  }

  const fields: FieldExtraction[] = [];
  const seen = new Set<string>();
  raw.fields.forEach((f, i) => {
    const parsed = parseField(f, i, errors);
    if (!parsed) return;
    if (seen.has(parsed.key)) errors.push(`fields[${i}].key: duplicated "${parsed.key}"`);
    seen.add(parsed.key);
    fields.push(parsed);
  });

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      detectedType: raw.detectedType as DetectedDocumentType,
      legibility: raw.legibility as Legibility,
      embeddedInstructionsDetected: raw.embeddedInstructionsDetected as boolean,
      fields,
    },
  };
}
