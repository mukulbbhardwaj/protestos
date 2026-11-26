import type { DocumentDto } from '@app/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Pagination } from '@/components/data/Pagination';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrg } from '@/hooks/useOrg';
import { qs, useUrlState } from '@/hooks/useUrlState';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { DocumentsTable } from './DocumentsTable';

const TABS = [
  ['', 'All'],
  ['OPEN', 'Waiting for signature'],
  ['SIGNED', 'Signed'],
  ['DECLINED', 'Declined'],
  ['VOIDED', 'Cancelled'],
] as const;

export function DocumentsPage() {
  const org = useOrg();
  const { values, set, page } = useUrlState(['status'] as const);
  const q = useQuery({
    queryKey: ['org', org.orgSlug, 'documents', values, page],
    queryFn: () =>
      api<{ items: DocumentDto[]; total: number; page: number; pageSize: number }>(
        `/orgs/${org.orgSlug}/documents${qs({ ...values, page })}`,
      ),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader
        title="Documents"
        description="Engagement agreements and Form 50-162 sent for signature. Send new ones from a client or prospect."
      />
      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Document status">
        {TABS.map(([value, label]) => (
          <button
            key={value || 'all'}
            role="tab"
            aria-selected={values.status === value}
            onClick={() => set({ status: value })}
            className={cn(
              'rounded-full border px-3 py-1 text-sm hover:bg-accent',
              values.status === value && 'border-primary bg-primary/10 text-primary',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <Card className="overflow-hidden">
        {q.error && (
          <Alert variant="destructive" className="m-3">
            {q.error.message}
          </Alert>
        )}
        {q.isPending ? (
          <Skeleton className="m-4 h-40" />
        ) : (
          <DocumentsTable documents={q.data?.items ?? []} showClient />
        )}
        {q.data && (
          <Pagination
            page={q.data.page}
            pageSize={q.data.pageSize}
            total={q.data.total}
            onPage={(p) => set({ page: p })}
          />
        )}
      </Card>
    </>
  );
}
