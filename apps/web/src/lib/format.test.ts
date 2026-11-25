import { describe, expect, it } from 'vitest';
import {
  formatBRL,
  formatDate,
  formatDocument,
  formatFileSize,
  maskCep,
  maskCnpj,
  maskCpf,
  maskPhone,
  moneyToInput,
  parseMoneyInput,
} from './format';

/** Intl uses a non-breaking space (U+00A0) between "R$" and the amount. */
const nbsp = (s: string) => s.replace(/\u00a0/g, ' ');

describe('formatting', () => {
  it('formats money, dates and documents for pt-BR', () => {
    expect(nbsp(formatBRL('15000.5'))).toBe('R$ 15.000,50');
    expect(formatBRL(null)).toBe('—');
    expect(formatDate('1990-05-17')).toBe('17/05/1990');
    expect(formatDocument('12345678909')).toBe('123.456.789-09');
    expect(formatDocument('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatFileSize(2_621_440)).toBe('2,5 MB');
  });
});

describe('input masks', () => {
  it('masks progressively and ignores extra digits', () => {
    expect(maskCpf('1234')).toBe('123.4');
    expect(maskCpf('123456789091234')).toBe('123.456.789-09');
    expect(maskCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(maskCep('01310100')).toBe('01310-100');
    expect(maskPhone('11912345678')).toBe('(11) 91234-5678');
    expect(maskPhone('1133334444')).toBe('(11) 3333-4444');
    expect(maskPhone('+55 11 90000-0001')).toBe('+55 (11) 90000-0001');
  });
});

describe('parseMoneyInput', () => {
  it.each([
    ['15.000,50', '15000.50'],
    ['15000,5', '15000.50'],
    ['15000.50', '15000.50'],
    ['15.000', '15000.00'],
    ['R$ 1.234,56', '1234.56'],
    ['0', '0.00'],
  ])('%s → %s', (input, expected) => {
    expect(parseMoneyInput(input)).toBe(expected);
  });

  it.each(['', 'abc', '10,123', '1,2,3', '-5'])('rejects %j', (input) => {
    expect(parseMoneyInput(input)).toBeNull();
  });

  it('round-trips through the input format', () => {
    expect(parseMoneyInput(moneyToInput('987654.3'))).toBe('987654.30');
  });
});
