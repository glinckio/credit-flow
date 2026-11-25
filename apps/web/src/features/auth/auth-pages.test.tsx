import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, makeUser, renderApp } from '@/test/render';
import { safeRedirect } from '@/lib/redirect';

describe('safeRedirect', () => {
  it('accepts only same-app relative paths (no open redirect)', () => {
    expect(safeRedirect('/clientes?x=1')).toBe('/clientes?x=1');
    expect(safeRedirect('//evil.example')).toBe('/');
    expect(safeRedirect('https://evil.example')).toBe('/');
    expect(safeRedirect('/\\evil.example')).toBe('/');
    expect(safeRedirect(null)).toBe('/');
  });
});

describe('LoginPage', () => {
  it('validates required fields before calling the API', async () => {
    const { fetchMock } = renderApp('/login', { user: null });
    await userEvent.click(await screen.findByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Informe o e-mail')).toBeInTheDocument();
    expect(screen.getByText('Informe a senha')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a generic message for invalid credentials and clears the password', async () => {
    renderApp('/login', {
      user: null,
      fetch: () =>
        jsonResponse(
          {
            type: '/problems/invalid-credentials',
            title: 'E-mail ou senha inválidos',
            status: 401,
          },
          401,
        ),
    });
    await userEvent.type(await screen.findByLabelText(/E-mail/), 'operador@creditflow.test');
    await userEvent.type(screen.getByLabelText(/Senha/), 'senha-errada');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('E-mail ou senha inválidos.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Senha/)).toHaveValue('');
  });

  it('signs in and goes to the remembered destination', async () => {
    const user = makeUser('OPERATOR');
    const { router, fetchMock } = renderApp('/login?redirect=%2Fclientes', {
      user: null,
      fetch: () => jsonResponse({ user }),
    });
    await userEvent.type(await screen.findByLabelText(/E-mail/), user.email);
    await userEvent.type(screen.getByLabelText(/Senha/), 'senha-de-teste-123');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('heading', { name: 'Clientes' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/clientes');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/login');
    expect(JSON.parse(String(init.body))).toEqual({
      email: user.email,
      password: 'senha-de-teste-123',
    });
  });
});

describe('ChangePasswordPage', () => {
  it('validates length, confirmation and difference before calling the API', async () => {
    const { fetchMock } = renderApp('/trocar-senha', {
      user: makeUser('ANALYST', { mustChangePassword: true }),
    });
    await userEvent.type(await screen.findByLabelText(/Senha atual/), 'senha-antiga-123');
    await userEvent.type(screen.getByLabelText(/^Nova senha/), 'curta');
    await userEvent.type(screen.getByLabelText(/Confirme/), 'outra');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }));
    expect(await screen.findByText(/ao menos 12 caracteres/)).toBeInTheDocument();
    expect(screen.getByText('A confirmação não confere')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a wrong current password to the field and unlocks the app on success', async () => {
    let attempt = 0;
    const { router } = renderApp('/trocar-senha', {
      user: makeUser('ANALYST', { mustChangePassword: true }),
      fetch: () =>
        ++attempt === 1
          ? jsonResponse(
              {
                type: '/problems/wrong-current-password',
                title: 'Senha atual incorreta',
                status: 422,
              },
              422,
            )
          : jsonResponse({ user: makeUser('ANALYST') }),
    });
    await userEvent.type(await screen.findByLabelText(/Senha atual/), 'senha-errada-000');
    await userEvent.type(screen.getByLabelText(/^Nova senha/), 'nova-senha-segura-1');
    await userEvent.type(screen.getByLabelText(/Confirme/), 'nova-senha-segura-1');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }));
    expect(await screen.findByText('Senha atual incorreta')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText(/Senha atual/));
    await userEvent.type(screen.getByLabelText(/Senha atual/), 'senha-temporaria-1');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });
});
