import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions } from 'express';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Env } from '../../config/env.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

export const SESSION_COOKIE = 'cf_session';
/** Avoid a database write on every request: refresh the sliding expiry at most once a minute. */
const TOUCH_INTERVAL_MS = 60_000;

type SessionWriter = Pick<Prisma.TransactionClient, 'session'>;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Opaque, server-side sessions (plan, D10). The browser holds a random 256-bit
 * token in an httpOnly cookie; the database holds only its SHA-256.
 */
@Injectable()
export class SessionService {
  private readonly ttlMs: number;
  private readonly secure: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlMs = config.get('SESSION_TTL_HOURS', { infer: true }) * 3_600_000;
    this.secure = config.get('COOKIE_SECURE', { infer: true });
  }

  cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      path: '/api',
      maxAge: this.ttlMs,
    };
  }

  async create(
    writer: SessionWriter,
    userId: string,
    userAgent: string | undefined,
  ): Promise<{ token: string; sessionId: string }> {
    const token = randomBytes(32).toString('base64url');
    const session = await writer.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + this.ttlMs),
        userAgent: userAgent?.slice(0, 256),
      },
    });
    return { token, sessionId: session.id };
  }

  /**
   * Returns the session and its (active) user, or null. Extends the sliding
   * expiry; `refreshed` tells the caller to re-send the cookie.
   */
  async validate(token: string) {
    const now = new Date();
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= now || !session.user.active) {
      return null;
    }
    let refreshed = false;
    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: now, expiresAt: new Date(now.getTime() + this.ttlMs) },
      });
      refreshed = true;
    }
    return { session, user: session.user, refreshed };
  }

  async revoke(writer: SessionWriter, sessionId: string): Promise<void> {
    await writer.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every active session of a user (optionally keeping the current one). */
  async revokeAllForUser(
    writer: SessionWriter,
    userId: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const { count } = await writer.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return count;
  }
}
