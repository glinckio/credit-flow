import { type Permission, type Role } from '@creditflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import { ME_QUERY_KEY } from '@/lib/query-client';

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  canDecide: boolean;
  mustChangePassword: boolean;
  permissions: Permission[];
}

/**
 * The signed-in user, or `null` when there is no valid session. The session
 * itself lives in an httpOnly cookie; this query is the UI's only view of it.
 */
export function useCurrentUser() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async ({ signal }) => {
      try {
        return (await api.get<{ user: CurrentUser }>('/auth/me', { signal })).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
  });
}

export function useHasPermission(permission: Permission): boolean {
  const { data } = useCurrentUser();
  return !!data?.permissions.includes(permission);
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api.post<{ user: CurrentUser }>('/auth/login', input),
    onSuccess: ({ user }) => {
      qc.clear(); // nothing from a previous session may leak into this one
      qc.setQueryData(ME_QUERY_KEY, user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSettled: () => {
      qc.clear();
      qc.setQueryData(ME_QUERY_KEY, null);
    },
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      api.post<{ user: CurrentUser }>('/auth/change-password', input),
    onSuccess: ({ user }) => qc.setQueryData(ME_QUERY_KEY, user),
  });
}
