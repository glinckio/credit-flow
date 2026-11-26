import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Spinner({
  label = 'Carregando…',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  );
}
