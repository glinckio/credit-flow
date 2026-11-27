import { type Finding, FindingKind } from './comparison.js';
import { DocumentExtractionStatus } from './extraction.js';
import {
  DOCUMENT_ALERTS,
  DOCUMENT_TYPE_LABELS,
  SUBJECT_LABELS,
  type TemplateReport,
  findingValueTexts,
} from './report.js';

/**
 * Model-written narrative over the template report (ADR-0011, D8 option B).
 *
 * Safety by construction:
 * - the model receives ONLY finding ids, subjects, kinds and generic document
 *   names ("Documento 2"): no document content, no file names (user-controlled
 *   text), no values — nothing to inject and nothing to copy wrong;
 * - values reach the text only through placeholders (`{{F1.documento}}`) that
 *   the backend replaces with the exact template formatting;
 * - code validates every sentence; ANY violation rejects the whole narrative
 *   and the analyst sees the template only (which is always shown anyway).
 */

type ValueOf<T> = T[keyof T];

export const NARRATIVE_SCHEMA_VERSION = 'narrative-v1';

export const NarrativeStatus = {
  OK: 'OK',
  /** The model answered but the text broke a rule: discarded. */
  REJECTED: 'REJECTED',
  /** Provider error, refusal, timeout or invalid response. */
  FAILED: 'FAILED',
  /** The per-run cost limit was reached before the call. */
  SKIPPED_BUDGET: 'SKIPPED_BUDGET',
  /** Nothing to narrate (no findings and no document notes). */
  NOT_NEEDED: 'NOT_NEEDED',
  /** No narrative writer configured. */
  DISABLED: 'DISABLED',
} as const;
export type NarrativeStatus = ValueOf<typeof NarrativeStatus>;

export const NARRATIVE_LIMITS = { maxSentences: 15, maxSentenceChars: 400, maxRefs: 10 } as const;

type Slot = 'declarado' | 'documento';

// ───────────────────────────── input ─────────────────────────────

export interface NarrativeFactInput {
  /** "F1", "F2"… */
  id: string;
  subject: string;
  kind: FindingKind;
  /** "Documento 2 (comprovante de renda/faturamento)". */
  document: string;
  /** Placeholders available for this fact, e.g. ["declarado", "documento"]. */
  placeholders: Slot[];
}

export interface NarrativeDocumentInput {
  /** "D1", "D2"… (same number as "Documento N"). */
  id: string;
  document: string;
  situation: string;
  alerts: string[];
}

/** Everything the narrative model receives. */
export interface NarrativeInput {
  facts: NarrativeFactInput[];
  /** Only documents that need the analyst's attention. */
  documents: NarrativeDocumentInput[];
}

/** Kept in the backend: what each id and placeholder stands for. Never sent to the model. */
export interface NarrativeBindings {
  values: Record<string, string>;
  findingIds: Record<string, string>;
  documentIds: Record<string, string>;
}

const SITUATION: Readonly<Record<DocumentExtractionStatus, string>> = {
  OK: 'analisado',
  UNSUPPORTED: 'tipo de documento não reconhecido',
  UNREADABLE: 'ilegível',
  SCHEMA_INVALID: 'não analisado (falha técnica)',
  REFUSED: 'não analisado (falha técnica)',
  TIMEOUT: 'não analisado (falha técnica)',
  PROVIDER_ERROR: 'não analisado (falha técnica)',
  TOO_LARGE: 'não analisado (páginas demais)',
  SKIPPED_BUDGET: 'não analisado (limite de custo)',
};

