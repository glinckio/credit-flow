import Anthropic from '@anthropic-ai/sdk';
import type {
  ExtractionUsage,
  ExtractorResult,
  ProviderErrorCode,
} from '../extraction/document-extractor.js';

/**
 * One tool-less Messages API call with structured output (ADR-0011). Shared by
 * the extraction and the narrative adapters. Never throws: every provider
 * problem becomes a typed error result. Diagnostics carry error classes and
 * status codes only, never content.
 */

/** Most specific first: timeouts before connection errors (subclass). */
export function providerErrorCode(err: unknown): ProviderErrorCode {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'TIMEOUT';
  if (err instanceof Anthropic.RequestTimeoutError) return 'TIMEOUT';
  return 'UNAVAILABLE';
}

const ZERO: ExtractionUsage = { inputTokens: 0, outputTokens: 0 };

export interface StructuredCallOptions {
  model: string;
  effort: 'low' | 'medium' | 'high';
  timeoutMs: number;
  maxTokens: number;
  system: string;
  content: Anthropic.ContentBlockParam[];
  schema: Record<string, unknown>;
  onError?: (info: { code: ProviderErrorCode; detail: string }) => void;
}

export async function structuredCall(
  client: Pick<Anthropic, 'messages'>,
  o: StructuredCallOptions,
): Promise<ExtractorResult> {
  const started = Date.now();
  const fail = (
    code: ProviderErrorCode,
    usage: ExtractionUsage,
    detail: string,
  ): ExtractorResult => {
    o.onError?.({ code, detail });
    return { kind: 'error', code, model: o.model, usage, latencyMs: Date.now() - started };
  };

  let message: Anthropic.Message;
  try {
    message = await client.messages.create(
      {
        model: o.model,
        max_tokens: o.maxTokens,
        system: o.system,
        output_config: { effort: o.effort, format: { type: 'json_schema', schema: o.schema } },
        messages: [{ role: 'user', content: o.content }],
      },
      { timeout: o.timeoutMs },
    );
  } catch (err) {
    const status = err instanceof Anthropic.APIError ? String(err.status ?? '') : '';
    const name = err instanceof Error ? err.constructor.name : 'unknown';
    return fail(providerErrorCode(err), ZERO, `${name}${status ? ` ${status}` : ''}`);
  }

  const usage = {
    inputTokens: message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0),
    outputTokens: message.usage.output_tokens,
  };
  if (message.stop_reason === 'refusal') return fail('REFUSED', usage, 'stop_reason refusal');
  if (message.stop_reason !== 'end_turn') {
    return fail('INVALID_RESPONSE', usage, `stop_reason ${message.stop_reason}`);
  }
  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  let output: unknown;
  try {
    output = JSON.parse(text);
  } catch {
    return fail('INVALID_RESPONSE', usage, 'response is not JSON');
  }
  return { kind: 'ok', output, model: o.model, usage, latencyMs: Date.now() - started };
}
