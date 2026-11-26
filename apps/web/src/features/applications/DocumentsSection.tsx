import { DocumentType, Permission, isEditable } from '@creditflow/shared';
import { Download, Trash2, Upload } from 'lucide-react';
import { type FormEvent, type ReactNode, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/app/pages/ErrorState';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { useHasPermission } from '@/features/auth/auth-api';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatFileSize } from '@/lib/format';
import {
  DOCUMENT_TYPE_LABELS,
  VALIDATION_STATUS_BADGE,
  VALIDATION_STATUS_LABELS,
} from '@/lib/labels';
import { checkUploadFile } from './upload-file';
import {
  type Application,
  type CreditDocument,
  documentDownloadUrl,
  useDocuments,
  useRemoveDocument,
  useUploadDocument,
} from './applications-api';

export function DocumentsSection({
  application,
  extraColumn,
}: {
  application: Application;
  /** Optional extra cell per document (used by the analysis panel for validation). */
  extraColumn?: { header: string; render: (doc: CreditDocument) => ReactNode };
}) {
  const docs = useDocuments(application.id);
  const canUpload = useHasPermission(Permission.DOCUMENT_UPLOAD) && isEditable(application.status);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documentos</CardTitle>
        <CardDescription>
          Obrigatórios para envio: identificação e comprovante de renda/faturamento. Arquivos são
          baixados como anexo e nunca abertos no navegador.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {docs.isPending ? (
          <Spinner />
        ) : docs.isError ? (
          <ErrorState error={docs.error} onRetry={() => void docs.refetch()} />
        ) : (
          <DocumentsTable
            application={application}
            rows={docs.data}
            canRemove={canUpload}
            extraColumn={extraColumn}
          />
        )}
        {canUpload && <UploadForm applicationId={application.id} />}
      </CardContent>
    </Card>
  );
}

function DocumentsTable({
  application,
  rows,
  canRemove,
  extraColumn,
}: {
  application: Application;
  rows: CreditDocument[];
  canRemove: boolean;
  extraColumn?: Parameters<typeof DocumentsSection>[0]['extraColumn'];
}) {
  const remove = useRemoveDocument(application.id);
  const onRemove = (id: string, name: string) => {
    if (!window.confirm(`Remover "${name}" desta solicitação?`)) return;
    remove.mutate(id, {
      onSuccess: () => toast.success('Documento removido.'),
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  return (
    <Table>
      <THead>
        <TR>
          <TH>Tipo</TH>
          <TH>Arquivo</TH>
          <TH>Enviado</TH>
          <TH>Validação</TH>
          {extraColumn && <TH>{extraColumn.header}</TH>}
          <TH className="w-24">
            <span className="sr-only">Ações</span>
          </TH>
        </TR>
      </THead>
      <TBody>
        {rows.length === 0 ? (
          <TR>
            <TD colSpan={extraColumn ? 6 : 5} className="py-6 text-center text-muted-foreground">
              Nenhum documento anexado.
            </TD>
          </TR>
        ) : (
          rows.map((d) => (
            <TR key={d.id}>
              <TD>
                {DOCUMENT_TYPE_LABELS[d.type]}
                {d.otherDescription && (
                  <span className="block text-xs text-muted-foreground">{d.otherDescription}</span>
                )}
              </TD>
              <TD>
                <span className="block max-w-56 truncate" title={d.originalName}>
                  {d.originalName}
                </span>
                <span className="text-xs text-muted-foreground">{formatFileSize(d.sizeBytes)}</span>
              </TD>
              <TD className="text-xs text-muted-foreground">
                {formatDateTime(d.uploadedAt)}
                <br />
                {d.uploadedBy.name}
              </TD>
              <TD>
                <Badge variant={VALIDATION_STATUS_BADGE[d.validationStatus]}>
                  {VALIDATION_STATUS_LABELS[d.validationStatus]}
                </Badge>
                {d.validationNotes && (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {d.validationNotes}
                  </span>
                )}
              </TD>
              {extraColumn && <TD>{extraColumn.render(d)}</TD>}
              <TD>
                <div className="flex gap-1">
                  <a
                    href={documentDownloadUrl(d.id)}
                    download
                    className="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent"
                    aria-label={`Baixar ${d.originalName}`}
                    title="Baixar"
                  >
                    <Download className="size-4" />
                  </a>
                  {canRemove && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive"
                      aria-label={`Remover ${d.originalName}`}
                      title="Remover"
                      onClick={() => onRemove(d.id, d.originalName)}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </TD>
            </TR>
          ))
        )}
      </TBody>
    </Table>
  );
}

function UploadForm({ applicationId }: { applicationId: string }) {
  const upload = useUploadDocument(applicationId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<DocumentType | ''>('');
  const [otherDescription, setOtherDescription] = useState('');
  const [errors, setErrors] = useState<{ type?: string; file?: string; other?: string }>({});

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    const next: typeof errors = {};
    if (!type) next.type = 'Selecione o tipo';
    if (!file) next.file = 'Selecione um arquivo';
    else next.file = checkUploadFile(file) ?? undefined;
    if (type === DocumentType.OTHER && otherDescription.trim().length < 3)
      next.other = 'Descreva o documento';
    setErrors(next);
    if (Object.values(next).some(Boolean) || !file || !type) return;

    try {
      await upload.mutateAsync({
        file,
        type,
        otherDescription: type === DocumentType.OTHER ? otherDescription.trim() : undefined,
      });
      toast.success('Documento anexado.');
      setType('');
      setOtherDescription('');
      if (fileRef.current) fileRef.current.value = '';
    } catch {
      // shown below
    }
  };

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      noValidate
      className="rounded-md border border-dashed p-4"
    >
      <p className="mb-3 text-sm font-medium">Anexar documento</p>
      {upload.isError && (
        <Alert variant="destructive" title={errorMessage(upload.error)} className="mb-3" />
      )}
      <div className="grid gap-3 md:grid-cols-[14rem_1fr_auto] md:items-start">
        <FormField label="Tipo" error={errors.type} required>
          <Select value={type} onChange={(e) => setType(e.target.value as DocumentType)}>
            <option value="">Selecione…</option>
            {Object.entries(DOCUMENT_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Arquivo" error={errors.file} hint="PDF, PNG ou JPEG, até 10 MB." required>
          <Input
            ref={fileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
            className="py-1.5"
          />
        </FormField>
        <Button type="submit" className="md:mt-6" loading={upload.isPending}>
          <Upload aria-hidden /> Anexar
        </Button>
        {type === DocumentType.OTHER && (
          <FormField
            label="Descrição do documento"
            error={errors.other}
            required
            className="md:col-span-2"
          >
            <Input
              value={otherDescription}
              onChange={(e) => setOtherDescription(e.target.value)}
              maxLength={120}
            />
          </FormField>
        )}
      </div>
    </form>
  );
}
