import { Role } from '@creditflow/shared';
import { resetDatabase } from '../helpers/database.js';
import { type TestApp, client, createTestApp, signedIn } from '../helpers/app.js';
import { createCustomer } from '../helpers/fixtures.js';

type Signed = Awaited<ReturnType<typeof signedIn>>;

const T0 = new Date('2026-10-01T09:00:00.000Z');
const h = (hours: number) => new Date(T0.getTime() + hours * 3_600_000);

describe('dashboard and audit query (integration)', () => {
  let t: TestApp;
  let operator: Signed;
  let analyst: Signed;
  let admin: Signed;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    operator = await signedIn(t, Role.OPERATOR);
    analyst = await signedIn(t, Role.ANALYST);
    admin = await signedIn(t, Role.ADMIN);
  });
  afterAll(async () => {
    await t?.close();
  });

  /** Inserts an application directly with controlled status and timestamps. */
  async function insert(
    customerId: string,
    status: string,
    times: { submitted?: number; decided?: number } = {},
    extra: { assigneeId?: string; openIssue?: boolean } = {},
  ) {
    const app = await t.prisma.creditApplication.create({
      data: {
        customerId,
        productType: 'PERSONAL_LOAN',
        requestedAmount: '10000.00',
        termMonths: 12,
        purpose: 'Teste de metricas',
        declaredMonthlyIncome: '5000.00',
        status: status as never,
        createdById: operator.user.id,
        createdAt: T0,
        submittedAt: times.submitted === undefined ? null : h(times.submitted),
        decidedAt: times.decided === undefined ? null : h(times.decided),
        assigneeId: extra.assigneeId ?? null,
      },
    });
    if (extra.openIssue) {
      await t.prisma.applicationIssue.create({
        data: { applicationId: app.id, description: 'Pendencia', createdById: analyst.user.id },
      });
    }
    return app;
  }

  describe('GET /dashboard/metrics', () => {
    it('reports zeros and "insufficient data" on an empty database', async () => {
      const res = await operator.http.get('/api/v1/dashboard/metrics').expect(200);
      expect(res.body).toMatchObject({
        total: 0,
        approved: 0,
        rejected: 0,
        openToDecision: { averageHours: null, sampleSize: 0 },
        submissionToDecision: { averageHours: null, sampleSize: 0 },
      });
    });

    it('computes every indicator from the database', async () => {
      const c = (await createCustomer(t.prisma, operator.user.id)).id;
      await insert(c, 'DRAFT');
      await insert(c, 'DRAFT');
      await insert(c, 'SUBMITTED', { submitted: 1 });
      await insert(c, 'UNDER_REVIEW', { submitted: 1 }, { assigneeId: analyst.user.id });
      await insert(c, 'UNDER_REVIEW', { submitted: 1 }, { openIssue: true });
      await insert(
        c,
        'PENDING_INFORMATION',
        { submitted: 1 },
        { assigneeId: analyst.user.id, openIssue: true },
      );
      await insert(c, 'APPROVED', { submitted: 2, decided: 10 }); // open→decision 10h, submit→decision 8h
      await insert(c, 'REJECTED', { submitted: 4, decided: 24 }); // 24h, 20h
      await insert(c, 'CANCELLED');

      const op = await operator.http.get('/api/v1/dashboard/metrics').expect(200);
      expect(op.body).toMatchObject({
        total: 9,
        byStatus: {
          DRAFT: 2,
          SUBMITTED: 1,
          UNDER_REVIEW: 2,
          PENDING_INFORMATION: 1,
          APPROVED: 1,
          REJECTED: 1,
          CANCELLED: 1,
        },
        awaitingReview: 1,
        underReview: 2,
        pendingInformation: 1,
        withOpenIssues: 2,
        approved: 1,
        rejected: 1,
        assignedToMe: null,
        openToDecision: { averageHours: 17, sampleSize: 2 }, // (10 + 24) / 2
        submissionToDecision: { averageHours: 14, sampleSize: 2 }, // (8 + 20) / 2
      });
      expect(op.body.openToDecision.definition).toMatch(/decisão/);

      // Analysts do not see drafts; they get their own workload.
      const an = await analyst.http.get('/api/v1/dashboard/metrics').expect(200);
      expect(an.body).toMatchObject({ total: 7, byStatus: { DRAFT: 0 }, assignedToMe: 2 });
    });

    it('reflects changes immediately (no cached numbers)', async () => {
      const c = (await createCustomer(t.prisma, operator.user.id)).id;
      await insert(c, 'SUBMITTED', { submitted: 1 });
      expect((await admin.http.get('/api/v1/dashboard/metrics').expect(200)).body.total).toBe(1);
      await insert(c, 'APPROVED', { submitted: 1, decided: 3 });
      const res = await admin.http.get('/api/v1/dashboard/metrics').expect(200);
      expect(res.body).toMatchObject({
        total: 2,
        approved: 1,
        submissionToDecision: { averageHours: 2, sampleSize: 1 },
      });
    });

    it('requires authentication', async () => {
      await client(t.app).get('/api/v1/dashboard/metrics').expect(401);
    });
  });

  describe('GET /audit-events', () => {
    it('is restricted to administrators', async () => {
      await operator.http.get('/api/v1/audit-events').expect(403);
      await analyst.http.get('/api/v1/audit-events').expect(403);
      await client(t.app).get('/api/v1/audit-events').expect(401);
    });

    it('lists events newest first with actor, before/after and string ids', async () => {
      const created = await operator.http
        .post('/api/v1/customers', {
          type: 'INDIVIDUAL',
          name: 'Cliente Auditado Sintetico',
          documentNumber: '12345678909',
          email: 'auditado@exemplo.test',
          phone: '+55 11 90000-0001',
          birthOrFoundationDate: '1990-01-01',
          address: {
            street: 'Rua Ficticia',
            number: '1',
            district: 'Centro',
            city: 'Cidade Demo',
            state: 'SP',
            zipCode: '01000000',
          },
        })
        .expect(201);
      await operator.http
        .patch(`/api/v1/customers/${created.body.id}`, { version: 1, name: 'Cliente Renomeado' })
        .expect(200);

      const res = await admin.http
        .get(`/api/v1/audit-events?entityType=Customer&entityId=${created.body.id}`)
        .expect(200);
      expect(res.body.meta.total).toBe(2);
      expect(res.body.data.map((e: { action: string }) => e.action)).toEqual([
        'customer.updated',
        'customer.created',
      ]);
      expect(res.body.data[0]).toMatchObject({
        id: expect.stringMatching(/^\d+$/),
        actor: { id: operator.user.id, email: operator.user.email },
        before: { name: 'Cliente Auditado Sintetico' },
        after: { name: 'Cliente Renomeado' },
        metadata: { requestId: expect.any(String) },
      });

      const asc = await admin.http
        .get(`/api/v1/audit-events?entityId=${created.body.id}&sort=occurredAt:asc`)
        .expect(200);
      expect(asc.body.data[0].action).toBe('customer.created');
    });

    it('filters by exact action, action prefix, actor and period', async () => {
      // Each signedIn() above produced one auth.login_succeeded.
      const exact = await admin.http
        .get('/api/v1/audit-events?action=auth.login_succeeded')
        .expect(200);
      expect(exact.body.meta.total).toBe(3);

      await client(t.app)
        .post('/api/v1/auth/login', { email: operator.user.email, password: 'senha-errada-000' })
        .expect(401);
      const prefix = await admin.http.get('/api/v1/audit-events?action=auth.').expect(200);
      expect(prefix.body.meta.total).toBe(4);

      const byActor = await admin.http
        .get(`/api/v1/audit-events?actorId=${analyst.user.id}`)
        .expect(200);
      expect(
        byActor.body.data.every((e: { actor: { id: string } }) => e.actor.id === analyst.user.id),
      ).toBe(true);

      const future = new Date(Date.now() + 86_400_000).toISOString();
      expect(
        (await admin.http.get(`/api/v1/audit-events?from=${future}`).expect(200)).body.meta.total,
      ).toBe(0);
      const past = new Date(Date.now() - 86_400_000).toISOString();
      expect(
        (await admin.http.get(`/api/v1/audit-events?from=${past}&to=${future}`).expect(200)).body
          .meta.total,
      ).toBeGreaterThanOrEqual(4);

      await admin.http.get(`/api/v1/audit-events?from=${future}&to=${past}`).expect(400);
      await admin.http.get('/api/v1/audit-events?from=ontem').expect(400);
      await admin.http.get('/api/v1/audit-events?entityType=Session').expect(400);
      await admin.http.get('/api/v1/audit-events?sort=action:asc').expect(422);
    });

    it('paginates', async () => {
      const res = await admin.http.get('/api/v1/audit-events?pageSize=2&page=2').expect(200);
      expect(res.body.meta).toEqual({ page: 2, pageSize: 2, total: 3 });
      expect(res.body.data).toHaveLength(1);
    });
  });
});
