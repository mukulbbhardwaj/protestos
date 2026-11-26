import {
  PAYMENT_METHODS,
  type ClientBilling,
  type ContactSummary,
  type PaymentDto,
  type PaymentMethod,
} from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, NativeSelect } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { useOrg } from '@/hooks/useOrg';
import { qs } from '@/hooks/useUrlState';
import { api } from '@/lib/api';
import { METHOD_LABELS, todayIso } from '@/lib/billing';
import { formatDay, formatMoney } from '@/lib/format';

const toCents = (v: string) => Math.round(Number(v.replace(/[$,]/g, '') || 0) * 100);

/**
 * BUILD_PLAN 8.7: record a payment for a client and spread it over their open invoices,
 * oldest first unless amounts are set by hand. What's left over stays as credit.
 */
export function RecordPaymentDialog({
  open,
  onOpenChange,
  contact,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Preselected client (from an invoice or client page). */
  contact?: { id: number; displayName: string };
}) {
  const org = useOrg();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(contact ?? null);
  const [amount, setAmount] = useState('');
  const [receivedAt, setReceivedAt] = useState(todayIso());
  const [method, setMethod] = useState<PaymentMethod>('CHECK');
  const [reference, setReference] = useState('');
  const [manual, setManual] = useState<Record<number, string> | null>(null);
  const [receipt, setReceipt] = useState(true);
  const client = picked ?? contact ?? null;

  const matches = useQuery({
    queryKey: ['org', org.orgSlug, 'payment-client-search', search],
    queryFn: () =>
      api<{ items: ContactSummary[] }>(
        `/orgs/${org.orgSlug}/contacts${qs({ kind: 'CLIENT', q: search, pageSize: 8 })}`,
      ),
    enabled: open && !client && search.trim().length > 1,
  });
  const billing = useQuery({
    queryKey: ['org', org.orgSlug, 'billing', client?.id],
    queryFn: () => api<ClientBilling>(`/orgs/${org.orgSlug}/contacts/${client!.id}/billing`),
    enabled: open && Boolean(client),
  });
  const open_ = billing.data?.openInvoices ?? [];

  // Oldest first, as the server will do it, so the preview matches.
  let left = toCents(amount);
  const auto = Object.fromEntries(
    open_.map((i) => {
      const take = Math.max(0, Math.min(left, toCents(i.balance)));
      left -= take;
      return [i.id, (take / 100).toFixed(2)];
    }),
  );
  const shown = manual ?? auto;
  const allocated = Object.values(shown).reduce((s, v) => s + toCents(v), 0);
  const credit = toCents(amount) - allocated;

  const save = useMutation({
    mutationFn: () =>
      api<PaymentDto>(`/orgs/${org.orgSlug}/payments`, {
        method: 'POST',
        body: {
          contactId: client!.id,
          receivedAt,
          amount: amount.replace(/[$,]/g, ''),
          method,
          reference,
          sendReceipt: receipt && Boolean(billing.data?.hasEmail),
          ...(manual
            ? {
                allocations: Object.entries(manual)
                  .filter(([, v]) => toCents(v) > 0)
                  .map(([invoiceId, v]) => ({ invoiceId: Number(invoiceId), amount: v })),
              }
            : {}),
        },
      }),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['org', org.orgSlug] });
      toast.success(
        `Payment of ${formatMoney(p.amount)} recorded${Number(p.unallocated) > 0 ? `; ${formatMoney(p.unallocated)} kept as credit` : ''}.`,
      );
      close();
    },
    onError: (e) => toast.error(e.message),
  });
  function close() {
    onOpenChange(false);
    setAmount('');
    setReference('');
    setManual(null);
    setSearch('');
    if (!contact) setPicked(null);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            Applied to the client&apos;s oldest open invoices first. Anything left over is kept as
            credit.
          </DialogDescription>
        </DialogHeader>
        {!client ? (
          <div className="grid gap-2">
            <Field label="Client" htmlFor="pay-client">
              <Input
                id="pay-client"
                autoFocus
                placeholder="Search name or client #"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Field>
            <ul className="divide-y rounded-md border empty:hidden">
              {matches.data?.items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                    onClick={() => setPicked({ id: c.id, displayName: c.displayName })}
                  >
                    {c.displayName} <span className="text-muted-foreground">{c.clientNumber}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <form
            id="pay-form"
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
              <span className="font-medium">{client.displayName}</span>
              {billing.data && (
                <span className="text-muted-foreground">
                  Owes {formatMoney(billing.data.openBalance)}
                  {Number(billing.data.credit) > 0 &&
                    ` · ${formatMoney(billing.data.credit)} credit`}
                </span>
              )}
              {!contact && (
                <Button type="button" variant="link" size="sm" onClick={() => setPicked(null)}>
                  Change
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Amount" htmlFor="pay-amount">
                <MoneyInput id="pay-amount" autoFocus value={amount} onChange={setAmount} />
              </Field>
              <Field label="Received" htmlFor="pay-date">
                <Input
                  id="pay-date"
                  type="date"
                  value={receivedAt}
                  onChange={(e) => setReceivedAt(e.target.value)}
                />
              </Field>
              <Field label="Method" htmlFor="pay-method">
                <NativeSelect
                  id="pay-method"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {METHOD_LABELS[m]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Reference" htmlFor="pay-ref" hint="Check # or note">
                <Input
                  id="pay-ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </Field>
            </div>
            {open_.length > 0 && (
              <div className="rounded-md border">
                <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
                  <span className="font-medium">Apply to</span>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    onClick={() => setManual(manual ? null : { ...auto })}
                  >
                    {manual ? 'Oldest first' : 'Choose amounts'}
                  </Button>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {open_.map((i) => (
                      <tr key={i.id} className="border-b last:border-0">
                        <td className="px-3 py-1.5">
                          {i.number} <span className="text-muted-foreground">· {i.taxYear}</span>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          Due {formatDay(i.dueDate)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {formatMoney(i.balance)}
                        </td>
                        <td className="w-36 px-3 py-1.5">
                          {manual ? (
                            <MoneyInput
                              aria-label={`Apply to ${i.number}`}
                              className="h-8"
                              value={manual[i.id] ?? ''}
                              onChange={(v) => setManual({ ...manual, [i.id]: v })}
                            />
                          ) : (
                            <div className="text-right tabular-nums">
                              {formatMoney(shown[i.id] ?? 0)}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={receipt && Boolean(billing.data?.hasEmail)}
                disabled={!billing.data?.hasEmail}
                onChange={(e) => setReceipt(e.target.checked)}
              />
              {billing.data?.hasEmail
                ? 'Email the client a receipt'
                : 'No email on file for a receipt'}
            </label>
            {toCents(amount) > 0 && (
              <p
                className={
                  credit < 0 ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
                }
              >
                {credit < 0
                  ? 'The amounts applied are more than the payment.'
                  : credit > 0
                    ? `${formatMoney(credit / 100)} will be kept as credit.`
                    : 'The whole payment is applied.'}
              </p>
            )}
          </form>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="pay-form"
            disabled={!client || save.isPending || toCents(amount) <= 0 || credit < 0}
          >
            {save.isPending && <Loader2 className="animate-spin" />} Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
