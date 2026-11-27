import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `<repo>/var/evals` — gitignored, outside any public folder. */
export const EVALS_OUTPUT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../var/evals',
);