/** Builds the model input from a template report; ids follow the report order. */
export function buildNarrativeInput(
  report: TemplateReport,
  findings: readonly Finding[],
): { input: NarrativeInput; bindings: NarrativeBindings } {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const docNumber = new Map(report.documents.map((d, i) => [d.documentId, i + 1]));
  const docName = (documentId: string, declaredType?: string) => {
    const n = docNumber.get(documentId) ?? 0;
    const type = DOCUMENT_TYPE_LABELS[declaredType ?? ''];
    return type ? `Documento ${n} (${type})` : `Documento ${n}`;
  };
  const typeOf = new Map<string, string>(
    report.documents.map((d) => [d.documentId, d.declaredType]),
  );

  const bindings: NarrativeBindings = { values: {}, findingIds: {}, documentIds: {} };
  const facts = [...report.attention, ...report.consistent].map((item, i): NarrativeFactInput => {
    const id = `F${i + 1}`;
    bindings.findingIds[id] = item.findingId;
    const finding = byId.get(item.findingId);
    const texts = finding ? findingValueTexts(finding) : { declared: null, document: null };
    const placeholders: Slot[] = [];
    if (texts.declared !== null) {
      bindings.values[`${id}.declarado`] = `${texts.declared} (declarado)`;
      placeholders.push('declarado');
    }
    if (texts.document !== null) {
      bindings.values[`${id}.documento`] = `${texts.document} (no documento)`;
      placeholders.push('documento');
    }
    return {
      id,
      subject: SUBJECT_LABELS[item.subject],
      kind: item.kind,
      document: docName(item.documentId, typeOf.get(item.documentId)),
      placeholders,
    };
  });

  const documents = report.documents.flatMap((d, i): NarrativeDocumentInput[] => {
    if (d.status === DocumentExtractionStatus.OK && d.alerts.length === 0) return [];
    const id = `D${i + 1}`;
    bindings.documentIds[id] = d.documentId;
    return [
      {
        id,
        document: docName(d.documentId, typeOf.get(d.documentId)),
        situation: SITUATION[d.status],
        alerts: d.alerts.map(alertCode),
      },
    ];
  });
  return { input: { facts, documents }, bindings };
}

// The template alerts are fixed sentences; the model gets neutral codes for them.
const ALERT_CODES: Readonly<Record<string, string>> = {
  [DOCUMENT_ALERTS.INJECTION]: 'texto dirigido a sistemas automatizados',
  [DOCUMENT_ALERTS.NO_TEXT_LAYER]: 'sem texto pesquisável',
  [DOCUMENT_ALERTS.TYPE_MISMATCH]: 'conteúdo diferente do tipo informado',
};
const alertCode = (alert: string) => ALERT_CODES[alert] ?? 'alerta';

// ───────────────────────────── output contract ─────────────────────────────

export interface NarrativeModelSentence {
  text: string;
  refs: string[];
}

/** JSON Schema of the model answer (structured output). */
export function narrativeJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['sentences'],
    properties: {
      sentences: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'refs'],
          properties: {
            text: { type: 'string' },
            refs: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  };
}

// ───────────────────────────── validation ─────────────────────────────

export const NarrativeRejection = {
  SCHEMA: 'schema',
  TOO_LONG: 'too-long',
  NO_REFERENCE: 'sentence-without-reference',
  UNKNOWN_REFERENCE: 'unknown-reference',
  UNKNOWN_PLACEHOLDER: 'unknown-placeholder',
  PLACEHOLDER_NOT_CITED: 'placeholder-of-uncited-fact',
  NUMBER_OUTSIDE_PLACEHOLDER: 'number-outside-placeholder',
  DECISION_TERM: 'decision-or-judgement-term',
  CONTRADICTS_KIND: 'contradicts-finding-kind',
  OMITTED_ATTENTION_POINT: 'omitted-attention-point',
  INTERNAL_CODE: 'internal-code',
} as const;
export type NarrativeRejection = ValueOf<typeof NarrativeRejection>;

export interface NarrativeSentence {
  text: string;
  findingIds: string[];
  documentIds: string[];
}

export type NarrativeValidation =
  | { ok: true; sentences: NarrativeSentence[] }
  | { ok: false; reasons: Array<{ sentence: number | null; reason: NarrativeRejection }> };

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * Words that decide, recommend, judge the person or score the credit. Matched
 * on accent-folded lower-case text, at word start. Deliberately broad: a false
 * rejection only means the analyst reads the template.
 */
