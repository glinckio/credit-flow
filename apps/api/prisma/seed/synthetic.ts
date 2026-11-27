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
  return pdfVisibleText(value).replace(/([\\()])/g, '\\$1');
}

/**
 * The text a PDF reader recovers from a line written by `buildSyntheticPdf`
 * (accents stripped, non-ASCII replaced). Used as the evaluation ground truth.
 */
export function pdfVisibleText(line: string): string {
  return line
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\x20-\x7e]/g, '?');
}

/**
 * One page of a synthetic PDF: text lines (with a text layer) or a "scan"
 * (only drawn shapes, no text layer — what a reader sees in a scanned paper).
 */
export type SyntheticPdfPage = { lines: readonly string[] } | { scan: true; variant?: number };

function pageContent(page: SyntheticPdfPage): string {
  if ('scan' in page) {
    // Grey bars that look like text lines but carry no text operators.
    // `variant` changes the bar widths so different scans have different bytes.
    const v = page.variant ?? 0;
    const bars = Array.from(
      { length: 12 },
      (_, i) => `72 ${760 - i * 22} ${300 + ((i * 37 + v * 53) % 200)} 9 re`,
    );
    return ['0.6 g', ...bars, 'f'].join('\n');
  }
  return [
    'BT',
    '/F1 12 Tf',
    '14 TL',
    '72 770 Td',
    ...page.lines.map((line) => `(${pdfText(line)}) '`),
    'ET',
  ].join('\n');
}

/**
 * Builds a minimal, valid single-page PDF (PDF 1.4, Helvetica) containing the
 * given lines. Pure bytes: no external tooling, nothing executable.
 */
export function buildSyntheticPdf(lines: readonly string[]): Buffer {
  return buildSyntheticPdfPages([{ lines }]);
}

/**
 * Multi-page variant. Object layout: 1 catalog, 2 pages, 3 first page,
 * 4 font, 5 first content, then (page, content) pairs — so a single page
 * produces exactly the bytes `buildSyntheticPdf` always produced.
 */
export function buildSyntheticPdfPages(pages: readonly SyntheticPdfPage[]): Buffer {
  if (pages.length === 0) throw new Error('A PDF needs at least one page');
  const pageObj = (contentRef: number) =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents ${contentRef} 0 R >>`;
  const stream = (content: string) =>
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;

  const [first, ...rest] = pages.map(pageContent);
  const pageRefs = [3, ...rest.map((_, i) => 6 + i * 2)];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    pageObj(5),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream(first ?? ''),
    ...rest.flatMap((content, i) => [pageObj(7 + i * 2), stream(content)]),
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
