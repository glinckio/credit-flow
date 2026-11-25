import type { Role } from '@creditflow/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Page } from '@/features/customers/customers-api';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  canDecide: boolean;
  mustChangePassword: boolean;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserListParams {
  q?: string;
  role?: string;
  active?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

const keys = {
  all: ['users'] as const,
  list: (p: UserListParams) => ['users', 'list', p] as const,
};

export function useUsers(params: UserListParams) {
  return useQuery({
    queryKey: keys.list(params),
    queryFn: ({ signal }) => api.get<Page<AdminUser>>('/users', { query: { ...params }, signal }),
    placeholderData: keepPreviousData,
  });
}

function useUserMutation<TVars>(fn: (vars: TVars) => Promise<AdminUser>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.all });
    },
  });
}

export const useCreateUser = () =>
  useUserMutation(
    (body: {
      email: string;
      name: string;
      role: Role;
      canDecide: boolean;
      initialPassword: string;
    }) => api.post<AdminUser>('/users', body),
  );

export const useUpdateUser = () =>
  useUserMutation(
    ({ id, ...body }: { id: string; name?: string; role?: Role; canDecide?: boolean }) =>
      api.patch<AdminUser>(`/users/${id}`, body),
  );

export const useSetUserActive = () =>
  useUserMutation(({ id, active }: { id: string; active: boolean }) =>
    api.post<AdminUser>(`/users/${id}/${active ? 'activate' : 'deactivate'}`),
  );

export const useResetPassword = () =>
  useUserMutation(({ id, temporaryPassword }: { id: string; temporaryPassword: string }) =>
    api.post<AdminUser>(`/users/${id}/reset-password`, { temporaryPassword }),
  );

/** Random temporary password (shown once to the admin, who hands it over out of band). */
export function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
