import type { AiMetrics } from '@creditflow/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, makeUser, renderApp } from '@/test/render';

const metrics: AiMetrics = {
  from: '2026-10-28T12:00:00Z',
  to: '2026-11-27T12:00:00Z',
  days: 30,
  runs: { total: 12, byStatus: { SUCCEEDED: 10, PARTIAL: 1, FAILED: 1 }, byTrigger: {}, purged: 2 },
  cost: { totalUsd: '0.024000', avgPerRunUsd: '0.002000', maxRunUsd: '0.004100' },
  tokens: { input: 1000, output: 200 },
  latencyMs: { avg: 3300, p95: 4300 },
  documents: {
    total: 20,
    byStatus: { OK: 18, TIMEOUT: 2 },
    injectionAlerts: 1,
    withoutTextLayer: 3,
  },
  findings: { byKind: { CONSISTENT: 30, DIVERGENT: 4 } },
  narrative: { byStatus: { OK: 8, REJECTED: 2, NOT_NEEDED: 1 } },
  feedback: {
    total: 10,
    correct: 9,
    incorrect: 1,
    correctionRate: 0.1,
    incorrectBySubject: { monthlyIncome: 1 },
  },
  byVersion: [
    {
      model: 'claude-haiku-5-5',
      promptVersion: 'extract-v1',
      pipelineVersion: 'pipeline-v3',
      runs: 12,
      failed: 1,
      costUsd: '0.024000',
    },
  ],
};

describe('AI metrics page', () => {
  it('shows cost and quality aggregates to the admin and changes the period', async () => {
    const urls: string[] = [];
    renderApp('/admin/ia', {
      user: makeUser('ADMIN'),
      fetch: (url) => {
        urls.push(url);
        return jsonResponse(metrics);
      },
    });
    expect(await screen.findByTestId('ai-tile-Custo total')).toHaveTextContent('US$ 0,0240');
    expect(screen.getByTestId('ai-tile-Correções do analista')).toHaveTextContent('10%');
    expect(screen.getByTestId('ai-tile-Narrativas exibidas')).toHaveTextContent('80%');
    expect(
      within(screen.getByRole('table', { name: 'Documentos por resultado' })).getByText(
        'Não analisado: tempo esgotado',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('claude-haiku-5-5')).toBeInTheDocument();
    expect(urls[0]).toBe('/api/v1/ai-metrics?days=30');

    await userEvent.selectOptions(screen.getByLabelText('Período'), '90');
    await waitFor(() => expect(urls).toContain('/api/v1/ai-metrics?days=90'));
  });

  it('is denied to analysts', async () => {
    renderApp('/admin/ia', { user: makeUser('ANALYST') });
    expect(await screen.findByRole('heading', { name: 'Acesso negado' })).toBeInTheDocument();
  });
});
