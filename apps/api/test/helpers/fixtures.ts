import { randomUUID } from 'node:crypto';
import { type DocumentType, cpfCheckDigits } from '@creditflow/shared';
import type { PrismaService } from '../../src/infra/prisma/prisma.service.js';

let seq = 0;

/** Synthetic active individual customer inserted directly in the database. */
export async function createCustomer(
  prisma: PrismaService,
  createdById: string,
  opts: { status?: 'ACTIVE' | 'INACTIVE'; name?: string } = {},
) {
  seq += 1;
  const base = String(100_000_000 + seq * 7919 + process.pid).slice(-9);
  return prisma.customer.create({
    data: {
      type: 'INDIVIDUAL',
      name: opts.name ?? `Cliente Sintetico ${seq}`,
      documentNumber: cpfCheckDigits(base),
      email: `cliente${seq}@exemplo.test`,
      phone: '+55 11 90000-0001',
      birthOrFoundationDate: new Date('1985-03-10'),
      addressStreet: 'Rua Ficticia',
      addressNumber: '1',
      addressDistrict: 'Centro',
      addressCity: 'Cidade Demo',
      addressState: 'SP',
      addressZipCode: '01000000',
      status: opts.status ?? 'ACTIVE',
      createdById,
    },
  });
}

export const applicationBody = (customerId: string, overrides: Record<string, unknown> = {}) => ({
  customerId,
  productType: 'PERSONAL_LOAN',
  requestedAmount: '15000.00',
  termMonths: 24,
  purpose: 'Reforma da residencia',
  declaredMonthlyIncome: '6500.00',
  declaredMonthlyCommitments: '1200.50',
  ...overrides,
});

/**
 * Inserts document metadata rows directly (the upload endpoint arrives in
 * stage 6). No file is written: these tests only need the rows.
 */
export async function attachDocuments(
  prisma: PrismaService,
  applicationId: string,
  uploadedById: string,
  types: DocumentType[] = ['IDENTIFICATION', 'PROOF_OF_INCOME'],
) {
  for (const type of types) {
    await prisma.creditDocument.create({
      data: {
        applicationId,
        type,
        originalName: `${type.toLowerCase()}.pdf`,
        storageKey: `documents/${randomUUID()}`,
        mimeType: 'application/pdf',
        sizeBytes: 1234,
        sha256: 'a'.repeat(64),
        uploadedById,
      },
    });
  }
}
