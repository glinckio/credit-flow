import { SHARED_ENUMS, cpfCheckDigits, cnpjCheckDigits } from '@creditflow/shared';
import { Prisma, type PrismaClient } from '../../src/generated/prisma/client.js';
import { createTestPrisma, resetDatabase } from '../helpers/database.js';

/**
 * Guards the database-level rules that Prisma does not model (CHECK
 * constraints, append-only triggers) and the enum contract with @creditflow/shared.
 */
describe('database schema (integration, real PostgreSQL)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function fixture() {
    const user = await prisma.user.create({
      data: {
        email: 'operador@creditflow.test',
        name: 'Operador',
        passwordHash: 'x',
        role: 'OPERATOR',
      },
    });
    const customer = await prisma.customer.create({
      data: {
        type: 'INDIVIDUAL',
        name: 'Cliente Sintetico',
        documentNumber: cpfCheckDigits('123456789'),
        email: 'cliente@exemplo.test',
        phone: '+55 11 90000-0001',
        birthOrFoundationDate: new Date('1990-01-01'),
        addressStreet: 'Rua Ficticia',
        addressNumber: '1',
        addressDistrict: 'Centro',
        addressCity: 'Cidade Demo',
        addressState: 'SP',
        addressZipCode: '01000000',
        createdById: user.id,
      },
    });
    const application = await prisma.creditApplication.create({
      data: {
        customerId: customer.id,
        productType: 'PERSONAL_LOAN',
        requestedAmount: new Prisma.Decimal('10000.00'),
        termMonths: 24,
        purpose: 'Teste',
        declaredMonthlyIncome: new Prisma.Decimal('5000.00'),
        createdById: user.id,
      },
    });
    return { user, customer, application };
  }

  it('keeps every Prisma enum identical to its @creditflow/shared counterpart', async () => {
    const rows = await prisma.$queryRaw<{ typname: string; enumlabel: string }[]>`
      SELECT t.typname, e.enumlabel FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid ORDER BY t.typname, e.enumsortorder`;
    const dbEnums = new Map<string, string[]>();
    for (const r of rows) dbEnums.set(r.typname, [...(dbEnums.get(r.typname) ?? []), r.enumlabel]);

    for (const [name, values] of Object.entries(SHARED_ENUMS)) {
      expect(dbEnums.get(name), `enum ${name}`).toEqual(Object.values(values));
    }
    expect([...dbEnums.keys()].sort()).toEqual(Object.keys(SHARED_ENUMS).sort());
  });

  it('assigns sequential application numbers', async () => {
    const { application } = await fixture();
    expect(application.number).toBe(1);
  });

  describe('CHECK constraints', () => {
    it('rejects a CNPJ-length document for an individual customer', async () => {
      const { user } = await fixture();
      await expect(
        prisma.customer.create({
          data: {
            type: 'INDIVIDUAL',
            name: 'X',
            documentNumber: cnpjCheckDigits('112223330001'),
            email: 'x@exemplo.test',
            phone: '0',
            birthOrFoundationDate: new Date('1990-01-01'),
            addressStreet: 'R',
            addressNumber: '1',
            addressDistrict: 'B',
            addressCity: 'C',
            addressState: 'SP',
            addressZipCode: '01000000',
            createdById: user.id,
          },
        }),
      ).rejects.toThrow(/customers_document_number_chk/);
    });

    it('rejects non-positive amounts and out-of-range terms', async () => {
      const { application } = await fixture();
      await expect(
        prisma.creditApplication.update({
          where: { id: application.id },
          data: { requestedAmount: new Prisma.Decimal('0') },
        }),
      ).rejects.toThrow(/credit_applications_amount_chk/);
      await expect(
        prisma.creditApplication.update({
          where: { id: application.id },
          data: { termMonths: 361 },
        }),
      ).rejects.toThrow(/credit_applications_term_chk/);
    });

    it('rejects upper-case e-mails for users (case-insensitive uniqueness)', async () => {
      await expect(
        prisma.user.create({
          data: { email: 'Admin@CreditFlow.test', name: 'A', passwordHash: 'x', role: 'ADMIN' },
        }),
      ).rejects.toThrow(/users_email_lowercase_chk/);
    });

    it('requires a resolver and timestamp for resolved issues', async () => {
      const { user, application } = await fixture();
      await expect(
        prisma.applicationIssue.create({
          data: {
            applicationId: application.id,
            description: 'Pendencia',
            status: 'RESOLVED',
            createdById: user.id,
          },
        }),
      ).rejects.toThrow(/application_issues_resolution_chk/);
    });
  });

  describe('uniqueness', () => {
    it('rejects duplicate customer document numbers', async () => {
      const { customer } = await fixture();
      const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = customer;
      await expect(
        prisma.customer.create({ data: { ...rest, email: 'outro@exemplo.test' } }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('allows at most one decision per application', async () => {
      const { user, application } = await fixture();
      const review = await prisma.creditReview.create({
        data: {
          applicationId: application.id,
          authorId: user.id,
          recommendation: 'APPROVE',
          analysisNotes: 'n',
          justification: 'j',
        },
      });
      const decision = {
        applicationId: application.id,
        outcome: 'APPROVED' as const,
        justification: 'Justificativa suficiente',
        decidedById: user.id,
        reviewId: review.id,
      };
      await prisma.creditDecision.create({ data: decision });
      await expect(prisma.creditDecision.create({ data: decision })).rejects.toMatchObject({
        code: 'P2002',
      });
    });
  });

  describe('append-only tables', () => {
    it.each(['audit_events', 'application_status_history', 'credit_reviews', 'credit_decisions'])(
      '%s rejects UPDATE and DELETE',
      async (table) => {
        const { user, application } = await fixture();
        await prisma.auditEvent.create({
          data: { action: 'test', entityType: 'T', entityId: '1', actorId: user.id },
        });
        await prisma.applicationStatusHistory.create({
          data: { applicationId: application.id, toStatus: 'DRAFT', actorId: user.id },
        });
        const review = await prisma.creditReview.create({
          data: {
            applicationId: application.id,
            authorId: user.id,
            recommendation: 'REJECT',
            analysisNotes: 'n',
            justification: 'j',
          },
        });
        await prisma.creditDecision.create({
          data: {
            applicationId: application.id,
            outcome: 'REJECTED',
            justification: 'Justificativa suficiente',
            decidedById: user.id,
            reviewId: review.id,
          },
        });

        await expect(prisma.$executeRawUnsafe(`UPDATE "${table}" SET "id" = "id"`)).rejects.toThrow(
          /append-only/,
        );
        await expect(prisma.$executeRawUnsafe(`DELETE FROM "${table}"`)).rejects.toThrow(
          /append-only/,
        );
      },
    );
  });
});
