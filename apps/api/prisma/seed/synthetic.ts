/**
 * Synthetic data helpers for the demo seed. Everything produced here is
 * fictitious: identifiers are random numbers that merely satisfy the check-digit
 * algorithm, e-mails use the reserved `.test` TLD and phone numbers use a fixed
 * fictitious prefix.
 */
import { createHash } from 'node:crypto';
import { cnpjCheckDigits, cpfCheckDigits } from '@creditflow/shared';

export type RandomInt = (min: number, max: number) => number;

function randomDigits(count: number, randomInt: RandomInt): string {
  let out = '';
  for (let i = 0; i < count; i++) out += String(randomInt(0, 9));
  return out;
}

export function syntheticCpf(randomInt: RandomInt): string {
  let base: string;
  do base = randomDigits(9, randomInt);
  while (/^(\d)\1*$/.test(base));
  return cpfCheckDigits(base);
}

export function syntheticCnpj(randomInt: RandomInt): string {
  let base: string;
  // Branch "0001" (headquarters), as most real CNPJs use; the root is random.
  do base = `${randomDigits(8, randomInt)}0001`;
  while (/^(\d)\1{7}/.test(base));
  return cnpjCheckDigits(base);
}

/** Fictitious phone in the (11) 90000-xxxx range. */
export function syntheticPhone(index: number): string {
  return `+55 11 90000-${String(index).padStart(4, '0')}`;
}

export function syntheticEmail(localPart: string): string {
  const slug = localPart
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
  return `${slug}@exemplo.test`;
}

/** Escapes text for a PDF literal string and keeps it ASCII-only. */
function pdfText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/([\\()])/g, '\\$1');
}

/**
 * Builds a minimal, valid single-page PDF (PDF 1.4, Helvetica) containing the
 * given lines. Pure bytes: no external tooling, nothing executable.
 */
export function buildSyntheticPdf(lines: readonly string[]): Buffer {
  const content = [
    'BT',
    '/F1 12 Tf',
    '14 TL',
    '72 770 Td',
    ...lines.map((line) => `(${pdfText(line)}) '`),
    'ET',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
