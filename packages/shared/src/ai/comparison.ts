import { CustomerType, DocumentType } from '../enums.js';
import { ExtractedFieldKey } from './document-fields.js';
import { EvidenceStatus } from './evidence.js';
import { DocumentExtractionStatus, FieldStatus } from './extraction.js';
import { normalizeStreet, normalizeText } from './normalize.js';

/**
 * Deterministic comparison of document facts with the declared data
 * (ADR-0011, decision 5). Tolerance zero: values are compared exactly after
 * formatting-only normalisation. A finding is a POINT OF ATTENTION for the
 * analyst, never a conclusion about the credit.
 *
 * Only accepted values (evidence VERIFIED, document not flagged) are ever
 * compared. Anything else yields MISSING / AMBIGUOUS / UNVERIFIABLE.
 */

type ValueOf<T> = T[keyof T];

export const COMPARISON_VERSION = 'comparison-v1';

export const FindingKind = {
  CONSISTENT: 'CONSISTENT',
  DIVERGENT: 'DIVERGENT',
  /** The document does not contain the information. */
  MISSING: 'MISSING',
  /** The document contradicts itself. */
  AMBIGUOUS: 'AMBIGUOUS',
  /** The information could not be verified by code (no text layer, rejected evidence, flagged document). */
  UNVERIFIABLE: 'UNVERIFIABLE',
} as const;
export type FindingKind = ValueOf<typeof FindingKind>;

export const FindingSubject = {
  HOLDER_NAME: 'holderName',
  HOLDER_TAX_ID: 'holderTaxId',
  BIRTH_DATE: 'birthDate',
  MONTHLY_INCOME: 'monthlyIncome',
  ADDRESS: 'address',
  DOCUMENT_TYPE: 'documentType',
} as const;
export type FindingSubject = ValueOf<typeof FindingSubject>;

/** Declared data of the application and its customer (canonical forms). */
export interface DeclaredData {
  customerType: CustomerType;
  name: string;
  /** Digits only. */
  taxId: string;
  /** YYYY-MM-DD. */
  birthOrFoundationDate: string;
  address: { street: string; number: string; city: string; state: string; zipCode: string };
  /** Decimal string with 2 places, e.g. "4100.00". */
  declaredMonthlyIncome: string;
}

/** One field of an assessed document, as stored/served (API `AiFieldDto`). */
export interface AssessedField {
  key: ExtractedFieldKey;
  modelStatus: FieldStatus;
  modelValue: string | null;
  page: number | null;
  quote: string | null;
  evidenceStatus: EvidenceStatus | null;
  evidenceReason: string | null;
  acceptedValue: string | null;
  rejectedBy: string | null;
}

export interface AssessedDocument {
  documentId: string;
  declaredType: DocumentType;
  status: DocumentExtractionStatus;
  detectedType: string | null;
  typeMatchesDeclared: boolean | null;
  hasTextLayer: boolean;
  injectionAlert: boolean;
  fields: AssessedField[];
}

export interface FindingEvidence {
  field: ExtractedFieldKey;
  page: number | null;
  quote: string | null;
  /** True only when the value was accepted as a fact. */
  verified: boolean;
}

export interface Finding {
  /** Stable within a report: `<subject>:<documentId>`. */
  id: string;
  subject: FindingSubject;
  documentId: string;
  kind: FindingKind;
  /** Canonical declared value (address: "street, number, city/UF, CEP"). */
  declaredValue: string | null;
  /** Canonical accepted values found in the document (never unverified values). */
  documentValues: Array<{ field: ExtractedFieldKey; value: string }>;
  evidence: FindingEvidence[];
}

// ───────────────────────────── field state ─────────────────────────────

type FieldState =
  { state: 'VALUE'; value: string } | { state: 'MISSING' | 'AMBIGUOUS' | 'UNVERIFIABLE' };

