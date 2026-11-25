import { Permission } from '@creditflow/shared';
import { Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { ErrorState } from '@/app/pages/ErrorState';
import { useHasPermission } from '@/features/auth/auth-api';
import { formatDocument } from '@/lib/format';
import { CUSTOMER_STATUS_LABELS, CUSTOMER_TYPE_LABELS } from '@/lib/labels';
import { useListParams } from '@/lib/use-list-params';
import { useCustomers } from './customers-api';

const SORTS = [
  ['name:asc', 'Nome (A–Z)'],
  ['name:desc', 'Nome (Z–A)'],
  ['createdAt:desc', 'Mais recentes'],
  ['updatedAt:desc', 'Atualizados recentemente'],
] as const;

export function CustomersListPage() {
  const canWrite = useHasPermission(Permission.CUSTOMER_WRITE);
  const { values, page, set } = useListParams(['q', 'type', 'status', 'sort'] as const);
  const [search, setSearch] = useState(values.q);

  // Debounced search box → URL.
  useEffect(() => {
    if (search === values.q) return;
    const id = setTimeout(() => set({ q: search.trim() }), 300);
    return () => clearTimeout(id);
  }, [search, values.q, set]);

  const query = useCustomers({
    q: values.q || undefined,
    type: values.type || undefined,
    status: values.status || undefined,
    sort: values.sort || 'name:asc',
    page,
    pageSize: 20,
  });

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Pessoas físicas e jurídicas cadastradas (dados sintéticos)."
        actions={
          canWrite && (
            <Link to="/clientes/novo" className={buttonVariants()}>
              <Plus aria-hidden /> Novo cliente
            </Link>
          )
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            aria-label="Buscar por nome ou CPF/CNPJ"
            placeholder="Buscar por nome ou CPF/CNPJ"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          aria-label="Tipo"
          value={values.type}
          onChange={(e) => set({ type: e.target.value })}
        >
          <option value="">Todos os tipos</option>
          {Object.entries(CUSTOMER_TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Status"
          value={values.status}
          onChange={(e) => set({ status: e.target.value })}
        >
          <option value="">Todos os status</option>
          {Object.entries(CUSTOMER_STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Ordenação"
          value={values.sort || 'name:asc'}
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
          <Table aria-busy={query.isFetching}>
            <THead>
              <TR>
                <TH>Nome / razão social</TH>
                <TH>CPF/CNPJ</TH>
                <TH>Tipo</TH>
                <TH>Cidade/UF</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {query.data.data.length === 0 ? (
                <TR>
                  <TD colSpan={5} className="py-8 text-center text-muted-foreground">
                    Nenhum cliente encontrado.
                  </TD>
                </TR>
              ) : (
                query.data.data.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <Link
                        to={`/clientes/${c.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {c.name}
                      </Link>
                    </TD>
                    <TD className="tabular-nums">{formatDocument(c.documentNumber)}</TD>
                    <TD>{CUSTOMER_TYPE_LABELS[c.type]}</TD>
                    <TD>
                      {c.address.city}/{c.address.state}
                    </TD>
                    <TD>
                      <Badge variant={c.status === 'ACTIVE' ? 'success' : 'secondary'}>
                        {CUSTOMER_STATUS_LABELS[c.status]}
                      </Badge>
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
          <Pagination meta={query.data.meta} onPage={(p) => set({ page: p })} />
        </>
      )}
    </>
  );
}
