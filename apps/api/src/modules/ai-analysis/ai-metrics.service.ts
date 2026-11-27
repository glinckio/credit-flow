import { Injectable } from '@nestjs/common';
import {
  type AiMetrics,
  AiAnalysisRunStatus,
  type FindingSubject,
  FindingFeedbackVerdict,
} from '@creditflow/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { ReportSnapshot } from './ai-analysis.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

function inc<K extends string>(map: Partial<Record<K, number>>, key: K, by = 1) {
  map[key] = (map[key] ?? 0) + by;
}

function p95(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
}

/**
 * Cost and quality of the AI analyses over a period (stage B6, roadmap §15).
 * Reads only counters, statuses and amounts: no extracted value, quote or
 * feedback comment ever leaves this service.
 */
@Injectable()
export class AiMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async metrics(days: number, now = new Date()): Promise<AiMetrics> {
    const from = new Date(now.getTime() - days * DAY_MS);
    const runs = await this.prisma.aiAnalysisRun.findMany({
      where: { queuedAt: { gte: from, lte: now } },
      select: {
        id: true,
        status: true,
        trigger: true,
        model: true,
        promptVersion: true,
        pipelineVersion: true,
        inputTokens: true,
        outputTokens: true,
        costUsd: true,
        latencyMs: true,
        purgedAt: true,
        reportSnapshot: true,
      },
    });
    const runIds = runs.map((r) => r.id);
    const [documents, feedback] = await Promise.all([
      this.prisma.aiDocumentExtraction.findMany({
        where: { runId: { in: runIds } },
        select: { status: true, injectionAlert: true, hasTextLayer: true },
      }),
      this.prisma.aiFindingFeedback.findMany({
        where: { runId: { in: runIds } },
        select: { verdict: true, findingId: true },
      }),
    ]);

    const m: AiMetrics = {
      from: from.toISOString(),
      to: now.toISOString(),
      days,
      runs: { total: runs.length, byStatus: {}, byTrigger: {}, purged: 0 },
      cost: { totalUsd: '0.000000', avgPerRunUsd: null, maxRunUsd: null },
      tokens: { input: 0, output: 0 },
      latencyMs: { avg: null, p95: null },
      documents: { total: documents.length, byStatus: {}, injectionAlerts: 0, withoutTextLayer: 0 },
      findings: { byKind: {} },
      narrative: { byStatus: {} },
      feedback: {
        total: feedback.length,
        correct: 0,
        incorrect: 0,
        correctionRate: null,
        incorrectBySubject: {},
      },
      byVersion: [],
    };

    let total = new Decimal(0);
    let max: Decimal | null = null;
    const latencies: number[] = [];
    const versions = new Map<string, AiMetrics['byVersion'][number] & { cost: Decimal }>();
    for (const r of runs) {
      inc(m.runs.byStatus, r.status);
      inc(m.runs.byTrigger, r.trigger);
      if (r.purgedAt) m.runs.purged++;
      m.tokens.input += r.inputTokens;
      m.tokens.output += r.outputTokens;
      const cost = r.costUsd ?? new Decimal(0);
      total = total.plus(cost);
      if (!max || cost.gt(max)) max = cost;
      if (r.latencyMs !== null) latencies.push(r.latencyMs);

      const snapshot = r.reportSnapshot as unknown as ReportSnapshot | null;
      if (snapshot) {
        for (const f of snapshot.findings) inc(m.findings.byKind, f.kind);
        inc(m.narrative.byStatus, snapshot.narrative?.status ?? 'NONE');
      }

      const key = `${r.model}|${r.promptVersion}|${r.pipelineVersion}`;
      const v = versions.get(key) ?? {
        model: r.model,
        promptVersion: r.promptVersion,
        pipelineVersion: r.pipelineVersion,
        runs: 0,
        failed: 0,
        costUsd: '',
        cost: new Decimal(0),
      };
      v.runs++;
      if (r.status === AiAnalysisRunStatus.FAILED) v.failed++;
      v.cost = v.cost.plus(cost);
      versions.set(key, v);
    }
    m.cost.totalUsd = total.toFixed(6);
    if (runs.length) {
      m.cost.avgPerRunUsd = total.div(runs.length).toFixed(6);
      m.cost.maxRunUsd = max!.toFixed(6);
    }
    if (latencies.length) {
      m.latencyMs.avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
      m.latencyMs.p95 = p95(latencies);
    }
    m.byVersion = [...versions.values()]
      .map(({ cost, ...v }) => ({ ...v, costUsd: cost.toFixed(6) }))
      .sort((a, b) => b.runs - a.runs);

    for (const d of documents) {
      inc(m.documents.byStatus, d.status);
      if (d.injectionAlert) m.documents.injectionAlerts++;
      if (!d.hasTextLayer) m.documents.withoutTextLayer++;
    }
    for (const f of feedback) {
      if (f.verdict === FindingFeedbackVerdict.CORRECT) m.feedback.correct++;
      else {
        m.feedback.incorrect++;
        inc(m.feedback.incorrectBySubject, f.findingId.split(':')[0] as FindingSubject);
      }
    }
    if (feedback.length) m.feedback.correctionRate = m.feedback.incorrect / feedback.length;
    return m;
  }
}