/** What a single field contributes, from the safest possible reading. */
export function fieldState(f: AssessedField | undefined, documentFlagged = false): FieldState {
  if (!f || f.modelStatus === FieldStatus.NOT_FOUND) return { state: 'MISSING' };
  if (f.modelStatus === FieldStatus.AMBIGUOUS) return { state: 'AMBIGUOUS' };
  if (f.modelStatus === FieldStatus.ILLEGIBLE) return { state: 'UNVERIFIABLE' };
  if (f.acceptedValue !== null) return { state: 'VALUE', value: f.acceptedValue };
  // The code found another value for the same field in the document — unless the
  // document carries text addressed to an AI: then the "other value" is likely
  // injected, and the honest answer is "cannot verify", not "contradictory".
  if (f.evidenceReason === 'conflicting-values' && !documentFlagged) return { state: 'AMBIGUOUS' };
  return { state: 'UNVERIFIABLE' };
}

/** Precedence when several components disagree (most important first). */
const PRECEDENCE: readonly FindingKind[] = [
  FindingKind.DIVERGENT,
  FindingKind.AMBIGUOUS,
  FindingKind.UNVERIFIABLE,
  FindingKind.MISSING,
  FindingKind.CONSISTENT,
];
const worst = (kinds: FindingKind[]): FindingKind =>
  PRECEDENCE.find((k) => kinds.includes(k)) ?? FindingKind.MISSING;

// ───────────────────────────── subjects ─────────────────────────────

const K = ExtractedFieldKey;

type Fields = Map<ExtractedFieldKey, AssessedField> & { flagged: boolean };

interface Component {
  key: ExtractedFieldKey;
  declared: string;
  same: (declared: string, found: string) => boolean;
}

const sameText = (a: string, b: string) => normalizeText(a) === normalizeText(b);
const sameExact = (a: string, b: string) => a === b;

/** All components must match (name, CPF, date, address). */
function allOf(components: Component[], fields: Fields) {
  const kinds = components.map((c): FindingKind => {
    const s = fieldState(fields.get(c.key), fields.flagged);
    if (s.state !== 'VALUE') return s.state;
    return c.same(c.declared, s.value) ? FindingKind.CONSISTENT : FindingKind.DIVERGENT;
  });
  return worst(kinds);
}

/**
 * Any alternative may match (income: gross OR net OR revenue). CONSISTENT as
 * soon as one accepted value equals the declared one; DIVERGENT only when every
 * alternative the document mentions was verified and none matches.
 */
function anyOf(declared: string, keys: ExtractedFieldKey[], fields: Fields) {
  const states = keys.map((k) => fieldState(fields.get(k), fields.flagged));
  if (states.some((s) => s.state === 'VALUE' && s.value === declared))
    return FindingKind.CONSISTENT;
  if (states.some((s) => s.state === 'AMBIGUOUS')) return FindingKind.AMBIGUOUS;
  if (states.some((s) => s.state === 'UNVERIFIABLE')) return FindingKind.UNVERIFIABLE;
  if (states.some((s) => s.state === 'VALUE')) return FindingKind.DIVERGENT;
  return FindingKind.MISSING;
}

const SUBJECTS_BY_TYPE: Readonly<Record<DocumentType, readonly FindingSubject[]>> = {
  [DocumentType.IDENTIFICATION]: ['holderName', 'holderTaxId', 'birthDate'],
  [DocumentType.PROOF_OF_ADDRESS]: ['holderName', 'address'],
  [DocumentType.PROOF_OF_INCOME]: ['holderName', 'holderTaxId', 'monthlyIncome'],
  [DocumentType.BANK_STATEMENT]: ['holderName', 'holderTaxId'],
  [DocumentType.OTHER]: [],
};

const SUBJECT_FIELDS: Readonly<
  Record<Exclude<FindingSubject, 'documentType'>, readonly ExtractedFieldKey[]>
> = {
  holderName: [K.HOLDER_NAME],
  holderTaxId: [K.HOLDER_TAX_ID],
  birthDate: [K.BIRTH_DATE],
  monthlyIncome: [K.GROSS_MONTHLY_INCOME, K.NET_MONTHLY_INCOME, K.AVERAGE_MONTHLY_REVENUE],
  address: [
    K.ADDRESS_STREET,
    K.ADDRESS_NUMBER,
    K.ADDRESS_CITY,
    K.ADDRESS_STATE,
    K.ADDRESS_ZIP_CODE,
  ],
};

