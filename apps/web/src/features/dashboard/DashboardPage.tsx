import { APPLICATION_STATUSES, type ApplicationStatus, Permission } from '@creditflow/shared';
import { RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ErrorState } from '@/app/pages/ErrorState';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useHasPermission } from '@/features/auth/auth-api';
import { formatDateTime } from '@/lib/format';
import { APPLICATION_STATUS_LABELS } from '@/lib/labels';
import { type DurationMetric, formatHours, useDashboardMetrics } from './dashboard-api';

const list = (query: string) => `/solicitacoes?${query}`;

/**
 * Operational indicators, computed by the API from the database on every
 * request (roadmap §4.1). Headline numbers are stat tiles, not charts.
 */
export function DashboardPage() {
  const metrics = useDashboardMetrics();
  // Same visibility rule as the API: users who cannot write applications do not see drafts.
  const seesDrafts = useHasPermission(Permission.APPLICATION_WRITE);

  if (metrics.isPending) return <Spinner />;
  if (metrics.isError) {
    return <ErrorState error={metrics.error} onRetry={() => void metrics.refetch()} />;
  }
  const m = metrics.data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Dados do banco, atualizados em ${formatDateTime(m.generatedAt)}.`}
        actions={
          <Button
            variant="outline"
            onClick={() => void metrics.refetch()}
            loading={metrics.isFetching}
          >
            <RefreshCw aria-hidden /> Atualizar
          </Button>
        }
      />

      <section
        aria-label="Indicadores principais"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatTile label="Total de solicitações" value={m.total} to={list('')} />
        <StatTile
          label="Aguardando análise"
          value={m.awaitingReview}
          to={list('status=SUBMITTED&sort=submittedAt%3Aasc')}
        />
        <StatTile label="Em análise" value={m.underReview} to={list('status=UNDER_REVIEW')} />
        <StatTile
          label="Pendentes de informação"
          value={m.pendingInformation}
          to={list('status=PENDING_INFORMATION')}
          hint={`${m.withOpenIssues} solicitação(ões) em andamento com pendência aberta`}
        />
        <StatTile label="Aprovadas" value={m.approved} to={list('status=APPROVED')} />
        <StatTile label="Reprovadas" value={m.rejected} to={list('status=REJECTED')} />
        {m.assignedToMe !== null && (
          <StatTile
            label="Atribuídas a mim"
            value={m.assignedToMe}
            to={list('assigneeId=me&status=UNDER_REVIEW%2CPENDING_INFORMATION')}
            hint="Em análise ou pendentes sob sua responsabilidade"
          />
        )}
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tempo médio até a decisão</CardTitle>
            <CardDescription>Somente solicitações aprovadas ou reprovadas.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <DurationTile label="Da abertura à decisão" metric={m.openToDecision} />
            <DurationTile label="Do envio à decisão" metric={m.submissionToDecision} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Solicitações por status</CardTitle>
            <CardDescription>
              {seesDrafts
                ? 'Todas as solicitações.'
                : 'Rascunhos não são exibidos para o seu perfil.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StatusBars byStatus={m.byStatus} total={m.total} hideDrafts={!seesDrafts} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function StatTile({
  label,
  value,
  to,
  hint,
}: {
  label: string;
  value: number;
  to: string;
  hint?: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="group rounded-lg border bg-card p-4 shadow-xs transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className="mt-1 text-3xl font-semibold tabular-nums tracking-tight"
        data-testid={`tile-${label}`}
      >
        {value.toLocaleString('pt-BR')}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      <span className="mt-2 block text-xs text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        Ver solicitações →
      </span>
    </Link>
  );
}

function DurationTile({ label, metric }: { label: string; metric: DurationMetric }) {
  return (
    <div className="rounded-md border p-3" title={metric.definition}>
      <p className="text-sm text-muted-foreground">{label}</p>
      {metric.averageHours === null ? (
        <p className="mt-1 text-sm">Dados insuficientes (nenhuma solicitação decidida).</p>
      ) : (
        <>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formatHours(metric.averageHours)}
          </p>
          <p className="text-xs text-muted-foreground">
            {metric.averageHours.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h · base:{' '}
            {metric.sampleSize} solicitação(ões)
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Single-series magnitude → one hue, horizontal bars from a shared zero
 * baseline. Status colours are not used (they are reserved for state); the
 * value is always printed, so identity and magnitude never rely on colour.
 */
function StatusBars({
  byStatus,
  total,
  hideDrafts,
}: {
  byStatus: Record<ApplicationStatus, number>;
  total: number;
  hideDrafts: boolean;
}) {
  const statuses = APPLICATION_STATUSES.filter((s) => !(hideDrafts && s === 'DRAFT'));
  const max = Math.max(1, ...statuses.map((s) => byStatus[s]));
  return (
    <ul className="space-y-2.5">
      {statuses.map((s) => {
        const value = byStatus[s];
        const pct = total > 0 ? Math.round((value / total) * 100) : 0;
        return (
          <li key={s}>
            <Link
              to={list(`status=${s}`)}
              className="grid grid-cols-[10rem_1fr_4.5rem] items-center gap-3 rounded-sm text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={`${APPLICATION_STATUS_LABELS[s]}: ${value} (${pct}%)`}
            >
              <span className="truncate text-muted-foreground">{APPLICATION_STATUS_LABELS[s]}</span>
              <span className="h-3 rounded-sm bg-muted" aria-hidden>
                <span
                  className="block h-full rounded-r-[4px] bg-primary/80"
                  style={{ width: `${(value / max) * 100}%`, minWidth: value > 0 ? 2 : 0 }}
                />
              </span>
              <span className="text-right tabular-nums">
                {value} <span className="text-xs text-muted-foreground">({pct}%)</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
