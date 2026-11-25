/**
 * Human-readable application code, e.g. `CF-2026-000123`.
 *
 * Derived (not stored): the database keeps an auto-increment `number`; the
 * year comes from the application's creation date. Keeping it derived avoids
 * a second source of truth.
 */
export function formatApplicationCode(number: number, createdAt: Date | string): string {
  const year = new Date(createdAt).getUTCFullYear();
  return `CF-${year}-${String(number).padStart(6, '0')}`;
}
