import { PROSPECT_STATUSES, type ContactSummary, type ProspectStatus } from '@app/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Building2, Plus, User } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyRow } from '@/components/data/EmptyRow';
import { Pagination } from '@/components/data/Pagination';
import { SearchInput } from '@/components/data/SearchInput';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useOrg } from '@/hooks/useOrg';
import { useConsultants, useCounties } from '@/hooks/useReference';
import { qs, useUrlState } from '@/hooks/useUrlState';
import { roleAtLeast } from '@app/shared';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { PROSPECT_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { NewContactDialog } from './NewContactDialog';

interface Page {
  items: ContactSummary[];
  total: number;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 50;
const KEYS = ['q', 'status', 'countyId', 'consultantId', 'archived', 'sort'] as const;

export function ContactsListPage({ kind }: { kind: 'CLIENT' | 'PROSPECT' }) {
  const org = useOrg();
  const navigate = useNavigate();
  const { values, set, page } = useUrlState(KEYS);
  const [creating, setCreating] = useState(false);
  const counties = useCounties();
  const consultants = useConsultants();
  const isClient = kind === 'CLIENT';
  const canEdit = roleAtLeast(org.role, 'STAFF');

  const query = useQuery({
    queryKey: ['org', org.orgSlug, 'contacts', kind, values, page],
    queryFn: () =>
      api<Page>(
        `/orgs/${org.orgSlug}/contacts${qs({ kind, ...values, page, pageSize: PAGE_SIZE })}`,
      ),
    placeholderData: keepPreviousData,
  });
  const counts = useQuery({
    queryKey: ['org', org.orgSlug, 'prospect-counts'],
    queryFn: () =>
      api<{ counts: Record<ProspectStatus, number>; total: number }>(
        `/orgs/${org.orgSlug}/contacts/prospect-counts`,
      ),
    enabled: !isClient,
  });

  const title = isClient ? 'Clients' : 'Prospects';
  const rows = query.data?.items ?? [];

  return (
    <>
      <PageHeader
        title={title}
        description={
          isClient
            ? 'Every client, their contacts, fee terms and properties.'
            : 'Leads on their way to becoming clients.'
        }
        actions={
          canEdit && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New {isClient ? 'client' : 'prospect'}
            </Button>
          )
        }
      />

      {!isClient && (
        <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Prospect status">
          {(
            [
              ['', 'All', counts.data?.total],
              ...PROSPECT_STATUSES.map((s) => [s, PROSPECT_LABELS[s], counts.data?.counts[s]]),
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value || 'all'}
              role="tab"
              aria-selected={values.status === value}
              onClick={() => set({ status: value })}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors hover:bg-accent',
                values.status === value &&
                  'border-primary bg-primary/10 text-primary hover:bg-primary/15',
              )}
            >
              {label}
              {count !== undefined && (
                <span className="text-xs tabular-nums opacity-70">{count}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <SearchInput
            value={values.q}
            onChange={(q) => set({ q })}
            placeholder={
              isClient ? 'Search name, client #, email, phone' : 'Search name, email, phone'
            }
          />
          {isClient && (
            <>
              <NativeSelect
                aria-label="County"
                className="w-auto"
                value={values.countyId}
                onChange={(e) => set({ countyId: e.target.value })}
              >
                <option value="">All counties</option>
                {counties.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Consultant"
                className="w-auto"
                value={values.consultantId}
                onChange={(e) => set({ consultantId: e.target.value })}
              >
                <option value="">All consultants</option>
                {consultants.data?.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </NativeSelect>
            </>
          )}
          <NativeSelect
            aria-label="Archived"
            className="w-auto"
            value={values.archived || 'active'}
            onChange={(e) => set({ archived: e.target.value === 'active' ? '' : e.target.value })}
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </NativeSelect>
          <NativeSelect
            aria-label="Sort"
            className="ml-auto w-auto"
            value={values.sort || 'name'}
            onChange={(e) => set({ sort: e.target.value === 'name' ? '' : e.target.value })}
          >
            <option value="name">Sort: Name</option>
            {isClient && <option value="clientNumber">Sort: Client #</option>}
            <option value="newest">Sort: Newest</option>
            <option value="properties">Sort: Most properties</option>
          </NativeSelect>
        </div>

        {query.error && (
          <Alert variant="destructive" className="m-3">
            {query.error.message}
          </Alert>
        )}

        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              {isClient ? <TableHead>Client #</TableHead> : <TableHead>Status</TableHead>}
              <TableHead className="hidden md:table-cell">Email</TableHead>
              <TableHead className="hidden lg:table-cell">Phone</TableHead>
              <TableHead className="hidden lg:table-cell">City</TableHead>
              <TableHead className="text-right">Properties</TableHead>
              <TableHead className="hidden sm:table-cell">
                {isClient ? 'Added' : 'Created'}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className={cn(query.isPlaceholderData && 'opacity-60')}>
            {query.isPending &&
              Array.from({ length: 8 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {query.data && rows.length === 0 && (
              <EmptyRow
                colSpan={7}
                message={
                  values.q ? `Nothing matches “${values.q}”.` : `No ${title.toLowerCase()} yet.`
                }
              />
            )}
            {rows.map((c) => (
              <TableRow
                key={c.id}
                className="cursor-pointer"
                onClick={() => navigate(`/${org.orgSlug}/contacts/${c.id}`)}
              >
                <TableCell>
                  <Link
                    to={`/${org.orgSlug}/contacts/${c.id}`}
                    className="flex items-center gap-2 font-medium hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {c.entityType === 'COMPANY' ? (
                      <Building2 className="size-4 text-muted-foreground" />
                    ) : (
                      <User className="size-4 text-muted-foreground" />
                    )}
                    {c.displayName}
                  </Link>
                  {c.archivedAt && (
                    <Badge variant="outline" className="ml-6 mt-1">
                      Archived
                    </Badge>
                  )}
                </TableCell>
                {isClient ? (
                  <TableCell className="font-mono text-xs">{c.clientNumber}</TableCell>
                ) : (
                  <TableCell>
                    {c.status && (
                      <Badge
                        variant={
                          c.status === 'LOST'
                            ? 'outline'
                            : c.status === 'SIGNED'
                              ? 'success'
                              : 'secondary'
                        }
                      >
                        {PROSPECT_LABELS[c.status]}
                      </Badge>
                    )}
                  </TableCell>
                )}
                <TableCell className="hidden max-w-56 truncate text-muted-foreground md:table-cell">
                  {c.email ?? '—'}
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                  {c.phone ?? '—'}
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">
                  {c.city ?? '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">{c.propertyCount}</TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">
                  {formatDate(c.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {query.data && (
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={query.data.total}
            onPage={(p) => set({ page: p })}
          />
        )}
      </Card>

      <NewContactDialog kind={kind} open={creating} onOpenChange={setCreating} />
    </>
  );
}
