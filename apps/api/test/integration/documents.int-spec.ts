import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { Role } from '@creditflow/shared';
import { buildSyntheticPdf } from '../../prisma/seed/synthetic.js';
import { MAX_DOCUMENT_BYTES } from '../../src/modules/documents/file-type.js';
import { REPO_ROOT } from '../../src/infra/storage/storage.module.js';
import { resetDatabase } from '../helpers/database.js';
import { type TestApp, createTestApp, dump, signedIn } from '../helpers/app.js';
import { applicationBody, createCustomer } from '../helpers/fixtures.js';
import { TEST_STORAGE_DIR } from '../load-test-env.js';

type Signed = Awaited<ReturnType<typeof signedIn>>;

const PDF = buildSyntheticPdf(['DOCUMENTO SINTETICO', 'Comprovante de renda (demo)']);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('synthetic-png-body'),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('synthetic')]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0x90)]);
const HTML = Buffer.from('<html><script>alert("xss")</script></html>');

const storageRoot = resolve(REPO_ROOT, TEST_STORAGE_DIR);

describe('documents (integration)', () => {
  let t: TestApp;
  let operator: Signed;
  let analyst: Signed;
  let analyst2: Signed;
  let customerId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    operator = await signedIn(t, Role.OPERATOR);
    analyst = await signedIn(t, Role.ANALYST);
    analyst2 = await signedIn(t, Role.ANALYST);
    customerId = (await createCustomer(t.prisma, operator.user.id)).id;
  });
  afterAll(async () => {
    await t?.close();
  });

  function upload(
    who: Signed,
    applicationId: string,
    file: { data: Buffer; filename: string; contentType?: string },
    fields: Record<string, string> = { type: 'IDENTIFICATION' },
  ) {
    let req = request(t.app.getHttpServer())
      .post(`/api/v1/applications/${applicationId}/documents`)
      .set('Cookie', who.cookie)
      .set('X-Requested-With', 'XMLHttpRequest');
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('file', file.data, {
      filename: file.filename,
      contentType: file.contentType ?? 'application/pdf',
    });
  }

  async function draft() {
    const res = await operator.http
      .post('/api/v1/applications', applicationBody(customerId))
      .expect(201);
    return res.body.id as string;
  }

  /** Draft with the two required documents, submitted and taken by `analyst`. */
  async function inReview() {
    const id = await draft();
    await upload(operator, id, { data: PDF, filename: 'rg.pdf' }).expect(201);
    await upload(
      operator,
      id,
      { data: JPEG, filename: 'renda.jpg', contentType: 'image/jpeg' },
      { type: 'PROOF_OF_INCOME' },
    ).expect(201);
    await operator.http.post(`/api/v1/applications/${id}/submit`).expect(200);
    await analyst.http.post(`/api/v1/applications/${id}/start-review`).expect(200);
    return id;
  }

  describe('upload', () => {
    it('stores a PDF under an opaque key outside any public folder and audits metadata only', async () => {
      const id = await draft();
      const res = await upload(operator, id, {
        data: PDF,
        filename: 'Comprovante de renda – março.pdf',
        contentType: 'application/octet-stream', // the browser's claim is ignored
      })
        .field('ignored', 'x')
        .expect(400); // unknown multipart field is rejected like any unknown property
      expect(res.body.errors[0].field).toBe('ignored');

      const ok = await upload(operator, id, {
        data: PDF,
        filename: 'Comprovante de renda – março.pdf',
        contentType: 'application/octet-stream',
      }).expect(201);
      expect(ok.body).toMatchObject({
        applicationId: id,
        type: 'IDENTIFICATION',
        originalName: 'Comprovante de renda – março.pdf',
        mimeType: 'application/pdf',
        sizeBytes: PDF.length,
        sha256: createHash('sha256').update(PDF).digest('hex'),
        validationStatus: 'PENDING',
        uploadedBy: { id: operator.user.id },
      });

      const row = await t.prisma.creditDocument.findUniqueOrThrow({ where: { id: ok.body.id } });
      expect(row.storageKey).toMatch(/^documents\/[0-9a-f-]{36}$/);
      expect(existsSync(resolve(storageRoot, row.storageKey))).toBe(true);
      expect(storageRoot.startsWith(resolve(REPO_ROOT, 'var'))).toBe(true);

      const audit = await t.prisma.auditEvent.findFirstOrThrow({
        where: { action: 'document.uploaded' },
      });
      expect(audit.after).toMatchObject({ mimeType: 'application/pdf', sizeBytes: PDF.length });
      expect(dump(audit)).not.toContain('Comprovante');
    });

    it('accepts PNG and JPEG by content', async () => {
      const id = await draft();
      await upload(operator, id, {
        data: PNG,
        filename: 'rg.PNG',
        contentType: 'image/png',
      }).expect(201);
      const jpeg = await upload(operator, id, {
        data: JPEG,
        filename: 'rg.jpeg',
        contentType: 'image/jpeg',
      }).expect(201);
      expect(jpeg.body.mimeType).toBe('image/jpeg');
    });

    it.each([
      ['an executable renamed to .pdf', EXE, 'contrato.pdf', 415, 'unsupported-file-type'],
      ['HTML with script', HTML, 'pagina.pdf', 415, 'unsupported-file-type'],
      ['a PDF named .png', PDF, 'foto.png', 415, 'file-extension-mismatch'],
      ['a PDF without extension', PDF, 'documento', 415, 'file-extension-mismatch'],
      ['an empty file', Buffer.alloc(0), 'vazio.pdf', 400, 'empty-file'],
    ])('rejects %s', async (_label, data, filename, status, type) => {
      const id = await draft();
      const res = await upload(operator, id, { data, filename }).expect(status);
      expect(res.body.type).toBe(`/problems/${type}`);
      expect(await t.prisma.creditDocument.count()).toBe(0);
    });

    it('rejects files over 10 MB before storing anything', async () => {
      const id = await draft();
      const before = existsSync(resolve(storageRoot, 'documents'))
        ? readdirSync(resolve(storageRoot, 'documents')).length
        : 0;
      const big = Buffer.concat([PDF, Buffer.alloc(MAX_DOCUMENT_BYTES)]);
      const res = await upload(operator, id, { data: big, filename: 'grande.pdf' }).expect(413);
      expect(res.body.type).toBe('/problems/payload-too-large');
      const after = existsSync(resolve(storageRoot, 'documents'))
        ? readdirSync(resolve(storageRoot, 'documents')).length
        : 0;
      expect(after).toBe(before);
    });

    it('keeps only the base name of a path-like original name', async () => {
      const id = await draft();
      const res = await upload(operator, id, {
        data: PDF,
        filename: '../../../etc/passwd.pdf',
      }).expect(201);
      expect(res.body.originalName).toBe('passwd.pdf');
    });

    it('requires the file part and a description for OTHER', async () => {
      const id = await draft();
      const noFile = await request(t.app.getHttpServer())
        .post(`/api/v1/applications/${id}/documents`)
        .set('Cookie', operator.cookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .field('type', 'IDENTIFICATION')
        .expect(400);
      expect(noFile.body.type).toBe('/problems/file-required');

      const other = await upload(
        operator,
        id,
        { data: PDF, filename: 'x.pdf' },
        { type: 'OTHER' },
      ).expect(400);
      expect(other.body.errors[0].field).toBe('otherDescription');
      await upload(
        operator,
        id,
        { data: PDF, filename: 'x.pdf' },
        { type: 'OTHER', otherDescription: 'Contrato social' },
      ).expect(201);
    });

    it('is enforced by role and application status', async () => {
      const id = await inReview();
      await upload(analyst, id, { data: PDF, filename: 'x.pdf' }).expect(403);
      const res = await upload(operator, id, { data: PDF, filename: 'x.pdf' }).expect(409);
      expect(res.body).toMatchObject({
        type: '/problems/application-not-editable',
        currentStatus: 'UNDER_REVIEW',
      });
      await upload(operator, randomUUID(), { data: PDF, filename: 'x.pdf' }).expect(404);
    });

    it('lets the operator complement documents while information is pending', async () => {
      const id = await inReview();
      await analyst.http
        .post(`/api/v1/applications/${id}/issues`, { description: 'Enviar extrato bancario' })
        .expect(201);
      await analyst.http.post(`/api/v1/applications/${id}/request-information`).expect(200);
      await upload(
        operator,
        id,
        { data: PDF, filename: 'extrato.pdf' },
        { type: 'BANK_STATEMENT' },
      ).expect(201);
    });
  });

  describe('download', () => {
    it('streams the exact bytes as an attachment with protective headers and audits the access', async () => {
      const id = await draft();
      const doc = await upload(operator, id, { data: PDF, filename: 'Renda março.pdf' }).expect(
        201,
      );

      const res = await operator.http
        .get(`/api/v1/documents/${doc.body.id}/content`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(Buffer.compare(res.body as Buffer, PDF)).toBe(0);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="Renda mar_o.pdf"; filename*=UTF-8''Renda%20mar%C3%A7o.pdf`,
      );
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['content-security-policy']).toContain('sandbox');

      expect(
        await t.prisma.auditEvent.count({
          where: {
            action: 'document.downloaded',
            entityId: doc.body.id,
            actorId: operator.user.id,
          },
        }),
      ).toBe(1);
    });

    it('hides documents of drafts from analysts and answers 404 for unknown ids', async () => {
      const id = await draft();
      const doc = await upload(operator, id, { data: PDF, filename: 'rg.pdf' }).expect(201);
      await analyst.http.get(`/api/v1/documents/${doc.body.id}/content`).expect(404);
      await analyst.http.get(`/api/v1/applications/${id}/documents`).expect(404);
      await operator.http.get(`/api/v1/documents/${randomUUID()}/content`).expect(404);
      await operator.http.get('/api/v1/documents/../../etc/passwd/content').expect(404);
    });

    it('requires authentication', async () => {
      const id = await draft();
      const doc = await upload(operator, id, { data: PDF, filename: 'rg.pdf' }).expect(201);
      await request(t.app.getHttpServer())
        .get(`/api/v1/documents/${doc.body.id}/content`)
        .expect(401);
    });
  });

  describe('manual validation', () => {
    it('is done by the assigned analyst during review; rejection needs notes', async () => {
      const id = await inReview();
      const docs = await analyst.http.get(`/api/v1/applications/${id}/documents`).expect(200);
      const docId = docs.body[0].id as string;
      const vurl = `/api/v1/documents/${docId}/validation`;

      await operator.http.patch(vurl, { status: 'ACCEPTED' }).expect(403);
      expect((await analyst2.http.patch(vurl, { status: 'ACCEPTED' }).expect(403)).body.type).toBe(
        '/problems/not-assignee',
      );
      const noNotes = await analyst.http.patch(vurl, { status: 'REJECTED' }).expect(400);
      expect(noNotes.body.errors[0].field).toBe('notes');

      const rejected = await analyst.http
        .patch(vurl, { status: 'REJECTED', notes: 'Documento ilegivel' })
        .expect(200);
      expect(rejected.body).toMatchObject({
        validationStatus: 'REJECTED',
        validationNotes: 'Documento ilegivel',
        validatedBy: { id: analyst.user.id },
      });
      const accepted = await analyst.http.patch(vurl, { status: 'ACCEPTED' }).expect(200);
      expect(accepted.body).toMatchObject({ validationStatus: 'ACCEPTED', validationNotes: null });

      const audit = await t.prisma.auditEvent.findMany({
        where: { action: 'document.validated', entityId: docId },
        orderBy: { id: 'asc' },
      });
      expect(audit.map((a) => (a.after as { validationStatus: string }).validationStatus)).toEqual([
        'REJECTED',
        'ACCEPTED',
      ]);
    });

    it('is not possible before the review starts', async () => {
      const id = await draft();
      const doc = await upload(operator, id, { data: PDF, filename: 'rg.pdf' }).expect(201);
      await t.prisma.creditApplication.update({ where: { id }, data: { status: 'SUBMITTED' } });
      await analyst.http
        .patch(`/api/v1/documents/${doc.body.id}/validation`, { status: 'ACCEPTED' })
        .expect(409);
    });
  });

  describe('removal', () => {
    it('is logical, only while editable, and affects the submission check', async () => {
      const id = await draft();
      const rg = await upload(operator, id, { data: PDF, filename: 'rg.pdf' }).expect(201);
      await upload(
        operator,
        id,
        { data: PDF, filename: 'renda.pdf' },
        { type: 'PROOF_OF_INCOME' },
      ).expect(201);

      await analyst.http.delete(`/api/v1/documents/${rg.body.id}`).expect(403);
      await operator.http.delete(`/api/v1/documents/${rg.body.id}`).expect(204);
      await operator.http.delete(`/api/v1/documents/${rg.body.id}`).expect(404);

      const list = await operator.http.get(`/api/v1/applications/${id}/documents`).expect(200);
      expect(list.body.map((d: { type: string }) => d.type)).toEqual(['PROOF_OF_INCOME']);
      const row = await t.prisma.creditDocument.findUniqueOrThrow({ where: { id: rg.body.id } });
      expect(row.deletedAt).not.toBeNull();
      expect(existsSync(resolve(storageRoot, row.storageKey))).toBe(true); // file retained

      const submit = await operator.http.post(`/api/v1/applications/${id}/submit`).expect(422);
      expect(submit.body.missingDocumentTypes).toEqual(['IDENTIFICATION']);

      await upload(operator, id, { data: PDF, filename: 'rg2.pdf' }).expect(201);
      await operator.http.post(`/api/v1/applications/${id}/submit`).expect(200);
      const remaining = await operator.http.get(`/api/v1/applications/${id}/documents`).expect(200);
      await operator.http.delete(`/api/v1/documents/${remaining.body[0].id}`).expect(409);
    });
  });
});
