import { describe, expect, it } from 'vitest';
import { fetchHealth } from './api';

const respond = (body: unknown) => async () => new Response(JSON.stringify(body));

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
