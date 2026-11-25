import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { LocalFsStorage } from './local-fs-storage.js';

describe('LocalFsStorage', () => {
  let root: string;
  let storage: LocalFsStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cf-storage-'));
    storage = new LocalFsStorage(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores under an opaque documents/<uuid> key and reads it back', async () => {
    const key = await storage.put(Buffer.from('conteudo sintetico'));
    expect(key).toMatch(/^documents\/[0-9a-f-]{36}$/);
    expect(await text(await storage.open(key))).toBe('conteudo sintetico');
    // No temp files left behind, no extension on the stored file.
    expect(await readdir(join(root, 'documents'))).toEqual([key.split('/')[1]]);
  });

  it('refuses keys that are not well-formed (no path traversal)', async () => {
    for (const key of ['../etc/passwd', 'documents/../../x', 'documents/abc', '/abs/path']) {
      await expect(storage.open(key)).rejects.toThrow(/Invalid storage key/);
      await expect(storage.remove(key)).rejects.toThrow(/Invalid storage key/);
    }
  });

  it('fails clearly for a missing object and removes idempotently', async () => {
    const key = await storage.put(Buffer.from('x'));
    await storage.remove(key);
    await expect(storage.open(key)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(storage.remove(key)).resolves.toBeUndefined();
  });
});
