import { DecisionOutcome } from '@creditflow/shared';
import { Gavel } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import type { Application } from '@/features/applications/applications-api';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { RECOMMENDATION_LABELS } from '@/lib/labels';
import { useDecision, useRecordDecision, useReviews } from './analysis-api';
import { MIN_JUSTIFICATION } from './constants';
import { useAnalysisAccess } from './use-analysis-access';

const DECIDED = ['APPROVED', 'REJECTED'];

/** Final, human credit decision. Never automatic. */
export function DecisionPanel({ application }: { application: Application }) {
  const decided = DECIDED.includes(application.status);
  const decision = useDecision(application.id, decided);
  const { canDecide } = useAnalysisAccess(application);
  const [open, setOpen] = useState(false);

  if (!decided && !canDecide) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Decisão de crédito</CardTitle>
        <CardDescription>
          Decisão humana, registrada por usuário autorizado e acompanhada de justificativa.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {decided ? (
          decision.isPending ? (
            <Spinner />
          ) : decision.isError ? (
            <Alert variant="destructive" title={errorMessage(decision.error)} />
          ) : (
            <div className="space-y-2 text-sm">
              <Badge variant={decision.data.outcome === 'APPROVED' ? 'success' : 'destructive'}>
                {decision.data.outcome === 'APPROVED' ? 'Aprovada' : 'Reprovada'}
              </Badge>
              <p>{decision.data.justification}</p>
              <p className="text-xs text-muted-foreground">
                Por {decision.data.decidedBy.name} em {formatDateTime(decision.data.decidedAt)} ·
                parecer vigente recomendava “
                {RECOMMENDATION_LABELS[decision.data.reviewRecommendation]}”
              </p>
            </div>
          )
        ) : (
          <Button onClick={() => setOpen(true)}>
            <Gavel aria-hidden /> Registrar decisão
          </Button>
        )}
      </CardContent>
      {canDecide && (
        <DecisionDialog application={application} open={open} onClose={() => setOpen(false)} />
      )}
    </Card>
  );
}

function DecisionDialog({
  application,
  open,
  onClose,
}: {
  application: Application;
  open: boolean;
  onClose: () => void;
}) {
  const record = useRecordDecision(application.id);
  const reviews = useReviews(application.id);
  const current = reviews.data?.find((r) => r.current);
  const [outcome, setOutcome] = useState<DecisionOutcome | ''>('');
  const [justification, setJustification] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<{
    outcome?: string;
    justification?: string;
    confirmed?: string;
  }>({});

  const close = () => {
    setOutcome('');
    setJustification('');
    setConfirmed(false);
    setErrors({});
    record.reset();
    onClose();
  };

  const submit = async () => {
    const next: typeof errors = {};
    if (!outcome) next.outcome = 'Escolha aprovar ou reprovar';
    if (justification.trim().length < MIN_JUSTIFICATION) {
      next.justification = `A justificativa deve ter ao menos ${MIN_JUSTIFICATION} caracteres`;
    }
    if (!confirmed) next.confirmed = 'Confirme que a decisão é sua';
    setErrors(next);
    if (Object.keys(next).length > 0 || !outcome) return;
    try {
      await record.mutateAsync({ outcome, justification: justification.trim() });
      toast.success(outcome === 'APPROVED' ? 'Solicitação aprovada.' : 'Solicitação reprovada.');
      close();
    } catch {
      // shown in the dialog
    }
  };

  const apiError = record.error instanceof ApiError ? record.error : null;
  const divergent =
    current &&
    outcome &&
    ((outcome === 'APPROVED' && current.recommendation !== 'APPROVE') ||
      (outcome === 'REJECTED' && current.recommendation !== 'REJECT'));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={`Registrar decisão — ${application.code}`}
      description="Esta ação encerra a solicitação e não pode ser desfeita."
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Voltar
          </Button>
          <Button
            variant={outcome === 'REJECTED' ? 'destructive' : 'default'}
            onClick={() => void submit()}
            loading={record.isPending}
          >
            Registrar decisão
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {record.isError && (
          <Alert
            variant="destructive"
            title={
              apiError?.code === 'review-required'
                ? 'Registre um parecer antes da decisão'
                : apiError?.code === 'open-issues'
                  ? 'Há pendências abertas: resolva-as antes de aprovar'
                  : errorMessage(record.error)
            }
          />
        )}
        {current ? (
          <p className="text-sm text-muted-foreground">
            Parecer vigente: <strong>{RECOMMENDATION_LABELS[current.recommendation]}</strong> (
            {current.author.name})
          </p>
        ) : (
          reviews.isSuccess && (
            <Alert
              variant="warning"
              title="Ainda não há parecer registrado para esta solicitação."
            />
          )
        )}
        {application.openIssueCount > 0 && (
          <Alert
            variant="warning"
            title={`${application.openIssueCount} pendência(s) aberta(s): a aprovação será recusada.`}
          />
        )}

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Decisão *</legend>
          <div className="flex gap-4" role="radiogroup">
            {(
              [
                ['APPROVED', 'Aprovar'],
                ['REJECTED', 'Reprovar'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="outcome"
                  value={value}
                  checked={outcome === value}
                  onChange={() => setOutcome(value)}
                />
                {label}
              </label>
            ))}
          </div>
          {errors.outcome && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {errors.outcome}
            </p>
          )}
        </fieldset>
        {divergent && (
          <Alert variant="info" title="A decisão diverge da recomendação do parecer vigente.">
            Explique o motivo na justificativa.
          </Alert>
        )}
        <FormField
          label="Justificativa"
          error={errors.justification}
          hint={`Mínimo de ${MIN_JUSTIFICATION} caracteres. Fica registrada na auditoria.`}
          required
        >
          <Textarea
            rows={4}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            maxLength={5000}
          />
        </FormField>
        <div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            Confirmo que esta é uma decisão humana, tomada por mim com base na análise registrada.
          </label>
          {errors.confirmed && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {errors.confirmed}
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
