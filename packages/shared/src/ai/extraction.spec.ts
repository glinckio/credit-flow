import { describe, expect, it } from 'vitest';
import { ExtractedFieldKey as K } from './document-fields.js';
import { extractionJsonSchema, parseExtractionResult } from './extraction.js';

const valid = () => ({
  detectedType: 'PROOF_OF_INCOME',
  legibility: 'OK',
  embeddedInstructionsDetected: false,
  fields: [
    {
      key: 'netMonthlyIncome',
      status: 'FOUND',
      value: 'R$ 1,00',
      page: 1,
      quote: 'Liquido: R$ 1,00',
    },
    { key: 'holderTaxId', status: 'NOT_FOUND', value: null, page: null, quote: null },
    {
      key: 'grossMonthlyIncome',
      status: 'AMBIGUOUS',
      value: null,
      page: 1,
      quote: 'Bruto: R$ 2,00',
    },
  ],
});

describe('parseExtractionResult', () => {
  it('accepts a well-formed result', () => {
    const r = parseExtractionResult(valid());
    expect(r.ok).toBe(true);
  });

  it.each([
    ['not an object', 'oops'],
    ['extra root property', { ...valid(), decision: 'APPROVE' }],
    ['missing property', { ...valid(), fields: undefined }],
    ['unknown detected type', { ...valid(), detectedType: 'PASSPORT' }],
    ['non-boolean flag', { ...valid(), embeddedInstructionsDetected: 'no' }],
  ])('rejects %s', (_label, raw) => {
    expect(parseExtractionResult(raw).ok).toBe(false);
  });

  const withField = (f: Record<string, unknown>) => ({ ...valid(), fields: [f] });

  it.each([
    [
      'FOUND without quote',
      { key: 'holderName', status: 'FOUND', value: 'X', page: 1, quote: null },
    ],
    [
      'NOT_FOUND with a value (filled by assumption)',
      { key: 'holderName', status: 'NOT_FOUND', value: 'X', page: null, quote: null },
    ],
    [
      'AMBIGUOUS choosing a value',
      { key: 'holderName', status: 'AMBIGUOUS', value: 'X', page: 1, quote: 'Nome: X' },
    ],
    ['page zero', { key: 'holderName', status: 'FOUND', value: 'X', page: 0, quote: 'Nome: X' }],
    [
      'unknown field key',
      { key: 'creditScore', status: 'FOUND', value: '900', page: 1, quote: 'Score 900' },
    ],
    [
      'extra field property',
      {
        key: 'holderName',
        status: 'NOT_FOUND',
        value: null,
        page: null,
        quote: null,
        confidence: 0.9,
      },
    ],
    [
      'oversized quote',
      { key: 'holderName', status: 'FOUND', value: 'X', page: 1, quote: 'x'.repeat(501) },
    ],
  ])('rejects field: %s', (_label, f) => {
    expect(parseExtractionResult(withField(f)).ok).toBe(false);
  });

  it('rejects duplicated keys', () => {
    const f = { key: 'holderName', status: 'NOT_FOUND', value: null, page: null, quote: null };
    expect(parseExtractionResult({ ...valid(), fields: [f, f] }).ok).toBe(false);
  });
});

describe('extractionJsonSchema', () => {
  it('restricts field keys to the requested ones and forbids extra properties', () => {
    const schema = extractionJsonSchema([K.HOLDER_NAME]) as {
      additionalProperties: boolean;
      properties: { fields: { items: { properties: { key: { enum: string[] } } } } };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.fields.items.properties.key.enum).toEqual(['holderName']);
  });
});
