/**
 * Prepares a clean, seeded E2E database and then runs the built API on the
 * E2E port. Started by Playwright's `webServer`, so the database is always
 * ready before the API answers its health check.
 *
 *   1. create `creditflow_e2e` if missing
 *   2. apply migrations (prisma migrate deploy — non-destructive)
 *   3. empty every table and the E2E document storage
 *   4. run the synthetic seed (deterministic data, known test password)
 *   5. exec the API (dist/main.js) with E2E settings
 */
import { execSync, spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import {
  E2E_API_PORT,
  E2E_PASSWORD,
  E2E_STORAGE_DIR,
  E2E_WEB_ORIGIN,
  REPO_ROOT,
  e2eDatabaseUrl,
} from './env.js';

const databaseUrl = e2eDatabaseUrl();
const dbName = new URL(databaseUrl).pathname.slice(1);
if (dbName !== 'creditflow_e2e' && !process.env.E2E_DATABASE_URL) {
  throw new Error(`Refusing to reset unexpected database "${dbName}".`);
}
const apiDir = resolve(REPO_ROOT, 'apps/api');
const env = {
  ...process.env,
  NODE_ENV: 'development',
  DATABASE_URL: databaseUrl,
  API_PORT: String(E2E_API_PORT),
  WEB_ORIGIN: E2E_WEB_ORIGIN,
  STORAGE_DIR: E2E_STORAGE_DIR,
  SEED_DEMO_PASSWORD: E2E_PASSWORD,
  LOG_LEVEL: 'warn',
};

async function ensureDatabase() {
  const admin = new URL(databaseUrl);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!rowCount) await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();
}

async function truncateAll() {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const { rows } = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
  );
  if (rows.length) {
    const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
    await client.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
  await client.end();
}

await ensureDatabase();
execSync('pnpm exec prisma migrate deploy', { cwd: apiDir, env, stdio: 'inherit' });
await truncateAll();
rmSync(resolve(REPO_ROOT, E2E_STORAGE_DIR), { recursive: true, force: true });
execSync('pnpm exec tsx prisma/seed/index.ts', { cwd: apiDir, env, stdio: 'inherit' });

const api = spawn(process.execPath, ['dist/main.js'], { cwd: apiDir, env, stdio: 'inherit' });
const stop = () => api.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', stop);
api.on('exit', (code) => process.exit(code ?? 0));
