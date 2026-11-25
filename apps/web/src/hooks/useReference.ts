import type { CountyOption, Member } from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useOrgQuery } from './useOrgQuery';

export function useCounties() {
  return useQuery({
    queryKey: ['counties'],
    queryFn: () => api<{ counties: CountyOption[] }>('/counties').then((r) => r.counties),
    staleTime: Infinity,
  });
}

/** Active team members, for consultant pickers. */
export function useConsultants() {
  const q = useOrgQuery<{ members: Member[] }>('/members');
  return { ...q, data: q.data?.members.filter((m) => m.status === 'ACTIVE') };
}
