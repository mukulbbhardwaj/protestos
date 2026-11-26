import { PAYMENT_METHODS, roleAtLeast, type PaymentDto } from '@app/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { EmptyRow } from '@/components/data/EmptyRow';
import { Pagination } from '@/components/data/Pagination';
import { PageHeader } from '@/components/layout/PageHeader';
import { ReasonDialog } from '@/components/ReasonDialog';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
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
import { METHOD_LABELS } from '@/lib/billing';
import { formatDay, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { RecordPaymentDialog } from './RecordPaymentDialog';

interface Page {
  items: PaymentDto[];
  total: number;
  page: number;
  pageSize: number;
  sum: string;
}

const KEYS = ['method', 'from', 'to'] as const;

export function PaymentsPage() {
  const org = useOrg();
  const qc = useQueryClient();
  const { values, set, page } = useUrlState(KEYS);
  const [recording, setRecording] = useState(false);
  const [deleting, setDeleting] = useState<PaymentDto | null>(null);
  const canEdit = roleAtLeast(org.role, 'STAFF');
  const query = useQuery({
    queryKey: ['org', org.orgSlug, 'payments', values, page],
    queryFn: () =>
      api<Page>(`/orgs/${org.orgSlug}/payments${qs({ ...values, page, pageSize: 50 })}`),
    placeholderData: keepPreviousData,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/orgs/${org.orgSlug}/payments/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['org', org.orgSlug] });
      setDeleting(null);
      toast.success('Payment deleted. Its invoices are open again.');
    },
    onError: (e) => toast.error(e.message),
  });
  const rows = query.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Payments"
        description="Money received from clients, and the invoices each payment paid."
        actions={
          canEdit && (
            <Button onClick={() => setRecording(true)}>
              <Plus /> Record payment
            </Button>
          )
        }
      />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <NativeSelect
            aria-label="Method"
            className="w-auto"
            value={values.method}
            onChange={(e) => set({ method: e.target.value })}
          >
            <option value="">All methods</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABELS[m]}
              </option>
            ))}
          </NativeSelect>
          <Input
            aria-label="From"
            type="date"
            className="w-auto"
            value={values.from}
            onChange={(e) => set({ from: e.target.value })}
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            aria-label="To"
            type="date"
            className="w-auto"
            value={values.to}
            onChange={(e) => set({ to: e.target.value })}
          />
          {query.data && (
            <p className="ml-auto text-sm text-muted-foreground">
              {query.data.total.toLocaleString()} {query.data.total === 1 ? 'payment' : 'payments'}{' '}
              · <span className="font-medium text-foreground">{formatMoney(query.data.sum)}</span>
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
              <TableHead>Received</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Applied to</TableHead>
              <TableHead className="text-right">Credit</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              {canEdit && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody className={cn(query.isPlaceholderData && 'opacity-60')}>
            {query.isPending && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            )}
            {query.data && rows.length === 0 && (
              <EmptyRow colSpan={7} message="No payments recorded." />
            )}
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{formatDay(p.receivedAt)}</TableCell>
                <TableCell>
                  <Link to={`/${org.orgSlug}/contacts/${p.contact.id}`} className="hover:underline">
                    {p.contact.displayName}
                  </Link>
                </TableCell>
                <TableCell>
                  {METHOD_LABELS[p.method]}
                  {p.reference && <span className="text-muted-foreground"> {p.reference}</span>}
                </TableCell>
                <TableCell className="text-sm">
                  {p.allocations.length === 0 && <span className="text-muted-foreground">—</span>}
                  {p.allocations.map((a, i) => (
                    <span key={a.invoiceId}>
                      {i > 0 && ', '}
                      <Link
                        to={`/${org.orgSlug}/invoices/${a.invoiceId}`}
                        className="text-primary hover:underline"
                      >
                        {a.number}
                      </Link>{' '}
                      <span className="text-muted-foreground">{formatMoney(a.amount)}</span>
                    </span>
                  ))}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {Number(p.unallocated) > 0 ? formatMoney(p.unallocated) : '—'}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatMoney(p.amount)}
                </TableCell>
                {canEdit && (
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label="Delete payment"
                      onClick={() => setDeleting(p)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                )}
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
      <RecordPaymentDialog open={recording} onOpenChange={setRecording} />
      <ReasonDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete this ${deleting ? formatMoney(deleting.amount) : ''} payment?`}
        description="The invoices it paid become open again. The payment stays in the audit log."
        action="Delete payment"
        withReason={false}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}
