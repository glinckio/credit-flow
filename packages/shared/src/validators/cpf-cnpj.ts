/**
 * CPF / CNPJ helpers (Brazilian taxpayer identifiers).
 *
 * Only the check-digit algorithm is validated. A valid check digit does NOT
 * mean the document exists or belongs to anyone — the demo data uses randomly
 * generated, synthetic numbers.
 */

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function allSameDigit(digits: string): boolean {
  return /^(\d)\1*$/.test(digits);
}

function mod11CheckDigit(digits: string, weights: readonly number[]): number {
  const sum = weights.reduce((acc, weight, i) => acc + Number(digits[i]) * weight, 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

const CPF_WEIGHTS_1 = [10, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const CPF_WEIGHTS_2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const CNPJ_WEIGHTS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const CNPJ_WEIGHTS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

/** Appends the two CPF check digits to a 9-digit base. */
export function cpfCheckDigits(base9: string): string {
  const d1 = mod11CheckDigit(base9, CPF_WEIGHTS_1);
  const d2 = mod11CheckDigit(`${base9}${d1}`, CPF_WEIGHTS_2);
  return `${base9}${d1}${d2}`;
}

/** Appends the two CNPJ check digits to a 12-digit base. */
export function cnpjCheckDigits(base12: string): string {
  const d1 = mod11CheckDigit(base12, CNPJ_WEIGHTS_1);
  const d2 = mod11CheckDigit(`${base12}${d1}`, CNPJ_WEIGHTS_2);
  return `${base12}${d1}${d2}`;
}

export function isValidCpf(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length !== 11 || allSameDigit(digits)) return false;
  return cpfCheckDigits(digits.slice(0, 9)) === digits;
}

export function isValidCnpj(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length !== 14 || allSameDigit(digits)) return false;
  return cnpjCheckDigits(digits.slice(0, 12)) === digits;
}

export function formatCpf(value: string): string {
  return onlyDigits(value).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

export function formatCnpj(value: string): string {
  return onlyDigits(value).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}
