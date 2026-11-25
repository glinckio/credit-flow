import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadTestEnv } from './load-test-env.js';

/**
 * Runs once before the integration suite: applies pending migrations to the
 * TEST database (`prisma migrate deploy` is non-destructive). Tests then clean
 * their own data with `resetDatabase()`.
 */
export default function setup(): void {
  const { DATABASE_URL } = loadTestEnv();
  const apiDir = resolve(import.meta.dirname, '..');
  execSync('pnpm exec prisma migrate deploy', {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL },
    stdio: 'pipe',
  });
}
