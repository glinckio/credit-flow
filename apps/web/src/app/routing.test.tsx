import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, makeUser, renderApp } from '@/test/render';

const navLabels = () =>
  within(screen.getByRole('navigation', { name: 'Navegação principal' }))
    .getAllByRole('link')
    .map((a) => a.textContent);

describe('route guards and navigation', () => {
  it('sends anonymous users to the login page, remembering the destination', async () => {
    const { router } = renderApp('/solicitacoes?status=SUBMITTED', { user: null });
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe(
      `?redirect=${encodeURIComponent('/solicitacoes?status=SUBMITTED')}`,
    );
  });

  it('forces users with a temporary password to the change-password page, without navigation', async () => {
    const { router } = renderApp('/clientes', {
      user: makeUser('ADMIN', { mustChangePassword: true }),
    });
    expect(await screen.findByRole('heading', { name: 'Trocar senha' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/trocar-senha');
    expect(
      within(screen.getByRole('navigation', { name: 'Navegação principal' })).queryAllByRole(
        'link',
      ),
    ).toHaveLength(0);
  });

  it.each([
    ['ADMIN', ['Dashboard', 'Clientes', 'Solicitações', 'Usuários', 'Auditoria']],
    ['ANALYST', ['Dashboard', 'Clientes', 'Solicitações']],
    ['OPERATOR', ['Dashboard', 'Clientes', 'Solicitações']],
  ] as const)('shows the %s menu according to permissions', async (role, expected) => {
    renderApp('/', { user: makeUser(role) });
    await screen.findByTestId('current-user-name');
    expect(navLabels()).toEqual(expected);
  });

  it('shows 403 when a user opens an area outside their permissions', async () => {
    renderApp('/admin/usuarios', { user: makeUser('OPERATOR') });
    expect(await screen.findByRole('heading', { name: 'Acesso negado' })).toBeInTheDocument();
  });

  it('shows 404 for unknown routes', async () => {
    renderApp('/nao-existe', { user: makeUser('ANALYST') });
    expect(
      await screen.findByRole('heading', { name: 'Página não encontrada' }),
    ).toBeInTheDocument();
  });

  it('logs out through the API and returns to the login page', async () => {
    const calls: string[] = [];
    const { router } = renderApp('/', {
      user: makeUser('OPERATOR'),
      fetch: (url, init) => {
        calls.push(`${init?.method} ${url}`);
        return jsonResponse(null, 204);
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Sair' }));
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
    expect(calls).toContain('POST /api/v1/auth/logout');
    expect(router.state.location.pathname).toBe('/login');
  });

  it('returns to the login page when the session expires (401 on /auth/me)', async () => {
    const { client, router } = renderApp('/', {
      user: makeUser('ANALYST'),
      fetch: () =>
        jsonResponse({ type: '/problems/unauthenticated', title: 'x', status: 401 }, 401),
    });
    await screen.findByTestId('current-user-name');
    await client.invalidateQueries();
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });
});
