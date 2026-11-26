import { describe, expect, it } from 'vitest';
import { CustomerType, DocumentType } from '../enums.js';
import { type AssessedDocument, compareWithDeclared } from './comparison.js';
import { DocumentExtractionStatus as S } from './extraction.js';
import { REPORT_DISCLAIMER, buildTemplateReport, formatBrl, renderReportText } from './report.js';

const verified = (key: string, value: string) =>
  ({
    key,
    modelStatus: 'FOUND',
    modelValue: value,
    page: 1,
    quote: `${key}: ${value}`,
    evidenceStatus: 'VERIFIED',
    evidenceReason: null,
    acceptedValue: value,
    rejectedBy: null,
  }) as AssessedDocument['fields'][number];

const docs: AssessedDocument[] = [
  {
    documentId: 'renda',
    declaredType: DocumentType.PROOF_OF_INCOME,
    status: S.OK,
    detectedType: 'PROOF_OF_INCOME',
    typeMatchesDeclared: true,
    hasTextLayer: true,
    injectionAlert: false,
    fields: [verified('holderName', 'Maria Silva Souza'), verified('netMonthlyIncome', '3200.00')],
  },
  {
    documentId: 'identidade',
    declaredType: DocumentType.IDENTIFICATION,
    status: S.TIMEOUT,
    detectedType: null,
    typeMatchesDeclared: null,
    hasTextLayer: true,
    injectionAlert: false,
    fields: [],
  },
];

const declared = {
  customerType: CustomerType.INDIVIDUAL,
  name: 'Maria Silva Souza',
  taxId: '52998224725',
  birthOrFoundationDate: '1990-05-12',
  address: { street: 'Rua A', number: '1', city: 'X', state: 'SP', zipCode: '01000000' },
  declaredMonthlyIncome: '4100.00',
};

describe('formatBrl', () => {
  it('formats exactly, without rounding', () => {
    expect(formatBrl('4100.00')).toBe('R$ 4.100,00');
    expect(formatBrl('1234567.89')).toBe('R$ 1.234.567,89');
    expect(formatBrl('0.01')).toBe('R$ 0,01');
  });
});

describe('buildTemplateReport', () => {
  const report = buildTemplateReport(compareWithDeclared(declared, docs), docs, {
    renda: 'holerite.pdf',
    identidade: 'rg.pdf',
  });

  it('puts divergences first, with declared and document values in words', () => {
    expect(report.attention[0]).toMatchObject({
      subject: 'monthlyIncome',
      kind: 'DIVERGENT',
      title: 'Renda/faturamento mensal — Divergente',
      documentLabel: 'holerite.pdf (comprovante de renda/faturamento)',
    });
    expect(report.attention[0]!.text).toBe(
      'Declarado: R$ 4.100,00. No documento: líquido R$ 3.200,00. Os valores não são iguais.',
    );
  });

  it('counts findings and lists documents that could not be analysed', () => {
    expect(report.counts.DIVERGENT).toBe(1);
    expect(report.documents.find((d) => d.documentId === 'identidade')?.statusLabel).toBe(
      'Não analisado: tempo esgotado',
    );
    expect(
      report.limitations.some((l) => l.startsWith('1 documento(s) não puderam ser analisados')),
    ).toBe(true);
  });

  it('never words a decision', () => {
    const text = renderReportText(report);
    expect(text.startsWith(REPORT_DISCLAIMER)).toBe(true);
    expect(text).not.toMatch(/\b(aprov|reprov|recomend)/i);
  });
});
