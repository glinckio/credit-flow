/**
 * CreditFlow demo seed — 100% synthetic data.
 *
 *   pnpm db:reset   # drops the dev database, re-applies migrations, runs this seed
 *   pnpm db:seed    # runs this seed on an empty, migrated database
 *
 * - Deterministic: fixed faker seed and fixed reference date, so every run
 *   produces the same business data (only UUIDs differ).
 * - Demo user password comes from SEED_DEMO_PASSWORD; if unset, a random one
 *   is generated and printed once. No password is stored in the repository.
 * - Synthetic PDFs are written to STORAGE_DIR (default: <repo>/var/storage).
 */
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, join, parse, resolve } from 'node:path';
import { fakerPT_BR as faker } from '@faker-js/faker';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  ApplicationStatus,
  CreditProductType,
  CustomerStatus,
  CustomerType,
  DecisionOutcome,
  DocumentType,
  DocumentValidationStatus,
  IssueStatus,
  ReviewRecommendation,
  Role,
  formatApplicationCode,
} from '@creditflow/shared';
import { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import { PASSWORD_MIN_LENGTH, hashPassword } from '../../src/infra/security/password.js';
import {
  buildSyntheticPdf,
  sha256Hex,
  syntheticCnpj,
  syntheticCpf,
  syntheticEmail,
  syntheticPhone,
} from './synthetic.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const FAKER_SEED = 20261125;
/** All seeded timestamps are relative to this instant (deterministic data). */
const REFERENCE_DATE = new Date('2026-11-20T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ───────────────────────────── setup ─────────────────────────────

const rootEnv = join(REPO_ROOT, '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data with NODE_ENV=production.');
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set (see .env.example).');
  process.exit(1);
}

const storageDir = resolve(REPO_ROOT, process.env.STORAGE_DIR ?? 'var/storage');
if (storageDir === REPO_ROOT || storageDir === parse(storageDir).root) {
  console.error(`Unsafe STORAGE_DIR: ${storageDir}`);
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
faker.seed(FAKER_SEED);
const randomInt = (min: number, max: number) => faker.number.int({ min, max });
const pick = <T>(items: readonly T[]): T => faker.helpers.arrayElement(items);

// ─────────────────────────── helpers ───────────────────────────

/** Moves forward in time while simulating one application's lifecycle. */
class Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(minHours: number, maxHours: number): Date {
    this.current = new Date(this.current.getTime() + randomInt(minHours, maxHours) * HOUR);
    return this.now();
  }
}

type Tx = Prisma.TransactionClient;

async function audit(
  tx: Tx,
  event: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    at: Date;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
  },
) {
  await tx.auditEvent.create({
    data: {
      actorId: event.actorId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      occurredAt: event.at,
      before: event.before,
      after: event.after,
      metadata: { source: 'seed' },
    },
  });
}

async function changeStatus(
  tx: Tx,
  app: { id: string; status: ApplicationStatus },
  to: ApplicationStatus,
  actorId: string,
  at: Date,
  reason?: string,
  extra: Prisma.CreditApplicationUpdateInput = {},
) {
  const from = app.status;
  await tx.creditApplication.update({
    where: { id: app.id },
    data: { status: to, updatedAt: at, version: { increment: 1 }, ...extra },
  });
  await tx.applicationStatusHistory.create({
    data: { applicationId: app.id, fromStatus: from, toStatus: to, actorId, reason, createdAt: at },
  });
  await audit(tx, {
    actorId,
    action: 'application.status_changed',
    entityType: 'CreditApplication',
    entityId: app.id,
    at,
    before: { status: from },
    after: { status: to, ...(reason ? { reason } : {}) },
  });
  app.status = to;
}

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  IDENTIFICATION: 'Documento de identificacao',
  PROOF_OF_ADDRESS: 'Comprovante de endereco',
  PROOF_OF_INCOME: 'Comprovante de renda/faturamento',
  BANK_STATEMENT: 'Extrato bancario',
  OTHER: 'Outro documento',
};

