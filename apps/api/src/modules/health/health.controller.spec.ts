import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  async function build(queryRaw: () => Promise<unknown>) {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: { $queryRaw: queryRaw } }],
    }).compile();
    return moduleRef.get(HealthController);
  }

  it('reports ok when the database answers', async () => {
    const controller = await build(async () => [{ result: 1 }]);
    await expect(controller.check()).resolves.toMatchObject({
      status: 'ok',
      service: 'CreditFlow',
      database: 'up',
    });
  });

  it('returns 503 when the database is unreachable', async () => {
    const controller = await build(async () => {
      throw new Error('connection refused');
    });
    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
