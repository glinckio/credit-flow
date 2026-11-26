import { Link } from 'react-router';
import { ApplicationStatusBadge } from '@/components/status-badge';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { formatBRL, formatDate } from '@/lib/format';
import { PRODUCT_LABELS } from '@/lib/labels';
import type { Application } from './applications-api';

export function ApplicationsTable({
  rows,
  showCustomer = true,
  busy,
}: {
  rows: Application[];
  showCustomer?: boolean;
  busy?: boolean;
}) {
  const cols = showCustomer ? 7 : 6;
  return (
    <Table aria-busy={busy}>
      <THead>
        <TR>
          <TH>Código</TH>
          {showCustomer && <TH>Cliente</TH>}
          <TH>Produto</TH>
          <TH className="text-right">Valor</TH>
          <TH>Status</TH>
          <TH>Responsável</TH>
          <TH>Abertura</TH>
        </TR>
      </THead>
      <TBody>
        {rows.length === 0 ? (
          <TR>
            <TD colSpan={cols} className="py-8 text-center text-muted-foreground">
              Nenhuma solicitação encontrada.
            </TD>
          </TR>
        ) : (
          rows.map((a) => (
            <TR key={a.id}>
              <TD>
                <Link
                  to={`/solicitacoes/${a.id}`}
                  className="font-medium text-primary tabular-nums hover:underline"
                >
                  {a.code}
                </Link>
              </TD>
              {showCustomer && <TD>{a.customer.name}</TD>}
              <TD>{PRODUCT_LABELS[a.productType]}</TD>
              <TD className="text-right tabular-nums">{formatBRL(a.requestedAmount)}</TD>
              <TD>
                <ApplicationStatusBadge status={a.status} />
              </TD>
              <TD className="text-muted-foreground">{a.assignee?.name ?? '—'}</TD>
              <TD className="tabular-nums text-muted-foreground">{formatDate(a.createdAt)}</TD>
            </TR>
          ))
        )}
      </TBody>
    </Table>
  );
}
