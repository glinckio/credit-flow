import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { type CurrentUser } from '@/features/auth/auth-api';
import { jsonResponse, makeUser, renderApp } from '@/test/render';

const ANALYST = makeUser('ANALYST', {
  id: '00000000-0000-4000-8000-0000000000a1',
  name: 'Bruno Analista',
});

const app = (overrides: Record<string, unknown> = {}) => ({
  id: '33333333-3333-4333-8333-333333333333',
  number: 9,
  code: 'CF-2026-000009',
  customer: {
    id: 'c1',
    name: 'Cliente Sintetico',
    type: 'INDIVIDUAL',
    documentNumber: '12345678909',
    status: 'ACTIVE',
  },
  productType: 'PERSONAL_LOAN',
  requestedAmount: '15000.00',
  termMonths: 24,
  purpose: 'Reforma',
  declaredMonthlyIncome: '6500.00',
  declaredMonthlyCommitments: '1200.50',
  status: 'UNDER_REVIEW',
  assignee: { id: ANALYST.id, name: ANALYST.name },
  createdBy: { id: 'u1', name: 'Diego Operador' },
  submittedAt: '2026-11-02T10:00:00Z',
  decidedAt: null,
  closedAt: null,
  version: 3,
  createdAt: '2026-11-02T09:00:00Z',
  updatedAt: '2026-11-02T10:00:00Z',
  documentCount: 1,
  openIssueCount: 0,
  availableActions: ['release', 'request-information', 'approve', 'reject'],
  ...overrides,
});

const doc = {
  id: 'd1',
  applicationId: app().id,
  type: 'IDENTIFICATION',
  otherDescription: null,
  originalName: 'rg.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1234,
  sha256: 'a'.repeat(64),
  uploadedBy: { id: 'u1', name: 'Diego Operador' },
  uploadedAt: '2026-11-02T09:30:00Z',
  validationStatus: 'PENDING',
  validationNotes: null,
  validatedBy: null,
  validatedAt: null,
};

const indicators = {
  indicators: [
    {
      key: 'simpleInstallment',
      label: 'Parcela simples estimada (sem juros)',
      formula: 'valor solicitado ÷ prazo em meses',
      value: '625.00',
      unit: 'BRL',
    },
    {
      key: 'installmentToIncome',
      label: 'Parcela simples ÷ renda',
      formula: 'parcela ÷ renda',
      value: '0.0962',
      unit: 'ratio',
    },
  ],
  disclaimer: 'Indicadores demonstrativos. Não determinam aprovação ou reprovação.',
};

const review = {
  id: 'r1',
  applicationId: app().id,
  author: { id: ANALYST.id, name: ANALYST.name },
  recommendation: 'APPROVE',
  analysisNotes: 'Documentação coerente.',
  justification: 'Renda comprovada e compatível com o prazo.',
  current: true,
  createdAt: '2026-11-03T10:00:00Z',
};

type Handler = (url: string, init?: RequestInit) => Response | undefined;

function api(application: ReturnType<typeof app>, extra: Handler = () => undefined) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch = (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const custom = extra(url, init);
    if (custom) return custom;
    if (url.endsWith('/indicators')) return jsonResponse(indicators);
    if (url.endsWith('/reviews')) return jsonResponse([review]);
    if (url.endsWith('/issues')) return jsonResponse([]);
    if (url.endsWith('/documents')) return jsonResponse([doc]);
    if (url.endsWith('/status-history')) return jsonResponse([]);
    if (url.endsWith('/ai-analyses')) return jsonResponse([]);
    if (url.startsWith('/api/v1/users'))
      return jsonResponse({
        data: [{ id: 'a2', name: 'Carla Analista', email: 'c@x.test' }],
        meta: { page: 1, pageSize: 100, total: 1 },
      });
    return jsonResponse(application);
  };
  return { fetch, calls };
}

const open = (user: CurrentUser, application = app(), extra?: Handler) => {
  const mock = api(application, extra);
  renderApp(`/solicitacoes/${application.id}?aba=analise`, { user, fetch: mock.fetch });
  return mock;
};

