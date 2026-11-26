import type {
  DecisionOutcome,
  DocumentValidationStatus,
  ReviewRecommendation,
} from '@creditflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  type Application,
  type CreditDocument,
  type Issue,
  applicationKeys,
} from '@/features/applications/applications-api';
import type { Page } from '@/features/customers/customers-api';

type UserRef = { id: string; name: string };

export interface Indicator {
  key: string;
  label: string;
  formula: string;
  value: string | null;
  unit: 'BRL' | 'ratio' | 'months';
}

export interface Review {
  id: string;
  applicationId: string;
  author: UserRef;
  recommendation: ReviewRecommendation;
  analysisNotes: string;
  justification: string;
  current: boolean;
  createdAt: string;
}

export interface Decision {
  id: string;
  applicationId: string;
  outcome: DecisionOutcome;
  justification: string;
  decidedBy: UserRef;
  decidedAt: string;
  reviewId: string;
  reviewRecommendation: ReviewRecommendation;
}

export const analysisKeys = {
  indicators: (id: string) => [...applicationKeys.detail(id), 'indicators'] as const,
  reviews: (id: string) => [...applicationKeys.detail(id), 'reviews'] as const,
  decision: (id: string) => [...applicationKeys.detail(id), 'decision'] as const,
  analysts: ['users', 'analysts'] as const,
};

export function useIndicators(applicationId: string) {
  return useQuery({
    queryKey: analysisKeys.indicators(applicationId),
    queryFn: ({ signal }) =>
      api.get<{ indicators: Indicator[]; disclaimer: string }>(
        `/applications/${applicationId}/indicators`,
        { signal },
      ),
  });
}

export function useReviews(applicationId: string) {
  return useQuery({
    queryKey: analysisKeys.reviews(applicationId),
    queryFn: ({ signal }) =>
      api.get<Review[]>(`/applications/${applicationId}/reviews`, { signal }),
  });
}

export function useDecision(applicationId: string, enabled: boolean) {
  return useQuery({
    queryKey: analysisKeys.decision(applicationId),
    queryFn: ({ signal }) =>
      api.get<Decision>(`/applications/${applicationId}/decision`, { signal }),
    enabled,
  });
}

/** Active analysts, for the admin's assignment dialog (requires user.manage). */
export function useActiveAnalysts(enabled: boolean) {
  return useQuery({
    queryKey: analysisKeys.analysts,
    queryFn: ({ signal }) =>
      api.get<Page<UserRef & { email: string }>>('/users', {
        query: { role: 'ANALYST', active: true, pageSize: 100, sort: 'name:asc' },
        signal,
      }),
    enabled,
  });
}

/** Anything that changes the analysis refreshes the whole application view. */
function useRefreshApplication(applicationId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: applicationKeys.detail(applicationId) });
    void qc.invalidateQueries({ queryKey: ['applications', 'list'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useCreateReview(applicationId: string) {
  const refresh = useRefreshApplication(applicationId);
  return useMutation({
    mutationFn: (body: {
      recommendation: ReviewRecommendation;
      analysisNotes: string;
      justification: string;
    }) => api.post<Review>(`/applications/${applicationId}/reviews`, body),
    onSuccess: refresh,
  });
}

export function useRecordDecision(applicationId: string) {
  const refresh = useRefreshApplication(applicationId);
  return useMutation({
    mutationFn: (body: { outcome: DecisionOutcome; justification: string }) =>
      api.post<Application>(`/applications/${applicationId}/decision`, body),
    onSuccess: refresh,
  });
}

export function useCreateIssue(applicationId: string) {
  const refresh = useRefreshApplication(applicationId);
  return useMutation({
    mutationFn: (description: string) =>
      api.post<Issue>(`/applications/${applicationId}/issues`, { description }),
    onSuccess: refresh,
  });
}

export function useResolveIssue(applicationId: string) {
  const refresh = useRefreshApplication(applicationId);
  return useMutation({
    mutationFn: ({ issueId, resolutionNote }: { issueId: string; resolutionNote: string }) =>
      api.post<Issue>(`/issues/${issueId}/resolve`, { resolutionNote }),
    onSuccess: refresh,
  });
}

export function useValidateDocument(applicationId: string) {
  const refresh = useRefreshApplication(applicationId);
  return useMutation({
    mutationFn: ({
      documentId,
      status,
      notes,
    }: {
      documentId: string;
      status: DocumentValidationStatus;
      notes?: string;
    }) =>
      api.patch<CreditDocument>(`/documents/${documentId}/validation`, {
        status,
        ...(notes ? { notes } : {}),
      }),
    onSuccess: refresh,
  });
}
