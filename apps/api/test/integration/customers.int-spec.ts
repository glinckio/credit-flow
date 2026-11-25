import { randomUUID } from 'node:crypto';
import { Role, cnpjCheckDigits, cpfCheckDigits, formatCpf } from '@creditflow/shared';
import { resetDatabase } from '../helpers/database.js';
import { type TestApp, client, createTestApp, dump, signedIn } from '../helpers/app.js';

// Synthetic identifiers built by the check-digit algorithm.
const CPF_A = cpfCheckDigits('123456789');
const CPF_B = cpfCheckDigits('987654321');
const CNPJ_A = cnpjCheckDigits('112223330001');

const individual = (overrides: Record<string, unknown> = {}) => ({
  type: 'INDIVIDUAL',
  name: 'Maria Sintetica da Silva',
  documentNumber: formatCpf(CPF_A),
  email: 'Maria.Sintetica@Exemplo.test',
  phone: '+55 11 90000-0001',
  birthOrFoundationDate: '1990-05-17',
  address: {
    street: 'Rua Ficticia',
    number: '100',
    complement: '',
    district: 'Centro',
    city: 'Cidade Demo',
    state: 'sp',
    zipCode: '01000-000',
  },
  ...overrides,
});

describe('customers (integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });
  afterAll(async () => {
    await t?.close();
  });

  describe('authorization (backend-enforced)', () => {
    it('lets operators and admins write, analysts only read', async () => {
      await client(t.app).get('/api/v1/customers').expect(401);

      const operator = await signedIn(t, Role.OPERATOR);
      const created = await operator.http.post('/api/v1/customers', individual()).expect(201);

      const analyst = await signedIn(t, Role.ANALYST);
      await analyst.http.get('/api/v1/customers').expect(200);
      await analyst.http.get(`/api/v1/customers/${created.body.id}`).expect(200);
      await analyst.http
        .post('/api/v1/customers', individual({ documentNumber: CPF_B }))
        .expect(403);
      await analyst.http
        .patch(`/api/v1/customers/${created.body.id}`, { version: 1, name: 'Outro Nome' })
        .expect(403);

      const admin = await signedIn(t, Role.ADMIN);
      await admin.http.post('/api/v1/customers', individual({ documentNumber: CPF_B })).expect(201);
    });
  });

  describe('POST /customers', () => {
    it('normalises input, stores digits only and audits without personal data', async () => {
      const { http, user } = await signedIn(t, Role.OPERATOR);
      const res = await http.post('/api/v1/customers', individual()).expect(201);

      expect(res.body).toMatchObject({
        type: 'INDIVIDUAL',
        documentNumber: CPF_A,
        email: 'maria.sintetica@exemplo.test',
        birthOrFoundationDate: '1990-05-17',
        address: { state: 'SP', zipCode: '01000000', complement: null },
        status: 'ACTIVE',
        version: 1,
        createdBy: { id: user.id, name: user.name },
      });

      const audit = await t.prisma.auditEvent.findFirstOrThrow({
        where: { action: 'customer.created' },
      });
      expect(audit).toMatchObject({ actorId: user.id, entityId: res.body.id });
      expect(audit.after).toEqual({ type: 'INDIVIDUAL', status: 'ACTIVE' });
      expect(dump(audit)).not.toMatch(new RegExp(`${CPF_A}|Maria|exemplo\\.test`));
    });

    it('accepts a company with a valid CNPJ and a recent foundation date', async () => {
      const { http } = await signedIn(t, Role.OPERATOR);
      await http
        .post(
          '/api/v1/customers',
          individual({
            type: 'COMPANY',
            name: 'Empresa Sintetica Ltda (Demo)',
            documentNumber: CNPJ_A,
            birthOrFoundationDate: '2025-01-10',
          }),
        )
        .expect(201);
    });

    it.each([
      ['invalid CPF check digits', { documentNumber: '12345678900' }, 'documentNumber'],
      ['CNPJ for an individual', { documentNumber: CNPJ_A }, 'documentNumber'],
      ['CPF for a company', { type: 'COMPANY', documentNumber: CPF_A }, 'documentNumber'],
      ['under 18', { birthOrFoundationDate: '2015-01-01' }, 'birthOrFoundationDate'],
      ['date in the future', { birthOrFoundationDate: '2999-01-01' }, 'birthOrFoundationDate'],
      ['impossible date', { birthOrFoundationDate: '2001-02-29' }, 'birthOrFoundationDate'],
      ['bad e-mail', { email: 'nao-e-email' }, 'email'],
      ['short phone', { phone: '1234' }, 'phone'],
      ['unknown UF', { address: { ...individual().address, state: 'XX' } }, 'address.state'],
      ['unknown field', { score: 999 }, 'score'],
    ])('rejects %s with a field error', async (_label, overrides, field) => {
      const { http } = await signedIn(t, Role.OPERATOR);
      const res = await http.post('/api/v1/customers', individual(overrides)).expect(400);
      expect(res.body.type).toBe('/problems/validation-error');
      expect(res.body.errors.map((e: { field: string }) => e.field)).toContain(field);
    });

    it('rejects a duplicate CPF and points to the existing customer', async () => {
      const { http } = await signedIn(t, Role.OPERATOR);
      const first = await http.post('/api/v1/customers', individual()).expect(201);
      const dup = await http
        .post('/api/v1/customers', individual({ documentNumber: CPF_A, name: 'Outra Pessoa' }))
        .expect(409);
      expect(dup.body).toMatchObject({
        type: '/problems/customer-document-already-exists',
        existingCustomerId: first.body.id,
      });
    });
  });

  describe('GET /customers', () => {
    it('paginates, filters by type/status and searches by name or document prefix', async () => {
      const { http } = await signedIn(t, Role.OPERATOR);
      const ana = await http
        .post('/api/v1/customers', individual({ name: 'Ana Sintetica' }))
        .expect(201);
      await http
        .post('/api/v1/customers', individual({ name: 'Bruno Sintetico', documentNumber: CPF_B }))
        .expect(201);
      await http
        .post(
          '/api/v1/customers',
          individual({
            type: 'COMPANY',
            name: 'Comercio Demo Ltda',
            documentNumber: CNPJ_A,
            birthOrFoundationDate: '2010-03-01',
          }),
        )
        .expect(201);
      await http
        .patch(`/api/v1/customers/${ana.body.id}`, { version: 1, status: 'INACTIVE' })
        .expect(200);

      const page1 = await http.get('/api/v1/customers?pageSize=2&sort=name:asc').expect(200);
      expect(page1.body.meta).toEqual({ page: 1, pageSize: 2, total: 3 });
      expect(page1.body.data.map((c: { name: string }) => c.name)).toEqual([
        'Ana Sintetica',
        'Bruno Sintetico',
      ]);

      const companies = await http.get('/api/v1/customers?type=COMPANY').expect(200);
      expect(companies.body.meta.total).toBe(1);

      const active = await http.get('/api/v1/customers?status=ACTIVE').expect(200);
      expect(active.body.meta.total).toBe(2);

      const byName = await http.get('/api/v1/customers?q=bruno').expect(200);
      expect(byName.body.data.map((c: { name: string }) => c.name)).toEqual(['Bruno Sintetico']);

      const byDoc = await http
        .get(`/api/v1/customers?q=${encodeURIComponent(formatCpf(CPF_B).slice(0, 7))}`)
        .expect(200);
      expect(byDoc.body.data.map((c: { name: string }) => c.name)).toEqual(['Bruno Sintetico']);

      await http.get('/api/v1/customers?sort=documentNumber:asc').expect(422);
    });

    it('answers 404 for malformed and unknown ids', async () => {
      const { http } = await signedIn(t, Role.ANALYST);
      await http.get('/api/v1/customers/123').expect(404);
      await http.get(`/api/v1/customers/${randomUUID()}`).expect(404);
    });
  });

  describe('PATCH /customers/:id', () => {
    it('applies optimistic locking and audits only the changed fields', async () => {
      const { http, user } = await signedIn(t, Role.OPERATOR);
      const created = await http.post('/api/v1/customers', individual()).expect(201);
      const url = `/api/v1/customers/${created.body.id}`;

      const updated = await http
        .patch(url, { version: 1, phone: '+55 11 90000-0099', name: 'Maria S. da Silva' })
        .expect(200);
      expect(updated.body).toMatchObject({ version: 2, phone: '+55 11 90000-0099' });

      // A second editor still holding version 1 loses.
      const stale = await http.patch(url, { version: 1, name: 'Edicao Atrasada' }).expect(409);
      expect(stale.body.type).toBe('/problems/version-conflict');
      expect((await http.get(url).expect(200)).body.name).toBe('Maria S. da Silva');

      const audit = await t.prisma.auditEvent.findFirstOrThrow({
        where: { action: 'customer.updated', entityId: created.body.id },
      });
      expect(audit.actorId).toBe(user.id);
      expect(audit.before).toEqual({
        name: 'Maria Sintetica da Silva',
        phone: '+55 11 90000-0001',
      });
      expect(audit.after).toEqual({ name: 'Maria S. da Silva', phone: '+55 11 90000-0099' });
    });

    it('keeps type and document number immutable', async () => {
      const { http } = await signedIn(t, Role.OPERATOR);
      const created = await http.post('/api/v1/customers', individual()).expect(201);
      const res = await http
        .patch(`/api/v1/customers/${created.body.id}`, { version: 1, documentNumber: CPF_B })
        .expect(400);
      expect(res.body.errors[0].field).toBe('documentNumber');
      await http
        .patch(`/api/v1/customers/${created.body.id}`, { version: 1, type: 'COMPANY' })
        .expect(400);
    });

    it('validates the birth date against the stored customer type', async () => {
      const { http } = await signedIn(t, Role.OPERATOR);
      const created = await http.post('/api/v1/customers', individual()).expect(201);
      const res = await http
        .patch(`/api/v1/customers/${created.body.id}`, {
          version: 1,
          birthOrFoundationDate: '2020-01-01',
        })
        .expect(400);
      expect(res.body.errors[0]).toMatchObject({ field: 'birthOrFoundationDate' });
    });

    it('requires the version and does not bump it when nothing changes', async () => {
      const { http } = await signedIn(t, Role.OPERATOR);
      const created = await http.post('/api/v1/customers', individual()).expect(201);
      const url = `/api/v1/customers/${created.body.id}`;
      await http.patch(url, { name: 'Sem Versao' }).expect(400);
      expect((await http.patch(url, { version: 1 }).expect(200)).body.version).toBe(1);
      await http.patch(url, { version: 7 }).expect(409);
    });
  });
});
