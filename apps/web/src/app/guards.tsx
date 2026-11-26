import type { Permission } from '@creditflow/shared';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { FullPageSpinner } from '@/components/ui/spinner';
import { useCurrentUser } from '@/features/auth/auth-api';
import { ErrorState } from './pages/ErrorState';
import { ForbiddenPage } from './pages/ForbiddenPage';

export const CHANGE_PASSWORD_PATH = '/trocar-senha';

/**
 * Requires a session. Sends anonymous users to the login page (remembering
 * where they were going) and users with a temporary password to the
 * change-password page. UX only: the API enforces the same rules.
 */
export function RequireAuth() {
  const { data: user, isPending, isError, error, refetch } = useCurrentUser();
  const location = useLocation();

  if (isPending) return <FullPageSpinner />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!user) {
    const redirect = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={redirect === '/' ? '/login' : `/login?redirect=${encodeURIComponent(redirect)}`}
        replace
      />
    );
  }
  if (user.mustChangePassword && location.pathname !== CHANGE_PASSWORD_PATH) {
    return <Navigate to={CHANGE_PASSWORD_PATH} replace />;
  }
  return <Outlet />;
}

/** Shows a 403 page when the user lacks the permission (the API also refuses). */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children?: ReactNode;
}) {
  const { data: user } = useCurrentUser();
  if (!user?.permissions.includes(permission)) return <ForbiddenPage />;
  return children ?? <Outlet />;
}
