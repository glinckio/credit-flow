import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Integration tests always run against TEST_DATABASE_URL, never the dev
 * database. Fails loudly if it is not configured.
 */
export function loadTestEnv(): Record<string, string> {
  const rootEnv = resolve(import.meta.dirname, '../../../.env');
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Copy .env.example to .env and run `docker compose up -d`.',
    );
  }
  return { NODE_ENV: 'test', DATABASE_URL: testUrl };
}
