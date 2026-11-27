import type { DocumentTextReader } from '../../src/modules/ai-analysis/ai-analysis.tokens.js';

/**
 * Test-only text reader for the PDFs written by `buildSyntheticPdfPages`
 * (one content stream per page, lines as `(text) '`). Stands in for the real
 * PDF library until stage B3. Never use it for arbitrary PDFs.
 */
export class SyntheticPdfTextReader implements DocumentTextReader {
  async readPages(bytes: Buffer, mimeType: string): Promise<string[] | null> {
    if (mimeType !== 'application/pdf') return null;
    const pdf = bytes.toString('latin1');
    const pages = [...pdf.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) =>
      [...(m[1] ?? '').matchAll(/\(((?:\\.|[^\\)])*)\) '/g)]
        .map((l) => (l[1] ?? '').replace(/\\([\\()])/g, '$1'))
        .join('\n'),
    );
    return pages.length ? pages : null;
  }

  async countPages(bytes: Buffer, mimeType: string): Promise<number | null> {
    if (mimeType !== 'application/pdf') return 1;
    return (await this.readPages(bytes, mimeType))?.length ?? null;
  }
}
