import {
  type AssessedDocument,
  CustomerType,
  DocumentExtractionStatus,
  DocumentType,
  NarrativeStatus,
  buildTemplateReport,
  compareWithDeclared,
} from '@creditflow/shared';
import { composeNarrative } from './compose-narrative.js';
import { DeterministicNarrativeWriter } from './narrative-writer.js';

const doc: AssessedDocument = {
  documentId: 'renda',
  declaredType: DocumentType.PROOF_OF_INCOME,
  status: DocumentExtractionStatus.OK,
  detectedType: 'PROOF_OF_INCOME',
  typeMatchesDeclared: true,
  hasTextLayer: true,
  injectionAlert: false,
  fields: [
    {
      key: 'netMonthlyIncome',
      modelStatus: 'FOUND',
      modelValue: 'R$ 3.200,00',
      page: 1,
      quote: 'Liquido: R$ 3.200,00',
      evidenceStatus: 'VERIFIED',
      evidenceReason: null,
      acceptedValue: '3200.00',
      rejectedBy: null,
    },
  ] as AssessedDocument['fields'],
};
const declared = {
  customerType: CustomerType.INDIVIDUAL,
  name: 'Maria Silva Souza',
  taxId: '52998224725',
  birthOrFoundationDate: '1990-05-12',
  address: { street: 'Rua A', number: '1', city: 'X', state: 'SP', zipCode: '01000000' },
  declaredMonthlyIncome: '4100.00',
};
const findings = compareWithDeclared(declared, [doc]);
const report = buildTemplateReport(findings, [doc], { renda: 'holerite.pdf' });
const usage = { inputTokens: 900, outputTokens: 200 };

describe('composeNarrative', () => {
  it('renders a valid answer with the exact template values', async () => {
    const r = await composeNarrative(new DeterministicNarrativeWriter(), report, findings, {
      budgetExhausted: false,
    });
    expect(r.narrative.status).toBe(NarrativeStatus.OK);
    expect(r.narrative.sentences.map((s) => s.text).join(' ')).toContain('R$ 4.100,00');
    expect(r.narrative.sentences.map((s) => s.text).join(' ')).toContain('líquido R$ 3.200,00');
  });

  it('discards the whole narrative on any violation, keeping only the reasons', async () => {
    const writer = new DeterministicNarrativeWriter(() => ({
      kind: 'ok',
      output: { sentences: [{ text: 'Recomendo aprovar: renda de R$ 9.000,00.', refs: ['F1'] }] },
      model: 'claude-haiku-5-5',
      usage,
      latencyMs: 5,
    }));
    const r = await composeNarrative(writer, report, findings, { budgetExhausted: false });
    expect(r.narrative.status).toBe(NarrativeStatus.REJECTED);
    expect(r.narrative.sentences).toEqual([]);
    expect(JSON.stringify(r.narrative)).not.toContain('9.000');
    expect(r.narrative.rejections.map((x) => x.reason)).toEqual(
      expect.arrayContaining(['number-outside-placeholder', 'decision-or-judgement-term']),
    );
    expect(r).toMatchObject({ usage, model: 'claude-haiku-5-5' }); // still billed
  });

  it('fails safe on provider errors and on a throwing writer', async () => {
    const failing = new DeterministicNarrativeWriter(() => ({
      kind: 'error',
      code: 'TIMEOUT',
      model: 'claude-haiku-5-5',
      usage,
      latencyMs: 5,
    }));
    expect(
      (await composeNarrative(failing, report, findings, { budgetExhausted: false })).narrative
        .status,
    ).toBe(NarrativeStatus.FAILED);
    const throwing = new DeterministicNarrativeWriter(() => {
      throw new Error('boom');
    });
    const errors: unknown[] = [];
    const r = await composeNarrative(throwing, report, findings, {
      budgetExhausted: false,
      onWriterError: (e) => errors.push(e),
    });
    expect(r.narrative.status).toBe(NarrativeStatus.FAILED);
    expect(errors).toHaveLength(1);
  });

  it('does not call the model when disabled, unneeded or over budget', async () => {
    const writer = new DeterministicNarrativeWriter();
    const empty = buildTemplateReport([], [], {});
    expect(
      (await composeNarrative(null, report, findings, { budgetExhausted: false })).narrative.status,
    ).toBe(NarrativeStatus.DISABLED);
    expect(
      (await composeNarrative(writer, empty, [], { budgetExhausted: false })).narrative.status,
    ).toBe(NarrativeStatus.NOT_NEEDED);
    expect(
      (await composeNarrative(writer, report, findings, { budgetExhausted: true })).narrative
        .status,
    ).toBe(NarrativeStatus.SKIPPED_BUDGET);
    expect(writer.calls).toBe(0);
  });
});
