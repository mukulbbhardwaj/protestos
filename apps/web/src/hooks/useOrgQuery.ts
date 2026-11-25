import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useOrg } from './useOrg';

/** GET /orgs/:slug<path>, cached per firm. */
export function useOrgQuery<T>(path: string, opts: { enabled?: boolean } = {}) {
  const { orgSlug } = useOrg();
  return useQuery({
    queryKey: ['org', orgSlug, path],
    queryFn: () => api<T>(`/orgs/${orgSlug}${path}`),
    ...opts,
  });
}

export function orgKey(orgSlug: string, path: string) {
  return ['org', orgSlug, path] as const;
}
