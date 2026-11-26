import { describe, expect, it } from 'vitest';
import {
  cnpjCheckDigits,
  cpfCheckDigits,
  formatCnpj,
  formatCpf,
  isValidCnpj,
  isValidCpf,
  onlyDigits,
} from './cpf-cnpj.js';

// Numbers below are built from arbitrary bases by the check-digit algorithm
// itself; they are synthetic and not tied to any real person or company.
const SYNTHETIC_CPF = cpfCheckDigits('123456789');
const SYNTHETIC_CNPJ = cnpjCheckDigits('112223330001');

describe('CPF', () => {
  it('computes the known check digits for a textbook example', () => {
    expect(SYNTHETIC_CPF).toBe('12345678909');
  });

  it('accepts valid numbers with or without punctuation', () => {
    expect(isValidCpf(SYNTHETIC_CPF)).toBe(true);
    expect(isValidCpf(formatCpf(SYNTHETIC_CPF))).toBe(true);
  });

  it('rejects wrong check digits, wrong length and repeated digits', () => {
    expect(isValidCpf('12345678900')).toBe(false);
    expect(isValidCpf('1234567890')).toBe(false);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('')).toBe(false);
  });

  it('formats as 000.000.000-00', () => {
    expect(formatCpf('12345678909')).toBe('123.456.789-09');
  });
});

describe('CNPJ', () => {
  it('computes the known check digits for a textbook example', () => {
    expect(SYNTHETIC_CNPJ).toBe('11222333000181');
  });

  it('accepts valid numbers with or without punctuation', () => {
    expect(isValidCnpj(SYNTHETIC_CNPJ)).toBe(true);
    expect(isValidCnpj(formatCnpj(SYNTHETIC_CNPJ))).toBe(true);
  });

  it('rejects wrong check digits, wrong length and repeated digits', () => {
    expect(isValidCnpj('11222333000180')).toBe(false);
    expect(isValidCnpj('1122233300018')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
  });

  it('formats as 00.000.000/0000-00', () => {
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
  });
});

describe('onlyDigits', () => {
  it('strips punctuation and spaces', () => {
    expect(onlyDigits(' 11.222.333/0001-81 ')).toBe('11222333000181');
  });
});
