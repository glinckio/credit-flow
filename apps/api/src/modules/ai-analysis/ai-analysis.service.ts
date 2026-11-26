import { HttpStatus, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  ACTIVE_RUN_STATUSES,
  AI_PIPELINE_VERSION,
  AiAnalysisRunStatus,
  AiAnalysisTrigger,
  ApplicationStatus,
  EXTRACTION_SCHEMA_VERSION,
} from '@creditflow/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { AppException, Problems } from '../../common/http/app-exception.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth-user.js';
import {
  ApplicationsService,
  type StatusChangeEvent,
} from '../applications/applications.service.js';
import type {
  AiAnalysisRunDetailDto,
  AiAnalysisRunDto,
  AiDocumentExtractionDto,
  AiFieldDto,
  RequestAiAnalysisDto,
} from './ai-analysis.dto.js';
import { DOCUMENT_EXTRACTOR, type OptionalDocumentExtractor } from './ai-analysis.tokens.js';
import type { FieldAssessment } from './extraction/assess-extraction.js';
import { inputFingerprint } from './fingerprint.js';

type Tx = Prisma.TransactionClient;
type Db = PrismaService | Tx;

const runInclude = {
  requestedBy: { select: { id: true, name: true } },
  _count: { select: { documents: true } },
} as const;
type RunWithRefs = Prisma.AiAnalysisRunGetPayload<{ include: typeof runInclude }>;

/**
 * AI-assisted analysis (ADR-0011): queues runs, answers the API and computes
 * staleness. Processing happens in `AiAnalysisWorker`. Nothing here touches
 * application data, documents' validation, reviews or decisions.
 */
@Injectable()
export class AiAnalysisService implements OnModuleInit {
  private readonly logger = new Logger(AiAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly applications: ApplicationsService,
    private readonly audit: AuditService,
    @Inject(DOCUMENT_EXTRACTOR) private readonly extractor: OptionalDocumentExtractor,
  ) {}

  get enabled(): boolean {
    return this.extractor !== null;
  }

  onModuleInit(): void {
    this.applications.onStatusChange((e) => this.onStatusChange(e));
  }

  /** Automatic trigger: the FIRST time an application enters UNDER_REVIEW, once. */
  private async onStatusChange(e: StatusChangeEvent): Promise<void> {
    if (!this.enabled || e.to !== ApplicationStatus.UNDER_REVIEW) return;
    const previous = await this.prisma.aiAnalysisRun.count({
      where: { applicationId: e.applicationId },
    });
    if (previous > 0) return;
    await this.enqueue(e.applicationId, AiAnalysisTrigger.AUTO_FIRST_REVIEW, e.actorId).catch(
      (err: unknown) => {
        // Lost a race with a concurrent trigger: the other run is the first one.
        if (!isUniqueViolation(err)) throw err;
      },
    );
  }

  /** "Reprocessar": assigned analyst only, during review, never two at once. */
  async request(
    actor: AuthUser,
    applicationId: string,
    dto: RequestAiAnalysisDto,
  ): Promise<AiAnalysisRunDto> {
    if (!this.enabled) {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ai-disabled',
        'Análise por IA desativada',
        'A análise manual continua disponível normalmente.',
      );
    }
    const app = await this.applications.getVisibleOrThrow(actor, applicationId);
    if (app.status !== ApplicationStatus.UNDER_REVIEW) {
      throw Problems.conflict(
        'application-not-in-review',
        'A análise por IA só pode ser refeita durante a análise',
        undefined,
        { currentStatus: app.status },
      );
    }
    this.applications.assertAssignee(actor, app);

    const active = await this.prisma.aiAnalysisRun.findFirst({
      where: { applicationId, status: { in: [...ACTIVE_RUN_STATUSES] } },
      select: { id: true },
    });
    if (active) {
      throw Problems.conflict(
        'analysis-in-progress',
        'Já existe uma análise em andamento',
        undefined,
        { runId: active.id },
      );
    }
    if (!dto.force) {
      const current = await this.currentFingerprint(this.prisma, applicationId);
      const latest = await this.prisma.aiAnalysisRun.findFirst({
        where: {
          applicationId,
          status: { in: [AiAnalysisRunStatus.SUCCEEDED, AiAnalysisRunStatus.PARTIAL] },
        },
        orderBy: { queuedAt: 'desc' },
        select: { id: true, inputFingerprint: true },
      });
      if (latest?.inputFingerprint === current) {
        throw Problems.conflict(
          'analysis-up-to-date',
          'Os documentos não mudaram desde a última análise',
          'Confirme para refazer mesmo assim (o resultado pode variar).',
          { runId: latest.id },
        );
      }
    }