const FORBIDDEN =
  /\b(aprov\w*|reprov\w*|recus\w*|neg(a|ar|ado|ada|ados|adas|ou|ue|uem|ar-se)\b|rejeit\w*|indefer\w*|defer\w*|conced\w*|concess\w*|liber\w*|recomend\w*|aconselh\w*|sugir\w*|suger\w*|fraud\w*|falsifi\w*|falso|falsa|adulter\w*|golpe\w*|score\w*|pontua\w*|risco\w*|arriscad\w*|inadimpl\w*|pagador\w*|confiavel|confiaveis|idone\w*|elegiv\w*|apto|apta|inapt\w*|garanti\w*)/;

/** Positive statements: only allowed when a cited fact is CONSISTENT. */
const POSITIVE =
  /\b(confere|conferem|consistente|consistentes|coincide|coincidem|corresponde|correspondem|compativel|compativeis|iguais|igual|bate|batem|correto|correta|corretos|corretas|regular|regulares|confirmado|confirmada|confirmados|confirmadas|confirma|confirmam)\b/g;
/**
 * Attention words: an attention statement when affirmed; when negated ("não há
 * divergências", "sem pontos de atenção") they are a positive claim instead.
 */
const ATTENTION_WORDS =
  /\b(diverg\w*|difere\w*|diferente\w*|contradit\w*|contradiz\w*|conflit\w*|ambigu\w*|ausente\w*|ilegive\w*|suspeit\w*|atencao)\b/g;
/** Phrases that are attention statements by themselves (their own "não" is part of them). */
const ATTENTION_PHRASES =
  /\b(nao consta\w*|nao traz|nao verific\w*|nao foi possivel|nao pod\w* ser (verific|confirm|confer)\w*)\b/g;
/** Codes of the contract must not reach the analyst. */
const INTERNAL_CODE =
  /\b(CONSISTENT|DIVERGENT|MISSING|AMBIGUOUS|UNVERIFIABLE|UNSUPPORTED|UNREADABLE|PROOF_OF_\w+|BANK_STATEMENT|IDENTIFICATION)\b/;
/** Amounts written out in words ("quatro mil reais"). */
const NUMBER_WORDS = /\b(mil|milh\w*|bilh\w*|reais|real|centavo\w*|por cento)\b/;
const NEGATORS = new Set(['nao', 'nem', 'sem', 'nunca', 'nenhum', 'nenhuma', 'nada']);

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9]+)\.([A-Za-z]+)\s*\}\}/g;
const DOCUMENT_NAME = /\bdocumento\s+(\d+)\b/gi;

/** Whether a match is negated by one of the three preceding words. */
function negated(folded: string, index: number): boolean {
  return folded
    .slice(0, index)
    .split(/[^a-z]+/)
    .filter(Boolean)
    .slice(-3)
    .some((w) => NEGATORS.has(w));
}

/**
 * Negation of EXISTENCE earlier in the same clause (up to . ; : ! ?): "não há
 * pontos de atenção", "nenhum achado divergente", "sem divergências", "não
 * foram identificadas ausências". A plain "não" ("não foi analisado, portanto
 * não foi possível verificar") does not negate a later attention phrase.
 */
const EXISTENCE_NEGATION =
  /\b(nenhum|nenhuma|nada|sem|nao (ha|houve|existe|existem)|nao (foi|foram) (identificad|encontrad|registrad|apontad|observad|detectad)\w*)\b/;
function negatedClause(folded: string, index: number): boolean {
  const clause =
    folded
      .slice(0, index)
      .split(/[.;:!?]/)
      .at(-1) ?? '';
  return EXISTENCE_NEGATION.test(clause);
}

/** What a sentence claims, from its vocabulary (accent-folded, placeholders removed). */
function claims(folded: string): { positive: boolean; attention: boolean } {
  let positive = false;
  let attention = false;
  for (const m of folded.matchAll(POSITIVE)) if (!negated(folded, m.index)) positive = true;
  // Attention words and phrases: a negator anywhere earlier in the clause ("não
  // há pontos de atenção", "nenhum achado divergente, ausente ou não
  // verificável") turns them into a positive claim — the stricter reading,
  // which needs a CONSISTENT fact.
  for (const re of [ATTENTION_WORDS, ATTENTION_PHRASES]) {
    for (const m of folded.matchAll(re)) {
      if (negatedClause(folded, m.index)) positive = true;
      else attention = true;
    }
  }
  return { positive, attention };
}

