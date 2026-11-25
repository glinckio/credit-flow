import { Info } from 'lucide-react';
import { ErrorState } from '@/app/pages/ErrorState';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useIndicators } from './analysis-api';
import { formatIndicator } from './format-indicator';

/** Descriptive, non-decisive indicators (no colours, no thresholds, no score). */
export function IndicatorsCard({ applicationId }: { applicationId: string }) {
  const q = useIndicators(applicationId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Indicadores descritivos</CardTitle>
        <CardDescription>Calculados apenas com os valores declarados.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {q.isPending ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorState error={q.error} />
        ) : (
          <>
            <dl className="grid gap-4 sm:grid-cols-2">
              {q.data.indicators.map((i) => (
                <div key={i.key} className="rounded-md border p-3">
                  <dt className="text-xs text-muted-foreground">{i.label}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">{formatIndicator(i)}</dd>
                  <dd className="mt-1 text-xs text-muted-foreground">Fórmula: {i.formula}</dd>
                </div>
              ))}
            </dl>
            <p
              className="flex gap-2 rounded-md bg-muted p-3 text-xs text-muted-foreground"
              role="note"
            >
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              {q.data.disclaimer}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
