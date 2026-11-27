import {
  CustomerType,
  DocumentExtractionStatus as S,
  DocumentType,
  type AssessedDocument,
  buildTemplateReport,
  compareWithDeclared,
} from '@creditflow/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CurrentUser } from '@/features/auth/auth-api';
import { jsonResponse, makeUser, renderApp } from '@/test/render';

const ANALYST = makeUser('ANALYST', { id: '00000000-0000-4000-8000-0000000000a1', name: 'Bruno' });
const OTHER_ANALYST = makeUser('ANALYST', { id: '00000000-0000-4000-8000-0000000000a2' });
const ADMIN = makeUser('ADMIN');
const OPERATOR = makeUser('OPERATOR');

const APP_ID = '33333333-3333-4333-8333-333333333333';
const DOC_ID = '44444444-4444-4444-8444-444444444444';
const RUN_ID = '55555555-5555-4555-8555-555555555555';
const OLD_RUN_ID = '66666666-6666-4666-8666-666666666666';

const app = (overrides: Record<string, unknown> = {}) => ({
  id: APP_ID,
  number: 9,
  code: 'CF-2026-000009',
  customer: {
    id: 'c1',
    name: 'Maria Silva Souza',
    type: 'INDIVIDUAL',
    documentNumber: '52998224725',
    status: 'ACTIVE',
  },
  productType: 'PERSONAL_LOAN',
  requestedAmount: '15000.00',
  termMonths: 24,
  purpose: 'Reforma',
  declaredMonthlyIncome: '4100.00',
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

const field = (key: string, value: string, verified = true) =>
  ({
    key,
    modelStatus: 'FOUND',
    modelValue: value,
    page: 1,
    quote: `${key}: ${value}`,
    evidenceStatus: verified ? 'VERIFIED' : 'UNVERIFIED',
    evidenceReason: null,
    acceptedValue: verified ? value : null,
    rejectedBy: null,
  }) as AssessedDocument['fields'][number];

function report(net: string) {
  const docs: AssessedDocument[] = [
    {
      documentId: DOC_ID,
      declaredType: DocumentType.PROOF_OF_INCOME,
      status: S.OK,
      detectedType: 'PROOF_OF_INCOME',
      typeMatchesDeclared: true,
      hasTextLayer: true,
      injectionAlert: false,
      fields: [
        field('holderName', 'Maria Silva Souza'),
        field('holderTaxId', '52998224725'),
        field('netMonthlyIncome', net),
      ],
    },
  ];
  const findings = compareWithDeclared(
    {
      customerType: CustomerType.INDIVIDUAL,
      name: 'Maria Silva Souza',
      taxId: '52998224725',
      birthOrFoundationDate: '1990-05-12',
      address: { street: 'Rua A', number: '1', city: 'X', state: 'SP', zipCode: '01000000' },
      declaredMonthlyIncome: '4100.00',
    },
    docs,
  );
  return { findings, report: buildTemplateReport(findings, docs, { [DOC_ID]: 'holerite.pdf' }) };
}

const run = (overrides: Record<string, unknown> = {}) => ({
  id: RUN_ID,
  applicationId: APP_ID,
  trigger: 'AUTO_FIRST_REVIEW',
  status: 'SUCCEEDED',
  requestedBy: null,
  model: 'claude-haiku-5-5',
  pipelineVersion: 'pipeline-v3',
  extractionSchemaVersion: 'v1',
  promptVersion: 'p1',
  errorCode: null,
  inputTokens: 1000,
  outputTokens: 200,
  costUsd: '0.000200',
  latencyMs: 900,
  queuedAt: '2026-11-03T10:00:00Z',
  startedAt: '2026-11-03T10:00:01Z',
  finishedAt: '2026-11-03T10:00:05Z',
  purgedAt: null,
  stale: false,
  documentCount: 1,
  ...overrides,
});

const detail = (overrides: Record<string, unknown> = {}, net = '3200.00') => {
  const r = report(net);
  return {
    ...run(),
    documents: [],
    findings: r.findings,
    report: r.report,
    reportAtCompletion: r.report,
    narrative: {
      version: 'narrative-v1',
      status: 'OK',
      model: 'claude-haiku-5-5',
      promptVersion: 'narrative-v2',
      sentences: [
        {
          text: 'Renda/faturamento mensal: R$ 4.100,00 (declarado), mas o Documento 1 traz líquido R$ 3.200,00 (no documento).',
          findingIds: [`monthlyIncome:${DOC_ID}`],
          documentIds: [],
        },
      ],
      rejections: [],
    },
    declaredDataChanged: false,
    feedback: [],
    ...overrides,
  };
};

type Handler = (url: string, init?: RequestInit) => Response | undefined;

function open(
  user: CurrentUser,
  {
    application = app(),
    runs = [run()],
    details = { [RUN_ID]: detail() } as Record<string, unknown>,
    extra = (() => undefined) as Handler,
  } = {},
) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch = (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const custom = extra(url, init);
    if (custom) return custom;
    if (url.endsWith('/ai-analyses') && method === 'GET') return jsonResponse(runs);
    const m = /\/ai-analyses\/([0-9a-f-]{36})$/.exec(url);
    if (m) return jsonResponse(details[m[1]!]);
    if (url.endsWith('/indicators')) return jsonResponse({ indicators: [], disclaimer: 'x' });
    if (/\/(reviews|issues|documents|status-history)$/.test(url)) return jsonResponse([]);
    return jsonResponse(application);
  };
  renderApp(`/solicitacoes/${APP_ID}?aba=analise`, { user, fetch });
  return calls;
}

const panel = async () =>
  (await screen.findByRole('heading', { name: /Análise de documentos por IA/ })).closest(
    '[aria-labelledby="ai-panel-title"]',
  ) as HTMLElement;

describe('AI analysis panel', () => {
  it('shows attention points first, with evidence, the narrative and the disclaimer', async () => {
    open(ANALYST);
    const p = await panel();
    const attention = await within(p).findByRole('heading', { name: /Pontos de atenção \(1\)/ });
    expect(attention).toBeInTheDocument();
    const income = within(p).getByTestId(`finding-monthlyIncome:${DOC_ID}`);
    expect(income).toHaveTextContent('Divergente');
    expect(income).toHaveTextContent('Declarado: R$ 4.100,00');
    expect(within(income).getByRole('list', { name: 'Evidências' })).toHaveTextContent(
      /Página 1: .*netMonthlyIncome: 3200.00.*trecho conferido/,
    );
    expect(within(p).getByText(/redigido por IA a partir dos achados/)).toBeInTheDocument();
    expect(within(p).getByText(/R\$ 3\.200,00 \(no documento\)/)).toBeInTheDocument();
    expect(within(p).getByRole('note')).toHaveTextContent('Não é parecer nem decisão');
    expect(within(p).getByText('Itens que conferem (3)')).toBeInTheDocument();
    // No decision vocabulary anywhere in the panel.
    expect(p.textContent).not.toMatch(/aprov|reprov|recomend|score/i);
  });

  it('hides a narrative that was not accepted, keeping the template', async () => {
    open(ANALYST, {
      details: {
        [RUN_ID]: detail({
          narrative: { status: 'REJECTED', sentences: [], rejections: [] },
        }),
      },
    });
    const p = await panel();
    await within(p).findByRole('heading', { name: /Pontos de atenção/ });
    expect(within(p).queryByText(/Resumo em texto/)).not.toBeInTheDocument();
  });

  it('warns when the run is stale, partial or the declared data changed', async () => {
    open(ANALYST, {
      runs: [run({ stale: true, status: 'PARTIAL' })],
      details: { [RUN_ID]: detail({ status: 'PARTIAL', declaredDataChanged: true }) },
    });
    const p = await panel();
    expect(await within(p).findByText('Os documentos mudaram desde esta análise')).toBeVisible();
    expect(await within(p).findByText('Alguns documentos não foram analisados')).toBeVisible();
    expect(within(p).getByText('Os dados declarados mudaram depois desta análise')).toBeVisible();
    expect(within(p).getByText('desatualizado')).toBeVisible();
  });

  it('tells the analyst a failed run did not block the manual analysis', async () => {
    open(ANALYST, {
      runs: [run({ status: 'FAILED', errorCode: 'all-documents-failed' })],
      details: { [RUN_ID]: { ...detail(), status: 'FAILED', report: null } },
    });
    const p = await panel();
    expect(await within(p).findByText('A análise por IA não pôde ser concluída')).toBeVisible();
  });

  it('polls a queued run instead of showing a report', async () => {
    const calls = open(ANALYST, { runs: [run({ status: 'QUEUED', finishedAt: null })] });
    const p = await panel();
    expect(await within(p).findByText(/Analisando os documentos/)).toBeVisible();
    expect(calls.some((c) => c.url.endsWith(`/ai-analyses/${RUN_ID}`))).toBe(false);
  });

  it('asks for confirmation before reprocessing unchanged documents', async () => {
    let posts = 0;
    const calls = open(ANALYST, {
      extra: (url, init) => {
        if (!url.endsWith('/ai-analyses') || init?.method !== 'POST') return undefined;
        posts++;
        return posts === 1
          ? jsonResponse(
              {
                type: '/problems/analysis-up-to-date',
                title: 'Os documentos não mudaram desde a última análise',
                status: 409,
              },
              409,
            )
          : jsonResponse(run({ status: 'QUEUED', trigger: 'MANUAL' }), 202);
      },
    });
    const p = await panel();
    await userEvent.click(within(p).getByRole('button', { name: /Reprocessar/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Reprocessar sem mudanças nos documentos?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
        {},
        { force: true },
      ]),
    );
  });

  it('offers reprocess and feedback only to the assigned analyst', async () => {
    for (const user of [OTHER_ANALYST, ADMIN]) {
      open(user);
      const p = await panel();
      await within(p).findByRole('heading', { name: /Pontos de atenção/ });
      expect(within(p).queryByRole('button', { name: /Reprocessar/ })).not.toBeInTheDocument();
      expect(within(p).queryByRole('button', { name: /como correto/ })).not.toBeInTheDocument();
      cleanup();
    }
  });

  it('is not shown to an operator without decision rights', async () => {
    open(OPERATOR, { application: app({ availableActions: [] }) });
    await screen.findByRole('heading', { name: /Pendências/ });
    expect(screen.queryByText(/Análise de documentos por IA/)).not.toBeInTheDocument();
  });

  it('sends the analyst feedback per finding, with an optional comment', async () => {
    const calls = open(ANALYST, {
      extra: (url, init) =>
        init?.method === 'PUT'
          ? jsonResponse({
              findingId: `monthlyIncome:${DOC_ID}`,
              verdict: 'INCORRECT',
              comment: 'Líquido está na página 2.',
              author: { id: ANALYST.id, name: ANALYST.name },
              updatedAt: '2026-11-03T11:00:00Z',
            })
          : undefined,
    });
    const p = await panel();
    const income = await within(p).findByTestId(`finding-monthlyIncome:${DOC_ID}`);
    await userEvent.click(within(income).getByRole('button', { name: 'Comentar' }));
    await userEvent.type(
      within(income).getByLabelText(/Comentário sobre Renda/),
      'Líquido está na página 2.',
    );
    await userEvent.click(
      within(income).getByRole('button', {
        name: 'Marcar Renda/faturamento mensal como incorreto',
      }),
    );
    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT');
      expect(put?.url).toBe(
        `/api/v1/ai-analyses/${RUN_ID}/findings/${encodeURIComponent(`monthlyIncome:${DOC_ID}`)}/feedback`,
      );
      expect(put?.body).toEqual({ verdict: 'INCORRECT', comment: 'Líquido está na página 2.' });
    });
  });

  it('lists earlier runs and what changed since the previous one', async () => {
    open(ANALYST, {
      runs: [
        run({ trigger: 'MANUAL', queuedAt: '2026-11-04T10:00:00Z' }),
        run({ id: OLD_RUN_ID, stale: true }),
      ],
      details: {
        [RUN_ID]: detail(),
        [OLD_RUN_ID]: { ...detail({ id: OLD_RUN_ID }, '4100.00') },
      },
    });
    const p = await panel();
    const diff = await within(p).findByRole('heading', { name: /Mudanças em relação à análise/ });
    expect(diff.nextElementSibling).toHaveTextContent(
      'Renda/faturamento mensal — holerite.pdf (comprovante de renda/faturamento): Confere → Divergente',
    );
    const select = within(p).getByRole('combobox', { name: 'Execução da análise' });
    expect(within(select).getAllByRole('option')).toHaveLength(2);
    await userEvent.selectOptions(select, OLD_RUN_ID);
    expect(await within(p).findByText('Os documentos mudaram desde esta análise')).toBeVisible();
  });
});
