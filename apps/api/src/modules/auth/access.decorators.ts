import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { Permission } from '@creditflow/shared';
import type { Request } from 'express';
import type { AuthUser } from './auth-user.js';

export const ACCESS_METADATA = 'creditflow:access';
export const PASSWORD_CHANGE_PENDING_OK = 'creditflow:password-change-pending-ok';

export type AccessRule =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'permissions'; permissions: Permission[] }
  | { kind: 'anyPermission'; permissions: Permission[] };

/**
 * Every route MUST declare exactly one of these. Routes without a declaration
 * are denied by the AccessGuard (default deny) and flagged by a test.
 */
export const Public = () => SetMetadata(ACCESS_METADATA, { kind: 'public' } satisfies AccessRule);

/** Any signed-in user, regardless of permissions. */
export const Authenticated = () =>
  SetMetadata(ACCESS_METADATA, { kind: 'authenticated' } satisfies AccessRule);

/** Signed-in user holding ALL the listed permissions. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(ACCESS_METADATA, { kind: 'permissions', permissions } satisfies AccessRule);

/** Signed-in user holding AT LEAST ONE of the listed permissions. */
export const RequireAnyPermission = (...permissions: Permission[]) =>
  SetMetadata(ACCESS_METADATA, { kind: 'anyPermission', permissions } satisfies AccessRule);

/** Route stays reachable while the user still has to replace a temporary password. */
export const AllowPasswordChangePending = () => SetMetadata(PASSWORD_CHANGE_PENDING_OK, true);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest<Request>().user;
  if (!user) throw new Error('CurrentUser used on a route without authentication');
  return user satisfies AuthUser;
});
