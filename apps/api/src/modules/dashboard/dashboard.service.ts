import { Injectable } from '@nestjs/common';
import { APPLICATION_STATUSES, ApplicationStatus, Permission } from '@creditflow/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { AuthUser } from '../auth/auth-user.js';
import type { DashboardMetricsDto, DurationMetricDto, StatusCountsDto } from './dashboard.dto.js';

const ACTIVE_STATUSES = [
  ApplicationStatus.SUBMITTED,
  ApplicationStatus.UNDER_REVIEW,
  ApplicationStatus.PENDING_INFORMATION,
];

const DEFINITIONS = {
  openToDecision:
    'Média de (data da decisão − data de abertura) das solicitações aprovadas ou reprovadas.',
  submissionToDecision:
    'Média de (data da decisão − data do envio para análise) das solicitações aprovadas ou reprovadas.',
};

/**
 * Operational indicators computed on every request from the database
 * (roadmap §4.1: no static numbers). Small dataset; no caching needed.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async metrics(actor: AuthUser): Promise<DashboardMetricsDto> {
    // Same visibility as the application list: analysts do not see drafts.
    const seesDrafts = actor.permissions.includes(Permission.APPLICATION_WRITE);
    const visible: Prisma.CreditApplicationWhereInput = seesDrafts
      ? {}
      : { status: { not: ApplicationStatus.DRAFT } };

    const [grouped, withOpenIssues, assignedToMe, durations] = await Promise.all([
      this.prisma.creditApplication.groupBy({
        by: ['status'],
        where: visible,
        _count: { _all: true },
      }),
      this.prisma.creditApplication.count({
        where: { status: { in: ACTIVE_STATUSES }, issues: { some: { status: 'OPEN' } } },
      }),
      actor.permissions.includes(Permission.APPLICATION_REVIEW)
        ? this.prisma.creditApplication.count({
            where: {
              assigneeId: actor.id,
              status: {
                in: [ApplicationStatus.UNDER_REVIEW, ApplicationStatus.PENDING_INFORMATION],
              },
            },
          })
        : Promise.resolve(null),
      this.durations(),
    ]);

    const byStatus = Object.fromEntries(
      APPLICATION_STATUSES.map((s) => [s, 0]),
    ) as unknown as StatusCountsDto;
    for (const g of grouped) byStatus[g.status] = g._count._all;
    if (!seesDrafts) byStatus.DRAFT = 0;

    return {
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      byStatus,
      awaitingReview: byStatus.SUBMITTED,
      underReview: byStatus.UNDER_REVIEW,
      pendingInformation: byStatus.PENDING_INFORMATION,
      withOpenIssues,
      approved: byStatus.APPROVED,
      rejected: byStatus.REJECTED,
      assignedToMe,
      openToDecision: durations.openToDecision,
      submissionToDecision: durations.submissionToDecision,
      generatedAt: new Date(),
    };
  }

  /** Averages computed in SQL over decided applications (APPROVED/REJECTED). */
  private async durations(): Promise<{
    openToDecision: DurationMetricDto;
    submissionToDecision: DurationMetricDto;
  }> {
    const [row] = await this.prisma.$queryRaw<
      { open_avg: number | null; open_n: bigint; submit_avg: number | null; submit_n: bigint }[]
    >(Prisma.sql`
      SELECT
        AVG(EXTRACT(EPOCH FROM (decided_at - created_at)) / 3600)::float8 AS open_avg,
        COUNT(*) AS open_n,
        (AVG(EXTRACT(EPOCH FROM (decided_at - submitted_at)) / 3600)
          FILTER (WHERE submitted_at IS NOT NULL))::float8 AS submit_avg,
        COUNT(*) FILTER (WHERE submitted_at IS NOT NULL) AS submit_n
      FROM credit_applications
      WHERE status IN ('APPROVED', 'REJECTED') AND decided_at IS NOT NULL
    `);
    const metric = (avg: number | null, n: bigint, definition: string): DurationMetricDto => ({
      averageHours: n > 0n && avg !== null ? Math.round(avg * 10) / 10 : null,
      sampleSize: Number(n),
      definition,
    });
    return {
      openToDecision: metric(row?.open_avg ?? null, row?.open_n ?? 0n, DEFINITIONS.openToDecision),
      submissionToDecision: metric(
        row?.submit_avg ?? null,
        row?.submit_n ?? 0n,
        DEFINITIONS.submissionToDecision,
      ),
    };
  }
}
