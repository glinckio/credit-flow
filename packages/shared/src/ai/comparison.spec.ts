import { describe, expect, it } from 'vitest';
import { CustomerType, DocumentType } from '../enums.js';
import {
  type AssessedDocument,
  type AssessedField,
  type DeclaredData,
  FindingKind as F,
  compareWithDeclared,
} from './comparison.js';
import { ExtractedFieldKey as K } from './document-fields.js';
import { DocumentExtractionStatus as S } from './extraction.js';

const declared: DeclaredData = {
  customerType: CustomerType.INDIVIDUAL,
  name: 'Maria Silva Souza',
  taxId: '52998224725',
  birthOrFoundationDate: '1990-05-12',
  address: {
    street: 'Rua das Flores',
    number: '123',
    city: 'São Paulo',
    state: 'SP',
    zipCode: '01310100',
  },
  declaredMonthlyIncome: '4100.00',
};

/** accepted value → VALUE; 'NOT_FOUND' | 'AMBIGUOUS' | 'UNVERIFIED' | 'CONFLICT' | 'NO_TEXT' → that state. */
function field(key: K, v: string): AssessedField {
  const base = { key, page: 1, quote: `${key}: ${v}`, modelValue: v, rejectedBy: null };
  switch (v) {
    case 'NOT_FOUND':
      return {
        ...base,
        modelStatus: 'NOT_FOUND',
        modelValue: null,
        page: null,
        quote: null,
        evidenceStatus: null,
        evidenceReason: null,
        acceptedValue: null,
      };
    case 'AMBIGUOUS':
      return {
        ...base,
        modelStatus: 'AMBIGUOUS',
        modelValue: null,
        evidenceStatus: null,
        evidenceReason: null,
        acceptedValue: null,
      };
    case 'UNVERIFIED':
      return {
        ...base,
        modelStatus: 'FOUND',
        evidenceStatus: 'UNVERIFIED',
        evidenceReason: 'quote-not-found',
        acceptedValue: null,
      };
    case 'CONFLICT':
      return {
        ...base,
        modelStatus: 'FOUND',
        evidenceStatus: 'UNVERIFIED',
        evidenceReason: 'conflicting-values',
        acceptedValue: null,
      };
    case 'NO_TEXT':
      return {
        ...base,
        modelStatus: 'FOUND',
        evidenceStatus: 'UNVERIFIABLE',
        evidenceReason: 'no-text-layer',
        acceptedValue: null,
      };
    default:
      return {
        ...base,
        modelStatus: 'FOUND',
        evidenceStatus: 'VERIFIED',
        evidenceReason: null,
        acceptedValue: v,
      };
  }
}

function doc(
  type: DocumentType,
  fields: Partial<Record<K, string>>,
  over: Partial<AssessedDocument> = {},
): AssessedDocument {
  return {
    documentId: 'd1',
    declaredType: type,
    status: S.OK,
    detectedType: type,
    typeMatchesDeclared: true,
    hasTextLayer: true,
    injectionAlert: false,
    fields: Object.entries(fields).map(([k, v]) => field(k as K, v)),
    ...over,
  };
}

const kindOf = (subject: string, d: AssessedDocument, data = declared) =>
  compareWithDeclared(data, [d]).find((f) => f.subject === subject)?.kind;

const income = (gross: string, net: string) =>
  doc(DocumentType.PROOF_OF_INCOME, {
    holderName: 'Maria Silva Souza',
    holderTaxId: 'NOT_FOUND',
    grossMonthlyIncome: gross,
    netMonthlyIncome: net,
    averageMonthlyRevenue: 'NOT_FOUND',
  });

describe('compareWithDeclared — income (gross OR net, tolerance zero)', () => {
  it.each([
    ['net equals declared', '5000.00', '4100.00', F.CONSISTENT],
    ['gross equals declared', '4100.00', '3500.00', F.CONSISTENT],
    ['one cent off', '5000.00', '4100.01', F.DIVERGENT],
    ['neither matches', '3900.00', '3200.00', F.DIVERGENT],
    ['net missing, gross matches', '4100.00', 'NOT_FOUND', F.CONSISTENT],
    ['contradictory net', '5000.00', 'AMBIGUOUS', F.AMBIGUOUS],
    ['conflict found by code', '5000.00', 'CONFLICT', F.AMBIGUOUS],
    ['gross differs but net unverified: no conclusion', '5000.00', 'UNVERIFIED', F.UNVERIFIABLE],
    ['nothing in the document', 'NOT_FOUND', 'NOT_FOUND', F.MISSING],
  ])('%s → %s', (_l, gross, net, expected) => {
    expect(kindOf('monthlyIncome', income(gross, net))).toBe(expected);
  });

  it('uses the average revenue for companies', () => {
    const d = doc(DocumentType.PROOF_OF_INCOME, {
      holderName: 'Padaria LTDA',
      averageMonthlyRevenue: '80000.00',
      grossMonthlyIncome: 'NOT_FOUND',
      netMonthlyIncome: 'NOT_FOUND',
    });
    expect(
      kindOf('monthlyIncome', d, {
        ...declared,
        customerType: CustomerType.COMPANY,
        declaredMonthlyIncome: '80000.00',
      }),
    ).toBe(F.CONSISTENT);
  });
});

