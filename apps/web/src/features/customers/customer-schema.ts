import {
  BRAZILIAN_STATES,
  CustomerType,
  MIN_CUSTOMER_AGE,
  checkBirthOrFoundationDate,
  isValidDocumentForType,
  isValidPhone,
  isValidZipCode,
  onlyDigits,
} from '@creditflow/shared';
import { z } from 'zod';
import type { Customer, CustomerPayload } from './customers-api';

const DATE_MESSAGES = {
  invalid: 'Data inválida',
  future: 'A data não pode estar no futuro',
  underage: `Pessoa física deve ter ao menos ${MIN_CUSTOMER_AGE} anos`,
} as const;

/**
 * Client-side mirror of the API rules, using the same @creditflow/shared
 * validators. The API re-validates everything.
 */
export const customerSchema = z
  .object({
    type: z.enum([CustomerType.INDIVIDUAL, CustomerType.COMPANY]),
    name: z.string().trim().min(3, 'Informe o nome completo ou a razão social').max(200),
    documentNumber: z.string(),
    email: z.string().trim().min(1, 'Informe o e-mail').email('Informe um e-mail válido'),
    phone: z
      .string()
      .trim()
      .refine(isValidPhone, 'Telefone deve ter DDD e número (10 a 13 dígitos)'),
    birthOrFoundationDate: z.string().min(1, 'Informe a data'),
    address: z.object({
      street: z.string().trim().min(2, 'Informe o logradouro').max(200),
      number: z.string().trim().min(1, 'Informe o número').max(20),
      complement: z.string().trim().max(100),
      district: z.string().trim().min(2, 'Informe o bairro').max(100),
      city: z.string().trim().min(2, 'Informe a cidade').max(100),
      state: z.enum(BRAZILIAN_STATES, { message: 'Selecione a UF' }),
      zipCode: z.string().refine(isValidZipCode, 'CEP deve ter 8 dígitos'),
    }),
  })
  // Cross-field rules depend only on `type` + one field. `when` makes them run
  // as soon as those fields are present, even if other fields are still empty,
  // so the user sees "CPF inválido" right away instead of after fixing the rest.
  .superRefine(
    (v, ctx) => {
      if (!isValidDocumentForType(v.type, v.documentNumber)) {
        ctx.addIssue({
          code: 'custom',
          path: ['documentNumber'],
          message: v.type === CustomerType.INDIVIDUAL ? 'CPF inválido' : 'CNPJ inválido',
        });
      }
    },
    { when: (p) => hasStrings(p.value, ['type', 'documentNumber']) },
  )
  .superRefine(
    (v, ctx) => {
      const dateError = checkBirthOrFoundationDate(v.type, v.birthOrFoundationDate);
      if (dateError) {
        ctx.addIssue({
          code: 'custom',
          path: ['birthOrFoundationDate'],
          message: DATE_MESSAGES[dateError],
        });
      }
    },
    { when: (p) => hasStrings(p.value, ['type', 'birthOrFoundationDate']) },
  );

function hasStrings(value: unknown, keys: string[]): boolean {
  const v = value as Record<string, unknown> | null;
  return !!v && keys.every((k) => typeof v[k] === 'string' && (v[k] as string).length > 0);
}

export type CustomerForm = z.infer<typeof customerSchema>;

export const emptyCustomerForm: CustomerForm = {
  type: CustomerType.INDIVIDUAL,
  name: '',
  documentNumber: '',
  email: '',
  phone: '',
  birthOrFoundationDate: '',
  address: {
    street: '',
    number: '',
    complement: '',
    district: '',
    city: '',
    state: '' as never,
    zipCode: '',
  },
};

export function customerToForm(c: Customer): CustomerForm {
  return {
    type: c.type,
    name: c.name,
    documentNumber: c.documentNumber,
    email: c.email,
    phone: c.phone,
    birthOrFoundationDate: c.birthOrFoundationDate,
    address: {
      ...c.address,
      complement: c.address.complement ?? '',
      state: c.address.state as CustomerForm['address']['state'],
    },
  };
}

/** Form values → API payload (digits only for identifiers, no empty complement). */
export function toCustomerPayload(v: CustomerForm): CustomerPayload {
  const { complement, ...address } = v.address;
  return {
    type: v.type,
    name: v.name.trim(),
    documentNumber: onlyDigits(v.documentNumber),
    email: v.email.trim().toLowerCase(),
    phone: v.phone.trim(),
    birthOrFoundationDate: v.birthOrFoundationDate,
    address: {
      ...address,
      zipCode: onlyDigits(address.zipCode),
      ...(complement.trim() ? { complement: complement.trim() } : {}),
    },
  };
}
