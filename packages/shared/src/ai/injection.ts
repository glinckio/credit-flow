import { normalizeText } from './normalize.js';

/**
 * Deterministic detector of text that addresses an AI/system instead of being
 * document content (ADR-0011, decision 6). It complements the model's own
 * `embeddedInstructionsDetected` flag; either one raises an alert for the
 * analyst. A hit never blocks the analysis — the content is data, and the
 * evidence check still decides what becomes a fact.
 *
 * "Informe" is deliberately absent: "Informe de Rendimentos" is a legitimate document.
 * Patterns run on `normalizeText` output (lower case, no accents, single spaces).
 */
const PATTERNS: ReadonlyArray<{ id: string; re: RegExp }> = [
  {
    id: 'ignore-instructions',
    re: /\b(ignore|ignorar|desconsidere|desconsiderar|esqueca)\b.{0,40}\b(instrucoes|instrucao|regras|orientacoes|instructions|previous)\b/,
  },
  {
    id: 'system-address',
    re: /\b(instrucao|mensagem|nota|aviso) (ao|para o) (sistema|modelo|assistente|analisador)\b/,
  },
  {
    id: 'ai-address',
    re: /\b(para a|a|ao) (ia|inteligencia artificial|llm|chatgpt|claude|assistente virtual)\b/,
  },
  {
    id: 'prompt-terms',
    re: /\b(system prompt|prompt do sistema|jailbreak|modo desenvolvedor|developer mode)\b/,
  },
  { id: 'role-override', re: /\b(voce (e|agora e) (um|uma)|you are (now )?(a|an))\b/ },
  {
    id: 'decision-steering',
    re: /\b(aprove|aprovar|reprove|reprovar|aprovacao imediata)\b.{0,40}\b(credito|solicitacao|emprestimo|cliente)\b/,
  },
  {
    id: 'output-steering',
    re: /\b(registre|responda|retorne|considere)\b.{0,30}\b(renda|valor|divergencia|divergencias|status|campo)\b/,
  },
];

export interface InjectionScan {
  detected: boolean;
  /** Ids of the matched patterns (never the matched text: it may carry personal data). */
  patterns: string[];
}

export function scanForEmbeddedInstructions(texts: readonly string[]): InjectionScan {
  const text = normalizeText(texts.join(' \n '));
  const patterns = PATTERNS.filter((p) => p.re.test(text)).map((p) => p.id);
  return { detected: patterns.length > 0, patterns };
}
