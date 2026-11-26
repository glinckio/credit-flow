import { DocumentType } from '../enums.js';

/**
 * Field catalogue for AI-assisted document extraction (Part B, ADR-0011).
 *
 * For each document type: which fields the model may extract, how the value is
 * normalised, and which labels must appear in the quoted evidence for the field
 * to be accepted (label check of `verifyEvidence`). Labels are compared after
 * `normalizeText` (lower case, no accents, single spaces).
 */

type ValueOf<T> = T[keyof T];

export const FieldValueType = {
  /** Free text (names, street, city). */
  TEXT: 'TEXT',
  /** CPF (11) or CNPJ (14) digits. */
  TAX_ID: 'TAX_ID',
  /** Brazilian currency amount, normalised to a decimal string with 2 places. */
  MONEY: 'MONEY',
  /** Calendar date, normalised to YYYY-MM-DD. */
  DATE: 'DATE',
  /** Reference month, normalised to YYYY-MM. */
  MONTH: 'MONTH',
  /** CEP, 8 digits. */
  ZIP: 'ZIP',
  /** Brazilian state code (UF), 2 upper-case letters. */
  UF: 'UF',
} as const;
export type FieldValueType = ValueOf<typeof FieldValueType>;

export const ExtractedFieldKey = {
  HOLDER_NAME: 'holderName',
  HOLDER_TAX_ID: 'holderTaxId',
  BIRTH_DATE: 'birthDate',
  ADDRESS_STREET: 'addressStreet',
  ADDRESS_NUMBER: 'addressNumber',
  ADDRESS_CITY: 'addressCity',
  ADDRESS_STATE: 'addressState',
  ADDRESS_ZIP_CODE: 'addressZipCode',
  ISSUE_DATE: 'issueDate',
  REFERENCE_MONTH: 'referenceMonth',
  GROSS_MONTHLY_INCOME: 'grossMonthlyIncome',
  NET_MONTHLY_INCOME: 'netMonthlyIncome',
  AVERAGE_MONTHLY_REVENUE: 'averageMonthlyRevenue',
  PERIOD_START: 'periodStart',
  PERIOD_END: 'periodEnd',
} as const;
export type ExtractedFieldKey = ValueOf<typeof ExtractedFieldKey>;

export interface FieldSpec {
  key: ExtractedFieldKey;
  valueType: FieldValueType;
  /** Human description given to the model (pt-BR). */
  description: string;
  /** At least one must appear in the normalised quote. */
  labels: readonly string[];
}

const K = ExtractedFieldKey;
const T = FieldValueType;

export const FIELD_SPECS: Readonly<Record<ExtractedFieldKey, FieldSpec>> = {
  [K.HOLDER_NAME]: {
    key: K.HOLDER_NAME,
    valueType: T.TEXT,
    description: 'Nome completo ou razão social do titular do documento',
    labels: ['nome', 'titular', 'razao social', 'cliente', 'funcionario', 'empregado'],
  },
  [K.HOLDER_TAX_ID]: {
    key: K.HOLDER_TAX_ID,
    valueType: T.TAX_ID,
    description: 'CPF ou CNPJ do titular',
    labels: ['cpf', 'cnpj'],
  },
  [K.BIRTH_DATE]: {
    key: K.BIRTH_DATE,
    valueType: T.DATE,
    description: 'Data de nascimento',
    labels: ['nascimento'],
  },
  [K.ADDRESS_STREET]: {
    key: K.ADDRESS_STREET,
    valueType: T.TEXT,
    description: 'Logradouro (rua, avenida etc.), sem o número',
    labels: ['endereco', 'logradouro'],
  },
  [K.ADDRESS_NUMBER]: {
    key: K.ADDRESS_NUMBER,
    valueType: T.TEXT,
    description: 'Número do endereço',
    labels: ['endereco', 'numero'],
  },
  [K.ADDRESS_CITY]: {
    key: K.ADDRESS_CITY,
    valueType: T.TEXT,
    description: 'Cidade',
    labels: ['cidade', 'municipio'],
  },
  [K.ADDRESS_STATE]: {
    key: K.ADDRESS_STATE,
    valueType: T.UF,
    description: 'Unidade federativa (UF), duas letras',
    labels: ['uf', 'estado', 'cidade'],
  },
  [K.ADDRESS_ZIP_CODE]: {
    key: K.ADDRESS_ZIP_CODE,
    valueType: T.ZIP,
    description: 'CEP',
    labels: ['cep'],
  },
  [K.ISSUE_DATE]: {
    key: K.ISSUE_DATE,
    valueType: T.DATE,
    description: 'Data de emissão do documento',
    labels: ['emissao', 'emitido'],
  },
  [K.REFERENCE_MONTH]: {
    key: K.REFERENCE_MONTH,
    valueType: T.MONTH,
    description: 'Mês de referência (competência)',
    labels: ['referencia', 'competencia'],
  },
  [K.GROSS_MONTHLY_INCOME]: {
    key: K.GROSS_MONTHLY_INCOME,
    valueType: T.MONEY,
    description: 'Renda mensal bruta (total de vencimentos)',
    labels: ['bruto', 'bruta', 'vencimentos', 'total de proventos'],
  },
  [K.NET_MONTHLY_INCOME]: {
    key: K.NET_MONTHLY_INCOME,
    valueType: T.MONEY,
    description: 'Renda mensal líquida (valor líquido a receber)',
    labels: ['liquido', 'liquida', 'a receber'],
  },
  [K.AVERAGE_MONTHLY_REVENUE]: {
    key: K.AVERAGE_MONTHLY_REVENUE,
    valueType: T.MONEY,
    description: 'Faturamento médio mensal (pessoa jurídica)',
    labels: ['faturamento'],
  },
  [K.PERIOD_START]: {
    key: K.PERIOD_START,
    valueType: T.DATE,
    description: 'Data inicial do período do extrato',
    labels: ['periodo'],
  },
  [K.PERIOD_END]: {
    key: K.PERIOD_END,
    valueType: T.DATE,
    description: 'Data final do período do extrato',
    labels: ['periodo'],
  },
};

/** Fields the model is asked to extract, per declared document type. */
export const FIELDS_BY_DOCUMENT_TYPE: Readonly<Record<DocumentType, readonly ExtractedFieldKey[]>> =
  {
    [DocumentType.IDENTIFICATION]: [K.HOLDER_NAME, K.HOLDER_TAX_ID, K.BIRTH_DATE],
    [DocumentType.PROOF_OF_ADDRESS]: [
      K.HOLDER_NAME,
      K.ADDRESS_STREET,
      K.ADDRESS_NUMBER,
      K.ADDRESS_CITY,
      K.ADDRESS_STATE,
      K.ADDRESS_ZIP_CODE,
      K.ISSUE_DATE,
    ],
    [DocumentType.PROOF_OF_INCOME]: [
      K.HOLDER_NAME,
      K.HOLDER_TAX_ID,
      K.REFERENCE_MONTH,
      K.GROSS_MONTHLY_INCOME,
      K.NET_MONTHLY_INCOME,
      K.AVERAGE_MONTHLY_REVENUE,
    ],
    [DocumentType.BANK_STATEMENT]: [K.HOLDER_NAME, K.HOLDER_TAX_ID, K.PERIOD_START, K.PERIOD_END],
    // Classification only: no structured fields for free-form documents.
    [DocumentType.OTHER]: [],
  };
