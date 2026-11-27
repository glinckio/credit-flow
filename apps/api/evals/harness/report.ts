import { EXTRACTION_SCHEMA_VERSION } from '@creditflow/shared';
import { DATASET_VERSION } from '../dataset/cases.js';
import type { FindingMetrics } from './findings.js';
import type { EvalMetrics, Ratio } from './metrics.js';

const pct = (r: Ratio) =>
  r.total === 0 ? 'n/a' : `${r.hit}/${r.total} (${((100 * r.hit) / r.total).toFixed(1)}%)`;

/** Human-readable summary (pt-BR) of an evaluation run. */
export function renderReport(m: EvalMetrics, f: FindingMetrics, model: string): string {
  const lines = [
    `# Avaliação — extração documental`,
    '',
    `- Dataset: ${DATASET_VERSION} · Schema: ${EXTRACTION_SCHEMA_VERSION} · Modelo: ${model}`,
    `- Casos: ${m.cases} · Documentos: ${m.documents}`,
    '',
    '| Métrica | Resultado |',
    '| --- | --- |',
    `| **Afirmações sem suporte aceitas** (deve ser 0) | **${m.unsupportedAccepted}** |`,
    `| Acerto por campo (vs. gabarito) | ${pct(m.fieldAccuracy)} |`,
    `| Fatos não aceitos (perda segura) | ${m.missedFacts} |`,
    `| Validade das evidências | ${pct(m.evidenceValidity)} |`,
    `| Afirmações erradas bloqueadas | ${m.blockedClaims} |`,
    `| Status do documento correto | ${pct(m.statusAccuracy)} |`,
    `| Fallback seguro | ${pct(m.safeFallback)} |`,
    `| Alerta de prompt injection | ${pct(m.injectionAlert)} |`,
    `| Alertas falsos de injection | ${m.falseInjectionAlerts} |`,
    `| Latência média / p95 (ms) | ${m.latencyMs.avg} / ${m.latencyMs.p95} |`,
    `| Tokens entrada / saída | ${m.tokens.input} / ${m.tokens.output} |`,
    `| Achados corretos (comparação × gabarito) | ${pct(f.findingAccuracy)} |`,
    `| Falsas divergências | ${f.falseDivergences} |`,
    `| Divergências não sinalizadas | ${f.missedDivergences} |`,
    '',
    `Ainda não medido: ${m.notYetMeasured.join('; ')}.`,
  ];
  if (m.statusDeviations.length) {
    lines.push(
      '',
      '## Status de documento diferente do gabarito',
      '',
      '| Caso/documento | Esperado | Produzido | Tipo detectado |',
      '| --- | --- | --- | --- |',
    );
    for (const d of m.statusDeviations) {
      lines.push(
        `| ${d.caseId}/${d.documentId} | ${d.expected} | ${d.produced} | ${d.detectedType ?? '—'} |`,
      );
    }
  }
  if (m.deviations.length) {
    lines.push(
      '',
      '## Desvios em relação ao gabarito',
      '',
      '| Caso/documento | Campo | Esperado | Aceito | Modelo | Evidência |',
      '| --- | --- | --- | --- | --- | --- |',
    );
    for (const d of m.deviations) {
      lines.push(
        `| ${d.caseId}/${d.documentId} | ${d.field} | ${d.expected ?? '—'} | ${d.accepted ?? '—'} | ${d.modelStatus} | ${d.evidence ?? '—'} |`,
      );
    }
  }
  if (f.deviations.length) {
    lines.push(
      '',
      '## Achados diferentes do gabarito',
      '',
      '| Caso/documento | Assunto | Esperado | Produzido |',
      '| --- | --- | --- | --- |',
    );
    for (const d of f.deviations) {
      lines.push(
        `| ${d.caseId}/${d.documentId} | ${d.subject} | ${d.expected} | ${d.produced ?? '—'} |`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}
