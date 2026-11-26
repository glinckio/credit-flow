import { CustomerType } from './enums.js';
import { isValidCnpj, isValidCpf, onlyDigits } from './validators/cpf-cnpj.js';

/** Brazilian federative units (UF). */
export const BRAZILIAN_STATES = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;
export type BrazilianState = (typeof BRAZILIAN_STATES)[number];

/** Minimum age for individual customers (plan, decision 6.9). */
export const MIN_CUSTOMER_AGE = 18;

/** Validates a CPF for individuals or a CNPJ for companies. */
export function isValidDocumentForType(type: CustomerType, document: string): boolean {
  return type === CustomerType.INDIVIDUAL ? isValidCpf(document) : isValidCnpj(document);
}

/** Parses a strict `YYYY-MM-DD` calendar date (UTC). Returns null for anything else. */
export function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

/** Full years between `birth` and `today` (UTC calendar dates). */
export function ageInYears(birth: Date, today: Date = new Date()): number {
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < birth.getUTCMonth() ||
    (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export type BirthOrFoundationDateError = 'invalid' | 'future' | 'underage';

/**
 * Birth date (individual, must be an adult) or foundation date (company).
 * Returns null when valid.
 */
export function checkBirthOrFoundationDate(
  type: CustomerType,
  value: string,
  today: Date = new Date(),
): BirthOrFoundationDateError | null {
  const date = parseIsoDate(value);
  if (!date || date.getUTCFullYear() < 1900) return 'invalid';
  if (date.getTime() > today.getTime()) return 'future';
  if (type === CustomerType.INDIVIDUAL && ageInYears(date, today) < MIN_CUSTOMER_AGE) {
    return 'underage';
  }
  return null;
}

/** Phone with 10–13 digits (area code + number, optionally country code 55). */
export function isValidPhone(value: string): boolean {
  const digits = onlyDigits(value);
  return digits.length >= 10 && digits.length <= 13;
}

export function isValidZipCode(value: string): boolean {
  return onlyDigits(value).length === 8;
}
