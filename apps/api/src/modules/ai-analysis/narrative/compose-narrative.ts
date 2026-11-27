import {
  type Finding,
  NARRATIVE_SCHEMA_VERSION,
  type NarrativeReport,
  NarrativeStatus,
  type TemplateReport,
  buildNarrativeInput,
  narrativeNeeded,
  validateNarrative,
} from '@creditflow/shared';
import type { ExtractionUsage } from '../extraction/document-extractor.js';
import type { NarrativeWriter } from './narrative-writer.js';

export interface ComposedNarrative {
  narrative: NarrativeReport;
  /** Billed usage of the call (zero when no call was made). */
  usage: ExtractionUsage;
  model: string | null;
  /** Raw model answer, for the offline evaluation only. Never persisted by the worker. */
  modelOutput?: unknown;
}

const ZERO: ExtractionUsage = { inputTokens: 0, outputTokens: 0 };

/**
 * Narrative step of a run (ADR-0011, D8): decides whether to call the model,
 * calls it at most once, validates the answer and renders it. The template is
 * never affected; any problem only means "no narrative".
 */
export async function composeNarrative(
  writer: NarrativeWriter | null,
  report: TemplateReport,
  findings: readonly Finding[],
  opts: { budgetExhausted: boolean; onWriterError?: (err: unknown) => void },
): Promise<ComposedNarrative> {
  const base = (status: NarrativeStatus): NarrativeReport => ({
    version: NARRATIVE_SCHEMA_VERSION,
    status,
    model: writer?.model ?? null,
    promptVersion: writer?.promptVersion ?? null,
    sentences: [],
    rejections: [],
  });
  const none = (status: NarrativeStatus): ComposedNarrative => ({
    narrative: base(status),
    usage: ZERO,
    model: null,
  });

  if (!writer) return none(NarrativeStatus.DISABLED);
  const { input, bindings } = buildNarrativeInput(report, findings);
  if (!narrativeNeeded(input)) return none(NarrativeStatus.NOT_NEEDED);
  if (opts.budgetExhausted) return none(NarrativeStatus.SKIPPED_BUDGET);

  let result;
  try {
    result = await writer.write(input);
  } catch (err) {
    opts.onWriterError?.(err);
    return none(NarrativeStatus.FAILED);
  }
  const charged = { usage: result.usage, model: result.model };
  if (result.kind === 'error') return { narrative: base(NarrativeStatus.FAILED), ...charged };
  const withOutput = { ...charged, modelOutput: result.output };

  const validation = validateNarrative(result.output, input, bindings);
  if (!validation.ok) {
    return {
      narrative: { ...base(NarrativeStatus.REJECTED), rejections: validation.reasons },
      ...withOutput,
    };
  }
  return {
    narrative: { ...base(NarrativeStatus.OK), sentences: validation.sentences },
    ...withOutput,
  };
}
