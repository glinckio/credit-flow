import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

type Writer = Pick<
  Prisma.TransactionClient,
  'creditApplication' | 'applicationStatusHistory' | 'applicationIssue' | 'creditDocument' | 'user'
>;

const userRef = { select: { id: true, name: true } } as const;

export const applicationInclude = {
  customer: {
    select: { id: true, name: true, type: true, documentNumber: true, status: true },
  },
  assignee: userRef,
  createdBy: userRef,
  _count: {
    select: {
      documents: { where: { deletedAt: null } },
      issues: { where: { status: 'OPEN' } },
    },
  },
} satisfies Prisma.CreditApplicationInclude;

export type ApplicationWithRefs = Prisma.CreditApplicationGetPayload<{
  include: typeof applicationInclude;
}>;

const issueInclude = {
  createdBy: userRef,
  resolvedBy: userRef,
} satisfies Prisma.ApplicationIssueInclude;
export type IssueWithRefs = Prisma.ApplicationIssueGetPayload<{ include: typeof issueInclude }>;

/** Thin data-access layer for applications, status history and issues (plan, D4). */
@Injectable()
export class ApplicationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(params: {
    where: Prisma.CreditApplicationWhereInput;
    orderBy: Prisma.CreditApplicationOrderByWithRelationInput;
    skip: number;
    take: number;
  }): Promise<[ApplicationWithRefs[], number]> {
    return this.prisma.$transaction([
      this.prisma.creditApplication.findMany({ ...params, include: applicationInclude }),
      this.prisma.creditApplication.count({ where: params.where }),
    ]);
  }

  findById(id: string, writer: Writer = this.prisma): Promise<ApplicationWithRefs | null> {
    return writer.creditApplication.findUnique({ where: { id }, include: applicationInclude });
  }

  create(writer: Writer, data: Prisma.CreditApplicationUncheckedCreateInput) {
    return writer.creditApplication.create({ data, include: applicationInclude });
  }

  /**
   * Conditional update used for every state change and edit: applies only if
   * the row still matches `expected` (status and/or version). Returns false if
   * a concurrent request changed it first (plan, D19).
   */
  async updateIf(
    writer: Writer,
    id: string,
    expected: { status?: Prisma.CreditApplicationWhereInput['status']; version?: number },
    data: Prisma.CreditApplicationUncheckedUpdateManyInput,
  ): Promise<boolean> {
    const { count } = await writer.creditApplication.updateMany({
      where: { id, ...expected },
      data: { ...data, version: { increment: 1 } },
    });
    return count === 1;
  }

  addStatusHistory(writer: Writer, data: Prisma.ApplicationStatusHistoryUncheckedCreateInput) {
    return writer.applicationStatusHistory.create({ data });
  }

  statusHistory(applicationId: string) {
    return this.prisma.applicationStatusHistory.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'asc' },
      include: { actor: userRef },
    });
  }

  /** Distinct types of active (not removed) documents attached to the application. */
  async activeDocumentTypes(writer: Writer, applicationId: string): Promise<string[]> {
    const docs = await writer.creditDocument.findMany({
      where: { applicationId, deletedAt: null },
      select: { type: true },
      distinct: ['type'],
    });
    return docs.map((d) => d.type);
  }

  countOpenIssues(writer: Writer, applicationId: string): Promise<number> {
    return writer.applicationIssue.count({ where: { applicationId, status: 'OPEN' } });
  }

  findActiveUser(writer: Writer, id: string) {
    return writer.user.findFirst({ where: { id, active: true }, select: { id: true, role: true } });
  }

  // ── issues ──

  listIssues(applicationId: string, status?: Prisma.ApplicationIssueWhereInput['status']) {
    return this.prisma.applicationIssue.findMany({
      where: { applicationId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'asc' },
      include: issueInclude,
    });
  }

  findIssue(id: string) {
    return this.prisma.applicationIssue.findUnique({ where: { id }, include: issueInclude });
  }

  createIssue(writer: Writer, data: Prisma.ApplicationIssueUncheckedCreateInput) {
    return writer.applicationIssue.create({ data, include: issueInclude });
  }

  /** Resolves an issue only if it is still open. Returns false otherwise. */
  async resolveIssueIfOpen(
    writer: Writer,
    id: string,
    data: { resolvedById: string; resolutionNote: string },
  ): Promise<boolean> {
    const { count } = await writer.applicationIssue.updateMany({
      where: { id, status: 'OPEN' },
      data: { ...data, status: 'RESOLVED', resolvedAt: new Date() },
    });
    return count === 1;
  }
}
