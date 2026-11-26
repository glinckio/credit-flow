import { useState } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/input';
import { ApiError, errorMessage } from '@/lib/api';
import { ACTION_LABELS } from '@/lib/labels';
import { type Application, type SimpleAction, useTransition } from './applications-api';

/** Transitions handled here; assignment and the final decision have their own dialogs. */
const HANDLED: readonly SimpleAction[] = [
  'submit',
  'start-review',
  'release',
  'request-information',
  'resume',
  'cancel',
  'reopen',
];

const CONFIG: Partial<
  Record<
    SimpleAction,
    { reason: 'required' | 'optional' | 'none'; description: string; danger?: boolean }
  >
> = {
  submit: {
    reason: 'none',
    description:
      'A solicitação vai para a fila de análise e deixa de poder ser editada. Documentos obrigatórios: identificação e comprovante de renda.',
  },
  'start-review': {
    reason: 'none',
    description: 'Você passa a ser o analista responsável por esta solicitação.',
  },
  release: { reason: 'none', description: 'A solicitação volta para a fila, sem responsável.' },
  'request-information': {
    reason: 'optional',
    description:
      'A solicitação volta ao operador para complementação. As pendências abertas ficam visíveis para ele.',
  },
  resume: {
    reason: 'optional',
    description:
      'Confirme que as informações pedidas foram complementadas. A análise continua com o mesmo analista.',
  },
  cancel: {
    reason: 'required',
    description: 'O cancelamento encerra a solicitação.',
    danger: true,
  },
  reopen: {
    reason: 'required',
    description: 'A solicitação volta para a fila de análise, sem responsável.',
  },
};

export function TransitionActions({ application }: { application: Application }) {
  const actions = HANDLED.filter((a) => application.availableActions.includes(a));
  const [open, setOpen] = useState<SimpleAction | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const transition = useTransition(application.id);

  if (actions.length === 0) return null;
  const config = open ? CONFIG[open] : undefined;

  const close = () => {
    setOpen(null);
    setReason('');
    setReasonError(null);
    transition.reset();
  };

  const confirm = async () => {
    if (!open) return;
    if (config?.reason === 'required' && reason.trim().length < 3) {
      setReasonError('Informe o motivo');
      return;
    }
    try {
      await transition.mutateAsync({ action: open, reason: reason.trim() || undefined });
      toast.success(`${ACTION_LABELS[open]}: concluído.`);
      close();
    } catch {
      // shown inside the dialog
    }
  };

  const err = transition.error;
  const noIssues =
    err instanceof ApiError && err.code === 'no-open-issues'
      ? 'Registre ao menos uma pendência (aba Análise) antes de solicitar informações.'
      : null;
  const missingDocs =
    err instanceof ApiError && err.code === 'missing-required-documents'
      ? err.problem.detail
      : null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button
            key={a}
            variant={CONFIG[a]?.danger ? 'outline' : a === actions[0] ? 'default' : 'secondary'}
            className={CONFIG[a]?.danger ? 'text-destructive' : undefined}
            onClick={() => setOpen(a)}
          >
            {ACTION_LABELS[a]}
          </Button>
        ))}
      </div>

      <Dialog
        open={open !== null}
        onOpenChange={(o) => !o && close()}
        title={open ? `${ACTION_LABELS[open]} — ${application.code}` : ''}
        description={config?.description}
        footer={
          <>
            <Button variant="outline" onClick={close}>
              Voltar
            </Button>
            <Button
              variant={config?.danger ? 'destructive' : 'default'}
              onClick={() => void confirm()}
              loading={transition.isPending}
            >
              Confirmar
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {transition.isError && (
            <Alert
              variant="destructive"
              title={
                missingDocs ? 'Documentos obrigatórios ausentes' : (noIssues ?? errorMessage(err))
              }
            >
              {missingDocs}
            </Alert>
          )}
          {config && config.reason !== 'none' && (
            <FormField
              label={config.reason === 'required' ? 'Motivo' : 'Observação (opcional)'}
              error={reasonError ?? undefined}
              required={config.reason === 'required'}
            >
              <Textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
              />
            </FormField>
          )}
        </div>
      </Dialog>
    </>
  );
}
