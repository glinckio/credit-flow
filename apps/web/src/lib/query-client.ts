import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

export const ME_QUERY_KEY = ['auth', 'me'] as const;

/**
 * - Client errors (4xx) are never retried; network/5xx are retried once.
 * - Any 401 (expired or revoked session) clears the current user, which makes
 *   the route guard send the user back to the login page.
 */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (err) => handleUnauthorized(err) }),
    mutationCache: new MutationCache({ onError: (err) => handleUnauthorized(err) }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, err) =>
          !(err instanceof ApiError && err.status >= 400 && err.status < 500) && failureCount < 1,
      },
      mutations: { retry: false },
    },
  });

  function handleUnauthorized(err: unknown) {
    if (err instanceof ApiError && err.status === 401 && client.getQueryData(ME_QUERY_KEY)) {
      client.setQueryData(ME_QUERY_KEY, null);
    }
  }

  return client;
}
