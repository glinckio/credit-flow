import { DocumentExtractionStatus, EvidenceStatus } from '@creditflow/shared';
import { materialize } from './dataset/builder.js';
import { buildCases } from './dataset/cases.js';
import { caseFindings, computeFindingMetrics } from './harness/findings.js';
import { computeMetrics } from './harness/metrics.js';
import { recordingsFor, runEval } from './harness/run-eval.js';
import { RecordedExtractor } from '../src/modules/ai-analysis/extraction/recorded-extractor.js';

const cases = buildCases();

describe('evaluation dataset', () => {
  it('covers every scenario of roadmap §15', () => {
    const covered = new Set(cases.flatMap((c) => c.covers));
    for (const scenario of [
      '§15 documento legível e completo',
      '§15 documento incompleto',
      '§15 documento ilegível',
      '§15 campos contraditórios',
      '§15 documento de tipo não suportado',
      '§15 dados que não correspondem à solicitação',
      '§15 tentativa de prompt injection',
      '§15 resposta do modelo fora do schema',
      '§15 timeout ou indisponibilidade',
    ]) {
      expect(covered, scenario).toContain(scenario);
    }
  });

  it('has unique case ids and unique document bytes', () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(() => recordingsFor(cases)).not.toThrow();
  });

  it('marks exactly the cases that only script a provider failure (skipped with a real model)', () => {
    const scripted: readonly DocumentExtractionStatus[] = [
      DocumentExtractionStatus.SCHEMA_INVALID,
      DocumentExtractionStatus.TIMEOUT,
      DocumentExtractionStatus.PROVIDER_ERROR,
      DocumentExtractionStatus.REFUSED,
    ];
    for (const c of cases) {
      const failing = c.documents.some((d) => scripted.includes(d.expected.status));
      expect(c.simulatesProviderFailure === true, c.id).toBe(failing);
    }
  });

  it('is deterministic (same code → same bytes)', () => {
    const again = buildCases();
    cases.forEach((c, i) =>
      c.documents.forEach((d, j) =>
        expect(materialize(d).sha256).toBe(materialize(again[i]!.documents[j]!).sha256),
      ),
    );
  });

  it('prints every present truth quote verbatim on its page', () => {
    for (const c of cases) {
      for (const d of c.documents) {
        const { pageTexts } = materialize(d);
        for (const t of Object.values(d.truth.fields)) {
          if (t.kind !== 'present' || !t.textLayer) continue;
          expect(pageTexts?.[t.page - 1], `${c.id}/${d.id}`).toContain(t.quote);
        }
      }
    }
  });
});

describe('offline evaluation with recorded answers', async () => {
  const runs = await runEval(cases, new RecordedExtractor(recordingsFor(cases)));

  it.each(runs.map((r) => [`${r.caseId}/${r.document.id}`, r] as const))(
    '%s: exact expected outcome',
    (_id, run) => {
      const { assessment: a, document: d } = run;
      expect(a.status).toBe(d.expected.status);
      expect(a.injection.alert).toBe(d.expected.injectionAlert);
      const accepted = Object.fromEntries(a.fields.map((f) => [f.key, f.acceptedValue]));
      if (a.status === DocumentExtractionStatus.OK) {
        expect(accepted).toEqual(d.expected.acceptedWithRecording);
      } else {
        expect(a.fields).toEqual([]);
      }
    },
  );

  it('never accepts an unsupported claim', () => {
    expect(computeMetrics(runs).unsupportedAccepted).toBe(0);
  });

  it('deviates from the truth only where the recorded model makes a scripted mistake', () => {
    const m = computeMetrics(runs);
    expect(m.deviations.map((d) => `${d.caseId}:${d.field}`).sort()).toEqual([
      'misread-value:netMonthlyIncome',
      'statement-multipage-wrong-page:holderTaxId',
      'wrong-label:grossMonthlyIncome',
    ]);
    expect(m.safeFallback.hit).toBe(m.safeFallback.total);
    expect(m.injectionAlert.hit).toBe(m.injectionAlert.total);
    expect(m.falseInjectionAlerts).toBe(0);
  });

  it('reproduces every expected finding given the recorded answers', () => {
    const f = computeFindingMetrics(
      cases,
      runs,
      (c) => c.expectedFindingsWithRecording ?? c.expectedFindings,
    );
    expect(f.deviations).toEqual([]);
    expect(f.falseDivergences).toBe(0);
    expect(f.missedDivergences).toBe(0);
  });

  it('differs from the ideal findings only where a scripted mistake hides a fact', () => {
    const f = computeFindingMetrics(cases, runs);
    expect(f.falseDivergences).toBe(0);
    expect(f.deviations.map((d) => `${d.caseId}:${d.subject}:${d.produced}`).sort()).toEqual([
      'invented-value:birthDate:UNVERIFIABLE',
      'misread-value:monthlyIncome:UNVERIFIABLE',
      'statement-multipage-wrong-page:holderTaxId:UNVERIFIABLE',
    ]);
  });

  it('never bases a CONSISTENT or DIVERGENT finding on an unverified value', () => {
    for (const c of cases) {
      for (const finding of caseFindings(c, runs)) {
        if (finding.kind !== 'CONSISTENT' && finding.kind !== 'DIVERGENT') continue;
        if (finding.subject === 'documentType') continue;
        expect(finding.documentValues.length, `${c.id}/${finding.id}`).toBeGreaterThan(0);
        expect(finding.evidence.filter((e) => e.verified).length).toBeGreaterThan(0);
      }
    }
  });

  it('marks fields of a scanned document as UNVERIFIABLE, never as facts', () => {
    const scan = runs.find((r) => r.caseId === 'income-scan-readable')!;
    expect(scan.assessment.hasTextLayer).toBe(false);
    for (const f of scan.assessment.fields.filter((x) => x.modelStatus === 'FOUND')) {
      expect(f.evidence?.status).toBe(EvidenceStatus.UNVERIFIABLE);
      expect(f.acceptedValue).toBeNull();
    }
  });
});
