import { DocumentType } from '../enums.js';
import { formatCnpj, formatCpf } from '../validators/cpf-cnpj.js';
import {
  type AssessedDocument,
  COMPARISON_VERSION,
  type Finding,
  type FindingEvidence,
  FindingKind,
  type FindingSubject,
} from './comparison.js';
import { ExtractedFieldKey } from './document-fields.js';
import { DocumentExtractionStatus } from './extraction.js';

/**
 * Template report (ADR-0011, option A): every sentence is produced by code
 * from verified findings. It is always available — the model narrative of
 * stage B4 is an addition on top of it, never a replacement.
 */

export const REPORT_TEMPLATE_VERSION = 'report-template-v1';

export const REPORT_DISCLAIMER =
  'Relatório de apoio gerado automaticamente a partir dos documentos. Não é parecer nem decisão de crédito: ' +
  'divergências são pontos de atenção para a conferência do analista.';

export const SUBJECT_LABELS: Readonly<Record<FindingSubject, string>> = {
  holderName: 'Nome do titular',
  holderTaxId: 'CPF/CNPJ',
  birthDate: 'Data de nascimento',
  monthlyIncome: 'Renda/faturamento mensal',
  address: 'Endereço',
  documentType: 'Tipo de documento',
};

export const FINDING_KIND_LABELS: Readonly<Record<FindingKind, string>> = {
  CONSISTENT: 'Confere',
  DIVERGENT: 'Divergente',
  MISSING: 'Ausente no documento',
  AMBIGUOUS: 'Documento contraditório',
  UNVERIFIABLE: 'Não verificável — conferir no documento',
};

export const DOCUMENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  [DocumentType.IDENTIFICATION]: 'documento de identificação',
  [DocumentType.PROOF_OF_ADDRESS]: 'comprovante de endereço',
  [DocumentType.PROOF_OF_INCOME]: 'comprovante de renda/faturamento',
  [DocumentType.BANK_STATEMENT]: 'extrato bancário',
  [DocumentType.OTHER]: 'outro documento',
  UNKNOWN: 'tipo não reconhecido',
};

export const EXTRACTION_STATUS_LABELS: Readonly<Record<DocumentExtractionStatus, string>> = {
  OK: 'Analisado',
  UNSUPPORTED: 'Tipo de documento não reconhecido',
  UNREADABLE: 'Documento ilegível',
  SCHEMA_INVALID: 'Não analisado: resposta inválida do modelo',
  REFUSED: 'Não analisado: o modelo recusou a solicitação',
  TIMEOUT: 'Não analisado: tempo esgotado',
  PROVIDER_ERROR: 'Não analisado: provedor indisponível',
  TOO_LARGE: 'Não analisado: documento com páginas demais para a análise automática',
  SKIPPED_BUDGET: 'Não analisado: limite de custo da análise atingido',
};

const FIELD_SHORT_LABELS: Readonly<Partial<Record<ExtractedFieldKey, string>>> = {
  grossMonthlyIncome: 'bruto',
  netMonthlyIncome: 'líquido',
  averageMonthlyRevenue: 'faturamento médio',
  addressStreet: 'logradouro',
  addressNumber: 'número',
  addressCity: 'cidade',
  addressState: 'UF',
  addressZipCode: 'CEP',
};

// ───────────────────────────── formatting ─────────────────────────────

/** "4100.00" → "R$ 4.100,00" (exact; no rounding). */
export function formatBrl(decimal: string): string {
  const [int = '0', frac = '00'] = decimal.split('.');
  return `R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${frac.padEnd(2, '0')}`;
}

