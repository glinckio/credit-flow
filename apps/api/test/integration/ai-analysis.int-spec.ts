import request from 'supertest';
import { type NarrativeInput, Role } from '@creditflow/shared';
import { buildSyntheticPdfPages, sha256Hex } from '../../prisma/seed/synthetic.js';
import {
  DOCUMENT_EXTRACTOR,
  DOCUMENT_TEXT_READER,
  NARRATIVE_WRITER,
} from '../../src/modules/ai-analysis/ai-analysis.tokens.js';
import {
  DeterministicNarrativeWriter,
  type NarrativeWriterResult,
} from '../../src/modules/ai-analysis/narrative/narrative-writer.js';
import { AiAnalysisWorker } from '../../src/modules/ai-analysis/ai-analysis.worker.js';
import {
  type RecordedResponse,
  RecordedExtractor,
} from '../../src/modules/ai-analysis/extraction/recorded-extractor.js';
import type {
  DocumentExtractor,
  ExtractionRequest,
  ExtractorResult,
} from '../../src/modules/ai-analysis/extraction/document-extractor.js';
import { resetDatabase } from '../helpers/database.js';
import { type TestApp, createTestApp, dump, signedIn } from '../helpers/app.js';
import { applicationBody, createCustomer } from '../helpers/fixtures.js';
import { SyntheticPdfTextReader } from '../helpers/synthetic-pdf-text.js';

type Signed = Awaited<ReturnType<typeof signedIn>>;

// ───────────────────────── synthetic documents + recorded answers ─────────────────────────

const ID_PDF = buildSyntheticPdfPages([
  { lines: ['IDENTIDADE (FICTICIA) - TESTE AI', 'Nome: Maria Silva Souza', 'CPF: 529.982.247-25'] },
]);
const INCOME_PDF = buildSyntheticPdfPages([
  {
    lines: [
      'HOLERITE (FICTICIO) - TESTE AI',
      'Funcionario: Maria Silva Souza',
      'Total de vencimentos (bruto): R$ 5.000,00',
      'Liquido a receber: R$ 4.100,00',
    ],
  },
]);
const EXTRA_PDF = buildSyntheticPdfPages([{ lines: ['EXTRATO (FICTICIO) - TESTE AI'] }]);

const found = (key: string, value: string, quote: string) => ({
  key,
  status: 'FOUND',
  value,
  page: 1,
  quote,
});
const notFound = (key: string) => ({
  key,
  status: 'NOT_FOUND',
  value: null,
  page: null,
  quote: null,
});

const ID_ANSWER = {
  detectedType: 'IDENTIFICATION',
  legibility: 'OK',
  embeddedInstructionsDetected: false,
  fields: [
    found('holderName', 'Maria Silva Souza', 'Nome: Maria Silva Souza'),
    found('holderTaxId', '529.982.247-25', 'CPF: 529.982.247-25'),
    notFound('birthDate'),
  ],
};
const INCOME_ANSWER = {
  detectedType: 'PROOF_OF_INCOME',
  legibility: 'OK',
  embeddedInstructionsDetected: false,
  fields: [
    found('holderName', 'Maria Silva Souza', 'Funcionario: Maria Silva Souza'),
    notFound('holderTaxId'),
    notFound('referenceMonth'),
    found('grossMonthlyIncome', 'R$ 5.000,00', 'Total de vencimentos (bruto): R$ 5.000,00'),
    found('netMonthlyIncome', 'R$ 4.100,00', 'Liquido a receber: R$ 4.100,00'),
    notFound('averageMonthlyRevenue'),
  ],
};
const EXTRA_ANSWER = {
  detectedType: 'BANK_STATEMENT',
  legibility: 'OK',
  embeddedInstructionsDetected: false,
  fields: [
    notFound('holderName'),
    notFound('holderTaxId'),
    notFound('periodStart'),
    notFound('periodEnd'),
  ],
};

/** Mutable on purpose: each test may script the provider's answers. */
const recordings = new Map<string, RecordedResponse>();

