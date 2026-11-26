import { Injectable } from '@nestjs/common';
import {
  type BirthOrFoundationDateError,
  CustomerType,
  MIN_CUSTOMER_AGE,
  checkBirthOrFoundationDate,
  isValidDocumentForType,
  onlyDigits,
} from '@creditflow/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { Problems, fieldValidationError } from '../../common/http/app-exception.js';
import { type Page, page, parseSort, toSkipTake } from '../../common/pagination.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth-user.js';
import type {
  AddressDto,
  CreateCustomerDto,
  CustomerDto,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from './customers.dto.js';
import { type CustomerWithRefs, CustomersRepository } from './customers.repository.js';

const SORTABLE = ['name', 'createdAt', 'updatedAt'] as const;

/** Fields whose changes are recorded (with values) in the audit trail. */
const AUDITED_FIELDS = [
  'name',
  'email',
  'phone',
  'birthOrFoundationDate',
  'address',
  'status',
] as const;

const DATE_MESSAGES: Record<BirthOrFoundationDateError, string> = {
  invalid: 'Data inválida',
  future: 'A data não pode estar no futuro',
  underage: `Pessoa física deve ter ao menos ${MIN_CUSTOMER_AGE} anos`,
};

const toDateOnly = (d: Date) => d.toISOString().slice(0, 10);

export function toCustomerDto(c: CustomerWithRefs): CustomerDto {
  return {
    id: c.id,
    type: c.type,
    name: c.name,
    documentNumber: c.documentNumber,
    email: c.email,
    phone: c.phone,
    birthOrFoundationDate: toDateOnly(c.birthOrFoundationDate),
    address: {
      street: c.addressStreet,
      number: c.addressNumber,
      complement: c.addressComplement,
      district: c.addressDistrict,
      city: c.addressCity,
      state: c.addressState,
      zipCode: c.addressZipCode,
    },
    status: c.status,
    version: c.version,
    createdBy: c.createdBy,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function addressColumns(a: AddressDto) {
  return {
    addressStreet: a.street,
    addressNumber: a.number,
    addressComplement: a.complement ?? null,
    addressDistrict: a.district,
    addressCity: a.city,
    addressState: a.state,
    addressZipCode: a.zipCode,
  };
}

/**
 * Only the fields that actually changed, with before/after values. Avoids
 * copying the whole customer record into the audit trail on every edit.
 */
function diff(before: CustomerDto, after: CustomerDto) {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  for (const field of AUDITED_FIELDS) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
      changedBefore[field] = before[field];
      changedAfter[field] = after[field];
    }
  }
  return { before: changedBefore, after: changedAfter };
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersRepository,
    private readonly audit: AuditService,
  ) {}

  async list(q: ListCustomersQueryDto): Promise<Page<CustomerDto>> {
    const where: Prisma.CustomerWhereInput = {
      ...(q.type ? { type: q.type } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    if (q.q) {
      const digits = onlyDigits(q.q);
      // Mostly-numeric search terms are treated as CPF/CNPJ prefixes.
      where.OR =
        digits.length >= 3 && digits.length >= q.q.replace(/[\s.\-/]/g, '').length
          ? [{ documentNumber: { startsWith: digits } }]
          : [{ name: { contains: q.q, mode: 'insensitive' } }];
    }
    const [rows, total] = await this.customers.list({
      where,
      orderBy: parseSort(q.sort, SORTABLE, { field: 'name', direction: 'asc' }),
      ...toSkipTake(q),
    });
    return page(rows.map(toCustomerDto), total, q);
  }

  async get(id: string): Promise<CustomerDto> {
    return toCustomerDto(await this.getOrThrow(id));
  }

  async create(actor: AuthUser, dto: CreateCustomerDto): Promise<CustomerDto> {
    if (!isValidDocumentForType(dto.type, dto.documentNumber)) {
      throw fieldValidationError(
        'documentNumber',
        dto.type === CustomerType.INDIVIDUAL ? 'CPF inválido' : 'CNPJ inválido',
      );
    }
    this.assertDate(dto.type, dto.birthOrFoundationDate);
    await this.assertDocumentAvailable(dto.documentNumber);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await this.customers.create(tx, {
          type: dto.type,
          name: dto.name,
          documentNumber: dto.documentNumber,
          email: dto.email,
          phone: dto.phone,
          birthOrFoundationDate: new Date(`${dto.birthOrFoundationDate}T00:00:00.000Z`),
          ...addressColumns(dto.address),
          createdById: actor.id,
        });
        // The record itself holds the personal data; the audit only notes the creation.
        await this.audit.record(tx, {
          actorId: actor.id,
          action: 'customer.created',
          entityType: 'Customer',
          entityId: created.id,
          after: { type: created.type, status: created.status },
        });
        return toCustomerDto(created);
      });
    } catch (err) {
      // Race: another request created the same document between the check and the insert.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        await this.assertDocumentAvailable(dto.documentNumber);
      }
      throw err;
    }
  }

  async update(actor: AuthUser, id: string, dto: UpdateCustomerDto): Promise<CustomerDto> {
    const current = await this.getOrThrow(id);
    const { version: _version, ...fields } = dto;
    if (Object.values(fields).every((v) => v === undefined)) {
      // Nothing to change: do not bump the version, but still honour the lock.
      if (current.version !== dto.version) throw Problems.versionConflict();
      return toCustomerDto(current);
    }
    if (dto.birthOrFoundationDate !== undefined) {
      this.assertDate(current.type, dto.birthOrFoundationDate);
    }

    return this.prisma.$transaction(async (tx) => {
      const applied = await this.customers.updateIfVersion(tx, id, dto.version, {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        status: dto.status,
        ...(dto.birthOrFoundationDate !== undefined
          ? { birthOrFoundationDate: new Date(`${dto.birthOrFoundationDate}T00:00:00.000Z`) }
          : {}),
        ...(dto.address ? addressColumns(dto.address) : {}),
      });
      if (!applied) throw Problems.versionConflict();

      const updated = toCustomerDto((await this.customers.findById(id, tx))!);
      const changes = diff(toCustomerDto(current), updated);
      if (Object.keys(changes.after).length > 0) {
        await this.audit.record(tx, {
          actorId: actor.id,
          action: 'customer.updated',
          entityType: 'Customer',
          entityId: id,
          before: changes.before,
          after: changes.after,
        });
      }
      return updated;
    });
  }

  /** Used by other modules (e.g. applications) through the exported service. */
  async getOrThrow(id: string): Promise<CustomerWithRefs> {
    const customer = await this.customers.findById(id);
    if (!customer) throw Problems.notFound('Cliente');
    return customer;
  }

  private assertDate(type: CustomerType, value: string): void {
    const error = checkBirthOrFoundationDate(type, value);
    if (error) throw fieldValidationError('birthOrFoundationDate', DATE_MESSAGES[error]);
  }

  private async assertDocumentAvailable(documentNumber: string): Promise<void> {
    const existing = await this.customers.findByDocument(documentNumber);
    if (existing) {
      throw Problems.conflict(
        'customer-document-already-exists',
        'Já existe um cliente com este CPF/CNPJ',
        'Abra o cadastro existente em vez de criar outro.',
        { existingCustomerId: existing.id },
      );
    }
  }
}
