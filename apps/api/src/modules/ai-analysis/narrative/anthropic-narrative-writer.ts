import type Anthropic from '@anthropic-ai/sdk';
import { type NarrativeInput, NARRATIVE_LIMITS, narrativeJsonSchema } from '@creditflow/shared';
import type { ProviderErrorCode } from '../extraction/document-extractor.js';
import { structuredCall } from '../provider/anthropic-structured-call.js';
import type { NarrativeWriter, NarrativeWriterResult } from './narrative-writer.js';

/** Bump whenever SYSTEM_PROMPT or the instructions change. Recorded with every run. */
export const NARRATIVE_PROMPT_VERSION = 'narrative-v2';

const SYSTEM_PROMPT = [
  'Você redige, em português do Brasil, um resumo curto para um analista de crédito humano,',
  'a partir de achados JÁ VERIFICADOS por código. Você NÃO avalia, recomenda nem decide crédito.',
  '',
  'Regras obrigatórias (qualquer violação descarta o texto inteiro):',
  '1. Use somente os achados fornecidos. Não acrescente fatos, causas, intenções ou opiniões.',
  '2. Nunca escreva números, valores, datas ou documentos de identificação (o único número',
  '   permitido é o do nome do documento, ex.: "Documento 2"). Para citar um valor,',
  '   use exatamente o marcador indicado no achado, por exemplo {{F1.documento}} ou {{F1.declarado}}.',
  '   Valores por extenso (ex.: "mil reais") também são proibidos.',
  '3. Cada frase deve listar em "refs" os ids (F1, D2…) dos achados que a sustentam; todo',
  '   marcador usado na frase precisa ser de um achado listado nessa frase.',
  '4. Proibido: aprovar, reprovar, recusar, negar, conceder, liberar, recomendar, sugerir decisão,',
  '   falar em risco, score, fraude, falsificação, idoneidade ou capacidade de pagamento.',
  '5. Respeite o tipo de cada achado: CONSISTENT = confere; DIVERGENT = os valores não são iguais',
  '   (ponto de atenção, não conclusão); MISSING = ausente no documento; AMBIGUOUS = o documento',
  '   se contradiz; UNVERIFIABLE = não foi possível verificar, conferir manualmente.',
  '   Renda: CONSISTENT significa que o declarado é igual ao bruto OU ao líquido (não a ambos);',
  '   mostre os dois marcadores e não afirme que todos os valores do documento conferem.',
  '6. Mencione TODOS os achados que não são CONSISTENT e TODOS os documentos listados (ids D…),',
  '   começando pelos pontos de atenção. Achados CONSISTENT podem ser agrupados numa frase.',
  '   Cada marcador já vem com a origem do valor: {{F1.declarado}} vira "R$ 4.100,00 (declarado)" e',
  '   {{F1.documento}} vira "bruto R$ 5.000,00 (no documento)". Não repita essa origem no texto.',
  '7. Refira-se aos documentos só pelo nome dado (ex.: "Documento 2"). Não escreva no texto os ids',
  '   (F1, D2…) nem códigos como CONSISTENT ou DIVERGENT: eles só vão em "refs".',
  `8. No máximo ${NARRATIVE_LIMITS.maxSentences} frases, cada uma com até ${NARRATIVE_LIMITS.maxSentenceChars} caracteres.`,
].join('\n');

export interface AnthropicNarrativeWriterOptions {
  model: string;
  effort: 'low' | 'medium' | 'high';
  timeoutMs: number;
  maxTokens?: number;
  onError?: (info: { code: ProviderErrorCode; detail: string }) => void;
}

export class AnthropicNarrativeWriter implements NarrativeWriter {
  readonly model: string;
  readonly promptVersion = NARRATIVE_PROMPT_VERSION;

  constructor(
    private readonly client: Pick<Anthropic, 'messages'>,
    private readonly options: AnthropicNarrativeWriterOptions,
  ) {
    this.model = options.model;
  }

  write(input: NarrativeInput): Promise<NarrativeWriterResult> {
    return structuredCall(this.client, {
      model: this.model,
      effort: this.options.effort,
      timeoutMs: this.options.timeoutMs,
      maxTokens: this.options.maxTokens ?? 4000,
      system: SYSTEM_PROMPT,
      content: [
        {
          type: 'text',
          text: `Achados (JSON):\n${JSON.stringify(input, null, 2)}\n\nRedija o resumo seguindo as regras.`,
        },
      ],
      schema: narrativeJsonSchema(),
      onError: this.options.onError,
    });
  }
}