function formatValue(
  field: ExtractedFieldKey | null,
  subject: FindingSubject,
  value: string,
): string {
  if (subject === 'monthlyIncome') return formatBrl(value);
  if (subject === 'holderTaxId') return value.length === 11 ? formatCpf(value) : formatCnpj(value);
  if (subject === 'birthDate' || field === ExtractedFieldKey.ISSUE_DATE) {
    const [y, m, d] = value.split('-');
    return `${d}/${m}/${y}`;
  }
  if (field === ExtractedFieldKey.ADDRESS_ZIP_CODE) return `${value.slice(0, 5)}-${value.slice(5)}`;
  return value;
}

// ───────────────────────────── report ─────────────────────────────

export interface ReportItem {
  findingId: string;
  subject: FindingSubject;
  documentId: string;
  documentLabel: string;
  kind: FindingKind;
  title: string;
  text: string;
  evidence: FindingEvidence[];
}

export interface ReportDocument {
  documentId: string;
  label: string;
  status: DocumentExtractionStatus;
  statusLabel: string;
  alerts: string[];
}

export interface TemplateReport {
  version: typeof REPORT_TEMPLATE_VERSION;
  comparisonVersion: typeof COMPARISON_VERSION;
  disclaimer: string;
  counts: Record<FindingKind, number>;
  /** Everything that is not CONSISTENT, most important first. */
  attention: ReportItem[];
  consistent: ReportItem[];
  documents: ReportDocument[];
  limitations: string[];
}

const KIND_ORDER: readonly FindingKind[] = [
  FindingKind.DIVERGENT,
  FindingKind.AMBIGUOUS,
  FindingKind.UNVERIFIABLE,
  FindingKind.MISSING,
  FindingKind.CONSISTENT,
];

function itemText(f: Finding, doc: AssessedDocument | undefined): string {
  if (f.subject === 'documentType') {
    const declared = DOCUMENT_TYPE_LABELS[f.declaredValue ?? ''] ?? f.declaredValue;
    if (f.kind === FindingKind.CONSISTENT)
      return `Enviado como ${declared}; o conteúdo corresponde.`;
    const detected = DOCUMENT_TYPE_LABELS[doc?.detectedType ?? 'UNKNOWN'] ?? 'tipo não reconhecido';
    return `Enviado como ${declared}; o conteúdo foi identificado como ${detected}.`;
  }
  const declared = f.declaredValue === null ? '—' : formatValue(null, f.subject, f.declaredValue);
  const found = f.documentValues
    .map((v) => {
      const label =
        f.documentValues.length > 1 || f.subject === 'monthlyIncome'
          ? FIELD_SHORT_LABELS[v.field]
          : null;
      const value = formatValue(v.field, f.subject, v.value);
      return label ? `${label} ${value}` : value;
    })
    .join('; ');
  switch (f.kind) {
    case FindingKind.CONSISTENT:
      return `Declarado: ${declared}. No documento: ${found}.`;
    case FindingKind.DIVERGENT:
      return `Declarado: ${declared}. No documento: ${found}. Os valores não são iguais.`;
    case FindingKind.MISSING:
      return 'O documento não traz esta informação.';
    case FindingKind.AMBIGUOUS:
      return 'O documento apresenta valores diferentes para esta informação; nenhum foi aceito como fato.';
    case FindingKind.UNVERIFIABLE:
      return doc && !doc.hasTextLayer
        ? 'Documento sem texto pesquisável (imagem ou digitalização): confira a informação no documento.'
        : doc?.injectionAlert
          ? 'Documento com texto suspeito: nenhum valor dele foi aceito; confira no documento.'
          : 'Não foi possível confirmar o valor no texto do documento: confira no documento.';
  }
}

/**
 * @param documentLabels display name per document id (e.g. the original file name).
 */
