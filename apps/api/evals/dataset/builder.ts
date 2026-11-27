import {
  type DetectedDocumentType,
  DocumentExtractionStatus,
  type DocumentType,
  type ExtractedFieldKey,
  FIELDS_BY_DOCUMENT_TYPE,
  FIELD_SPECS,
  FieldStatus,
  Legibility,
  UNKNOWN_DOCUMENT_TYPE,
  normalizeFieldValue,
} from '@creditflow/shared';
import {
  type SyntheticPdfPage,
  buildSyntheticPdfPages,
  pdfVisibleText,
  sha256Hex,
} from '../../prisma/seed/synthetic.js';
import type { ProviderErrorCode } from '../../src/modules/ai-analysis/extraction/document-extractor.js';
import type { RecordedResponse } from '../../src/modules/ai-analysis/extraction/recorded-extractor.js';
import { buildSyntheticPng, pngVisibleText } from './png.js';
import type { EvalDocument, TruthField } from './types.js';

/**
 * Small DSL to write evaluation documents. A `FieldLine` prints
 * "<label>: <raw>" and, at the same time, records the ground truth (value,
 * page and quote) — so the truth can never drift from the printed content.
 */

export interface FieldLine {
  field: ExtractedFieldKey;
  label: string;
  raw: string;
}
export const F = (field: ExtractedFieldKey, label: string, raw: string): FieldLine => ({
  field,
  label,
  raw,
});

type Line = string | FieldLine;
export type PageSpec =
  | { lines: readonly Line[] }
  /** Scanned page: `visible` is what is printed on paper; there is no text layer. */
  | { scan: true; visible: readonly Line[] };

const lineText = (l: Line) => (typeof l === 'string' ? l : `${l.label}: ${l.raw}`);

/** The model answer shape (untrusted JSON on the wire). */
export interface ModelOutput {
  detectedType: string;
  legibility: string;
  embeddedInstructionsDetected: boolean;
  fields: Array<{
    key: string;
    status: string;
    value: string | null;
    page: number | null;
    quote: string | null;
  }>;
}

export interface DocumentSpec {
  caseId: string;
  id: string;
  declaredType: DocumentType;
  pages: readonly PageSpec[];
  detectedType?: DetectedDocumentType;
  legibility?: Legibility;
  /** Document contains text addressed to an AI. */
  injection?: boolean;
  /** Recorded model answer; receives the faithful answer to derive mistakes from. */
  recorded?: (faithful: ModelOutput) => RecordedResponse;
  /** Fields the scripted mistake in `recorded` must make unacceptable. */
  recordedRejects?: readonly ExtractedFieldKey[];
  /** Overrides the status derived from the truth (provider failures, contract violations). */
  expectStatus?: DocumentExtractionStatus;
  /** "png": a single text page rendered as an image (no text layer). Default "pdf". */
  format?: 'pdf' | 'png';
}

export const ok = (output: unknown): RecordedResponse => ({ kind: 'ok', output });
export const providerError = (code: ProviderErrorCode): RecordedResponse => ({
  kind: 'error',
  code,
});

/** Copy of `out` with one field replaced/patched (to script model mistakes). */
export function withField(
  out: ModelOutput,
  key: ExtractedFieldKey,
  patch: Partial<ModelOutput['fields'][number]>,
): ModelOutput {
  return { ...out, fields: out.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) };
}

