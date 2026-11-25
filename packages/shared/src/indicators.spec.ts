import { describe, expect, it } from 'vitest';
import { INDICATORS_DISCLAIMER, computeIndicators } from './indicators.js';

const byKey = (input: Parameters<typeof computeIndicators>[0]) =>
  Object.fromEntries(computeIndicators(input).map((i) => [i.key, i.value]));

describe('computeIndicators', () => {
  it('computes the documented descriptive ratios', () => {
    expect(
      byKey({
        requestedAmount: '15000.00',
        termMonths: 24,
        declaredMonthlyIncome: '6500.00',
        declaredMonthlyCommitments: '1200.50',
      }),
    ).toEqual({
      simpleInstallment: '625.00', // 15000 / 24
      installmentToIncome: '0.0962', // 625 / 6500
      totalCommitmentToIncome: '0.2808', // (1200.50 + 625) / 6500 = 0.280846…
      amountInMonthsOfIncome: '2.31', // 15000 / 6500
    });
  });

  it('treats missing commitments as zero', () => {
    const v = byKey({
      requestedAmount: '1200',
      termMonths: 12,
      declaredMonthlyIncome: '1000',
      declaredMonthlyCommitments: null,
    });
    expect(v.totalCommitmentToIncome).toBe(v.installmentToIncome);
    expect(v.installmentToIncome).toBe('0.1000');
  });

  it('returns null instead of dividing by a zero income', () => {
    expect(
      byKey({
        requestedAmount: '5000.00',
        termMonths: 10,
        declaredMonthlyIncome: '0.00',
        declaredMonthlyCommitments: '100.00',
      }),
    ).toEqual({
      simpleInstallment: '500.00',
      installmentToIncome: null,
      totalCommitmentToIncome: null,
      amountInMonthsOfIncome: null,
    });
  });

  it('is exact for large amounts and single-digit cents', () => {
    expect(
      byKey({
        requestedAmount: '999999999999.99',
        termMonths: 1,
        declaredMonthlyIncome: '0.5',
        declaredMonthlyCommitments: null,
      }).simpleInstallment,
    ).toBe('999999999999.99');
  });

  it('documents every formula and never produces a score or verdict', () => {
    const list = computeIndicators({
      requestedAmount: '1',
      termMonths: 1,
      declaredMonthlyIncome: '1',
      declaredMonthlyCommitments: null,
    });
    for (const i of list) expect(i.formula.length).toBeGreaterThan(10);
    expect(JSON.stringify(list)).not.toMatch(/score|aprovad|reprovad|risco/i);
    expect(INDICATORS_DISCLAIMER).toMatch(/não determinam aprovação ou reprovação/);
  });
});
