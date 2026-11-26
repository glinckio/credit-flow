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
  };
}
