import { defineConfig, devices } from '@playwright/test';
import { E2E_API_PORT, E2E_WEB_ORIGIN, E2E_WEB_PORT, REPO_ROOT } from './support/env.js';

/**
 * Locally the tests drive the browser already installed on the machine
 * (Chrome by default, no download); CI installs Playwright's own Chromium.
 * Override with PW_CHANNEL=msedge, or PW_CHANNEL= (empty) for the bundled one.
 */
const channel = process.env.PW_CHANNEL ?? (process.env.CI ? undefined : 'chrome');

export default defineConfig({
  testDir: './tests',
  // One shared, seeded database: the flow runs serially, step by step.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: E2E_WEB_ORIGIN,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: channel || undefined } },
  ],
  webServer: [
    {
      // Prepares the E2E database, then runs the built API (see support/start-api.ts).
      command: 'node --import tsx support/start-api.ts',
      url: `http://localhost:${E2E_API_PORT}/api/v1/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `pnpm --filter @creditflow/web exec vite --port ${E2E_WEB_PORT} --strictPort`,
      cwd: REPO_ROOT,
      url: E2E_WEB_ORIGIN,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        WEB_PORT: String(E2E_WEB_PORT),
        VITE_API_PROXY_TARGET: `http://localhost:${E2E_API_PORT}`,
      },
    },
  ],
});
