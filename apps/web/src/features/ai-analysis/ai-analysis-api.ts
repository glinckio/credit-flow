import {
  ACTIVE_RUN_STATUSES,
  type AiAnalysisRunStatus,
  type AiAnalysisTrigger,
  type DocumentExtractionStatus,
  type DocumentType,
  type Finding,
  type FindingFeedbackVerdict,
  type NarrativeReport,
  type TemplateReport,
} from '@creditflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { applicationKeys } from '@/features/applications/applications-api';
import { api } from '@/lib/api';

type UserRef = { id: string; name: string };

export interface AiRun {
  id: string;
  applicationId: string;
  trigger: AiAnalysisTrigger;
  status: AiAnalysisRunStatus;
  requestedBy: UserRef | null;
  model: string;
  pipelineVersion: string;
  extractionSchemaVersion: string;
  promptVersion: string;
  errorCode: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: string | null;
  latencyMs: number | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  purgedAt: string | null;
  stale: boolean;
  documentCount: number;
}

export interface AiDocumentExtraction {
  id: string;
  document: { id: string; type: DocumentType; originalName: string };
  status: DocumentExtractionStatus;
}

export interface FindingFeedback {
  findingId: string;
  verdict: FindingFeedbackVerdict;
  comment: string | null;
  author: UserRef;
  updatedAt: string;
}

export interface AiRunDetail extends AiRun {
  documents: AiDocumentExtraction[];
  findings: Finding[];
  report: TemplateReport | null;
  reportAtCompletion: TemplateReport | null;
  narrative: NarrativeReport | null;
  declaredDataChanged: boolean;
  feedback: FindingFeedback[];
}

export const aiKeys = {
  runs: (applicationId: string) => [...applicationKeys.detail(applicationId), 'ai-runs'] as const,
  run: (runId: string) => ['ai-runs', runId] as const,
};

export const isActive = (s: AiAnalysisRunStatus) => ACTIVE_RUN_STATUSES.includes(s);

/** While a run is queued or running, the list refreshes on its own. */
export function useAiRuns(applicationId: string, enabled: boolean) {
  return useQuery({
    queryKey: aiKeys.runs(applicationId),
    queryFn: ({ signal }) =>
      api.get<AiRun[]>(`/applications/${applicationId}/ai-analyses`, { signal }),
    enabled,
    refetchInterval: (q) => (q.state.data?.some((r) => isActive(r.status)) ? 3000 : false),
  });
}

export function useAiRun(runId: string | undefined, status?: AiAnalysisRunStatus) {
  return useQuery({
    // The status is part of the key: a run that finishes is fetched again.
    queryKey: [...aiKeys.run(runId ?? ''), status],
    queryFn: ({ signal }) => api.get<AiRunDetail>(`/ai-analyses/${runId}`, { signal }),
    enabled: !!runId && !!status && !isActive(status),
  });
}

export function useRequestAiRun(applicationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (force: boolean) =>
      api.post<AiRun>(`/applications/${applicationId}/ai-analyses`, force ? { force } : {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: aiKeys.runs(applicationId) }),
  });
}

export function useFindingFeedback(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      findingId,
      verdict,
      comment,
    }: {
      findingId: string;
      verdict: FindingFeedbackVerdict;
      comment?: string;
    }) =>
      api.put<FindingFeedback>(
        `/ai-analyses/${runId}/findings/${encodeURIComponent(findingId)}/feedback`,
        { verdict, ...(comment ? { comment } : {}) },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: aiKeys.run(runId) }),
  });
}
