import { ApplicationStatus as S } from './enums.js';
import type { ApplicationStatus } from './enums.js';
import { Permission as P } from './permissions.js';
import type { Permission } from './permissions.js';

/**
 * Credit application state machine (plan, section 3.3). Single source of truth
 * for the backend (enforcement) and the web app (which buttons to show).
 *
 *   DRAFT ──submit──▶ SUBMITTED ──start-review / assign──▶ UNDER_REVIEW
 *                         ▲  ◀──────────── release ────────────┘  │  ▲
 *                         │                         request-info │  │ resume
 *                       reopen                                   ▼  │
 *                         │                            PENDING_INFORMATION
 *   CANCELLED ◀──cancel── DRAFT | SUBMITTED | UNDER_REVIEW | PENDING_INFORMATION
 *   UNDER_REVIEW ──approve / reject──▶ APPROVED | REJECTED   (terminal)
 */
export const ApplicationAction = {
  SUBMIT: 'submit',
  START_REVIEW: 'start-review',
  ASSIGN: 'assign',
  RELEASE: 'release',
  REQUEST_INFORMATION: 'request-information',
  RESUME: 'resume',
  CANCEL: 'cancel',
  REOPEN: 'reopen',
  APPROVE: 'approve',
  REJECT: 'reject',
} as const;
export type ApplicationAction = (typeof ApplicationAction)[keyof typeof ApplicationAction];

export interface TransitionRule {
  from: readonly ApplicationStatus[];
  /** Target status (may equal `from`, e.g. re-assignment during review). */
  to: (from: ApplicationStatus) => ApplicationStatus;
  /** The user needs ANY of these permissions. */
  anyOf: readonly Permission[];
  /** Mandatory free-text reason recorded in the status history. */
  requiresReason: boolean;
}

const A = ApplicationAction;

export const TRANSITIONS: Readonly<Record<ApplicationAction, TransitionRule>> = {
  [A.SUBMIT]: {
    from: [S.DRAFT],
    to: () => S.SUBMITTED,
    anyOf: [P.APPLICATION_WRITE],
    requiresReason: false,
  },
  [A.START_REVIEW]: {
    from: [S.SUBMITTED],
    to: () => S.UNDER_REVIEW,
    anyOf: [P.APPLICATION_REVIEW],
    requiresReason: false,
  },
  [A.ASSIGN]: {
    // Admin (re)assigns an analyst; a queued application moves to review.
    from: [S.SUBMITTED, S.UNDER_REVIEW, S.PENDING_INFORMATION],
    to: (from) => (from === S.SUBMITTED ? S.UNDER_REVIEW : from),
    anyOf: [P.APPLICATION_ASSIGN],
    requiresReason: false,
  },
  [A.RELEASE]: {
    // Back to the queue, without an assignee.
    from: [S.UNDER_REVIEW],
    to: () => S.SUBMITTED,
    anyOf: [P.APPLICATION_REVIEW, P.APPLICATION_ASSIGN],
    requiresReason: false,
  },
  [A.REQUEST_INFORMATION]: {
    from: [S.UNDER_REVIEW],
    to: () => S.PENDING_INFORMATION,
    anyOf: [P.APPLICATION_REVIEW],
    requiresReason: false,
  },
  [A.RESUME]: {
    from: [S.PENDING_INFORMATION],
    to: () => S.UNDER_REVIEW,
    anyOf: [P.APPLICATION_WRITE],
    requiresReason: false,
  },
  [A.CANCEL]: {
    from: [S.DRAFT, S.SUBMITTED, S.UNDER_REVIEW, S.PENDING_INFORMATION],
    to: () => S.CANCELLED,
    anyOf: [P.APPLICATION_CANCEL],
    requiresReason: true,
  },
  [A.REOPEN]: {
    // Only an explicit, audited administrative action brings a cancelled application back.
    from: [S.CANCELLED],
    to: () => S.SUBMITTED,
    anyOf: [P.APPLICATION_REOPEN],
    requiresReason: true,
  },
  [A.APPROVE]: {
    from: [S.UNDER_REVIEW],
    to: () => S.APPROVED,
    anyOf: [P.APPLICATION_DECIDE],
    requiresReason: true,
  },
  [A.REJECT]: {
    from: [S.UNDER_REVIEW],
    to: () => S.REJECTED,
    anyOf: [P.APPLICATION_DECIDE],
    requiresReason: true,
  },
};

/** Cancelling an application that is already under an analyst's review is reserved to admins. */
export const CANCEL_UNDER_REVIEW_PERMISSION: Permission = P.APPLICATION_ASSIGN;

export const TERMINAL_STATUSES: readonly ApplicationStatus[] = [S.APPROVED, S.REJECTED];

/** Statuses in which the operator may still edit the declared data and documents. */
export const EDITABLE_STATUSES: readonly ApplicationStatus[] = [S.DRAFT, S.PENDING_INFORMATION];

export function isEditable(status: ApplicationStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

export function canTransition(from: ApplicationStatus, action: ApplicationAction): boolean {
  return TRANSITIONS[action].from.includes(from);
}

/** Target status of `action` from `from`, or null when the transition is not allowed. */
export function nextStatus(
  from: ApplicationStatus,
  action: ApplicationAction,
): ApplicationStatus | null {
  return canTransition(from, action) ? TRANSITIONS[action].to(from) : null;
}

export function hasTransitionPermission(
  action: ApplicationAction,
  permissions: readonly Permission[],
  from?: ApplicationStatus,
): boolean {
  const rule = TRANSITIONS[action];
  if (!rule.anyOf.some((p) => permissions.includes(p))) return false;
  if (action === A.CANCEL && from === S.UNDER_REVIEW) {
    return permissions.includes(CANCEL_UNDER_REVIEW_PERMISSION);
  }
  return true;
}

/**
 * Actions the user may attempt on an application in `status`, by status and
 * permission only. Contextual rules (assignee, open issues, required
 * documents) are checked by the backend.
 */
export function availableActions(
  status: ApplicationStatus,
  permissions: readonly Permission[],
): ApplicationAction[] {
  return (Object.keys(TRANSITIONS) as ApplicationAction[]).filter(
    (action) =>
      canTransition(status, action) && hasTransitionPermission(action, permissions, status),
  );
}