/**
 * Recorded answers reported as if billed by the real model, so the cost guard
 * can be exercised without any network call. `usage` is per call.
 */
class PricedRecordedExtractor implements DocumentExtractor {
  readonly model = 'claude-haiku-5-5';
  readonly promptVersion = 'recorded';
  usage = { inputTokens: 0, outputTokens: 0 };
  private readonly inner = new RecordedExtractor(recordings);
  calls = 0;
  async extract(req: ExtractionRequest): Promise<ExtractorResult> {
    this.calls++;
    return { ...(await this.inner.extract(req)), model: this.model, usage: { ...this.usage } };
  }
}
const extractor = new PricedRecordedExtractor();

/** Narrative writer: deterministic (always valid) unless a test scripts an answer. */
let narrativeScript: ((input: NarrativeInput) => NarrativeWriterResult) | undefined;
const narrator = new DeterministicNarrativeWriter((input) => narrativeScript?.(input));
function answerAll() {
  recordings.set(sha256Hex(ID_PDF), { kind: 'ok', output: ID_ANSWER });
  recordings.set(sha256Hex(INCOME_PDF), { kind: 'ok', output: INCOME_ANSWER });
  recordings.set(sha256Hex(EXTRA_PDF), { kind: 'ok', output: EXTRA_ANSWER });
}