describe('analysis tab', () => {
  it('shows descriptive indicators with formula and disclaimer, without any score', async () => {
    open(ANALYST);
    expect(await screen.findByText('R$ 625,00')).toBeInTheDocument();
    expect(screen.getByText('9,62%')).toBeInTheDocument();
    expect(screen.getByText(/Fórmula: valor solicitado ÷ prazo em meses/)).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Não determinam aprovação ou reprovação');
    expect(screen.queryByText(/score/i)).not.toBeInTheDocument();
  });

  it('lets the assigned analyst register an issue', async () => {
    const { calls } = open(ANALYST);
    await userEvent.type(await screen.findByLabelText('Nova pendência'), 'Enviar extrato bancário');
    await userEvent.click(screen.getByRole('button', { name: /Registrar pendência/ }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/issues'))?.body).toEqual({
        description: 'Enviar extrato bancário',
      }),
    );
  });

  it('validates the review form (justification length)', async () => {
    const { calls } = open(ANALYST);
    await userEvent.selectOptions(await screen.findByLabelText(/Recomendação/), 'APPROVE');
    await userEvent.type(
      screen.getByLabelText(/Observações da análise/),
      'Análise completa dos documentos.',
    );
    await userEvent.type(screen.getByLabelText(/^Justificativa/), 'curta');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar parecer' }));
    expect(await screen.findByText(/ao menos 20 caracteres/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/reviews'))).toBe(false);
  });

  it('requires outcome, justification and explicit confirmation before recording a decision', async () => {
    const { calls } = open(ANALYST);
    await userEvent.click(await screen.findByRole('button', { name: /Registrar decisão/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar decisão' }));
    expect(within(dialog).getByText('Escolha aprovar ou reprovar')).toBeInTheDocument();
    expect(within(dialog).getByText(/ao menos 20 caracteres/)).toBeInTheDocument();
    expect(within(dialog).getByText('Confirme que a decisão é sua')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/decision') && c.method === 'POST')).toBe(false);

    await userEvent.click(within(dialog).getByLabelText('Reprovar'));
    expect(
      within(dialog).getByText(/diverge da recomendação do parecer vigente/),
    ).toBeInTheDocument();
    await userEvent.type(
      within(dialog).getByLabelText(/^Justificativa/),
      'Comprometimento de renda acima do aceitável para o prazo.',
    );
    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar decisão' }));
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/decision') && c.method === 'POST')?.body).toEqual({
        outcome: 'REJECTED',
        justification: 'Comprometimento de renda acima do aceitável para o prazo.',
      }),
    );
  });

  it('explains the API refusal when issues are still open', async () => {
    open(ANALYST, app({ openIssueCount: 1 }), (url, init) =>
      url.endsWith('/decision') && init?.method === 'POST'
        ? jsonResponse(
            { type: '/problems/open-issues', title: 'Há pendências abertas', status: 422 },
            422,
          )
        : undefined,
    );
    await userEvent.click(await screen.findByRole('button', { name: /Registrar decisão/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/1 pendência\(s\) aberta\(s\)/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByLabelText('Aprovar'));
    await userEvent.type(
      within(dialog).getByLabelText(/^Justificativa/),
      'Aprovado conforme parecer vigente registrado.',
    );
    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar decisão' }));
    expect(
      await within(dialog).findByText('Há pendências abertas: resolva-as antes de aprovar'),
    ).toBeInTheDocument();
  });

  it('gives operators without the grant a read-only analysis view', async () => {
    open(makeUser('OPERATOR'), app({ availableActions: [] }));
    expect(await screen.findByText('Indicadores descritivos')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Registrar decisão/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Nova pendência')).not.toBeInTheDocument();
    expect(screen.queryByText('Novo parecer')).not.toBeInTheDocument();
  });

  it('shows the recorded decision once the application is decided', async () => {
    open(ANALYST, app({ status: 'APPROVED', availableActions: [] }), (url) =>
      url.endsWith('/decision')
        ? jsonResponse({
            id: 'dec1',
            applicationId: app().id,
            outcome: 'APPROVED',
            justification: 'Aprovado conforme parecer vigente.',
            decidedBy: { id: ANALYST.id, name: ANALYST.name },
            decidedAt: '2026-11-04T10:00:00Z',
            reviewId: 'r1',
            reviewRecommendation: 'APPROVE',
          })
        : undefined,
    );
    expect(await screen.findByText('Aprovado conforme parecer vigente.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Registrar decisão/ })).not.toBeInTheDocument();
  });
});

describe('document validation and assignment', () => {
  it('requires a reason to reject a document', async () => {
    const mock = api(app());
    renderApp(`/solicitacoes/${app().id}`, { user: ANALYST, fetch: mock.fetch });
    await userEvent.click(await screen.findByRole('button', { name: 'Rejeitar rg.pdf' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rejeitar documento' }));
    expect(within(dialog).getByText('Explique o motivo da rejeição')).toBeInTheDocument();
    expect(mock.calls.some((c) => c.method === 'PATCH')).toBe(false);

    await userEvent.type(within(dialog).getByLabelText(/Motivo da rejeição/), 'Documento ilegível');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rejeitar documento' }));
    await waitFor(() =>
      expect(mock.calls.find((c) => c.method === 'PATCH')).toMatchObject({
        url: '/api/v1/documents/d1/validation',
        body: { status: 'REJECTED', notes: 'Documento ilegível' },
      }),
    );
  });

  it('lets an admin assign an active analyst', async () => {
    const mock = api(
      app({ status: 'SUBMITTED', assignee: null, availableActions: ['assign', 'cancel'] }),
    );
    renderApp(`/solicitacoes/${app().id}`, { user: makeUser('ADMIN'), fetch: mock.fetch });
    await userEvent.click(await screen.findByRole('button', { name: /Atribuir analista/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(await within(dialog).findByLabelText(/Analista/), 'a2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Atribuir' }));
    await waitFor(() =>
      expect(mock.calls.find((c) => c.url.endsWith('/assign'))?.body).toEqual({ assigneeId: 'a2' }),
    );
  });
});
