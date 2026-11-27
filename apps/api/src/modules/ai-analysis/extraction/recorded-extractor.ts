import type {
  DocumentExtractor,
  ExtractionRequest,
  ExtractorResult,
  ProviderErrorCode,
} from './document-extractor.js';

/** A stored provider answer for one document, keyed by the document's sha256. */
export type RecordedResponse =
  { kind: 'ok'; output: unknown } | { kind: 'error'; code: ProviderErrorCode };

export const RECORDED_MODEL = 'recorded';

/**
 * Deterministic extractor that replays recorded answers (ADR-0011, decision 8).
 * Same document → same answer, no network, no cost. Used by unit/integration
 * tests, CI and the offline evaluation. A document without a recording is a
 * test-setup bug and throws (it is not a provider failure).
 */
export class RecordedExtractor implements DocumentExtractor {
  readonly model = RECORDED_MODEL;
  readonly promptVersion = 'none';

  constructor(private readonly recordings: ReadonlyMap<string, RecordedResponse>) {}

  async extract(request: ExtractionRequest): Promise<ExtractorResult> {
    const recorded = this.recordings.get(request.sha256);
    if (!recorded) {
      throw new Error(`No recorded response for document sha256 ${request.sha256}`);
    }
    const base = { model: this.model, usage: { inputTokens: 0, outputTokens: 0 }, latencyMs: 0 };
    // Deep copy: callers must not be able to mutate the recording.
    return recorded.kind === 'ok'
      ? { kind: 'ok', output: structuredClone(recorded.output), ...base }
      : { kind: 'error', code: recorded.code, ...base };
  }
}
