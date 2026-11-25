import { Permission, isEditable } from '@creditflow/shared';
import { ClipboardCheck, FileText, History, Pencil } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ErrorState } from '@/app/pages/ErrorState';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { ApplicationStatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AssignButton } from '@/features/analysis/AssignDialog';
import { DecisionPanel } from '@/features/analysis/DecisionPanel';
import { DocumentValidationCell } from '@/features/analysis/DocumentValidationCell';
import { IndicatorsCard } from '@/features/analysis/IndicatorsCard';
import { IssuesPanel } from '@/features/analysis/IssuesPanel';
import { ReviewsPanel } from '@/features/analysis/ReviewsPanel';
import { useAnalysisAccess } from '@/features/analysis/use-analysis-access';
import { useHasPermission } from '@/features/auth/auth-api';
import { formatBRL, formatDateTime, formatDocument } from '@/lib/format';
import { PRODUCT_LABELS } from '@/lib/labels';
import { DocumentsSection } from './DocumentsSection';
import { StatusTimeline } from './StatusTimeline';
import { TransitionActions } from './TransitionActions';
import { type Application, useApplication, useIssues } from './applications-api';

const TABS = ['dados', 'analise', 'historico'] as const;
type Tab = (typeof TABS)[number];

export function ApplicationDetailPage() {
  const { id = '' } = useParams();
  const app = useApplication(id);
  if (app.isPending) return <Spinner />;
  if (app.isError) return <ErrorState error={app.error} onRetry={() => void app.refetch()} />;
  return <ApplicationDetail application={app.data} />;
}

function ApplicationDetail({ application: a }: { application: Application }) {
  const canWrite = useHasPermission(Permission.APPLICATION_WRITE);
  const canEdit = canWrite && isEditable(a.status);
  const access = useAnalysisAccess(a);
  const [params, setParams] = useSearchParams();
  const requested = params.get('aba') as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : 'dados';
  const setTab = (value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === 'dados') next.delete('aba');
        else next.set('aba', value);
        return next;
      },
      { replace: true },
    );

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
            {a.assignee && <span>· Responsável: {a.assignee.name}</span>}
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

      <div className="mb-6 flex flex-wrap gap-2">
        <TransitionActions application={a} />
        <AssignButton application={a} />
      </div>

      {a.status === 'PENDING_INFORMATION' && canWrite && <OpenIssuesNotice applicationId={a.id} />}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Seções da solicitação">
          <TabsTrigger value="dados">
            <FileText className="size-4" aria-hidden /> Dados e documentos
          </TabsTrigger>
          <TabsTrigger value="analise">
            <ClipboardCheck className="size-4" aria-hidden /> Análise
            {a.openIssueCount > 0 && <Badge variant="warning">{a.openIssueCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="historico">
            <History className="size-4" aria-hidden /> Histórico
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dados" className="space-y-4">
          <ApplicationData application={a} />
          <DocumentsSection
            application={a}
            extraColumn={
              access.canValidateDocuments
                ? {
                    header: 'Validar',
                    render: (doc) => <DocumentValidationCell applicationId={a.id} document={doc} />,
                  }
                : undefined
            }
          />
        </TabsContent>

        <TabsContent value="analise" className="space-y-4">
          {access.inAnalysis && !access.isAssignee && access.canDecide === false && (
            <Alert
              variant="info"
              title="Somente o analista responsável registra pendências, pareceres e validações."
            />
          )}
          <DecisionPanel application={a} />
          <div className="grid gap-4 xl:grid-cols-2">
            <IndicatorsCard applicationId={a.id} />
            <IssuesPanel application={a} />
          </div>
          <ReviewsPanel application={a} />
        </TabsContent>

        <TabsContent value="historico">
          <StatusTimeline applicationId={a.id} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function ApplicationData({ application: a }: { application: Application }) {
  const isCompany = a.customer.type === 'COMPANY';
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dados da solicitação</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 sm:grid-cols-3">
          <Field label="Tipo de crédito">{PRODUCT_LABELS[a.productType]}</Field>
          <Field label="Valor solicitado">{formatBRL(a.requestedAmount)}</Field>
          <Field label="Prazo">{a.termMonths} meses</Field>
          <Field label={isCompany ? 'Faturamento mensal declarado' : 'Renda mensal declarada'}>
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
          <li key={i.id}>{i.description}</li>
        ))}
      </ul>
      <p className="mt-2">Complemente os dados ou documentos e use “Devolver para análise”.</p>
    </Alert>
  );
}
