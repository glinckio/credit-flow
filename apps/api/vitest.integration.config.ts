import { defineConfig } from 'vitest/config';
import { loadTestEnv } from './test/load-test-env.js';

// Integration tests: real PostgreSQL (TEST_DATABASE_URL), full Nest app over HTTP.
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/integration/**/*.int-spec.ts'],
    env: loadTestEnv(),
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
