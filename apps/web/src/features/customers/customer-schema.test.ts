import { cnpjCheckDigits, cpfCheckDigits } from '@creditflow/shared';
import { describe, expect, it } from 'vitest';
import { type CustomerForm, customerSchema, toCustomerPayload } from './customer-schema';

const valid: CustomerForm = {
  type: 'INDIVIDUAL',
  name: 'Maria Sintetica',
  documentNumber: '123.456.789-09',
  email: 'Maria@Exemplo.test',
  phone: '(11) 90000-0001',
  birthOrFoundationDate: '1990-05-17',
  address: {
    street: 'Rua Ficticia',
    number: '10',
    complement: '  ',
    district: 'Centro',
    city: 'Cidade Demo',
    state: 'SP',
    zipCode: '01000-000',
  },
};

const errorsOf = (v: unknown) => {
  const r = customerSchema.safeParse(v);
  return r.success
    ? {}
    : Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
};

describe('customerSchema', () => {
  it('accepts a valid synthetic individual', () => {
    expect(errorsOf(valid)).toEqual({});
  });

  it('mirrors the API rules with the shared validators', () => {
    expect(errorsOf({ ...valid, documentNumber: '123.456.789-00' })).toMatchObject({
      documentNumber: 'CPF inválido',
    });
    expect(errorsOf({ ...valid, documentNumber: cnpjCheckDigits('112223330001') })).toMatchObject({
      documentNumber: 'CPF inválido',
    });
    expect(
      errorsOf({ ...valid, type: 'COMPANY', documentNumber: cpfCheckDigits('987654321') }),
    ).toMatchObject({ documentNumber: 'CNPJ inválido' });
    expect(errorsOf({ ...valid, birthOrFoundationDate: '2020-01-01' })).toMatchObject({
      birthOrFoundationDate: 'Pessoa física deve ter ao menos 18 anos',
    });
    expect(errorsOf({ ...valid, address: { ...valid.address, zipCode: '0100' } })).toMatchObject({
      'address.zipCode': 'CEP deve ter 8 dígitos',
    });
    expect(errorsOf({ ...valid, address: { ...valid.address, state: 'XX' } })).toHaveProperty(
      'address.state',
    );
  });

  it('builds the API payload with digits only and no empty complement', () => {
    expect(toCustomerPayload(valid)).toEqual({
      type: 'INDIVIDUAL',
      name: 'Maria Sintetica',
      documentNumber: '12345678909',
      email: 'maria@exemplo.test',
      phone: '(11) 90000-0001',
      birthOrFoundationDate: '1990-05-17',
      address: {
        street: 'Rua Ficticia',
        number: '10',
        district: 'Centro',
        city: 'Cidade Demo',
        state: 'SP',
        zipCode: '01000000',
      },
    });
  });
});
