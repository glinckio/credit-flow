import type { DocumentValidationStatus } from '@creditflow/shared';
import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/input';
import type { CreditDocument } from '@/features/applications/applications-api';
import { errorMessage } from '@/lib/api';
import { DOCUMENT_TYPE_LABELS } from '@/lib/labels';
import { useValidateDocument } from './analysis-api';

/** Accept / reject buttons for the assigned analyst; rejection requires notes. */
export function DocumentValidationCell({
  applicationId,
  document,
}: {
  applicationId: string;
  document: CreditDocument;
}) {
  const validate = useValidateDocument(applicationId);
  const [rejecting, setRejecting] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const send = async (status: DocumentValidationStatus, n?: string) => {
    try {
      await validate.mutateAsync({ documentId: document.id, status, notes: n });
      toast.success(status === 'ACCEPTED' ? 'Documento aceito.' : 'Documento rejeitado.');
      return true;
    } catch (e) {
      if (status === 'ACCEPTED') toast.error(errorMessage(e));
      return false;
    }
  };

  const confirmReject = async () => {
    if (notes.trim().length < 3) {
      setError('Explique o motivo da rejeição');
      return;
    }
    if (await send('REJECTED', notes.trim())) {
      setRejecting(false);
      setNotes('');
      setError(null);
    }
  };

  return (
    <div className="flex gap-1">
      <Button
        size="icon"
        variant="outline"
        className="size-8"
        title="Aceitar"
        disabled={document.validationStatus === 'ACCEPTED' || validate.isPending}
        onClick={() => void send('ACCEPTED')}
        aria-label={`Aceitar ${document.originalName}`}
      >
        <Check aria-hidden />
      </Button>
      <Button
        size="icon"
        variant="outline"
        className="size-8 text-destructive"
        title="Rejeitar"
        disabled={validate.isPending}
        onClick={() => setRejecting(true)}
        aria-label={`Rejeitar ${document.originalName}`}
      >
        <X aria-hidden />
      </Button>
      <Dialog
        open={rejecting}
        onOpenChange={(o) => {
          if (!o) {
            setRejecting(false);
            setError(null);
            validate.reset();
          }
        }}
        title="Rejeitar documento"
        description={`${DOCUMENT_TYPE_LABELS[document.type]} — ${document.originalName}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setRejecting(false)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmReject()}
              loading={validate.isPending}
            >
              Rejeitar documento
            </Button>
          </>
        }
      >
        {validate.isError && (
          <Alert variant="destructive" title={errorMessage(validate.error)} className="mb-3" />
        )}
        <FormField label="Motivo da rejeição" error={error ?? undefined} required>
          <Textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={1000}
          />
        </FormField>
      </Dialog>
    </div>
  );
}
