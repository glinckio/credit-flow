import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, makeUser, renderApp } from '@/test/render';

const page = <T,>(data: T[]) => ({ data, meta: { page: 1, pageSize: 20, total: data.length } });

const customer = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'INDIVIDUAL',
  name: 'Ana Sintetica',
  documentNumber: '12345678909',
  email: 'ana@exemplo.test',
  phone: '+55 11 90000-0001',
  birthOrFoundationDate: '1990-01-01',
  address: {
    street: 'Rua Ficticia',
    number: '1',
    complement: null,
    district: 'Centro',
    city: 'Cidade Demo',
    state: 'SP',
    zipCode: '01000000',
  },
  status: 'ACTIVE',
  version: 1,
  createdBy: { id: 'u1', name: 'Diego Operador' },
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-01T10:00:00Z',
};

const application = (overrides: Record<string, unknown> = {}) => ({
  id: '22222222-2222-4222-8222-222222222222',
  number: 7,
  code: 'CF-2026-000007',
  customer: {
    id: customer.id,
    name: customer.name,
    type: 'INDIVIDUAL',
    documentNumber: customer.documentNumber,
    status: 'ACTIVE',
  },
  productType: 'PERSONAL_LOAN',
  requestedAmount: '15000.00',
  termMonths: 24,
  purpose: 'Reforma',
  declaredMonthlyIncome: '6500.00',
  declaredMonthlyCommitments: null,
  status: 'DRAFT',
  assignee: null,
  createdBy: { id: 'u1', name: 'Diego Operador' },
  submittedAt: null,
  decidedAt: null,
  closedAt: null,
  version: 1,
  createdAt: '2026-11-02T10:00:00Z',
  updatedAt: '2026-11-02T10:00:00Z',
  documentCount: 0,
  openIssueCount: 0,
  availableActions: ['submit', 'cancel'],
  ...overrides,
});

describe('customers screens', () => {
  it('lists customers from the API and hides "Novo cliente" from analysts', async () => {
    const calls: string[] = [];
    renderApp('/clientes', {
      user: makeUser('ANALYST'),
      fetch: (url) => {
        calls.push(url);
        return jsonResponse(page([customer]));
      },
    });
    expect(await screen.findByRole('link', { name: 'Ana Sintetica' })).toBeInTheDocument();
    expect(screen.getByText('123.456.789-09')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Novo cliente/ })).not.toBeInTheDocument();
    expect(calls[0]).toBe('/api/v1/customers?sort=name%3Aasc&page=1&pageSize=20');
  });

  it('shows "Novo cliente" to operators and keeps filters in the URL', async () => {
    const { router } = renderApp('/clientes', {
      user: makeUser('OPERATOR'),
      fetch: () => jsonResponse(page([customer])),
    });
    expect(await screen.findByRole('link', { name: /Novo cliente/ })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'COMPANY');
    expect(router.state.location.search).toBe('?type=COMPANY');
  });

  it('points to the existing customer when the CPF is already registered', async () => {
    renderApp('/clientes/novo', {
      user: makeUser('OPERATOR'),
      fetch: () =>
        jsonResponse(
          {
            type: '/problems/customer-document-already-exists',
            title: 'Já existe um cliente com este CPF/CNPJ',
            status: 409,
            existingCustomerId: customer.id,
          },
          409,
        ),
    });
    await userEvent.type(await screen.findByLabelText(/^CPF/), '12345678909');
    await userEvent.type(screen.getByLabelText(/Nome completo/), 'Ana Sintetica');
    await userEvent.type(screen.getByLabelText(/Data de nascimento/), '1990-01-01');
    await userEvent.type(screen.getByLabelText(/E-mail/), 'ana@exemplo.test');
    await userEvent.type(screen.getByLabelText(/Telefone/), '11900000001');
    await userEvent.type(screen.getByLabelText(/CEP/), '01000000');
    await userEvent.type(screen.getByLabelText(/Logradouro/), 'Rua Ficticia');
    await userEvent.type(screen.getByLabelText(/Número/), '1');
    await userEvent.type(screen.getByLabelText(/Bairro/), 'Centro');
    await userEvent.type(screen.getByLabelText(/Cidade/), 'Cidade Demo');
    await userEvent.selectOptions(screen.getByLabelText(/UF/), 'SP');
    expect(screen.getByLabelText(/^CPF/)).toHaveValue('123.456.789-09');

    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar cliente' }));
    const link = await screen.findByRole('link', { name: 'Abrir o cadastro existente' });
    expect(link).toHaveAttribute('href', `/clientes/${customer.id}`);
  });

  it('shows client-side errors before calling the API', async () => {
    const { fetchMock } = renderApp('/clientes/novo', { user: makeUser('OPERATOR') });
    await userEvent.type(await screen.findByLabelText(/^CPF/), '11111111111');
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar cliente' }));
    expect(await screen.findByText('CPF inválido')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('application detail', () => {
  function respond(app: ReturnType<typeof application>) {
    return (url: string, init?: RequestInit) => {
      if (url.endsWith('/status-history'))
        return jsonResponse([
          {
            id: 'h1',
            fromStatus: null,
            toStatus: 'DRAFT',
            actor: { id: 'u1', name: 'Diego Operador' },
            reason: null,
            createdAt: app.createdAt,
          },
        ]);
      if (url.endsWith('/documents')) return jsonResponse([]);
      if (url.endsWith('/issues')) return jsonResponse([]);
      if (url.endsWith('/submit') && init?.method === 'POST')
        return jsonResponse(
          {
            type: '/problems/missing-required-documents',
            title: 'Documentos obrigatórios ausentes',
            status: 422,
            detail: 'Anexe: documento de identificação, comprovante de renda/faturamento.',
            missingDocumentTypes: ['IDENTIFICATION', 'PROOF_OF_INCOME'],
          },
          422,
        );
      return jsonResponse(app);
    };
  }

  it('offers the operator only the actions the API allows, and explains a refused submit', async () => {
    renderApp(`/solicitacoes/${application().id}`, {
      user: makeUser('OPERATOR'),
      fetch: respond(application()),
    });
    expect(await screen.findByRole('heading', { name: 'CF-2026-000007' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar para análise' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar solicitação' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assumir análise' })).not.toBeInTheDocument();
    expect(await screen.findByText('Anexar documento')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Enviar para análise' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    expect(await within(dialog).findByText('Documentos obrigatórios ausentes')).toBeInTheDocument();
    expect(within(dialog).getByText(/Anexe: documento de identificação/)).toBeInTheDocument();
  });

  it('requires a reason to cancel', async () => {
    const { fetchMock } = renderApp(`/solicitacoes/${application().id}`, {
      user: makeUser('OPERATOR'),
      fetch: respond(application()),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar solicitação' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    expect(await within(dialog).findByText('Informe o motivo')).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/cancel'))).toBe(false),
    );
  });

  it('hides editing and uploads from analysts', async () => {
    renderApp(`/solicitacoes/${application().id}`, {
      user: makeUser('ANALYST'),
      fetch: respond(application({ status: 'SUBMITTED', availableActions: ['start-review'] })),
    });
    expect(await screen.findByRole('button', { name: 'Assumir análise' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Editar dados/ })).not.toBeInTheDocument();
    expect(await screen.findByText('Nenhum documento anexado.')).toBeInTheDocument();
    expect(screen.queryByText('Anexar documento')).not.toBeInTheDocument();
  });
});
