import type { DocumentExtractor } from './extraction/document-extractor.js';

/**
 * Injection tokens of the AI module. Provider value `null` for the extractor
 * means "AI disabled": nothing is queued and manual requests answer 503.
 */
export const DOCUMENT_EXTRACTOR = Symbol('DOCUMENT_EXTRACTOR');
export const DOCUMENT_TEXT_READER = Symbol('DOCUMENT_TEXT_READER');

export type OptionalDocumentExtractor = DocumentExtractor | null;

/**
 * Reads the text layer of a document, one string per page. `null` when the
 * document has no text layer (images) or cannot be read — evidence is then
 * UNVERIFIABLE, never assumed.
 */
export interface DocumentTextReader {
  readPages(bytes: Buffer, mimeType: string): Promise<string[] | null>;
}

/**
 * Conservative default until the PDF library arrives (stage B3): reports no
 * text layer, so no value can be verified — and therefore none is accepted.
 */
export class NoTextLayerReader implements DocumentTextReader {
  async readPages(): Promise<null> {
    return null;
  }
}
