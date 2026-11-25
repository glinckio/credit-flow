import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

export const LOGIN_THROTTLER = 'login';

/**
 * Brute-force mitigation for POST /auth/login (plan, D14): N attempts per
 * minute per (IP + e-mail). Applied only to the login route.
 */
@Injectable()
export class LoginThrottleGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const r = req as unknown as Request;
    const email = typeof r.body?.email === 'string' ? r.body.email.trim().toLowerCase() : '';
    return `${r.ip ?? 'unknown'}|${email}`;
  }
}
