import { describe, expect, it } from 'vitest';
import { api, ApiError, fetchHealth } from './api';

const respond =
  (body: unknown, status = 200) =>
  async () =>
    new Response(JSON.stringify(body), { status });

describe('fetchHealth', () => {
  it('maps the API status', async () => {
    expect(await fetchHealth(respond({ status: 'ok' }))).toBe('ok');
    expect(await fetchHealth(respond({ status: 'degraded' }))).toBe('degraded');
  });

  it('reports unreachable when the request fails', async () => {
    const failing = async () => {
      throw new TypeError('network');
    };
    expect(await fetchHealth(failing)).toBe('unreachable');
  });
});

describe('api', () => {
  it('returns the JSON body', async () => {
    expect(await api('/x', {}, respond({ a: 1 }))).toEqual({ a: 1 });
  });

  it('turns error responses into ApiError with the server message', async () => {
    const err = await api(
      '/x',
      {},
      respond({ error: { code: 'NOPE', message: 'No.' } }, 403),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: 'NOPE', message: 'No.' });
  });
});
