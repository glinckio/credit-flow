/**
 * Domain enums shared by API and web.
 *
 * Declared as `const` objects + union types (not TS `enum`) so they are
 * erasable syntax and behave identically in Node and in the browser bundle.
 */

export const APP_NAME = 'CreditFlow';

export const Role = {
  ADMIN: 'ADMIN',
  ANALYST: 'ANALYST',
  OPERATOR: 'OPERATOR',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const ApplicationStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  PENDING_INFORMATION: 'PENDING_INFORMATION',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type ApplicationStatus = (typeof ApplicationStatus)[keyof typeof ApplicationStatus];

export const ROLES = Object.values(Role);
export const APPLICATION_STATUSES = Object.values(ApplicationStatus);
