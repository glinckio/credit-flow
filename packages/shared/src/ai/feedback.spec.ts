import { describe, expect, it } from 'vitest';
import { type Finding, FindingKind as K } from './comparison.js';
import { diffFindings, findingsDiffIsEmpty } from './feedback.js';

const finding = (
  id: string,
  kind: Finding['kind'],
  values: Finding['documentValues'] = [],
): Finding => {
  const [subject, documentId] = id.split(':') as [Finding['subject'], string];
  return {
    id,
    subject,
    documentId,
    kind,
    declaredValue: null,
    documentValues: values,
    evidence: [],
  };
};

describe('diffFindings', () => {
  it('reports added, removed and changed findings', () => {
    const older = [
      finding('holderName:a', K.CONSISTENT),
      finding('monthlyIncome:a', K.UNVERIFIABLE),
      finding('holderTaxId:old', K.CONSISTENT),
    ];
    const newer = [
      finding('holderName:a', K.CONSISTENT),
      finding('monthlyIncome:a', K.DIVERGENT),
      finding('holderTaxId:new', K.CONSISTENT),
    ];
    const d = diffFindings(older, newer);
    expect(d.added.map((f) => f.id)).toEqual(['holderTaxId:new']);
    expect(d.removed.map((f) => f.id)).toEqual(['holderTaxId:old']);
    expect(d.changed).toEqual([
      {
        findingId: 'monthlyIncome:a',
        subject: 'monthlyIncome',
        documentId: 'a',
        from: K.UNVERIFIABLE,
        to: K.DIVERGENT,
      },
    ]);
    expect(d.unchanged).toBe(1);
    expect(findingsDiffIsEmpty(d)).toBe(false);
  });

  it('notices a different value with the same kind, whatever the field order', () => {
    const v = (net: string) => [
      { field: 'grossMonthlyIncome' as const, value: '5000.00' },
      { field: 'netMonthlyIncome' as const, value: net },
    ];
    const older = [finding('monthlyIncome:a', K.DIVERGENT, v('3200.00'))];
    expect(
      diffFindings(older, [finding('monthlyIncome:a', K.DIVERGENT, v('3100.00'))]).valuesChanged,
    ).toEqual(['monthlyIncome:a']);
    const same = diffFindings(older, [
      finding('monthlyIncome:a', K.DIVERGENT, [...v('3200.00')].reverse()),
    ]);
    expect(findingsDiffIsEmpty(same)).toBe(true);
  });
});
