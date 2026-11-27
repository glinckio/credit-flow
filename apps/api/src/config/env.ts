import { ALLOWED_AI_MODELS, type AllowedAiModel } from '@creditflow/shared';

/**
 * Environment validation. The API refuses to start with missing or malformed
 * configuration (fail fast) instead of failing later on first use.
 */
export interface Env {
  NODE_ENV: 'development' | 'test' | 'production';
  API_PORT: number;
  DATABASE_URL: string;
  /** Origin of the web app. Mutating requests from any other Origin are rejected (CSRF). */
  WEB_ORIGIN: string;
  /** Sliding session lifetime. */
  SESSION_TTL_HOURS: number;
  /** `Secure` cookie flag. Defaults to true in production. */
  COOKIE_SECURE: boolean;
  /** Login attempts allowed per minute per IP + e-mail. */
  LOGIN_RATE_LIMIT: number;
  LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  /** Document storage directory, absolute or relative to the repository root. */
  STORAGE_DIR: string;
  /**
   * AI-assisted analysis provider (ADR-0011). "disabled": no model is called and
   * no run is queued. "anthropic": Claude through the Messages API (synthetic data only).
   * "recorded": replays answers stored in AI_RECORDINGS_DIR (E2E; refused in production).
   */
  AI_PROVIDER: 'disabled' | 'anthropic' | 'recorded';
  /** Directory of `<sha256>.json` recorded answers; required when AI_PROVIDER=recorded. */
  AI_RECORDINGS_DIR: string | null;
  /** Required when AI_PROVIDER=anthropic. Secret: never logged, never audited. */
  ANTHROPIC_API_KEY: string | null;
  /** Per-request timeout of the provider call. */
  AI_REQUEST_TIMEOUT_MS: number;
  /** Reasoning effort sent to the model. */
  AI_EFFORT: 'low' | 'medium' | 'high';
  /** Documents with more pages are not sent to the model (TOO_LARGE). */
  AI_MAX_PAGES_PER_DOCUMENT: number;
  /** When a run's estimated cost reaches this, remaining documents are skipped (SKIPPED_BUDGET). */
  AI_MAX_COST_USD_PER_RUN: number;
  /** Model recorded with every run; must be in ALLOWED_AI_MODELS. */
  AI_MODEL: AllowedAiModel;
  /** Worker polling interval; 0 disables the background worker (tests drive it explicitly). */
  AI_WORKER_POLL_MS: number;
  /** A RUNNING run whose lease expired is marked FAILED (interrupted), never retried. */
  AI_LEASE_MS: number;
  /** Extracted content is purged after this many days. */
  AI_RETENTION_DAYS: number;
  /** Cost/abuse guard: a run over more documents fails without calling the model. */
  AI_MAX_DOCUMENTS_PER_RUN: number;
}

const LOG_LEVELS: Env['LOG_LEVEL'][] = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
];