export function buildTemplateReport(
  findings: readonly Finding[],
  documents: readonly AssessedDocument[],
  documentLabels: Readonly<Record<string, string>>,
): TemplateReport {
  const byId = new Map(documents.map((d) => [d.documentId, d]));
  const label = (id: string) => {
    const d = byId.get(id);
    const type = d ? DOCUMENT_TYPE_LABELS[d.declaredType] : 'documento';
    return documentLabels[id] ? `${documentLabels[id]} (${type})` : (type ?? 'documento');
  };

  const items = [...findings]
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        a.subject.localeCompare(b.subject) ||
        a.documentId.localeCompare(b.documentId),
    )
    .map((f): ReportItem => ({
      findingId: f.id,
      subject: f.subject,
      documentId: f.documentId,
      documentLabel: label(f.documentId),
      kind: f.kind,
      title: `${SUBJECT_LABELS[f.subject]} — ${FINDING_KIND_LABELS[f.kind]}`,
      text: itemText(f, byId.get(f.documentId)),
      evidence: f.evidence,
    }));

  const counts = Object.fromEntries(KIND_ORDER.map((k) => [k, 0])) as Record<FindingKind, number>;
  for (const f of findings) counts[f.kind]++;

  const reportDocs = documents.map((d): ReportDocument => {
    const alerts: string[] = [];
    if (d.injectionAlert)
      alerts.push('Contém texto dirigido a sistemas automatizados; nenhum valor dele foi aceito.');
    if (d.status === DocumentExtractionStatus.OK && !d.hasTextLayer) {
      alerts.push('Sem texto pesquisável: valores não puderam ser conferidos por código.');
    }
    if (d.typeMatchesDeclared === false)
      alerts.push('O conteúdo não corresponde ao tipo informado no envio.');
    return {
      documentId: d.documentId,
      label: label(d.documentId),
      status: d.status,
      statusLabel: EXTRACTION_STATUS_LABELS[d.status],
      alerts,
    };
  });

  const limitations = [
    'Valores só são aceitos quando o trecho citado foi conferido no texto do documento; a comparação é exata, sem tolerância.',
  ];
  const notAnalysed = documents.filter(
    (d) =>
      d.status !== DocumentExtractionStatus.OK &&
      d.status !== DocumentExtractionStatus.UNSUPPORTED &&
      d.status !== DocumentExtractionStatus.UNREADABLE,
  ).length;
  if (notAnalysed)
    limitations.push(
      `${notAnalysed} documento(s) não puderam ser analisados; confira-os manualmente.`,
    );
  const noText = documents.filter(
    (d) => d.status === DocumentExtractionStatus.OK && !d.hasTextLayer,
  ).length;
  if (noText)
    limitations.push(
      `${noText} documento(s) sem texto pesquisável: nenhuma informação deles foi verificada por código.`,
    );

  return {
    version: REPORT_TEMPLATE_VERSION,
    comparisonVersion: COMPARISON_VERSION,
    disclaimer: REPORT_DISCLAIMER,
    counts,
    attention: items.filter((i) => i.kind !== FindingKind.CONSISTENT),
    consistent: items.filter((i) => i.kind === FindingKind.CONSISTENT),
    documents: reportDocs,
    limitations,
  };
}

/** Plain-text rendering (export, logs-free sharing, narrative fallback). */
export function renderReportText(r: TemplateReport): string {
  const lines = [r.disclaimer, ''];
  lines.push(r.attention.length ? 'Pontos de atenção:' : 'Nenhum ponto de atenção encontrado.');
  for (const i of r.attention) lines.push(`- ${i.title} [${i.documentLabel}]: ${i.text}`);
  if (r.consistent.length) {
    lines.push('', 'Conferências sem divergência:');
    for (const i of r.consistent) lines.push(`- ${i.title} [${i.documentLabel}]: ${i.text}`);
  }
  lines.push('', 'Documentos:');
  for (const d of r.documents) {
    lines.push(
      `- ${d.label}: ${d.statusLabel}${d.alerts.length ? ` — ${d.alerts.join(' ')}` : ''}`,
    );
  }
  lines.push('', 'Limitações:', ...r.limitations.map((l) => `- ${l}`));
  return `${lines.join('\n')}\n`;
}
