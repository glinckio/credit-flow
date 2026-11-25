import { APP_NAME } from '@creditflow/shared';
import { KeyRound, LogOut } from 'lucide-react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useCurrentUser, useLogout } from '@/features/auth/auth-api';
import { ROLE_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { CHANGE_PASSWORD_PATH } from './guards';
import { visibleNavItems } from './navigation';

export function AppLayout() {
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const navigate = useNavigate();
  if (!user) return null; // RequireAuth renders this layout only with a user

  // While a temporary password is pending, only the change-password screen is reachable.
  const items = user.mustChangePassword ? [] : visibleNavItems(user.permissions);

  const onLogout = () =>
    logout.mutate(undefined, {
      onSettled: () => {
        toast.success('Sessão encerrada.');
        navigate('/login', { replace: true });
      },
    });

  return (
    <div className="flex min-h-full">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
        <Link to="/" className="px-5 py-4 text-lg font-semibold tracking-tight">
          {APP_NAME}
        </Link>
        <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-1 px-3">
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                  isActive && 'bg-accent text-accent-foreground',
                )
              }
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <p className="px-5 py-3 text-xs text-muted-foreground">Dados sintéticos · decisão humana</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b bg-card px-4 py-3 md:px-6">
          <nav
            aria-label="Navegação principal (compacta)"
            className="flex gap-3 overflow-x-auto md:hidden"
          >
            {items.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'text-sm whitespace-nowrap text-muted-foreground',
                    isActive && 'font-medium text-foreground',
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right leading-tight">
              <p className="text-sm font-medium" data-testid="current-user-name">
                {user.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {ROLE_LABELS[user.role]}
                {user.canDecide && user.role === 'OPERATOR' ? ' · pode decidir' : ''}
              </p>
            </div>
            {!user.mustChangePassword && (
              <Button
                variant="ghost"
                size="icon"
                title="Trocar senha"
                aria-label="Trocar senha"
                onClick={() => navigate(CHANGE_PASSWORD_PATH)}
              >
                <KeyRound />
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onLogout} loading={logout.isPending}>
              <LogOut aria-hidden />
              Sair
            </Button>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
