import { type NarrativeInput, deterministicNarrative } from '@creditflow/shared';
import type { ExtractorResult } from '../extraction/document-extractor.js';

/**
 * Port for the narrative over verified findings (ADR-0011, D8 option B). It
 * receives only `NarrativeInput` (ids, subjects, kinds — never documents or
 * values) and returns the untrusted model answer, validated afterwards by
 * `validateNarrative`. Never throws for provider problems.
 */
export type NarrativeWriterResult = ExtractorResult;

export interface NarrativeWriter {
  readonly model: string;
  readonly promptVersion: string;
  write(input: NarrativeInput): Promise<NarrativeWriterResult>;
}

/**
 * Offline writer (tests, CI, recorded evaluation): one fixed sentence per fact.
 * Optional `script` replaces the answer, to exercise the guards.
 */
export class DeterministicNarrativeWriter implements NarrativeWriter {
  readonly model = 'deterministic';
  readonly promptVersion = 'none';
  calls = 0;

  constructor(
    private readonly script?: (input: NarrativeInput) => NarrativeWriterResult | unknown,
  ) {}

  async write(input: NarrativeInput): Promise<NarrativeWriterResult> {
    this.calls++;
    const scripted = this.script?.(input);
    if (scripted && typeof scripted === 'object' && 'kind' in scripted)
      return scripted as NarrativeWriterResult;
    return {
      kind: 'ok',
      output: scripted ?? deterministicNarrative(input),
      model: this.model,
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: 0,
    };
  }
}
