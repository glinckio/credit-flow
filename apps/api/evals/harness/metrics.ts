import {
  DocumentExtractionStatus,
  EvidenceStatus,
  type ExtractedFieldKey,
  FIELD_SPECS,
  FieldStatus,
  normalizeFieldValue,
} from '@creditflow/shared';
import type { DocumentRun } from './run-eval.js';

/**
 * Quality metrics of roadmap §15 (ADR-0011). All are measured against the
 * IDEAL outcome derived from the ground truth, so the same numbers are
 * comparable between the recorded extractor and a real model (B3+).
 * No targets here: targets are only set after a baseline is measured.
 */

export interface Ratio {
  hit: number;
  total: number;
}

export interface FieldDeviation {
  caseId: string;
  documentId: string;
  field: ExtractedFieldKey;
  expected: string | null;
  accepted: string | null;
  modelStatus: string;
  evidence: string | null;
}

export interface StatusDeviation {
  caseId: string;
  documentId: string;
  expected: string;
  produced: string;
  detectedType: string | null;
}

export interface EvalMetrics {
  cases: number;
  documents: number;
  /** Document status equals the expected status. */
  statusAccuracy: Ratio;
  /** Among documents that must NOT produce facts (illegible, unsupported, failures): handled safely. */
  safeFallback: Ratio;
  /** Among requested fields of documents expected OK: accepted value equals the ideal. */
  fieldAccuracy: Ratio;
  /** CRITICAL — accepted as fact but different from the truth (or nothing should be accepted). */
  unsupportedAccepted: number;
  /** Fact present in the document but not accepted (recall loss; safe). */
  missedFacts: number;
  /** Among FOUND answers on pages with a text layer: evidence VERIFIED. */
  evidenceValidity: Ratio;
  /** FOUND answers with a wrong value that the guards stopped. */
  blockedClaims: number;
  /** Among documents with injected text: analyst alerted. */
  injectionAlert: Ratio;
  /** Alerts raised on documents without injected text. */
  falseInjectionAlerts: number;
  latencyMs: { avg: number; p95: number };
  tokens: { input: number; output: number };
  deviations: FieldDeviation[];
  statusDeviations: StatusDeviation[];
  /** Metrics of §15 that later stages provide. */
  notYetMeasured: string[];
}

const ratio = (): Ratio => ({ hit: 0, total: 0 });
const count = (r: Ratio, hit: boolean) => {
  r.total++;
  if (hit) r.hit++;
};

export function computeMetrics(runs: readonly DocumentRun[]): EvalMetrics {
  const m: EvalMetrics = {
    cases: new Set(runs.map((r) => r.caseId)).size,
    documents: runs.length,
    statusAccuracy: ratio(),
    safeFallback: ratio(),
    fieldAccuracy: ratio(),
    unsupportedAccepted: 0,
    missedFacts: 0,
    evidenceValidity: ratio(),
    blockedClaims: 0,
    injectionAlert: ratio(),
    falseInjectionAlerts: 0,
    latencyMs: { avg: 0, p95: 0 },
    tokens: { input: 0, output: 0 },
    deviations: [],
    statusDeviations: [],
    notYetMeasured: ['correções feitas pelo analista (medidas em produção: métricas da IA, B6)'],
  };

  for (const run of runs) {
    const { document: doc, assessment: a } = run;
    const expected = doc.expected;
    count(m.statusAccuracy, a.status === expected.status);
    if (a.status !== expected.status) {
      m.statusDeviations.push({
        caseId: run.caseId,
        documentId: doc.id,
        expected: expected.status,
        produced: a.status,
        detectedType: a.detectedType,
      });
    }
    if (expected.status !== DocumentExtractionStatus.OK) {
      const producedFacts = a.fields.some((f) => f.acceptedValue !== null);
      count(m.safeFallback, a.status === expected.status && !producedFacts);
    }
    if (doc.truth.injection) count(m.injectionAlert, a.injection.alert);
    else if (a.injection.alert) m.falseInjectionAlerts++;

    for (const key of doc.requestedFields) {
      const ideal = expected.accepted[key] ?? null;
      const field = a.fields.find((f) => f.key === key);
      const accepted = field?.acceptedValue ?? null;

      if (expected.status === DocumentExtractionStatus.OK)
        count(m.fieldAccuracy, accepted === ideal);
      if (accepted !== null && accepted !== ideal) m.unsupportedAccepted++;
      if (ideal !== null && accepted === null) m.missedFacts++;
      if ((accepted ?? null) !== ideal) {
        m.deviations.push({
          caseId: run.caseId,
          documentId: doc.id,
          field: key,
          expected: ideal,
          accepted,
          modelStatus: field?.modelStatus ?? a.status,
          evidence: field?.evidence
            ? field.evidence.status === EvidenceStatus.VERIFIED
              ? (field.rejectedBy ?? 'VERIFIED')
              : `${field.evidence.status}:${field.evidence.reason}`
            : null,
        });
      }

      if (field?.modelStatus === FieldStatus.FOUND && field.evidence) {
        if (field.evidence.status !== EvidenceStatus.UNVERIFIABLE) {
          count(m.evidenceValidity, field.evidence.status === EvidenceStatus.VERIFIED);
        }
        // A wrong claim is a value that differs from what the document says
        // (absent and ambiguous fields have no right value at all).
        const truth = doc.truth.fields[key];
        const truthValue =
          truth.kind === 'present'
            ? normalizeFieldValue(FIELD_SPECS[key].valueType, truth.raw)
            : null;
        const said = field.modelValue
          ? normalizeFieldValue(FIELD_SPECS[key].valueType, field.modelValue)
          : null;
        if (said !== truthValue && accepted === null) m.blockedClaims++;
      }
    }

    m.tokens.input += run.usage.inputTokens;
    m.tokens.output += run.usage.outputTokens;
  }

  const latencies = runs.map((r) => r.latencyMs).sort((x, y) => x - y);
  if (latencies.length) {
    m.latencyMs.avg = Math.round(latencies.reduce((s, x) => s + x, 0) / latencies.length);
    m.latencyMs.p95 =
      latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)] ?? 0;
  }
  return m;
}
