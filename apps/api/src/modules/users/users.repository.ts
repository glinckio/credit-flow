import { Injectable } from '@nestjs/common';
import type { Prisma, User } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

type UserWriter = Pick<Prisma.TransactionClient, 'user'>;

/** Thin data-access layer for users (plan, D4). No business rules here. */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: {
    where: Prisma.UserWhereInput;
    orderBy: Prisma.UserOrderByWithRelationInput;
    skip: number;
    take: number;
  }): Promise<[User[], number]> {
    return this.prisma.$transaction([
      this.prisma.user.findMany(params),
      this.prisma.user.count({ where: params.where }),
    ]);
  }

  findById(id: string, writer: UserWriter = this.prisma): Promise<User | null> {
    return writer.user.findUnique({ where: { id } });
  }

  create(writer: UserWriter, data: Prisma.UserCreateInput): Promise<User> {
    return writer.user.create({ data });
  }

  update(writer: UserWriter, id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return writer.user.update({ where: { id }, data });
  }
}
