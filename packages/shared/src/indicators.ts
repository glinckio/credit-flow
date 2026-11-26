/**
 * Descriptive indicators shown on the analysis screen (plan, section 3.4).
 *
 * They only re-express the data the customer DECLARED. They are not a credit
 * score, carry no thresholds or "good/bad" bands, and never decide anything.
 */

export const INDICATORS_DISCLAIMER =
  'Indicadores demonstrativos calculados apenas com os valores declarados. ' +
  'Não representam política de crédito, não consideram juros e não determinam aprovação ou reprovação.';

export interface IndicatorInput {
  /** Decimal strings, e.g. "15000.00". */
  requestedAmount: string;
  termMonths: number;
  declaredMonthlyIncome: string;
  declaredMonthlyCommitments: string | null;
}

export interface Indicator {
  key: string;
  label: string;
  formula: string;
  /** Decimal string; null when it cannot be computed (e.g. declared income is zero). */
  value: string | null;
  unit: 'BRL' | 'ratio' | 'months';
}

/** Parses a non-negative decimal string into integer cents (exact for NUMERIC(14,2)). */
function toCents(value: string): number {
  const [int = '0', frac = ''] = value.split('.');
  return Number(int) * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
}

const fixed = (n: number, digits: number) => n.toFixed(digits);

export function computeIndicators(input: IndicatorInput): Indicator[] {
  const amount = toCents(input.requestedAmount);
  const income = toCents(input.declaredMonthlyIncome);
  const commitments = input.declaredMonthlyCommitments
    ? toCents(input.declaredMonthlyCommitments)
    : 0;
  const installment = amount / input.termMonths; // cents, no interest
  const perIncome = (cents: number) => (income > 0 ? fixed(cents / income, 4) : null);

  return [
    {
      key: 'simpleInstallment',
      label: 'Parcela simples estimada (sem juros)',
      formula: 'valor solicitado ÷ prazo em meses',
      value: fixed(installment / 100, 2),
      unit: 'BRL',
    },
    {
      key: 'installmentToIncome',
      label: 'Parcela simples ÷ renda/faturamento declarado',
      formula: 'parcela simples ÷ renda (ou faturamento) mensal declarado',
      value: perIncome(installment),
      unit: 'ratio',
    },
    {
      key: 'totalCommitmentToIncome',
      label: 'Comprometimento total declarado',
      formula:
        '(compromissos mensais declarados + parcela simples) ÷ renda (ou faturamento) mensal declarado',
      value: perIncome(commitments + installment),
      unit: 'ratio',
    },
    {
      key: 'amountInMonthsOfIncome',
      label: 'Valor solicitado em meses de renda/faturamento',
      formula: 'valor solicitado ÷ renda (ou faturamento) mensal declarado',
      value: income > 0 ? fixed(amount / income, 2) : null,
      unit: 'months',
    },
  ];
}
