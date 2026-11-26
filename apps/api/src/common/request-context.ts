import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request context available anywhere in the call chain (services, audit)
 * without threading it through every method signature.
 */
export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
