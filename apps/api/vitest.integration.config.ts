import { defineConfig } from 'vitest/config';
import { loadTestEnv } from './test/load-test-env.js';

// Integration tests: real PostgreSQL (TEST_DATABASE_URL), full Nest app over HTTP.
const testEnv = loadTestEnv();

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/integration/**/*.int-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    env: { ...testEnv, TEST_DATABASE_URL: testEnv.DATABASE_URL },
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