async function attachDocument(
  tx: Tx,
  input: {
    applicationId: string;
    applicationCode: string;
    customerName: string;
    type: DocumentType;
    uploadedById: string;
    at: Date;
  },
) {
  const bytes = buildSyntheticPdf([
    'DOCUMENTO SINTETICO - SOMENTE PARA DEMONSTRACAO',
    'Nao possui validade. Nao contem dados reais.',
    '',
    `Tipo: ${DOCUMENT_LABELS[input.type]}`,
    `Solicitacao: ${input.applicationCode}`,
    `Cliente (ficticio): ${input.customerName}`,
    `Gerado pelo seed do CreditFlow em ${REFERENCE_DATE.toISOString().slice(0, 10)}`,
  ]);
  const storageKey = `documents/${randomUUID()}`;
  const filePath = join(storageDir, storageKey);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);

  const doc = await tx.creditDocument.create({
    data: {
      applicationId: input.applicationId,
      type: input.type,
      originalName: `${input.type.toLowerCase()}-${input.applicationCode.toLowerCase()}.pdf`,
      storageKey,
      mimeType: 'application/pdf',
      sizeBytes: bytes.length,
      sha256: sha256Hex(bytes),
      uploadedById: input.uploadedById,
      uploadedAt: input.at,
    },
  });
  await audit(tx, {
    actorId: input.uploadedById,
    action: 'document.uploaded',
    entityType: 'CreditDocument',
    entityId: doc.id,
    at: input.at,
    after: {
      applicationId: input.applicationId,
      type: doc.type,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
    },
  });
  return doc;
}

const money = (value: number) => new Prisma.Decimal(value.toFixed(2));
const roundTo = (value: number, step: number) => Math.round(value / step) * step;

// ─────────────────────────── seed steps ───────────────────────────

async function seedUsers(password: string) {
  const passwordHash = await hashPassword(password);
  const created = REFERENCE_DATE.getTime() - 120 * DAY;
  const users = [
    {
      email: 'admin@creditflow.test',
      name: 'Ana Administradora',
      role: Role.ADMIN,
      canDecide: false,
    },
    {
      email: 'analista@creditflow.test',
      name: 'Bruno Analista',
      role: Role.ANALYST,
      canDecide: false,
    },
    {
      email: 'analista2@creditflow.test',
      name: 'Carla Analista',
      role: Role.ANALYST,
      canDecide: false,
    },
    {
      email: 'operador@creditflow.test',
      name: 'Diego Operador',
      role: Role.OPERATOR,
      canDecide: false,
    },
    {
      email: 'operador.decisor@creditflow.test',
      name: 'Elisa Operadora (com permissao de decisao)',
      role: Role.OPERATOR,
      canDecide: true,
    },
  ];
  const result = [];
  for (const [i, u] of users.entries()) {
    result.push(
      await prisma.user.create({
        data: { ...u, passwordHash, createdAt: new Date(created + i * HOUR) },
      }),
    );
  }
  const [admin, analyst1, analyst2, operator1, operator2] = result as [
    (typeof result)[0],
    (typeof result)[0],
    (typeof result)[0],
    (typeof result)[0],
    (typeof result)[0],
  ];
  for (const u of result) {
    await audit(prisma, {
      actorId: admin.id,
      action: 'user.created',
      entityType: 'User',
      entityId: u.id,
      at: u.createdAt,
      after: { email: u.email, role: u.role, canDecide: u.canDecide },
    });
  }
  return { admin, analysts: [analyst1, analyst2], operators: [operator1, operator2], all: result };
}

const UFS = ['SP', 'RJ', 'MG', 'RS', 'PR', 'SC', 'BA', 'PE', 'GO', 'DF'] as const;

async function seedCustomers(operatorIds: string[]) {
  const customers = [];
  const total = 20;
  for (let i = 0; i < total; i++) {
    const isCompany = i % 10 >= 7; // 14 individuals, 6 companies
    const createdAt = new Date(REFERENCE_DATE.getTime() - (100 - i * 2) * DAY);
    const name = isCompany
      ? `${faker.company.name()} (Demo)`
      : `${faker.person.firstName()} ${faker.person.lastName()} ${faker.person.lastName()}`;
    const birthOrFoundation = isCompany
      ? faker.date.between({ from: '1985-01-01', to: '2022-12-31' })
      : faker.date.birthdate({ mode: 'age', min: 21, max: 75, refDate: REFERENCE_DATE });
    const createdById = operatorIds[i % operatorIds.length]!;

    const customer = await prisma.customer.create({
      data: {
        type: isCompany ? CustomerType.COMPANY : CustomerType.INDIVIDUAL,
        name,
        documentNumber: isCompany ? syntheticCnpj(randomInt) : syntheticCpf(randomInt),
        email: syntheticEmail(`${name.split(' ').slice(0, 2).join(' ')} ${i + 1}`),
        phone: syntheticPhone(i + 1),
        birthOrFoundationDate: new Date(birthOrFoundation.toISOString().slice(0, 10)),
        addressStreet: faker.location.street(),
        addressNumber: String(randomInt(1, 3000)),
        addressComplement: i % 3 === 0 ? `Sala ${randomInt(1, 200)}` : null,
        addressDistrict: faker.location.county(),
        addressCity: faker.location.city(),
        addressState: pick(UFS),
        addressZipCode: String(randomInt(10_000_000, 99_999_999)),
        // The last customer is inactive and receives no applications.
        status: i === total - 1 ? CustomerStatus.INACTIVE : CustomerStatus.ACTIVE,
        createdById,
        createdAt,
      },
    });
    await audit(prisma, {
      actorId: createdById,
      action: 'customer.created',
      entityType: 'Customer',
      entityId: customer.id,
      at: createdAt,
      after: { type: customer.type, status: customer.status },
    });
    customers.push(customer);
  }
  return customers;
}

