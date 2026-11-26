import { Permission } from '@creditflow/shared';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ErrorState } from '@/app/pages/ErrorState';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useHasPermission } from '@/features/auth/auth-api';
import { APPLICATION_STATUS_LABELS, PRODUCT_LABELS } from '@/lib/labels';
import { useListParams } from '@/lib/use-list-params';
import { ApplicationsTable } from './ApplicationsTable';
import { useApplications } from './applications-api';

/** Status presets: "open" groups everything still in progress. */
const STATUS_PRESETS: [string, string][] = [
  ['', 'Todos os status'],
  ['SUBMITTED,UNDER_REVIEW,PENDING_INFORMATION', 'Em andamento'],
  ...Object.entries(APPLICATION_STATUS_LABELS),
];

const SORTS = [
  ['createdAt:desc', 'Mais recentes'],
  ['createdAt:asc', 'Mais antigas'],
  ['submittedAt:asc', 'Envio mais antigo (fila)'],
  ['requestedAmount:desc', 'Maior valor'],
  ['updatedAt:desc', 'Atualizadas recentemente'],
] as const;

export function ApplicationsListPage() {
  const reviews = useHasPermission(Permission.APPLICATION_REVIEW);
  const seesDrafts = useHasPermission(Permission.APPLICATION_WRITE);
  const { values, page, set } = useListParams([
    'status',
    'assigneeId',
    'productType',
    'q',
    'sort',
  ] as const);
  const [search, setSearch] = useState(values.q);

  useEffect(() => {
    if (search === values.q) return;
    const id = setTimeout(() => set({ q: search.trim() }), 300);
    return () => clearTimeout(id);
  }, [search, values.q, set]);

  const query = useApplications({
    status: values.status || undefined,
    assigneeId: values.assigneeId || undefined,
    productType: values.productType || undefined,
    q: values.q || undefined,
    sort: values.sort || 'createdAt:desc',
    page,
    pageSize: 20,
  });

  return (
    <>
      <PageHeader
        title="Solicitações"
        description={
          seesDrafts
            ? 'Para abrir uma solicitação, acesse o cadastro do cliente.'
            : 'Solicitações enviadas para análise (rascunhos não são exibidos).'
        }
      />

      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto_auto_auto_auto]">
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            aria-label="Buscar por código ou cliente"
            placeholder="Código (CF-2026-000012) ou nome do cliente"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          aria-label="Status"
          value={values.status}
          onChange={(e) => set({ status: e.target.value })}
        >
          {STATUS_PRESETS.filter(([v]) => seesDrafts || v !== 'DRAFT').map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        {reviews && (
          <Select
            aria-label="Responsável"
            value={values.assigneeId}
            onChange={(e) => set({ assigneeId: e.target.value })}
          >
            <option value="">Qualquer responsável</option>
            <option value="me">Atribuídas a mim</option>
            <option value="none">Sem responsável (fila)</option>
          </Select>
        )}
        <Select
          aria-label="Produto"
          value={values.productType}
          onChange={(e) => set({ productType: e.target.value })}
        >
          <option value="">Todos os produtos</option>
          {Object.entries(PRODUCT_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Ordenação"
          value={values.sort || 'createdAt:desc'}
          onChange={(e) => set({ sort: e.target.value })}
        >
          {SORTS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </div>

      {query.isPending ? (
        <Spinner />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <ApplicationsTable rows={query.data.data} busy={query.isFetching} />
          <Pagination meta={query.data.meta} onPage={(p) => set({ page: p })} />
        </>
      )}
    </>
  );
}