    try {
      const run = await this.enqueue(applicationId, AiAnalysisTrigger.MANUAL, actor.id);
      return this.toRunDto(run, false);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw Problems.conflict('analysis-in-progress', 'Já existe uma análise em andamento');
      }
      throw err;
    }
  }

  async list(actor: AuthUser, applicationId: string): Promise<AiAnalysisRunDto[]> {
    await this.applications.getVisibleOrThrow(actor, applicationId);
    const runs = await this.prisma.aiAnalysisRun.findMany({
      where: { applicationId },
      orderBy: { queuedAt: 'desc' },
      include: runInclude,
    });
    const current = await this.currentFingerprint(this.prisma, applicationId);
    return runs.map((r) => this.toRunDto(r, r.inputFingerprint !== current));
  }

  async get(actor: AuthUser, runId: string): Promise<AiAnalysisRunDetailDto> {
    const run = await this.prisma.aiAnalysisRun.findUnique({
      where: { id: runId },
      include: {
        ...runInclude,
        documents: {
          orderBy: { createdAt: 'asc' },
          include: { document: { select: { id: true, type: true, originalName: true } } },
        },
      },
    });
    if (!run) throw Problems.notFound('Análise');
    // Same visibility as the application (hidden application → 404 as well).
    await this.applications.getVisibleOrThrow(actor, run.applicationId).catch(() => {
      throw Problems.notFound('Análise');
    });
    const current = await this.currentFingerprint(this.prisma, run.applicationId);
    return {
      ...this.toRunDto(run, run.inputFingerprint !== current),
      documents: run.documents.map((d): AiDocumentExtractionDto => ({
        id: d.id,
        document: d.document,
        documentSha256: d.documentSha256,
        declaredType: d.declaredType,
        status: d.status,
        detectedType: d.detectedType,
        typeMatchesDeclared: d.typeMatchesDeclared,
        hasTextLayer: d.hasTextLayer,
        injectionAlert: d.injectionAlert,
        injectionPatterns: d.injectionPatterns,
        injectionModelFlag: d.injectionModelFlag,
        fields: (d.fields as unknown as FieldAssessment[]).map(toFieldDto),
        schemaErrors: d.schemaErrors as unknown as string[],
      })),
    };
  }

  // ───────────────────────────── internals ─────────────────────────────

  /** Fingerprint of what a run started now would analyse. */
  async currentFingerprint(db: Db, applicationId: string): Promise<string> {
    const documents = await db.creditDocument.findMany({
      where: { applicationId, deletedAt: null },
      select: { id: true, sha256: true },
    });
    return inputFingerprint({
      documents,
      model: this.extractor?.model ?? 'disabled',
      promptVersion: this.extractor?.promptVersion ?? 'none',
    });
  }

  private async enqueue(
    applicationId: string,
    trigger: AiAnalysisTrigger,
    requestedById: string,
  ): Promise<RunWithRefs> {
    const extractor = this.extractor!;
    return this.prisma.$transaction(async (tx) => {
      const app = await tx.creditApplication.findUniqueOrThrow({
        where: { id: applicationId },
        select: { version: true },
      });
      const run = await tx.aiAnalysisRun.create({
        data: {
          applicationId,
          trigger,
          requestedById,
          inputFingerprint: await this.currentFingerprint(tx, applicationId),
          applicationVersion: app.version,
          model: extractor.model,
          promptVersion: extractor.promptVersion,
          pipelineVersion: AI_PIPELINE_VERSION,
          extractionSchemaVersion: EXTRACTION_SCHEMA_VERSION,
        },
        include: runInclude,
      });
      await this.audit.record(tx, {
        actorId: requestedById,
        action: 'ai_analysis.requested',
        entityType: 'AiAnalysisRun',
        entityId: run.id,
        after: { applicationId, trigger, model: run.model },
      });
      this.logger.log({ runId: run.id, applicationId, trigger }, 'AI analysis queued');
      return run;
    });
  }

  private toRunDto(r: RunWithRefs, stale: boolean): AiAnalysisRunDto {
    return {
      id: r.id,
      applicationId: r.applicationId,
      trigger: r.trigger,
      status: r.status,
      requestedBy: r.requestedBy,
      model: r.model,
      pipelineVersion: r.pipelineVersion,
      extractionSchemaVersion: r.extractionSchemaVersion,
      promptVersion: r.promptVersion,
      errorCode: r.errorCode,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: r.costUsd?.toFixed(6) ?? null,
      latencyMs: r.latencyMs,
      queuedAt: r.queuedAt,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      purgedAt: r.purgedAt,
      stale,
      documentCount: r._count.documents,
    };
  }
}

function toFieldDto(f: FieldAssessment): AiFieldDto {
  return {
    key: f.key,
    modelStatus: f.modelStatus,
    modelValue: f.modelValue,
    page: f.page,
    quote: f.quote,
    evidenceStatus: f.evidence?.status ?? null,
    evidenceReason: f.evidence && 'reason' in f.evidence ? f.evidence.reason : null,
    acceptedValue: f.acceptedValue,
    rejectedBy: f.rejectedBy,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
