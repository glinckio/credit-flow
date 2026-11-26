import request from 'supertest';
import { Role } from '@creditflow/shared';
import { resetDatabase } from '../helpers/database.js';
import {
  DEFAULT_PASSWORD,
  type TestApp,
  WEB_ORIGIN,
  client,
  createTestApp,
  createUser,
  dump,
  login,
  sessionCookie,
  signedIn,
} from '../helpers/app.js';

describe('authentication (integration)', () => {
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

  describe('POST /auth/login', () => {
    it('sets a hardened session cookie and returns the user with effective permissions', async () => {
      const user = await createUser(t.prisma, { role: Role.ANALYST });
      const res = await client(t.app)
        .post('/api/v1/auth/login', { email: user.email.toUpperCase(), password: DEFAULT_PASSWORD })
        .expect(200);

      const setCookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
      expect(setCookie).toMatch(/cf_session=[A-Za-z0-9_-]{43}/);
      expect(setCookie).toMatch(/HttpOnly/);
      expect(setCookie).toMatch(/SameSite=Lax/);
      expect(setCookie).toMatch(/Path=\/api/);

      expect(res.body.user).toMatchObject({ id: user.id, role: 'ANALYST' });
      expect(res.body.user.permissions).toContain('application.decide');
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);

      const token = sessionCookie(res).split('=')[1]!;
      const session = await t.prisma.session.findFirstOrThrow({ where: { userId: user.id } });
      expect(session.tokenHash).not.toBe(token);
      expect(session.tokenHash).toMatch(/^[0-9a-f]{64}$/);

      const audit = await t.prisma.auditEvent.findFirstOrThrow({
        where: { action: 'auth.login_succeeded' },
      });
      expect(audit.actorId).toBe(user.id);
      expect(audit.metadata).toMatchObject({ requestId: expect.any(String) });
    });

    it('answers every failure the same way and audits the reason without the password', async () => {
      const active = await createUser(t.prisma, { role: Role.OPERATOR });
      const inactive = await createUser(t.prisma, { role: Role.OPERATOR, active: false });

      const attempts = [
        { email: active.email, password: 'senha-errada-000' },
        { email: 'ninguem@creditflow.test', password: DEFAULT_PASSWORD },
        { email: inactive.email, password: DEFAULT_PASSWORD },
      ];
      const bodies = [];
      for (const body of attempts) {
        const res = await client(t.app).post('/api/v1/auth/login', body).expect(401);
        expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
        expect(res.headers['set-cookie']).toBeUndefined();
        bodies.push({ type: res.body.type, title: res.body.title });
      }
      expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
      expect(bodies[0]).toEqual({
        type: '/problems/invalid-credentials',
        title: expect.any(String),
      });

      const failures = await t.prisma.auditEvent.findMany({
        where: { action: 'auth.login_failed' },
        orderBy: { id: 'asc' },
      });
      expect(failures.map((f) => (f.metadata as { reason: string }).reason)).toEqual([
        'wrong_password',
        'unknown_user',
        'inactive_user',
      ]);
      expect(failures[1]!.actorId).toBeNull();
      expect(dump(failures)).not.toContain('senha-errada-000');
      expect(dump(failures)).not.toContain('ninguem@');
    });

    it('rejects unknown body properties (whitelist) with field errors', async () => {
      const res = await client(t.app)
        .post('/api/v1/auth/login', { email: 'not-an-email', password: 'x', role: 'ADMIN' })
        .expect(400);
      expect(res.body.type).toBe('/problems/validation-error');
      const fields = res.body.errors.map((e: { field: string }) => e.field).sort();
      expect(fields).toEqual(['email', 'role']);
    });

    it('rate-limits repeated attempts for the same e-mail', async () => {
      const user = await createUser(t.prisma, { role: Role.OPERATOR });
      for (let i = 0; i < 5; i++) {
        await client(t.app)
          .post('/api/v1/auth/login', { email: user.email, password: 'senha-errada-000' })
          .expect(401);
      }
      const res = await client(t.app)
        .post('/api/v1/auth/login', { email: user.email, password: DEFAULT_PASSWORD })
        .expect(429);
      expect(res.body.type).toBe('/problems/too-many-requests');
    });
  });

  describe('CSRF protection', () => {
    it('rejects mutating requests without the X-Requested-With header', async () => {
      const res = await request(t.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'a@creditflow.test', password: 'x' })
        .expect(403);
      expect(res.body.type).toBe('/problems/csrf-rejected');
    });

    it('rejects a foreign Origin and accepts the web app origin', async () => {
      const user = await createUser(t.prisma, { role: Role.OPERATOR });
      await client(t.app)
        .post('/api/v1/auth/login', { email: user.email, password: DEFAULT_PASSWORD })
        .set('Origin', 'https://evil.example')
        .expect(403);
      await client(t.app)
        .post('/api/v1/auth/login', { email: user.email, password: DEFAULT_PASSWORD })
        .set('Origin', WEB_ORIGIN)
        .expect(200);
    });
  });

  describe('session lifecycle', () => {
    it('requires a valid session for GET /auth/me', async () => {
      const anon = await client(t.app).get('/api/v1/auth/me').expect(401);
      expect(anon.body).toMatchObject({
        type: '/problems/unauthenticated',
        status: 401,
        requestId: expect.any(String),
      });
      await client(t.app, 'cf_session=forged-token').get('/api/v1/auth/me').expect(401);

      const { http, user } = await signedIn(t, Role.OPERATOR);
      const me = await http.get('/api/v1/auth/me').expect(200);
      expect(me.body.user.email).toBe(user.email);
    });

    it('logout revokes the session server-side', async () => {
      const { http, cookie } = await signedIn(t, Role.OPERATOR);
      await http.post('/api/v1/auth/logout').expect(204);
      await client(t.app, cookie).get('/api/v1/auth/me').expect(401);
      const session = await t.prisma.session.findFirstOrThrow();
      expect(session.revokedAt).not.toBeNull();
    });

    it('rejects an expired session', async () => {
      const { http } = await signedIn(t, Role.OPERATOR);
      await t.prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      await http.get('/api/v1/auth/me').expect(401);
    });

    it('cuts access immediately when the user is deactivated', async () => {
      const { http, user } = await signedIn(t, Role.ANALYST);
      await t.prisma.user.update({ where: { id: user.id }, data: { active: false } });
      await http.get('/api/v1/auth/me').expect(401);
    });
  });

  describe('temporary password flow', () => {
    it('blocks everything but me/logout/change-password until the password is changed', async () => {
      const { http, cookie, user } = await signedIn(t, Role.ADMIN, { mustChangePassword: true });
      // Another session of the same user, to verify it is revoked on change.
      const otherCookie = await login(t.app, user.email);

      const blocked = await http.get('/api/v1/users').expect(403);
      expect(blocked.body.type).toBe('/problems/password-change-required');
      await http.get('/api/v1/auth/me').expect(200);

      const wrong = await http
        .post('/api/v1/auth/change-password', {
          currentPassword: 'nao-e-a-senha',
          newPassword: 'nova-senha-segura-1',
        })
        .expect(422);
      expect(wrong.body.type).toBe('/problems/wrong-current-password');

      const short = await http
        .post('/api/v1/auth/change-password', {
          currentPassword: DEFAULT_PASSWORD,
          newPassword: 'curta',
        })
        .expect(400);
      expect(short.body.errors[0].field).toBe('newPassword');

      const ok = await http
        .post('/api/v1/auth/change-password', {
          currentPassword: DEFAULT_PASSWORD,
          newPassword: 'nova-senha-segura-1',
        })
        .expect(200);
      expect(ok.body.user.mustChangePassword).toBe(false);

      await client(t.app, cookie).get('/api/v1/users').expect(200);
      await client(t.app, otherCookie).get('/api/v1/auth/me').expect(401);
      await login(t.app, user.email, 'nova-senha-segura-1');

      const audit = await t.prisma.auditEvent.findFirstOrThrow({
        where: { action: 'auth.password_changed' },
      });
      expect(dump(audit)).not.toContain('nova-senha-segura-1');
    });
  });

  describe('HTTP hardening', () => {
    it('sets security headers and echoes a valid incoming request id', async () => {
      const res = await request(t.app.getHttpServer())
        .get('/api/v1/health')
        .set('X-Request-Id', 'test-request-0001')
        .expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-request-id']).toBe('test-request-0001');
    });

    it('replaces a malformed incoming request id', async () => {
      const res = await request(t.app.getHttpServer())
        .get('/api/v1/health')
        .set('X-Request-Id', 'bad id with spaces')
        .expect(200);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('returns Problem Details for unknown routes', async () => {
      const res = await client(t.app).get('/api/v1/nao-existe').expect(404);
      expect(res.body).toMatchObject({ type: '/problems/not-found', status: 404 });
    });
  });
});
