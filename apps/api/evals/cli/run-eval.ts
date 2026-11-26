/**
 * Runs the document-extraction evaluation and writes a report to
 * var/evals/reports.
 *
 *   pnpm --filter @creditflow/api eval:ai                       # recorded answers (offline, free)
 *   pnpm --filter @creditflow/api eval:ai -- --provider recorded
 *
 * A real provider (`--provider anthropic`) arrives in stage B3. Every run
 * against a real model costs money and needs explicit authorization of the
 * product owner beforehand (ADR-0011; docs/plano-parte-b.md).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { RecordedExtractor } from '../../src/modules/ai-analysis/extraction/recorded-extractor.js';
import { buildCases } from '../dataset/cases.js';
import { computeMetrics } from '../harness/metrics.js';
import { renderReport } from '../harness/report.js';
import { recordingsFor, runEval } from '../harness/run-eval.js';
import { EVALS_OUTPUT_DIR } from './paths.js';

const { values } = parseArgs({ options: { provider: { type: 'string', default: 'recorded' } } });

if (values.provider !== 'recorded') {
  console.error(
    `Provedor "${values.provider}" indisponível. Só "recorded" existe até a etapa B3; ` +
      'rodadas com modelo real exigem autorização explícita a cada execução.',
  );
  process.exit(2);
}

const cases = buildCases();
const extractor = new RecordedExtractor(recordingsFor(cases));
const metrics = computeMetrics(await runEval(cases, extractor));
const report = renderReport(metrics, extractor.model);

const dir = join(EVALS_OUTPUT_DIR, 'reports');
await mkdir(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await writeFile(
  join(dir, `${stamp}-${extractor.model}.json`),
  `${JSON.stringify(metrics, null, 2)}\n`,
);
await writeFile(join(dir, `${stamp}-${extractor.model}.md`), report);
console.log(report);

// The safety metric is a hard gate, whatever the provider.
if (metrics.unsupportedAccepted > 0) process.exit(1);
