import { Prisma } from '../../generated/prisma/client.js';
import { runWithRequestContext } from '../../common/request-context.js';
import { AuditService, sanitizeForAudit } from './audit.service.js';

describe('sanitizeForAudit', () => {
  it('drops secret-looking keys at any depth', () => {
    expect(
      sanitizeForAudit({
        email: 'a@exemplo.test',
        passwordHash: 'x',
        nested: { newPassword: 'y', sessionToken: 'z', role: 'ADMIN' },
        list: [{ apiSecret: 's', ok: 1 }],
      }),
    ).toEqual({ email: 'a@exemplo.test', nested: { role: 'ADMIN' }, list: [{ ok: 1 }] });
  });

  it('serialises dates, decimals and bigints as strings', () => {
    expect(
      sanitizeForAudit({
        at: new Date('2026-01-02T03:04:05.000Z'),
        amount: new Prisma.Decimal('1234.50'),
        id: 10n,
      }),
    ).toEqual({ at: '2026-01-02T03:04:05.000Z', amount: '1234.5', id: '10' });
  });
});

describe('AuditService', () => {
  it('writes through the given transaction and attaches the request context', async () => {
    const create = vi.fn().mockResolvedValue({});
    const service = new AuditService();

    await runWithRequestContext({ requestId: 'req-12345678', ip: '127.0.0.1' }, () =>
      service.record({ auditEvent: { create } } as never, {
        actorId: 'u1',
        action: 'user.created',
        entityType: 'User',
        entityId: 'u2',
        after: { email: 'b@exemplo.test', passwordHash: 'never' },
      }),
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'u1',
        action: 'user.created',
        after: { email: 'b@exemplo.test' },
        metadata: { requestId: 'req-12345678', ip: '127.0.0.1' },
      }),
    });
  });
});
