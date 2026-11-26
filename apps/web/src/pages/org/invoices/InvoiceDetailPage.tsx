import {
  INVOICE_TEMPLATES,
  OPEN_STATUSES,
  roleAtLeast,
  type InvoiceDetail,
  type InvoiceTemplate,
} from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  FileDown,
  Loader2,
  Mail,
  Plus,
  Send,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ReasonDialog } from '@/components/ReasonDialog';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import { useOrg } from '@/hooks/useOrg';
import { api } from '@/lib/api';
import { METHOD_LABELS, TEMPLATE_LABELS, todayIso } from '@/lib/billing';
import { formatDateTime, formatDay, formatMoney } from '@/lib/format';
import { RecordPaymentDialog } from '../payments/RecordPaymentDialog';
import { DeliveryBadge } from './DeliveryBadge';
import { InvoiceStatusBadge } from './InvoiceStatusBadge';
import { SendInvoicesDialog } from './SendInvoicesDialog';

type Snapshot = {
  values?: Record<string, string | null>;
  savingsBasis?: string;
  fee?: { reduction: string | null; taxableSavings: string | null; contingencyPct: string };
};

export function InvoiceDetailPage() {
  const { invoiceId = '' } = useParams();
  const org = useOrg();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const base = `/orgs/${org.orgSlug}/invoices/${invoiceId}`;
  const key = ['org', org.orgSlug, 'invoice', invoiceId];
  const q = useQuery({ queryKey: key, queryFn: () => api<InvoiceDetail>(base) });
  const canEdit = roleAtLeast(org.role, 'STAFF');
  const [dialog, setDialog] = useState<
    null | 'issue' | 'void' | 'writeOff' | 'pay' | 'line' | 'send'
  >(null);

  const done = (message: string) => (inv?: InvoiceDetail) => {
    if (inv) qc.setQueryData(key, inv);
    void qc.invalidateQueries({ queryKey: ['org', org.orgSlug] });
    setDialog(null);
    toast.success(message);
  };
  const fail = (e: Error) => toast.error(e.message);
  const patch = useMutation({
    mutationFn: (body: object) => api<InvoiceDetail>(base, { method: 'PATCH', body }),
    onSuccess: done('Saved.'),
    onError: fail,
  });
  const removeLine = useMutation({
    mutationFn: (lineId: number) =>
      api<{ deleted: boolean }>(`${base}/lines/${lineId}`, { method: 'DELETE' }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['org', org.orgSlug] });
      if (r.deleted) navigate(`/${org.orgSlug}/invoices`);
    },
    onError: fail,
  });
  const removeDraft = useMutation({
    mutationFn: () => api(base, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['org', org.orgSlug] });
      toast.success('Draft deleted.');
      navigate(`/${org.orgSlug}/invoices`);
    },
    onError: fail,
  });
  const voidIt = useMutation({
    mutationFn: (reason: string) =>
      api<InvoiceDetail>(`${base}/void`, { method: 'POST', body: { reason } }),
    onSuccess: done('Invoice voided. Its properties can be invoiced again.'),
    onError: fail,
  });
  const writeOff = useMutation({
    mutationFn: (reason: string) =>
      api<InvoiceDetail>(`${base}/write-off`, { method: 'POST', body: { reason } }),
    onSuccess: done('Invoice written off.'),
    onError: fail,
  });

  if (q.error) return <Alert variant="destructive">{q.error.message}</Alert>;
  if (q.isPending) return <Skeleton className="h-96 w-full" />;
  const inv = q.data;
  const draft = inv.status === 'DRAFT';
  const open = OPEN_STATUSES.includes(inv.status);

  return (
    <>
      <Link
        to={`/${org.orgSlug}/invoices`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Invoices
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {inv.number ? `Invoice ${inv.number}` : `Draft invoice #${inv.id}`}
            </h1>
            <InvoiceStatusBadge status={inv.status} pastDue={inv.pastDue} />
            {inv.historical && <span className="text-sm text-muted-foreground">Imported</span>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link
              to={`/${org.orgSlug}/contacts/${inv.contact.id}`}
              className="text-primary hover:underline"
            >
              {inv.contact.displayName}
            </Link>{' '}
            · Tax year {inv.taxYear}
            {inv.issueDate && <> · Issued {formatDay(inv.issueDate)}</>}
            {inv.dueDate && <> · Due {formatDay(inv.dueDate)}</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <a href={`/api${base}/pdf`} target="_blank" rel="noreferrer">
              <FileDown /> {draft ? 'Preview PDF' : 'PDF'}
            </a>
          </Button>
          {canEdit && draft && (
            <>
              <Button
                variant="ghost"
                onClick={() => removeDraft.mutate()}
                disabled={removeDraft.isPending}
              >
                <Trash2 /> Delete draft
              </Button>
              <Button onClick={() => setDialog('issue')}>
                <Send /> Issue
              </Button>
            </>
          )}
          {canEdit && inv.hasPdf && inv.status !== 'VOID' && (
            <Button variant="outline" onClick={() => setDialog('send')}>
              <Mail /> {inv.deliveries.length ? 'Email again' : 'Email'}
            </Button>
          )}
          {canEdit && open && (
            <>
              <Button variant="ghost" onClick={() => setDialog('writeOff')}>
                Write off
              </Button>
              <Button onClick={() => setDialog('pay')}>
                <Wallet /> Record payment
              </Button>
            </>
          )}
          {canEdit && !draft && inv.status !== 'VOID' && (
            <Button variant="ghost" onClick={() => setDialog('void')}>
              <Ban /> Void
            </Button>
          )}
        </div>
      </div>

      {inv.status === 'VOID' && <Alert className="mb-6">Voided: {inv.voidReason}</Alert>}
      {inv.status === 'WRITTEN_OFF' && (
        <Alert className="mb-6">Written off: {inv.writeOffReason}</Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card className="overflow-hidden">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Lines</CardTitle>
              <CardDescription>
                {draft
                  ? 'Fees are recalculated from current values when you issue, then frozen.'
                  : 'Frozen at issue: later changes to values or fee terms don’t affect this invoice.'}
              </CardDescription>
            </div>
            {canEdit && draft && (
              <div className="flex items-center gap-2">
                <NativeSelect
                  aria-label="Layout"
                  className="h-8 w-auto"
                  value={inv.template}
                  onChange={(e) => patch.mutate({ template: e.target.value as InvoiceTemplate })}
                >
                  {INVOICE_TEMPLATES.map((t) => (
                    <option key={t} value={t}>
                      Layout: {TEMPLATE_LABELS[t]}
                    </option>
                  ))}
                </NativeSelect>
                <Button size="sm" variant="outline" onClick={() => setDialog('line')}>
                  <Plus /> Adjustment
                </Button>
              </div>
            )}
          </CardHeader>
          <table className="w-full text-sm">
            <tbody>
              {inv.lines.map((l, idx) => {
                const s = l.snapshot as Snapshot | null;
                const showProperty =
                  l.property && l.property.id !== inv.lines[idx - 1]?.property?.id;
                return (
                  <tr key={l.id} className="border-t align-top">
                    <td className="px-5 py-2.5">
                      {showProperty && (
                        <div className="mb-1">
                          <Link
                            to={`/${org.orgSlug}/properties/${l.property!.id}`}
                            className="font-medium hover:underline"
                          >
                            {l.property!.county} {l.property!.accountNumber}
                          </Link>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {l.property!.situsLine}
                          </span>
                        </div>
                      )}
                      <div>{l.description}</div>
                      {l.kind === 'CONTINGENCY' && s?.fee?.reduction && (
                        <div className="text-xs text-muted-foreground">
                          Reduction {formatMoney(s.fee.reduction)} × {Number(s.values?.taxRatePct)}%
                          = {formatMoney(s.fee.taxableSavings ?? 0)} saved ×{' '}
                          {Number(s.fee.contingencyPct)}%
                        </div>
                      )}
                    </td>
                    <td className="w-32 px-5 py-2.5 text-right tabular-nums">
                      {formatMoney(l.amount)}
                    </td>
                    {canEdit && draft && (
                      <td className="w-10 py-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label={`Remove ${l.description}`}
                          onClick={() => removeLine.mutate(l.id)}
                        >
                          <X className="size-4" />
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="grid gap-1 border-t bg-muted/30 px-5 py-3 text-sm">
            <Row label="Total" value={inv.total} strong />
            <Row label="Paid" value={inv.amountPaid} />
            <Row label="Balance" value={inv.balance} strong />
          </div>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Bill to</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <div className="font-medium">{inv.billTo.name}</div>
              {inv.billTo.addressLines.map((l) => (
                <div key={l}>{l}</div>
              ))}
              <div className="text-muted-foreground">{inv.billTo.email ?? 'No email on file'}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {inv.payments.length === 0 && <p className="text-muted-foreground">None yet.</p>}
              {inv.payments.map((p) => (
                <div key={p.paymentId} className="flex justify-between gap-2">
                  <span>
                    {formatDay(p.receivedAt)} · {METHOD_LABELS[p.method]}
                    {p.reference && <span className="text-muted-foreground"> {p.reference}</span>}
                  </span>
                  <span className="tabular-nums">{formatMoney(p.amount)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          {inv.deliveries.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Emails</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                {inv.deliveries.map((d) => (
                  <div key={d.id} className="grid gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{d.toEmail}</span>
                      <DeliveryBadge status={d.status} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {d.sentAt
                        ? `Sent ${formatDateTime(d.sentAt)}`
                        : `Queued ${formatDateTime(d.queuedAt)}`}
                      {d.events.map((e) => (
                        <div key={e.id}>
                          {e.type[0]!.toUpperCase() + e.type.slice(1)} {formatDateTime(e.at)}
                          {e.detail && `: ${e.detail}`}
                        </div>
                      ))}
                      {d.error && <div className="text-destructive">{d.error}</div>}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          <NotesCard
            notes={inv.notes}
            canEdit={canEdit && inv.status !== 'VOID'}
            pending={patch.isPending}
            onSave={(notes) => patch.mutate({ notes })}
          />
        </div>
      </div>

      <IssueDialog
        open={dialog === 'issue'}
        onOpenChange={(o) => setDialog(o ? 'issue' : null)}
        base={base}
        onIssued={done('Invoice issued.')}
      />
      <LineDialog
        open={dialog === 'line'}
        onOpenChange={(o) => setDialog(o ? 'line' : null)}
        base={base}
        onAdded={done('Adjustment added.')}
      />
      <ReasonDialog
        open={dialog === 'void'}
        onOpenChange={(o) => setDialog(o ? 'void' : null)}
        title={`Void ${inv.number}?`}
        description="A void invoice stays on record with its number. Payments applied to it become client credit, and its properties can be invoiced again."
        action="Void invoice"
        pending={voidIt.isPending}
        onConfirm={(r) => voidIt.mutate(r)}
      />
      <ReasonDialog
        open={dialog === 'writeOff'}
        onOpenChange={(o) => setDialog(o ? 'writeOff' : null)}
        title={`Write off ${formatMoney(inv.balance)}?`}
        description="The invoice stops counting as outstanding. Payments already received stay."
        action="Write off"
        pending={writeOff.isPending}
        onConfirm={(r) => writeOff.mutate(r)}
      />
      {dialog === 'send' && (
        <SendInvoicesDialog
          invoiceIds={[inv.id]}
          open
          onOpenChange={(o) => setDialog(o ? 'send' : null)}
        />
      )}
      <RecordPaymentDialog
        open={dialog === 'pay'}
        onOpenChange={(o) => setDialog(o ? 'pay' : null)}
        contact={inv.contact}
      />
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className={strong ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
      <span className={strong ? 'font-semibold tabular-nums' : 'tabular-nums'}>
        {formatMoney(value)}
      </span>
    </div>
  );
}

function NotesCard({
  notes,
  canEdit,
  pending,
  onSave,
}: {
  notes: string | null;
  canEdit: boolean;
  pending: boolean;
  onSave: (notes: string) => void;
}) {
  const [text, setText] = useState(notes ?? '');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes</CardTitle>
        <CardDescription>Printed on the invoice.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <textarea
          aria-label="Invoice notes"
          className="min-h-20 rounded-md border bg-transparent px-3 py-2 text-sm"
          value={text}
          disabled={!canEdit}
          onChange={(e) => setText(e.target.value)}
        />
        {canEdit && text !== (notes ?? '') && (
          <Button size="sm" onClick={() => onSave(text)} disabled={pending}>
            Save notes
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function IssueDialog({
  open,
  onOpenChange,
  base,
  onIssued,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  base: string;
  onIssued: (inv: InvoiceDetail) => void;
}) {
  const [issueDate, setIssueDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState('');
  const issue = useMutation({
    mutationFn: () =>
      api<InvoiceDetail>(`${base}/issue`, {
        method: 'POST',
        body: { issueDate, ...(dueDate ? { dueDate } : {}) },
      }),
    onSuccess: onIssued,
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue invoice</DialogTitle>
          <DialogDescription>
            Assigns the next invoice number, recalculates fees from current values and freezes them,
            and moves each property-year to Invoiced.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Issue date" htmlFor="issue-date">
            <Input
              id="issue-date"
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
          </Field>
          <Field label="Due date" htmlFor="due-date" hint="Blank: your firm's payment terms.">
            <Input
              id="due-date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => issue.mutate()} disabled={issue.isPending}>
            {issue.isPending && <Loader2 className="animate-spin" />} Issue invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LineDialog({
  open,
  onOpenChange,
  base,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  base: string;
  onAdded: (inv: InvoiceDetail) => void;
}) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const add = useMutation({
    mutationFn: () =>
      api<InvoiceDetail>(`${base}/lines`, { method: 'POST', body: { description, amount } }),
    onSuccess: (inv) => {
      setDescription('');
      setAmount('');
      onAdded(inv);
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an adjustment</DialogTitle>
          <DialogDescription>Use a negative amount for a discount, like -50.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Field label="Description" htmlFor="adj-desc">
            <Input
              id="adj-desc"
              autoFocus
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label="Amount" htmlFor="adj-amount">
            <Input
              id="adj-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={add.isPending || !description || !amount}>
              {add.isPending && <Loader2 className="animate-spin" />} Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
