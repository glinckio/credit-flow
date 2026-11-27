/**
 * Runs the document-extraction evaluation and writes a report to
 * var/evals/reports.
 *
 *   pnpm --filter @creditflow/api eval:ai                                   # recorded answers (offline, free)
 *   pnpm --filter @creditflow/api eval:ai --provider anthropic            # dry run: cost estimate only
 *   pnpm --filter @creditflow/api eval:ai --provider anthropic --confirm  # PAID run
 *   ... --confirm --update-baseline   # PAID run; records the baseline if nothing regressed
 *
 * A paid run is always compared with apps/api/evals/baseline.json (B6) and
 * exits 1 on regression.
 *
 * Every run against a real model costs money and needs explicit authorization
 * of the product owner beforehand, after seeing the current results
 * (ADR-0011; docs/plano-parte-b.md). Synthetic data only.
 */
import { existsSync } from 'node:fs';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import { ALLOWED_AI_MODELS, requestCostUsd } from '@creditflow/shared';
import { AnthropicExtractor } from '../../src/modules/ai-analysis/extraction/anthropic-extractor.js';
import type { DocumentExtractor } from '../../src/modules/ai-analysis/extraction/document-extractor.js';
import { RecordedExtractor } from '../../src/modules/ai-analysis/extraction/recorded-extractor.js';
import { PdfJsTextReader } from '../../src/modules/ai-analysis/text/pdfjs-text-reader.js';
import { materialize } from '../dataset/builder.js';
import { buildCases } from '../dataset/cases.js';
import { computeFindingMetrics } from '../harness/findings.js';
import { computeMetrics } from '../harness/metrics.js';
import {
  extractionFingerprint,
  extractionGateMetrics,
  gateAndRecord,
} from '../harness/regression.js';
import { renderReport } from '../harness/report.js';
import { recordingsFor, runEval } from '../harness/run-eval.js';
import { EVALS_OUTPUT_DIR } from './paths.js';

const { values } = parseArgs({
  // pnpm forwards a literal "--" separator; drop it.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    provider: { type: 'string', default: 'recorded' },
    confirm: { type: 'boolean', default: false },
    effort: { type: 'string', default: 'medium' },
    'update-baseline': { type: 'boolean', default: false },
  },
});

const allCases = buildCases();
// Scripted provider failures only exist with the recorded extractor: a real
// model answers those same documents normally (first paid run, 2026-11-27).
const skipped =
  values.provider === 'recorded' ? [] : allCases.filter((c) => c.simulatesProviderFailure);
const cases = allCases.filter((c) => !skipped.includes(c));
let extractor: DocumentExtractor;

if (values.provider === 'recorded') {
  extractor = new RecordedExtractor(recordingsFor(cases));
} else if (values.provider === 'anthropic') {
  const model = ALLOWED_AI_MODELS[0];
  // Estimate per request (the price tier is per request): ~3,000 input tokens
  // per page + ~1,500 of prompt; typical ~2,000 output tokens, worst case the
  // full max_tokens (8,000).
  const reader = new PdfJsTextReader();
  let pages = 0;
  let typical = 0;
  let worst = 0;
  const documents = cases.flatMap((c) => c.documents);
  for (const d of documents) {
    const n = (await reader.countPages(materialize(d).bytes, d.mimeType)) ?? 1;
    pages += n;
    typical += requestCostUsd(model, n * 3_000 + 1_500, 2_000);
    worst += requestCostUsd(model, n * 3_000 + 1_500, 8_000);
  }
  console.log(
    `Modelo ${model} · ${documents.length} documentos · ${pages} páginas · ` +
      `custo estimado ~US$ ${typical.toFixed(3)} (pior caso US$ ${worst.toFixed(3)}).`,
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
  extractor = new AnthropicExtractor(new Anthropic({ maxRetries: 1, timeout: 60_000 }), {
    model,
    effort,
    timeoutMs: 60_000,
    onError: (i) => console.error(`  ${i.documentId}: ${i.code} (${i.detail})`),
  });
} else {
  console.error(`Provedor "${values.provider}" desconhecido (recorded | anthropic).`);
  process.exit(2);
}

const runs = await runEval(cases, extractor);
const metrics = computeMetrics(runs);
const findings = computeFindingMetrics(cases, runs);
const costUsd = runs.reduce(
  (sum, r) => sum + requestCostUsd(r.model, r.usage.inputTokens, r.usage.outputTokens),
  0,
);
const skippedNote = skipped.length
  ? `\nCasos que só simulam falha do provedor (rodam apenas no modo gravado): ${skipped.map((c) => c.id).join(', ')}.\n`
  : '';
const report = `${renderReport(metrics, findings, extractor.model)}${skippedNote}\nCusto da rodada: US$ ${costUsd.toFixed(4)}\n`;

const dir = join(EVALS_OUTPUT_DIR, 'reports');
await mkdir(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await writeFile(
  join(dir, `${stamp}-${extractor.model}.json`),
  `${JSON.stringify({ ...metrics, findings, costUsd }, null, 2)}\n`,
);
await writeFile(join(dir, `${stamp}-${extractor.model}.md`), report);
console.log(report);

// The safety metric is a hard gate, whatever the provider.
if (metrics.unsupportedAccepted > 0) process.exit(1);

// Real model: regression gate against the versioned baseline (stage B6).
if (values.provider === 'anthropic') {
  const gate = await gateAndRecord({
    kind: 'extraction',
    fingerprint: await extractionFingerprint(
      extractor.model,
      values.effort as 'low' | 'medium' | 'high',
    ),
    metrics: extractionGateMetrics(metrics, findings, costUsd),
    costUsd,
    update: values['update-baseline'],
  });
  console.log(gate.text);
  await appendFile(join(dir, `${stamp}-${extractor.model}.md`), `\n${gate.text}\n`);
  process.exit(gate.exitCode);
}
