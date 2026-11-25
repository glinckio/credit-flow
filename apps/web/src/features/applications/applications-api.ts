import type {
  ApplicationAction,
  ApplicationStatus,
  CreditProductType,
  CustomerStatus,
  CustomerType,
  DocumentType,
  DocumentValidationStatus,
  IssueStatus,
} from '@creditflow/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Page } from '@/features/customers/customers-api';

type UserRef = { id: string; name: string };

export interface Application {
  id: string;
  number: number;
  code: string;
  customer: {
    id: string;
    name: string;
    type: CustomerType;
    documentNumber: string;
    status: CustomerStatus;
  };
  productType: CreditProductType;
  requestedAmount: string;
  termMonths: number;
  purpose: string;
  declaredMonthlyIncome: string;
  declaredMonthlyCommitments: string | null;
  status: ApplicationStatus;
  assignee: UserRef | null;
  createdBy: UserRef;
  submittedAt: string | null;
  decidedAt: string | null;
  closedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  documentCount: number;
  openIssueCount: number;
  availableActions: ApplicationAction[];
}

export interface StatusHistoryEntry {
  id: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  actor: UserRef;
  reason: string | null;
  createdAt: string;
}

export interface CreditDocument {
  id: string;
  applicationId: string;
  type: DocumentType;
  otherDescription: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedBy: UserRef;
  uploadedAt: string;
  validationStatus: DocumentValidationStatus;
  validationNotes: string | null;
  validatedBy: UserRef | null;
  validatedAt: string | null;
}

export interface Issue {
  id: string;
  applicationId: string;
  description: string;
  status: IssueStatus;
  createdBy: UserRef;
  createdAt: string;
  resolvedBy: UserRef | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface ApplicationListParams {
  status?: string;
  customerId?: string;
  assigneeId?: string;
  productType?: string;
  q?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export interface ApplicationPayload {
  customerId: string;
  productType: CreditProductType;
  requestedAmount: string;
  termMonths: number;
  purpose: string;
  declaredMonthlyIncome: string;
  declaredMonthlyCommitments: string | null;
}

export const applicationKeys = {
  all: ['applications'] as const,
  list: (p: ApplicationListParams) => ['applications', 'list', p] as const,
  detail: (id: string) => ['applications', 'detail', id] as const,
  history: (id: string) => ['applications', 'detail', id, 'history'] as const,
  documents: (id: string) => ['applications', 'detail', id, 'documents'] as const,
  issues: (id: string) => ['applications', 'detail', id, 'issues'] as const,
};

export function useApplications(params: ApplicationListParams, enabled = true) {
  return useQuery({
    queryKey: applicationKeys.list(params),
    queryFn: ({ signal }) =>
      api.get<Page<Application>>('/applications', { query: { ...params }, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useApplication(id: string) {
  return useQuery({
    queryKey: applicationKeys.detail(id),
    queryFn: ({ signal }) => api.get<Application>(`/applications/${id}`, { signal }),
    enabled: !!id,
  });
}

export function useStatusHistory(id: string) {
  return useQuery({
    queryKey: applicationKeys.history(id),
    queryFn: ({ signal }) =>
      api.get<StatusHistoryEntry[]>(`/applications/${id}/status-history`, { signal }),
  });
}

export function useIssues(id: string) {
  return useQuery({
    queryKey: applicationKeys.issues(id),
    queryFn: ({ signal }) => api.get<Issue[]>(`/applications/${id}/issues`, { signal }),
  });
}

/** Refreshes everything that depends on an application after a change. */
function useInvalidateApplication() {
  const qc = useQueryClient();
  return (app: Application) => {
    qc.setQueryData(applicationKeys.detail(app.id), app);
    void qc.invalidateQueries({ queryKey: applicationKeys.all });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useCreateApplication() {
  const done = useInvalidateApplication();
  return useMutation({
    mutationFn: (body: ApplicationPayload) => api.post<Application>('/applications', body),
    onSuccess: done,
  });
}

export function useUpdateApplication(id: string) {
  const done = useInvalidateApplication();
  return useMutation({
    mutationFn: (body: Partial<Omit<ApplicationPayload, 'customerId'>> & { version: number }) =>
      api.patch<Application>(`/applications/${id}`, body),
    onSuccess: done,
  });
}

/** Simple transitions that take at most a reason (and an assignee for `assign`). */
export type SimpleAction = Exclude<ApplicationAction, 'approve' | 'reject'>;

export function useTransition(id: string) {
  const done = useInvalidateApplication();
  return useMutation({
    mutationFn: ({
      action,
      reason,
      assigneeId,
    }: {
      action: SimpleAction;
      reason?: string;
      assigneeId?: string;
    }) =>
      api.post<Application>(
        `/applications/${id}/${action}`,
        action === 'assign' ? { assigneeId } : reason ? { reason } : {},
      ),
    onSuccess: done,
  });
}

// ───────────────────────────── documents ─────────────────────────────

export function useDocuments(applicationId: string) {
  return useQuery({
    queryKey: applicationKeys.documents(applicationId),
    queryFn: ({ signal }) =>
      api.get<CreditDocument[]>(`/applications/${applicationId}/documents`, { signal }),
  });
}

export function documentDownloadUrl(documentId: string): string {
  return `/api/v1/documents/${documentId}/content`;
}

export function useUploadDocument(applicationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      file,
      type,
      otherDescription,
    }: {
      file: File;
      type: DocumentType;
      otherDescription?: string;
    }) => {
      const body = new FormData();
      body.set('type', type);
      if (otherDescription) body.set('otherDescription', otherDescription);
      body.set('file', file);
      return api.post<CreditDocument>(`/applications/${applicationId}/documents`, body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: applicationKeys.detail(applicationId) });
    },
  });
}

export function useRemoveDocument(applicationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => api.delete(`/documents/${documentId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: applicationKeys.detail(applicationId) });
    },
  });
}
