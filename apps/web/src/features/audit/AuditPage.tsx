import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link } from 'react-router';
import { ErrorState } from '@/app/pages/ErrorState';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { useListParams } from '@/lib/use-list-params';
import {
  ACTION_FILTERS,
  ACTION_LABELS,
  type AuditEvent,
  ENTITY_TYPE_LABELS,
  diffRows,
  useAuditEvents,
} from './audit-api';

/** Links to the screen of the audited record, when there is one. */
function entityLink(e: AuditEvent): string | null {
  if (e.entityType === 'CreditApplication') return `/solicitacoes/${e.entityId}`;
  if (e.entityType === 'Customer') return `/clientes/${e.entityId}`;
  const appId = (e.after?.applicationId ?? e.before?.applicationId) as string | undefined;
  return appId ? `/solicitacoes/${appId}?aba=analise` : null;
}

const show = (v: unknown) =>
  v === undefined
    ? '—'
    : v === null
      ? 'vazio'
      : typeof v === 'object'
        ? JSON.stringify(v)
        : String(v);

/** Audit trail viewer (admin only). Read-only: the trail is append-only. */
export function AuditPage() {
  const { values, page, set } = useListParams([
    'entityType',
    'entityId',
    'action',
    'from',
    'to',
  ] as const);
  const [expanded, setExpanded] = useState<string | null>(null);

  const events = useAuditEvents({
    entityType: values.entityType || undefined,
    entityId: values.entityId || undefined,
    action: values.action || undefined,
    // Date inputs are calendar days in the user's timezone; "to" is inclusive.
    from: values.from ? new Date(`${values.from}T00:00:00`).toISOString() : undefined,
    to: values.to
      ? new Date(new Date(`${values.to}T00:00:00`).getTime() + 86_400_000).toISOString()
      : undefined,
    page,
    pageSize: 25,
  });

  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Trilha imutável de ações relevantes: quem fez, quando, sobre o quê, antes e depois."
      />

      <div className="mb-4 grid gap-3 md:grid-cols-[auto_auto_1fr_auto_auto]">
        <Select
          aria-label="Entidade"
          value={values.entityType}
          onChange={(e) => set({ entityType: e.target.value })}
        >
          <option value="">Todas as entidades</option>
          {Object.entries(ENTITY_TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Ação"
          value={values.action}
          onChange={(e) => set({ action: e.target.value })}
        >
          {ACTION_FILTERS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Input
          aria-label="Id da entidade"
          placeholder="Id da entidade (opcional)"
          value={values.entityId}
          onChange={(e) => set({ entityId: e.target.value.trim() })}
        />
        <Input
          type="date"
          aria-label="De"
          value={values.from}
          onChange={(e) => set({ from: e.target.value })}
        />
        <Input
          type="date"
          aria-label="Até"
          value={values.to}
          onChange={(e) => set({ to: e.target.value })}
        />
      </div>

      {events.isPending ? (
        <Spinner />
      ) : events.isError ? (
        <ErrorState error={events.error} onRetry={() => void events.refetch()} />
      ) : (
        <>
          <Table aria-busy={events.isFetching}>
            <THead>
              <TR>
                <TH className="w-8">
                  <span className="sr-only">Detalhes</span>
                </TH>
                <TH>Data/hora</TH>
                <TH>Ação</TH>
                <TH>Entidade</TH>
                <TH>Ator</TH>
              </TR>
            </THead>
            <TBody>
              {events.data.data.length === 0 ? (
                <TR>
                  <TD colSpan={5} className="py-8 text-center text-muted-foreground">
                    Nenhum evento encontrado.
                  </TD>
                </TR>
              ) : (
                events.data.data.map((e) => {
                  const open = expanded === e.id;
                  const link = entityLink(e);
                  return (
                    <Fragment key={e.id}>
                      <TR>
                        <TD>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-expanded={open}
                            aria-label={open ? 'Ocultar detalhes' : 'Ver detalhes'}
                            onClick={() => setExpanded(open ? null : e.id)}
                          >
                            {open ? <ChevronDown /> : <ChevronRight />}
                          </Button>
                        </TD>
                        <TD className="whitespace-nowrap tabular-nums text-xs">
                          {formatDateTime(e.occurredAt)}
                        </TD>
                        <TD>
                          <span className="font-medium">{ACTION_LABELS[e.action] ?? e.action}</span>
                          <span className="block font-mono text-xs text-muted-foreground">
                            {e.action}
                          </span>
                        </TD>
                        <TD>
                          <Badge variant="secondary">
                            {ENTITY_TYPE_LABELS[e.entityType] ?? e.entityType}
                          </Badge>
                          {link ? (
                            <Link
                              to={link}
                              className="ml-2 font-mono text-xs text-primary hover:underline"
                            >
                              {e.entityId.slice(0, 8)}…
                            </Link>
                          ) : (
                            <span className="ml-2 font-mono text-xs text-muted-foreground">
                              {e.entityId.length > 12 ? `${e.entityId.slice(0, 8)}…` : e.entityId}
                            </span>
                          )}
                        </TD>
                        <TD>
                          {e.actor ? (
                            e.actor.name
                          ) : (
                            <span className="text-muted-foreground">anônimo</span>
                          )}
                        </TD>
                      </TR>
                      {open && (
                        <TR className="bg-muted/30 hover:bg-muted/30">
                          <TD />
                          <TD colSpan={4}>
                            <AuditDetails event={e} />
                          </TD>
                        </TR>
                      )}
                    </Fragment>
                  );
                })
              )}
            </TBody>
          </Table>
          <Pagination meta={events.data.meta} onPage={(p) => set({ page: p })} />
        </>
      )}
    </>
  );
}

function AuditDetails({ event }: { event: AuditEvent }) {
  const rows = diffRows(event.before, event.after);
  return (
    <div className="space-y-3 py-1 text-xs">
      {rows.length > 0 ? (
        <table className="w-full max-w-3xl border-collapse">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-3 font-medium">Campo</th>
              <th className="py-1 pr-3 font-medium">Antes</th>
              <th className="py-1 font-medium">Depois</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.field} className="border-t align-top">
                <td className="py-1 pr-3 font-mono">{r.field}</td>
                <td className={r.changed ? 'py-1 pr-3 line-through opacity-70' : 'py-1 pr-3'}>
                  {show(r.before)}
                </td>
                <td className={r.changed ? 'py-1 font-medium' : 'py-1'}>{show(r.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-muted-foreground">Sem dados antes/depois para este evento.</p>
      )}
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">Id do evento</dt>
        <dd className="font-mono">{event.id}</dd>
        <dt className="text-muted-foreground">Entidade</dt>
        <dd className="font-mono">{event.entityId}</dd>
        {event.actor && (
          <>
            <dt className="text-muted-foreground">Ator</dt>
            <dd>
              {event.actor.name} ({event.actor.email})
            </dd>
          </>
        )}
        {Object.entries(event.metadata ?? {}).map(([k, v]) => (
          <Fragment key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-all font-mono">{show(v)}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}
