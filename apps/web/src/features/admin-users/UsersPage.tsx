import { KeyRound, Pencil, Plus, Power, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/app/pages/ErrorState';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { useCurrentUser } from '@/features/auth/auth-api';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { ROLE_LABELS } from '@/lib/labels';
import { useListParams } from '@/lib/use-list-params';
import { CreateUserDialog, EditUserDialog, ResetPasswordDialog } from './UserDialogs';
import { type AdminUser, useSetUserActive, useUsers } from './users-api';

export function UsersPage() {
  const { data: me } = useCurrentUser();
  const { values, page, set } = useListParams(['q', 'role', 'active'] as const);
  const [search, setSearch] = useState(values.q);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const setActive = useSetUserActive();

  useEffect(() => {
    if (search === values.q) return;
    const id = setTimeout(() => set({ q: search.trim() }), 300);
    return () => clearTimeout(id);
  }, [search, values.q, set]);

  const users = useUsers({
    q: values.q || undefined,
    role: values.role || undefined,
    active: values.active || undefined,
    sort: 'name:asc',
    page,
    pageSize: 20,
  });

  const toggleActive = (u: AdminUser) => {
    const action = u.active ? 'Desativar' : 'Reativar';
    const consequence = u.active ? ' Todas as sessões dele serão encerradas imediatamente.' : '';
    if (!window.confirm(`${action} ${u.name}?${consequence}`)) return;
    setActive.mutate(
      { id: u.id, active: !u.active },
      {
        onSuccess: () => toast.success(u.active ? 'Usuário desativado.' : 'Usuário reativado.'),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  return (
    <>
      <PageHeader
        title="Usuários"
        description="Papéis: Administrador, Analista de crédito e Operador. Alterações valem na próxima ação do usuário."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden /> Novo usuário
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            aria-label="Buscar por nome ou e-mail"
            placeholder="Buscar por nome ou e-mail"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          aria-label="Papel"
          value={values.role}
          onChange={(e) => set({ role: e.target.value })}
        >
          <option value="">Todos os papéis</option>
          {Object.entries(ROLE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Situação"
          value={values.active}
          onChange={(e) => set({ active: e.target.value })}
        >
          <option value="">Ativos e inativos</option>
          <option value="true">Ativos</option>
          <option value="false">Inativos</option>
        </Select>
      </div>

      {users.isPending ? (
        <Spinner />
      ) : users.isError ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : (
        <>
          <Table aria-busy={users.isFetching}>
            <THead>
              <TR>
                <TH>Nome</TH>
                <TH>Papel</TH>
                <TH>Situação</TH>
                <TH>Último acesso</TH>
                <TH className="w-32">
                  <span className="sr-only">Ações</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {users.data.data.map((u) => {
                const isSelf = u.id === me?.id;
                return (
                  <TR key={u.id}>
                    <TD>
                      <span className="font-medium">{u.name}</span>
                      {isSelf && <span className="ml-1 text-xs text-muted-foreground">(você)</span>}
                      <span className="block text-xs text-muted-foreground">{u.email}</span>
                    </TD>
                    <TD>
                      {ROLE_LABELS[u.role]}
                      {u.canDecide && u.role === 'OPERATOR' && (
                        <Badge variant="outline" className="ml-2">
                          pode decidir
                        </Badge>
                      )}
                    </TD>
                    <TD className="space-x-1">
                      <Badge variant={u.active ? 'success' : 'secondary'}>
                        {u.active ? 'Ativo' : 'Inativo'}
                      </Badge>
                      {u.mustChangePassword && <Badge variant="warning">senha temporária</Badge>}
                    </TD>
                    <TD className="text-xs text-muted-foreground">
                      {formatDateTime(u.lastLoginAt)}
                    </TD>
                    <TD>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          title="Editar"
                          aria-label={`Editar ${u.name}`}
                          onClick={() => setEditing(u)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          title="Redefinir senha"
                          aria-label={`Redefinir senha de ${u.name}`}
                          onClick={() => setResetting(u)}
                        >
                          <KeyRound />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={u.active ? 'size-8 text-destructive' : 'size-8 text-success'}
                          title={
                            isSelf
                              ? 'Você não pode desativar a si mesmo'
                              : u.active
                                ? 'Desativar'
                                : 'Reativar'
                          }
                          aria-label={`${u.active ? 'Desativar' : 'Reativar'} ${u.name}`}
                          disabled={isSelf || setActive.isPending}
                          onClick={() => toggleActive(u)}
                        >
                          <Power />
                        </Button>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <Pagination meta={users.data.meta} onPage={(p) => set({ page: p })} />
        </>
      )}

      <CreateUserDialog open={creating} onClose={() => setCreating(false)} />
      <EditUserDialog
        user={editing}
        isSelf={editing?.id === me?.id}
        onClose={() => setEditing(null)}
      />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
    </>
  );
}
