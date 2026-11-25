import { type Algorithm, hash, verify } from '@node-rs/argon2';

/**
 * `Algorithm` is an ambient `const enum`, which cannot be read at runtime under
 * `isolatedModules`. Value 2 = Argon2id (see @node-rs/argon2 index.d.ts); the
 * unit test asserts the resulting hash prefix is `$argon2id$`.
 */
const ARGON2ID = 2 as Algorithm.Argon2id;

/**
 * Argon2id parameters. OWASP Password Storage Cheat Sheet baseline:
 * m = 19 MiB, t = 2, p = 1. Encoded in the hash string, so they can be raised
 * later without invalidating existing hashes.
 */
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const PASSWORD_MIN_LENGTH = 12;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plain);
  } catch {
    // Malformed hash: treat as mismatch, never throw details to callers.
    return false;
  }
}
