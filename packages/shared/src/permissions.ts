import { Role } from './enums.js';

/**
 * Permission catalogue. The backend checks these on every endpoint; the web
 * app only uses them to hide controls the user cannot use.
 */
export const Permission = {
  USER_MANAGE: 'user.manage',
  AUDIT_READ: 'audit.read',
  DASHBOARD_READ: 'dashboard.read',
  CUSTOMER_READ: 'customer.read',
  CUSTOMER_WRITE: 'customer.write',
  APPLICATION_READ: 'application.read',
  /** Create, edit, submit, resume (send back to review). */
  APPLICATION_WRITE: 'application.write',
  APPLICATION_CANCEL: 'application.cancel',
  /** Take a review, register issues and reviews (pareceres). */
  APPLICATION_REVIEW: 'application.review',
  APPLICATION_ASSIGN: 'application.assign',
  APPLICATION_REOPEN: 'application.reopen',
  /** Record the final human credit decision. */
  APPLICATION_DECIDE: 'application.decide',
  DOCUMENT_READ: 'document.read',
  DOCUMENT_UPLOAD: 'document.upload',
  DOCUMENT_VALIDATE: 'document.validate',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const P = Permission;

/**
 * Static role → permission matrix (plan, section 5).
 * APPLICATION_DECIDE is intentionally absent here: see `effectivePermissions`.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  [Role.ADMIN]: [
    P.USER_MANAGE,
    P.AUDIT_READ,
    P.DASHBOARD_READ,
    P.CUSTOMER_READ,
    P.CUSTOMER_WRITE,
    P.APPLICATION_READ,
    P.APPLICATION_WRITE,
    P.APPLICATION_CANCEL,
    P.APPLICATION_ASSIGN,
    P.APPLICATION_REOPEN,
    P.DOCUMENT_READ,
    P.DOCUMENT_UPLOAD,
  ],
  [Role.ANALYST]: [
    P.DASHBOARD_READ,
    P.CUSTOMER_READ,
    P.APPLICATION_READ,
    P.APPLICATION_REVIEW,
    P.DOCUMENT_READ,
    P.DOCUMENT_VALIDATE,
  ],
  [Role.OPERATOR]: [
    P.DASHBOARD_READ,
    P.CUSTOMER_READ,
    P.CUSTOMER_WRITE,
    P.APPLICATION_READ,
    P.APPLICATION_WRITE,
    P.APPLICATION_CANCEL,
    P.DOCUMENT_READ,
    P.DOCUMENT_UPLOAD,
  ],
};

/** Only operators can receive the explicit `canDecide` grant (plan, decision 6.1). */
export function canReceiveDecideGrant(role: Role): boolean {
  return role === Role.OPERATOR;
}

/**
 * Permissions a user actually holds.
 * - ANALYST: always may decide.
 * - OPERATOR: may decide only with the explicit `canDecide` grant.
 * - ADMIN: never decides (segregation: who manages users does not decide credit).
 */
export function effectivePermissions(user: { role: Role; canDecide: boolean }): Permission[] {
  const base = [...ROLE_PERMISSIONS[user.role]];
  const decides =
    user.role === Role.ANALYST || (canReceiveDecideGrant(user.role) && user.canDecide);
  if (decides) base.push(P.APPLICATION_DECIDE);
  return base;
}

export function hasPermission(
  user: { role: Role; canDecide: boolean },
  permission: Permission,
): boolean {
  return effectivePermissions(user).includes(permission);
}
