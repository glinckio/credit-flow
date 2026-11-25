import { Role } from '@creditflow/shared';
import { resetDatabase } from '../helpers/database.js';
import { type TestApp, createTestApp, signedIn } from '../helpers/app.js';
import { applicationBody, attachDocuments, createCustomer } from '../helpers/fixtures.js';

type Signed = Awaited<ReturnType<typeof signedIn>>;

const REVIEW = {
  recommendation: 'APPROVE',
  analysisNotes: 'Documentacao completa e coerente com os valores declarados.',
  justification: 'Renda declarada comprovada; compromissos compativeis com o prazo.',
};
const APPROVE = {
  outcome: 'APPROVED',
  justification: 'Aprovado conforme parecer: capacidade de pagamento declarada compativel.',
};
const REJECT = {
  outcome: 'REJECTED',
  justification: 'Reprovado: comprometimento de renda declarado elevado para o prazo pedido.',
};

describe('analysis and final decision (integration)', () => {
  let t: TestApp;
  let operator: Signed;
  let deciderOperator: Signed;
  let analyst: Signed;
  let analyst2: Signed;
  let admin: Signed;
  let customerId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
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

  async function draft(overrides: Record<string, unknown> = {}) {
    const res = await operator.http
      .post('/api/v1/applications', applicationBody(customerId, overrides))
      .expect(201);
    return res.body.id as string;
  }

  async function inReview(overrides: Record<string, unknown> = {}) {
    const id = await draft(overrides);
    await attachDocuments(t.prisma, id, operator.user.id);
    await operator.http.post(url(id, '/submit')).expect(200);
    await analyst.http.post(url(id, '/start-review')).expect(200);
    return id;
  }

  async function reviewed() {
    const id = await inReview();
    await analyst.http.post(url(id, '/reviews'), REVIEW).expect(201);
    return id;
  }

  describe('GET /indicators', () => {
    it('returns the documented descriptive values with a disclaimer', async () => {
      const id = await inReview();
      const res = await analyst.http.get(url(id, '/indicators')).expect(200);
      expect(
        Object.fromEntries(
          res.body.indicators.map((i: { key: string; value: string }) => [i.key, i.value]),
        ),
      ).toEqual({
        simpleInstallment: '625.00',
        installmentToIncome: '0.0962',
        totalCommitmentToIncome: '0.2808',
        amountInMonthsOfIncome: '2.31',
      });
      expect(res.body.disclaimer).toMatch(/não determinam aprovação ou reprovação/);
      expect(JSON.stringify(res.body)).not.toMatch(/score/i);
    });

    it('returns null ratios for zero declared income and hides drafts from analysts', async () => {
      const id = await draft({ declaredMonthlyIncome: '0' });
      await analyst.http.get(url(id, '/indicators')).expect(404);
      const res = await operator.http.get(url(id, '/indicators')).expect(200);
      expect(
        res.body.indicators.find((i: { key: string }) => i.key === 'installmentToIncome').value,
      ).toBeNull();
    });
  });

  describe('reviews (pareceres)', () => {
    it('are append-only, written by the assignee during review, latest is current', async () => {
      const id = await inReview();
      await operator.http.post(url(id, '/reviews'), REVIEW).expect(403);
      expect((await analyst2.http.post(url(id, '/reviews'), REVIEW).expect(403)).body.type).toBe(
        '/problems/not-assignee',
      );
      const short = await analyst.http
        .post(url(id, '/reviews'), { ...REVIEW, justification: 'curta' })
        .expect(400);
      expect(short.body.errors[0].field).toBe('justification');

      const first = await analyst.http.post(url(id, '/reviews'), REVIEW).expect(201);
      await new Promise((r) => setTimeout(r, 5));
      const second = await analyst.http
        .post(url(id, '/reviews'), { ...REVIEW, recommendation: 'REJECT' })
        .expect(201);

      const list = await operator.http.get(url(id, '/reviews')).expect(200);
      expect(list.body.map((r: { id: string; current: boolean }) => [r.id, r.current])).toEqual([
        [second.body.id, true],
        [first.body.id, false],
      ]);
      expect(await t.prisma.auditEvent.count({ where: { action: 'review.created' } })).toBe(2);
    });

    it('cannot be written outside the review', async () => {
      const id = await draft();
      await attachDocuments(t.prisma, id, operator.user.id);
      await operator.http.post(url(id, '/submit')).expect(200);
      const res = await analyst.http.post(url(id, '/reviews'), REVIEW).expect(409);
      expect(res.body.type).toBe('/problems/application-not-in-review');
    });
  });

  describe('POST /decision', () => {
    it('records the human decision, closes the application and audits everything', async () => {
      const id = await reviewed();
      const res = await analyst.http.post(url(id, '/decision'), APPROVE).expect(200);
      expect(res.body).toMatchObject({
        status: 'APPROVED',
        decidedAt: expect.any(String),
        closedAt: expect.any(String),
        availableActions: [],
      });

      const reviews = await analyst.http.get(url(id, '/reviews')).expect(200);
      const decision = await operator.http.get(url(id, '/decision')).expect(200);
      expect(decision.body).toMatchObject({
        outcome: 'APPROVED',
        justification: APPROVE.justification,
        decidedBy: { id: analyst.user.id },
        reviewId: reviews.body[0].id,
        reviewRecommendation: 'APPROVE',
      });

      const last = await t.prisma.applicationStatusHistory.findFirstOrThrow({
        where: { applicationId: id },
        orderBy: { createdAt: 'desc' },
      });
      expect(last).toMatchObject({
        fromStatus: 'UNDER_REVIEW',
        toStatus: 'APPROVED',
        actorId: analyst.user.id,
        reason: APPROVE.justification,
      });
      const recorded = await t.prisma.auditEvent.findFirstOrThrow({
        where: { action: 'decision.recorded' },
      });
      expect(recorded).toMatchObject({ actorId: analyst.user.id });
      expect(recorded.after).toMatchObject({ outcome: 'APPROVED', reviewId: reviews.body[0].id });
    });

    it('requires a review first', async () => {
      const id = await inReview();
      const res = await analyst.http.post(url(id, '/decision'), APPROVE).expect(422);
      expect(res.body.type).toBe('/problems/review-required');
    });

    it('refuses approval with open issues but allows rejection', async () => {
      const id = await reviewed();
      await analyst.http
        .post(url(id, '/issues'), { description: 'Comprovante de renda ilegivel' })
        .expect(201);
      const blocked = await analyst.http.post(url(id, '/decision'), APPROVE).expect(422);
      expect(blocked.body.type).toBe('/problems/open-issues');
      await analyst.http.post(url(id, '/decision'), REJECT).expect(200);
      expect((await operator.http.get(url(id, '/decision')).expect(200)).body.outcome).toBe(
        'REJECTED',
      );
    });

    it('requires a justification', async () => {
      const id = await reviewed();
      const res = await analyst.http
        .post(url(id, '/decision'), { outcome: 'APPROVED', justification: 'ok' })
        .expect(400);
      expect(res.body.errors[0].field).toBe('justification');
    });

    it('is reserved to analysts and operators with the explicit grant (never admins)', async () => {
      const id = await reviewed();
      await operator.http.post(url(id, '/decision'), APPROVE).expect(403);
      await admin.http.post(url(id, '/decision'), APPROVE).expect(403);
      await deciderOperator.http.post(url(id, '/decision'), APPROVE).expect(200);
      expect((await analyst.http.get(url(id, '/decision')).expect(200)).body.decidedBy.id).toBe(
        deciderOperator.user.id,
      );
    });

    it('happens only once, even under concurrency, and freezes the application', async () => {
      const id = await reviewed();
      const results = await Promise.all([
        analyst.http.post(url(id, '/decision'), APPROVE),
        analyst2.http.post(url(id, '/decision'), REJECT),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await t.prisma.creditDecision.count({ where: { applicationId: id } })).toBe(1);

      const again = await analyst.http.post(url(id, '/decision'), APPROVE).expect(409);
      expect(again.body.type).toBe('/problems/invalid-transition');
      await analyst.http.post(url(id, '/reviews'), REVIEW).expect(409);
      await analyst.http.post(url(id, '/issues'), { description: 'Depois da decisao' }).expect(409);
      await admin.http.post(url(id, '/cancel'), { reason: 'Tentativa apos decisao' }).expect(409);
    });

    it('answers 404 when there is no decision yet', async () => {
      const id = await reviewed();
      await analyst.http.get(url(id, '/decision')).expect(404);
    });
  });
});
