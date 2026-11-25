export type HealthState = 'loading' | 'ok' | 'degraded' | 'unreachable';

/** All API calls go through the same-origin /api prefix (proxied in dev). */
export async function fetchHealth(fetcher: typeof fetch = fetch): Promise<HealthState> {
  try {
    const res = await fetcher('/api/health', { credentials: 'include' });
    const body = (await res.json()) as { status?: string };
    return body.status === 'ok' ? 'ok' : 'degraded';
  } catch {
    return 'unreachable';
  }
}