/** Validates the model answer and renders it. Any violation rejects everything. */
export function validateNarrative(
  output: unknown,
  input: NarrativeInput,
  bindings: NarrativeBindings,
): NarrativeValidation {
  const reasons: Array<{ sentence: number | null; reason: NarrativeRejection }> = [];
  const reject = (reason: NarrativeRejection, sentence: number | null = null) =>
    reasons.push({ sentence, reason });

  const sentences = parseSentences(output);
  if (!sentences) return { ok: false, reasons: [{ sentence: null, reason: 'schema' }] };
  if (sentences.length === 0 || sentences.length > NARRATIVE_LIMITS.maxSentences)
    reject(NarrativeRejection.TOO_LONG);

  const facts = new Map(input.facts.map((f) => [f.id, f]));
  const docs = new Map(input.documents.map((d) => [d.id, d]));
  const documentNumbers = new Set(
    [...input.facts.map((f) => f.document), ...input.documents.map((d) => d.document)].map(
      (name) => /Documento (\d+)/.exec(name)?.[1],
    ),
  );
  const cited = new Set<string>();
  const rendered: NarrativeSentence[] = [];

  sentences.forEach((s, i) => {
    if (
      s.text.length > NARRATIVE_LIMITS.maxSentenceChars ||
      s.refs.length > NARRATIVE_LIMITS.maxRefs
    )
      reject(NarrativeRejection.TOO_LONG, i);
    if (s.refs.length === 0) reject(NarrativeRejection.NO_REFERENCE, i);
    const unknown = s.refs.filter((r) => !facts.has(r) && !docs.has(r));
    if (unknown.length) reject(NarrativeRejection.UNKNOWN_REFERENCE, i);
    s.refs.forEach((r) => cited.add(r));

    // Placeholders: known slot of a fact cited by this very sentence.
    let text = s.text;
    for (const m of s.text.matchAll(PLACEHOLDER)) {
      const [whole, id = '', slot = ''] = m;
      const value = bindings.values[`${id}.${slot}`];
      if (value === undefined) reject(NarrativeRejection.UNKNOWN_PLACEHOLDER, i);
      else if (!s.refs.includes(id)) reject(NarrativeRejection.PLACEHOLDER_NOT_CITED, i);
      else text = text.replace(whole, () => value);
    }
    const withoutPlaceholders = s.text.replace(PLACEHOLDER, ' ');
    if (/[{}]/.test(withoutPlaceholders)) reject(NarrativeRejection.UNKNOWN_PLACEHOLDER, i);

    // Numbers only through placeholders (or a known "Documento N").
    let invalidDocNumber = false;
    const withoutDocNames = withoutPlaceholders.replace(DOCUMENT_NAME, (_m, n: string) => {
      if (!documentNumbers.has(n)) invalidDocNumber = true;
      return ' ';
    });
    if (invalidDocNumber || /\d/.test(withoutDocNames) || NUMBER_WORDS.test(fold(withoutDocNames)))
      reject(NarrativeRejection.NUMBER_OUTSIDE_PLACEHOLDER, i);

    if (INTERNAL_CODE.test(withoutPlaceholders)) reject(NarrativeRejection.INTERNAL_CODE, i);
    const folded = fold(withoutPlaceholders);
    if (FORBIDDEN.test(folded)) reject(NarrativeRejection.DECISION_TERM, i);

    const kinds = s.refs.flatMap((r) => (facts.has(r) ? [facts.get(r)!.kind] : []));
    const citesDocNote = s.refs.some((r) => docs.has(r));
    const claim = claims(folded);
    if (claim.positive && !kinds.includes(FindingKind.CONSISTENT))
      reject(NarrativeRejection.CONTRADICTS_KIND, i);
    if (claim.attention && !citesDocNote && kinds.every((k) => k === FindingKind.CONSISTENT))
      reject(NarrativeRejection.CONTRADICTS_KIND, i);

    rendered.push({
      text: text.trim(),
      findingIds: s.refs.flatMap((r) => (bindings.findingIds[r] ? [bindings.findingIds[r]] : [])),
      documentIds: s.refs.flatMap((r) =>
        bindings.documentIds[r] ? [bindings.documentIds[r]] : [],
      ),
    });
  });

  // Every point of attention must be mentioned: silence is not allowed to hide one.
  for (const f of input.facts)
    if (f.kind !== FindingKind.CONSISTENT && !cited.has(f.id))
      reject(NarrativeRejection.OMITTED_ATTENTION_POINT);
  for (const d of input.documents)
    if (!cited.has(d.id)) reject(NarrativeRejection.OMITTED_ATTENTION_POINT);

  return reasons.length ? { ok: false, reasons } : { ok: true, sentences: rendered };
}

