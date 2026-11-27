import { buildSyntheticPdfPages, pdfVisibleText } from '../../../../prisma/seed/synthetic.js';
import { PdfJsTextReader } from './pdfjs-text-reader.js';

const reader = new PdfJsTextReader();

describe('PdfJsTextReader', () => {
  it('returns the text layer of each page, matching what the synthetic generator printed', async () => {
    const lines = ['HOLERITE (FICTICIO)', 'Liquido a receber: R$ 4.100,00', 'Nome: João (teste)'];
    const pdf = buildSyntheticPdfPages([
      { lines },
      { scan: true, variant: 1 },
      { lines: ['Pagina 3'] },
    ]);
    const pages = await reader.readPages(pdf, 'application/pdf');
    expect(pages).toHaveLength(3);
    const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
    expect(collapse(pages![0]!)).toBe(collapse(lines.map(pdfVisibleText).join('\n')));
    expect(pages![1]!.trim()).toBe('');
    expect(collapse(pages![2]!)).toBe('Pagina 3');
    expect(await reader.countPages(pdf)).toBe(3);
  });

  it('answers null for non-PDF, corrupt or oversized input (never throws)', async () => {
    expect(await reader.readPages(Buffer.from('x'), 'image/png')).toBeNull();
    expect(await reader.readPages(Buffer.from('%PDF-1.4 garbage'), 'application/pdf')).toBeNull();
    const big = buildSyntheticPdfPages([{ lines: ['a'] }, { lines: ['b'] }]);
    expect(await new PdfJsTextReader(1).readPages(big, 'application/pdf')).toBeNull();
  });
});
