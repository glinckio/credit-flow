import { zodResolver } from '@hookform/resolvers/zod';
import { isEditable } from '@creditflow/shared';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ErrorState } from '@/app/pages/ErrorState';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useCustomer } from '@/features/customers/customers-api';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDocument } from '@/lib/format';
import { applyApiFieldErrors } from '@/lib/form-errors';
import { PRODUCT_LABELS } from '@/lib/labels';
import {
  type ApplicationForm,
  applicationSchema,
  applicationToForm,
  emptyApplicationForm,
  toApplicationPayload,
} from './application-schema';
import {
  type Application,
  useApplication,
  useCreateApplication,
  useUpdateApplication,
} from './applications-api';

const FIELDS = [
  'productType',
  'requestedAmount',
  'termMonths',
  'purpose',
  'declaredMonthlyIncome',
  'declaredMonthlyCommitments',
] as const;

/** /solicitacoes/nova?clienteId=… (create) or /solicitacoes/:id/editar (edit). */
export function ApplicationFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const customerId = params.get('clienteId') ?? '';
  const existing = useApplication(id ?? '');
  const customer = useCustomer(id ? '' : customerId);

  if (id) {
    if (existing.isPending) return <Spinner />;
    if (existing.isError) return <ErrorState error={existing.error} />;
    if (!isEditable(existing.data.status)) {
      return (
        <Alert variant="warning" title="Esta solicitação não pode mais ser editada">
          Somente rascunhos e solicitações com pendência de informação podem ser alterados.{' '}
          <Link to={`/solicitacoes/${id}`} className="underline">
            Voltar à solicitação
          </Link>
        </Alert>
      );
    }
    return (
      <ApplicationFormView
        application={existing.data}
        customer={{
          id: existing.data.customer.id,
          name: existing.data.customer.name,
          documentNumber: existing.data.customer.documentNumber,
        }}
      />
    );
  }

  if (!customerId) {
    return (
      <Alert variant="info" title="Escolha o cliente primeiro">
        Abra o cadastro do cliente e use “Nova solicitação”.{' '}
        <Link to="/clientes" className="underline">
          Ir para clientes
        </Link>
      </Alert>
    );
  }
  if (customer.isPending) return <Spinner />;
  if (customer.isError) return <ErrorState error={customer.error} />;
  if (customer.data.status !== 'ACTIVE') {
    return <Alert variant="warning" title="Cliente inativo: não é possível abrir solicitações." />;
  }
  return <ApplicationFormView customer={customer.data} />;
}

function ApplicationFormView({
  application,
  customer,
}: {
  application?: Application;
  customer: { id: string; name: string; documentNumber: string };
}) {
  const navigate = useNavigate();
  const create = useCreateApplication();
  const update = useUpdateApplication(application?.id ?? '');
  const mutation = application ? update : create;

  const form = useForm<ApplicationForm>({
    resolver: zodResolver(applicationSchema),
    defaultValues: application ? applicationToForm(application) : emptyApplicationForm,
  });
  const { errors } = form.formState;
  const incomeLabel =
    customer.documentNumber.length === 14
      ? 'Faturamento médio mensal declarado'
      : 'Renda mensal declarada';

  const onSubmit = form.handleSubmit(async (values) => {
    const payload = toApplicationPayload(values);
    try {
      const saved = application
        ? await update.mutateAsync({ ...payload, version: application.version })
        : await create.mutateAsync({ ...payload, customerId: customer.id });
      toast.success(
        application ? 'Solicitação atualizada.' : 'Rascunho criado. Agora anexe os documentos.',
      );
      navigate(`/solicitacoes/${saved.id}`);
    } catch (err) {
      applyApiFieldErrors(err, form.setError, FIELDS);
    }
  });

  const apiError = mutation.error instanceof ApiError ? mutation.error : null;

  return (
    <>
      <PageHeader
        title={application ? `Editar ${application.code}` : 'Nova solicitação'}
        description={`${customer.name} · ${formatDocument(customer.documentNumber)}`}
      />
      <form onSubmit={onSubmit} noValidate className="max-w-3xl space-y-6">
        {apiError?.code === 'version-conflict' && (
          <Alert variant="warning" title="A solicitação foi alterada por outra pessoa">
            Recarregue a página para ver a versão atual.
          </Alert>
        )}
        {mutation.isError &&
          apiError?.code !== 'version-conflict' &&
          apiError?.code !== 'validation-error' && (
            <Alert variant="destructive" title={errorMessage(mutation.error)} />
          )}
        <Card>
          <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
            <FormField label="Tipo de crédito" error={errors.productType?.message} required>
              <Select {...form.register('productType')}>
                <option value="">Selecione…</option>
                {Object.entries(PRODUCT_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label="Valor solicitado (R$)"
              error={errors.requestedAmount?.message}
              required
            >
              <Input
                inputMode="decimal"
                placeholder="15.000,00"
                {...form.register('requestedAmount')}
              />
            </FormField>
            <FormField label="Prazo (meses)" error={errors.termMonths?.message} required>
              <Input inputMode="numeric" placeholder="24" {...form.register('termMonths')} />
            </FormField>
            <FormField
              label={`${incomeLabel} (R$)`}
              error={errors.declaredMonthlyIncome?.message}
              required
            >
              <Input inputMode="decimal" {...form.register('declaredMonthlyIncome')} />
            </FormField>
            <FormField
              label="Compromissos mensais declarados (R$)"
              error={errors.declaredMonthlyCommitments?.message}
              hint="Despesas fixas, outras parcelas. Opcional."
            >
              <Input inputMode="decimal" {...form.register('declaredMonthlyCommitments')} />
            </FormField>
            <FormField
              label="Finalidade declarada"
              error={errors.purpose?.message}
              required
              className="sm:col-span-2"
            >
              <Textarea rows={3} {...form.register('purpose')} />
            </FormField>
          </CardContent>
        </Card>
        <div className="flex gap-2">
          <Button type="submit" loading={mutation.isPending}>
            {application ? 'Salvar alterações' : 'Criar rascunho'}
          </Button>
          <Button variant="outline" onClick={() => navigate(-1)}>
            Cancelar
          </Button>
        </div>
      </form>
    </>
  );
}
