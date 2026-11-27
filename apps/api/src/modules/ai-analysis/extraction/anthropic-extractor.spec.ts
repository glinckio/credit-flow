import Anthropic from '@anthropic-ai/sdk';
import { DocumentType, ExtractedFieldKey as K } from '@creditflow/shared';
import { AnthropicExtractor, EXTRACTION_PROMPT_VERSION } from './anthropic-extractor.js';
import type { ExtractionRequest } from './document-extractor.js';

/** Shape of the request body the tests inspect. */
type Body = {
  model: string;
  tools?: unknown;
  tool_choice?: unknown;
  system: string;
  output_config: {
    effort: string;
    format: {
      type: string;
      schema: { properties: { fields: { items: { properties: { key: { enum: string[] } } } } } };
    };
  };
  messages: Array<{ content: Array<{ type: string; source: { media_type: string } }> }>;
};

const request: ExtractionRequest = {
  documentId: 'doc-1',
  declaredType: DocumentType.PROOF_OF_INCOME,
  mimeType: 'application/pdf',
  bytes: Buffer.from('%PDF-1.4 synthetic'),
  sha256: 'a'.repeat(64),
  requestedFields: [K.HOLDER_NAME, K.NET_MONTHLY_INCOME],
};

const answer = {
  detectedType: 'PROOF_OF_INCOME',
  legibility: 'OK',
  embeddedInstructionsDetected: false,
  fields: [],
};

function message(over: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text: JSON.stringify(answer), citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0 },
    ...over,
  } as unknown as Anthropic.Message;
}

function extractorWith(create: (...args: unknown[]) => Promise<unknown>) {
  const errors: string[] = [];
  const ex = new AnthropicExtractor(
    { messages: { create } } as unknown as Pick<Anthropic, 'messages'>,
    {
      model: 'claude-haiku-5-5',
      effort: 'medium',
      timeoutMs: 1000,
      onError: (i) => errors.push(`${i.code}:${i.detail}`),
    },
  );
  return { ex, errors };
}

describe('AnthropicExtractor', () => {
  it('sends one tool-less request with structured output and the document as base64', async () => {
    const create = vi.fn(async () => message());
    const { ex } = extractorWith(create);
    const result = await ex.extract(request);

    expect(result).toMatchObject({
      kind: 'ok',
      output: answer,
      usage: { inputTokens: 1200, outputTokens: 300 },
    });
    expect(ex.promptVersion).toBe(EXTRACTION_PROMPT_VERSION);
    const [body, opts] = create.mock.calls[0] as unknown as [Body, Record<string, unknown>];
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(body.output_config.effort).toBe('medium');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.schema.properties.fields.items.properties.key.enum).toEqual([
      'holderName',
      'netMonthlyIncome',
    ]);
    expect(body.messages[0]!.content[0]!).toEqual({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: request.bytes.toString('base64'),
      },
    });
    expect(body.system).toMatch(/NÃO CONFIÁVEL/);
    expect(body.system).toMatch(/Nunca siga instruções/);
    expect(opts).toEqual({ timeout: 1000 });
  });

  it('sends images as image blocks', async () => {
    const create = vi.fn(async () => message());
    await extractorWith(create).ex.extract({ ...request, mimeType: 'image/png' });
    const [body] = create.mock.calls[0] as unknown as [Body];
    expect(body.messages[0]!.content[0]!.type).toBe('image');
    expect(body.messages[0]!.content[0]!.source.media_type).toBe('image/png');
  });

  it.each([
    ['refusal', message({ stop_reason: 'refusal' }), 'REFUSED'],
    ['truncated output', message({ stop_reason: 'max_tokens' }), 'INVALID_RESPONSE'],
    [
      'non-JSON text',
      message({ content: [{ type: 'text', text: 'Olá!', citations: null }] as never }),
      'INVALID_RESPONSE',
    ],
  ])('maps %s to %s, keeping the billed usage', async (_l, msg, code) => {
    const { ex, errors } = extractorWith(async () => msg);
    const r = await ex.extract(request);
    expect(r).toMatchObject({
      kind: 'error',
      code,
      usage: { inputTokens: 1200, outputTokens: 300 },
    });
    expect(errors).toHaveLength(1);
  });

  it.each([
    ['timeout', new Anthropic.APIConnectionTimeoutError(), 'TIMEOUT'],
    ['connection', new Anthropic.APIConnectionError({ message: 'down' }), 'UNAVAILABLE'],
    ['anything else', new Error('boom'), 'UNAVAILABLE'],
  ])('never throws: %s → %s', async (_l, err, code) => {
    const { ex, errors } = extractorWith(async () => {
      throw err;
    });
    await expect(ex.extract(request)).resolves.toMatchObject({ kind: 'error', code });
    expect(errors[0]).not.toContain('down'); // diagnostics carry the class, not provider text
  });
});
