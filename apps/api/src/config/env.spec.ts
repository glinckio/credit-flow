import { validateEnv } from './env.js';

const DB = 'postgresql://u:p@localhost:5433/db';

describe('validateEnv', () => {
  it('accepts a minimal configuration and applies defaults', () => {
    expect(validateEnv({ DATABASE_URL: DB })).toEqual({
      NODE_ENV: 'development',
      API_PORT: 3000,
      DATABASE_URL: DB,
      WEB_ORIGIN: 'http://localhost:5173',
      SESSION_TTL_HOURS: 8,
      COOKIE_SECURE: false,
      LOGIN_RATE_LIMIT: 5,
      LOG_LEVEL: 'info',
      STORAGE_DIR: 'var/storage',
      AI_PROVIDER: 'disabled',
      AI_RECORDINGS_DIR: null,
      ANTHROPIC_API_KEY: null,
      AI_REQUEST_TIMEOUT_MS: 60_000,
      AI_EFFORT: 'medium',
      AI_MAX_PAGES_PER_DOCUMENT: 10,
      AI_MAX_COST_USD_PER_RUN: 0.1,
      AI_MODEL: 'claude-haiku-5-5',
      AI_WORKER_POLL_MS: 2000,
      AI_LEASE_MS: 300_000,
      AI_RETENTION_DAYS: 90,
      AI_MAX_DOCUMENTS_PER_RUN: 15,
    });
  });

  it('requires the API key for the anthropic provider and only allows listed models', () => {
    expect(() => validateEnv({ DATABASE_URL: DB, AI_PROVIDER: 'anthropic' })).toThrow(
      /ANTHROPIC_API_KEY is required/,
    );
    const env = validateEnv({
      DATABASE_URL: DB,
      AI_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'test-key',
    });
    expect(env.AI_PROVIDER).toBe('anthropic');
    expect(() => validateEnv({ DATABASE_URL: DB, AI_PROVIDER: 'openai' })).toThrow(/AI_PROVIDER/);
    // Recorded answers (E2E): needs a directory and never runs in production.
    expect(() => validateEnv({ DATABASE_URL: DB, AI_PROVIDER: 'recorded' })).toThrow(
      /AI_RECORDINGS_DIR is required/,
    );
    expect(
      validateEnv({ DATABASE_URL: DB, AI_PROVIDER: 'recorded', AI_RECORDINGS_DIR: 'var/rec' })
        .AI_RECORDINGS_DIR,
    ).toBe('var/rec');
    expect(() =>
      validateEnv({
        DATABASE_URL: DB,
        NODE_ENV: 'production',
        AI_PROVIDER: 'recorded',
        AI_RECORDINGS_DIR: 'var/rec',
      }),
    ).toThrow(/not allowed in production/);
    expect(() => validateEnv({ DATABASE_URL: DB, AI_MAX_COST_USD_PER_RUN: '0' })).toThrow(
      /AI_MAX_COST_USD_PER_RUN/,
    );
    expect(() => validateEnv({ DATABASE_URL: DB, AI_MODEL: 'claude-opus-5-5' })).toThrow(
      /AI_MODEL/,
    );
    expect(validateEnv({ DATABASE_URL: DB, NODE_ENV: 'test' }).AI_WORKER_POLL_MS).toBe(0);
    expect(() => validateEnv({ DATABASE_URL: DB, AI_RETENTION_DAYS: '0' })).toThrow(
      /AI_RETENTION_DAYS/,
    );
  });

  it('silences logs by default in tests', () => {
    expect(validateEnv({ DATABASE_URL: DB, NODE_ENV: 'test' }).LOG_LEVEL).toBe('silent');
  });

  it('defaults to secure cookies in production and refuses to disable them', () => {
    expect(validateEnv({ DATABASE_URL: DB, NODE_ENV: 'production' }).COOKIE_SECURE).toBe(true);
    expect(() =>
      validateEnv({ DATABASE_URL: DB, NODE_ENV: 'production', COOKIE_SECURE: 'false' }),
    ).toThrow(/COOKIE_SECURE cannot be false in production/);
  });

  it('rejects storage paths that climb out with ..', () => {
    expect(() => validateEnv({ DATABASE_URL: DB, STORAGE_DIR: '../outside' })).toThrow(
      /STORAGE_DIR/,
    );
    expect(() => validateEnv({ DATABASE_URL: DB, STORAGE_DIR: 'var\\..\\..\\x' })).toThrow(
      /STORAGE_DIR/,
    );
    for (const ok of ['var/docs', 'a/bc', 'var/storage..bak', 'C:\\data\\cf']) {
      expect(validateEnv({ DATABASE_URL: DB, STORAGE_DIR: ok }).STORAGE_DIR).toBe(ok);
    }
  });

  it('rejects an origin with a path', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: DB, WEB_ORIGIN: 'http://localhost:5173/app' }),
    ).toThrow(/WEB_ORIGIN/);
  });

  it('reports every invalid variable at once', () => {
    expect(() =>
      validateEnv({ API_PORT: 'abc', NODE_ENV: 'staging', SESSION_TTL_HOURS: '0' }),
    ).toThrow(/NODE_ENV[\s\S]*API_PORT[\s\S]*DATABASE_URL[\s\S]*SESSION_TTL_HOURS/);
  });
});
