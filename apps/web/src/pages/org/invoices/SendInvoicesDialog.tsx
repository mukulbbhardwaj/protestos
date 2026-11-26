import type { SendInvoicesResult } from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Send } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrg } from '@/hooks/useOrg';
import { api } from '@/lib/api';

/**
 * BUILD_PLAN 8.6 "Send": preview recipients (billing email, else email; clients without one
 * are flagged), then queue. One request key per dialog, so a double click sends once.
 */
export function SendInvoicesDialog({
  invoiceIds,
  open,
  onOpenChange,
  onSent,
}: {
  invoiceIds: number[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSent?: () => void;
}) {
  const org = useOrg();
  const qc = useQueryClient();
  const [requestKey] = useState(() => crypto.randomUUID());
  const path = `/orgs/${org.orgSlug}/invoices/send`;
  const preview = useQuery({
    queryKey: ['org', org.orgSlug, 'send-preview', invoiceIds],
    queryFn: () =>
      api<SendInvoicesResult>(path, {
        method: 'POST',
        body: { invoiceIds, requestKey, dryRun: true },
      }),
    enabled: open && invoiceIds.length > 0,
    staleTime: 0,
  });
  const send = useMutation({
    mutationFn: () =>
      api<SendInvoicesResult>(path, { method: 'POST', body: { invoiceIds, requestKey } }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['org', org.orgSlug] });
      toast.success(
        `${r.queued.length} ${r.queued.length === 1 ? 'email' : 'emails'} queued. Delivery updates appear on each invoice.`,
      );
      onOpenChange(false);
      onSent?.();
    },
    onError: (e) => toast.error(e.message),
  });
  const p = preview.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Send {invoiceIds.length} {invoiceIds.length === 1 ? 'invoice' : 'invoices'}
          </DialogTitle>
          <DialogDescription>
            Each client gets their invoice PDF attached, using your Invoice email (or the
            no-reduction email for flat-fee-only invoices).
          </DialogDescription>
        </DialogHeader>
        {preview.error && <Alert variant="destructive">{preview.error.message}</Alert>}
        {!p && !preview.error && <Skeleton className="h-32" />}
        {p && (
          <div className="grid max-h-[50vh] gap-3 overflow-y-auto">
            {p.queued.length > 0 && (
              <table className="w-full text-sm">
                <tbody>
                  {p.queued.map((q) => (
                    <tr key={q.invoiceId} className="border-b last:border-0">
                      <td className="py-1.5 pr-3 font-medium">{q.number}</td>
                      <td className="py-1.5 pr-3">{q.client}</td>
                      <td className="py-1.5 text-muted-foreground">{q.toEmail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {p.skipped.length > 0 && (
              <Alert>
                <div className="font-medium">{p.skipped.length} won&apos;t be sent</div>
                <ul className="mt-1 text-xs text-muted-foreground">
                  {p.skipped.map((s) => (
                    <li key={s.invoiceId}>
                      {s.number ?? `Draft #${s.invoiceId}`} · {s.client}: {s.reason}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => send.mutate()}
            disabled={!p || p.queued.length === 0 || send.isPending}
          >
            {send.isPending ? <Loader2 className="animate-spin" /> : <Send />} Send{' '}
            {p ? p.queued.length : ''} {p?.queued.length === 1 ? 'email' : 'emails'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