describe('AI-assisted analysis (integration)', () => {
  let t: TestApp;
  let worker: AiAnalysisWorker;
  let operator: Signed;
  let deciderOperator: Signed;
  let analyst: Signed;
  let analyst2: Signed;
  let admin: Signed;
  let customerId: string;

  beforeAll(async () => {
    t = await createTestApp((b) =>
      b
        .overrideProvider(DOCUMENT_EXTRACTOR)
        .useValue(extractor)
        .overrideProvider(DOCUMENT_TEXT_READER)
        .useValue(new SyntheticPdfTextReader())
        .overrideProvider(NARRATIVE_WRITER)
        .useValue(narrator),
    );
    worker = t.app.get(AiAnalysisWorker);
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    answerAll();
    extractor.usage = { inputTokens: 0, outputTokens: 0 };
    narrativeScript = undefined;
    narrator.calls = 0;
    extractor.calls = 0;
    operator = await signedIn(t, Role.OPERATOR);
    deciderOperator = await signedIn(t, Role.OPERATOR, { canDecide: true });
    analyst = await signedIn(t, Role.ANALYST);
    analyst2 = await signedIn(t, Role.ANALYST);
    admin = await signedIn(t, Role.ADMIN);
    customerId = (await createCustomer(t.prisma, operator.user.id)).id;
  });
  afterAll(async () => {
    await t?.close();
  });

  const url = (id: string, suffix = '') => `/api/v1/applications/${id}${suffix}`;

  function upload(applicationId: string, data: Buffer, type: string) {
    return request(t.app.getHttpServer())
      .post(url(applicationId, '/documents'))
      .set('Cookie', operator.cookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .field('type', type)
      .attach('file', data, {
        filename: `${type.toLowerCase()}.pdf`,
        contentType: 'application/pdf',
      })
      .expect(201);
  }

  /** Draft → real uploads → submit → analyst takes the review (first entry). */
  async function inReview() {
    const res = await operator.http
      .post('/api/v1/applications', applicationBody(customerId))
      .expect(201);
    const id = res.body.id as string;
    await upload(id, ID_PDF, 'IDENTIFICATION');
    await upload(id, INCOME_PDF, 'PROOF_OF_INCOME');
    await operator.http.post(url(id, '/submit')).expect(200);
    await analyst.http.post(url(id, '/start-review')).expect(200);
    return id;
  }

  const runs = (who: Signed, id: string) => who.http.get(url(id, '/ai-analyses'));
  const detail = (who: Signed, runId: string) => who.http.get(`/api/v1/ai-analyses/${runId}`);

  it('queues the first analysis automatically and turns verified evidence into facts', async () => {
    const id = await inReview();

    const queued = await runs(analyst, id).expect(200);
    expect(queued.body).toHaveLength(1);
    expect(queued.body[0]).toMatchObject({
      trigger: 'AUTO_FIRST_REVIEW',
      status: 'QUEUED',
      model: 'claude-haiku-5-5',
      promptVersion: 'recorded',
      requestedBy: { id: analyst.user.id },
      stale: false,
    });

    const runId = queued.body[0].id as string;
    expect(await worker.runOnce()).toBe(runId);
    expect(await worker.runOnce()).toBeNull();

    const d = await detail(analyst, runId).expect(200);
    expect(d.body).toMatchObject({ status: 'SUCCEEDED', errorCode: null, documentCount: 2 });
    const income = d.body.documents.find(
      (x: { declaredType: string }) => x.declaredType === 'PROOF_OF_INCOME',
    );
    expect(income).toMatchObject({
      status: 'OK',
      typeMatchesDeclared: true,
      hasTextLayer: true,
      injectionAlert: false,
    });
    const net = income.fields.find((f: { key: string }) => f.key === 'netMonthlyIncome');
    expect(net).toMatchObject({ evidenceStatus: 'VERIFIED', acceptedValue: '4100.00', page: 1 });

    // B2: deterministic comparison with the declared data (synthetic customer ≠ Maria; 6500 declared).
    const kind = (subject: string, type: string) =>
      d.body.findings.find(
        (f: { subject: string; documentId: string }) =>
          f.subject === subject &&
          f.documentId ===
            d.body.documents.find((x: { declaredType: string }) => x.declaredType === type).document
              .id,
      )?.kind;
    expect(kind('monthlyIncome', 'PROOF_OF_INCOME')).toBe('DIVERGENT');
    expect(kind('holderName', 'IDENTIFICATION')).toBe('DIVERGENT');
    expect(kind('documentType', 'PROOF_OF_INCOME')).toBe('CONSISTENT');
    const incomeItem = d.body.report.attention.find(
      (i: { subject: string }) => i.subject === 'monthlyIncome',
    );
    expect(incomeItem.text).toBe(
      'Declarado: R$ 6.500,00. No documento: bruto R$ 5.000,00; líquido R$ 4.100,00. Os valores não são iguais.',
    );
    expect(d.body.reportAtCompletion).toEqual(d.body.report);
    expect(d.body.declaredDataChanged).toBe(false);

    // B4: narrative over the verified findings, values inserted by the backend.
    expect(d.body.narrative).toMatchObject({ status: 'OK', rejections: [] });
    const incomeSentence = d.body.narrative.sentences.find((s: { findingIds: string[] }) =>
      s.findingIds.includes(incomeItem.findingId),
    );
    expect(incomeSentence.text).toContain('R$ 6.500,00 (declarado)');
    expect(incomeSentence.text).toContain('bruto R$ 5.000,00; líquido R$ 4.100,00 (no documento)');

    // Declared data changes later: the live report follows, the snapshot stays.
    const app0 = await t.prisma.creditApplication.findUniqueOrThrow({ where: { id } });
    await t.prisma.customer.update({
      where: { id: app0.customerId },
      data: { name: 'Maria Silva Souza' },
    });
    const after = await detail(analyst, runId).expect(200);
    expect(after.body.declaredDataChanged).toBe(true);
    expect(after.body.reportAtCompletion).toEqual(d.body.report);
    expect(after.body.report).not.toEqual(d.body.report);
    expect(after.body.narrative).toEqual(d.body.narrative); // refers to the snapshot

    // The application itself is untouched by the AI.
    const app = await operator.http.get(url(id)).expect(200);
    expect(app.body.status).toBe('UNDER_REVIEW');

    // Audit: requested + completed, metadata only (never extracted values).
    const events = await t.prisma.auditEvent.findMany({ where: { entityType: 'AiAnalysisRun' } });
    expect(events.map((e) => e.action).sort()).toEqual([
      'ai_analysis.completed',
      'ai_analysis.requested',
    ]);
    expect(dump(events)).not.toMatch(/4100|4\.100|Maria Silva|529\.982/);
    expect(events.find((e) => e.action === 'ai_analysis.completed')?.after).toMatchObject({
      narrativeStatus: 'OK',
    });
  });

  it('discards a narrative that breaks a rule; the run and the template are unaffected', async () => {
    narrativeScript = (input) => ({
      kind: 'ok',
      output: {
        sentences: input.facts.map((f) => ({
          text: `${f.subject}: recomenda-se aprovar, renda de R$ 9.999,00.`,
          refs: [f.id],
        })),
      },
      model: 'claude-haiku-5-5',
      usage: { inputTokens: 800, outputTokens: 120 },
      latencyMs: 1,
    });
    await inReview();
    const runId = (await worker.runOnce())!;
    const d = (await detail(analyst, runId).expect(200)).body;
    expect(d.status).toBe('SUCCEEDED');
    expect(d.report.attention.length).toBeGreaterThan(0);
    expect(d.narrative).toMatchObject({ status: 'REJECTED', sentences: [] });
    expect(dump(d.narrative)).not.toMatch(/9\.999|aprovar/);
    expect(d.costUsd).not.toBe('0.000000'); // the call was billed
  });

  it('never queues automatically again (release → start-review, pending → resume)', async () => {
    const id = await inReview();
    await worker.runOnce();
    await analyst.http.post(url(id, '/release')).expect(200);
    await analyst.http.post(url(id, '/start-review')).expect(200);
    await analyst.http
      .post(url(id, '/issues'), { description: 'Enviar extrato bancario recente.' })
      .expect(201);
    await analyst.http
      .post(url(id, '/request-information'), { reason: 'Falta extrato' })
      .expect(200);
    await operator.http.post(url(id, '/resume'), { reason: 'Extrato enviado' }).expect(200);
    expect((await runs(analyst, id).expect(200)).body).toHaveLength(1);
  });

  it('reprocesses manually: assignee only, one at a time, confirmation when nothing changed', async () => {
    const id = await inReview();
    const post = (who: Signed, body: object = {}) => who.http.post(url(id, '/ai-analyses'), body);

    await post(operator).expect(403);
    await post(admin).expect(403);
    expect((await post(analyst2).expect(403)).body.type).toBe('/problems/not-assignee');

    const inProgress = await post(analyst).expect(409);
    expect(inProgress.body.type).toBe('/problems/analysis-in-progress');

    await worker.runOnce();
    const upToDate = await post(analyst).expect(409);
    expect(upToDate.body.type).toBe('/problems/analysis-up-to-date');

    const forced = await post(analyst, { force: true }).expect(202);
    expect(forced.body).toMatchObject({
      trigger: 'MANUAL',
      status: 'QUEUED',
      requestedBy: { id: analyst.user.id },
    });
    await post(analyst, { force: 'yes' }).expect(400);
  });

  it('flags a run as stale when documents change, and then reprocesses without confirmation', async () => {
    const id = await inReview();
    await worker.runOnce();
    await analyst.http
      .post(url(id, '/issues'), { description: 'Enviar extrato bancario recente.' })
      .expect(201);
    await analyst.http
      .post(url(id, '/request-information'), { reason: 'Falta extrato' })
      .expect(200);
    await upload(id, EXTRA_PDF, 'BANK_STATEMENT');

    // Not in review: reprocessing is refused.
    expect((await analyst.http.post(url(id, '/ai-analyses')).expect(409)).body.type).toBe(
      '/problems/application-not-in-review',
    );
    await operator.http.post(url(id, '/resume'), { reason: 'Extrato enviado' }).expect(200);

    const [first] = (await runs(analyst, id).expect(200)).body;
    expect(first.stale).toBe(true);
    await analyst.http.post(url(id, '/ai-analyses')).expect(202);
    await worker.runOnce();
    const latest = (await runs(analyst, id).expect(200)).body;
    expect(latest.map((r: { stale: boolean }) => r.stale)).toEqual([false, true]);
    expect(latest[0].documentCount).toBe(3);
  });

  it('lets analysts, admins and deciding operators read; nobody else', async () => {
    const id = await inReview();
    const runId = (await runs(analyst, id).expect(200)).body[0].id as string;
    for (const who of [analyst, analyst2, admin, deciderOperator]) {
      await runs(who, id).expect(200);
      await detail(who, runId).expect(200);
    }
    await runs(operator, id).expect(403);
    await detail(operator, runId).expect(403);
    await detail(analyst, '00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('takes feedback per finding from the assigned analyst only, without touching anything else', async () => {
    await inReview();
    const runId = (await worker.runOnce())!;
    const d = (await detail(analyst, runId).expect(200)).body;
    const findingId = d.report.attention[0].findingId as string;
    const put = (who: Signed, fid: string, body: object) =>
      who.http.put(
        `/api/v1/ai-analyses/${runId}/findings/${encodeURIComponent(fid)}/feedback`,
        body,
      );

    const comment = 'Valor confere com a pagina 1 do holerite.';
    const saved = await put(analyst, findingId, { verdict: 'INCORRECT', comment }).expect(200);
    expect(saved.body).toMatchObject({
      findingId,
      verdict: 'INCORRECT',
      comment,
      author: { id: analyst.user.id },
    });
    // Sending again replaces the analyst's own opinion.
    await put(analyst, findingId, { verdict: 'CORRECT' }).expect(200);
    const after = (await detail(admin, runId).expect(200)).body;
    expect(after.feedback).toEqual([
      expect.objectContaining({ findingId, verdict: 'CORRECT', comment: null }),
    ]);
    // Report and findings are unchanged.
    expect(after.report).toEqual(d.report);
    expect(after.findings).toEqual(d.findings);

    await put(analyst2, findingId, { verdict: 'CORRECT' }).expect(403);
    await put(admin, findingId, { verdict: 'CORRECT' }).expect(403);
    await put(deciderOperator, findingId, { verdict: 'CORRECT' }).expect(403);
    await put(analyst, findingId, { verdict: 'MAYBE' }).expect(400);
    await put(analyst, findingId, { verdict: 'CORRECT', comment: 'x'.repeat(501) }).expect(400);
    await put(analyst, `holderName:${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`, {
      verdict: 'CORRECT',
    }).expect(404);
    await put(analyst, 'nao-e-um-achado', { verdict: 'CORRECT' }).expect(404);

    // The audit keeps the verdict, never the comment.
    const events = await t.prisma.auditEvent.findMany({
      where: { action: 'ai_analysis.feedback' },
    });
    expect(events).toHaveLength(2);
    expect(dump(events.map((e) => e.after))).not.toContain('holerite');
    expect(events[0]!.after).toMatchObject({ verdict: 'INCORRECT', hasComment: true });

    // Purged with the run's content (the comment may quote the document).
    await t.prisma.aiAnalysisRun.update({
      where: { id: runId },
      data: { finishedAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000) },
    });
    await worker.purgeExpired();
    expect(await t.prisma.aiFindingFeedback.count()).toBe(0);
    expect((await put(analyst, findingId, { verdict: 'CORRECT' }).expect(409)).body.type).toBe(
      '/problems/analysis-purged',
    );
  });

  it('records provider failures per document (PARTIAL / FAILED) without blocking the human flow', async () => {
    recordings.set(sha256Hex(ID_PDF), { kind: 'error', code: 'TIMEOUT' });
    const id = await inReview();
    await worker.runOnce();
    const [partial] = (await runs(analyst, id).expect(200)).body;
    expect(partial.status).toBe('PARTIAL');
    const d = await detail(analyst, partial.id).expect(200);
    expect(d.body.documents.map((x: { status: string }) => x.status).sort()).toEqual([
      'OK',
      'TIMEOUT',
    ]);

    recordings.set(sha256Hex(INCOME_PDF), { kind: 'error', code: 'UNAVAILABLE' });
    await analyst.http.post(url(id, '/ai-analyses'), { force: true }).expect(202);
    await worker.runOnce();
    const [failed] = (await runs(analyst, id).expect(200)).body;
    expect(failed).toMatchObject({ status: 'FAILED', errorCode: 'all-documents-failed' });

    // The manual analysis goes on as usual.
    await analyst.http
      .post(url(id, '/reviews'), {
        recommendation: 'REQUEST_INFORMATION',
        analysisNotes: 'Analise manual segue normalmente.',
        justification: 'Analise de IA indisponivel; conferencia manual dos documentos.',
      })
      .expect(201);
  });

  it('marks an interrupted run as FAILED and never retries it', async () => {
    const id = await inReview();
    const [run] = (await runs(analyst, id).expect(200)).body;
    await t.prisma.aiAnalysisRun.update({
      where: { id: run.id },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() - 1000),
      },
    });
    expect(await worker.runOnce()).toBeNull();
    const [after] = (await runs(analyst, id).expect(200)).body;
    expect(after).toMatchObject({ status: 'FAILED', errorCode: 'interrupted' });
    expect(await t.prisma.aiDocumentExtraction.count()).toBe(0);
  });

  it('purges extracted content after the retention period, keeping metadata only', async () => {
    const id = await inReview();
    const runId = (await worker.runOnce())!;
    expect(await worker.purgeExpired()).toBe(0);

    const old = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    await t.prisma.aiAnalysisRun.update({ where: { id: runId }, data: { finishedAt: old } });
    expect(await worker.purgeExpired()).toBe(1);

    const d = await detail(analyst, runId).expect(200);
    expect(d.body).toMatchObject({
      status: 'SUCCEEDED',
      documents: [],
      findings: [],
      report: null,
      reportAtCompletion: null,
      narrative: null,
    });
    expect(d.body.purgedAt).not.toBeNull();
    expect(await t.prisma.aiDocumentExtraction.count()).toBe(0);
    const purged = await t.prisma.auditEvent.findFirst({ where: { action: 'ai_analysis.purged' } });
    expect(purged?.after).toMatchObject({
      applicationId: id,
      extractionsDeleted: 2,
      retentionDays: 90,
    });
  });

  it('keeps extractions write-once at the database level', async () => {
    await inReview();
    await worker.runOnce();
    await t.prisma.aiDocumentExtraction.findFirstOrThrow();
    await expect(
      t.prisma.$executeRawUnsafe(`UPDATE "ai_document_extractions" SET "injection_alert" = true`),
    ).rejects.toThrow(/append-only/);
    // DELETE stays possible: it is how the retention purge removes content.
    await expect(t.prisma.$executeRawUnsafe(`DELETE FROM "ai_document_extractions"`)).resolves.toBe(
      2,
    );
  });

  it('allows a single active run per application at the database level', async () => {
    const id = await inReview();
    const [run] = (await runs(analyst, id).expect(200)).body;
    const base = await t.prisma.aiAnalysisRun.findUniqueOrThrow({ where: { id: run.id } });
    const { id: _id, reportSnapshot: _snapshot, ...copy } = base;
    await expect(
      t.prisma.aiAnalysisRun.create({ data: { ...copy, trigger: 'MANUAL' } }),
    ).rejects.toThrow();
  });
});

