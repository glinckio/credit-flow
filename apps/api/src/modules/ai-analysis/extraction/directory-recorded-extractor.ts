import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  DocumentExtractor,
  ExtractionRequest,
  ExtractorResult,
} from './document-extractor.js';
import { RECORDED_MODEL, RecordedExtractor, type RecordedResponse } from './recorded-extractor.js';

/**
 * AI_PROVIDER=recorded (E2E only; refused in production by the env check).
 * Looks up `<dir>/<sha256>.json` at call time, so a test can record the
 * answer for a document it builds just before uploading it. No network, no
 * cost. A document without a recording counts as provider unavailable: the
 * run shows it as "não analisado", exactly like a real outage.
 */
export class DirectoryRecordedExtractor implements DocumentExtractor {
  readonly model = RECORDED_MODEL;
  readonly promptVersion = 'none';

  constructor(private readonly dir: string) {}

  async extract(request: ExtractionRequest): Promise<ExtractorResult> {
    if (!/^[0-9a-f]{64}$/.test(request.sha256)) throw new Error('Invalid sha256');
    let recorded: RecordedResponse = { kind: 'error', code: 'UNAVAILABLE' };
    try {
      recorded = JSON.parse(
        await readFile(join(this.dir, `${request.sha256}.json`), 'utf8'),
      ) as RecordedResponse;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return new RecordedExtractor(new Map([[request.sha256, recorded]])).extract(request);
  }
}
