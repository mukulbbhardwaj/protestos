export type HealthState = 'loading' | 'ok' | 'degraded' | 'unreachable';

const BASE = '/api';

/** An API error with a message that is safe to show as-is. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; csv?: string } = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  let res: Response;
  try {
    res = await fetcher(`${BASE}${path}`, {
      method: init.method ?? 'GET',
      credentials: 'include',
      headers:
        init.csv !== undefined
          ? { 'content-type': 'text/csv' }
          : init.body !== undefined
            ? { 'content-type': 'application/json' }
            : undefined,
      // `csv` sends a file's text as-is (CSV imports); `body` is JSON.
      body: init.csv ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK',
      "We can't reach the server. Check your connection and try again.",
    );
  }
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'ERROR',
      err?.message ?? 'Something went wrong. Try again.',
    );
  }
  return body as T;
}

/** All API calls go through the same-origin /api prefix (proxied in dev). */
export async function fetchHealth(fetcher: typeof fetch = fetch): Promise<HealthState> {
  try {
    const res = await fetcher(`${BASE}/health`, { credentials: 'include' });
    const body = (await res.json()) as { status?: string };
    return body.status === 'ok' ? 'ok' : 'degraded';
  } catch {
    return 'unreachable';
  }
}
