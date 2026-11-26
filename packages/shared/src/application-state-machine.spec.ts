import { describe, expect, it } from 'vitest';
import { APPLICATION_STATUSES, Role } from './enums.js';
import type { ApplicationStatus } from './enums.js';
import {
  ApplicationAction,
  TERMINAL_STATUSES,
  availableActions,
  canTransition,
  hasTransitionPermission,
  isEditable,
  nextStatus,
} from './application-state-machine.js';
import { effectivePermissions } from './permissions.js';

const ACTIONS = Object.values(ApplicationAction);

/**
 * Expected transition table, written out by hand from the approved plan
 * (section 3.3). Every (status, action) pair not listed must be rejected.
 */
const EXPECTED: Partial<
  Record<ApplicationStatus, Partial<Record<ApplicationAction, ApplicationStatus>>>
> = {
  DRAFT: { submit: 'SUBMITTED', cancel: 'CANCELLED' },
  SUBMITTED: { 'start-review': 'UNDER_REVIEW', assign: 'UNDER_REVIEW', cancel: 'CANCELLED' },
  UNDER_REVIEW: {
    assign: 'UNDER_REVIEW',
    release: 'SUBMITTED',
    'request-information': 'PENDING_INFORMATION',
    cancel: 'CANCELLED',
    approve: 'APPROVED',
    reject: 'REJECTED',
  },
  PENDING_INFORMATION: {
    assign: 'PENDING_INFORMATION',
    resume: 'UNDER_REVIEW',
    cancel: 'CANCELLED',
  },
  CANCELLED: { reopen: 'SUBMITTED' },
  APPROVED: {},
  REJECTED: {},
};

describe('application state machine', () => {
  it.each(APPLICATION_STATUSES.flatMap((s) => ACTIONS.map((a) => [s, a] as const)))(
    '%s --%s--> matches the approved table',
    (status, action) => {
      const expected = EXPECTED[status]?.[action] ?? null;
      expect(nextStatus(status, action)).toBe(expected);
      expect(canTransition(status, action)).toBe(expected !== null);
    },
  );

  it('has no way out of terminal statuses', () => {
    for (const status of TERMINAL_STATUSES) {
      expect(ACTIONS.filter((a) => canTransition(status, a))).toEqual([]);
    }
  });

  it('only lets DRAFT and PENDING_INFORMATION be edited', () => {
    expect(APPLICATION_STATUSES.filter(isEditable)).toEqual(['DRAFT', 'PENDING_INFORMATION']);
  });

  describe('permissions per role', () => {
    const perms = (role: Role, canDecide = false) => effectivePermissions({ role, canDecide });

    it('operators submit, resume and cancel, but never review, reopen or decide', () => {
      expect(availableActions('DRAFT', perms(Role.OPERATOR))).toEqual(['submit', 'cancel']);
      expect(availableActions('PENDING_INFORMATION', perms(Role.OPERATOR))).toEqual([
        'resume',
        'cancel',
      ]);
      expect(availableActions('UNDER_REVIEW', perms(Role.OPERATOR))).toEqual([]);
      expect(availableActions('CANCELLED', perms(Role.OPERATOR))).toEqual([]);
    });

    it('operators with the canDecide grant may also decide', () => {
      expect(availableActions('UNDER_REVIEW', perms(Role.OPERATOR, true))).toEqual([
        'approve',
        'reject',
      ]);
    });

    it('analysts review and decide, but never submit, cancel or reopen', () => {
      expect(availableActions('SUBMITTED', perms(Role.ANALYST))).toEqual(['start-review']);
      expect(availableActions('UNDER_REVIEW', perms(Role.ANALYST))).toEqual([
        'release',
        'request-information',
        'approve',
        'reject',
      ]);
      expect(availableActions('CANCELLED', perms(Role.ANALYST))).toEqual([]);
    });

    it('admins assign, cancel under review and reopen, but never decide', () => {
      expect(availableActions('UNDER_REVIEW', perms(Role.ADMIN))).toEqual([
        'assign',
        'release',
        'cancel',
      ]);
      expect(availableActions('CANCELLED', perms(Role.ADMIN))).toEqual(['reopen']);
    });

    it('reserves cancelling an application under review to admins', () => {
      expect(hasTransitionPermission('cancel', perms(Role.OPERATOR), 'SUBMITTED')).toBe(true);
      expect(hasTransitionPermission('cancel', perms(Role.OPERATOR), 'UNDER_REVIEW')).toBe(false);
      expect(hasTransitionPermission('cancel', perms(Role.ADMIN), 'UNDER_REVIEW')).toBe(true);
    });
  });
});
