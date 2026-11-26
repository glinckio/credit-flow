import { DiscoveryService, MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { ACCESS_METADATA } from '../../src/modules/auth/access.decorators.js';
import { type TestApp, createTestApp } from '../helpers/app.js';

/**
 * Guard rail for "permissions are verified in the backend" (roadmap §3):
 * every HTTP handler must declare @Public, @Authenticated or @RequirePermissions.
 * The AccessGuard already denies undeclared routes at runtime; this test makes
 * the omission fail CI instead of surfacing as a 403 in production.
 */
describe('route access declarations', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });

  it('every controller handler declares its access rule', () => {
    const discovery = new DiscoveryService(t.app.get(ModulesContainer));
    const scanner = new MetadataScanner();
    const reflector = t.app.get(Reflector);

    const undeclared: string[] = [];
    let handlers = 0;
    for (const wrapper of discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = proto[name] as (...args: unknown[]) => unknown;
        if (Reflect.getMetadata('path', handler) === undefined) continue; // not a route
        handlers += 1;
        const rule = reflector.getAllAndOverride(ACCESS_METADATA, [handler, metatype]);
        if (!rule) undeclared.push(`${metatype.name}.${name}`);
      }
    }

    expect(handlers).toBeGreaterThan(5);
    expect(undeclared).toEqual([]);
  });
});
