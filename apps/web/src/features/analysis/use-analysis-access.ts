import { ApplicationStatus, Permission } from '@creditflow/shared';
import type { Application } from '@/features/applications/applications-api';
import { useCurrentUser } from '@/features/auth/auth-api';

const IN_ANALYSIS: readonly ApplicationStatus[] = [
  ApplicationStatus.UNDER_REVIEW,
  ApplicationStatus.PENDING_INFORMATION,
];

/**
 * What the current user may do in the analysis panel. Mirrors the API rules
 * (assignee-only review actions during the analysis); the API still decides.
 */
export function useAnalysisAccess(app: Application) {
  const { data: me } = useCurrentUser();
  const perms = me?.permissions ?? [];
  const isAssignee = !!me && app.assignee?.id === me.id;
  const inAnalysis = IN_ANALYSIS.includes(app.status);
  const canAnalyse = perms.includes(Permission.APPLICATION_REVIEW) && isAssignee && inAnalysis;
  return {
    isAssignee,
    inAnalysis,
    /** Issues, reviews and document validation. */
    canAnalyse,
    canValidateDocuments: canAnalyse && perms.includes(Permission.DOCUMENT_VALIDATE),
    canDecide: app.availableActions.includes('approve') || app.availableActions.includes('reject'),
  };
}