function parseSentences(output: unknown): NarrativeModelSentence[] | null {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) return null;
  const o = output as Record<string, unknown>;
  if (Object.keys(o).length !== 1 || !Array.isArray(o.sentences)) return null;
  const out: NarrativeModelSentence[] = [];
  for (const s of o.sentences) {
    if (typeof s !== 'object' || s === null || Array.isArray(s)) return null;
    const r = s as Record<string, unknown>;
    if (Object.keys(r).length !== 2 || typeof r.text !== 'string' || !Array.isArray(r.refs))
      return null;
    if (!r.refs.every((x): x is string => typeof x === 'string')) return null;
    out.push({ text: r.text, refs: r.refs });
  }
  return out;
}

// ───────────────────────────── stored result ─────────────────────────────

/** Stored with the report snapshot (and purged with it). */
export interface NarrativeReport {
  version: typeof NARRATIVE_SCHEMA_VERSION;
  status: NarrativeStatus;
  model: string | null;
  promptVersion: string | null;
  /** Rendered sentences; empty unless status is OK. */
  sentences: NarrativeSentence[];
  /** Why it was rejected (no text of the rejected narrative is kept). */
  rejections: Array<{ sentence: number | null; reason: NarrativeRejection }>;
}

/** Whether there is anything to narrate. */
export function narrativeNeeded(input: NarrativeInput): boolean {
  return input.facts.length > 0 || input.documents.length > 0;
}

/**
 * A deterministic writer used offline (tests, recorded evaluation): one
 * sentence per fact/document, always valid. Not a substitute for the template.
 */
export function deterministicNarrative(input: NarrativeInput): {
  sentences: NarrativeModelSentence[];
} {
  const PHRASE: Readonly<Record<FindingKind, (f: NarrativeFactInput) => string>> = {
    CONSISTENT: (f) =>
      f.placeholders.length === 2
        ? `${f.subject}: {{${f.id}.declarado}} e {{${f.id}.documento}}, no ${f.document}; confere.`
        : `${f.subject}: o ${f.document} confere com o declarado.`,
    DIVERGENT: (f) =>
      f.placeholders.length === 2
        ? `${f.subject}: {{${f.id}.declarado}}, mas o ${f.document} traz {{${f.id}.documento}}; ponto de atenção.`
        : `${f.subject}: o ${f.document} diverge do declarado; ponto de atenção.`,
    AMBIGUOUS: (f) => `${f.subject}: o ${f.document} é contraditório; conferir manualmente.`,
    UNVERIFIABLE: (f) =>
      `${f.subject}: não foi possível verificar no ${f.document}; conferir manualmente.`,
    MISSING: (f) => `${f.subject}: a informação está ausente no ${f.document}.`,
  };
  return {
    sentences: [
      ...input.facts.map((f) => ({ text: PHRASE[f.kind](f), refs: [f.id] })),
      ...input.documents.map((d) => ({
        text: `${d.document}: ${d.situation}${d.alerts.length ? `; atenção: ${d.alerts.join(', ')}` : ''}.`,
        refs: [d.id],
      })),
    ],
  };
}
