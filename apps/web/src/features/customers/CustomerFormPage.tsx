import { zodResolver } from '@hookform/resolvers/zod';
import { BRAZILIAN_STATES, CustomerType } from '@creditflow/shared';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ErrorState } from '@/app/pages/ErrorState';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDocument, maskCep, maskCnpj, maskCpf, maskPhone } from '@/lib/format';
import { applyApiFieldErrors } from '@/lib/form-errors';
import { CUSTOMER_TYPE_LABELS } from '@/lib/labels';
import {
  type CustomerForm,
  customerSchema,
  customerToForm,
  emptyCustomerForm,
  toCustomerPayload,
} from './customer-schema';
import { type Customer, useCreateCustomer, useCustomer, useUpdateCustomer } from './customers-api';

const FIELDS = [
  'type',
  'name',
  'documentNumber',
  'email',
  'phone',
  'birthOrFoundationDate',
  'address.street',
  'address.number',
  'address.complement',
  'address.district',
  'address.city',
  'address.state',
  'address.zipCode',
] as const;

export function CustomerFormPage() {
  const { id } = useParams();
  const existing = useCustomer(id ?? '');
  if (!id) return <CustomerForm />;
  if (existing.isPending) return <Spinner />;
  if (existing.isError) return <ErrorState error={existing.error} />;
  return <CustomerForm customer={existing.data} />;
}

function CustomerForm({ customer }: { customer?: Customer }) {
  const navigate = useNavigate();
  const create = useCreateCustomer();
  const update = useUpdateCustomer(customer?.id ?? '');
  const mutation = customer ? update : create;
  const editing = !!customer;

  const form = useForm<CustomerForm>({
    resolver: zodResolver(customerSchema),
    defaultValues: customer ? customerToForm(customer) : emptyCustomerForm,
  });
  const { errors } = form.formState;
  const type = useWatch({ control: form.control, name: 'type' });

  const onSubmit = form.handleSubmit(async (values) => {
    const payload = toCustomerPayload(values);
    try {
      if (customer) {
        const { type: _t, documentNumber: _d, ...editable } = payload;
        await update.mutateAsync({ ...editable, version: customer.version });
        toast.success('Cliente atualizado.');
        navigate(`/clientes/${customer.id}`);
      } else {
        const created = await create.mutateAsync(payload);
        toast.success('Cliente cadastrado.');
        navigate(`/clientes/${created.id}`);
      }
    } catch (err) {
      applyApiFieldErrors(err, form.setError, FIELDS);
    }
  });

  const apiError = mutation.error instanceof ApiError ? mutation.error : null;
  const duplicateOf =
    apiError?.code === 'customer-document-already-exists'
      ? String(apiError.problem.existingCustomerId ?? '')
      : null;

  const mask = (name: 'documentNumber' | 'phone' | 'address.zipCode', fn: (v: string) => string) =>
    form.register(name, {
      onChange: (e: { target: { value: string } }) => form.setValue(name, fn(e.target.value)),
    });

  return (
    <>
      <PageHeader
        title={editing ? 'Editar cliente' : 'Novo cliente'}
        description={editing ? customer.name : 'Use somente dados sintéticos.'}
      />
      <form onSubmit={onSubmit} noValidate className="max-w-3xl space-y-6">
        {duplicateOf && (
          <Alert variant="warning" title="Já existe um cliente com este CPF/CNPJ">
            <Link to={`/clientes/${duplicateOf}`} className="font-medium underline">
              Abrir o cadastro existente
            </Link>
          </Alert>
        )}
        {apiError?.code === 'version-conflict' && (
          <Alert variant="warning" title="Este cadastro foi alterado por outra pessoa">
            Recarregue a página para ver a versão atual antes de salvar novamente.
          </Alert>
        )}
        {mutation.isError &&
          !duplicateOf &&
          apiError?.code !== 'version-conflict' &&
          apiError?.code !== 'validation-error' && (
            <Alert variant="destructive" title={errorMessage(mutation.error)} />
          )}

        <Card>
          <CardHeader>
            <CardTitle>Identificação</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label="Tipo de cliente" error={errors.type?.message} required>
              <Select
                disabled={editing}
                {...form.register('type', {
                  onChange: () => form.setValue('documentNumber', ''),
                })}
              >
                {Object.entries(CUSTOMER_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </FormField>
            {editing ? (
              <FormField
                label={type === CustomerType.INDIVIDUAL ? 'CPF' : 'CNPJ'}
                hint="Não pode ser alterado."
              >
                <Input value={formatDocument(customer.documentNumber)} disabled readOnly />
              </FormField>
            ) : (
              <FormField
                label={type === CustomerType.INDIVIDUAL ? 'CPF' : 'CNPJ'}
                error={errors.documentNumber?.message}
                required
              >
                <Input
                  inputMode="numeric"
                  {...mask('documentNumber', type === CustomerType.INDIVIDUAL ? maskCpf : maskCnpj)}
                />
              </FormField>
            )}
            <FormField
              label={type === CustomerType.INDIVIDUAL ? 'Nome completo' : 'Razão social'}
              error={errors.name?.message}
              required
              className="sm:col-span-2"
            >
              <Input {...form.register('name')} />
            </FormField>
            <FormField
              label={
                type === CustomerType.INDIVIDUAL ? 'Data de nascimento' : 'Data de constituição'
              }
              error={errors.birthOrFoundationDate?.message}
              required
            >
              <Input type="date" {...form.register('birthOrFoundationDate')} />
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contato</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label="E-mail" error={errors.email?.message} required>
              <Input type="email" {...form.register('email')} />
            </FormField>
            <FormField label="Telefone" error={errors.phone?.message} required>
              <Input inputMode="tel" placeholder="(11) 90000-0000" {...mask('phone', maskPhone)} />
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Endereço</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-6">
            <FormField
              label="CEP"
              error={errors.address?.zipCode?.message}
              required
              className="sm:col-span-2"
            >
              <Input inputMode="numeric" {...mask('address.zipCode', maskCep)} />
            </FormField>
            <FormField
              label="Logradouro"
              error={errors.address?.street?.message}
              required
              className="sm:col-span-4"
            >
              <Input {...form.register('address.street')} />
            </FormField>
            <FormField
              label="Número"
              error={errors.address?.number?.message}
              required
              className="sm:col-span-2"
            >
              <Input {...form.register('address.number')} />
            </FormField>
            <FormField
              label="Complemento"
              error={errors.address?.complement?.message}
              className="sm:col-span-4"
            >
              <Input {...form.register('address.complement')} />
            </FormField>
            <FormField
              label="Bairro"
              error={errors.address?.district?.message}
              required
              className="sm:col-span-2"
            >
              <Input {...form.register('address.district')} />
            </FormField>
            <FormField
              label="Cidade"
              error={errors.address?.city?.message}
              required
              className="sm:col-span-3"
            >
              <Input {...form.register('address.city')} />
            </FormField>
            <FormField
              label="UF"
              error={errors.address?.state?.message}
              required
              className="sm:col-span-1"
            >
              <Select {...form.register('address.state')}>
                <option value="">—</option>
                {BRAZILIAN_STATES.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </Select>
            </FormField>
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" loading={mutation.isPending}>
            {editing ? 'Salvar alterações' : 'Cadastrar cliente'}
          </Button>
          <Button variant="outline" onClick={() => navigate(-1)}>
            Cancelar
          </Button>
        </div>
      </form>
    </>
  );
}
