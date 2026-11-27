import type { DocumentTextReader } from '../ai-analysis.tokens.js';

/**
 * Text layer of a PDF, one string per page, via Mozilla PDF.js (pdfjs-dist,
 * ADR-0011 stage B3). Text extraction only: nothing is rendered, no fonts are
 * loaded into the runtime, XFA and scripts are not executed. Untrusted input:
 * any parsing problem answers `null` (no text layer → evidence UNVERIFIABLE).
 *
 * Note: pdfjs-dist 6.x no longer exposes `isEvalSupported`; the hardening here
 * is to stay on the text path (`getTextContent`) and disable font faces.
 */
export class PdfJsTextReader implements DocumentTextReader {
  constructor(private readonly maxPages = 50) {}

  async readPages(bytes: Buffer, mimeType: string): Promise<string[] | null> {
    if (mimeType !== 'application/pdf') return null;
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({
      // Copy: PDF.js may transfer/detach the buffer it receives.
      data: new Uint8Array(bytes),
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: false,
      isOffscreenCanvasSupported: false,
      verbosity: 0,
    });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > this.maxPages) return null;
      const pages: string[] = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        let text = '';
        for (const item of content.items) {
          if (!('str' in item)) continue;
          text += item.str + (item.hasEOL ? '\n' : '');
        }
        pages.push(text);
        page.cleanup();
      }
      return pages;
    } catch {
      return null;
    } finally {
      await task.destroy();
    }
  }

  /** Number of pages (images: 1), or null when the file cannot be parsed. */
  async countPages(bytes: Buffer, mimeType = 'application/pdf'): Promise<number | null> {
    if (mimeType !== 'application/pdf') return 1;
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(bytes), disableFontFace: true, verbosity: 0 });
    try {
      return (await task.promise).numPages;
    } catch {
      return null;
    } finally {
      await task.destroy();
    }
  }
}