/** Target status for each of the 30 seeded applications (covers every state). */
const TARGETS: ApplicationStatus[] = [
  ...Array<ApplicationStatus>(3).fill(ApplicationStatus.DRAFT),
  ...Array<ApplicationStatus>(5).fill(ApplicationStatus.SUBMITTED),
  ...Array<ApplicationStatus>(5).fill(ApplicationStatus.UNDER_REVIEW),
  ...Array<ApplicationStatus>(4).fill(ApplicationStatus.PENDING_INFORMATION),
  ...Array<ApplicationStatus>(6).fill(ApplicationStatus.APPROVED),
  ...Array<ApplicationStatus>(4).fill(ApplicationStatus.REJECTED),
  ...Array<ApplicationStatus>(3).fill(ApplicationStatus.CANCELLED),
];

const PURPOSES_INDIVIDUAL = [
  'Reforma da residencia',
  'Quitacao de dividas com juros maiores',
  'Compra de veiculo usado',
  'Despesas com educacao',
  'Tratamento de saude',
];
const PURPOSES_COMPANY = [
  'Capital de giro para estoque sazonal',
  'Aquisicao de maquinario',
  'Expansao de unidade',
  'Renovacao de frota',
];

async function seedApplications(
  customers: Awaited<ReturnType<typeof seedCustomers>>,
  users: Awaited<ReturnType<typeof seedUsers>>,
) {
  const activeCustomers = customers.filter((c) => c.status === CustomerStatus.ACTIVE);
  const counts: Partial<Record<ApplicationStatus, number>> = {};

  for (const [i, target] of TARGETS.entries()) {
    const customer = activeCustomers[i % activeCustomers.length]!;
    const isCompany = customer.type === CustomerType.COMPANY;
    const operator = users.operators[i % 2]!;
    const analyst = users.analysts[i % 2]!;
    const clock = new Clock(new Date(REFERENCE_DATE.getTime() - (75 - i * 2) * DAY));

    const income = isCompany
      ? roundTo(randomInt(40_000, 600_000), 100)
      : roundTo(randomInt(2_500, 25_000), 50);
    const amount = isCompany
      ? roundTo(randomInt(50_000, 800_000), 1_000)
      : roundTo(randomInt(5_000, 80_000), 500);
    const commitments = i % 4 === 0 ? null : roundTo((income * randomInt(5, 40)) / 100, 10);

    await prisma.$transaction(
      async (tx) => {
        const createdAt = clock.now();
        const created = await tx.creditApplication.create({
          data: {
            customerId: customer.id,
            productType: isCompany
              ? pick([CreditProductType.WORKING_CAPITAL, CreditProductType.EQUIPMENT_FINANCING])
              : pick([
                  CreditProductType.PERSONAL_LOAN,
                  CreditProductType.PAYROLL_LOAN,
                  CreditProductType.VEHICLE_FINANCING,
                ]),
            requestedAmount: money(amount),
            termMonths: pick(isCompany ? [12, 18, 24, 36, 48, 60] : [12, 24, 36, 48, 60]),
            purpose: pick(isCompany ? PURPOSES_COMPANY : PURPOSES_INDIVIDUAL),
            declaredMonthlyIncome: money(income),
            declaredMonthlyCommitments: commitments === null ? null : money(commitments),
            createdById: operator.id,
            createdAt,
            updatedAt: createdAt,
          },
        });
        const app = { id: created.id, status: created.status as ApplicationStatus };
        const code = formatApplicationCode(created.number, created.createdAt);

        await tx.applicationStatusHistory.create({
          data: {
            applicationId: app.id,
            toStatus: ApplicationStatus.DRAFT,
            actorId: operator.id,
            createdAt,
          },
        });
        await audit(tx, {
          actorId: operator.id,
          action: 'application.created',
          entityType: 'CreditApplication',
          entityId: app.id,
          at: createdAt,
          after: {
            customerId: customer.id,
            status: ApplicationStatus.DRAFT,
            requestedAmount: amount.toFixed(2),
          },
        });

        const cancelFromDraft = target === ApplicationStatus.CANCELLED && i % 2 === 0;
        if (target === ApplicationStatus.DRAFT || cancelFromDraft) {
          if (cancelFromDraft) {
            const at = clock.advance(2, 48);
            await changeStatus(
              tx,
              app,
              ApplicationStatus.CANCELLED,
              operator.id,
              at,
              'Cliente desistiu antes do envio',
              {
                closedAt: at,
              },
            );
          }
          return;
        }

        // Required documents, plus proof of address for some applications.
        const docTypes: DocumentType[] = [
          DocumentType.IDENTIFICATION,
          DocumentType.PROOF_OF_INCOME,
        ];
        if (i % 3 !== 0) docTypes.push(DocumentType.PROOF_OF_ADDRESS);
        const docs = [];
        for (const type of docTypes) {
          docs.push(
            await attachDocument(tx, {
              applicationId: app.id,
              applicationCode: code,
              customerName: customer.name,
              type,
              uploadedById: operator.id,
              at: clock.advance(1, 6),
            }),
          );
        }

        const submittedAt = clock.advance(1, 24);
        await changeStatus(
          tx,
          app,
          ApplicationStatus.SUBMITTED,
          operator.id,
          submittedAt,
          undefined,
          { submittedAt },
        );
        if (target === ApplicationStatus.SUBMITTED) return;

        if (target === ApplicationStatus.CANCELLED) {
          const at = clock.advance(4, 72);
          await changeStatus(
            tx,
            app,
            ApplicationStatus.CANCELLED,
            operator.id,
            at,
            'Solicitacao duplicada aberta por engano',
            {
              closedAt: at,
            },
          );
          return;
        }

        await changeStatus(
          tx,
          app,
          ApplicationStatus.UNDER_REVIEW,
          analyst.id,
          clock.advance(2, 48),
          undefined,
          {
            assignee: { connect: { id: analyst.id } },
          },
        );
        await audit(tx, {
          actorId: analyst.id,
          action: 'application.assigned',
          entityType: 'CreditApplication',
          entityId: app.id,
          at: clock.now(),
          after: { assigneeId: analyst.id },
        });
        if (target === ApplicationStatus.UNDER_REVIEW) return;

        const goesThroughPending = target === ApplicationStatus.PENDING_INFORMATION || i % 2 === 0;
        if (goesThroughPending) {
          const issueAt = clock.advance(1, 24);
          const issue = await tx.applicationIssue.create({
            data: {
              applicationId: app.id,
              description:
                'Enviar extrato bancario dos ultimos 3 meses para conferir a renda declarada.',
              createdById: analyst.id,
              createdAt: issueAt,
            },
          });
          await audit(tx, {
            actorId: analyst.id,
            action: 'issue.created',
            entityType: 'ApplicationIssue',
            entityId: issue.id,
            at: issueAt,
            after: { applicationId: app.id, status: IssueStatus.OPEN },
          });
          await changeStatus(
            tx,
            app,
            ApplicationStatus.PENDING_INFORMATION,
            analyst.id,
            clock.advance(0, 1),
            'Documentacao complementar necessaria',
          );
          if (target === ApplicationStatus.PENDING_INFORMATION) return;

          docs.push(
            await attachDocument(tx, {
              applicationId: app.id,
              applicationCode: code,
              customerName: customer.name,
              type: DocumentType.BANK_STATEMENT,
              uploadedById: operator.id,
              at: clock.advance(24, 96),
            }),
          );
          await changeStatus(
            tx,
            app,
            ApplicationStatus.UNDER_REVIEW,
            operator.id,
            clock.advance(1, 4),
            'Extrato anexado',
          );
          const resolvedAt = clock.advance(2, 24);
          await tx.applicationIssue.update({
            where: { id: issue.id },
            data: {
              status: IssueStatus.RESOLVED,
              resolvedById: analyst.id,
              resolvedAt,
              resolutionNote: 'Extrato recebido e conferido.',
            },
          });
          await audit(tx, {
            actorId: analyst.id,
            action: 'issue.resolved',
            entityType: 'ApplicationIssue',
            entityId: issue.id,
            at: resolvedAt,
            before: { status: IssueStatus.OPEN },
            after: { status: IssueStatus.RESOLVED },
          });
        }

        // Manual document validation.
        const approved = target === ApplicationStatus.APPROVED;
        for (const [d, doc] of docs.entries()) {
          const rejectThis = !approved && d === docs.length - 1 && i % 2 === 1;
          const validatedAt = clock.advance(0, 2);
          const status = rejectThis
            ? DocumentValidationStatus.REJECTED
            : DocumentValidationStatus.ACCEPTED;
          await tx.creditDocument.update({
            where: { id: doc.id },
            data: {
              validationStatus: status,
              validationNotes: rejectThis ? 'Documento ilegivel na pagina 2.' : null,
              validatedById: analyst.id,
              validatedAt,
            },
          });
          await audit(tx, {
            actorId: analyst.id,
            action: 'document.validated',
            entityType: 'CreditDocument',
            entityId: doc.id,
            at: validatedAt,
            before: { validationStatus: DocumentValidationStatus.PENDING },
            after: { validationStatus: status },
          });
        }

        const reviewAt = clock.advance(2, 48);
        const review = await tx.creditReview.create({
          data: {
            applicationId: app.id,
            authorId: analyst.id,
            recommendation: approved ? ReviewRecommendation.APPROVE : ReviewRecommendation.REJECT,
            analysisNotes: approved
              ? 'Documentacao completa e coerente com os valores declarados.'
              : 'Compromissos declarados elevados em relacao a renda informada.',
            justification: approved
              ? 'Dados declarados conferem com os documentos; sem pendencias abertas.'
              : 'Comprometimento de renda incompatível com o valor e o prazo solicitados.',
            createdAt: reviewAt,
          },
        });
        await audit(tx, {
          actorId: analyst.id,
          action: 'review.created',
          entityType: 'CreditReview',
          entityId: review.id,
          at: reviewAt,
          after: { applicationId: app.id, recommendation: review.recommendation },
        });

        const decidedAt = clock.advance(1, 24);
        const outcome = approved ? DecisionOutcome.APPROVED : DecisionOutcome.REJECTED;
        const decision = await tx.creditDecision.create({
          data: {
            applicationId: app.id,
            outcome,
            justification: approved
              ? 'Aprovado conforme parecer: capacidade de pagamento declarada compativel.'
              : 'Reprovado conforme parecer: comprometimento de renda acima do aceitavel para o caso.',
            decidedById: analyst.id,
            decidedAt,
            reviewId: review.id,
          },
        });
        await changeStatus(tx, app, outcome, analyst.id, decidedAt, undefined, {
          decidedAt,
          closedAt: decidedAt,
        });
        await audit(tx, {
          actorId: analyst.id,
          action: 'decision.recorded',
          entityType: 'CreditDecision',
          entityId: decision.id,
          at: decidedAt,
          after: { applicationId: app.id, outcome },
        });
      },
      { timeout: 30_000 },
    );

    counts[target] = (counts[target] ?? 0) + 1;
  }
  return counts;
}

