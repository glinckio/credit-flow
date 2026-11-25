/**
 * Thin fetch wrapper for the CreditFlow API.
 *
 * - Same-origin requests (Vite proxy in dev): the httpOnly session cookie is
 *   sent automatically; JavaScript never sees the token.
 * - Mutating requests carry `X-Requested-With`, required by the API's CSRF guard.
 * - Errors arrive as RFC 9457 Problem Details and are thrown as `ApiError`.
 */

export const API_BASE = '/api/v1';

export interface FieldError {
  field: string;
  messages: string[];
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: FieldError[];
  requestId?: string;
  [extension: string]: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails;

  constructor(problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
    this.status = problem.status;
    this.problem = problem;
  }

  /** Problem code, e.g. `invalid-credentials` for `/problems/invalid-credentials`. */
  get code(): string {
    return this.problem.type.replace(/^\/problems\//, '');
  }

  /** First message per field, keyed by field path (e.g. `address.zipCode`). */
  get fieldErrors(): Record<string, string> {
    return Object.fromEntries(
      (this.problem.errors ?? []).map((e) => [e.field, e.messages[0] ?? 'Valor inválido']),
    );
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type Query = Record<string, string | number | boolean | null | undefined | string[]>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

export function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const qs = params.toString();
  return `${API_BASE}${path}${qs ? `?${qs}` : ''}`;
}

async function toProblem(res: Response): Promise<ProblemDetails> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    try {
      const body = (await res.json()) as Partial<ProblemDetails>;
      if (body && typeof body.title === 'string') {
        return {
          type: body.type ?? '/problems/error',
          status: res.status,
          ...body,
        } as ProblemDetails;
      }
    } catch {
      // fall through to the generic problem
    }
  }
  return {
    type: res.status >= 500 ? '/problems/internal-error' : '/problems/error',
    title:
      res.status >= 500
        ? 'O servidor não conseguiu processar a solicitação. Tente novamente.'
        : 'Não foi possível concluir a solicitação.',
    status: res.status,
  };
}

export async function apiRequest<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (MUTATING.has(method)) headers['X-Requested-With'] = 'XMLHttpRequest';

  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body; // the browser sets the multipart boundary
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body,
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError({
      type: '/problems/network-error',
      title: 'Sem conexão com o servidor. Verifique sua rede e tente novamente.',
      status: 0,
    });
  }

  if (!res.ok) throw new ApiError(await toProblem(res));
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get('content-type') ?? '';
  return (contentType.includes('json') ? await res.json() : await res.blob()) as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) =>
    apiRequest<T>('GET', path, options),
  post: <T>(path: string, body?: unknown) => apiRequest<T>('POST', path, { body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>('PATCH', path, { body }),
  delete: <T = void>(path: string) => apiRequest<T>('DELETE', path),
};

/** Human message for any error thrown by the API layer (or anything else). */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.problem.detail ?? err.problem.title;
  return 'Ocorreu um erro inesperado.';
}