export function buildDocument(spec: DocumentSpec): EvalDocument {
  const requestedFields = FIELDS_BY_DOCUMENT_TYPE[spec.declaredType];
  const detectedType = spec.detectedType ?? spec.declaredType;
  const legibility = spec.legibility ?? Legibility.OK;
  const injection = spec.injection ?? false;

  // Header makes every document's bytes (and sha256) unique.
  const header = `DOCUMENTO SINTETICO - SOMENTE PARA AVALIACAO (${spec.caseId}/${spec.id})`;
  const occurrences = new Map<
    ExtractedFieldKey,
    Array<{ raw: string; page: number; quote: string; textLayer: boolean }>
  >();
  const format = spec.format ?? 'pdf';
  if (format === 'png' && (spec.pages.length !== 1 || 'scan' in spec.pages[0]!)) {
    throw new Error(`${spec.caseId}/${spec.id}: a PNG document is exactly one text page`);
  }
  const pages: SyntheticPdfPage[] = spec.pages.map((p, i) => {
    const printed = !('scan' in p);
    // Images never have a text layer, whatever is printed on them.
    const textLayer = printed && format === 'pdf';
    const lines = printed ? p.lines : p.visible;
    for (const l of lines) {
      if (typeof l === 'string') continue;
      const list = occurrences.get(l.field) ?? [];
      const visible = format === 'png' ? pngVisibleText(lineText(l)) : pdfVisibleText(lineText(l));
      list.push({ raw: l.raw, page: i + 1, quote: visible, textLayer });
      occurrences.set(l.field, list);
    }
    if (!printed) return { scan: true, variant: hash(`${spec.caseId}/${spec.id}/${i}`) };
    return { lines: [...(i === 0 ? [header] : []), ...lines.map(lineText)] };
  });
  const fields = Object.fromEntries(
    requestedFields.map((key): [ExtractedFieldKey, TruthField] => {
      const occ = occurrences.get(key) ?? [];
      const first = occ[0];
      if (!first) return [key, { kind: 'absent' }];
      if (occ.some((o) => o.raw !== first.raw)) {
        return [key, { kind: 'ambiguous', page: first.page, quote: first.quote }];
      }
      return [key, { kind: 'present', ...first }];
    }),
  ) as Record<ExtractedFieldKey, TruthField>;

  const faithful: ModelOutput = {
    detectedType,
    legibility,
    embeddedInstructionsDetected: injection,
    fields: requestedFields.map((key) => {
      const t = fields[key];
      if (legibility === Legibility.ILLEGIBLE) {
        return { key, status: FieldStatus.ILLEGIBLE, value: null, page: null, quote: null };
      }
      if (t.kind === 'present') {
        return { key, status: FieldStatus.FOUND, value: t.raw, page: t.page, quote: t.quote };
      }
      if (t.kind === 'ambiguous') {
        return { key, status: FieldStatus.AMBIGUOUS, value: null, page: t.page, quote: t.quote };
      }
      return { key, status: FieldStatus.NOT_FOUND, value: null, page: null, quote: null };
    }),
  };

  const status =
    spec.expectStatus ??
    (detectedType === UNKNOWN_DOCUMENT_TYPE
      ? DocumentExtractionStatus.UNSUPPORTED
      : legibility === Legibility.ILLEGIBLE
        ? DocumentExtractionStatus.UNREADABLE
        : DocumentExtractionStatus.OK);

  const accepted = Object.fromEntries(
    requestedFields.map((key) => {
      const t = fields[key];
      const acceptable =
        status === DocumentExtractionStatus.OK && !injection && t.kind === 'present' && t.textLayer;
      return [key, acceptable ? normalizeFieldValue(FIELD_SPECS[key].valueType, t.raw) : null];
    }),
  );

  return {
    id: spec.id,
    declaredType: spec.declaredType,
    mimeType: format === 'png' ? 'image/png' : 'application/pdf',
    pages,
    requestedFields,
    truth: { detectedType, legibility, injection, fields },
    expected: {
      status,
      accepted,
      acceptedWithRecording: Object.fromEntries(
        Object.entries(accepted).map(([k, v]) => [
          k,
          spec.recordedRejects?.includes(k as ExtractedFieldKey) ? null : v,
        ]),
      ),
      injectionAlert: injection,
    },
    recorded: (spec.recorded ?? ok)(faithful),
  };
}

/** Bytes, hash and text layer of a document, exactly as the pipeline will see them. */
export interface MaterializedDocument {
  bytes: Buffer;
  sha256: string;
  /** Text layer per page as printed ('' for scanned pages); null for images. */
  pageTexts: string[] | null;
}

export function materialize(doc: EvalDocument): MaterializedDocument {
  if (doc.mimeType === 'image/png') {
    const page = doc.pages[0];
    const bytes = buildSyntheticPng(page && 'lines' in page ? page.lines : []);
    return { bytes, sha256: sha256Hex(bytes), pageTexts: null };
  }
  const bytes = buildSyntheticPdfPages(doc.pages);
  return {
    bytes,
    sha256: sha256Hex(bytes),
    pageTexts: doc.pages.map((p) => ('lines' in p ? p.lines.map(pdfVisibleText).join('\n') : '')),
  };
}

/** Small stable string hash (FNV-1a), used only to vary scan bytes deterministically. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 1000;
}
