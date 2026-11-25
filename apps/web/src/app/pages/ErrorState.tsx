import { isRouteErrorResponse, useRouteError } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError, errorMessage } from '@/lib/api';
import { NotFoundPage } from './NotFoundPage';

/** Inline error block with optional retry, used by pages and guards. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const requestId = error instanceof ApiError ? error.problem.requestId : undefined;
  return (
    <div className="mx-auto max-w-lg py-10">
      <Alert variant="destructive" title="Não foi possível carregar os dados">
        <p>{errorMessage(error)}</p>
        {requestId && <p className="mt-1 text-xs opacity-75">Código para suporte: {requestId}</p>}
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            Tentar novamente
          </Button>
        )}
      </Alert>
    </div>
  );
}

/** Router-level error boundary (unexpected render errors, unknown routes). */
export function RouteErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  return <ErrorState error={error} onRetry={() => window.location.reload()} />;
}
