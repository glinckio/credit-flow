import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Page } from '@/features/customers/customers-api';

export interface AuditEvent {
  id: string;
  occurredAt: string;
  actor: { id: string; name: string; email: string } | null;
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

export interface AuditListParams {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
  from?: string;
  to?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export function useAuditEvents(params: AuditListParams) {
  return useQuery({
    queryKey: ['audit', params],
    queryFn: ({ signal }) =>
      api.get<Page<AuditEvent>>('/audit-events', { query: { ...params }, signal }),
    placeholderData: keepPreviousData,
  });
}

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  User: 'Usuário',
  Customer: 'Cliente',
  CreditApplication: 'Solicitação',
  CreditDocument: 'Documento',
  ApplicationIssue: 'Pendência',
  CreditReview: 'Parecer',
  CreditDecision: 'Decisão',
};

/** Human labels for audit actions; unknown actions fall back to the raw code. */
export const ACTION_LABELS: Record<string, string> = {
  'auth.login_succeeded': 'Login',
  'auth.login_failed': 'Falha de login',
  'auth.logout': 'Logout',
  'auth.password_changed': 'Troca de senha',
  'user.created': 'Usuário criado',
  'user.updated': 'Usuário alterado',
  'user.deactivated': 'Usuário desativado',
  'user.activated': 'Usuário reativado',
  'user.password_reset': 'Senha redefinida',
  'customer.created': 'Cliente cadastrado',
  'customer.updated': 'Cliente alterado',
  'application.created': 'Solicitação aberta',
  'application.updated': 'Solicitação alterada',
  'application.status_changed': 'Mudança de status',
  'application.assigned': 'Atribuição de responsável',
  'issue.created': 'Pendência registrada',
  'issue.resolved': 'Pendência resolvida',
  'document.uploaded': 'Documento anexado',
  'document.downloaded': 'Documento baixado',
  'document.validated': 'Documento validado',
  'document.removed': 'Documento removido',
  'review.created': 'Parecer registrado',
  'decision.recorded': 'Decisão registrada',
};

/** Action filter presets (exact action or "prefix." groups). */
export const ACTION_FILTERS: [string, string][] = [
  ['', 'Todas as ações'],
  ['auth.', 'Autenticação'],
  ['user.', 'Usuários'],
  ['customer.', 'Clientes'],
  ['application.', 'Solicitações'],
  ['document.', 'Documentos'],
  ['issue.', 'Pendências'],
  ['review.created', 'Pareceres'],
  ['decision.recorded', 'Decisões'],
  ['auth.login_failed', 'Falhas de login'],
];

/** Fields present in before/after with their two values, for a readable diff. */
export function diffRows(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): { field: string; before: unknown; after: unknown; changed: boolean }[] {
  const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  return fields.map((field) => {
    const b = before?.[field];
    const a = after?.[field];
    return { field, before: b, after: a, changed: JSON.stringify(b) !== JSON.stringify(a) };
  });
}
