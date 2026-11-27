import { type Browser, type Page, expect } from '@playwright/test';
import { E2E_PASSWORD } from './env.js';

/** Opens a fresh browser context (separate cookies = separate person) and signs in. */
export async function signIn(browser: Browser, email: string, path = '/'): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByTestId('current-user-name')).toBeVisible();
  return page;
}

/** Clicks an action button and confirms the dialog that follows. */
export async function confirmAction(page: Page, action: string, reason?: string) {
  await page.getByRole('button', { name: action, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  if (reason) await dialog.getByRole('textbox').fill(reason);
  await dialog.getByRole('button', { name: 'Confirmar' }).click();
  await expect(dialog).toBeHidden();
}

/** Minimal synthetic PDF (valid magic bytes) — never a real document. */
export function syntheticPdf(label: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% DOCUMENTO SINTETICO E2E - ${label}\n%%EOF\n`, 'latin1');
}

export async function attachDocument(
  page: Page,
  typeLabel: string,
  fileName: string,
  bytes: Buffer = syntheticPdf(fileName),
) {
  const form = page.locator('form', { hasText: 'Anexar documento' });
  await form.getByLabel('Tipo').selectOption({ label: typeLabel });
  await form.getByLabel('Arquivo').setInputFiles({
    name: fileName,
    mimeType: 'application/pdf',
    buffer: bytes,
  });
  await form.getByRole('button', { name: 'Anexar' }).click();
  await expect(page.getByText(fileName, { exact: true })).toBeVisible();
}

export async function statTile(page: Page, label: string): Promise<number> {
  const text = await page.getByTestId(`tile-${label}`).innerText();
  return Number(text.replace(/\D/g, ''));
}
