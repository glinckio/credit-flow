import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '@/test/render';
import { ApiError, api, buildUrl, errorMessage } from './api';

/** Each call gets a fresh Response (a body can be read only once). */
function stubFetch(make: () => Response | Error) {
  const fn = vi.fn(async () => {
    const response = make();
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('buildUrl', () => {
  it('prefixes the API base and drops empty query values', () => {
    expect(
      buildUrl('/applications', { status: ['SUBMITTED', 'UNDER_REVIEW'], q: '', page: 2 }),
    ).toBe('/api/v1/applications?status=SUBMITTED%2CUNDER_REVIEW&page=2');
  });
});

describe('api client', () => {
  it('sends the CSRF header and JSON body only on mutating requests, same-origin', async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true }));
    await api.get('/auth/me');
    await api.post('/auth/login', { email: 'a@b.test' });

    const [, getInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [, postInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(getInit.headers).not.toHaveProperty('X-Requested-With');
    expect(getInit.credentials).toBe('same-origin');
    expect(postInit.headers).toMatchObject({
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json',
    });
    expect(postInit.body).toBe('{"email":"a@b.test"}');
  });

  it('returns undefined for 204', async () => {
    stubFetch(() => jsonResponse(null, 204));
    await expect(api.post('/auth/logout')).resolves.toBeUndefined();
  });

  it('throws ApiError with the Problem Details, code and field errors', async () => {
    stubFetch(() =>
      jsonResponse(
        {
          type: '/problems/validation-error',
          title: 'Dados inválidos',
          status: 400,
          detail: 'Corrija os campos indicados.',
          errors: [{ field: 'address.zipCode', messages: ['CEP deve ter 8 dígitos'] }],
          requestId: 'req-1',
        },
        400,
      ),
    );
    const err = await api.post('/customers', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(400);
    expect(apiErr.code).toBe('validation-error');
    expect(apiErr.fieldErrors).toEqual({ 'address.zipCode': 'CEP deve ter 8 dígitos' });
    expect(errorMessage(apiErr)).toBe('Corrija os campos indicados.');
  });

  it('synthesises a friendly problem for non-JSON errors and network failures', async () => {
    stubFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    const gateway = (await api.get('/x').catch((e: unknown) => e)) as ApiError;
    expect(gateway.status).toBe(502);
    expect(gateway.code).toBe('internal-error');

    stubFetch(() => new TypeError('Failed to fetch'));
    const offline = (await api.get('/x').catch((e: unknown) => e)) as ApiError;
    expect(offline.code).toBe('network-error');
    expect(errorMessage(new Error('boom'))).toBe('Ocorreu um erro inesperado.');
  });
});
