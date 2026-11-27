import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '../..');

const rootEnv = resolve(REPO_ROOT, '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/** Ports dedicated to E2E, so tests never collide with a running dev environment. */
export const E2E_API_PORT = 3100;
export const E2E_WEB_PORT = 5175;
export const E2E_WEB_ORIGIN = `http://localhost:${E2E_WEB_PORT}`;
export const E2E_STORAGE_DIR = 'var/storage-e2e';
/** Recorded model answers for AI_PROVIDER=recorded (never a real model in E2E). */
export const E2E_AI_RECORDINGS_DIR = 'var/ai-recordings-e2e';

/** Test-only password of the seeded demo users in the throwaway E2E database. */
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-senha-sintetica-123';

/**
 * E2E runs on its own database (`creditflow_e2e`), derived from
 * TEST_DATABASE_URL, so it never touches development data nor races the API
 * integration suite.
 */
export function e2eDatabaseUrl(): string {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const base = process.env.TEST_DATABASE_URL;
  if (!base) {
    throw new Error(
      'TEST_DATABASE_URL is not set (see .env.example); E2E derives its database from it.',
    );
  }
  const url = new URL(base);
  url.pathname = '/creditflow_e2e';
  return url.toString();
}

export const DEMO_USERS = {
  admin: 'admin@creditflow.test',
  analyst: 'analista@creditflow.test',
  operator: 'operador@creditflow.test',
} as const;
