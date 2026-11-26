import { randomUUID } from 'node:crypto';
import { Role } from '@creditflow/shared';
import { resetDatabase } from '../helpers/database.js';
import {
  type TestApp,
  client,
  createTestApp,
  createUser,
  dump,
  login,
  signedIn,
} from '../helpers/app.js';

describe('users administration (integration)', () => {
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

  const newUser = (overrides: object = {}) => ({
    email: 'Novo.Usuario@CreditFlow.test',
    name: 'Novo Usuario',
    role: 'ANALYST',
    initialPassword: 'senha-inicial-123',
    ...overrides,
  });

  it('is restricted to administrators (backend-enforced)', async () => {
    await client(t.app).get('/api/v1/users').expect(401);
    for (const role of [Role.ANALYST, Role.OPERATOR]) {
      const { http } = await signedIn(t, role);
      const res = await http.get('/api/v1/users').expect(403);
      expect(res.body.type).toBe('/problems/forbidden');
      await http.post('/api/v1/users', newUser()).expect(403);
    }
  });

  it('lists with pagination, filters and allow-listed sorting', async () => {
    const { http } = await signedIn(t, Role.ADMIN);
    await createUser(t.prisma, { role: Role.ANALYST, name: 'Zeca Analista' });
    await createUser(t.prisma, { role: Role.ANALYST, name: 'Amanda Analista', active: false });
    await createUser(t.prisma, { role: Role.OPERATOR, name: 'Otto Operador' });

    const all = await http.get('/api/v1/users?pageSize=2&sort=name:asc').expect(200);
    expect(all.body.meta).toEqual({ page: 1, pageSize: 2, total: 4 });
    expect(all.body.data).toHaveLength(2);
    expect(all.body.data.map((u: { name: string }) => u.name)).toEqual([
      expect.stringMatching(/^ADMIN \d+$/),
      'Amanda Analista',
    ]);

    const analysts = await http.get('/api/v1/users?role=ANALYST&active=true').expect(200);
    expect(analysts.body.data.map((u: { name: string }) => u.name)).toEqual(['Zeca Analista']);

    const search = await http.get('/api/v1/users?q=otto').expect(200);
    expect(search.body.meta.total).toBe(1);

    for (const u of all.body.data) expect(u).not.toHaveProperty('passwordHash');

    expect((await http.get('/api/v1/users?sort=passwordHash:asc').expect(422)).body.type).toBe(
      '/problems/invalid-sort',
    );
    await http.get('/api/v1/users?pageSize=101').expect(400);
  });

  it('creates a user with a temporary password and audits it without secrets', async () => {
    const { http, user: admin } = await signedIn(t, Role.ADMIN);
    const res = await http.post('/api/v1/users', newUser()).expect(201);
    expect(res.body).toMatchObject({
      email: 'novo.usuario@creditflow.test',
      role: 'ANALYST',
      mustChangePassword: true,
      active: true,
    });
    expect(res.body).not.toHaveProperty('passwordHash');

    const dup = await http
      .post('/api/v1/users', newUser({ email: 'NOVO.usuario@creditflow.test' }))
      .expect(409);
    expect(dup.body.type).toBe('/problems/email-already-used');

    const audit = await t.prisma.auditEvent.findFirstOrThrow({ where: { action: 'user.created' } });
    expect(audit).toMatchObject({ actorId: admin.id, entityId: res.body.id });
    expect(dump(audit)).not.toMatch(/senha-inicial-123|argon2/);

    // The new user can sign in but must change the password first.
    const cookie = await login(t.app, 'novo.usuario@creditflow.test', 'senha-inicial-123');
    const blocked = await client(t.app, cookie).get('/api/v1/users').expect(403);
    expect(blocked.body.type).toBe('/problems/password-change-required');
  });

  it('only lets operators receive the canDecide grant', async () => {
    const { http } = await signedIn(t, Role.ADMIN);
    for (const role of ['ANALYST', 'ADMIN']) {
      const res = await http
        .post('/api/v1/users', newUser({ role, canDecide: true, email: `${role}@creditflow.test` }))
        .expect(422);
      expect(res.body.type).toBe('/problems/decide-grant-not-allowed');
    }
    await http.post('/api/v1/users', newUser({ role: 'OPERATOR', canDecide: true })).expect(201);
  });

  it('applies role and grant changes on the very next request', async () => {
    const { http } = await signedIn(t, Role.ADMIN);
    const target = await signedIn(t, Role.OPERATOR);

    let me = await target.http.get('/api/v1/auth/me').expect(200);
    expect(me.body.user.permissions).not.toContain('application.decide');

    await http.patch(`/api/v1/users/${target.user.id}`, { canDecide: true }).expect(200);
    me = await target.http.get('/api/v1/auth/me').expect(200);
    expect(me.body.user.permissions).toContain('application.decide');

    // Leaving the OPERATOR role drops the grant automatically.
    const promoted = await http
      .patch(`/api/v1/users/${target.user.id}`, { role: 'ADMIN' })
      .expect(200);
    expect(promoted.body).toMatchObject({ role: 'ADMIN', canDecide: false });
    me = await target.http.get('/api/v1/auth/me').expect(200);
    expect(me.body.user.permissions).toContain('user.manage');
    expect(me.body.user.permissions).not.toContain('application.decide');

    const audit = await t.prisma.auditEvent.findMany({
      where: { action: 'user.updated', entityId: target.user.id },
      orderBy: { id: 'asc' },
    });
    expect(audit[1]!.before).toMatchObject({ role: 'OPERATOR', canDecide: true });
    expect(audit[1]!.after).toMatchObject({ role: 'ADMIN', canDecide: false });
  });

  it('prevents administrators from locking themselves out', async () => {
    const { http, user } = await signedIn(t, Role.ADMIN);
    expect(
      (await http.patch(`/api/v1/users/${user.id}`, { role: 'ANALYST' }).expect(422)).body.type,
    ).toBe('/problems/cannot-change-own-role');
    expect((await http.post(`/api/v1/users/${user.id}/deactivate`).expect(422)).body.type).toBe(
      '/problems/cannot-deactivate-self',
    );
    await http.patch(`/api/v1/users/${user.id}`, { name: 'Admin Renomeado' }).expect(200);
  });

  it('deactivation revokes sessions immediately and blocks login; activation restores it', async () => {
    const { http } = await signedIn(t, Role.ADMIN);
    const target = await signedIn(t, Role.ANALYST);

    await http.post(`/api/v1/users/${target.user.id}/deactivate`).expect(200);
    await target.http.get('/api/v1/auth/me').expect(401);
    await client(t.app)
      .post('/api/v1/auth/login', { email: target.user.email, password: target.user.password })
      .expect(401);
    const sessions = await t.prisma.session.findMany({ where: { userId: target.user.id } });
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);

    await http.post(`/api/v1/users/${target.user.id}/activate`).expect(200);
    await login(t.app, target.user.email, target.user.password);

    const actions = (
      await t.prisma.auditEvent.findMany({
        where: { entityId: target.user.id },
        orderBy: { id: 'asc' },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['user.deactivated', 'user.activated']));
  });

  it('reset-password forces a change and ends existing sessions', async () => {
    const { http } = await signedIn(t, Role.ADMIN);
    const target = await signedIn(t, Role.OPERATOR);

    const res = await http
      .post(`/api/v1/users/${target.user.id}/reset-password`, {
        temporaryPassword: 'temporaria-12345',
      })
      .expect(200);
    expect(res.body.mustChangePassword).toBe(true);
    await target.http.get('/api/v1/auth/me').expect(401);
    await login(t.app, target.user.email, 'temporaria-12345');
  });

  it('answers 404 for malformed and unknown ids alike', async () => {
    const { http } = await signedIn(t, Role.ADMIN);
    await http.get('/api/v1/users/nao-e-uuid').expect(404);
    await http.get(`/api/v1/users/${randomUUID()}`).expect(404);
  });
});
