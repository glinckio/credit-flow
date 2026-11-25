import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Role } from '@creditflow/shared';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { PrismaService } from '../../src/infra/prisma/prisma.service.js';
import { hashPassword } from '../../src/infra/security/password.js';

export const WEB_ORIGIN = 'http://localhost:5173';
export const DEFAULT_PASSWORD = 'senha-de-teste-123';

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  close: () => Promise<void>;
}

/** Full Nest app (same pipeline as production) bound to the test database. */
export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService), close: () => app.close() };
}

/**
 * HTTP client that behaves like the web app: sends the CSRF header on
 * mutating requests and, optionally, a session cookie.
 */
export function client(app: INestApplication, cookie?: string) {
  const server = app.getHttpServer();
  const withAuth = (req: request.Test) => (cookie ? req.set('Cookie', cookie) : req);
  const mutating = (req: request.Test) => withAuth(req.set('X-Requested-With', 'XMLHttpRequest'));
  return {
    get: (url: string) => withAuth(request(server).get(url)),
    post: (url: string, body?: object) => mutating(request(server).post(url)).send(body ?? {}),
    patch: (url: string, body?: object) => mutating(request(server).patch(url)).send(body ?? {}),
    delete: (url: string) => mutating(request(server).delete(url)),
  };
}

const hashCache = new Map<string, Promise<string>>();
let userCounter = 0;

/** Creates a user directly in the database with a unique e-mail. */
export async function createUser(
  prisma: PrismaService,
  opts: {
    role: Role;
    canDecide?: boolean;
    active?: boolean;
    mustChangePassword?: boolean;
    password?: string;
    name?: string;
  },
) {
  const password = opts.password ?? DEFAULT_PASSWORD;
  if (!hashCache.has(password)) hashCache.set(password, hashPassword(password));
  userCounter += 1;
  const user = await prisma.user.create({
    data: {
      email: `${opts.role.toLowerCase()}.${process.pid}.${userCounter}@creditflow.test`,
      name: opts.name ?? `${opts.role} ${userCounter}`,
      role: opts.role,
      canDecide: opts.canDecide ?? false,
      active: opts.active ?? true,
      mustChangePassword: opts.mustChangePassword ?? false,
      passwordHash: await hashCache.get(password)!,
    },
  });
  return { ...user, password };
}

/** Logs in through the API and returns the `Cookie` header value. */
export async function login(
  app: INestApplication,
  email: string,
  password = DEFAULT_PASSWORD,
): Promise<string> {
  const res = await client(app).post('/api/v1/auth/login', { email, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return sessionCookie(res);
}

export function sessionCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith('cf_session='));
  if (!cookie) throw new Error('no session cookie in response');
  return cookie.split(';')[0]!;
}

/** Signs in a fresh user of the given role and returns it with its cookie. */
export async function signedIn(
  t: TestApp,
  role: Role,
  opts: Parameters<typeof createUser>[1] extends infer O ? Omit<O & object, 'role'> : never = {},
) {
  const user = await createUser(t.prisma, { role, ...opts });
  const cookie = await login(t.app, user.email, user.password);
  return { user, cookie, http: client(t.app, cookie) };
}

/** JSON.stringify that tolerates BigInt (audit ids), for "contains no secret" assertions. */
export function dump(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
}
