import {
  ApplicationStatus,
  FINDING_FEEDBACK_COMMENT_MAX,
  FINDING_KIND_LABELS,
  type FindingFeedbackVerdict,
  type FindingKind,
  type FindingsDiff,
  Permission,
  type ReportItem,
  SUBJECT_LABELS,
  type TemplateReport,
  diffFindings,
  findingsDiffIsEmpty,
} from '@creditflow/shared';
import { Bot, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/app/pages/ErrorState';
import { Alert } from '@/components/ui/alert';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import type { Application } from '@/features/applications/applications-api';
import { useCurrentUser, useHasPermission } from '@/features/auth/auth-api';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import {
  type AiRun,
  type AiRunDetail,
  type FindingFeedback,
  isActive,
  useAiRun,
  useAiRuns,
  useFindingFeedback,
  useRequestAiRun,
} from './ai-analysis-api';

const RUN_STATUS_LABELS: Record<AiRun['status'], string> = {
  QUEUED: 'Na fila',
  RUNNING: 'Em andamento',
  SUCCEEDED: 'Concluída',
  PARTIAL: 'Concluída parcialmente',
  FAILED: 'Falhou',
};

const RUN_STATUS_VARIANT: Record<AiRun['status'], BadgeProps['variant']> = {
  QUEUED: 'secondary',
  RUNNING: 'secondary',
  SUCCEEDED: 'success',
  PARTIAL: 'warning',
  FAILED: 'destructive',
};

const KIND_VARIANT: Record<FindingKind, BadgeProps['variant']> = {
  CONSISTENT: 'success',
  DIVERGENT: 'destructive',
  AMBIGUOUS: 'warning',
  UNVERIFIABLE: 'warning',
  MISSING: 'secondary',
};

const TRIGGER_LABELS: Record<AiRun['trigger'], string> = {
  AUTO_FIRST_REVIEW: 'automática',
  MANUAL: 'reprocessada',
};

const runLabel = (r: AiRun) =>
  `${formatDateTime(r.queuedAt)} · ${TRIGGER_LABELS[r.trigger]} · ${RUN_STATUS_LABELS[r.status]}`;

/**
 * Support report of the AI analysis (ADR-0011): always the deterministic
 * template, optionally the validated narrative. Read-only for everyone but
 * the assigned analyst, who may reprocess and give feedback per finding.
 * Nothing here changes reviews, decisions or document validations.
 */
export function AiAnalysisPanel({ application }: { application: Application }) {
  const canRead = useHasPermission(Permission.AI_ANALYSIS_READ);
  if (!canRead) return null;
  return <Panel application={application} />;
}

function Panel({ application: a }: { application: Application }) {
  const { data: me } = useCurrentUser();
  const canRequestPerm = useHasPermission(Permission.AI_ANALYSIS_REQUEST);
  const isAssignee = !!me && a.assignee?.id === me.id;
  const canReprocess = canRequestPerm && isAssignee && a.status === ApplicationStatus.UNDER_REVIEW;
  const canFeedback = canRequestPerm && isAssignee;

  const runs = useAiRuns(a.id, true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = runs.data ?? [];
  const selected = list.find((r) => r.id === selectedId) ?? list[0];
  const previous = selected ? list[list.indexOf(selected) + 1] : undefined;

  return (
    <Card aria-labelledby="ai-panel-title">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle id="ai-panel-title" className="flex items-center gap-2">
            <Bot className="size-4" aria-hidden /> Análise de documentos por IA (apoio)
          </CardTitle>
          <CardDescription>
            Compara os documentos com os dados declarados. Não é parecer nem decisão: confira os
            pontos de atenção nos documentos.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {list.length > 1 && (
            <label className="text-xs text-muted-foreground">
              Execução
              <Select
                aria-label="Execução da análise"
                value={selected?.id}
                onChange={(e) => setSelectedId(e.target.value)}
                className="mt-1 min-w-64"
              >
                {list.map((r) => (
                  <option key={r.id} value={r.id}>
                    {runLabel(r)}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {canReprocess && (
            <ReprocessButton
              applicationId={a.id}
              busy={list.some((r) => isActive(r.status))}
              onQueued={() => setSelectedId(null)}
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {runs.isPending ? (
          <Spinner />
        ) : runs.isError ? (
          <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />
        ) : !selected ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma análise por IA para esta solicitação. A primeira é feita automaticamente quando
            a solicitação entra em análise.
          </p>
        ) : (
          <RunView run={selected} previous={previous} canFeedback={canFeedback} />
        )}
      </CardContent>
    </Card>
  );
}

function ReprocessButton({
  applicationId,
  busy,
  onQueued,
}: {
  applicationId: string;
  busy: boolean;
  onQueued: () => void;
}) {
  const request = useRequestAiRun(applicationId);
  const [confirming, setConfirming] = useState(false);

  const send = async (force: boolean) => {
    try {
      await request.mutateAsync(force);
      setConfirming(false);
      onQueued();
      toast.success('Nova análise por IA na fila.');
    } catch (err) {
      if (!force && err instanceof ApiError && err.code === 'analysis-up-to-date') {
        request.reset();
        setConfirming(true);
      } else if (!confirming) {
        toast.error(errorMessage(err));
      }
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void send(false)}
        loading={request.isPending && !confirming}
        disabled={busy}
        title={busy ? 'Aguarde a análise em andamento' : undefined}
      >
        <RefreshCw aria-hidden /> Reprocessar
      </Button>
      <Dialog
        open={confirming}
        onOpenChange={(o) => {
          if (!o) {
            setConfirming(false);
            request.reset();
          }
        }}
        title="Reprocessar sem mudanças nos documentos?"
        description="Os documentos não mudaram desde a última análise. Refazer pode dar um resultado diferente e tem custo."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Voltar
            </Button>
            <Button onClick={() => void send(true)} loading={request.isPending}>
              Confirmar
            </Button>
          </>
        }
      >
        {request.isError && <Alert variant="destructive" title={errorMessage(request.error)} />}
      </Dialog>
    </>
  );
}

function RunView({
  run,
  previous,
  canFeedback,
}: {
  run: AiRun;
  previous: AiRun | undefined;
  canFeedback: boolean;
}) {
  const detail = useAiRun(run.id, run.status);
  const header = (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Badge variant={RUN_STATUS_VARIANT[run.status]}>{RUN_STATUS_LABELS[run.status]}</Badge>
      <span className="text-muted-foreground">
        {run.finishedAt
          ? `Concluída em ${formatDateTime(run.finishedAt)}`
          : `Solicitada em ${formatDateTime(run.queuedAt)}`}
        {run.requestedBy && run.trigger === 'MANUAL' && ` por ${run.requestedBy.name}`}
      </span>
    </div>
  );

  if (isActive(run.status)) {
    return (
      <div className="space-y-3">
        {header}
        <Spinner label="Analisando os documentos. A análise manual pode seguir normalmente." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}
      {run.stale && (
        <Alert variant="warning" title="Os documentos mudaram desde esta análise">
          Ela não cobre os documentos atuais. O analista responsável pode reprocessar.
        </Alert>
      )}
      {run.status === 'FAILED' && (
        <Alert variant="destructive" title="A análise por IA não pôde ser concluída">
          Continue a análise manual normalmente.
          {run.errorCode && ` (código: ${run.errorCode})`}
        </Alert>
      )}
      {run.purgedAt && (
        <Alert variant="info" title="Conteúdo removido pela política de retenção">
          Os dados extraídos desta análise foram apagados em {formatDateTime(run.purgedAt)}.
        </Alert>
      )}
      {detail.isPending ? (
        <Spinner />
      ) : detail.isError ? (
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      ) : (
        <RunReport detail={detail.data} previous={previous} canFeedback={canFeedback} />
      )}
      <p className="text-xs text-muted-foreground">
        Modelo {run.model} · {run.pipelineVersion} · prompt {run.promptVersion}
      </p>
    </div>
  );
}

function RunReport({
  detail: d,
  previous,
  canFeedback,
}: {
  detail: AiRunDetail;
  previous: AiRun | undefined;
  canFeedback: boolean;
}) {
  const report = d.report;
  if (!report) return null;
  const feedbackOf = (id: string) => d.feedback.find((f) => f.findingId === id);

  return (
    <div className="space-y-5">
      <p role="note" className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        {report.disclaimer}
      </p>
      {d.status === 'PARTIAL' && (
        <Alert variant="warning" title="Alguns documentos não foram analisados">
          Veja a lista de documentos abaixo e confira-os manualmente.
        </Alert>
      )}
      {d.declaredDataChanged && (
        <Alert variant="warning" title="Os dados declarados mudaram depois desta análise">
          Os achados abaixo já usam os dados atuais. O resumo em texto descreve os dados da
          conclusão e está desatualizado.
        </Alert>
      )}

      <Narrative detail={d} />

      <section aria-labelledby="ai-attention" className="space-y-2">
        <h3 id="ai-attention" className="text-sm font-semibold">
          Pontos de atenção ({report.attention.length})
        </h3>
        {report.attention.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum ponto de atenção nos itens conferidos.
          </p>
        ) : (
          <ul className="space-y-2">
            {report.attention.map((item) => (
              <FindingItem
                key={item.findingId}
                item={item}
                runId={d.id}
                feedback={feedbackOf(item.findingId)}
                canFeedback={canFeedback && !d.purgedAt}
              />
            ))}
          </ul>
        )}
      </section>

      {report.consistent.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm font-semibold">
            Itens que conferem ({report.consistent.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {report.consistent.map((item) => (
              <FindingItem
                key={item.findingId}
                item={item}
                runId={d.id}
                feedback={feedbackOf(item.findingId)}
                canFeedback={canFeedback && !d.purgedAt}
              />
            ))}
          </ul>
        </details>
      )}

      <Documents report={report} />

      {previous && <RunDiff current={d} previous={previous} />}

      {report.limitations.length > 0 && (
        <section aria-labelledby="ai-limits">
          <h3 id="ai-limits" className="text-sm font-semibold">
            Limitações
          </h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {report.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Narrative({ detail: d }: { detail: AiRunDetail }) {
  const n = d.narrative;
  if (!n || n.status !== 'OK' || n.sentences.length === 0) return null;
  return (
    <section
      aria-labelledby="ai-narrative"
      className="space-y-2 rounded-md border border-dashed p-3"
    >
      <h3 id="ai-narrative" className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        Resumo em texto
        <Badge variant="secondary">redigido por IA a partir dos achados</Badge>
        {d.declaredDataChanged && <Badge variant="warning">desatualizado</Badge>}
      </h3>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {n.sentences.map((s, i) => (
          <li key={i}>{s.text}</li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Valores inseridos pelo sistema, com a origem entre parênteses. Em caso de dúvida, vale a
        lista de achados abaixo.
      </p>
    </section>
  );
}

function FindingItem({
  item,
  runId,
  feedback,
  canFeedback,
}: {
  item: ReportItem;
  runId: string;
  feedback: FindingFeedback | undefined;
  canFeedback: boolean;
}) {
  const evidence = item.evidence.filter((e) => e.quote);
  return (
    <li className="rounded-md border p-3" data-testid={`finding-${item.findingId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {SUBJECT_LABELS[item.subject]}{' '}
          <span className="font-normal text-muted-foreground">· {item.documentLabel}</span>
        </p>
        <Badge variant={KIND_VARIANT[item.kind]}>{FINDING_KIND_LABELS[item.kind]}</Badge>
      </div>
      <p className="mt-1 text-sm">{item.text}</p>
      {evidence.length > 0 && (
        <ul className="mt-2 space-y-1" aria-label="Evidências">
          {evidence.map((e, i) => (
            <li key={i} className="text-xs text-muted-foreground">
              {e.page ? `Página ${e.page}: ` : ''}
              <q className="font-mono text-foreground">{e.quote}</q>{' '}
              {e.verified ? (
                <span className="text-success">(trecho conferido no documento)</span>
              ) : (
                <span className="text-warning">(trecho não confirmado — conferir)</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canFeedback ? (
        <FeedbackControls runId={runId} item={item} current={feedback} />
      ) : (
        feedback && (
          <p className="mt-2 text-xs text-muted-foreground">
            Avaliação de {feedback.author.name}:{' '}
            {feedback.verdict === 'CORRECT' ? 'correto' : 'incorreto'}
            {feedback.comment && ` — “${feedback.comment}”`}
          </p>
        )
      )}
    </li>
  );
}

function FeedbackControls({
  runId,
  item,
  current,
}: {
  runId: string;
  item: ReportItem;
  current: FindingFeedback | undefined;
}) {
  const save = useFindingFeedback(runId);
  const [comment, setComment] = useState(current?.comment ?? '');
  const [commenting, setCommenting] = useState(false);
  const subject = SUBJECT_LABELS[item.subject];

  const send = async (verdict: FindingFeedbackVerdict) => {
    try {
      await save.mutateAsync({
        findingId: item.findingId,
        verdict,
        comment: comment.trim() || undefined,
      });
      toast.success('Avaliação registrada.');
      setCommenting(false);
    } catch {
      // shown below
    }
  };

  return (
    <div className="mt-2 space-y-2 border-t pt-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Este achado está correto?</span>
        <Button
          size="sm"
          variant={current?.verdict === 'CORRECT' ? 'default' : 'outline'}
          aria-pressed={current?.verdict === 'CORRECT'}
          aria-label={`Marcar ${subject} como correto`}
          disabled={save.isPending}
          onClick={() => void send('CORRECT')}
        >
          <ThumbsUp aria-hidden /> Correto
        </Button>
        <Button
          size="sm"
          variant={current?.verdict === 'INCORRECT' ? 'default' : 'outline'}
          aria-pressed={current?.verdict === 'INCORRECT'}
          aria-label={`Marcar ${subject} como incorreto`}
          disabled={save.isPending}
          onClick={() => void send('INCORRECT')}
        >
          <ThumbsDown aria-hidden /> Incorreto
        </Button>
        {!commenting && (
          <Button size="sm" variant="ghost" onClick={() => setCommenting(true)}>
            {current?.comment ? 'Editar comentário' : 'Comentar'}
          </Button>
        )}
      </div>
      {commenting && (
        <FormField
          label={`Comentário sobre ${subject} (opcional)`}
          hint="Salvo com a avaliação ao clicar em Correto ou Incorreto."
        >
          <Textarea
            rows={2}
            value={comment}
            maxLength={FINDING_FEEDBACK_COMMENT_MAX}
            onChange={(e) => setComment(e.target.value)}
          />
        </FormField>
      )}
      {save.isError && <Alert variant="destructive" title={errorMessage(save.error)} />}
    </div>
  );
}

function Documents({ report }: { report: TemplateReport }) {
  return (
    <section aria-labelledby="ai-documents" className="space-y-2">
      <h3 id="ai-documents" className="text-sm font-semibold">
        Documentos analisados
      </h3>
      <ul className="space-y-1 text-sm">
        {report.documents.map((doc) => (
          <li key={doc.documentId}>
            <span className="font-medium">{doc.label}</span>
            <span className="text-muted-foreground"> — {doc.statusLabel}</span>
            {doc.alerts.map((alert) => (
              <p key={alert} className="text-xs text-warning">
                ⚠ {alert}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What changed since the previous run (same declared data on both sides). */
function RunDiff({ current, previous }: { current: AiRunDetail; previous: AiRun }) {
  const prev = useAiRun(previous.id, previous.status);
  if (!prev.data || prev.data.purgedAt || current.purgedAt) return null;
  if (previous.status === 'FAILED') return null;
  const diff = diffFindings(prev.data.findings, current.findings);
  const labels = new Map(
    [...(prev.data.report?.documents ?? []), ...(current.report?.documents ?? [])].map((d) => [
      d.documentId,
      d.label,
    ]),
  );
  return (
    <section aria-labelledby="ai-diff" className="space-y-1">
      <h3 id="ai-diff" className="text-sm font-semibold">
        Mudanças em relação à análise de {formatDateTime(previous.queuedAt)}
      </h3>
      <DiffList diff={diff} labels={labels} />
    </section>
  );
}

function DiffList({ diff, labels }: { diff: FindingsDiff; labels: Map<string, string> }) {
  if (findingsDiffIsEmpty(diff))
    return <p className="text-sm text-muted-foreground">Nenhuma mudança nos achados.</p>;
  const name = (subject: keyof typeof SUBJECT_LABELS, documentId: string) =>
    `${SUBJECT_LABELS[subject]} — ${labels.get(documentId) ?? 'documento'}`;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {diff.changed.map((c) => (
        <li key={c.findingId}>
          {name(c.subject, c.documentId)}: {FINDING_KIND_LABELS[c.from]} →{' '}
          {FINDING_KIND_LABELS[c.to]}
        </li>
      ))}
      {diff.valuesChanged.map((id) => {
        const [subject, documentId] = id.split(':') as [keyof typeof SUBJECT_LABELS, string];
        return <li key={id}>{name(subject, documentId)}: valor encontrado no documento mudou</li>;
      })}
      {diff.added.map((f) => (
        <li key={f.id}>
          Novo: {name(f.subject, f.documentId)} — {FINDING_KIND_LABELS[f.kind]}
        </li>
      ))}
      {diff.removed.map((f) => (
        <li key={f.id}>Não consta mais: {name(f.subject, f.documentId)}</li>
      ))}
    </ul>
  );
}
