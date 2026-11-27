/**
 * Narrative evaluation (stage B4). Findings come from the recorded extraction
 * (free); only the narrative calls go to the model.
 *
 *   pnpm --filter @creditflow/api eval:narrative                                   # deterministic writer (offline, free)
 *   pnpm --filter @creditflow/api eval:narrative --provider anthropic            # dry run: cost estimate only
 *   pnpm --filter @creditflow/api eval:narrative --provider anthropic --confirm  # PAID run
 *   pnpm --filter @creditflow/api eval:narrative --replay <report.json>          # re-validate a saved run (free)
 *   ... --confirm --update-baseline   # PAID run; records the baseline if nothing regressed (B6)
 *
 * Every run against a real model needs explicit authorization beforehand,
 * after seeing the current results (ADR-0011). Synthetic data only.
 */
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import {
  ALLOWED_AI_MODELS,
  NarrativeStatus,
  buildNarrativeInput,
  buildTemplateReport,
  narrativeNeeded,
  requestCostUsd,
} from '@creditflow/shared';
import { toAssessedDocument } from '../../src/modules/ai-analysis/extraction/to-assessed.js';
import { RecordedExtractor } from '../../src/modules/ai-analysis/extraction/recorded-extractor.js';
import { AnthropicNarrativeWriter } from '../../src/modules/ai-analysis/narrative/anthropic-narrative-writer.js';
import {
  DeterministicNarrativeWriter,
  type NarrativeWriter,
} from '../../src/modules/ai-analysis/narrative/narrative-writer.js';
import { buildCases } from '../dataset/cases.js';
import { caseFindings } from '../harness/findings.js';
import { narrativeMetrics, renderNarrativeReport, runNarrativeEval } from '../harness/narrative.js';
import {
  gateAndRecord,
  narrativeFingerprint,
  narrativeGateMetrics,
} from '../harness/regression.js';
import { recordingsFor, runEval } from '../harness/run-eval.js';
import { EVALS_OUTPUT_DIR } from './paths.js';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    provider: { type: 'string', default: 'recorded' },
    confirm: { type: 'boolean', default: false },
    effort: { type: 'string', default: 'medium' },
    replay: { type: 'string' },
    'update-baseline': { type: 'boolean', default: false },
  },
});

const cases = buildCases();
const extractionRuns = await runEval(cases, new RecordedExtractor(recordingsFor(cases)));
let writer: NarrativeWriter | ((caseId: string) => NarrativeWriter | null);
let label: string;

if (values.replay) {
  // The validator of TODAY applied to the model answers of a saved run: no call, no cost.
  const saved = JSON.parse(readFileSync(values.replay, 'utf8')) as {
    runs: Array<{ caseId: string; modelSentences?: unknown; rejectedSentences?: unknown }>;
  };
  const answers = new Map(
    saved.runs.flatMap((r) => {
      const sentences = r.modelSentences ?? r.rejectedSentences;
      return sentences ? [[r.caseId, sentences] as const] : [];
    }),
  );
  console.log(
    `Replay de ${answers.size} respostas gravadas (casos sem resposta gravada ficam de fora).`,
  );
  writer = (caseId) => {
    const sentences = answers.get(caseId);
    return sentences ? new DeterministicNarrativeWriter(() => ({ sentences })) : null;
  };
  label = 'replay';
} else if (values.provider === 'recorded') {
  writer = new DeterministicNarrativeWriter();
  label = writer.model;
} else if (values.provider === 'anthropic') {
  const model = ALLOWED_AI_MODELS[0];
  // Estimate per request: ~1,500 tokens of prompt + ~120 per fact/document;
  // typical output ~70 tokens per sentence; worst case the full max_tokens (4,000).
  let calls = 0;
  let typical = 0;
  let worst = 0;
  for (const c of cases) {
    const docs = extractionRuns
      .filter((r) => r.caseId === c.id)
      .map((r) => toAssessedDocument(r.document.id, r.document.declaredType, r.assessment));
    const findings = caseFindings(c, extractionRuns);
    const { input } = buildNarrativeInput(buildTemplateReport(findings, docs, {}), findings);
    if (!narrativeNeeded(input)) continue;
    const items = input.facts.length + input.documents.length;
    calls++;
    typical += requestCostUsd(model, 1_500 + 120 * items, 200 + 70 * items);
    worst += requestCostUsd(model, 1_500 + 120 * items, 4_000);
  }
  console.log(
    `Modelo ${model} · ${calls} narrativas · custo estimado ~US$ ${typical.toFixed(3)} ` +
      `(pior caso US$ ${worst.toFixed(3)}).`,
  );
  if (!values.confirm) {
    console.log('Simulação apenas. Rodada paga exige autorização e a flag --confirm.');
    process.exit(0);
  }
  const envFile = resolve(import.meta.dirname, '../../../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Defina ANTHROPIC_API_KEY no .env da raiz do projeto (nunca no Git).');
    process.exit(2);
  }
  const effort = values.effort as 'low' | 'medium' | 'high';
  if (!['low', 'medium', 'high'].includes(effort)) {
    console.error('--effort deve ser low|medium|high');
    process.exit(2);
  }
  writer = new AnthropicNarrativeWriter(new Anthropic({ maxRetries: 1, timeout: 60_000 }), {
    model,
    effort,
    timeoutMs: 60_000,
    onError: (i) => console.error(`  narrativa: ${i.code} (${i.detail})`),
  });
  label = writer.model;
} else {
  console.error(`Provedor "${values.provider}" desconhecido (recorded | anthropic).`);
  process.exit(2);
}

const runs = await runNarrativeEval(cases, extractionRuns, writer);
const metrics = narrativeMetrics(runs);
const report = renderNarrativeReport(metrics, runs, label);

const dir = join(EVALS_OUTPUT_DIR, 'reports');
await mkdir(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await writeFile(
  join(dir, `${stamp}-narrative-${label}.json`),
  `${JSON.stringify({ metrics, runs }, null, 2)}\n`,
);
await writeFile(join(dir, `${stamp}-narrative-${label}.md`), report);
console.log(report);

// Offline, the deterministic writer must always pass the validator.
if (!values.replay && values.provider === 'recorded' && metrics.byStatus[NarrativeStatus.REJECTED])
  process.exit(1);

// Real model: regression gate against the versioned baseline (stage B6).
if (!values.replay && values.provider === 'anthropic') {
  const gate = await gateAndRecord({
    kind: 'narrative',
    fingerprint: await narrativeFingerprint(label, values.effort as 'low' | 'medium' | 'high'),
    metrics: narrativeGateMetrics(metrics),
    costUsd: metrics.costUsd,
    update: values['update-baseline'],
  });
  console.log(gate.text);
  await appendFile(join(dir, `${stamp}-narrative-${label}.md`), `\n${gate.text}\n`);
  process.exit(gate.exitCode);
}
