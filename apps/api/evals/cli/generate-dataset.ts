/**
 * Writes the synthetic evaluation dataset to var/evals/dataset/<version>:
 * one PDF per document plus manifest.json (truth, expectations, sha256) and
 * recorded-responses.json. Deterministic: same code → same bytes.
 *
 *   pnpm --filter @creditflow/api eval:dataset
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EXTRACTION_SCHEMA_VERSION } from '@creditflow/shared';
import { materialize } from '../dataset/builder.js';
import { DATASET_VERSION, buildCases } from '../dataset/cases.js';
import { recordingsFor } from '../harness/run-eval.js';
import { EVALS_OUTPUT_DIR } from './paths.js';

const cases = buildCases();
const recordings = recordingsFor(cases); // also fails on duplicated bytes
const outDir = join(EVALS_OUTPUT_DIR, 'dataset', DATASET_VERSION);
await rm(outDir, { recursive: true, force: true });

const documents = [];
for (const c of cases) {
  await mkdir(join(outDir, c.id), { recursive: true });
  for (const doc of c.documents) {
    const m = materialize(doc);
    const file = join(c.id, `${doc.id}.pdf`);
    await writeFile(join(outDir, file), m.bytes);
    documents.push({
      caseId: c.id,
      documentId: doc.id,
      file: file.replace(/\\/g, '/'),
      sha256: m.sha256,
      declaredType: doc.declaredType,
      requestedFields: doc.requestedFields,
      truth: doc.truth,
      expected: doc.expected,
    });
  }
}

const manifest = {
  datasetVersion: DATASET_VERSION,
  extractionSchemaVersion: EXTRACTION_SCHEMA_VERSION,
  synthetic: true,
  cases: cases.map(({ id, title, covers, application, expectedFindings }) => ({
    id,
    title,
    covers,
    application,
    expectedFindings,
  })),
  documents,
};
await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  join(outDir, 'recorded-responses.json'),
  `${JSON.stringify(Object.fromEntries(recordings), null, 2)}\n`,
);
console.log(
  `Dataset ${DATASET_VERSION}: ${cases.length} casos, ${documents.length} documentos → ${outDir}`,
);
