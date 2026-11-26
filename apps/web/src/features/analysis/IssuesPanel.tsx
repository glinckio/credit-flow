import { CheckCircle2, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/app/pages/ErrorState';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { type Application, type Issue, useIssues } from '@/features/applications/applications-api';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { ISSUE_STATUS_LABELS } from '@/lib/labels';
import { useCreateIssue, useResolveIssue } from './analysis-api';
import { useAnalysisAccess } from './use-analysis-access';

/** Pendências: what is missing before the analysis can conclude. */
export function IssuesPanel({ application }: { application: Application }) {
  const issues = useIssues(application.id);
  const { canAnalyse } = useAnalysisAccess(application);
  const [resolving, setResolving] = useState<Issue | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pendências</CardTitle>
        <CardDescription>
          Pendências abertas impedem a aprovação. Para devolver a solicitação ao operador, use
          “Solicitar informações”.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {issues.isPending ? (
          <Spinner />
        ) : issues.isError ? (
          <ErrorState error={issues.error} />
        ) : issues.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma pendência registrada.</p>
        ) : (
          <ul className="space-y-3">
            {issues.data.map((i) => (
              <li key={i.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm">{i.description}</p>
                  <Badge variant={i.status === 'OPEN' ? 'warning' : 'success'}>
                    {ISSUE_STATUS_LABELS[i.status]}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Aberta por {i.createdBy.name} em {formatDateTime(i.createdAt)}
                </p>
                {i.status === 'RESOLVED' ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Resolvida por {i.resolvedBy?.name} em {formatDateTime(i.resolvedAt)}: “
                    {i.resolutionNote}”
                  </p>
                ) : (
                  canAnalyse && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => setResolving(i)}
                    >
                      <CheckCircle2 aria-hidden /> Marcar como resolvida
                    </Button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
        {canAnalyse && <NewIssueForm applicationId={application.id} />}
      </CardContent>
      <ResolveDialog
        applicationId={application.id}
        issue={resolving}
        onClose={() => setResolving(null)}
      />
    </Card>
  );
}

function NewIssueForm({ applicationId }: { applicationId: string }) {
  const create = useCreateIssue(applicationId);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (description.trim().length < 5) {
      setError('Descreva a pendência (mín. 5 caracteres)');
      return;
    }
    setError(null);
    try {
      await create.mutateAsync(description.trim());
      setDescription('');
      toast.success('Pendência registrada.');
    } catch {
      // shown below
    }
  };

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      noValidate
      className="space-y-2 rounded-md border border-dashed p-3"
    >
      {create.isError && <Alert variant="destructive" title={errorMessage(create.error)} />}
      <FormField label="Nova pendência" error={error ?? undefined}>
        <Textarea
          rows={2}
          placeholder="Ex.: Enviar extrato bancário dos últimos 3 meses."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
        />
      </FormField>
      <Button type="submit" size="sm" loading={create.isPending}>
        <Plus aria-hidden /> Registrar pendência
      </Button>
    </form>
  );
}

function ResolveDialog({
  applicationId,
  issue,
  onClose,
}: {
  applicationId: string;
  issue: Issue | null;
  onClose: () => void;
}) {
  const resolve = useResolveIssue(applicationId);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setNote('');
    setError(null);
    resolve.reset();
    onClose();
  };
  const confirm = async () => {
    if (!issue) return;
    if (note.trim().length < 3) {
      setError('Descreva como a pendência foi resolvida');
      return;
    }
    try {
      await resolve.mutateAsync({ issueId: issue.id, resolutionNote: note.trim() });
      toast.success('Pendência resolvida.');
      close();
    } catch {
      // shown in the dialog
    }
  };

  return (
    <Dialog
      open={issue !== null}
      onOpenChange={(o) => !o && close()}
      title="Resolver pendência"
      description={issue?.description}
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Voltar
          </Button>
          <Button onClick={() => void confirm()} loading={resolve.isPending}>
            Confirmar
          </Button>
        </>
      }
    >
      {resolve.isError && (
        <Alert variant="destructive" title={errorMessage(resolve.error)} className="mb-3" />
      )}
      <FormField label="Resolução" error={error ?? undefined} required>
        <Textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
        />
      </FormField>
    </Dialog>
  );
}
