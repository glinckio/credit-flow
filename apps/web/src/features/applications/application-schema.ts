import { CreditProductType } from '@creditflow/shared';
import { z } from 'zod';
import { moneyToInput, parseMoneyInput } from '@/lib/format';
import type { Application, ApplicationPayload } from './applications-api';

const MAX_MONEY = 999_999_999_999.99;

/** BRL amount typed in pt-BR ("15.000,50"); validated by parsing, sent as "15000.50". */
const money = (opts: { required: boolean; positive: boolean }) =>
  z.string().superRefine((value, ctx) => {
    if (!value.trim()) {
      if (opts.required) ctx.addIssue({ code: 'custom', message: 'Informe o valor' });
      return;
    }
    const parsed = parseMoneyInput(value);
    if (parsed === null) {
      ctx.addIssue({ code: 'custom', message: 'Valor inválido (use, por exemplo, 15.000,00)' });
    } else if (opts.positive && Number(parsed) <= 0) {
      ctx.addIssue({ code: 'custom', message: 'Informe um valor maior que zero' });
    } else if (Number(parsed) > MAX_MONEY) {
      ctx.addIssue({ code: 'custom', message: 'Valor acima do limite permitido' });
    }
  });

export const applicationSchema = z.object({
  productType: z.enum(
    Object.values(CreditProductType) as [CreditProductType, ...CreditProductType[]],
    {
      message: 'Selecione o tipo de crédito',
    },
  ),
  requestedAmount: money({ required: true, positive: true }),
  termMonths: z
    .string()
    .regex(/^\d+$/, 'Informe o prazo em meses')
    .refine((v) => Number(v) >= 1 && Number(v) <= 360, 'Prazo entre 1 e 360 meses'),
  purpose: z.string().trim().min(3, 'Descreva a finalidade').max(500),
  declaredMonthlyIncome: money({ required: true, positive: false }),
  declaredMonthlyCommitments: money({ required: false, positive: false }),
});

export type ApplicationForm = z.infer<typeof applicationSchema>;

export const emptyApplicationForm: ApplicationForm = {
  productType: '' as CreditProductType,
  requestedAmount: '',
  termMonths: '',
  purpose: '',
  declaredMonthlyIncome: '',
  declaredMonthlyCommitments: '',
};

export function applicationToForm(a: Application): ApplicationForm {
  return {
    productType: a.productType,
    requestedAmount: moneyToInput(a.requestedAmount),
    termMonths: String(a.termMonths),
    purpose: a.purpose,
    declaredMonthlyIncome: moneyToInput(a.declaredMonthlyIncome),
    declaredMonthlyCommitments: moneyToInput(a.declaredMonthlyCommitments),
  };
}

export function toApplicationPayload(v: ApplicationForm): Omit<ApplicationPayload, 'customerId'> {
  return {
    productType: v.productType,
    requestedAmount: parseMoneyInput(v.requestedAmount)!,
    termMonths: Number(v.termMonths),
    purpose: v.purpose.trim(),
    declaredMonthlyIncome: parseMoneyInput(v.declaredMonthlyIncome)!,
    declaredMonthlyCommitments: v.declaredMonthlyCommitments.trim()
      ? parseMoneyInput(v.declaredMonthlyCommitments)
      : null,
  };
}
