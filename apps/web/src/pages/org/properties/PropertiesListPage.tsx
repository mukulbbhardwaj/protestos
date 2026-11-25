import {
  PROPERTY_TYPES,
  PROTEST_STAGES,
  roleAtLeast,
  SYSTEM_STAGES,
  type PropertySummary,
  type ProtestStage,
} from '@app/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, UserCog, Workflow, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { EmptyRow } from '@/components/data/EmptyRow';
import { Pagination } from '@/components/data/Pagination';
import { SearchInput } from '@/components/data/SearchInput';
import { StageBadge } from '@/components/data/StageBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/alert';
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
import { useOrgQuery } from '@/hooks/useOrgQuery';
import { useConsultants, useCounties } from '@/hooks/useReference';
import { qs, useUrlState } from '@/hooks/useUrlState';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { PROPERTY_TYPE_SHORT, STAGE_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';

interface Page {
  items: PropertySummary[];
  total: number;
}

const PAGE_SIZE = 50;
const KEYS = [
  'q',
  'countyId',
  'type',
  'consultantId',
  'stage',
  'taxYear',
  'archived',
  'sort',
] as const;
const whole = (v: string | null | undefined) => (v ? formatMoney(v).replace(/\.00$/, '') : '—');

export function PropertiesListPage() {
  const org = useOrg();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { values, set, page } = useUrlState(KEYS);
  const counties = useCounties();
  const consultants = useConsultants();
  const overview = useOrgQuery<{ stats: { taxYear: number } }>('');
  const currentYear = overview.data?.stats.taxYear ?? new Date().getFullYear();
  const year = Number(values.taxYear) || currentYear;
  const canEdit = roleAtLeast(org.role, 'STAFF');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const query = useQuery({
    queryKey: ['org', org.orgSlug, 'properties', values, page],
    queryFn: () =>
      api<Page>(`/orgs/${org.orgSlug}/properties${qs({ ...values, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });
  const rows = query.data?.items ?? [];
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const bulk = useMutation({
    mutationFn: ({ path, body }: { path: string; body: object }) =>
      api<{ updated: number; skipped: number }>(`/orgs/${org.orgSlug}/properties/bulk/${path}`, {
        method: 'POST',
        body: { ids: [...selected], ...body },
      }),
    onSuccess: (r) => {
      toast.success(
        `Updated ${r.updated} ${r.updated === 1 ? 'property' : 'properties'}${r.skipped ? ` (${r.skipped} unchanged)` : ''}.`,
      );
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['org', org.orgSlug] });
    },
    onError: (e) => toast.error(e.message),
  });

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <PageHeader
        title="Properties"
        description={`CAD accounts with their ${year} protest stage and values.`}
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <SearchInput
            value={values.q}
            onChange={(q) => set({ q })}
            placeholder="Search account, address or owner"
          />
          <NativeSelect
            aria-label="Tax year"
            className="w-auto"
            value={values.taxYear || String(currentYear)}
            onChange={(e) =>
              set({ taxYear: Number(e.target.value) === currentYear ? '' : e.target.value })
            }
          >
            {[currentYear + 1, currentYear, currentYear - 1, currentYear - 2].map((y) => (
              <option key={y} value={y}>
                Tax year {y}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Stage"
            className="w-auto"
            value={values.stage}
            onChange={(e) => set({ stage: e.target.value })}
          >
            <option value="">All stages</option>
            {PROTEST_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
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
            aria-label="Type"
            className="w-auto"
            value={values.type}
            onChange={(e) => set({ type: e.target.value })}
          >
            <option value="">All types</option>
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROPERTY_TYPE_SHORT[t]}
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
            <option value="none">Unassigned</option>
            {consultants.data?.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Sort"
            className="ml-auto w-auto"
            value={values.sort || 'owner'}
            onChange={(e) => set({ sort: e.target.value === 'owner' ? '' : e.target.value })}
          >
            <option value="owner">Sort: Owner</option>
            <option value="account">Sort: Account</option>
            <option value="county">Sort: County</option>
            <option value="newest">Sort: Newest</option>
          </NativeSelect>
        </div>

        {selected.size > 0 && canEdit && (
          <div className="flex flex-wrap items-center gap-2 border-b bg-primary/5 px-3 py-2 text-sm">
            <span className="font-medium">{selected.size} selected</span>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              <X /> Clear
            </Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <UserCog className="size-4 text-muted-foreground" />
            <NativeSelect
              aria-label="Assign consultant"
              className="h-8 w-auto"
              value=""
              disabled={bulk.isPending}
              onChange={(e) =>
                e.target.value &&
                bulk.mutate({
                  path: 'assign-consultant',
                  body: {
                    consultantUserId: e.target.value === 'none' ? null : Number(e.target.value),
                  },
                })
              }
            >
              <option value="">Assign consultant…</option>
              <option value="none">Unassign</option>
              {consultants.data?.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
            <Workflow className="size-4 text-muted-foreground" />
            <NativeSelect
              aria-label="Set stage"
              className="h-8 w-auto"
              value=""
              disabled={bulk.isPending}
              onChange={(e) =>
                e.target.value &&
                bulk.mutate({
                  path: 'stage',
                  body: { taxYear: year, stage: e.target.value as ProtestStage },
                })
              }
            >
              <option value="">Set {year} stage…</option>
              {PROTEST_STAGES.filter((s) => !SYSTEM_STAGES.includes(s)).map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
            <Button
              variant="outline"
              size="sm"
              disabled={bulk.isPending}
              onClick={() => bulk.mutate({ path: 'rollover', body: { taxYear: currentYear + 1 } })}
            >
              <CalendarPlus /> Roll over to {currentYear + 1}
            </Button>
          </div>
        )}

        {query.error && (
          <Alert variant="destructive" className="m-3">
            {query.error.message}
          </Alert>
        )}

        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {canEdit && (
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    className="size-4 accent-primary"
                    checked={allOnPage}
                    onChange={() =>
                      setSelected((s) => {
                        const n = new Set(s);
                        rows.forEach((r) => (allOnPage ? n.delete(r.id) : n.add(r.id)));
                        return n;
                      })
                    }
                  />
                </TableHead>
              )}
              <TableHead>Account</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead className="hidden xl:table-cell">Address</TableHead>
              <TableHead className="hidden md:table-cell">County</TableHead>
              <TableHead className="hidden lg:table-cell">Type</TableHead>
              <TableHead>{year} stage</TableHead>
              <TableHead className="hidden text-right md:table-cell">Notice → final</TableHead>
              <TableHead className="hidden lg:table-cell">Consultant</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className={cn(query.isPlaceholderData && 'opacity-60')}>
            {query.isPending &&
              Array.from({ length: 8 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={9}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {query.data && rows.length === 0 && (
              <EmptyRow colSpan={9} message="No properties match these filters." />
            )}
            {rows.map((p) => (
              <TableRow
                key={p.id}
                className={cn('cursor-pointer', selected.has(p.id) && 'bg-primary/5')}
                onClick={() => navigate(`/${org.orgSlug}/properties/${p.id}`)}
              >
                {canEdit && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${p.accountNumber}`}
                      className="size-4 accent-primary"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                  </TableCell>
                )}
                <TableCell>
                  <Link
                    to={`/${org.orgSlug}/properties/${p.id}`}
                    className="font-mono text-xs font-medium hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {p.accountNumber}
                  </Link>
                </TableCell>
                <TableCell className="max-w-48 truncate">{p.contact.displayName}</TableCell>
                <TableCell className="hidden max-w-64 truncate text-muted-foreground xl:table-cell">
                  {p.situsLine}
                </TableCell>
                <TableCell className="hidden md:table-cell">{p.county.name}</TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">
                  {PROPERTY_TYPE_SHORT[p.propertyType]}
                </TableCell>
                <TableCell>
                  {p.year ? (
                    <StageBadge stage={p.year.protestStage} />
                  ) : (
                    <span className="text-xs text-muted-foreground">No {year} record</span>
                  )}
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-right tabular-nums text-muted-foreground md:table-cell">
                  {whole(p.year?.noticeAppraised)}
                  {p.year?.finalAppraised && (
                    <>
                      {' '}
                      → <span className="text-foreground">{whole(p.year.finalAppraised)}</span>
                    </>
                  )}
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">
                  {p.consultant?.name ?? '—'}
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
    </>
  );
}
