import { ErrorState } from '@/app/pages/ErrorState';
import { ApplicationStatusBadge } from '@/components/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { formatDateTime } from '@/lib/format';
import { useStatusHistory } from './applications-api';

export function StatusTimeline({ applicationId }: { applicationId: string }) {
  const history = useStatusHistory(applicationId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico de status</CardTitle>
      </CardHeader>
      <CardContent>
        {history.isPending ? (
          <Spinner />
        ) : history.isError ? (
          <ErrorState error={history.error} />
        ) : (
          <ol className="relative space-y-4 border-l pl-5">
            {history.data.map((h) => (
              <li key={h.id} className="relative">
                <span
                  className="absolute -left-[1.6rem] top-1.5 size-2.5 rounded-full bg-primary"
                  aria-hidden
                />
                <div className="flex flex-wrap items-center gap-2">
                  <ApplicationStatusBadge status={h.toStatus} />
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(h.createdAt)} · {h.actor.name}
                  </span>
                </div>
                {h.reason && <p className="mt-1 text-sm text-muted-foreground">“{h.reason}”</p>}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
