import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ApplicationAction,
  ApplicationStatus,
  CustomerStatus,
  DocumentType,
  Permission,
  REQUIRED_DOCUMENT_TYPES,
  Role,
  TRANSITIONS,
  availableActions,
  canTransition,
  formatApplicationCode,
  hasTransitionPermission,
  isEditable,
  nextStatus,
} from '@creditflow/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { AppException, Problems, fieldValidationError } from '../../common/http/app-exception.js';
import { type Page, page, parseSort, toSkipTake } from '../../common/pagination.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth-user.js';
import { CustomersService } from '../customers/customers.service.js';
import type {
  ApplicationDto,
  CreateApplicationDto,
  ListApplicationsQueryDto,
  StatusHistoryEntryDto,
  UpdateApplicationDto,
} from './applications.dto.js';
import { type ApplicationWithRefs, ApplicationsRepository } from './applications.repository.js';

type Tx = Prisma.TransactionClient;

const SORTABLE = ['createdAt', 'updatedAt', 'submittedAt', 'requestedAmount', 'number'] as const;
const EDITABLE_FIELDS = [
  'productType',
  'requestedAmount',
  'termMonths',
  'purpose',
  'declaredMonthlyIncome',
  'declaredMonthlyCommitments',
] as const;

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  IDENTIFICATION: 'documento de identificação',
  PROOF_OF_ADDRESS: 'comprovante de endereço',
  PROOF_OF_INCOME: 'comprovante de renda/faturamento',
  BANK_STATEMENT: 'extrato bancário',
  OTHER: 'outro documento',
};

const money = (d: Prisma.Decimal | null) => (d === null ? null : d.toFixed(2));

export function toApplicationDto(a: ApplicationWithRefs, actor: AuthUser): ApplicationDto {
  return {
    id: a.id,
    number: a.number,
    code: formatApplicationCode(a.number, a.createdAt),
    customer: a.customer,
    productType: a.productType,
    requestedAmount: money(a.requestedAmount)!,
    termMonths: a.termMonths,
    purpose: a.purpose,
    declaredMonthlyIncome: money(a.declaredMonthlyIncome)!,
    declaredMonthlyCommitments: money(a.declaredMonthlyCommitments),
    status: a.status,
    assignee: a.assignee,
    createdBy: a.createdBy,
    submittedAt: a.submittedAt,
    decidedAt: a.decidedAt,
    closedAt: a.closedAt,
    version: a.version,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    documentCount: a._count.documents,
    openIssueCount: a._count.issues,
    availableActions: availableActions(a.status, actor.permissions),
  };
}

/** Audit snapshot of the editable business fields (no customer personal data). */
function editableSnapshot(a: ApplicationWithRefs) {
  return Object.fromEntries(
    EDITABLE_FIELDS.map((f) => {
      const v: unknown = a[f];
      return [f, Prisma.Decimal.isDecimal(v) ? (v as Prisma.Decimal).toFixed(2) : v];
    }),
  );
}

function notAssignee(): AppException {
  return new AppException(
    HttpStatus.FORBIDDEN,
    'not-assignee',
    'Ação restrita ao analista responsável',
    'Assuma a análise (ou peça a um administrador para atribuí-la) antes de continuar.',
  );
}

interface TransitionOptions {
  reason?: string;
  /** Extra columns written together with the status change. */
  data?: (app: ApplicationWithRefs, now: Date) => Prisma.CreditApplicationUncheckedUpdateManyInput;
  /** Contextual business rules, evaluated inside the transaction. */
  precheck?: (app: ApplicationWithRefs, tx: Tx) => Promise<void>;
  /** Extra audit events written in the same transaction. */
  afterward?: (app: ApplicationWithRefs, tx: Tx) => Promise<void>;
}

/** Published after a status change has been COMMITTED. */
export interface StatusChangeEvent {
  applicationId: string;
  from: ApplicationStatus;
  to: ApplicationStatus;
  action: ApplicationAction;
  actorId: string;
}

/**
 * Listener of committed status changes (e.g. the AI module queues its first
 * analysis). Runs after the transaction: a failing listener is logged and can
 * never undo or block the human transition.
 */
