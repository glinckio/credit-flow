import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../../config/env.js';
import { Problems } from './app-exception.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_HEADER = 'x-requested-with';

/**
 * CSRF defence in depth for cookie-authenticated, state-changing requests
 * (plan, D11), on top of the SameSite=Lax session cookie:
 *
 * 1. A custom header is mandatory. Browsers cannot attach custom headers to
 *    cross-site requests without a CORS preflight, and CORS is disabled.
 * 2. If the browser sends an Origin header, it must be the web app's origin.
 *
 * Registered as the first global guard, so it runs before authentication and
 * its errors go through the Problem Details filter.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowedOrigin: string;

  constructor(config: ConfigService<Env, true>) {
    this.allowedOrigin = config.get('WEB_ORIGIN', { infer: true });
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;

    const origin = req.headers.origin;
    if (origin !== undefined && origin !== this.allowedOrigin) throw Problems.csrf();
    if (!req.headers[CSRF_HEADER]) throw Problems.csrf();
    return true;
  }
}