describe('AI-assisted analysis cost guards', () => {
  let t: TestApp;
  let worker: AiAnalysisWorker;

  beforeAll(async () => {
    t = await createTestApp((b) =>
      b
        .overrideProvider(DOCUMENT_EXTRACTOR)
        .useValue(extractor)
        .overrideProvider(DOCUMENT_TEXT_READER)
        .useValue(new SyntheticPdfTextReader())
        .overrideProvider(NARRATIVE_WRITER)
        .useValue(narrator),
    );
    worker = t.app.get(AiAnalysisWorker);
  });
  afterAll(async () => {
    await t?.close();
  });

  async function reviewWith(docs: Array<[string, Buffer]>) {
    await resetDatabase(t.prisma);
    answerAll();
    extractor.calls = 0;
    narrator.calls = 0;
    const operator = await signedIn(t, Role.OPERATOR);
    const analyst = await signedIn(t, Role.ANALYST);
    const customerId = (await createCustomer(t.prisma, operator.user.id)).id;
    const id = (
      await operator.http.post('/api/v1/applications', applicationBody(customerId)).expect(201)
    ).body.id as string;
    for (const [type, pdf] of docs) {
      await request(t.app.getHttpServer())
        .post(`/api/v1/applications/${id}/documents`)
        .set('Cookie', operator.cookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .field('type', type)
        .attach('file', pdf, { filename: 'doc.pdf', contentType: 'application/pdf' })
        .expect(201);
    }
    await operator.http.post(`/api/v1/applications/${id}/submit`).expect(200);
    await analyst.http.post(`/api/v1/applications/${id}/start-review`).expect(200);
    const runId = (await worker.runOnce())!;
    return { analyst, runId };
  }

  it('does not send documents with too many pages to the model (TOO_LARGE)', async () => {
    const eleven = buildSyntheticPdfPages(
      Array.from({ length: 11 }, (_, i) => ({ lines: [`Pagina ${i + 1} - grande demais`] })),
    );
    extractor.usage = { inputTokens: 0, outputTokens: 0 };
    const { analyst, runId } = await reviewWith([
      ['IDENTIFICATION', ID_PDF],
      ['PROOF_OF_INCOME', eleven],
    ]);
    expect(extractor.calls).toBe(1);
    const d = (await analyst.http.get(`/api/v1/ai-analyses/${runId}`).expect(200)).body;
    expect(d.status).toBe('PARTIAL');
    expect(d.documents.map((x: { status: string }) => x.status).sort()).toEqual([
      'OK',
      'TOO_LARGE',
    ]);
  });

  it('skips the remaining documents once the run reaches its cost limit (SKIPPED_BUDGET)', async () => {
    // 1M input tokens of Haiku 5.5 above 100K → US$ 0.50 > default limit of US$ 0.10.
    extractor.usage = { inputTokens: 1_000_000, outputTokens: 0 };
    const { analyst, runId } = await reviewWith([
      ['IDENTIFICATION', ID_PDF],
      ['PROOF_OF_INCOME', INCOME_PDF],
    ]);
    expect(extractor.calls).toBe(1);
    const d = (await analyst.http.get(`/api/v1/ai-analyses/${runId}`).expect(200)).body;
    expect(d).toMatchObject({ status: 'PARTIAL', costUsd: '0.500000', inputTokens: 1_000_000 });
    expect(d.documents.map((x: { status: string }) => x.status)).toEqual(['OK', 'SKIPPED_BUDGET']);
    expect(d.narrative.status).toBe('SKIPPED_BUDGET');
    expect(narrator.calls).toBe(0);
    expect(d.report.limitations.some((l: string) => l.includes('não puderam ser analisados'))).toBe(
      true,
    );
  });
});

describe('AI-assisted analysis disabled (default configuration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });

  it('queues nothing and answers 503 to manual requests; the human flow is unchanged', async () => {
    await resetDatabase(t.prisma);
    const operator = await signedIn(t, Role.OPERATOR);
    const analyst = await signedIn(t, Role.ANALYST);
    const customerId = (await createCustomer(t.prisma, operator.user.id)).id;
    const id = (
      await operator.http.post('/api/v1/applications', applicationBody(customerId)).expect(201)
    ).body.id as string;
    for (const [type, pdf] of [
      ['IDENTIFICATION', ID_PDF],
      ['PROOF_OF_INCOME', INCOME_PDF],
    ] as const) {
      await request(t.app.getHttpServer())
        .post(`/api/v1/applications/${id}/documents`)
        .set('Cookie', operator.cookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .field('type', type)
        .attach('file', pdf, { filename: 'doc.pdf', contentType: 'application/pdf' })
        .expect(201);
    }
    await operator.http.post(`/api/v1/applications/${id}/submit`).expect(200);
    await analyst.http.post(`/api/v1/applications/${id}/start-review`).expect(200);

    expect(
      (await analyst.http.get(`/api/v1/applications/${id}/ai-analyses`).expect(200)).body,
    ).toEqual([]);
    const res = await analyst.http.post(`/api/v1/applications/${id}/ai-analyses`).expect(503);
    expect(res.body.type).toBe('/problems/ai-disabled');
  });
});
