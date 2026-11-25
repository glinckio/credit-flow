import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api';

/**
 * Copies the API's per-field validation errors onto the form fields.
 * Returns true when at least one field error was applied; otherwise the
 * caller should show a general error message.
 */
export function applyApiFieldErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  knownFields: readonly string[],
): boolean {
  if (!(err instanceof ApiError)) return false;
  let applied = false;
  for (const [field, message] of Object.entries(err.fieldErrors)) {
    if (knownFields.includes(field)) {
      setError(field as Path<T>, { type: 'server', message });
      applied = true;
    }
  }
  return applied;
}
