import { describe, expect, it } from 'vitest';
import {
  BRAZILIAN_STATES,
  ageInYears,
  checkBirthOrFoundationDate,
  isValidDocumentForType,
  isValidPhone,
  isValidZipCode,
  parseIsoDate,
} from './customer-rules.js';
import { cnpjCheckDigits, cpfCheckDigits } from './validators/cpf-cnpj.js';

const CPF = cpfCheckDigits('123456789');
const CNPJ = cnpjCheckDigits('112223330001');
const TODAY = new Date('2026-11-25T12:00:00Z');

describe('customer rules', () => {
  it('lists the 27 federative units', () => {
    expect(BRAZILIAN_STATES).toHaveLength(27);
  });

  it('requires a CPF for individuals and a CNPJ for companies', () => {
    expect(isValidDocumentForType('INDIVIDUAL', CPF)).toBe(true);
    expect(isValidDocumentForType('INDIVIDUAL', CNPJ)).toBe(false);
    expect(isValidDocumentForType('COMPANY', CNPJ)).toBe(true);
    expect(isValidDocumentForType('COMPANY', CPF)).toBe(false);
  });

  it('parses only real YYYY-MM-DD dates', () => {
    expect(parseIsoDate('2000-02-29')?.toISOString()).toBe('2000-02-29T00:00:00.000Z');
    expect(parseIsoDate('2001-02-29')).toBeNull();
    expect(parseIsoDate('25/11/2000')).toBeNull();
    expect(parseIsoDate('2000-1-1')).toBeNull();
  });

  it('computes age in full years around the birthday', () => {
    expect(ageInYears(new Date('2008-11-25T00:00:00Z'), TODAY)).toBe(18);
    expect(ageInYears(new Date('2008-11-26T00:00:00Z'), TODAY)).toBe(17);
  });

  it('validates birth/foundation dates', () => {
    expect(checkBirthOrFoundationDate('INDIVIDUAL', '2008-11-25', TODAY)).toBeNull();
    expect(checkBirthOrFoundationDate('INDIVIDUAL', '2008-11-26', TODAY)).toBe('underage');
    expect(checkBirthOrFoundationDate('COMPANY', '2026-01-10', TODAY)).toBeNull();
    expect(checkBirthOrFoundationDate('COMPANY', '2027-01-01', TODAY)).toBe('future');
    expect(checkBirthOrFoundationDate('COMPANY', '1850-01-01', TODAY)).toBe('invalid');
    expect(checkBirthOrFoundationDate('COMPANY', 'ontem', TODAY)).toBe('invalid');
  });

  it('validates phone and CEP by digit count', () => {
    expect(isValidPhone('+55 11 90000-0001')).toBe(true);
    expect(isValidPhone('(11) 3333-4444')).toBe(true);
    expect(isValidPhone('12345')).toBe(false);
    expect(isValidZipCode('01310-100')).toBe(true);
    expect(isValidZipCode('0131010')).toBe(false);
  });
});
