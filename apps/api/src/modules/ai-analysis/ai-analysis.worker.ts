import type { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiAnalysisRunStatus,
  AiRunErrorCode,
  type AssessedDocument,
  DocumentExtractionStatus,
  FAILED_EXTRACTION_STATUSES,
  FIELDS_BY_DOCUMENT_TYPE,
  requestCostUsd,
} from '@creditflow/shared';
import { Prisma } from '../../generated/prisma/client.js';
import type { Env } from '../../config/env.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { DocumentStorage } from '../../infra/storage/document-storage.js';
import { AuditService } from '../audit/audit.service.js';
import {
  DOCUMENT_EXTRACTOR,
  DOCUMENT_TEXT_READER,
  type DocumentTextReader,
  type OptionalDocumentExtractor,
} from './ai-analysis.tokens.js';
import { assessExtraction, skippedAssessment } from './extraction/assess-extraction.js';
import type { DocumentExtractor, ExtractorResult } from './extraction/document-extractor.js';
import { AiAnalysisService, type ReportSnapshot } from './ai-analysis.service.js';
import { toAssessedDocument } from './extraction/to-assessed.js';

const ZERO = { inputTokens: 0, outputTokens: 0 };

/** How often the retention purge runs, at most. */
const PURGE_EVERY_MS = 60 * 60 * 1000;

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

/**
 * Background worker of the AI analysis (ADR-0011), in the API process, with
 * PostgreSQL as the queue (`FOR UPDATE SKIP LOCKED`). Deliberately simple:
 *
 * - one run at a time, documents sequentially (predictable cost and rate);
 * - NO automatic retry: an interrupted run (expired lease) becomes FAILED and
 *   the analyst decides whether to reprocess;
 * - a failure never touches application data or blocks the human flow.
 */
