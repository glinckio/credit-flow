import {
  type AiMetrics,
  EXTRACTION_STATUS_LABELS,
  FINDING_KIND_LABELS,
  SUBJECT_LABELS,
} from '@creditflow/shared';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { ErrorState } from '@/app/pages/ErrorState';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const PERIODS = [7, 30, 90] as const;

const RUN_STATUS: Record<string, string> = {
  QUEUED: 'Na fila',
  RUNNING: 'Em andamento',
  SUCCEEDED: 'Concluída',
  PARTIAL: 'Parcial',
  FAILED: 'Falhou',
};
const NARRATIVE_STATUS: Record<string, string> = {
  OK: 'Exibida',
  REJECTED: 'Rejeitada pela validação',
  FAILED: 'Falha do provedor',
  SKIPPED_BUDGET: 'Limite de custo',
  NOT_NEEDED: 'Não necessária',
  DISABLED: 'Desativada',
  NONE: 'Sem narrativa (antes da B4)',
};

const usd = (v: string | null) =>
  v === null
    ? '—'
    : `US$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
const ms = (v: number | null) => (v === null ? '—' : `${(v / 1000).toLocaleString('pt-BR')} s`);
const pct = (v: number | null) =>
  v === null ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

function useAiMetrics(days: number) {
  return useQuery({
    queryKey: ['ai-metrics', days],
    queryFn: ({ signal }) => api.get<AiMetrics>('/ai-metrics', { query: { days }, signal }),
  });
}

/**
 * Cost and quality of the AI analyses (stage B6). Aggregates only: no
 * extracted value, quote or analyst comment is ever shown here.
 */
export function AiMetricsPage() {
  const [days, setDays] = useState<number>(30);
  const metrics = useAiMetrics(days);

  return (
    <>
      <PageHeader
        title="Métricas da IA"
        description="Custo e qualidade das análises de documentos por IA (apoio ao analista)."
        actions={
          <div className="flex items-end gap-2">
            <label className="text-xs text-muted-foreground">
              Período
              <Select
                aria-label="Período"
                className="mt-1"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                {PERIODS.map((p) => (
                  <option key={p} value={p}>
                    Últimos {p} dias
                  </option>
                ))}
              </Select>
            </label>
            <Button
              variant="outline"
              onClick={() => void metrics.refetch()}
              loading={metrics.isFetching}
            >
              <RefreshCw aria-hidden /> Atualizar
            </Button>
          </div>
        }
      />
      {metrics.isPending ? (
        <Spinner />
      ) : metrics.isError ? (
        <ErrorState error={metrics.error} onRetry={() => void metrics.refetch()} />
      ) : (
        <MetricsView m={metrics.data} />
      )}
    </>
  );
}

function MetricsView({ m }: { m: AiMetrics }) {
  const narrativeTotal = Object.entries(m.narrative.byStatus)
    .filter(([s]) => s !== 'NOT_NEEDED' && s !== 'NONE')
    .reduce((a, [, n]) => a + (n ?? 0), 0);
  const narrativeOk = m.narrative.byStatus.OK ?? 0;
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        De {formatDateTime(m.from)} a {formatDateTime(m.to)}. Custos estimados pelo preço de tabela.
        Documentos, achados e narrativas cobrem só execuções ainda não expurgadas ({m.runs.purged}{' '}
        expurgada(s) no período).
      </p>
      <section aria-label="Indicadores" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Tile label="Execuções" value={m.runs.total.toLocaleString('pt-BR')} />
        <Tile
          label="Custo total"
          value={usd(m.cost.totalUsd)}
          hint={`Média ${usd(m.cost.avgPerRunUsd)} · máximo ${usd(m.cost.maxRunUsd)} por execução`}
        />
        <Tile
          label="Latência média"
          value={ms(m.latencyMs.avg)}
          hint={`p95 ${ms(m.latencyMs.p95)}`}
        />
        <Tile
          label="Correções do analista"
          value={pct(m.feedback.correctionRate)}
          hint={`${m.feedback.incorrect} de ${m.feedback.total} avaliação(ões) marcadas como incorretas`}
        />
        <Tile
          label="Narrativas exibidas"
          value={narrativeTotal ? pct(narrativeOk / narrativeTotal) : '—'}
          hint={`${narrativeOk} de ${narrativeTotal} geradas passaram na validação`}
        />
        <Tile
          label="Alertas de texto dirigido à IA"
          value={m.documents.injectionAlerts.toLocaleString('pt-BR')}
          hint={`${m.documents.withoutTextLayer} documento(s) sem texto pesquisável`}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <CountTable title="Execuções por status" counts={m.runs.byStatus} labels={RUN_STATUS} />
        <CountTable
          title="Documentos por resultado"
          counts={m.documents.byStatus}
          labels={EXTRACTION_STATUS_LABELS}
        />
        <CountTable
          title="Achados por tipo"
          counts={m.findings.byKind}
          labels={FINDING_KIND_LABELS}
        />
        <CountTable
          title="Narrativa por resultado"
          counts={m.narrative.byStatus}
          labels={NARRATIVE_STATUS}
        />
        <CountTable
          title="Achados marcados como incorretos, por assunto"
          counts={m.feedback.incorrectBySubject}
          labels={SUBJECT_LABELS}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Por modelo e versão</CardTitle>
        </CardHeader>
        <CardContent>
          {m.byVersion.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma execução no período.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Modelo</TH>
                  <TH>Prompt</TH>
                  <TH>Pipeline</TH>
                  <TH className="text-right">Execuções</TH>
                  <TH className="text-right">Falhas</TH>
                  <TH className="text-right">Custo</TH>
                </TR>
              </THead>
              <TBody>
                {m.byVersion.map((v) => (
                  <TR key={`${v.model}|${v.promptVersion}|${v.pipelineVersion}`}>
                    <TD>{v.model}</TD>
                    <TD>{v.promptVersion}</TD>
                    <TD>{v.pipelineVersion}</TD>
                    <TD className="text-right tabular-nums">{v.runs}</TD>
                    <TD className="text-right tabular-nums">{v.failed}</TD>
                    <TD className="text-right tabular-nums">{usd(v.costUsd)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-xs">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className="mt-1 text-3xl font-semibold tabular-nums tracking-tight"
        data-testid={`ai-tile-${label}`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function CountTable({
  title,
  counts,
  labels,
}: {
  title: string;
  counts: Partial<Record<string, number>>;
  labels: Readonly<Record<string, string>>;
}) {
  const rows = Object.entries(counts)
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada no período.</p>
        ) : (
          <Table aria-label={title}>
            <TBody>
              {rows.map(([key, n]) => (
                <TR key={key}>
                  <TD>{labels[key] ?? key}</TD>
                  <TD className="text-right tabular-nums">{n}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
