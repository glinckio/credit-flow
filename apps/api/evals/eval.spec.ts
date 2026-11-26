import { DocumentExtractionStatus, EvidenceStatus } from '@creditflow/shared';
import { materialize } from './dataset/builder.js';
import { buildCases } from './dataset/cases.js';
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
          expect(pageTexts[t.page - 1], `${c.id}/${d.id}`).toContain(t.quote);
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

  it('marks fields of a scanned document as UNVERIFIABLE, never as facts', () => {
    const scan = runs.find((r) => r.caseId === 'income-scan-readable')!;
    expect(scan.assessment.hasTextLayer).toBe(false);
    for (const f of scan.assessment.fields.filter((x) => x.modelStatus === 'FOUND')) {
      expect(f.evidence?.status).toBe(EvidenceStatus.UNVERIFIABLE);
      expect(f.acceptedValue).toBeNull();
    }
  });
});
