import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Problems } from '../../common/http/app-exception.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { hashPassword, verifyPassword } from '../../infra/security/password.js';
import { AuditService } from '../audit/audit.service.js';
import { type AuthUser, toAuthUser } from './auth-user.js';
import { SessionService } from './session.service.js';

@Injectable()
export class AuthService {
  /** Verified against when the e-mail is unknown, so response time does not reveal it. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async login(
    email: string,
    password: string,
    userAgent: string | undefined,
  ): Promise<{ token: string; user: AuthUser }> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    let passwordOk: boolean;
    if (user) {
      passwordOk = await verifyPassword(user.passwordHash, password);
    } else {
      this.dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
      await verifyPassword(await this.dummyHash, password);
      passwordOk = false;
    }

    if (!user || !passwordOk || !user.active) {
      const reason = !user ? 'unknown_user' : !passwordOk ? 'wrong_password' : 'inactive_user';
      await this.audit.record(this.prisma, {
        actorId: user?.id ?? null,
        action: 'auth.login_failed',
        entityType: 'User',
        entityId: user?.id ?? 'unknown',
        metadata: { reason },
      });
      // Same answer for every failure: do not reveal which accounts exist or are inactive.
      throw Problems.invalidCredentials();
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
      const { token, sessionId } = await this.sessions.create(tx, user.id, userAgent);
      await this.audit.record(tx, {
        actorId: user.id,
        action: 'auth.login_succeeded',
        entityType: 'User',
        entityId: user.id,
        metadata: { sessionId },
      });
      return { token, user: toAuthUser(updated) };
    });
  }

  async logout(user: AuthUser, sessionId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.sessions.revoke(tx, sessionId);
      await this.audit.record(tx, {
        actorId: user.id,
        action: 'auth.logout',
        entityType: 'User',
        entityId: user.id,
        metadata: { sessionId },
      });
    });
  }

  /** Replaces the password, clears the temporary-password flag and ends all other sessions. */
  async changePassword(
    user: AuthUser,
    sessionId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<AuthUser> {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verifyPassword(record.passwordHash, currentPassword))) {
      throw Problems.businessRule('wrong-current-password', 'Senha atual incorreta');
    }
    if (currentPassword === newPassword) {
      throw Problems.businessRule('password-reused', 'A nova senha deve ser diferente da atual');
    }
    const passwordHash = await hashPassword(newPassword);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false },
      });
      const revoked = await this.sessions.revokeAllForUser(tx, user.id, sessionId);
      await this.audit.record(tx, {
        actorId: user.id,
        action: 'auth.password_changed',
        entityType: 'User',
        entityId: user.id,
        before: { mustChangePassword: record.mustChangePassword },
        after: { mustChangePassword: false },
        metadata: { otherSessionsRevoked: revoked },
      });
      return toAuthUser(updated);
    });
  }
}
