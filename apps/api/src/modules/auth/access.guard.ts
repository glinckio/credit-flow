import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Problems } from '../../common/http/app-exception.js';
import {
  ACCESS_METADATA,
  type AccessRule,
  PASSWORD_CHANGE_PENDING_OK,
} from './access.decorators.js';
import { toAuthUser } from './auth-user.js';
import { SESSION_COOKIE, SessionService } from './session.service.js';

/**
 * Global authentication + authorization guard (plan, D13). Default deny:
 * a route without an access declaration is refused.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  private readonly logger = new Logger(AccessGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_METADATA, targets);

    if (!rule) {
      this.logger.error(
        `Route ${context.getClass().name}.${context.getHandler().name} has no access declaration; denying.`,
      );
      throw Problems.forbidden();
    }
    if (rule.kind === 'public') return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const token: unknown = req.cookies?.[SESSION_COOKIE];
    const result = typeof token === 'string' && token ? await this.sessions.validate(token) : null;
    if (!result) {
      if (token)
        res.clearCookie(SESSION_COOKIE, { ...this.sessions.cookieOptions(), maxAge: undefined });
      throw Problems.unauthenticated();
    }
    if (result.refreshed) res.cookie(SESSION_COOKIE, token, this.sessions.cookieOptions());

    const user = toAuthUser(result.user);
    req.user = user;
    req.sessionId = result.session.id;

    const pendingOk = this.reflector.getAllAndOverride<boolean>(
      PASSWORD_CHANGE_PENDING_OK,
      targets,
    );
    if (user.mustChangePassword && !pendingOk) throw Problems.passwordChangeRequired();

    if (rule.kind === 'permissions') {
      const missing = rule.permissions.filter((p) => !user.permissions.includes(p));
      if (missing.length > 0) throw Problems.forbidden();
    }
    if (rule.kind === 'anyPermission') {
      if (!rule.permissions.some((p) => user.permissions.includes(p))) throw Problems.forbidden();
    }
    return true;
  }
}