export type StatusChangeListener = (event: StatusChangeEvent) => Promise<void>;

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);
  private readonly statusListeners: StatusChangeListener[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly applications: ApplicationsRepository,
    private readonly customers: CustomersService,
    private readonly audit: AuditService,
  ) {}

  /** Registers a listener of committed status changes (module boundary: no reverse import). */
  onStatusChange(listener: StatusChangeListener): void {
    this.statusListeners.push(listener);
  }

  private async notifyStatusChange(event: StatusChangeEvent): Promise<void> {
    for (const listener of this.statusListeners) {
      try {
        await listener(event);
      } catch (err) {
        this.logger.error({ err, applicationId: event.applicationId }, 'Status listener failed');
      }
    }
  }

  // ───────────────────────────── visibility ─────────────────────────────

  /**
   * Plan, decision 6.2: users who cannot write applications (analysts) do not
   * see drafts. Hidden applications answer 404, like unknown ones.
   */
  private visibilityFilter(actor: AuthUser): Prisma.CreditApplicationWhereInput {
    return actor.permissions.includes(Permission.APPLICATION_WRITE)
      ? {}
      : { status: { not: ApplicationStatus.DRAFT } };
  }

  /** Loads an application the actor may see, or 404. Exported for other modules. */
  async getVisibleOrThrow(actor: AuthUser, id: string, tx?: Tx): Promise<ApplicationWithRefs> {
    const app = await this.applications.findById(id, tx);
    const visible =
      app && (actor.permissions.includes(Permission.APPLICATION_WRITE) || app.status !== 'DRAFT');
    if (!app || !visible) throw Problems.notFound('Solicitação');
    return app;
  }

  // ───────────────────────────── queries ─────────────────────────────

  async list(actor: AuthUser, q: ListApplicationsQueryDto): Promise<Page<ApplicationDto>> {
    const and: Prisma.CreditApplicationWhereInput[] = [this.visibilityFilter(actor)];
    if (q.status?.length) and.push({ status: { in: q.status } });
    if (q.customerId) and.push({ customerId: q.customerId });
    if (q.productType) and.push({ productType: q.productType });
    if (q.assigneeId === 'me') and.push({ assigneeId: actor.id });
    else if (q.assigneeId === 'none') and.push({ assigneeId: null });
    else if (q.assigneeId) and.push({ assigneeId: q.assigneeId });
    if (q.createdFrom) and.push({ createdAt: { gte: new Date(`${q.createdFrom}T00:00:00.000Z`) } });
    if (q.createdTo) {
      const end = new Date(`${q.createdTo}T00:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      and.push({ createdAt: { lt: end } });
    }
    if (q.q) {
      const code = /^(?:CF-\d{4}-)?0*(\d{1,9})$/i.exec(q.q);
      and.push(
        code
          ? { number: Number(code[1]) }
          : { customer: { name: { contains: q.q, mode: 'insensitive' } } },
      );
    }

    const [rows, total] = await this.applications.list({
      where: { AND: and },
      orderBy: parseSort(q.sort, SORTABLE, { field: 'createdAt', direction: 'desc' }),
      ...toSkipTake(q),
    });
    return page(
      rows.map((a) => toApplicationDto(a, actor)),
      total,
      q,
    );
  }

  async get(actor: AuthUser, id: string): Promise<ApplicationDto> {
    return toApplicationDto(await this.getVisibleOrThrow(actor, id), actor);
  }

  async statusHistory(actor: AuthUser, id: string): Promise<StatusHistoryEntryDto[]> {
    await this.getVisibleOrThrow(actor, id);
    const rows = await this.applications.statusHistory(id);
    return rows.map((h) => ({
      id: h.id,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      actor: h.actor,
      reason: h.reason,
      createdAt: h.createdAt,
    }));
  }

  // ───────────────────────────── create / edit ─────────────────────────────

  async create(actor: AuthUser, dto: CreateApplicationDto): Promise<ApplicationDto> {
    const customer = await this.customers.getOrThrow(dto.customerId);
    if (customer.status !== CustomerStatus.ACTIVE) {
      throw Problems.businessRule(
        'customer-inactive',
        'Cliente inativo',
        'Reative o cadastro do cliente antes de abrir uma solicitação.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await this.applications.create(tx, {
        customerId: customer.id,
        productType: dto.productType,
        requestedAmount: dto.requestedAmount,
        termMonths: dto.termMonths,
        purpose: dto.purpose,
        declaredMonthlyIncome: dto.declaredMonthlyIncome,
        declaredMonthlyCommitments: dto.declaredMonthlyCommitments ?? null,
        createdById: actor.id,
      });
      await this.applications.addStatusHistory(tx, {
        applicationId: created.id,
        fromStatus: null,
        toStatus: ApplicationStatus.DRAFT,
        actorId: actor.id,
      });
      await this.audit.record(tx, {
        actorId: actor.id,
        action: 'application.created',
        entityType: 'CreditApplication',
        entityId: created.id,
        after: { customerId: customer.id, status: created.status, ...editableSnapshot(created) },
      });
      return toApplicationDto(created, actor);
    });
  }

  async update(actor: AuthUser, id: string, dto: UpdateApplicationDto): Promise<ApplicationDto> {
    const current = await this.getVisibleOrThrow(actor, id);
    this.assertEditable(current);
    const { version, ...fields } = dto;
    if (Object.values(fields).every((v) => v === undefined)) {
      if (current.version !== version) throw Problems.versionConflict();
      return toApplicationDto(current, actor);
    }

    return this.prisma.$transaction(async (tx) => {
      const applied = await this.applications.updateIf(
        tx,
        id,
        {
          version,
          status: { in: [ApplicationStatus.DRAFT, ApplicationStatus.PENDING_INFORMATION] },
        },
        fields,
      );
      if (!applied) {
        const fresh = await this.applications.findById(id, tx);
        if (fresh && !isEditable(fresh.status)) this.assertEditable(fresh);
        throw Problems.versionConflict();
      }
      const updated = (await this.applications.findById(id, tx))!;
      const before = editableSnapshot(current);
      const after = editableSnapshot(updated);
      const changed = EDITABLE_FIELDS.filter((f) => before[f] !== after[f]);
      await this.audit.record(tx, {
        actorId: actor.id,
        action: 'application.updated',
        entityType: 'CreditApplication',
        entityId: id,
        before: Object.fromEntries(changed.map((f) => [f, before[f]])),
        after: Object.fromEntries(changed.map((f) => [f, after[f]])),
      });
      return toApplicationDto(updated, actor);
    });
  }

  // ───────────────────────────── transitions ─────────────────────────────

  submit(actor: AuthUser, id: string) {
    return this.transition(actor, id, ApplicationAction.SUBMIT, {
      precheck: async (app, tx) => {
        const present = await this.applications.activeDocumentTypes(tx, app.id);
        const missing = REQUIRED_DOCUMENT_TYPES.filter((t) => !present.includes(t));
        if (missing.length > 0) {
          throw new AppException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'missing-required-documents',
            'Documentos obrigatórios ausentes',
            `Anexe: ${missing.map((t) => DOCUMENT_LABELS[t]).join(', ')}.`,
            undefined,
            { missingDocumentTypes: missing },
          );
        }
      },
      data: (_app, now) => ({ submittedAt: now }),
    });
  }

  startReview(actor: AuthUser, id: string) {
    return this.transition(actor, id, ApplicationAction.START_REVIEW, {
      data: () => ({ assigneeId: actor.id }),
      afterward: (app, tx) => this.auditAssignment(tx, actor, app, actor.id),
    });
  }

  assign(actor: AuthUser, id: string, assigneeId: string) {
    return this.transition(actor, id, ApplicationAction.ASSIGN, {
      precheck: async (app, tx) => {
        const assignee = await this.applications.findActiveUser(tx, assigneeId);
        if (!assignee || assignee.role !== Role.ANALYST) {
          throw Problems.businessRule(
            'invalid-assignee',
            'Responsável inválido',
            'Atribua a solicitação a um analista ativo.',
          );
        }
        if (app.assigneeId === assigneeId) {
          throw Problems.conflict('already-assigned', 'A solicitação já está com este analista');
        }
      },
      data: () => ({ assigneeId }),
      afterward: (app, tx) => this.auditAssignment(tx, actor, app, assigneeId),
    });
  }

  release(actor: AuthUser, id: string) {
    return this.transition(actor, id, ApplicationAction.RELEASE, {
      precheck: async (app) => {
        if (!actor.permissions.includes(Permission.APPLICATION_ASSIGN))
          this.assertAssignee(actor, app);
      },
      data: () => ({ assigneeId: null }),
      afterward: (app, tx) => this.auditAssignment(tx, actor, app, null),
    });
  }

  requestInformation(actor: AuthUser, id: string, reason?: string) {
    return this.transition(actor, id, ApplicationAction.REQUEST_INFORMATION, {
      reason,
      precheck: async (app, tx) => {
        this.assertAssignee(actor, app);
        if ((await this.applications.countOpenIssues(tx, app.id)) === 0) {
          throw Problems.businessRule(
            'no-open-issues',
            'Registre ao menos uma pendência',
            'A solicitação só pode voltar para complementação com pendências abertas.',
          );
        }
      },
    });
  }

  resume(actor: AuthUser, id: string, reason?: string) {
    return this.transition(actor, id, ApplicationAction.RESUME, { reason });
  }

  cancel(actor: AuthUser, id: string, reason?: string) {
    return this.transition(actor, id, ApplicationAction.CANCEL, {
      reason,
      data: (_app, now) => ({ closedAt: now }),
    });
  }

  reopen(actor: AuthUser, id: string, reason?: string) {
    return this.transition(actor, id, ApplicationAction.REOPEN, {
      reason,
      data: () => ({ closedAt: null, assigneeId: null }),
    });
  }

  /**
   * Single path for every status change: state-machine check, permission
   * check, contextual rules, conditional update (race-safe), status history and
   * audit — all in one transaction.
   */
  async transition(
    actor: AuthUser,
    id: string,
    action: ApplicationAction,
    opts: TransitionOptions = {},
  ): Promise<ApplicationDto> {
    const rule = TRANSITIONS[action];
    if (rule.requiresReason && !opts.reason?.trim()) {
      throw fieldValidationError('reason', 'Informe o motivo');
    }

    let changed: StatusChangeEvent | null = null;
    const result = await this.prisma.$transaction(async (tx) => {
      const app = await this.getVisibleOrThrow(actor, id, tx);
      const from = app.status;
      if (!canTransition(from, action)) {
        throw Problems.conflict(
          'invalid-transition',
          'Ação não permitida no status atual',
          `A ação "${action}" não se aplica a solicitações com status ${from}.`,
          { currentStatus: from },
        );
      }
      if (!hasTransitionPermission(action, actor.permissions, from)) throw Problems.forbidden();

      await opts.precheck?.(app, tx);

      const now = new Date();
      const to = nextStatus(from, action)!;
      const applied = await this.applications.updateIf(
        tx,
        id,
        { status: from },
        { status: to, ...opts.data?.(app, now) },
      );
      if (!applied) {
        throw Problems.conflict(
          'concurrent-modification',
          'A solicitação foi alterada por outra pessoa',
          'Recarregue a solicitação e tente novamente.',
        );
      }

      if (to !== from) {
        await this.applications.addStatusHistory(tx, {
          applicationId: id,
          fromStatus: from,
          toStatus: to,
          actorId: actor.id,
          reason: opts.reason ?? null,
          createdAt: now,
        });
        await this.audit.record(tx, {
          actorId: actor.id,
          action: 'application.status_changed',
          entityType: 'CreditApplication',
          entityId: id,
          before: { status: from },
          after: { status: to, ...(opts.reason ? { reason: opts.reason } : {}) },
          metadata: { transition: action },
        });
        changed = { applicationId: id, from, to, action, actorId: actor.id };
      }
      await opts.afterward?.(app, tx);

      return toApplicationDto((await this.applications.findById(id, tx))!, actor);
    });
    if (changed) await this.notifyStatusChange(changed);
    return result;
  }

  // ───────────────────────────── helpers ─────────────────────────────

  assertAssignee(actor: AuthUser, app: { assigneeId: string | null }): void {
    if (app.assigneeId !== actor.id) throw notAssignee();
  }

  private assertEditable(app: { status: ApplicationStatus }): void {
    if (!isEditable(app.status)) {
      throw Problems.conflict(
        'application-not-editable',
        'Solicitação não pode ser editada neste status',
        'Somente rascunhos e solicitações com pendência de informação podem ser alteradas.',
        { currentStatus: app.status },
      );
    }
  }

  private auditAssignment(tx: Tx, actor: AuthUser, app: ApplicationWithRefs, to: string | null) {
    return this.audit.record(tx, {
      actorId: actor.id,
      action: 'application.assigned',
      entityType: 'CreditApplication',
      entityId: app.id,
      before: { assigneeId: app.assigneeId },
      after: { assigneeId: to },
    });
  }
}
