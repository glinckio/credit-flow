import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';

/** Prisma client bound to the TEST database (DATABASE_URL is overridden by the integration config). */
export function createTestPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url || url !== process.env.TEST_DATABASE_URL) {
    throw new Error('Refusing to touch a database other than TEST_DATABASE_URL.');
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

/**
 * Empties every application table. TRUNCATE does not fire the row-level
 * append-only triggers, which is intended: only tests use it, only on the test DB.
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