describe('compareWithDeclared — identity and address', () => {
  it('compares names ignoring case/accents but never abbreviations', () => {
    expect(kindOf('holderName', income('1.00', '1.00'))).toBe(F.CONSISTENT);
    const abbreviated = doc(DocumentType.IDENTIFICATION, {
      holderName: 'MARIA S. SOUZA',
      holderTaxId: '52998224725',
      birthDate: '1990-05-12',
    });
    expect(kindOf('holderName', abbreviated)).toBe(F.DIVERGENT);
    const accents = doc(DocumentType.IDENTIFICATION, {
      holderName: 'MARIA SILVA SOUZA',
      holderTaxId: '52998224725',
      birthDate: '1990-05-12',
    });
    expect(kindOf('holderName', accents)).toBe(F.CONSISTENT);
  });

  it('compares CPF and birth date exactly; birth date only for individuals', () => {
    const id = doc(DocumentType.IDENTIFICATION, {
      holderName: 'Maria Silva Souza',
      holderTaxId: '11144477735',
      birthDate: '1990-05-13',
    });
    expect(kindOf('holderTaxId', id)).toBe(F.DIVERGENT);
    expect(kindOf('birthDate', id)).toBe(F.DIVERGENT);
    expect(
      kindOf('birthDate', id, { ...declared, customerType: CustomerType.COMPANY }),
    ).toBeUndefined();
  });

  it('requires every address component to match, after formatting normalisation', () => {
    const address = (street: string, zip: string) =>
      doc(DocumentType.PROOF_OF_ADDRESS, {
        holderName: 'Maria Silva Souza',
        addressStreet: street,
        addressNumber: '123',
        addressCity: 'Sao Paulo',
        addressState: 'SP',
        addressZipCode: zip,
      });
    expect(kindOf('address', address('R. das Flores', '01310100'))).toBe(F.CONSISTENT);
    expect(kindOf('address', address('R. das Flores', '01310101'))).toBe(F.DIVERGENT);
    expect(kindOf('address', address('NO_TEXT', '01310100'))).toBe(F.UNVERIFIABLE);
  });
});

describe('compareWithDeclared — documents', () => {
  it('flags type mismatch and unsupported documents', () => {
    const mismatch = doc(
      DocumentType.PROOF_OF_INCOME,
      {},
      { detectedType: 'BANK_STATEMENT', typeMatchesDeclared: false },
    );
    expect(kindOf('documentType', mismatch)).toBe(F.DIVERGENT);
    const unknown = doc(
      DocumentType.PROOF_OF_INCOME,
      {},
      { status: S.UNSUPPORTED, detectedType: 'UNKNOWN', typeMatchesDeclared: null },
    );
    expect(compareWithDeclared(declared, [unknown]).map((f) => [f.subject, f.kind])).toEqual([
      ['documentType', F.DIVERGENT],
    ]);
  });

  it('turns every subject of an illegible document into UNVERIFIABLE', () => {
    const illegible = doc(DocumentType.PROOF_OF_INCOME, {}, { status: S.UNREADABLE });
    const kinds = compareWithDeclared(declared, [illegible]).filter(
      (f) => f.subject !== 'documentType',
    );
    expect(kinds.map((f) => f.kind)).toEqual([F.UNVERIFIABLE, F.UNVERIFIABLE, F.UNVERIFIABLE]);
  });

  it('does not call a document with injected text "contradictory": it is unverifiable', () => {
    const flagged = { ...income('5000.00', 'CONFLICT'), injectionAlert: true };
    expect(kindOf('monthlyIncome', flagged)).not.toBe(F.AMBIGUOUS);
    expect(
      kindOf('monthlyIncome', {
        ...flagged,
        fields: flagged.fields.map((f) => ({
          ...f,
          acceptedValue: null,
          evidenceStatus: 'VERIFIED' as const,
          rejectedBy: 'document-flagged',
        })),
      }),
    ).toBe(F.UNVERIFIABLE);
  });

  it('produces no subject finding for documents the provider failed on', () => {
    const failed = doc(
      DocumentType.PROOF_OF_INCOME,
      {},
      { status: S.TIMEOUT, detectedType: null, typeMatchesDeclared: null },
    );
    expect(compareWithDeclared(declared, [failed])).toEqual([]);
  });

  it('only ever reports accepted values as document values', () => {
    const findings = compareWithDeclared(declared, [income('5000.00', 'UNVERIFIED')]);
    const inc = findings.find((f) => f.subject === 'monthlyIncome')!;
    expect(inc.documentValues).toEqual([{ field: 'grossMonthlyIncome', value: '5000.00' }]);
    expect(inc.evidence.map((e) => [e.field, e.verified])).toEqual([
      ['grossMonthlyIncome', true],
      ['netMonthlyIncome', false],
    ]);
  });
});
