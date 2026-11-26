import { type Permission, type Role, effectivePermissions } from '@creditflow/shared';
import { render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { AppProviders } from '@/app/providers';
import { routes } from '@/app/routes';
import type { CurrentUser } from '@/features/auth/auth-api';
import { ME_QUERY_KEY, createQueryClient } from '@/lib/query-client';

export function makeUser(role: Role, overrides: Partial<CurrentUser> = {}): CurrentUser {
  const canDecide = overrides.canDecide ?? false;
  return {
    id: '00000000-0000-4000-8000-000000000001',
    email: `${role.toLowerCase()}@creditflow.test`,
    name: `Usuário ${role}`,
    role,
    canDecide,
    mustChangePassword: false,
    permissions: effectivePermissions({ role, canDecide }) as Permission[],
    ...overrides,
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
}

/**
 * Renders the real route table in a memory router. `user` pre-seeds the
 * session query (null = anonymous); `fetch` lets tests answer API calls.
 */
export function renderApp(
  path: string,
  {
    user,
    fetch,
  }: { user: CurrentUser | null; fetch?: (url: string, init?: RequestInit) => Response } = {
    user: null,
  },
) {
  const client = createQueryClient();
  client.setQueryData(ME_QUERY_KEY, user);
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    fetch
      ? fetch(url, init)
      : jsonResponse({ type: '/problems/not-found', title: 'x', status: 404 }, 404),
  );
  vi.stubGlobal('fetch', fetchMock);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <AppProviders client={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...utils, router, client, fetchMock };
}
