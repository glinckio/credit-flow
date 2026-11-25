import { isAbsolute, resolve } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { DocumentStorage } from './document-storage.js';
import { LocalFsStorage } from './local-fs-storage.js';

/** Repository root (same depth from src/ and dist/). */
export const REPO_ROOT = resolve(import.meta.dirname, '../../../../..');

export function resolveStorageRoot(storageDir: string): string {
  return isAbsolute(storageDir) ? resolve(storageDir) : resolve(REPO_ROOT, storageDir);
}

@Global()
@Module({
  providers: [
    {
      provide: DocumentStorage,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new LocalFsStorage(resolveStorageRoot(config.get('STORAGE_DIR', { infer: true }))),
    },
  ],
  exports: [DocumentStorage],
})
export class StorageModule {}
