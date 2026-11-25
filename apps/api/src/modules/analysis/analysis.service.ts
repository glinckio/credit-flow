import { Injectable } from '@nestjs/common';
import {
  ApplicationAction,
  ApplicationStatus,
  DecisionOutcome,
  INDICATORS_DISCLAIMER,
  computeIndicators,
} from '@creditflow/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { Problems } from '../../common/http/app-exception.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth-user.js';
import { ApplicationsService } from '../applications/applications.service.js';
import type { ApplicationDto } from '../applications/applications.dto.js';
import type {
  CreateReviewDto,
  DecisionDto,
  IndicatorsDto,
  RecordDecisionDto,
  ReviewDto,
} from './analysis.dto.js';

/** Reviews (pareceres) are written while the analysis is in progress. */
const REVIEW_STATUSES: readonly ApplicationStatus[] = [
  ApplicationStatus.UNDER_REVIEW,
  ApplicationStatus.PENDING_INFORMATION,
];

const userRef = { select: { id: true, name: true } } as const;
type Tx = Prisma.TransactionClient;

@Injectable()
export class AnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly applications: ApplicationsService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────────── indicators ─────────────────────────────

  async indicators(actor: AuthUser, applicationId: string): Promise<IndicatorsDto> {
    const app = await this.applications.getVisibleOrThrow(actor, applicationId);
    return {
      indicators: computeIndicators({
        requestedAmount: app.requestedAmount.toFixed(2),
        termMonths: app.termMonths,
        declaredMonthlyIncome: app.declaredMonthlyIncome.toFixed(2),
        declaredMonthlyCommitments: app.declaredMonthlyCommitments?.toFixed(2) ?? null,
      }),
      disclaimer: INDICATORS_DISCLAIMER,
    };
  }

  // ───────────────────────────── reviews ─────────────────────────────

  async listReviews(actor: AuthUser, applicationId: string): Promise<ReviewDto[]> {
    await this.applications.getVisibleOrThrow(actor, applicationId);
    const rows = await this.prisma.creditReview.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
      include: { author: userRef },
    });
    return rows.map((r, i) => ({
      id: r.id,
      applicationId: r.applicationId,
      author: r.author,
      recommendation: r.recommendation,
      analysisNotes: r.analysisNotes,
      justification: r.justification,
      current: i === 0,
      createdAt: r.createdAt,
    }));
  }

  /** Append-only: a new review supersedes the previous ones, which stay visible. */
  async createReview(
    actor: AuthUser,
    applicationId: string,
    dto: CreateReviewDto,
  ): Promise<ReviewDto> {
    return this.prisma.$transaction(async (tx) => {
      const app = await this.applications.getVisibleOrThrow(actor, applicationId, tx);
      if (!REVIEW_STATUSES.includes(app.status)) {
        throw Problems.conflict(
          'application-not-in-review',
          'Pareceres só podem ser registrados durante a análise',
          undefined,
          { currentStatus: app.status },
        );
      }
      this.applications.assertAssignee(actor, app);

      const review = await tx.creditReview.create({
        data: {
          applicationId,
          authorId: actor.id,
          recommendation: dto.recommendation,
          analysisNotes: dto.analysisNotes,
          justification: dto.justification,
        },
        include: { author: userRef },
      });
      await this.audit.record(tx, {
        actorId: actor.id,
        action: 'review.created',
        entityType: 'CreditReview',
        entityId: review.id,
        after: {
          applicationId,
          recommendation: review.recommendation,
          justification: review.justification,
        },
      });
      return {
        id: review.id,
        applicationId,
        author: review.author,
        recommendation: review.recommendation,
        analysisNotes: review.analysisNotes,
        justification: review.justification,
        current: true,
        createdAt: review.createdAt,
      };
    });
  }

  // ───────────────────────────── decision ─────────────────────────────

  async getDecision(actor: AuthUser, applicationId: string): Promise<DecisionDto> {
    await this.applications.getVisibleOrThrow(actor, applicationId);
    const decision = await this.prisma.creditDecision.findUnique({
      where: { applicationId },
      include: { decidedBy: userRef, review: { select: { recommendation: true } } },
    });
    if (!decision) throw Problems.notFound('Decisão');
    return {
      id: decision.id,
      applicationId,
      outcome: decision.outcome,
      justification: decision.justification,
      decidedBy: decision.decidedBy,
      decidedAt: decision.decidedAt,
      reviewId: decision.reviewId,
      reviewRecommendation: decision.review.recommendation,
    };
  }

  /**
   * Final, human credit decision (roadmap §4.5). Goes through the same
   * race-safe transition pipeline as every other status change.
   *
   * Rules: application UNDER_REVIEW; permission `application.decide`; a current
   * review must exist; approval requires no open issues; justification is
   * mandatory. The decision may differ from the review's recommendation — the
   * justification records why.
   */
  async decide(
    actor: AuthUser,
    applicationId: string,
    dto: RecordDecisionDto,
  ): Promise<ApplicationDto> {
    const approve = dto.outcome === DecisionOutcome.APPROVED;
    let reviewId = '';

    return this.applications.transition(
      actor,
      applicationId,
      approve ? ApplicationAction.APPROVE : ApplicationAction.REJECT,
      {
        reason: dto.justification,
        precheck: async (app, tx) => {
          const review = await this.currentReview(tx, app.id);
          if (!review) {
            throw Problems.businessRule(
              'review-required',
              'Registre um parecer antes da decisão',
              'A decisão final referencia o parecer vigente.',
            );
          }
          reviewId = review.id;
          if (approve) {
            const open = await tx.applicationIssue.count({
              where: { applicationId: app.id, status: 'OPEN' },
            });
            if (open > 0) {
              throw Problems.businessRule(
                'open-issues',
                'Há pendências abertas',
                'Resolva todas as pendências antes de aprovar.',
              );
            }
          }
        },
        data: (_app, now) => ({ decidedAt: now, closedAt: now }),
        afterward: async (app, tx) => {
          const decision = await tx.creditDecision.create({
            data: {
              applicationId: app.id,
              outcome: dto.outcome,
              justification: dto.justification,
              decidedById: actor.id,
              reviewId,
            },
          });
          await this.audit.record(tx, {
            actorId: actor.id,
            action: 'decision.recorded',
            entityType: 'CreditDecision',
            entityId: decision.id,
            after: {
              applicationId: app.id,
              outcome: decision.outcome,
              justification: decision.justification,
              reviewId,
            },
          });
        },
      },
    );
  }

  private currentReview(tx: Tx, applicationId: string) {
    return tx.creditReview.findFirst({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
  }
}