function parseBool(value: unknown, fallback: boolean): boolean | undefined {
  if (value === undefined || value === '') return fallback;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return undefined;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  return value === undefined || value === '' ? fallback : Number(value);
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const errors: string[] = [];

  const nodeEnv = String(raw.NODE_ENV ?? 'development');
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    errors.push(`NODE_ENV must be development|test|production (got "${nodeEnv}")`);
  }

  const port = parsePositiveInt(raw.API_PORT, 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    errors.push('API_PORT must be a valid TCP port');
  }

  const databaseUrl = raw.DATABASE_URL;
  if (typeof databaseUrl !== 'string' || !/^postgres(ql)?:\/\//.test(databaseUrl)) {
    errors.push('DATABASE_URL must be a postgresql:// connection string');
  }

  const webOrigin = String(raw.WEB_ORIGIN ?? 'http://localhost:5173');
  try {
    const u = new URL(webOrigin);
    if (u.origin !== webOrigin) throw new Error();
  } catch {
    errors.push('WEB_ORIGIN must be an origin like http://localhost:5173 (no path)');
  }

  const sessionTtl = parsePositiveInt(raw.SESSION_TTL_HOURS, 8);
  if (!Number.isInteger(sessionTtl) || sessionTtl < 1 || sessionTtl > 24 * 30) {
    errors.push('SESSION_TTL_HOURS must be an integer between 1 and 720');
  }

  const cookieSecure = parseBool(raw.COOKIE_SECURE, nodeEnv === 'production');
  if (cookieSecure === undefined) errors.push('COOKIE_SECURE must be true or false');
  if (nodeEnv === 'production' && cookieSecure === false) {
    errors.push('COOKIE_SECURE cannot be false in production');
  }

  const loginRateLimit = parsePositiveInt(raw.LOGIN_RATE_LIMIT, 5);
  if (!Number.isInteger(loginRateLimit) || loginRateLimit < 1) {
    errors.push('LOGIN_RATE_LIMIT must be a positive integer');
  }

  const logLevel = String(raw.LOG_LEVEL ?? (nodeEnv === 'test' ? 'silent' : 'info'));
  if (!LOG_LEVELS.includes(logLevel as Env['LOG_LEVEL'])) {
    errors.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join('|')}`);
  }

  const storageDir = String(raw.STORAGE_DIR ?? 'var/storage').trim();
  if (!storageDir || storageDir.split(/[\\/]/).includes('..')) {
    errors.push('STORAGE_DIR must be a directory path without ".." segments');
  }

  const aiProvider = String(raw.AI_PROVIDER ?? 'disabled').trim() || 'disabled';
  if (!['disabled', 'anthropic', 'recorded'].includes(aiProvider)) {
    errors.push('AI_PROVIDER must be "disabled", "anthropic" or "recorded"');
  }
  const recordingsDir = String(raw.AI_RECORDINGS_DIR ?? '').trim() || null;
  if (aiProvider === 'recorded') {
    if (nodeEnv === 'production') errors.push('AI_PROVIDER=recorded is not allowed in production');
    if (!recordingsDir) errors.push('AI_RECORDINGS_DIR is required when AI_PROVIDER=recorded');
  }
  const apiKey = String(raw.ANTHROPIC_API_KEY ?? '').trim() || null;
  if (aiProvider === 'anthropic' && !apiKey) {
    // Never echo the value; only its absence.
    errors.push('ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic');
  }
  const aiEffort = String(raw.AI_EFFORT ?? 'medium').trim() || 'medium';
  if (!['low', 'medium', 'high'].includes(aiEffort)) {
    errors.push('AI_EFFORT must be low|medium|high');
  }
  const maxCostRaw = raw.AI_MAX_COST_USD_PER_RUN;
  const aiMaxCost = maxCostRaw === undefined || maxCostRaw === '' ? 0.1 : Number(maxCostRaw);
  if (!Number.isFinite(aiMaxCost) || aiMaxCost <= 0 || aiMaxCost > 10) {
    errors.push('AI_MAX_COST_USD_PER_RUN must be a number greater than 0 and at most 10');
  }
  const aiModel = String(raw.AI_MODEL ?? ALLOWED_AI_MODELS[0]).trim() || ALLOWED_AI_MODELS[0];
  if (!(ALLOWED_AI_MODELS as readonly string[]).includes(aiModel)) {
    errors.push(`AI_MODEL must be one of ${ALLOWED_AI_MODELS.join('|')}`);
  }
  const intIn = (name: string, fallback: number, min: number, max: number): number => {
    const v = parsePositiveInt(raw[name], fallback);
    if (!Number.isInteger(v) || v < min || v > max) {
      errors.push(`${name} must be an integer between ${min} and ${max}`);
    }
    return v;
  };
  const aiWorkerPollMs = intIn('AI_WORKER_POLL_MS', nodeEnv === 'test' ? 0 : 2000, 0, 60_000);
  const aiLeaseMs = intIn('AI_LEASE_MS', 300_000, 10_000, 3_600_000);
  const aiRetentionDays = intIn('AI_RETENTION_DAYS', 90, 1, 3650);
  const aiMaxDocuments = intIn('AI_MAX_DOCUMENTS_PER_RUN', 15, 1, 30);
  const aiRequestTimeoutMs = intIn('AI_REQUEST_TIMEOUT_MS', 60_000, 5_000, 600_000);
  const aiMaxPages = intIn('AI_MAX_PAGES_PER_DOCUMENT', 10, 1, 100);

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n - ${errors.join('\n - ')}`);
  }

  return {
    NODE_ENV: nodeEnv as Env['NODE_ENV'],
    API_PORT: port,
    DATABASE_URL: databaseUrl as string,
    WEB_ORIGIN: webOrigin,
    SESSION_TTL_HOURS: sessionTtl,
    COOKIE_SECURE: cookieSecure as boolean,
    LOGIN_RATE_LIMIT: loginRateLimit,
    LOG_LEVEL: logLevel as Env['LOG_LEVEL'],
    STORAGE_DIR: storageDir,
    AI_PROVIDER: aiProvider as Env['AI_PROVIDER'],
    AI_RECORDINGS_DIR: recordingsDir,
    ANTHROPIC_API_KEY: apiKey,
    AI_REQUEST_TIMEOUT_MS: aiRequestTimeoutMs,
    AI_EFFORT: aiEffort as Env['AI_EFFORT'],
    AI_MAX_PAGES_PER_DOCUMENT: aiMaxPages,
    AI_MAX_COST_USD_PER_RUN: aiMaxCost,
    AI_MODEL: aiModel as AllowedAiModel,
    AI_WORKER_POLL_MS: aiWorkerPollMs,
    AI_LEASE_MS: aiLeaseMs,
    AI_RETENTION_DAYS: aiRetentionDays,
    AI_MAX_DOCUMENTS_PER_RUN: aiMaxDocuments,
  };
}
