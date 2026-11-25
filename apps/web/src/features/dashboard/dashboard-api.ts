import type { ApplicationStatus } from '@creditflow/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface DurationMetric {
  averageHours: number | null;
  sampleSize: number;
  definition: string;
}

export interface DashboardMetrics {
  total: number;
  byStatus: Record<ApplicationStatus, number>;
  awaitingReview: number;
  underReview: number;
  pendingInformation: number;
  withOpenIssues: number;
  approved: number;
  rejected: number;
  assignedToMe: number | null;
  openToDecision: DurationMetric;
  submissionToDecision: DurationMetric;
  generatedAt: string;
}

export function useDashboardMetrics() {
  return useQuery({
    queryKey: ['dashboard', 'metrics'],
    queryFn: ({ signal }) => api.get<DashboardMetrics>('/dashboard/metrics', { signal }),
    staleTime: 15_000,
  });
}

/** 137.6 → "5 d 17,6 h"; 14 → "14 h". */
export function formatHours(hours: number): string {
  if (hours < 24) return `${hours.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
  const days = Math.floor(hours / 24);
  const rest = hours - days * 24;
  return `${days} d ${rest.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
}
