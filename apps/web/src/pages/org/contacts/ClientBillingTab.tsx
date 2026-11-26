import {
  roleAtLeast,
  type ClientBilling,
  type GeneratePreview,
  type InvoiceSummary,
} from '@app/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FilePlus, FileDown, Loader2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrg } from '@/hooks/useOrg';
import { useOrgQuery } from '@/hooks/useOrgQuery';
import { api } from '@/lib/api';
import { formatDay, formatMoney } from '@/lib/format';
import { InvoiceStatusBadge } from '../invoices/InvoiceStatusBadge';
import { RecordPaymentDialog } from '../payments/RecordPaymentDialog';

/** A client's money position: what they owe, their credit, every invoice, and a statement. */
export function ClientBillingTab({
  contactId,
  displayName,
}: {
  contactId: number;
  displayName: string;
}) {
  const org = useOrg();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [paying, setPaying] = useState(false);
  const year = new Date().getFullYear();
  const canEdit = roleAtLeast(org.role, 'STAFF');
  const billing = useOrgQuery<ClientBilling>(`/contacts/${contactId}/billing`);
  const all = useOrgQuery<{ items: InvoiceSummary[] }>(
    `/invoices?contactId=${contactId}&pageSize=200&sort=newest`,
  );
  const apply = useMutation({
    mutationFn: () =>
      api<{ applied: string }>(`/orgs/${org.orgSlug}/contacts/${contactId}/apply-credit`, {
        method: 'POST',
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['org', org.orgSlug] });
      toast.success(
        Number(r.applied) > 0
          ? `${formatMoney(r.applied)} of credit applied.`
          : 'No open invoices to apply credit to.',
      );
    },
    onError: (e) => toast.error(e.message),
  });

  // Drafts this client's billable property-years for the year, then opens the draft.
  const invoice = useMutation({
    mutationFn: () =>
      api<GeneratePreview & { createdIds: number[] }>(
        `/orgs/${org.orgSlug}/invoices/generate?dryRun=false`,
        { method: 'POST', body: { taxYear: year, contactIds: [contactId] } },
      ),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['org', org.orgSlug] });
      if (r.createdIds[0]) navigate(`/${org.orgSlug}/invoices/${r.createdIds[0]}`);
      else
        toast.info(
          r.skipped[0]
            ? `Nothing to invoice: ${r.skipped[0].property}: ${r.skipped[0].reason}`
            : `Nothing to invoice for ${year}: no final values, or already invoiced.`,
        );
    },
    onError: (e) => toast.error(e.message),
  });

  if (billing.error) return <Alert variant="destructive">{billing.error.message}</Alert>;
  if (billing.isPending) return <Skeleton className="h-48 w-full" />;
  const b = billing.data;

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Balance due" value={b.openBalance} strong />
        <Tile label="Past due" value={b.pastDueBalance} danger={Number(b.pastDueBalance) > 0} />
        <Tile label="Credit" value={b.credit} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" asChild>
          <a
            href={`/api/orgs/${org.orgSlug}/contacts/${contactId}/statement.pdf`}
            target="_blank"
            rel="noreferrer"
          >
            <FileDown /> Statement PDF
          </a>
        </Button>
        {canEdit && (
          <>
            <Button variant="outline" onClick={() => invoice.mutate()} disabled={invoice.isPending}>
              {invoice.isPending ? <Loader2 className="animate-spin" /> : <FilePlus />} Invoice{' '}
              {year}
            </Button>
            <Button onClick={() => setPaying(true)}>
              <Wallet /> Record payment
            </Button>
            {Number(b.credit) > 0 && b.openInvoices.length > 0 && (
              <Button variant="outline" onClick={() => apply.mutate()} disabled={apply.isPending}>
                {apply.isPending && <Loader2 className="animate-spin" />} Apply{' '}
                {formatMoney(b.credit)} credit
              </Button>
            )}
          </>
        )}
      </div>
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
          <CardDescription>Every invoice for {displayName}, newest first.</CardDescription>
        </CardHeader>
        <table className="w-full text-sm">
          <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-5 py-2.5 text-left font-medium">Invoice</th>
              <th className="px-5 py-2.5 text-right font-medium">Tax year</th>
              <th className="px-5 py-2.5 text-left font-medium">Status</th>
              <th className="px-5 py-2.5 text-left font-medium">Due</th>
              <th className="px-5 py-2.5 text-right font-medium">Total</th>
              <th className="px-5 py-2.5 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {all.data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-6 text-center text-muted-foreground">
                  No invoices yet.
                </td>
              </tr>
            )}
            {all.data?.items.map((i) => (
              <tr key={i.id} className="border-b last:border-0">
                <td className="px-5 py-2">
                  <Link
                    to={`/${org.orgSlug}/invoices/${i.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {i.number ?? `Draft #${i.id}`}
                  </Link>
                </td>
                <td className="px-5 py-2 text-right tabular-nums">{i.taxYear}</td>
                <td className="px-5 py-2">
                  <InvoiceStatusBadge status={i.status} pastDue={i.pastDue} />
                </td>
                <td className="px-5 py-2">{formatDay(i.dueDate)}</td>
                <td className="px-5 py-2 text-right tabular-nums">{formatMoney(i.total)}</td>
                <td className="px-5 py-2 text-right font-medium tabular-nums">
                  {formatMoney(i.balance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <RecordPaymentDialog
        open={paying}
        onOpenChange={setPaying}
        contact={{ id: contactId, displayName }}
      />
    </div>
  );
}

function Tile({
  label,
  value,
  strong,
  danger,
}: {
  label: string;
  value: string;
  strong?: boolean;
  danger?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={
          danger
            ? 'text-2xl font-semibold tabular-nums text-destructive'
            : strong
              ? 'text-2xl font-semibold tabular-nums'
              : 'text-2xl tabular-nums'
        }
      >
        {formatMoney(value)}
      </div>
    </Card>
  );
}
