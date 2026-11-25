import { randomUUID } from 'node:crypto';
import { Role } from '@creditflow/shared';
import { resetDatabase } from '../helpers/database.js';
import { type TestApp, createTestApp, signedIn } from '../helpers/app.js';
import { applicationBody, attachDocuments, createCustomer } from '../helpers/fixtures.js';

type Signed = Awaited<ReturnType<typeof signedIn>>;

describe('credit applications (integration)', () => {
  let t: TestApp;
  let operator: Signed;
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
    return res.body as { id: string; version: number };
  }

  async function submitted() {
    const app = await draft();
    await attachDocuments(t.prisma, app.id, operator.user.id);
    await operator.http.post(url(app.id, '/submit')).expect(200);
    return app;
  }

  async function underReview(by: Signed = analyst) {
    const app = await submitted();
    await by.http.post(url(app.id, '/start-review')).expect(200);
    return app;
  }

  async function history(id: string) {
    const res = await operator.http.get(url(id, '/status-history')).expect(200);
    return res.body.map(
      (h: { fromStatus: string | null; toStatus: string }) =>
        `${h.fromStatus ?? '∅'}→${h.toStatus}`,
    );
  }

  describe('create and edit', () => {
    it('creates a DRAFT with money as strings, a derived code, history and audit', async () => {
      const res = await operator.http
        .post('/api/v1/applications', applicationBody(customerId, { requestedAmount: 15000.5 }))
        .expect(201);
      expect(res.body).toMatchObject({
        number: 1,
        code: expect.stringMatching(/^CF-\d{4}-000001$/),
        status: 'DRAFT',
        requestedAmount: '15000.50',
        declaredMonthlyCommitments: '1200.50',
        customer: { id: customerId },
        assignee: null,
        createdBy: { id: operator.user.id },
        documentCount: 0,
        openIssueCount: 0,
        availableActions: ['submit', 'cancel'],
        version: 1,
      });
      expect(await history(res.body.id)).toEqual(['∅→DRAFT']);
      const audit = await t.prisma.auditEvent.findFirstOrThrow({
        where: { action: 'application.created' },
      });
      expect(audit.after).toMatchObject({ status: 'DRAFT', requestedAmount: '15000.50' });
    });

    it.each([
      ['zero amount', { requestedAmount: '0' }, 'requestedAmount'],
      ['three decimals', { requestedAmount: '10.123' }, 'requestedAmount'],
      ['negative income', { declaredMonthlyIncome: '-1' }, 'declaredMonthlyIncome'],
      ['term 0', { termMonths: 0 }, 'termMonths'],
      ['term 361', { termMonths: 361 }, 'termMonths'],
      ['unknown product', { productType: 'CRYPTO' }, 'productType'],
      ['unknown field', { status: 'APPROVED' }, 'status'],
    ])('rejects %s', async (_l, overrides, field) => {
      const res = await operator.http
        .post('/api/v1/applications', applicationBody(customerId, overrides))
        .expect(400);
      expect(res.body.errors.map((e: { field: string }) => e.field)).toContain(field);
    });

    it('refuses inactive or unknown customers', async () => {
      const inactive = await createCustomer(t.prisma, operator.user.id, { status: 'INACTIVE' });
      const res = await operator.http
        .post('/api/v1/applications', applicationBody(inactive.id))
        .expect(422);
      expect(res.body.type).toBe('/problems/customer-inactive');
      await operator.http.post('/api/v1/applications', applicationBody(randomUUID())).expect(404);
    });

    it('is not available to analysts', async () => {
      await analyst.http.post('/api/v1/applications', applicationBody(customerId)).expect(403);
    });

    it('edits only DRAFT/PENDING_INFORMATION, with optimistic locking', async () => {
      const app = await draft();
      const edited = await operator.http
        .patch(url(app.id), { version: 1, termMonths: 36, requestedAmount: '20000' })
        .expect(200);
      expect(edited.body).toMatchObject({
        version: 2,
        termMonths: 36,
        requestedAmount: '20000.00',
      });

      expect(
        (await operator.http.patch(url(app.id), { version: 1, termMonths: 12 }).expect(409)).body
          .type,
      ).toBe('/problems/version-conflict');
      await operator.http.patch(url(app.id), { version: 2, customerId }).expect(400);

      const audit = await t.prisma.auditEvent.findFirstOrThrow({
        where: { action: 'application.updated' },
      });
      expect(audit.before).toEqual({ requestedAmount: '15000.00', termMonths: 24 });
      expect(audit.after).toEqual({ requestedAmount: '20000.00', termMonths: 36 });

      await attachDocuments(t.prisma, app.id, operator.user.id);
      await operator.http.post(url(app.id, '/submit')).expect(200);
      const locked = await operator.http
        .patch(url(app.id), { version: 3, termMonths: 12 })
        .expect(409);
      expect(locked.body).toMatchObject({
        type: '/problems/application-not-editable',
        currentStatus: 'SUBMITTED',
      });
    });
  });

  describe('visibility', () => {
    it('hides drafts from analysts (404), shows them to operators', async () => {
      const d = await draft();
      const s = await submitted();
      await analyst.http.get(url(d.id)).expect(404);
      await analyst.http.get(url(d.id, '/status-history')).expect(404);
      const list = await analyst.http.get('/api/v1/applications').expect(200);
      expect(list.body.data.map((a: { id: string }) => a.id)).toEqual([s.id]);
      expect((await operator.http.get('/api/v1/applications').expect(200)).body.meta.total).toBe(2);
    });
  });

  describe('submit', () => {
    it('requires identification and proof of income', async () => {
      const app = await draft();
      await attachDocuments(t.prisma, app.id, operator.user.id, ['IDENTIFICATION']);
      const res = await operator.http.post(url(app.id, '/submit')).expect(422);
      expect(res.body).toMatchObject({
        type: '/problems/missing-required-documents',
        missingDocumentTypes: ['PROOF_OF_INCOME'],
      });

      await attachDocuments(t.prisma, app.id, operator.user.id, ['PROOF_OF_INCOME']);
      const ok = await operator.http.post(url(app.id, '/submit')).expect(200);
      expect(ok.body).toMatchObject({ status: 'SUBMITTED', submittedAt: expect.any(String) });
    });

    it('ignores logically removed documents', async () => {
      const app = await draft();
      await attachDocuments(t.prisma, app.id, operator.user.id);
      await t.prisma.creditDocument.updateMany({
        where: { applicationId: app.id, type: 'PROOF_OF_INCOME' },
        data: { deletedAt: new Date() },
      });
      await operator.http.post(url(app.id, '/submit')).expect(422);
    });
  });

  describe('review flow', () => {
    it('runs submit → review → pending information → resume with issues and audit', async () => {
      const app = await underReview();
      const detail = await analyst.http.get(url(app.id)).expect(200);
      expect(detail.body).toMatchObject({
        status: 'UNDER_REVIEW',
        assignee: { id: analyst.user.id },
        availableActions: ['release', 'request-information', 'approve', 'reject'],
      });

      // Without an open issue the application cannot go back to the operator.
      expect(
        (await analyst.http.post(url(app.id, '/request-information')).expect(422)).body.type,
      ).toBe('/problems/no-open-issues');

      // Only the assignee manages issues.
      const notMine = await analyst2.http
        .post(url(app.id, '/issues'), { description: 'Enviar extrato bancario' })
        .expect(403);
      expect(notMine.body.type).toBe('/problems/not-assignee');

      const issue = await analyst.http
        .post(url(app.id, '/issues'), { description: 'Enviar extrato bancario' })
        .expect(201);
      expect(issue.body).toMatchObject({ status: 'OPEN', createdBy: { id: analyst.user.id } });

      const pending = await analyst.http
        .post(url(app.id, '/request-information'), { reason: 'Falta extrato' })
        .expect(200);
      expect(pending.body).toMatchObject({ status: 'PENDING_INFORMATION', openIssueCount: 1 });

      // Operator can see the issue, edit the declared data and send it back.
      const issues = await operator.http.get(url(app.id, '/issues?status=OPEN')).expect(200);
      expect(issues.body).toHaveLength(1);
      await operator.http
        .patch(url(app.id), { version: pending.body.version, declaredMonthlyIncome: '7000.00' })
        .expect(200);
      const resumed = await operator.http.post(url(app.id, '/resume')).expect(200);
      expect(resumed.body).toMatchObject({
        status: 'UNDER_REVIEW',
        assignee: { id: analyst.user.id },
      });

      const resolved = await analyst.http
        .post(`/api/v1/issues/${issue.body.id}/resolve`, { resolutionNote: 'Extrato conferido' })
        .expect(200);
      expect(resolved.body).toMatchObject({
        status: 'RESOLVED',
        resolvedBy: { id: analyst.user.id },
      });
      expect(
        (
          await analyst.http
            .post(`/api/v1/issues/${issue.body.id}/resolve`, { resolutionNote: 'De novo' })
            .expect(409)
        ).body.type,
      ).toBe('/problems/issue-already-resolved');

      expect(await history(app.id)).toEqual([
        '∅→DRAFT',
        'DRAFT→SUBMITTED',
        'SUBMITTED→UNDER_REVIEW',
        'UNDER_REVIEW→PENDING_INFORMATION',
        'PENDING_INFORMATION→UNDER_REVIEW',
      ]);
      const actions = (
        await t.prisma.auditEvent.findMany({ orderBy: { id: 'asc' }, select: { action: true } })
      ).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'application.status_changed',
          'application.assigned',
          'issue.created',
          'issue.resolved',
          'application.updated',
        ]),
      );
    });

    it('rejects transitions that do not apply or are not permitted', async () => {
      const d = await draft();
      const res = await operator.http.post(url(d.id, '/resume')).expect(409);
      expect(res.body).toMatchObject({
        type: '/problems/invalid-transition',
        currentStatus: 'DRAFT',
      });

      const s = await submitted();
      await operator.http.post(url(s.id, '/start-review')).expect(403);
      await analyst.http.post(url(s.id, '/submit')).expect(403);
      await analyst.http.post(url(s.id, '/cancel'), { reason: 'x' }).expect(403);
      await analyst.http.post(url(s.id, '/issues'), { description: 'Pendencia antes' }).expect(409);
    });

    it('lets only one of two concurrent reviewers take the application', async () => {
      const app = await submitted();
      const results = await Promise.all([
        analyst.http.post(url(app.id, '/start-review')),
        analyst2.http.post(url(app.id, '/start-review')),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await history(app.id)).toEqual([
        '∅→DRAFT',
        'DRAFT→SUBMITTED',
        'SUBMITTED→UNDER_REVIEW',
      ]);
      const winner = results.find((r) => r.status === 200)!;
      const stored = await t.prisma.creditApplication.findUniqueOrThrow({ where: { id: app.id } });
      expect(stored.assigneeId).toBe(winner.body.assignee.id);
    });
  });

  describe('assignment', () => {
    it('admin assigns and re-assigns analysts; release returns to the queue', async () => {
      const app = await submitted();
      const assigned = await admin.http
        .post(url(app.id, '/assign'), { assigneeId: analyst.user.id })
        .expect(200);
      expect(assigned.body).toMatchObject({
        status: 'UNDER_REVIEW',
        assignee: { id: analyst.user.id },
      });

      expect(
        (
          await admin.http
            .post(url(app.id, '/assign'), { assigneeId: operator.user.id })
            .expect(422)
        ).body.type,
      ).toBe('/problems/invalid-assignee');

      // Re-assignment keeps the status and adds no history row, only an audit event.
      await admin.http.post(url(app.id, '/assign'), { assigneeId: analyst2.user.id }).expect(200);
      expect(await history(app.id)).toHaveLength(3);
      const assignments = await t.prisma.auditEvent.findMany({
        where: { action: 'application.assigned', entityId: app.id },
        orderBy: { id: 'asc' },
      });
      expect(assignments.at(-1)).toMatchObject({
        before: { assigneeId: analyst.user.id },
        after: { assigneeId: analyst2.user.id },
      });

      await analyst.http.post(url(app.id, '/release')).expect(403);
      const released = await analyst2.http.post(url(app.id, '/release')).expect(200);
      expect(released.body).toMatchObject({ status: 'SUBMITTED', assignee: null });
      await operator.http.post(url(app.id, '/assign'), { assigneeId: analyst.user.id }).expect(403);
    });
  });

  describe('cancel and reopen', () => {
    it('requires a reason; operators cannot cancel during review; only admins reopen', async () => {
      const d = await draft();
      const noReason = await operator.http.post(url(d.id, '/cancel')).expect(400);
      expect(noReason.body.errors[0].field).toBe('reason');
      const cancelled = await operator.http
        .post(url(d.id, '/cancel'), { reason: 'Cliente desistiu' })
        .expect(200);
      expect(cancelled.body).toMatchObject({ status: 'CANCELLED', closedAt: expect.any(String) });

      const r = await underReview();
      await operator.http.post(url(r.id, '/cancel'), { reason: 'Tentativa' }).expect(403);
      await admin.http.post(url(r.id, '/cancel'), { reason: 'Duplicada' }).expect(200);

      await operator.http.post(url(r.id, '/reopen'), { reason: 'Engano' }).expect(403);
      await admin.http.post(url(r.id, '/reopen')).expect(400);
      const reopened = await admin.http
        .post(url(r.id, '/reopen'), { reason: 'Cancelada por engano' })
        .expect(200);
      expect(reopened.body).toMatchObject({ status: 'SUBMITTED', assignee: null, closedAt: null });

      const rows = await t.prisma.applicationStatusHistory.findMany({
        where: { applicationId: r.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.at(-1)).toMatchObject({
        fromStatus: 'CANCELLED',
        toStatus: 'SUBMITTED',
        actorId: admin.user.id,
        reason: 'Cancelada por engano',
      });
    });
  });

  describe('listing', () => {
    it('filters by status list, assignee and code, and sorts', async () => {
      const a = await underReview();
      const b = await submitted();
      await draft({ requestedAmount: '99000.00' });

      const queue = await analyst.http
        .get('/api/v1/applications?status=SUBMITTED,UNDER_REVIEW&sort=number:asc')
        .expect(200);
      expect(queue.body.data.map((x: { id: string }) => x.id)).toEqual([a.id, b.id]);

      const mine = await analyst.http.get('/api/v1/applications?assigneeId=me').expect(200);
      expect(mine.body.data.map((x: { id: string }) => x.id)).toEqual([a.id]);
      const unassigned = await analyst.http.get('/api/v1/applications?assigneeId=none').expect(200);
      expect(unassigned.body.data.map((x: { id: string }) => x.id)).toEqual([b.id]);

      const byCode = await operator.http.get('/api/v1/applications?q=CF-2026-000002').expect(200);
      expect(byCode.body.data.map((x: { id: string }) => x.id)).toEqual([b.id]);

      const byAmount = await operator.http
        .get('/api/v1/applications?sort=requestedAmount:desc&pageSize=1')
        .expect(200);
      expect(byAmount.body.data[0].requestedAmount).toBe('99000.00');

      await operator.http.get('/api/v1/applications?status=FOO').expect(400);
    });
  });
});
