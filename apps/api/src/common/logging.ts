import type { Params } from 'nestjs-pino';
import type { Env } from '../config/env.js';
import { resolveRequestId } from './request-context.middleware.js';

/**
 * Paths removed from every log line. Logs must not carry secrets nor personal
 * data that is not needed for operations (roadmap §8).
 */
export const LOG_REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.initialPassword',
  '*.temporaryPassword',
  '*.passwordHash',
  '*.token',
  '*.documentNumber',
  '*.email',
  '*.phone',
];

export function buildLoggerParams(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      genReqId: (req, res) => resolveRequestId(req as never, res as never),
      redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
      // Request bodies and query strings are never logged.
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          path: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
    },
  };
}
