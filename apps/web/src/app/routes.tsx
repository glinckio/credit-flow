import { Permission } from '@creditflow/shared';
import type { RouteObject } from 'react-router';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { AppLayout } from './AppLayout';
import { CHANGE_PASSWORD_PATH, RequireAuth, RequirePermission } from './guards';
import { RouteErrorBoundary } from './pages/ErrorState';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlaceholderPage } from './pages/PlaceholderPage';

/** Route table, shared by the browser router and tests (memory router). */
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage />, errorElement: <RouteErrorBoundary /> },
  {
    element: <RequireAuth />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: CHANGE_PASSWORD_PATH, element: <ChangePasswordPage /> },
          {
            path: '/',
            element: <RequirePermission permission={Permission.DASHBOARD_READ} />,
            children: [{ index: true, element: <PlaceholderPage title="Dashboard" stage={12} /> }],
          },
          {
            path: '/clientes/*',
            element: <RequirePermission permission={Permission.CUSTOMER_READ} />,
            children: [{ path: '*', element: <PlaceholderPage title="Clientes" stage={10} /> }],
          },
          {
            path: '/solicitacoes/*',
            element: <RequirePermission permission={Permission.APPLICATION_READ} />,
            children: [{ path: '*', element: <PlaceholderPage title="Solicitações" stage={10} /> }],
          },
          {
            path: '/admin/usuarios',
            element: <RequirePermission permission={Permission.USER_MANAGE} />,
            children: [{ index: true, element: <PlaceholderPage title="Usuários" stage={12} /> }],
          },
          {
            path: '/admin/auditoria',
            element: <RequirePermission permission={Permission.AUDIT_READ} />,
            children: [{ index: true, element: <PlaceholderPage title="Auditoria" stage={12} /> }],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
