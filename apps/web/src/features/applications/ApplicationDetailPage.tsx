import { Permission, isEditable } from '@creditflow/shared';
import { Pencil } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { ErrorState } from '@/app/pages/ErrorState';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { ApplicationStatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useHasPermission } from '@/features/auth/auth-api';
import { formatBRL, formatDateTime, formatDocument } from '@/lib/format';
import { ISSUE_STATUS_LABELS, PRODUCT_LABELS } from '@/lib/labels';
import { DocumentsSection } from './DocumentsSection';
import { StatusTimeline } from './StatusTimeline';
import { TransitionActions } from './TransitionActions';
import { type Application, useApplication, useIssues } from './applications-api';

export function ApplicationDetailPage() {
  const { id = '' } = useParams();
  const app = useApplication(id);
  if (app.isPending) return <Spinner />;
  if (app.isError) return <ErrorState error={app.error} onRetry={() => void app.refetch()} />;
  return <ApplicationDetail application={app.data} />;
}

function ApplicationDetail({ application: a }: { application: Application }) {
  const canEdit = useHasPermission(Permission.APPLICATION_WRITE) && isEditable(a.status);
  const isCompany = a.customer.type === 'COMPANY';

  return (
    <>
      <PageHeader
        title={a.code}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ApplicationStatusBadge status={a.status} />
            <Link to={`/clientes/${a.customer.id}`} className="text-primary hover:underline">
              {a.customer.name}
            </Link>
            <span>· {formatDocument(a.customer.documentNumber)}</span>
          </span>
        }
        actions={
          canEdit && (
            <Link
              to={`/solicitacoes/${a.id}/editar`}
              className={buttonVariants({ variant: 'outline' })}
            >
              <Pencil aria-hidden /> Editar dados
            </Link>
          )
        }
      />

      <div className="mb-6">
        <TransitionActions application={a} />
      </div>

      {a.status === 'PENDING_INFORMATION' && <OpenIssuesNotice applicationId={a.id} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Dados da solicitação</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 sm:grid-cols-3">
                <Field label="Tipo de crédito">{PRODUCT_LABELS[a.productType]}</Field>
                <Field label="Valor solicitado">{formatBRL(a.requestedAmount)}</Field>
                <Field label="Prazo">{a.termMonths} meses</Field>
                <Field
                  label={isCompany ? 'Faturamento mensal declarado' : 'Renda mensal declarada'}
                >
                  {formatBRL(a.declaredMonthlyIncome)}
                </Field>
                <Field label="Compromissos mensais declarados">
                  {formatBRL(a.declaredMonthlyCommitments)}
                </Field>
                <Field label="Responsável">{a.assignee?.name ?? 'Sem responsável'}</Field>
                <div className="sm:col-span-3">
                  <Field label="Finalidade declarada">{a.purpose}</Field>
                </div>
                <Field label="Aberta por">
                  {a.createdBy.name} · {formatDateTime(a.createdAt)}
                </Field>
                <Field label="Enviada para análise">{formatDateTime(a.submittedAt)}</Field>
                <Field label="Concluída">{formatDateTime(a.closedAt)}</Field>
              </dl>
            </CardContent>
          </Card>
          <DocumentsSection application={a} />
        </div>
        <div className="space-y-4">
          <StatusTimeline applicationId={a.id} />
        </div>
      </div>
    </>
  );
}

/** Tells the operator exactly what the analyst asked for. */
function OpenIssuesNotice({ applicationId }: { applicationId: string }) {
  const issues = useIssues(applicationId);
  const open = issues.data?.filter((i) => i.status === 'OPEN') ?? [];
  if (open.length === 0) return null;
  return (
    <Alert variant="warning" title="Pendências registradas pelo analista" className="mb-6">
      <ul className="list-disc pl-4">
        {open.map((i) => (
          <li key={i.id}>
            {i.description}{' '}
            <span className="text-xs opacity-75">({ISSUE_STATUS_LABELS[i.status]})</span>
          </li>
        ))}
      </ul>
      <p className="mt-2">Complemente os dados ou documentos e use “Devolver para análise”.</p>
    </Alert>
  );
}
