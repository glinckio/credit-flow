import { cpfCheckDigits } from '@creditflow/shared';
import { expect, test } from '@playwright/test';
import { DEMO_USERS } from '../support/env.js';
import { attachDocument, confirmAction, signIn, statTile } from '../support/helpers.js';

/**
 * Roadmap §5 — the main flow, end to end, as three different people:
 *
 *  1. operator registers a customer      2. opens an application
 *  3. attaches documents and submits     4. analyst takes and reviews it
 *  5. records an issue and sends it back; operator complements and resumes
 *  6. analyst resolves the issue and records a review
 *  7. an authorised user records the human decision
 *  8. status and audit are updated        9. dashboard reflects the result
 */
test('main credit flow from customer registration to human decision', async ({ browser }) => {
  // Synthetic CPF, unique per run (the E2E database is recreated on every run anyway).
  const cpf = cpfCheckDigits(String(100_000_000 + Math.floor(Math.random() * 899_999_999)));
  const customerName = `Cliente E2E ${cpf.slice(-4)}`;

  // Dashboard baseline, seen by the analyst.
  const analyst = await signIn(browser, DEMO_USERS.analyst);
  await expect(analyst.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  const approvedBefore = await statTile(analyst, 'Aprovadas');

  const operator = await signIn(browser, DEMO_USERS.operator, '/clientes/novo');
  let applicationUrl = '';
  let code = '';

  await test.step('1. operator registers a customer', async () => {
    await expect(operator.getByRole('heading', { name: 'Novo cliente' })).toBeVisible();
    await operator.getByLabel('CPF').fill(cpf);
    await expect(operator.getByLabel('CPF')).toHaveValue(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
    await operator.getByLabel('Nome completo').fill(customerName);
    await operator.getByLabel('Data de nascimento').fill('1987-06-15');
    await operator.getByLabel('E-mail').fill('cliente.e2e@exemplo.test');
    await operator.getByLabel('Telefone').fill('11900001234');
    await operator.getByLabel('CEP').fill('01310100');
    await operator.getByLabel('Logradouro').fill('Avenida Ficticia');
    await operator.getByLabel('Número').fill('500');
    await operator.getByLabel('Bairro').fill('Centro');
    await operator.getByLabel('Cidade').fill('Cidade Demo');
    await operator.getByLabel('UF').selectOption('SP');
    await operator.getByRole('button', { name: 'Cadastrar cliente' }).click();
    await expect(operator.getByRole('heading', { name: customerName })).toBeVisible();
  });

  await test.step('2. operator opens a credit application', async () => {
    await operator.getByRole('link', { name: 'Nova solicitação' }).click();
    await operator.getByLabel('Tipo de crédito').selectOption({ label: 'Empréstimo pessoal' });
    await operator.getByLabel('Valor solicitado (R$)').fill('12.000,00');
    await operator.getByLabel('Prazo (meses)').fill('24');
    await operator.getByLabel('Renda mensal declarada (R$)').fill('6.000,00');
    await operator.getByLabel('Compromissos mensais declarados (R$)').fill('900,00');
    await operator.getByLabel('Finalidade declarada').fill('Reforma da residencia (E2E)');
    await operator.getByRole('button', { name: 'Criar rascunho' }).click();
    await expect(operator.getByText('Rascunho', { exact: true })).toBeVisible();
    code = (await operator.getByRole('heading', { level: 1 }).innerText()).trim();
    expect(code).toMatch(/^CF-\d{4}-\d{6}$/);
    applicationUrl = new URL(operator.url()).pathname;
  });

  await test.step('3. operator attaches documents and submits', async () => {
    // Without documents the submission is refused with an explanation.
    await operator.getByRole('button', { name: 'Enviar para análise' }).click();
    const dialog = operator.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Confirmar' }).click();
    await expect(dialog.getByText('Documentos obrigatórios ausentes')).toBeVisible();
    await dialog.getByRole('button', { name: 'Voltar' }).click();

    await attachDocument(operator, 'Documento de identificação', 'rg-e2e.pdf');
    await attachDocument(operator, 'Comprovante de renda/faturamento', 'renda-e2e.pdf');
    await confirmAction(operator, 'Enviar para análise');
    await expect(operator.getByText('Aguardando análise', { exact: true })).toBeVisible();
    await expect(operator.getByRole('link', { name: /Editar dados/ })).toHaveCount(0);
  });

  await test.step('4. analyst takes the application and validates documents', async () => {
    await analyst.goto(applicationUrl);
    await confirmAction(analyst, 'Assumir análise');
    await expect(analyst.getByText('Em análise', { exact: true })).toBeVisible();
    await analyst.getByRole('button', { name: 'Aceitar rg-e2e.pdf' }).click();
    await analyst.getByRole('button', { name: 'Aceitar renda-e2e.pdf' }).click();
    await expect(analyst.getByText('Aceito', { exact: true })).toHaveCount(2);
  });

  await test.step('5. analyst records an issue; operator complements and sends it back', async () => {
    await analyst.getByRole('tab', { name: /Análise/ }).click();
    await analyst.getByLabel('Nova pendência').fill('Enviar extrato bancario dos ultimos 3 meses.');
    await analyst.getByRole('button', { name: 'Registrar pendência' }).click();
    await expect(analyst.getByText('Aberta', { exact: true })).toBeVisible();
    await confirmAction(analyst, 'Solicitar informações');
    await expect(analyst.getByText('Pendente de informação', { exact: true })).toBeVisible();

    await operator.reload();
    await expect(operator.getByText('Pendências registradas pelo analista')).toBeVisible();
    await attachDocument(operator, 'Extrato/documento financeiro', 'extrato-e2e.pdf');
    await confirmAction(operator, 'Devolver para análise');
    await expect(operator.getByText('Em análise', { exact: true })).toBeVisible();
  });

  await test.step('6. analyst resolves the issue and records a review', async () => {
    await analyst.reload();
    await analyst.getByRole('button', { name: 'Marcar como resolvida' }).click();
    const dialog = analyst.getByRole('dialog');
    await dialog.getByLabel('Resolução').fill('Extrato recebido e conferido.');
    await dialog.getByRole('button', { name: 'Confirmar' }).click();
    await expect(analyst.getByText('Resolvida', { exact: true })).toBeVisible();

    await analyst.getByLabel('Recomendação').selectOption('APPROVE');
    await analyst
      .getByLabel('Observações da análise')
      .fill('Documentos aceitos e coerentes com os valores declarados.');
    await analyst
      .getByLabel('Justificativa')
      .fill('Renda comprovada; comprometimento compativel com o prazo.');
    await analyst.getByRole('button', { name: 'Registrar parecer' }).click();
    await expect(analyst.getByText('Vigente', { exact: true })).toBeVisible();
  });

  await test.step('7. the analyst records the human decision', async () => {
    await analyst.getByRole('button', { name: 'Registrar decisão' }).click();
    const dialog = analyst.getByRole('dialog');
    // Nothing is sent until outcome, justification and explicit confirmation are given.
    await dialog.getByRole('button', { name: 'Registrar decisão' }).click();
    await expect(dialog.getByText('Confirme que a decisão é sua')).toBeVisible();
    await dialog.getByRole('radio', { name: 'Aprovar' }).check();
    await dialog
      .getByLabel('Justificativa')
      .fill('Aprovado conforme parecer vigente e documentos aceitos.');
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Registrar decisão' }).click();
    await expect(dialog).toBeHidden();
    await expect(analyst.getByText('Aprovada', { exact: true }).first()).toBeVisible();
    await expect(
      analyst.getByText('Aprovado conforme parecer vigente e documentos aceitos.'),
    ).toBeVisible();
  });

  await test.step('8. history and audit trail record the actions', async () => {
    await analyst.getByRole('tab', { name: 'Histórico' }).click();
    for (const status of ['Rascunho', 'Aguardando análise', 'Pendente de informação', 'Aprovada']) {
      await expect(
        analyst.getByRole('tabpanel').getByText(status, { exact: true }).first(),
      ).toBeVisible();
    }

    const admin = await signIn(
      browser,
      DEMO_USERS.admin,
      '/admin/auditoria?action=decision.recorded',
    );
    const firstRow = admin.getByRole('row').nth(1);
    await expect(firstRow).toContainText('Decisão registrada');
    await expect(firstRow.getByRole('link')).toHaveAttribute(
      'href',
      `${applicationUrl}?aba=analise`,
    );
    await admin.context().close();
  });

  await test.step('9. the dashboard reflects the new approval', async () => {
    await analyst.goto('/');
    await expect.poll(() => statTile(analyst, 'Aprovadas')).toBe(approvedBefore + 1);
  });

  await operator.context().close();
  await analyst.context().close();
});

test('permissions are enforced by the backend, not only hidden in the UI', async ({ browser }) => {
  const operator = await signIn(browser, DEMO_USERS.operator);
  await operator.goto('/admin/usuarios');
  await expect(operator.getByRole('heading', { name: 'Acesso negado' })).toBeVisible();

  // Same session cookie, straight to the API: still refused.
  const users = await operator.request.get('/api/v1/users');
  expect(users.status()).toBe(403);
  const decision = await operator.request.post(
    '/api/v1/applications/00000000-0000-4000-8000-000000000000/decision',
    {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      data: { outcome: 'APPROVED', justification: 'Tentativa sem permissao de decisao.' },
    },
  );
  expect(decision.status()).toBe(403);

  // A state-changing request without the CSRF header is rejected even when authenticated.
  const csrf = await operator.request.post('/api/v1/auth/logout');
  expect(csrf.status()).toBe(403);

  await operator.context().close();
});
