import type Anthropic from '@anthropic-ai/sdk';
import { FindingKind, type NarrativeInput } from '@creditflow/shared';
import {
  AnthropicNarrativeWriter,
  NARRATIVE_PROMPT_VERSION,
} from './anthropic-narrative-writer.js';

type Body = {
  model: string;
  tools?: unknown;
  system: string;
  output_config: { format: { type: string; schema: { required: string[] } } };
  messages: Array<{ content: Array<{ type: string; text: string }> }>;
};

const input: NarrativeInput = {
  facts: [
    {
      id: 'F1',
      subject: 'Renda/faturamento mensal',
      kind: FindingKind.DIVERGENT,
      document: 'Documento 1 (comprovante de renda/faturamento)',
      placeholders: ['declarado', 'documento'],
    },
  ],
  documents: [],
};

describe('AnthropicNarrativeWriter', () => {
  it('sends only the findings input, without tools, with structured output', async () => {
    const answer = { sentences: [{ text: 'x', refs: ['F1'] }] };
    const create = vi.fn(async () => ({
      content: [{ type: 'text', text: JSON.stringify(answer) }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 700, output_tokens: 90 },
    }));
    const writer = new AnthropicNarrativeWriter(
      { messages: { create } } as unknown as Pick<Anthropic, 'messages'>,
      { model: 'claude-haiku-5-5', effort: 'medium', timeoutMs: 1000 },
    );
    const r = await writer.write(input);

    expect(r).toMatchObject({ kind: 'ok', output: answer, usage: { inputTokens: 700 } });
    expect(writer.promptVersion).toBe(NARRATIVE_PROMPT_VERSION);
    const [body] = create.mock.calls[0] as unknown as [Body];
    expect(body.tools).toBeUndefined();
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.schema.required).toEqual(['sentences']);
    expect(body.messages[0]!.content).toHaveLength(1);
    expect(body.messages[0]!.content[0]!.type).toBe('text');
    expect(body.messages[0]!.content[0]!.text).toContain(JSON.stringify(input, null, 2));
    expect(body.system).toMatch(/NÃO avalia, recomenda nem decide/);
    expect(body.system).toMatch(/\{\{F1\.documento\}\}/);
  });
});
