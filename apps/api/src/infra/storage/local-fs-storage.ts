import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { DocumentStorage, STORAGE_KEY } from './document-storage.js';

/**
 * Local, isolated filesystem storage for development (plan, D15).
 *
 * - Root lives outside any public/static folder and is gitignored.
 * - Files are named by random UUID, with no extension, and never served by
 *   path: the only way out is the authorised download endpoint.
 * - Writes are atomic (temp file + rename), so a crash never leaves a partial
 *   document under a valid key.
 */
export class LocalFsStorage extends DocumentStorage {
  constructor(private readonly root: string) {
    super();
  }

  async put(data: Buffer): Promise<string> {
    const key = `documents/${randomUUID()}`;
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, data, { flag: 'wx', mode: 0o600 });
    await rename(tmp, target);
    return key;
  }

  async open(key: string): Promise<Readable> {
    const path = this.pathFor(key);
    await stat(path); // fail fast with ENOENT before streaming headers
    return createReadStream(path);
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  /** Maps a key to a path, refusing anything that is not a well-formed key inside the root. */
  private pathFor(key: string): string {
    if (!STORAGE_KEY.test(key)) throw new Error('Invalid storage key');
    const path = resolve(join(this.root, key));
    const rel = relative(this.root, path);
    if (rel.startsWith('..') || rel.split(sep).includes('..')) {
      throw new Error('Storage key escapes the storage root');
    }
    return path;
  }
}
