import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import {
  AI_PIPELINE_VERSION,
  COMPARISON_VERSION,
  DocumentType,
  EXTRACTION_SCHEMA_VERSION,
  FIELDS_BY_DOCUMENT_TYPE,
  FindingKind,
  type NarrativeInput,
  NARRATIVE_SCHEMA_VERSION,
  REPORT_TEMPLATE_VERSION,
} from '@creditflow/shared';
import type Anthropic from '@anthropic-ai/sdk';
import { AnthropicExtractor } from '../../src/modules/ai-analysis/extraction/anthropic-extractor.js';
import { AnthropicNarrativeWriter } from '../../src/modules/ai-analysis/narrative/anthropic-narrative-writer.js';
import { DATASET_VERSION } from '../dataset/cases.js';
import type { FindingMetrics } from './findings.js';
import type { EvalMetrics, Ratio } from './metrics.js';
import type { NarrativeMetrics } from './narrative.js';

/**
 * Regression gate (stage B6, ADR-0011 decision 3). Changing the model, a
 * prompt, a schema or the pipeline changes the FINGERPRINT below; CI then
 * fails until an authorized real evaluation records a new baseline, and the
 * evaluation refuses to record it if quality got worse.
 */

export type Effort = 'low' | 'medium' | 'high';

/** Everything that decides what the model is asked, except the document itself. */
export interface ExtractionFingerprint {
  model: string;
  effort: Effort;
  /** sha256 of the exact requests (system, instructions, schema, limits) for every document type. */
  requests: string;
  pipelineVersion: string;
  extractionSchemaVersion: string;
  comparisonVersion: string;
  datasetVersion: string;
}

export interface NarrativeFingerprint {
  model: string;
  effort: Effort;
  /** sha256 of the exact request for a fixed input (system, schema, limits). */
  request: string;
  narrativeSchemaVersion: string;
  reportTemplateVersion: string;
  comparisonVersion: string;
  datasetVersion: string;
}