function subjectKind(
  subject: Exclude<FindingSubject, 'documentType'>,
  d: DeclaredData,
  fields: Fields,
): FindingKind {
  switch (subject) {
    case 'holderName':
      return allOf([{ key: K.HOLDER_NAME, declared: d.name, same: sameText }], fields);
    case 'holderTaxId':
      return allOf([{ key: K.HOLDER_TAX_ID, declared: d.taxId, same: sameExact }], fields);
    case 'birthDate':
      return allOf(
        [{ key: K.BIRTH_DATE, declared: d.birthOrFoundationDate, same: sameExact }],
        fields,
      );
    case 'monthlyIncome':
      return anyOf(d.declaredMonthlyIncome, [...SUBJECT_FIELDS.monthlyIncome], fields);
    case 'address':
      return allOf(
        [
          {
            key: K.ADDRESS_STREET,
            declared: d.address.street,
            same: (a, b) => normalizeStreet(a) === normalizeStreet(b),
          },
          { key: K.ADDRESS_NUMBER, declared: d.address.number, same: sameText },
          { key: K.ADDRESS_CITY, declared: d.address.city, same: sameText },
          { key: K.ADDRESS_STATE, declared: d.address.state, same: sameExact },
          { key: K.ADDRESS_ZIP_CODE, declared: d.address.zipCode, same: sameExact },
        ],
        fields,
      );
  }
}

function declaredValue(subject: FindingSubject, d: DeclaredData): string | null {
  switch (subject) {
    case 'holderName':
      return d.name;
    case 'holderTaxId':
      return d.taxId;
    case 'birthDate':
      return d.birthOrFoundationDate;
    case 'monthlyIncome':
      return d.declaredMonthlyIncome;
    case 'address':
      return `${d.address.street}, ${d.address.number}, ${d.address.city}/${d.address.state}, CEP ${d.address.zipCode}`;
    case 'documentType':
      return null;
  }
}

/** Document outcomes that still let the code say something about the subjects. */
const NO_FACTS: readonly DocumentExtractionStatus[] = [DocumentExtractionStatus.UNREADABLE];

/**
 * Findings for every processed document. Documents whose provider call failed
 * yield no finding (the report lists them as not analysed).
 */
export function compareWithDeclared(
  declared: DeclaredData,
  documents: readonly AssessedDocument[],
): Finding[] {
  const findings: Finding[] = [];
  for (const doc of documents) {
    const typeKind =
      doc.status === DocumentExtractionStatus.UNSUPPORTED || doc.typeMatchesDeclared === false
        ? FindingKind.DIVERGENT
        : doc.typeMatchesDeclared === true
          ? FindingKind.CONSISTENT
          : null;
    if (typeKind) {
      findings.push({
        id: `documentType:${doc.documentId}`,
        subject: 'documentType',
        documentId: doc.documentId,
        kind: typeKind,
        declaredValue: doc.declaredType,
        documentValues: [],
        evidence: [],
      });
    }
    const readable = doc.status === DocumentExtractionStatus.OK;
    if (!readable && !NO_FACTS.includes(doc.status)) continue;

    const fields: Fields = Object.assign(new Map(doc.fields.map((f) => [f.key, f])), {
      flagged: doc.injectionAlert,
    });
    for (const subject of SUBJECTS_BY_TYPE[doc.declaredType]) {
      if (subject === 'documentType') continue;
      // Birth date is compared for individuals only (companies declare a foundation date).
      if (subject === 'birthDate' && declared.customerType !== CustomerType.INDIVIDUAL) continue;
      const keys = SUBJECT_FIELDS[subject];
      const kind = readable ? subjectKind(subject, declared, fields) : FindingKind.UNVERIFIABLE;
      findings.push({
        id: `${subject}:${doc.documentId}`,
        subject,
        documentId: doc.documentId,
        kind,
        declaredValue: declaredValue(subject, declared),
        documentValues: keys.flatMap((k) => {
          const v = fields.get(k)?.acceptedValue;
          return v ? [{ field: k, value: v }] : [];
        }),
        evidence: keys.flatMap((k) => {
          const f = fields.get(k);
          if (!f || (f.page === null && f.quote === null)) return [];
          return [{ field: k, page: f.page, quote: f.quote, verified: f.acceptedValue !== null }];
        }),
      });
    }
  }
  return findings;
}