@Injectable()
export class AiAnalysisWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AiAnalysisWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private current: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private lastPurgeAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: DocumentStorage,
    private readonly audit: AuditService,
    private readonly service: AiAnalysisService,
    private readonly config: ConfigService<Env, true>,
    @Inject(DOCUMENT_EXTRACTOR) private readonly extractor: OptionalDocumentExtractor,
    @Inject(DOCUMENT_TEXT_READER) private readonly textReader: DocumentTextReader,
  ) {}

  onApplicationBootstrap(): void {
    const pollMs = this.config.get('AI_WORKER_POLL_MS', { infer: true });
    // Runs even with AI disabled: the retention purge is an obligation regardless.
    if (pollMs > 0) this.schedule(pollMs);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.current.catch(() => undefined);
  }

  private schedule(pollMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.current = this.tick()
        .catch((err: unknown) => this.logger.error({ err }, 'AI worker tick failed'))
        .finally(() => this.schedule(pollMs));
    }, pollMs);
  }

  private async tick(): Promise<void> {
    if (Date.now() - this.lastPurgeAt >= PURGE_EVERY_MS) {
      this.lastPurgeAt = Date.now();
      await this.purgeExpired();
    }
    while (!this.stopped && (await this.runOnce())) {
      /* drain the queue */
    }
  }

  // ───────────────────────────── queue ─────────────────────────────

  /**
   * Marks interrupted runs as FAILED, then claims and processes the oldest
   * queued run. Returns the processed run id, or null when the queue is empty.
   * Public so tests (and operators) can drive the worker deterministically.
   */
  async runOnce(): Promise<string | null> {
    await this.failInterrupted();
    if (!this.extractor) return null;
    const leaseMs = this.config.get('AI_LEASE_MS', { infer: true });
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "ai_analysis_runs"
         SET "status" = 'RUNNING',
             "started_at" = now(),
             "lease_expires_at" = now() + (${leaseMs}::int * interval '1 millisecond')
       WHERE "id" = (
         SELECT "id" FROM "ai_analysis_runs"
          WHERE "status" = 'QUEUED'
          ORDER BY "queued_at"
          LIMIT 1
          FOR UPDATE SKIP LOCKED)
      RETURNING "id"`;
    const runId = claimed[0]?.id;
    if (!runId) return null;
    try {
      await this.process(runId, this.extractor);
    } catch (err) {
      this.logger.error({ err, runId }, 'AI analysis failed unexpectedly');
      await this.finish(runId, AiAnalysisRunStatus.FAILED, AiRunErrorCode.INTERNAL_ERROR);
    }
    return runId;
  }

  /** RUNNING runs whose lease expired were interrupted (crash/restart): FAILED, not retried. */
  async failInterrupted(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ id: string; application_id: string }[]>`
      UPDATE "ai_analysis_runs"
         SET "status" = 'FAILED', "error_code" = ${AiRunErrorCode.INTERRUPTED},
             "finished_at" = now(), "lease_expires_at" = NULL
       WHERE "status" = 'RUNNING' AND "lease_expires_at" < now()
      RETURNING "id", "application_id"`;
    for (const r of rows) {
      await this.audit.record(this.prisma, {
        actorId: null,
        action: 'ai_analysis.failed',
        entityType: 'AiAnalysisRun',
        entityId: r.id,
        after: {
          applicationId: r.application_id,
          status: AiAnalysisRunStatus.FAILED,
          errorCode: AiRunErrorCode.INTERRUPTED,
        },
      });
    }
    return rows.length;
  }

  // ───────────────────────────── processing ─────────────────────────────

  private async process(runId: string, extractor: DocumentExtractor): Promise<void> {
    const run = await this.prisma.aiAnalysisRun.findUniqueOrThrow({ where: { id: runId } });
    const docs = await this.prisma.creditDocument.findMany({
      where: { applicationId: run.applicationId, deletedAt: null },
      orderBy: { uploadedAt: 'asc' },
    });

    // The input must be the one that was requested (documents are frozen during review).
    if (
      (await this.service.currentFingerprint(this.prisma, run.applicationId)) !==
      run.inputFingerprint
    ) {
      return this.finish(runId, AiAnalysisRunStatus.FAILED, AiRunErrorCode.INPUT_CHANGED);
    }
    if (docs.length > this.config.get('AI_MAX_DOCUMENTS_PER_RUN', { infer: true })) {
      return this.finish(runId, AiAnalysisRunStatus.FAILED, AiRunErrorCode.TOO_MANY_DOCUMENTS);
    }

    const started = Date.now();
    const assessed: AssessedDocument[] = [];
    const maxPages = this.config.get('AI_MAX_PAGES_PER_DOCUMENT', { infer: true });
    const maxCostUsd = this.config.get('AI_MAX_COST_USD_PER_RUN', { infer: true });
    let costUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    const statuses: DocumentExtractionStatus[] = [];

    for (const doc of docs) {
      const bytes = await readAll(await this.storage.open(doc.storageKey));
      if (createHash('sha256').update(bytes).digest('hex') !== doc.sha256) {
        this.logger.error({ runId, documentId: doc.id }, 'Stored document does not match its hash');
        return this.finish(runId, AiAnalysisRunStatus.FAILED, AiRunErrorCode.DOCUMENT_INTEGRITY);
      }
      const requestedFields = FIELDS_BY_DOCUMENT_TYPE[doc.type];
      const pageTexts = await this.textReader
        .readPages(bytes, doc.mimeType)
        .catch((err: unknown) => {
          this.logger.warn({ err, documentId: doc.id }, 'Text layer could not be read');
          return null;
        });

      // Cost guards: decided BEFORE calling the model, never after.
      const pages = await this.textReader.countPages(bytes, doc.mimeType).catch(() => null);
      const skip =
        pages !== null && pages > maxPages
          ? DocumentExtractionStatus.TOO_LARGE
          : costUsd >= maxCostUsd
            ? DocumentExtractionStatus.SKIPPED_BUDGET
            : null;

      const result: ExtractorResult = skip
        ? { kind: 'error', code: 'UNAVAILABLE', model: extractor.model, usage: ZERO, latencyMs: 0 }
        : await this.safeExtract(extractor, {
            documentId: doc.id,
            declaredType: doc.type,
            mimeType: doc.mimeType,
            bytes,
            sha256: doc.sha256,
            requestedFields,
          });
      if (!skip) {
        costUsd += requestCostUsd(
          result.model,
          result.usage.inputTokens,
          result.usage.outputTokens,
        );
      }
      const a = skip
        ? skippedAssessment(skip, pageTexts)
        : assessExtraction({ declaredType: doc.type, requestedFields, result, pageTexts });

      await this.prisma.aiDocumentExtraction.create({
        data: {
          runId,
          documentId: doc.id,
          documentSha256: doc.sha256,
          declaredType: doc.type,
          status: a.status,
          detectedType: a.detectedType,
          typeMatchesDeclared: a.typeMatchesDeclared,
          hasTextLayer: a.hasTextLayer,
          injectionAlert: a.injection.alert,
          injectionPatterns: a.injection.scan.patterns,
          injectionModelFlag: a.injection.modelFlag,
          fields: a.fields as unknown as Prisma.InputJsonValue,
          schemaErrors: a.schemaErrors,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          latencyMs: result.latencyMs,
        },
      });
      statuses.push(a.status);
      assessed.push(toAssessedDocument(doc.id, doc.type, a));
      inputTokens += result.usage.inputTokens;
      outputTokens += result.usage.outputTokens;
    }

    const failed = statuses.filter((s) => FAILED_EXTRACTION_STATUSES.includes(s)).length;
    const status =
      failed === 0
        ? AiAnalysisRunStatus.SUCCEEDED
        : failed < statuses.length
          ? AiAnalysisRunStatus.PARTIAL
          : AiAnalysisRunStatus.FAILED;
    // B2: deterministic findings + template report, frozen as they were at completion.
    const snapshot = this.service.buildReport(
      await this.service.declaredData(this.prisma, run.applicationId),
      assessed,
      Object.fromEntries(docs.map((d) => [d.id, d.originalName])),
    );
    await this.finish(
      runId,
      status,
      status === AiAnalysisRunStatus.FAILED ? AiRunErrorCode.ALL_DOCUMENTS_FAILED : null,
      {
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - started,
        documents: statuses.length,
        costUsd,
      },
      snapshot,
    );
  }

  /** The port must not throw; if an adapter does anyway, it is a provider failure. */
  private async safeExtract(
    extractor: DocumentExtractor,
    request: Parameters<DocumentExtractor['extract']>[0],
  ): Promise<ExtractorResult> {
    const started = Date.now();
    try {
      return await extractor.extract(request);
    } catch (err) {
      this.logger.error({ err, documentId: request.documentId }, 'Extractor threw');
      return {
        kind: 'error',
        code: 'UNAVAILABLE',
        model: extractor.model,
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: Date.now() - started,
      };
    }
  }

  private async finish(
    runId: string,
    status: AiAnalysisRunStatus,
    errorCode: string | null,
    metrics: {
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
      documents: number;
      costUsd?: number;
    } = {
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      documents: 0,
    },
    snapshot: ReportSnapshot | null = null,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Only a run still RUNNING is finished (an expired lease may have failed it meanwhile).
      const { count } = await tx.aiAnalysisRun.updateMany({
        where: { id: runId, status: AiAnalysisRunStatus.RUNNING },
        data: {
          status,
          errorCode,
          finishedAt: new Date(),
          leaseExpiresAt: null,
          inputTokens: metrics.inputTokens,
          outputTokens: metrics.outputTokens,
          latencyMs: metrics.latencyMs,
          costUsd:
            metrics.costUsd === undefined ? null : new Prisma.Decimal(metrics.costUsd.toFixed(6)),
          ...(snapshot ? { reportSnapshot: snapshot as unknown as Prisma.InputJsonValue } : {}),
        },
      });
      if (count === 0) return;
      const run = await tx.aiAnalysisRun.findUniqueOrThrow({ where: { id: runId } });
      await this.audit.record(tx, {
        actorId: null,
        action:
          status === AiAnalysisRunStatus.FAILED ? 'ai_analysis.failed' : 'ai_analysis.completed',
        entityType: 'AiAnalysisRun',
        entityId: runId,
        after: {
          applicationId: run.applicationId,
          status,
          errorCode,
          model: run.model,
          documents: metrics.documents,
          inputTokens: metrics.inputTokens,
          outputTokens: metrics.outputTokens,
          costUsd: metrics.costUsd ?? 0,
        },
      });
    });
    this.logger.log({ runId, status, errorCode }, 'AI analysis finished');
  }

  // ───────────────────────────── retention ─────────────────────────────

  /**
   * Retention (ADR-0011, decision 10): extracted content older than
   * AI_RETENTION_DAYS is deleted; the run row keeps only metadata and the
   * audit trail records the purge without any extracted value.
   */
  async purgeExpired(now = new Date()): Promise<number> {
    const days = this.config.get('AI_RETENTION_DAYS', { infer: true });
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const expired = await this.prisma.aiAnalysisRun.findMany({
      where: { finishedAt: { lt: cutoff }, purgedAt: null },
      select: { id: true, applicationId: true },
      take: 500,
    });
    for (const run of expired) {
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.aiDocumentExtraction.deleteMany({ where: { runId: run.id } });
        await tx.aiAnalysisRun.update({
          where: { id: run.id },
          data: { purgedAt: now, reportSnapshot: Prisma.DbNull },
        });
        await this.audit.record(tx, {
          actorId: null,
          action: 'ai_analysis.purged',
          entityType: 'AiAnalysisRun',
          entityId: run.id,
          after: {
            applicationId: run.applicationId,
            extractionsDeleted: count,
            retentionDays: days,
          },
        });
      });
    }
    if (expired.length) this.logger.log({ runs: expired.length }, 'AI analyses purged');
    return expired.length;
  }
}
