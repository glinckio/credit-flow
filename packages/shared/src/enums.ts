/**
 * Domain enums shared by API and web.
 *
 * Declared as `const` objects + union types (not TS `enum`) so they are
 * erasable syntax and behave identically in Node and in the browser bundle.
 * Values must match the Prisma enums in apps/api/prisma/schema.prisma
 * (guarded by an integration test).
 */

export const APP_NAME = 'CreditFlow';

type ValueOf<T> = T[keyof T];

export const Role = {
  ADMIN: 'ADMIN',
  ANALYST: 'ANALYST',
  OPERATOR: 'OPERATOR',
} as const;
export type Role = ValueOf<typeof Role>;

export const CustomerType = {
  /** Pessoa física (CPF). */
  INDIVIDUAL: 'INDIVIDUAL',
  /** Pessoa jurídica (CNPJ). */
  COMPANY: 'COMPANY',
} as const;
export type CustomerType = ValueOf<typeof CustomerType>;

export const CustomerStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type CustomerStatus = ValueOf<typeof CustomerStatus>;

export const ApplicationStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  PENDING_INFORMATION: 'PENDING_INFORMATION',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type ApplicationStatus = ValueOf<typeof ApplicationStatus>;

export const CreditProductType = {
  PERSONAL_LOAN: 'PERSONAL_LOAN',
  PAYROLL_LOAN: 'PAYROLL_LOAN',
  VEHICLE_FINANCING: 'VEHICLE_FINANCING',
  WORKING_CAPITAL: 'WORKING_CAPITAL',
  EQUIPMENT_FINANCING: 'EQUIPMENT_FINANCING',
  OTHER: 'OTHER',
} as const;
export type CreditProductType = ValueOf<typeof CreditProductType>;

export const DocumentType = {
  IDENTIFICATION: 'IDENTIFICATION',
  PROOF_OF_ADDRESS: 'PROOF_OF_ADDRESS',
  PROOF_OF_INCOME: 'PROOF_OF_INCOME',
  BANK_STATEMENT: 'BANK_STATEMENT',
  OTHER: 'OTHER',
} as const;
export type DocumentType = ValueOf<typeof DocumentType>;

export const DocumentValidationStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
} as const;
export type DocumentValidationStatus = ValueOf<typeof DocumentValidationStatus>;

export const IssueStatus = {
  OPEN: 'OPEN',
  RESOLVED: 'RESOLVED',
} as const;
export type IssueStatus = ValueOf<typeof IssueStatus>;

export const ReviewRecommendation = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  REQUEST_INFORMATION: 'REQUEST_INFORMATION',
} as const;
export type ReviewRecommendation = ValueOf<typeof ReviewRecommendation>;

export const DecisionOutcome = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type DecisionOutcome = ValueOf<typeof DecisionOutcome>;

export const ROLES = Object.values(Role);
export const APPLICATION_STATUSES = Object.values(ApplicationStatus);

/** Documents that must be attached before an application can be submitted (plan, decision 6.3). */
export const REQUIRED_DOCUMENT_TYPES: readonly DocumentType[] = [
  DocumentType.IDENTIFICATION,
  DocumentType.PROOF_OF_INCOME,
];

/** All shared enums, keyed by the Prisma enum name they mirror. */
export const SHARED_ENUMS = {
  Role,
  CustomerType,
  CustomerStatus,
  ApplicationStatus,
  CreditProductType,
  DocumentType,
  DocumentValidationStatus,
  IssueStatus,
  ReviewRecommendation,
  DecisionOutcome,
} as const;
