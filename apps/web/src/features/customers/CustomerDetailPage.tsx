import { Permission } from '@creditflow/shared';
import { FilePlus, Pencil } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { ErrorState } from '@/app/pages/ErrorState';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useHasPermission } from '@/features/auth/auth-api';
import { ApplicationsTable } from '@/features/applications/ApplicationsTable';
import { useApplications } from '@/features/applications/applications-api';
import { formatDate, formatDateTime, formatDocument } from '@/lib/format';
import { CUSTOMER_STATUS_LABELS, CUSTOMER_TYPE_LABELS } from '@/lib/labels';
import { useCustomer } from './customers-api';

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const customer = useCustomer(id);
  const applications = useApplications({ customerId: id, sort: 'createdAt:desc', pageSize: 50 });
  const canEdit = useHasPermission(Permission.CUSTOMER_WRITE);
  const canOpen = useHasPermission(Permission.APPLICATION_WRITE);

  if (customer.isPending) return <Spinner />;
  if (customer.isError)
    return <ErrorState error={customer.error} onRetry={() => void customer.refetch()} />;
  const c = customer.data;
  const individual = c.type === 'INDIVIDUAL';

  return (
    <>
      <PageHeader
        title={c.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {CUSTOMER_TYPE_LABELS[c.type]} · {formatDocument(c.documentNumber)}
            <Badge variant={c.status === 'ACTIVE' ? 'success' : 'secondary'}>
              {CUSTOMER_STATUS_LABELS[c.status]}
            </Badge>
          </span>
        }
        actions={
          <>
            {canEdit && (
              <Link
                to={`/clientes/${c.id}/editar`}
                className={buttonVariants({ variant: 'outline' })}
              >
                <Pencil aria-hidden /> Editar
              </Link>
            )}
            {canOpen && c.status === 'ACTIVE' && (
              <Link to={`/solicitacoes/nova?clienteId=${c.id}`} className={buttonVariants()}>
                <FilePlus aria-hidden /> Nova solicitação
              </Link>
            )}
          </>
        }
      />

      {c.status !== 'ACTIVE' && (
        <Alert variant="warning" title="Cliente inativo" className="mb-4">
          Não é possível abrir novas solicitações para clientes inativos.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Dados cadastrais</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Field label="E-mail">{c.email}</Field>
              <Field label="Telefone">{c.phone}</Field>
              <Field label={individual ? 'Data de nascimento' : 'Data de constituição'}>
                {formatDate(c.birthOrFoundationDate)}
              </Field>
              <Field label="Cadastrado por">
                {c.createdBy.name} em {formatDateTime(c.createdAt)}
              </Field>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Endereço</CardTitle>
          </CardHeader>
          <CardContent>
            <address className="text-sm not-italic">
              {c.address.street}, {c.address.number}
              {c.address.complement ? ` – ${c.address.complement}` : ''}
              <br />
              {c.address.district} · {c.address.city}/{c.address.state}
              <br />
              CEP {c.address.zipCode.replace(/^(\d{5})(\d{3})$/, '$1-$2')}
            </address>
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Solicitações do cliente</h2>
      {applications.isPending ? (
        <Spinner />
      ) : applications.isError ? (
        <ErrorState error={applications.error} />
      ) : (
        <ApplicationsTable rows={applications.data.data} showCustomer={false} />
      )}
    </>
  );
}
