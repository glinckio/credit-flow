import { BRAZILIAN_STATES } from '../customer-rules.js';
import { isValidCnpj, isValidCpf, onlyDigits } from '../validators/cpf-cnpj.js';
import { FieldValueType } from './document-fields.js';

/**
 * Formatting-only normalisation for AI-extracted values (ADR-0011, decision 5).
 *
 * These functions never round, never guess and never tolerate a different
 * value: "R$ 3.800,00" and "3800.00" are the same amount; "3.800,01" is not.
 * Anything that does not match a strict format is rejected (`null`).
 */

/** Collapses every run of whitespace into one space and trims. Case and accents are kept. */
export function collapseWhitespace(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Lower case, no accents, punctuation as spaces, single spaces. For text comparison only. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** True when `phrase` occurs in `text` as whole words, after `normalizeText` on both. */
export function containsWords(text: string, phrase: string): boolean {
  const t = normalizeText(text);
  const p = normalizeText(phrase);
  return p.length > 0 && ` ${t} `.includes(` ${p} `);
}

const STREET_ABBREVIATIONS: Readonly<Record<string, string>> = {
  r: 'rua',
  av: 'avenida',
  al: 'alameda',
  tv: 'travessa',
  trav: 'travessa',
  rod: 'rodovia',
  est: 'estrada',
  estr: 'estrada',
  pc: 'praca',
  pca: 'praca',
};

/** Street name for comparison: `normalizeText` plus expansion of the leading abbreviation. */
export function normalizeStreet(value: string): string {
  const [first = '', ...rest] = normalizeText(value).split(' ');
  return [STREET_ABBREVIATIONS[first] ?? first, ...rest].join(' ').trim();
}

const MONEY_BRL = /^(?:R\$\s?)?(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})$/;

/** "R$ 3.800,00" → "3800.00". Brazilian format with exactly two decimals; anything else → null. */
export function parseMoneyBrl(value: string): string | null {
  const m = MONEY_BRL.exec(collapseWhitespace(value));
  if (!m) return null;
  const int = (m[1] ?? '').replace(/\./g, '').replace(/^0+(?=\d)/, '');
  return `${int}.${m[2]}`;
}

function isCalendarDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** "15/03/2026" → "2026-03-15". Invalid calendar dates → null. */
export function parseDateBr(value: string): string | null {
  const m = /^(\d{2})[/.-](\d{2})[/.-](\d{4})$/.exec(collapseWhitespace(value));
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!isCalendarDate(y, mo, d)) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

const MONTH_NAMES: Readonly<Record<string, number>> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

/** "03/2026" or "marco/2026" / "março de 2026" → "2026-03". */
export function parseMonthBr(value: string): string | null {
  const v = collapseWhitespace(value);
  const numeric = /^(\d{2})\/(\d{4})$/.exec(v);
  let month: number | undefined;
  let year: string | undefined;
  if (numeric) {
    month = Number(numeric[1]);
    year = numeric[2];
  } else {
    // normalizeText turns "/" into a space: "marco/2026" → "marco 2026".
    const named = /^([a-z]+) (?:de )?(\d{4})$/.exec(normalizeText(v));
    if (named) {
      month = MONTH_NAMES[named[1] ?? ''];
      year = named[2];
    }
  }
  if (!month || month < 1 || month > 12 || !year) return null;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** CPF (11) or CNPJ (14) digits with a valid check digit; otherwise null. */
export function parseTaxId(value: string): string | null {
  if (!/^[\d.\-/\s]+$/.test(value)) return null;
  const digits = onlyDigits(value);
  if (digits.length === 11 && isValidCpf(digits)) return digits;
  if (digits.length === 14 && isValidCnpj(digits)) return digits;
  return null;
}

/** "01310-100" → "01310100". */
export function parseZip(value: string): string | null {
  const m = /^(\d{5})-?(\d{3})$/.exec(collapseWhitespace(value));
  return m ? `${m[1]}${m[2]}` : null;
}

/** "sp" → "SP" when it is a Brazilian state code. */
export function parseUf(value: string): string | null {
  const uf = collapseWhitespace(value).toUpperCase();
  return (BRAZILIAN_STATES as readonly string[]).includes(uf) ? uf : null;
}

/**
 * Canonical form of an extracted value, used to compare it with the ground
 * truth and (stage B2) with the application data. TEXT is kept as written
 * (collapsed whitespace); text comparisons use `normalizeText`/`normalizeStreet`.
 */
export function normalizeFieldValue(valueType: FieldValueType, raw: string): string | null {
  switch (valueType) {
    case FieldValueType.MONEY:
      return parseMoneyBrl(raw);
    case FieldValueType.DATE:
      return parseDateBr(raw);
    case FieldValueType.MONTH:
      return parseMonthBr(raw);
    case FieldValueType.TAX_ID:
      return parseTaxId(raw);
    case FieldValueType.ZIP:
      return parseZip(raw);
    case FieldValueType.UF:
      return parseUf(raw);
    case FieldValueType.TEXT: {
      const v = collapseWhitespace(raw);
      return v.length > 0 ? v : null;
    }
  }
}
