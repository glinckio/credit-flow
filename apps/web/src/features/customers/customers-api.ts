import type { CustomerStatus, CustomerType } from '@creditflow/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PageMeta } from '@/components/pagination';
import { api } from '@/lib/api';

export interface Address {
  street: string;
  number: string;
  complement: string | null;
  district: string;
  city: string;
  state: string;
  zipCode: string;
}

export interface Customer {
  id: string;
  type: CustomerType;
  name: string;
  documentNumber: string;
  email: string;
  phone: string;
  birthOrFoundationDate: string;
  address: Address;
  status: CustomerStatus;
  version: number;
  createdBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

export interface CustomerListParams {
  q?: string;
  type?: string;
  status?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export type CustomerPayload = Omit<
  Customer,
  'id' | 'status' | 'version' | 'createdBy' | 'createdAt' | 'updatedAt' | 'address'
> & { address: Omit<Address, 'complement'> & { complement?: string } };

export const customerKeys = {
  all: ['customers'] as const,
  list: (p: CustomerListParams) => ['customers', 'list', p] as const,
  detail: (id: string) => ['customers', 'detail', id] as const,
};

export function useCustomers(params: CustomerListParams) {
  return useQuery({
    queryKey: customerKeys.list(params),
    queryFn: ({ signal }) =>
      api.get<Page<Customer>>('/customers', { query: { ...params }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useCustomer(id: string) {
  return useQuery({
    queryKey: customerKeys.detail(id),
    queryFn: ({ signal }) => api.get<Customer>(`/customers/${id}`, { signal }),
    enabled: !!id,
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomerPayload) => api.post<Customer>('/customers', body),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: customerKeys.all });
      qc.setQueryData(customerKeys.detail(c.id), c);
    },
  });
}

export function useUpdateCustomer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      body: Partial<Omit<CustomerPayload, 'type' | 'documentNumber'>> & {
        version: number;
        status?: CustomerStatus;
      },
    ) => api.patch<Customer>(`/customers/${id}`, body),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: customerKeys.all });
      qc.setQueryData(customerKeys.detail(c.id), c);
    },
  });
}
