import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { type Application, useTransition } from '@/features/applications/applications-api';
import { errorMessage } from '@/lib/api';
import { useActiveAnalysts } from './analysis-api';

/** Admin assigns (or re-assigns) an active analyst. */
export function AssignButton({ application }: { application: Application }) {
  const [open, setOpen] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const analysts = useActiveAnalysts(open);
  const transition = useTransition(application.id);

  if (!application.availableActions.includes('assign')) return null;

  const close = () => {
    setOpen(false);
    setAssigneeId('');
    setError(null);
    transition.reset();
  };
  const confirm = async () => {
    if (!assigneeId) {
      setError('Selecione o analista');
      return;
    }
    try {
      await transition.mutateAsync({ action: 'assign', assigneeId });
      toast.success('Analista atribuído.');
      close();
    } catch {
      // shown in the dialog
    }
  };

  const options = analysts.data?.data.filter((a) => a.id !== application.assignee?.id) ?? [];

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <UserPlus aria-hidden />{' '}
        {application.assignee ? 'Reatribuir analista' : 'Atribuir analista'}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => !o && close()}
        title={`Atribuir analista — ${application.code}`}
        description={
          application.assignee
            ? `Responsável atual: ${application.assignee.name}.`
            : 'A solicitação sai da fila e entra em análise.'
        }
        footer={
          <>
            <Button variant="outline" onClick={close}>
              Voltar
            </Button>
            <Button onClick={() => void confirm()} loading={transition.isPending}>
              Atribuir
            </Button>
          </>
        }
      >
        {transition.isError && (
          <Alert variant="destructive" title={errorMessage(transition.error)} className="mb-3" />
        )}
        {analysts.isPending ? (
          <Spinner label="Carregando analistas…" />
        ) : analysts.isError ? (
          <Alert variant="destructive" title={errorMessage(analysts.error)} />
        ) : (
          <FormField label="Analista" error={error ?? undefined} required>
            <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Selecione…</option>
              {options.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </FormField>
        )}
      </Dialog>
    </>
  );
}
