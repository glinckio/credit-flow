import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, makeUser, renderApp } from '@/test/render';
import { diffRows } from './audit/audit-api';
import { formatHours } from './dashboard/dashboard-api';

const metrics = (overrides: Record<string, unknown> = {}) => ({
  total: 31,
  byStatus: {
    DRAFT: 3,
    SUBMITTED: 5,
    UNDER_REVIEW: 5,
    PENDING_INFORMATION: 4,
    APPROVED: 7,
    REJECTED: 4,
    CANCELLED: 3,
  },
  awaitingReview: 5,
  underReview: 5,
  pendingInformation: 4,
  withOpenIssues: 4,
  approved: 7,
  rejected: 4,
  assignedToMe: null,
  openToDecision: { averageHours: 137.6, sampleSize: 11, definition: 'Média de abertura→decisão' },
  submissionToDecision: { averageHours: null, sampleSize: 0, definition: 'Média de envio→decisão' },
  generatedAt: '2026-11-25T12:00:00Z',
  ...overrides,
});

describe('dashboard', () => {
  it('formats durations in days and hours', () => {
    expect(formatHours(14)).toBe('14 h');
    expect(formatHours(137.6)).toBe('5 d 17,6 h');
  });

  it('shows the API numbers as tiles linking to filtered lists', async () => {
    renderApp('/', { user: makeUser('OPERATOR'), fetch: () => jsonResponse(metrics()) });
    expect(await screen.findByTestId('tile-Total de solicitações')).toHaveTextContent('31');
    expect(screen.getByTestId('tile-Aprovadas')).toHaveTextContent('7');
    expect(screen.getByTestId('tile-Aguardando análise').closest('a')).toHaveAttribute(
      'href',
      '/solicitacoes?status=SUBMITTED&sort=submittedAt%3Aasc',
    );
    expect(screen.getByText('5 d 17,6 h')).toBeInTheDocument();
    expect(screen.getByText(/base: 11 solicitação/)).toBeInTheDocument();
    expect(screen.getByText(/Dados insuficientes/)).toBeInTheDocument();
    // Operators do not get the "assigned to me" tile; drafts are part of the distribution.
    expect(screen.queryByTestId('tile-Atribuídas a mim')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Rascunho\s*3\b/ })).toBeInTheDocument();
  });

  it('shows the analyst workload and hides drafts', async () => {
    renderApp('/', {
      user: makeUser('ANALYST'),
      fetch: () =>
        jsonResponse(
          metrics({ total: 28, byStatus: { ...metrics().byStatus, DRAFT: 0 }, assignedToMe: 3 }),
        ),
    });
    expect(await screen.findByTestId('tile-Atribuídas a mim')).toHaveTextContent('3');
    expect(screen.queryByRole('link', { name: /^Rascunho/ })).not.toBeInTheDocument();
  });
});

const users = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'admin@creditflow.test',
    name: 'Ana Administradora',
    role: 'ADMIN',
    canDecide: false,
    mustChangePassword: false,
    active: true,
    lastLoginAt: null,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    email: 'operador.decisor@creditflow.test',
    name: 'Elisa Operadora',
    role: 'OPERATOR',
    canDecide: true,
    mustChangePassword: true,
    active: true,
    lastLoginAt: null,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
];

describe('users administration', () => {
  const admin = makeUser('ADMIN', { id: users[0]!.id, name: users[0]!.name });

  it('lists users and protects the current admin from self-deactivation', async () => {
    renderApp('/admin/usuarios', {
      user: admin,
      fetch: () => jsonResponse({ data: users, meta: { page: 1, pageSize: 20, total: 2 } }),
    });
    expect(await screen.findByText('Elisa Operadora')).toBeInTheDocument();
    expect(screen.getByText('pode decidir')).toBeInTheDocument();
    expect(screen.getByText('senha temporária')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desativar Ana Administradora' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Desativar Elisa Operadora' })).toBeEnabled();
  });

  it('validates the new-user form and offers the decide grant only to operators', async () => {
    const calls: { url: string; body: unknown }[] = [];
    renderApp('/admin/usuarios', {
      user: admin,
      fetch: (url, init) => {
        if (init?.method === 'POST') {
          calls.push({ url, body: JSON.parse(String(init.body)) });
          return jsonResponse(
            { type: '/problems/email-already-used', title: 'Já existe', status: 409 },
            409,
          );
        }
        return jsonResponse({ data: users, meta: { page: 1, pageSize: 20, total: 2 } });
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: /Novo usuário/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(/Pode registrar decisões/)).not.toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText(/Papel/), 'OPERATOR');
    expect(within(dialog).getByText(/Pode registrar decisões/)).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText(/^Nome/), 'Novo Operador');
    await userEvent.type(within(dialog).getByLabelText(/E-mail/), 'Novo@CreditFlow.test');
    await userEvent.type(within(dialog).getByLabelText(/Senha temporária/), 'curta');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar usuário' }));
    expect(await within(dialog).findByText(/Mínimo de 12 caracteres/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Gerar senha' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar usuário' }));
    expect(
      await within(dialog).findByText('Já existe um usuário com este e-mail'),
    ).toBeInTheDocument();
    expect(calls[0]).toMatchObject({
      url: '/api/v1/users',
      body: { email: 'novo@creditflow.test', role: 'OPERATOR', canDecide: false },
    });
    expect((calls[0]!.body as { initialPassword: string }).initialPassword).toHaveLength(16);
  });
});

describe('audit viewer', () => {
  it('computes a field-level diff', () => {
    expect(diffRows({ name: 'A', phone: '1' }, { name: 'B', phone: '1', status: 'X' })).toEqual([
      { field: 'name', before: 'A', after: 'B', changed: true },
      { field: 'phone', before: '1', after: '1', changed: false },
      { field: 'status', before: undefined, after: 'X', changed: true },
    ]);
  });

  it('lists events, expands before/after and keeps filters in the URL', async () => {
    const calls: string[] = [];
    const { router } = renderApp('/admin/auditoria', {
      user: makeUser('ADMIN'),
      fetch: (url) => {
        calls.push(url);
        return jsonResponse({
          data: [
            {
              id: '42',
              occurredAt: '2026-11-25T10:00:00Z',
              actor: { id: 'u1', name: 'Diego Operador', email: 'operador@creditflow.test' },
              action: 'customer.updated',
              entityType: 'Customer',
              entityId: '11111111-1111-4111-8111-111111111111',
              before: { phone: '+55 11 90000-0001' },
              after: { phone: '+55 11 90000-0099' },
              metadata: { requestId: 'req-abc' },
            },
          ],
          meta: { page: 1, pageSize: 25, total: 1 },
        });
      },
    });
    expect(await screen.findByText('Cliente alterado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /11111111…/ })).toHaveAttribute(
      'href',
      '/clientes/11111111-1111-4111-8111-111111111111',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ver detalhes' }));
    expect(screen.getByText('+55 11 90000-0001')).toBeInTheDocument();
    expect(screen.getByText('+55 11 90000-0099')).toBeInTheDocument();
    expect(screen.getByText('req-abc')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Ação'), 'decision.recorded');
    expect(router.state.location.search).toBe('?action=decision.recorded');
    await waitFor(() => expect(calls.at(-1)).toContain('action=decision.recorded'));
  });

  it('is not reachable by analysts', async () => {
    renderApp('/admin/auditoria', { user: makeUser('ANALYST') });
    expect(await screen.findByRole('heading', { name: 'Acesso negado' })).toBeInTheDocument();
  });
});
