import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { runWithRequestContext } from './request-context.js';

const REQUEST_ID_HEADER = 'x-request-id';
const VALID_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Accepts a well-formed incoming X-Request-Id (or generates one), exposes it on
 * `req.id` (shared with pino-http) and in the response header, and opens the
 * AsyncLocalStorage request context used by audit and logging.
 */
export function resolveRequestId(req: Request, res: Response): string {
  if (req.id) return String(req.id);
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = resolveRequestId(req, res);
    runWithRequestContext(
      { requestId, ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 256) },
      next,
    );
  }
}
