/**
 * Environment validation. The API refuses to start with missing or malformed
 * configuration (fail fast) instead of failing later on first use.
 */
export interface Env {
  NODE_ENV: 'development' | 'test' | 'production';
  API_PORT: number;
  DATABASE_URL: string;
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const errors: string[] = [];

  const nodeEnv = String(raw.NODE_ENV ?? 'development');
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    errors.push(`NODE_ENV must be development|test|production (got "${nodeEnv}")`);
  }

  const port = Number(raw.API_PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    errors.push('API_PORT must be a valid TCP port');
  }

  const databaseUrl = raw.DATABASE_URL;
  if (typeof databaseUrl !== 'string' || !/^postgres(ql)?:\/\//.test(databaseUrl)) {
    errors.push('DATABASE_URL must be a postgresql:// connection string');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n - ${errors.join('\n - ')}`);
  }

  return {
    NODE_ENV: nodeEnv as Env['NODE_ENV'],
    API_PORT: port,
    DATABASE_URL: databaseUrl as string,
  };
}
