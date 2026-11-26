import { describe, expect, it } from 'vitest';
import { ROLES, Role } from './enums.js';
import {
  Permission,
  ROLE_PERMISSIONS,
  canReceiveDecideGrant,
  effectivePermissions,
  hasPermission,
} from './permissions.js';

const ALL = Object.values(Permission);

/** Expected matrix from the approved plan (section 5). ✔ = granted. */
const EXPECTED: Record<Permission, Record<Role, boolean>> = {
  'user.manage': { ADMIN: true, ANALYST: false, OPERATOR: false },
  'audit.read': { ADMIN: true, ANALYST: false, OPERATOR: false },
  'dashboard.read': { ADMIN: true, ANALYST: true, OPERATOR: true },
  'customer.read': { ADMIN: true, ANALYST: true, OPERATOR: true },
  'customer.write': { ADMIN: true, ANALYST: false, OPERATOR: true },
  'application.read': { ADMIN: true, ANALYST: true, OPERATOR: true },
  'application.write': { ADMIN: true, ANALYST: false, OPERATOR: true },
  'application.cancel': { ADMIN: true, ANALYST: false, OPERATOR: true },
  'application.review': { ADMIN: false, ANALYST: true, OPERATOR: false },
  'application.assign': { ADMIN: true, ANALYST: false, OPERATOR: false },
  'application.reopen': { ADMIN: true, ANALYST: false, OPERATOR: false },
  'application.decide': { ADMIN: false, ANALYST: true, OPERATOR: false },
  'document.read': { ADMIN: true, ANALYST: true, OPERATOR: true },
  'document.upload': { ADMIN: true, ANALYST: false, OPERATOR: true },
  'document.validate': { ADMIN: false, ANALYST: true, OPERATOR: false },
};

describe('permission matrix', () => {
  it.each(ROLES.flatMap((role) => ALL.map((permission) => [role, permission] as const)))(
    '%s → %s matches the approved plan (without canDecide grant)',
    (role, permission) => {
      expect(hasPermission({ role, canDecide: false }, permission)).toBe(
        EXPECTED[permission][role],
      );
    },
  );

  it('never lists APPLICATION_DECIDE in the static role table', () => {
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.APPLICATION_DECIDE);
    }
  });

  it('grants decide to an operator only with the explicit canDecide grant', () => {
    expect(
      hasPermission({ role: Role.OPERATOR, canDecide: true }, Permission.APPLICATION_DECIDE),
    ).toBe(true);
    expect(
      hasPermission({ role: Role.OPERATOR, canDecide: false }, Permission.APPLICATION_DECIDE),
    ).toBe(false);
  });

  it('ignores canDecide for admins (segregation of duties)', () => {
    expect(
      hasPermission({ role: Role.ADMIN, canDecide: true }, Permission.APPLICATION_DECIDE),
    ).toBe(false);
    expect(canReceiveDecideGrant(Role.ADMIN)).toBe(false);
    expect(canReceiveDecideGrant(Role.ANALYST)).toBe(false);
    expect(canReceiveDecideGrant(Role.OPERATOR)).toBe(true);
  });

  it('returns no duplicates', () => {
    for (const role of ROLES) {
      const perms = effectivePermissions({ role, canDecide: true });
      expect(new Set(perms).size).toBe(perms.length);
    }
  });
});
