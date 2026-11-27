import { describe, expect, it } from 'vitest';
import { FieldValueType } from './document-fields.js';
import {
  containsWords,
  normalizeFieldValue,
  normalizeStreet,
  normalizeText,
  parseDateBr,
  parseMoneyBrl,
  parseMonthBr,
  parseTaxId,
  parseUf,
  parseZip,
} from './normalize.js';

describe('parseMoneyBrl (formatting only, never rounding)', () => {
  it.each([
    ['R$ 3.800,00', '3800.00'],
    ['R$3.800,00', '3800.00'],
    ['3800,00', '3800.00'],
    ['1.234.567,89', '1234567.89'],
    ['0,01', '0.01'],
    ['  R$   12,50 ', '12.50'],
  ])('%s → %s', (raw, expected) => expect(parseMoneyBrl(raw)).toBe(expected));

  it.each([
    '3800.00',
    '3.800',
    '3,8',
    '38,000',
    'R$ 3.80,00',
    'cerca de R$ 3.800,00',
    '',
    '-10,00',
  ])('rejects ambiguous or foreign format %j', (raw) => expect(parseMoneyBrl(raw)).toBeNull());

  it('keeps one cent of difference', () => {
    expect(parseMoneyBrl('3.800,01')).not.toBe(parseMoneyBrl('3.800,00'));
  });
});

describe('dates and months', () => {
  it('parses dd/mm/yyyy and rejects impossible dates', () => {
    expect(parseDateBr('15/03/2026')).toBe('2026-03-15');
    expect(parseDateBr('15.03.2026')).toBe('2026-03-15');
    expect(parseDateBr('31/02/2026')).toBeNull();
    expect(parseDateBr('2026-03-15')).toBeNull();
    expect(parseDateBr('5/3/2026')).toBeNull();
  });

  it('parses numeric and named months', () => {
    expect(parseMonthBr('03/2026')).toBe('2026-03');
    expect(parseMonthBr('março/2026')).toBe('2026-03');
    expect(parseMonthBr('Outubro de 2026')).toBe('2026-10');
    expect(parseMonthBr('13/2026')).toBeNull();
    expect(parseMonthBr('Marco')).toBeNull();
  });
});

describe('identifiers', () => {
  it('accepts only CPF/CNPJ with valid check digits', () => {
    expect(parseTaxId('123.456.789-09')).toBe('12345678909');
    expect(parseTaxId('123.456.789-00')).toBeNull();
    expect(parseTaxId('CPF 12345678909')).toBeNull();
  });

  it('normalises CEP and UF', () => {
    expect(parseZip('01310-100')).toBe('01310100');
    expect(parseZip('0131-0100')).toBeNull();
    expect(parseUf('sp')).toBe('SP');
    expect(parseUf('XX')).toBeNull();
  });
});

describe('text', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalizeText('  JOÃO  da Silva, Jr. ')).toBe('joao da silva jr');
  });

  it('expands only the leading street abbreviation', () => {
    expect(normalizeStreet('R. das Flores')).toBe(normalizeStreet('Rua das Flores'));
    expect(normalizeStreet('Av Paulista')).toBe('avenida paulista');
    expect(normalizeStreet('Rua Av Brasil')).toBe('rua av brasil');
  });

  it('matches whole words only', () => {
    expect(containsWords('Salário líquido: R$ 1,00', 'liquido')).toBe(true);
    expect(containsWords('Liquidação', 'liquid')).toBe(false);
  });

  it('abbreviated names stay different (tolerance zero)', () => {
    expect(normalizeText('Maria S. Souza')).not.toBe(normalizeText('Maria Silva Souza'));
  });
});

describe('normalizeFieldValue', () => {
  it('dispatches by value type', () => {
    expect(normalizeFieldValue(FieldValueType.MONEY, 'R$ 1.000,00')).toBe('1000.00');
    expect(normalizeFieldValue(FieldValueType.TEXT, '  Maria   Souza ')).toBe('Maria Souza');
    expect(normalizeFieldValue(FieldValueType.TEXT, '   ')).toBeNull();
  });
});
