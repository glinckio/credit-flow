import type { DocumentExtractor } from './extraction/document-extractor.js';
import type { NarrativeWriter } from './narrative/narrative-writer.js';

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
  /** Page count for the cost guard; images count as 1; null when unknown. */
  countPages(bytes: Buffer, mimeType: string): Promise<number | null>;
}

/** Narrative writer (ADR-0011, D8). `null` → the run stores narrative status DISABLED. */
export const NARRATIVE_WRITER = Symbol('NARRATIVE_WRITER');
export type OptionalNarrativeWriter = NarrativeWriter | null;
