import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// The monorepo keeps a single .env at the repository root.
const rootEnv = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Read lazily instead of `env('DATABASE_URL')`, which throws when the
    // variable is missing. `prisma generate` (run on every `pnpm install`,
    // including fresh clones and CI jobs without a database) does not need it;
    // commands that do (migrate, db) still fail with a clear message.
    url: process.env.DATABASE_URL,
  },
});
