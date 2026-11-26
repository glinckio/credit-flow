import { ExtractedFieldKey, FIELD_SPECS, FieldValueType } from './document-fields.js';
import type { FieldExtraction } from './extraction.js';
import { collapseWhitespace, normalizeFieldValue, normalizeText } from './normalize.js';

/**
 * Deterministic evidence check (ADR-0011, decision 4). A value extracted by the
 * model becomes a fact only when ALL hold, against the document's own text:
 *
 * 1. the quote exists verbatim (whitespace-collapsed) on the cited page;
 * 2. the value exists verbatim inside the quote;
 * 3. the closest label before the value, in the quote, belongs to this field
 *    (so "Liquido R$ 4.000,00" cannot be accepted as gross income);
 * 4. the value parses in the field's strict format;
 * 5. no other value for the same field (after one of its own labels) exists
 *    anywhere in the document — a self-contradicting document yields no fact.
 *
 * Without a text layer (images, scanned PDFs) nothing can be checked by code:
 * the field is UNVERIFIABLE and left to the analyst.
 */

export const EvidenceStatus = {
  VERIFIED: 'VERIFIED',
  UNVERIFIED: 'UNVERIFIED',
  UNVERIFIABLE: 'UNVERIFIABLE',
} as const;
export type EvidenceStatus = (typeof EvidenceStatus)[keyof typeof EvidenceStatus];

export type EvidenceReason =
  | 'no-text-layer'
  | 'page-out-of-range'
  | 'quote-not-found'
  | 'value-not-in-quote'
  | 'label-mismatch'
  | 'value-unparseable'
  | 'conflicting-values';

export type EvidenceCheck =
  | { status: typeof EvidenceStatus.VERIFIED; normalizedValue: string }
  | { status: typeof EvidenceStatus.UNVERIFIED; reason: EvidenceReason }
  | { status: typeof EvidenceStatus.UNVERIFIABLE; reason: 'no-text-layer' };

/** Every label of the catalogue, longest first (so "razao social" wins over "social"). */
const ALL_LABELS = [...new Set(Object.values(FIELD_SPECS).flatMap((s) => s.labels))]
  .map(normalizeText)
  .sort((a, b) => b.length - a.length);

/** Label whose last whole-word occurrence ends closest to the end of `prefix`. */
function closestLabelBefore(prefix: string): string | null {
  const text = ` ${normalizeText(prefix)} `;
  let best: { label: string; end: number } | null = null;
  for (const label of ALL_LABELS) {
    const at = text.lastIndexOf(` ${label} `);
    if (at < 0) continue;
    const end = at + label.length + 1;
    if (!best || end > best.end) best = { label, end };
  }
  return best?.label ?? null;
}

/**
 * @param pageTexts text layer per page (index 0 = page 1); `null` when the
 *   document has no text layer at all (image).
 */
export function verifyEvidence(
  field: Pick<FieldExtraction, 'key' | 'value' | 'page' | 'quote'>,
  pageTexts: readonly string[] | null,
): EvidenceCheck {
  const unverifiable = { status: EvidenceStatus.UNVERIFIABLE, reason: 'no-text-layer' } as const;
  if (!pageTexts || pageTexts.every((t) => t.trim() === '')) return unverifiable;

  const { value, page, quote } = field;
  const fail = (reason: EvidenceReason): EvidenceCheck => ({
    status: EvidenceStatus.UNVERIFIED,
    reason,
  });
  if (value === null || quote === null || page === null) return fail('quote-not-found');
  if (page < 1 || page > pageTexts.length) return fail('page-out-of-range');

  const pageText = collapseWhitespace(pageTexts[page - 1] ?? '');
  if (pageText === '') return unverifiable;

  const q = collapseWhitespace(quote);
  const v = collapseWhitespace(value);
  if (!pageText.includes(q)) return fail('quote-not-found');
  const valueAt = q.indexOf(v);
  if (v === '' || valueAt < 0) return fail('value-not-in-quote');

  const spec = FIELD_SPECS[field.key];
  const label = closestLabelBefore(q.slice(0, valueAt));
  if (!label || !spec.labels.map(normalizeText).includes(label)) return fail('label-mismatch');

  const normalizedValue = normalizeFieldValue(spec.valueType, v);
  if (normalizedValue === null) return fail('value-unparseable');
  const others = findLabelledValues(field.key, pageTexts).filter(
    (other) => other !== normalizedValue && comparable(spec.valueType, other, normalizedValue),
  );
  if (others.length > 0) return fail('conflicting-values');
  return { status: EvidenceStatus.VERIFIED, normalizedValue };
}

