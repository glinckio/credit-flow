import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

type CustomerWriter = Pick<Prisma.TransactionClient, 'customer'>;

export const customerInclude = {
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.CustomerInclude;

export type CustomerWithRefs = Prisma.CustomerGetPayload<{ include: typeof customerInclude }>;

/** Thin data-access layer for customers (plan, D4). No business rules here. */
@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(params: {
    where: Prisma.CustomerWhereInput;
    orderBy: Prisma.CustomerOrderByWithRelationInput;
    skip: number;
    take: number;
  }): Promise<[CustomerWithRefs[], number]> {
    return this.prisma.$transaction([
      this.prisma.customer.findMany({ ...params, include: customerInclude }),
      this.prisma.customer.count({ where: params.where }),
    ]);
  }

  findById(id: string, writer: CustomerWriter = this.prisma): Promise<CustomerWithRefs | null> {
    return writer.customer.findUnique({ where: { id }, include: customerInclude });
  }

  findByDocument(documentNumber: string): Promise<{ id: string } | null> {
    return this.prisma.customer.findUnique({ where: { documentNumber }, select: { id: true } });
  }

  create(writer: CustomerWriter, data: Prisma.CustomerUncheckedCreateInput) {
    return writer.customer.create({ data, include: customerInclude });
  }

  /**
   * Optimistic-locking update: applies only if the stored version still equals
   * `expectedVersion`. Returns false when someone else changed it first.
   */
  async updateIfVersion(
    writer: CustomerWriter,
    id: string,
    expectedVersion: number,
    data: Prisma.CustomerUpdateManyMutationInput,
  ): Promise<boolean> {
    const { count } = await writer.customer.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    return count === 1;
  }
}