/** Captures the parameters an adapter would send, without any network call. */
function capturingClient(sink: unknown[]): Pick<Anthropic, 'messages'> {
  return {
    messages: {
      create: async (params: unknown) => {
        sink.push(params);
        throw new Error('captured');
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>;
}

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function extractionFingerprint(
  model: string,
  effort: Effort,
): Promise<ExtractionFingerprint> {
  const sink: unknown[] = [];
  const extractor = new AnthropicExtractor(capturingClient(sink), {
    model,
    effort,
    timeoutMs: 60_000,
  });
  for (const type of Object.values(DocumentType)) {
    await extractor.extract({
      documentId: type,
      declaredType: type,
      mimeType: 'application/pdf',
      bytes: Buffer.alloc(0),
      sha256: '0'.repeat(64),
      requestedFields: FIELDS_BY_DOCUMENT_TYPE[type],
    });
  }
  return {
    model,
    effort,
    requests: sha(sink),
    pipelineVersion: AI_PIPELINE_VERSION,
    extractionSchemaVersion: EXTRACTION_SCHEMA_VERSION,
    comparisonVersion: COMPARISON_VERSION,
    datasetVersion: DATASET_VERSION,
  };
}

export async function narrativeFingerprint(
  model: string,
  effort: Effort,
): Promise<NarrativeFingerprint> {
  const sink: unknown[] = [];
  const writer = new AnthropicNarrativeWriter(capturingClient(sink), {
    model,
    effort,
    timeoutMs: 60_000,
  });
  await writer.write({
    facts: [
      {
        id: 'F1',
        subject: 'Renda/faturamento mensal',
        kind: FindingKind.DIVERGENT,
        document: 'Documento 1 (comprovante de renda/faturamento)',
        placeholders: ['declarado', 'documento'],
      },
    ],
    documents: [],
  } satisfies NarrativeInput);
  return {
    model,
    effort,
    request: sha(sink),
    narrativeSchemaVersion: NARRATIVE_SCHEMA_VERSION,
    reportTemplateVersion: REPORT_TEMPLATE_VERSION,
    comparisonVersion: COMPARISON_VERSION,
    datasetVersion: DATASET_VERSION,
  };
}

// ───────────────────────────── gate metrics ─────────────────────────────

export interface ExtractionGateMetrics {
  fieldAccuracy: Ratio;
  evidenceValidity: Ratio;
  statusAccuracy: Ratio;
  safeFallback: Ratio;
  injectionAlert: Ratio;
  findingAccuracy: Ratio;
  /** Must stay at zero, whatever the baseline. */
  unsupportedAccepted: number;
  falseInjectionAlerts: number;
  falseDivergences: number;
  missedDivergences: number;
  costPerDocumentUsd: number;
}

export interface NarrativeGateMetrics {
  accepted: Ratio;
  costPerCaseUsd: number;
}

export function extractionGateMetrics(
  m: EvalMetrics,
  f: FindingMetrics,
  costUsd: number,
): ExtractionGateMetrics {
  return {
    fieldAccuracy: m.fieldAccuracy,
    evidenceValidity: m.evidenceValidity,
    statusAccuracy: m.statusAccuracy,
    safeFallback: m.safeFallback,
    injectionAlert: m.injectionAlert,
    findingAccuracy: f.findingAccuracy,
    unsupportedAccepted: m.unsupportedAccepted,
    falseInjectionAlerts: m.falseInjectionAlerts,
    falseDivergences: f.falseDivergences,
    missedDivergences: f.missedDivergences,
    costPerDocumentUsd: m.documents ? round6(costUsd / m.documents) : 0,
  };
}

export function narrativeGateMetrics(m: NarrativeMetrics): NarrativeGateMetrics {
  return {
    accepted: m.accepted,
    costPerCaseUsd: m.cases ? round6(m.costUsd / m.cases) : 0,
  };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** A real model is not deterministic: a rate may lose at most one case. */
export const RATE_TOLERANCE_CASES = 1;
/** Cost per item may grow at most this much over the baseline. */
export const COST_TOLERANCE = 1.5;

const rate = (r: Ratio) => (r.total ? r.hit / r.total : 1);
const fmt = (r: Ratio) => `${r.hit}/${r.total}`;

/**
 * Problems of `current` against `baseline` (empty = no regression). Zero
 * metrics must stay at zero; rates may lose at most one case; cost per item
 * may grow at most 50%. Without a baseline only the zero metrics apply.
 */
export function regressions<M extends object>(current: M, baseline: M | undefined): string[] {
  const problems: string[] = [];
  for (const [key, value] of Object.entries(current) as [string, unknown][]) {
    const base = baseline ? (baseline as Record<string, unknown>)[key] : undefined;
    if (typeof value === 'number' && key.startsWith('cost')) {
      if (typeof base === 'number' && base > 0 && value > base * COST_TOLERANCE)
        problems.push(`${key}: US$ ${value} > ${COST_TOLERANCE}× baseline (US$ ${base})`);
    } else if (typeof value === 'number') {
      if (value > 0) problems.push(`${key}: ${value} (deve ser 0)`);
    } else if (value && typeof value === 'object' && 'hit' in value) {
      const r = value as Ratio;
      const b = base as Ratio | undefined;
      if (b && r.total > 0 && rate(r) < rate(b) - RATE_TOLERANCE_CASES / r.total - 1e-9)
        problems.push(`${key}: ${fmt(r)} < baseline ${fmt(b)}`);
    }
  }
  return problems;
}

// ───────────────────────────── baseline file ─────────────────────────────

export interface BaselineEntry<F, M> {
  fingerprint: F;
  metrics: M;
  recordedAt: string;
  costUsd: number;
}

export interface BaselineFile {
  extraction: Record<string, BaselineEntry<ExtractionFingerprint, ExtractionGateMetrics>>;
  narrative: Record<string, BaselineEntry<NarrativeFingerprint, NarrativeGateMetrics>>;
}

export const BASELINE_PATH = new URL('../baseline.json', import.meta.url);

export async function readBaseline(): Promise<BaselineFile> {
  try {
    return JSON.parse(await readFile(BASELINE_PATH, 'utf8')) as BaselineFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { extraction: {}, narrative: {} };
    throw err;
  }
}

export async function writeBaseline(b: BaselineFile): Promise<void> {
  await writeFile(BASELINE_PATH, `${JSON.stringify(b, null, 2)}\n`);
}

export const sameFingerprint = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);

/**
 * Outcome of a real run against the baseline: prints the comparison and, when
 * asked and there is no regression, records the new baseline. Returns the
 * process exit code.
 */
export async function gateAndRecord<F, M extends object>(o: {
  kind: 'extraction' | 'narrative';
  fingerprint: F;
  metrics: M;
  costUsd: number;
  update: boolean;
}): Promise<{ exitCode: number; text: string }> {
  const file = await readBaseline();
  const entries = file[o.kind] as Record<string, BaselineEntry<F, M>>;
  const model = (o.fingerprint as { model: string }).model;
  const previous = entries[model];
  const problems = regressions(o.metrics, previous?.metrics);
  const lines = [
    `## Gate de regressão (${o.kind})`,
    '',
    previous
      ? `Baseline de ${previous.recordedAt}${sameFingerprint(previous.fingerprint, o.fingerprint) ? '' : ' (configuração diferente da atual: modelo, prompt, schema ou pipeline mudou)'}.`
      : 'Sem baseline para este modelo: só as métricas que devem ser zero foram conferidas.',
    '',
    problems.length ? 'Regressões:' : 'Nenhuma regressão.',
    ...problems.map((p) => `- ${p}`),
  ];
  if (problems.length) {
    lines.push('', 'Baseline NÃO atualizada.');
    return { exitCode: 1, text: lines.join('\n') };
  }
  if (o.update) {
    entries[model] = {
      fingerprint: o.fingerprint,
      metrics: o.metrics,
      recordedAt: new Date().toISOString(),
      costUsd: round6(o.costUsd),
    };
    await writeBaseline(file);
    lines.push('', 'Baseline atualizada em apps/api/evals/baseline.json (versionar no Git).');
  }
  return { exitCode: 0, text: lines.join('\n') };
}
