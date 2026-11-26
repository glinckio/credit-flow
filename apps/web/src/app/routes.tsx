import { Permission } from '@creditflow/shared';
import type { RouteObject } from 'react-router';
import { FullPageSpinner } from '@/components/ui/spinner';
import { AppLayout } from './AppLayout';
import { CHANGE_PASSWORD_PATH, RequireAuth, RequirePermission } from './guards';
import { RouteErrorBoundary } from './pages/ErrorState';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * Feature screens are code-split: each module is downloaded the first time
 * its route is visited, keeping the initial bundle small.
 */
const lazy = {
  dashboard: () =>
    import('@/features/dashboard/DashboardPage').then((m) => ({ Component: m.DashboardPage })),
  users: () => import('@/features/admin-users/UsersPage').then((m) => ({ Component: m.UsersPage })),
  audit: () => import('@/features/audit/AuditPage').then((m) => ({ Component: m.AuditPage })),
  login: () => import('@/features/auth/LoginPage').then((m) => ({ Component: m.LoginPage })),
  changePassword: () =>
    import('@/features/auth/ChangePasswordPage').then((m) => ({ Component: m.ChangePasswordPage })),
  customers: () =>
    import('@/features/customers/CustomersListPage').then((m) => ({
      Component: m.CustomersListPage,
    })),
  customerForm: () =>
    import('@/features/customers/CustomerFormPage').then((m) => ({
      Component: m.CustomerFormPage,
    })),
  customerDetail: () =>
    import('@/features/customers/CustomerDetailPage').then((m) => ({
      Component: m.CustomerDetailPage,
    })),
  applications: () =>
    import('@/features/applications/ApplicationsListPage').then((m) => ({
      Component: m.ApplicationsListPage,
    })),
  applicationForm: () =>
    import('@/features/applications/ApplicationFormPage').then((m) => ({
      Component: m.ApplicationFormPage,
    })),
  applicationDetail: () =>
    import('@/features/applications/ApplicationDetailPage').then((m) => ({
      Component: m.ApplicationDetailPage,
    })),
};

/** Route table, shared by the browser router and tests (memory router). */
export const routes: RouteObject[] = [
  {
    path: '/login',
    lazy: lazy.login,
    errorElement: <RouteErrorBoundary />,
    // Shown while a lazy route module downloads on the very first navigation.
    hydrateFallbackElement: <FullPageSpinner />,
  },
  {
    element: <RequireAuth />,
    errorElement: <RouteErrorBoundary />,
    hydrateFallbackElement: <FullPageSpinner />,
    children: [
      {
        element: <AppLayout />,
        errorElement: <RouteErrorBoundary />,
        children: [
          { path: CHANGE_PASSWORD_PATH, lazy: lazy.changePassword },
          {
            path: '/',
            element: <RequirePermission permission={Permission.DASHBOARD_READ} />,
            children: [{ index: true, lazy: lazy.dashboard }],
          },
          {
            path: '/clientes',
            element: <RequirePermission permission={Permission.CUSTOMER_READ} />,
            children: [
              { index: true, lazy: lazy.customers },
              {
                path: 'novo',
                element: <RequirePermission permission={Permission.CUSTOMER_WRITE} />,
                children: [{ index: true, lazy: lazy.customerForm }],
              },
              { path: ':id', lazy: lazy.customerDetail },
              {
                path: ':id/editar',
                element: <RequirePermission permission={Permission.CUSTOMER_WRITE} />,
                children: [{ index: true, lazy: lazy.customerForm }],
              },
            ],
          },
          {
            path: '/solicitacoes',
            element: <RequirePermission permission={Permission.APPLICATION_READ} />,
            children: [
              { index: true, lazy: lazy.applications },
              {
                path: 'nova',
                element: <RequirePermission permission={Permission.APPLICATION_WRITE} />,
                children: [{ index: true, lazy: lazy.applicationForm }],
              },
              { path: ':id', lazy: lazy.applicationDetail },
              {
                path: ':id/editar',
                element: <RequirePermission permission={Permission.APPLICATION_WRITE} />,
                children: [{ index: true, lazy: lazy.applicationForm }],
              },
            ],
          },
          {
            path: '/admin/usuarios',
            element: <RequirePermission permission={Permission.USER_MANAGE} />,
            children: [{ index: true, lazy: lazy.users }],
          },
          {
            path: '/admin/auditoria',
            element: <RequirePermission permission={Permission.AUDIT_READ} />,
            children: [{ index: true, lazy: lazy.audit }],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
