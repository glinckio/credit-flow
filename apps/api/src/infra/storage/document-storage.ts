import type { Readable } from 'node:stream';

/**
 * Port for document storage (plan, D15). The domain only knows opaque keys;
 * swapping the local filesystem for S3/MinIO later means a new adapter, not a
 * change in the documents module.
 */
export abstract class DocumentStorage {
  /** Stores bytes under a new opaque key and returns it. */
  abstract put(data: Buffer): Promise<string>;
  /** Opens a read stream; throws if the key does not exist. */
  abstract open(key: string): Promise<Readable>;
  /** Physically removes an object (used only for compensation and anonymization). */
  abstract remove(key: string): Promise<void>;
}

/** Keys always look like `documents/<uuid>`: no user input ever reaches a path. */
export const STORAGE_KEY =
  /^documents\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
