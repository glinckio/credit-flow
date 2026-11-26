import { Injectable } from '@nestjs/common';
import { ApplicationStatus, IssueStatus } from '@creditflow/shared';
import { Problems } from '../../common/http/app-exception.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth-user.js';
import type { CreateIssueDto, IssueDto, ResolveIssueDto } from './applications.dto.js';
import { ApplicationsRepository, type IssueWithRefs } from './applications.repository.js';
import { ApplicationsService } from './applications.service.js';

/** Issues (pendências) can be managed only while the analysis is in progress. */
const ISSUE_STATUSES: readonly ApplicationStatus[] = [
  ApplicationStatus.UNDER_REVIEW,
  ApplicationStatus.PENDING_INFORMATION,
];

function toIssueDto(i: IssueWithRefs): IssueDto {
  return {
    id: i.id,
    applicationId: i.applicationId,
    description: i.description,
    status: i.status,
    createdBy: i.createdBy,
    createdAt: i.createdAt,
    resolvedBy: i.resolvedBy,
    resolvedAt: i.resolvedAt,
    resolutionNote: i.resolutionNote,
  };
}

@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ApplicationsRepository,
    private readonly applications: ApplicationsService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, applicationId: string, status?: IssueStatus): Promise<IssueDto[]> {
    await this.applications.getVisibleOrThrow(actor, applicationId);
    return (await this.repo.listIssues(applicationId, status)).map(toIssueDto);
  }

  async create(actor: AuthUser, applicationId: string, dto: CreateIssueDto): Promise<IssueDto> {
    return this.prisma.$transaction(async (tx) => {
      const app = await this.applications.getVisibleOrThrow(actor, applicationId, tx);
      this.assertInReview(app.status);
      this.applications.assertAssignee(actor, app);

      const issue = await this.repo.createIssue(tx, {
        applicationId,
        description: dto.description,
        createdById: actor.id,
      });
      await this.audit.record(tx, {
        actorId: actor.id,
        action: 'issue.created',
        entityType: 'ApplicationIssue',
        entityId: issue.id,
        after: { applicationId, status: issue.status, description: issue.description },
      });
      return toIssueDto(issue);
    });
  }

  async resolve(actor: AuthUser, issueId: string, dto: ResolveIssueDto): Promise<IssueDto> {
    const issue = await this.repo.findIssue(issueId);
    if (!issue) throw Problems.notFound('Pendência');

    return this.prisma.$transaction(async (tx) => {
      const app = await this.applications.getVisibleOrThrow(actor, issue.applicationId, tx);
      this.assertInReview(app.status);
      this.applications.assertAssignee(actor, app);

      const resolved = await this.repo.resolveIssueIfOpen(tx, issueId, {
        resolvedById: actor.id,
        resolutionNote: dto.resolutionNote,
      });
      if (!resolved) throw Problems.conflict('issue-already-resolved', 'Pendência já resolvida');

      await this.audit.record(tx, {
        actorId: actor.id,
        action: 'issue.resolved',
        entityType: 'ApplicationIssue',
        entityId: issueId,
        before: { status: IssueStatus.OPEN },
        after: { status: IssueStatus.RESOLVED, resolutionNote: dto.resolutionNote },
      });
      return toIssueDto(
        (await tx.applicationIssue.findUnique({
          where: { id: issueId },
          include: {
            createdBy: { select: { id: true, name: true } },
            resolvedBy: { select: { id: true, name: true } },
          },
        }))!,
      );
    });
  }

  private assertInReview(status: ApplicationStatus): void {
    if (!ISSUE_STATUSES.includes(status)) {
      throw Problems.conflict(
        'application-not-in-review',
        'Pendências só podem ser registradas ou resolvidas durante a análise',
        undefined,
        { currentStatus: status },
      );
    }
  }
}