// ───────────────────────────── conflict scan ─────────────────────────────

/** Value shapes searched after a label. TEXT and UF are not scanned (too fuzzy). */
const VALUE_PATTERNS: Partial<Record<FieldValueType, RegExp>> = {
  [FieldValueType.MONEY]: /(?:R\$\s?)?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}/,
  [FieldValueType.DATE]: /\d{2}[/.-]\d{2}[/.-]\d{4}/,
  [FieldValueType.MONTH]: /(?<![\d/])\d{2}\/\d{4}(?![\d/])/,
  [FieldValueType.TAX_ID]: /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{3}\.?\d{3}\.?\d{3}-?\d{2}/,
  [FieldValueType.ZIP]: /(?<!\d)\d{5}-?\d{3}(?!\d)/,
};

/** CPF and CNPJ are different things: only same-length identifiers conflict. */
function comparable(type: FieldValueType, a: string, b: string): boolean {
  return type !== FieldValueType.TAX_ID || a.length === b.length;
}

/**
 * Labels that identify ONLY this field among fields of the same value type
 * ("periodo" names both the start and the end of a statement period, so it
 * cannot be used to spot a conflict).
 */
function uniqueLabels(key: ExtractedFieldKey): string[] {
  const spec = FIELD_SPECS[key];
  const shared = new Set(
    Object.values(FIELD_SPECS)
      .filter((s) => s.key !== key && s.valueType === spec.valueType)
      .flatMap((s) => s.labels),
  );
  return spec.labels.filter((l) => !shared.has(l));
}

/** Lower case without accents, keeping a map back to the original indices. */
function fold(text: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = (text[i] ?? '')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
    for (const c of f) {
      folded += c;
      map.push(i);
    }
  }
  return { folded, map };
}

const isWordChar = (c: string | undefined) => c !== undefined && /[a-z0-9]/.test(c);

/**
 * Every distinct value (canonical form) written right after one of the
 * field's unique labels, on the same line, anywhere in the document. Two or
 * more distinct values mean the document contradicts itself — or contains
 * injected text that imitates a field — and no value can be accepted.
 */
export function findLabelledValues(key: ExtractedFieldKey, pageTexts: readonly string[]): string[] {
  const spec = FIELD_SPECS[key];
  const pattern = VALUE_PATTERNS[spec.valueType];
  const labels = uniqueLabels(key);
  if (!pattern || labels.length === 0) return [];

  const values = new Set<string>();
  for (const text of pageTexts) {
    const { folded, map } = fold(text);
    for (const label of labels) {
      let from = 0;
      for (;;) {
        const at = folded.indexOf(label, from);
        if (at < 0) break;
        from = at + 1;
        const end = at + label.length;
        if (isWordChar(folded[at - 1]) || isWordChar(folded[end])) continue;
        const origEnd = (map[end - 1] ?? 0) + 1;
        const line = text.slice(origEnd, origEnd + 80).split('\n')[0] ?? '';
        const m = pattern.exec(line);
        const value = m ? normalizeFieldValue(spec.valueType, m[0]) : null;
        if (value !== null) values.add(value);
      }
    }
  }
  return [...values];
}
