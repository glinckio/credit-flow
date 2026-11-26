import { Permission } from '@creditflow/shared';
import {
  FileText,
  LayoutDashboard,
  type LucideIcon,
  ScrollText,
  UserCog,
  Users,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Shown only to users holding this permission (the API enforces it too). */
  permission: Permission;
  /** Exact match for the active state (used by the root route). */
  end?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
    permission: Permission.DASHBOARD_READ,
    end: true,
  },
  { to: '/clientes', label: 'Clientes', icon: Users, permission: Permission.CUSTOMER_READ },
  {
    to: '/solicitacoes',
    label: 'Solicitações',
    icon: FileText,
    permission: Permission.APPLICATION_READ,
  },
  { to: '/admin/usuarios', label: 'Usuários', icon: UserCog, permission: Permission.USER_MANAGE },
  {
    to: '/admin/auditoria',
    label: 'Auditoria',
    icon: ScrollText,
    permission: Permission.AUDIT_READ,
  },
];

export function visibleNavItems(permissions: readonly Permission[]): NavItem[] {
  return NAV_ITEMS.filter((item) => permissions.includes(item.permission));
}
