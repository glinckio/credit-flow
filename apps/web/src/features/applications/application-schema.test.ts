import { describe, expect, it } from 'vitest';
import {
  type ApplicationForm,
  applicationSchema,
  toApplicationPayload,
} from './application-schema';
import { checkUploadFile } from './upload-file';

const valid: ApplicationForm = {
  productType: 'PERSONAL_LOAN',
  requestedAmount: '15.000,00',
  termMonths: '24',
  purpose: 'Reforma da residencia',
  declaredMonthlyIncome: '6.500,00',
  declaredMonthlyCommitments: '',
};

const errorsOf = (v: unknown) => {
  const r = applicationSchema.safeParse(v);
  return r.success
    ? {}
    : Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
};

describe('applicationSchema', () => {
  it('accepts pt-BR amounts and converts them to API decimals', () => {
    expect(errorsOf(valid)).toEqual({});
    expect(toApplicationPayload(valid)).toEqual({
      productType: 'PERSONAL_LOAN',
      requestedAmount: '15000.00',
      termMonths: 24,
      purpose: 'Reforma da residencia',
      declaredMonthlyIncome: '6500.00',
      declaredMonthlyCommitments: null,
    });
  });

  it('rejects zero/invalid amounts and out-of-range terms', () => {
    expect(errorsOf({ ...valid, requestedAmount: '0' })).toHaveProperty('requestedAmount');
    expect(errorsOf({ ...valid, requestedAmount: '10,123' })).toHaveProperty('requestedAmount');
    expect(errorsOf({ ...valid, termMonths: '0' })).toHaveProperty('termMonths');
    expect(errorsOf({ ...valid, termMonths: '361' })).toHaveProperty('termMonths');
    expect(errorsOf({ ...valid, productType: '' })).toHaveProperty('productType');
    // Zero income is allowed (the indicators show "not computable"), negative is not.
    expect(errorsOf({ ...valid, declaredMonthlyIncome: '0' })).toEqual({});
    expect(errorsOf({ ...valid, declaredMonthlyIncome: '-1' })).toHaveProperty(
      'declaredMonthlyIncome',
    );
  });
});

describe('checkUploadFile', () => {
  it('pre-checks extension and size (the API checks the real content)', () => {
    expect(checkUploadFile({ name: 'rg.PDF', size: 100 })).toBeNull();
    expect(checkUploadFile({ name: 'foto.jpeg', size: 100 })).toBeNull();
    expect(checkUploadFile({ name: 'script.exe', size: 100 })).toMatch(/PDF, PNG ou JPEG/);
    expect(checkUploadFile({ name: 'semextensao', size: 100 })).toMatch(/PDF, PNG ou JPEG/);
    expect(checkUploadFile({ name: 'vazio.pdf', size: 0 })).toMatch(/vazio/);
    expect(checkUploadFile({ name: 'grande.pdf', size: 10 * 1024 * 1024 + 1 })).toMatch(/10 MB/);
  });
});