// ─────────────────────────────── main ───────────────────────────────

async function main() {
  const existingUsers = await prisma.user.count();
  if (existingUsers > 0) {
    throw new Error(
      'Database is not empty. Run `pnpm db:reset` to recreate it from scratch before seeding.',
    );
  }

  const providedPassword = process.env.SEED_DEMO_PASSWORD?.trim();
  if (providedPassword && providedPassword.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`SEED_DEMO_PASSWORD must have at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  const password = providedPassword || randomBytes(15).toString('base64url');

  // Documents from a previous seed are orphans once the database is empty.
  await rm(join(storageDir, 'documents'), { recursive: true, force: true });

  const users = await seedUsers(password);
  const customers = await seedCustomers(users.operators.map((u) => u.id));
  const counts = await seedApplications(customers, users);

  console.log('\nCreditFlow seed complete (synthetic data only).');
  console.log(
    `  Users: ${users.all.length} | Customers: ${customers.length} | Applications:`,
    counts,
  );
  console.log(`  Documents stored in: ${storageDir}`);
  console.log('\n  Demo users:');
  for (const u of users.all) {
    console.log(`    ${u.role.padEnd(8)} ${u.email}${u.canDecide ? '  (canDecide)' : ''}`);
  }
  if (providedPassword) {
    console.log('\n  Password: value of SEED_DEMO_PASSWORD.');
  } else {
    console.log(`\n  Generated password for all demo users (shown once): ${password}`);
    console.log('  Set SEED_DEMO_PASSWORD in .env to choose your own.');
  }
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
