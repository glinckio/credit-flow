import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { fieldValidationError } from '../../common/http/app-exception.js';
import { type Page, page, parseSort, toSkipTake } from '../../common/pagination.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { AuditEventDto, ListAuditEventsQueryDto } from './audit-query.dto.js';

/** Read side of the audit trail (admin only). The trail itself is append-only. */
@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: ListAuditEventsQueryDto): Promise<Page<AuditEventDto>> {
    const from = q.from ? new Date(q.from) : undefined;
    const to = q.to ? new Date(q.to) : undefined;
    if (from && to && from >= to)
      throw fieldValidationError('to', '"to" deve ser posterior a "from"');

    const where: Prisma.AuditEventWhereInput = {
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.action
        ? q.action.endsWith('.')
          ? { action: { startsWith: q.action } }
          : { action: q.action }
        : {}),
      ...(from || to
        ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
        : {}),
    };
    const order = parseSort(q.sort, ['occurredAt'] as const, {
      field: 'occurredAt',
      direction: 'desc',
    });

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditEvent.findMany({
        where,
        // id breaks ties between events of the same millisecond, in insertion order.
        orderBy: [order, { id: order.occurredAt }],
        include: { actor: { select: { id: true, name: true, email: true } } },
        ...toSkipTake(q),
      }),
      this.prisma.auditEvent.count({ where }),
    ]);

    return page(
      rows.map((e) => ({
        id: e.id.toString(),
        occurredAt: e.occurredAt,
        actor: e.actor,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        before: e.before,
        after: e.after,
        metadata: e.metadata,
      })),
      total,
      q,
    );
  }
}
