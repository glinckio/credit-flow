import { cpfCheckDigits, formatCpf } from '@creditflow/shared';
import { expect, test } from '@playwright/test';
import { identificationPdf, payslipPdf } from '../support/ai-documents.js';
import { DEMO_USERS } from '../support/env.js';
import { attachDocument, confirmAction, signIn } from '../support/helpers.js';

const XRW = { 'X-Requested-With': 'XMLHttpRequest' };

/**
 * Part B (ADR-0011), end to end with recorded model answers: the first entry
 * into review queues the analysis; the analyst reads the support report with
 * evidence, gives feedback and reprocesses. Reviews and decision are untouched.
 */
test('AI support report: automatic first run, evidence, feedback and reprocess', async ({
  browser,
}) => {
  const cpf = cpfCheckDigits(String(100_000_000 + Math.floor(Math.random() * 899_999_999)));
  const name = `Cliente IA E2E ${cpf.slice(-4)}`;
  const operator = await signIn(browser, DEMO_USERS.operator);

  const customer = await operator.request.post('/api/v1/customers', {
    headers: XRW,
    data: {
      type: 'INDIVIDUAL',
      name,
      documentNumber: formatCpf(cpf),
      email: 'cliente.ia.e2e@exemplo.test',
      phone: '11900001234',
      birthOrFoundationDate: '1987-06-15',
      address: {
        street: 'Avenida Ficticia',
        number: '500',
        complement: '',
        district: 'Centro',
        city: 'Cidade Demo',
        state: 'SP',
        zipCode: '01310-100',
      },
    },
  });
  expect(customer.status()).toBe(201);
  const application = await operator.request.post('/api/v1/applications', {
    headers: XRW,
    data: {
      customerId: (await customer.json()).id,
      productType: 'PERSONAL_LOAN',
      requestedAmount: '12000.00',
      termMonths: 24,
      purpose: 'Reforma (E2E IA)',
      declaredMonthlyIncome: '6000.00',
      declaredMonthlyCommitments: '900.00',
    },
  });
  expect(application.status()).toBe(201);
  const applicationId = (await application.json()).id as string;
  const path = `/solicitacoes/${applicationId}`;

  await test.step('operator attaches documents with a text layer and submits', async () => {
    await operator.goto(path);
    const id = identificationPdf({ name, cpf, birth: '15/06/1987' });
    // Declared 6.000,00; the payslip shows 5.000,00 gross and 4.100,00 net.
    const payslip = payslipPdf({ name, cpf, gross: 'R$ 5.000,00', net: 'R$ 4.100,00' });
    await attachDocument(operator, 'Documento de identificação', id.fileName, id.bytes);
    await attachDocument(
      operator,
      'Comprovante de renda/faturamento',
      payslip.fileName,
      payslip.bytes,
    );
    await confirmAction(operator, 'Enviar para análise');
    await expect(operator.getByText('Aguardando análise', { exact: true })).toBeVisible();
  });

  const analyst = await signIn(browser, DEMO_USERS.analyst, path);
  const panel = analyst.locator('[aria-labelledby="ai-panel-title"]');

  await test.step('taking the review queues the first analysis automatically', async () => {
    await confirmAction(analyst, 'Assumir análise');
    await analyst.getByRole('tab', { name: /Análise/ }).click();
    await expect(panel.getByText('Concluída', { exact: true })).toBeVisible({ timeout: 20_000 });
  });

  await test.step('the report shows the divergence with its evidence, and no decision', async () => {
    await expect(panel.getByRole('heading', { name: 'Pontos de atenção (1)' })).toBeVisible();
    const income = panel.getByTestId(/^finding-monthlyIncome:/);
    await expect(income).toContainText('Divergente');
    await expect(income).toContainText('Declarado: R$ 6.000,00');
    await expect(income.getByRole('list', { name: 'Evidências' })).toContainText(
      'trecho conferido no documento',
    );
    await expect(panel.getByText('redigido por IA a partir dos achados')).toBeVisible();
    await expect(panel.getByRole('note')).toContainText('Não é parecer nem decisão');
    await expect(panel).not.toContainText(/aprov|reprov|recomend/i);
  });

  await test.step('the assigned analyst rates a finding', async () => {
    const income = panel.getByTestId(/^finding-monthlyIncome:/);
    const correct = income.getByRole('button', {
      name: 'Marcar Renda/faturamento mensal como correto',
    });
    await correct.click();
    await expect(analyst.getByText('Avaliação registrada.')).toBeVisible();
    await expect(correct).toHaveAttribute('aria-pressed', 'true');
  });

  await test.step('reprocessing unchanged documents asks for confirmation', async () => {
    await panel.getByRole('button', { name: /Reprocessar/ }).click();
    const dialog = analyst.getByRole('dialog');
    await expect(dialog).toContainText('Reprocessar sem mudanças nos documentos?');
    await dialog.getByRole('button', { name: 'Confirmar' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      panel.getByRole('combobox', { name: 'Execução da análise' }).locator('option'),
    ).toHaveCount(2);
    await expect(panel.getByText('Nenhuma mudança nos achados.')).toBeVisible({
      timeout: 20_000,
    });
  });

  await test.step('reviews and decision were not touched', async () => {
    const reviews = await analyst.request.get(`/api/v1/applications/${applicationId}/reviews`);
    expect(await reviews.json()).toEqual([]);
    const app = await analyst.request.get(`/api/v1/applications/${applicationId}`);
    expect((await app.json()).status).toBe('UNDER_REVIEW');
  });

  await operator.context().close();
  await analyst.context().close();
});
