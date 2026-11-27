import {
  type NarrativeReport,
  NarrativeStatus,
  buildTemplateReport,
  requestCostUsd,
} from '@creditflow/shared';
import { toAssessedDocument } from '../../src/modules/ai-analysis/extraction/to-assessed.js';
import { composeNarrative } from '../../src/modules/ai-analysis/narrative/compose-narrative.js';
import type { NarrativeWriter } from '../../src/modules/ai-analysis/narrative/narrative-writer.js';
import type { EvalCase } from '../dataset/types.js';
import { caseFindings } from './findings.js';
import type { DocumentRun } from './run-eval.js';

/**
 * Narrative evaluation (ADR-0011, D8). The findings come from the recorded
 * extraction (free, deterministic), so a paid run only pays for the narrative
 * calls. Every narrative goes through the same validator as production: what
 * is measured is how often the model writes text that may be shown.
 */

export interface NarrativeCaseRun {
  caseId: string;
  narrative: NarrativeReport;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Raw model sentences (synthetic data): lets a paid run be re-validated offline (--replay). */
  modelSentences?: Array<{ text: string; refs: string[] }>;
}

function modelSentencesOf(output: unknown): NarrativeCaseRun['modelSentences'] {
  const sentences = (output as { sentences?: unknown } | null | undefined)?.sentences;
  if (!Array.isArray(sentences)) return undefined;
  return sentences.map((x: { text?: unknown; refs?: unknown } | null) => ({
    text: typeof x?.text === 'string' ? x.text : '',
    refs: Array.isArray(x?.refs) ? x.refs.map(String) : [],
  }));
}

export async function runNarrativeEval(
  cases: readonly EvalCase[],
  extractionRuns: readonly DocumentRun[],
  /** One writer for all cases, or one per case (replay of a saved run). */
  writer: NarrativeWriter | ((caseId: string) => NarrativeWriter | null),
): Promise<NarrativeCaseRun[]> {
  const out: NarrativeCaseRun[] = [];
  for (const c of cases) {
    const docs = extractionRuns
      .filter((r) => r.caseId === c.id)
      .map((r) => toAssessedDocument(r.document.id, r.document.declaredType, r.assessment));
    const findings = caseFindings(c, extractionRuns);
    const report = buildTemplateReport(findings, docs, {});
    const w = typeof writer === 'function' ? writer(c.id) : writer;
    if (!w) continue;
    const composed = await composeNarrative(w, report, findings, { budgetExhausted: false });
    out.push({
      caseId: c.id,
      narrative: composed.narrative,
      modelSentences: modelSentencesOf(composed.modelOutput),
      inputTokens: composed.usage.inputTokens,
      outputTokens: composed.usage.outputTokens,
      costUsd: composed.model
        ? requestCostUsd(composed.model, composed.usage.inputTokens, composed.usage.outputTokens)
        : 0,
    });
  }
  return out;
}

export interface NarrativeMetrics {
  cases: number;
  byStatus: Record<string, number>;
  /** Narratives that may be shown, among those that needed one. */
  accepted: { hit: number; total: number };
  rejectionReasons: Record<string, number>;
  tokens: { input: number; output: number };
  costUsd: number;
}

export function narrativeMetrics(runs: readonly NarrativeCaseRun[]): NarrativeMetrics {
  const m: NarrativeMetrics = {
    cases: runs.length,
    byStatus: {},
    accepted: { hit: 0, total: 0 },
    rejectionReasons: {},
    tokens: { input: 0, output: 0 },
    costUsd: 0,
  };
  for (const r of runs) {
    const s = r.narrative.status;
    m.byStatus[s] = (m.byStatus[s] ?? 0) + 1;
    if (s !== NarrativeStatus.NOT_NEEDED) {
      m.accepted.total++;
      if (s === NarrativeStatus.OK) m.accepted.hit++;
    }
    for (const x of r.narrative.rejections)
      m.rejectionReasons[x.reason] = (m.rejectionReasons[x.reason] ?? 0) + 1;
    m.tokens.input += r.inputTokens;
    m.tokens.output += r.outputTokens;
    m.costUsd += r.costUsd;
  }
  return m;
}

/** Human-readable report (pt-BR), with every accepted narrative for a quality read. */
export function renderNarrativeReport(
  m: NarrativeMetrics,
  runs: readonly NarrativeCaseRun[],
  model: string,
): string {
  const lines = [
    '# Avaliação — narrativa (B4)',
    '',
    `- Modelo: ${model} · Casos: ${m.cases}`,
    '',
    '| Métrica | Resultado |',
    '| --- | --- |',
    `| **Narrativas aceitas pela validação** | **${m.accepted.hit}/${m.accepted.total}** |`,
    ...Object.entries(m.byStatus).map(([s, n]) => `| Status ${s} | ${n} |`),
    `| Tokens entrada / saída | ${m.tokens.input} / ${m.tokens.output} |`,
    `| Custo da rodada | US$ ${m.costUsd.toFixed(4)} |`,
    '',
    'Narrativa rejeitada não é exibida: o analista vê só o template (sempre disponível).',
  ];
  const reasons = Object.entries(m.rejectionReasons);
  if (reasons.length) {
    lines.push('', '## Motivos de rejeição', '', '| Motivo | Ocorrências |', '| --- | --- |');
    for (const [r, n] of reasons) lines.push(`| ${r} | ${n} |`);
  }
  lines.push('', '## Narrativas por caso', '');
  for (const r of runs) {
    lines.push(`### ${r.caseId} — ${r.narrative.status}`, '');
    if (r.narrative.status === NarrativeStatus.OK) {
      for (const s of r.narrative.sentences) lines.push(`- ${s.text}`);
    } else if (r.narrative.rejections.length) {
      lines.push(
        `- Rejeitada: ${r.narrative.rejections
          .map((x) => (x.sentence === null ? x.reason : `${x.reason} (frase ${x.sentence + 1})`))
          .join(', ')}`,
      );
      r.modelSentences?.forEach((s, i) => {
        const why = r.narrative.rejections.filter((x) => x.sentence === i).map((x) => x.reason);
        const mark = why.length ? `✗ ${why.join(', ')}` : '✓';
        lines.push(`  ${i + 1}. [${s.refs.join(', ')}] ${s.text} (${mark})`);
      });
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
