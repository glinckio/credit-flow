import { type ReactElement, cloneElement, useId } from 'react';
import { cn } from '@/lib/utils';

interface FormFieldProps {
  label: string;
  /** Validation message (client-side or from the API Problem Details). */
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  /** A single input-like element; receives id and aria attributes. */
  children: ReactElement<Record<string, unknown>>;
}

/** Label + control + hint/error, wired for screen readers. */
export function FormField({ label, error, hint, required, className, children }: FormFieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium leading-none">
        {label}
        {required && (
          <span className="text-destructive" aria-hidden>
            {' '}
            *
          </span>
        )}
      </label>
      {cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
        'aria-required': required || undefined,
      })}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
