/// <reference types="vitest/config" />
import { defaultClientConditions, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Consume @creditflow/shared straight from its TypeScript sources (see its
    // package.json "source" export condition) so edits hot-reload without a build.
    conditions: ['source', ...defaultClientConditions],
  },
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin in development: the browser only talks to Vite, which proxies
    // /api to Nest. This keeps cookies first-party and CORS disabled.
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
