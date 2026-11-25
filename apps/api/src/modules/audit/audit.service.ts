import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { currentRequestContext } from '../../common/request-context.js';

/** Anything that can write audit rows: the PrismaService or an interactive transaction. */
export type AuditWriter = Pick<Prisma.TransactionClient, 'auditEvent'>;

export interface AuditInput {
  /** Null for anonymous/system actions (e.g. failed login of an unknown e-mail). */
  actorId: string | null;
  /** Dotted verb, e.g. `user.created`, `auth.login_failed`. */
  action: string;
  entityType: string;
  entityId: string;
  /** Allow-listed snapshot of the entity before the change. */
  before?: Record<string, unknown> | null;
  /** Allow-listed snapshot of the entity after the change. */
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

/** Keys that must never reach the audit trail, whatever the caller passes. */
const FORBIDDEN_KEY = /password|token|hash|secret|cookie|authorization/i;

/** Deep-copies a value into JSON-safe form, dropping forbidden keys. */
export function sanitizeForAudit(value: unknown): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toFixed();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map((v) => sanitizeForAudit(v)) as Prisma.InputJsonValue;
  if (typeof value === 'object') {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, v] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key) || v === undefined) continue;
      out[key] = sanitizeForAudit(v);
    }
    return out as Prisma.InputJsonValue;
  }
  return value as Prisma.InputJsonValue;
}

/**
 * Writes audit events. Callers pass the transaction they are already in, so the
 * business change and its audit row commit or roll back together (plan, D17).
 */
@Injectable()
export class AuditService {
  async record(writer: AuditWriter, input: AuditInput): Promise<void> {
    const ctx = currentRequestContext();
    await writer.auditEvent.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: sanitizeForAudit(input.before) ?? Prisma.DbNull,
        after: sanitizeForAudit(input.after) ?? Prisma.DbNull,
        metadata:
          sanitizeForAudit({
            requestId: ctx?.requestId,
            ip: ctx?.ip,
            userAgent: ctx?.userAgent,
            ...input.metadata,
          }) ?? Prisma.DbNull,
      },
    });
  }
}
