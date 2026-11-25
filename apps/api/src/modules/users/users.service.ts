import { Injectable } from '@nestjs/common';
import { Role, canReceiveDecideGrant } from '@creditflow/shared';
import { Prisma, type User } from '../../generated/prisma/client.js';
import { Problems } from '../../common/http/app-exception.js';
import { type Page, page, parseSort, toSkipTake } from '../../common/pagination.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { hashPassword } from '../../infra/security/password.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth-user.js';
import { SessionService } from '../auth/session.service.js';
import type {
  CreateUserDto,
  ListUsersQueryDto,
  ResetPasswordDto,
  UpdateUserDto,
  UserDto,
} from './users.dto.js';
import { UsersRepository } from './users.repository.js';

const SORTABLE = ['name', 'email', 'role', 'createdAt', 'lastLoginAt'] as const;

/** Public shape of a user. The password hash never leaves this module. */
export function toUserDto(u: User): UserDto {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    canDecide: u.canDecide,
    mustChangePassword: u.mustChangePassword,
    active: u.active,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

/** Allow-listed fields recorded in the audit trail. */
function auditSnapshot(u: User) {
  return {
    email: u.email,
    name: u.name,
    role: u.role,
    canDecide: u.canDecide,
    mustChangePassword: u.mustChangePassword,
    active: u.active,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersRepository,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async list(q: ListUsersQueryDto): Promise<Page<UserDto>> {
    const where: Prisma.UserWhereInput = {
      ...(q.role ? { role: q.role } : {}),
      ...(q.active !== undefined ? { active: q.active } : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { email: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.users.list({
      where,
      orderBy: parseSort(q.sort, SORTABLE, { field: 'name', direction: 'asc' }),
      ...toSkipTake(q),
    });
    return page(rows.map(toUserDto), total, q);
  }

  async get(id: string): Promise<UserDto> {
    return toUserDto(await this.getOrThrow(id));
  }

  async create(actor: AuthUser, dto: CreateUserDto): Promise<UserDto> {
    const canDecide = dto.canDecide ?? false;
    this.assertDecideGrant(dto.role, canDecide);
    const passwordHash = await hashPassword(dto.initialPassword);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await this.users.create(tx, {
          email: dto.email,
          name: dto.name,
          role: dto.role,
          canDecide,
          passwordHash,
          mustChangePassword: true,
        });
        await this.audit.record(tx, {
          actorId: actor.id,
          action: 'user.created',
          entityType: 'User',
          entityId: user.id,
          after: auditSnapshot(user),
        });
        return toUserDto(user);
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Problems.conflict('email-already-used', 'Já existe um usuário com este e-mail');
      }
      throw err;
    }
  }

  async update(actor: AuthUser, id: string, dto: UpdateUserDto): Promise<UserDto> {
    const current = await this.getOrThrow(id);
    if (actor.id === id && dto.role !== undefined && dto.role !== current.role) {
      throw Problems.businessRule(
        'cannot-change-own-role',
        'Você não pode alterar o próprio papel',
        'Peça a outro administrador.',
      );
    }
    const role = dto.role ?? current.role;
    // Leaving the OPERATOR role drops the decide grant.
    const canDecide = canReceiveDecideGrant(role) ? (dto.canDecide ?? current.canDecide) : false;
    if (dto.canDecide === true) this.assertDecideGrant(role, true);

    return this.prisma.$transaction(async (tx) => {
      const updated = await this.users.update(tx, id, { name: dto.name, role, canDecide });
      await this.audit.record(tx, {
        actorId: actor.id,
        action: 'user.updated',
        entityType: 'User',
        entityId: id,
        before: auditSnapshot(current),
        after: auditSnapshot(updated),
      });
      return toUserDto(updated);
    });
  }

  async deactivate(actor: AuthUser, id: string): Promise<UserDto> {
    if (actor.id === id) {
      throw Problems.businessRule('cannot-deactivate-self', 'Você não pode desativar a si mesmo');
    }
    const current = await this.getOrThrow(id);
    if (!current.active) return toUserDto(current);

    return this.prisma.$transaction(async (tx) => {
      const updated = await this.users.update(tx, id, { active: false });
      const revoked = await this.sessions.revokeAllForUser(tx, id);
      await this.audit.record(tx, {
        actorId: actor.id,
        action: 'user.deactivated',
        entityType: 'User',
        entityId: id,
        before: { active: true },
        after: { active: false },
        metadata: { sessionsRevoked: revoked },
      });
      return toUserDto(updated);
    });
  }

  async activate(actor: AuthUser, id: string): Promise<UserDto> {
    const current = await this.getOrThrow(id);
    if (current.active) return toUserDto(current);

    return this.prisma.$transaction(async (tx) => {
      const updated = await this.users.update(tx, id, { active: true });
      await this.audit.record(tx, {
        actorId: actor.id,
        action: 'user.activated',
        entityType: 'User',
        entityId: id,
        before: { active: false },
        after: { active: true },
      });
      return toUserDto(updated);
    });
  }

  /** Sets a temporary password, forces a change on next login and ends every session. */
  async resetPassword(actor: AuthUser, id: string, dto: ResetPasswordDto): Promise<UserDto> {
    await this.getOrThrow(id);
    const passwordHash = await hashPassword(dto.temporaryPassword);

    return this.prisma.$transaction(async (tx) => {
      const updated = await this.users.update(tx, id, { passwordHash, mustChangePassword: true });
      const revoked = await this.sessions.revokeAllForUser(tx, id);
      await this.audit.record(tx, {
        actorId: actor.id,
        action: 'user.password_reset',
        entityType: 'User',
        entityId: id,
        after: { mustChangePassword: true },
        metadata: { sessionsRevoked: revoked },
      });
      return toUserDto(updated);
    });
  }

  private async getOrThrow(id: string): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) throw Problems.notFound('Usuário');
    return user;
  }

  private assertDecideGrant(role: Role, canDecide: boolean): void {
    if (canDecide && !canReceiveDecideGrant(role)) {
      throw Problems.businessRule(
        'decide-grant-not-allowed',
        'Permissão de decisão só pode ser concedida a operadores',
        role === Role.ANALYST
          ? 'Analistas já podem registrar decisões.'
          : 'Administradores não registram decisões de crédito (segregação de funções).',
      );
    }
  }
}
