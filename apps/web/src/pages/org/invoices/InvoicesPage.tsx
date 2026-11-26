import { roleAtLeast, type InvoiceSummary } from '@app/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Send } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyRow } from '@/components/data/EmptyRow';
import { Pagination } from '@/components/data/Pagination';
import { SearchInput } from '@/components/data/SearchInput';
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
import { qs, useUrlState } from '@/hooks/useUrlState';
import { api } from '@/lib/api';
import { formatDay, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DeliveryBadge } from './DeliveryBadge';
import { GenerateDialog } from './GenerateDialog';
import { InvoiceStatusBadge } from './InvoiceStatusBadge';
import { SendInvoicesDialog } from './SendInvoicesDialog';

interface Page {
  items: InvoiceSummary[];
  total: number;
  page: number;
  pageSize: number;
  totals: { count: number; total: string; balance: string };
}

const KEYS = ['q', 'status', 'taxYear', 'delivery', 'sort'] as const;
const TABS = [
  ['', 'All'],
  ['DRAFT', 'Drafts'],
  ['OPEN', 'Open'],
  ['PAST_DUE', 'Past due'],
  ['PAID', 'Paid'],
  ['VOID', 'Void'],
  ['WRITTEN_OFF', 'Written off'],
] as const;

export function InvoicesPage() {
  const org = useOrg();
  const navigate = useNavigate();
  const { values, set, page } = useUrlState(KEYS);
  const [generating, setGenerating] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState(false);
  const canEdit = roleAtLeast(org.role, 'STAFF');
  const thisYear = new Date().getFullYear();

  const query = useQuery({
    queryKey: ['org', org.orgSlug, 'invoices', values, page],
    queryFn: () =>
      api<Page>(`/orgs/${org.orgSlug}/invoices${qs({ ...values, page, pageSize: 50 })}`),
    placeholderData: keepPreviousData,
  });
  const rows = query.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Contingency invoices from notice and final values. Generate drafts for a tax year, review, then issue."
        actions={
          canEdit && (
            <>
              {selected.size > 0 && (
                <Button variant="outline" onClick={() => setSending(true)}>
                  <Send /> Send {selected.size}
                </Button>
              )}
              <Button onClick={() => setGenerating(true)}>
                <Plus /> Generate invoices
              </Button>
            </>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Invoice status">
        {TABS.map(([value, label]) => (
          <button
            key={value || 'all'}
            role="tab"
            aria-selected={values.status === value}
            onClick={() => set({ status: value })}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors hover:bg-accent',
              values.status === value &&
                'border-primary bg-primary/10 text-primary hover:bg-primary/15',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <SearchInput
            value={values.q}
            onChange={(q) => set({ q })}
            placeholder="Search invoice #, client"
          />
          <NativeSelect
            aria-label="Tax year"
            className="w-auto"
            value={values.taxYear}
            onChange={(e) => set({ taxYear: e.target.value })}
          >
            <option value="">All tax years</option>
            {Array.from({ length: 6 }, (_, i) => thisYear - i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Email"
            className="w-auto"
            value={values.delivery}
            onChange={(e) => set({ delivery: e.target.value })}
          >
            <option value="">Any email status</option>
            <option value="NOT_SENT">Not emailed</option>
            <option value="SENT">Emailed</option>
            <option value="BOUNCED">Bounced</option>
          </NativeSelect>
          <NativeSelect
            aria-label="Sort"
            className="w-auto"
            value={values.sort || 'newest'}
            onChange={(e) => set({ sort: e.target.value === 'newest' ? '' : e.target.value })}
          >
            <option value="newest">Sort: Newest</option>
            <option value="number">Sort: Invoice #</option>
            <option value="due">Sort: Due date</option>
            <option value="balance">Sort: Balance</option>
          </NativeSelect>
          {query.data && (
            <p className="ml-auto text-sm text-muted-foreground">
              {query.data.totals.count.toLocaleString()}{' '}
              {query.data.totals.count === 1 ? 'invoice' : 'invoices'} ·{' '}
              <span className="font-medium text-foreground">
                {formatMoney(query.data.totals.total)}
              </span>{' '}
              billed ·{' '}
              <span className="font-medium text-foreground">
                {formatMoney(query.data.totals.balance)}
              </span>{' '}
              balance
            </p>
          )}
        </div>
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
                    checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
                    onChange={(e) =>
                      setSelected(
                        new Set(
                          e.target.checked
                            ? [...selected, ...rows.map((r) => r.id)]
                            : [...selected].filter((id) => !rows.some((r) => r.id === id)),
                        ),
                      )
                    }
                  />
                </TableHead>
              )}
              <TableHead>Invoice</TableHead>
              <TableHead>Client</TableHead>
              <TableHead className="text-right">Tax year</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Issued</TableHead>
              <TableHead className="hidden md:table-cell">Due</TableHead>
              <TableHead className="hidden lg:table-cell">Email</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className={cn(query.isPlaceholderData && 'opacity-60')}>
            {query.isPending &&
              Array.from({ length: 6 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={10}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {query.data && rows.length === 0 && (
              <EmptyRow
                colSpan={10}
                message={
                  values.q || values.status || values.taxYear
                    ? 'No invoices match these filters.'
                    : 'No invoices yet. Generate drafts for a tax year to start.'
                }
              />
            )}
            {rows.map((i) => (
              <TableRow
                key={i.id}
                className="cursor-pointer"
                onClick={() => navigate(`/${org.orgSlug}/invoices/${i.id}`)}
              >
                {canEdit && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${i.number ?? `draft ${i.id}`}`}
                      checked={selected.has(i.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(i.id);
                        else next.delete(i.id);
                        setSelected(next);
                      }}
                    />
                  </TableCell>
                )}
                <TableCell>
                  <Link
                    to={`/${org.orgSlug}/invoices/${i.id}`}
                    className="font-medium hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {i.number ?? `Draft #${i.id}`}
                  </Link>
                  {i.historical && (
                    <span className="ml-1.5 text-xs text-muted-foreground">imported</span>
                  )}
                </TableCell>
                <TableCell>
                  {i.contact.displayName}
                  {i.propertyCount > 1 && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      · {i.propertyCount} properties
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{i.taxYear}</TableCell>
                <TableCell>
                  <InvoiceStatusBadge status={i.status} pastDue={i.pastDue} />
                </TableCell>
                <TableCell className="hidden md:table-cell">{formatDay(i.issueDate)}</TableCell>
                <TableCell className="hidden md:table-cell">{formatDay(i.dueDate)}</TableCell>
                <TableCell className="hidden lg:table-cell">
                  {i.delivery ? <DeliveryBadge status={i.delivery.status} /> : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(i.total)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatMoney(i.balance)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {query.data && (
          <Pagination
            page={query.data.page}
            pageSize={query.data.pageSize}
            total={query.data.total}
            onPage={(p) => set({ page: p })}
          />
        )}
      </Card>
      <GenerateDialog open={generating} onOpenChange={setGenerating} defaultYear={thisYear} />
      {sending && (
        <SendInvoicesDialog
          invoiceIds={[...selected]}
          open={sending}
          onOpenChange={setSending}
          onSent={() => setSelected(new Set())}
        />
      )}
    </>
  );
}
