import type { ApplicationStatus } from '@creditflow/shared';
import { Badge } from '@/components/ui/badge';
import { APPLICATION_STATUS_BADGE, APPLICATION_STATUS_LABELS } from '@/lib/labels';

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <Badge variant={APPLICATION_STATUS_BADGE[status]}>{APPLICATION_STATUS_LABELS[status]}</Badge>
  );
}
