import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * List filters live in the URL so links can be shared (BUILD_PLAN 11).
 * Setting a filter resets the page to 1; empty values are removed.
 */
export function useUrlState<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams();
  const values = Object.fromEntries(keys.map((k) => [k, params.get(k) ?? ''])) as Record<K, string>;
  const set = useCallback(
    (patch: Partial<Record<K | 'page', string | number | null>>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === undefined || v === '') next.delete(k);
            else next.set(k, String(v));
          }
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  return { values, set, page };
}

/** Query string from an object, skipping empty values. */
export function qs(obj: Record<string, string | number | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
