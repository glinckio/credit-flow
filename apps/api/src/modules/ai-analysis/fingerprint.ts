import { createHash } from 'node:crypto';
import { AI_PIPELINE_VERSION, EXTRACTION_SCHEMA_VERSION } from '@creditflow/shared';

export interface FingerprintInput {
  documents: ReadonlyArray<{ id: string; sha256: string }>;
  model: string;
  promptVersion: string;
}

/**
 * Identity of an analysis input (ADR-0011): which exact documents, analysed by
 * which model, prompt, schema and pipeline. A run whose fingerprint differs
 * from the current one is "desatualizada". Order-independent.
 */
export function inputFingerprint(input: FingerprintInput): string {
  const canonical = JSON.stringify({
    documents: [...input.documents].map((d) => `${d.id}:${d.sha256}`).sort(),
    model: input.model,
    promptVersion: input.promptVersion,
    extractionSchemaVersion: EXTRACTION_SCHEMA_VERSION,
    pipelineVersion: AI_PIPELINE_VERSION,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
