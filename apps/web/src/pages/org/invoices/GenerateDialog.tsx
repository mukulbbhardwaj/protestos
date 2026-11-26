import type { GeneratePreview } from '@app/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { useOrg } from '@/hooks/useOrg';
import { useConsultants, useCounties } from '@/hooks/useReference';
import { api } from '@/lib/api';
import { TEMPLATE_LABELS } from '@/lib/billing';
import { formatMoney } from '@/lib/format';

/** BUILD_PLAN 8.6 "Generate": pick a year and filters → preview → create drafts. */
export function GenerateDialog({
  open,
  onOpenChange,
  defaultYear,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultYear: number;
}) {
  const org = useOrg();
  const qc = useQueryClient();
  const counties = useCounties();
  const consultants = useConsultants();
  const [taxYear, setTaxYear] = useState(String(defaultYear));
  const [countyId, setCountyId] = useState('');
  const [consultantId, setConsultantId] = useState('');
  const [preview, setPreview] = useState<GeneratePreview | null>(null);
  const body = {
    taxYear: Number(taxYear),
    ...(countyId ? { countyIds: [Number(countyId)] } : {}),
    ...(consultantId ? { consultantIds: [Number(consultantId)] } : {}),
  };
  const path = `/orgs/${org.orgSlug}/invoices/generate`;
  const check = useMutation({
    mutationFn: () => api<GeneratePreview>(path, { method: 'POST', body }),
    onSuccess: setPreview,
    onError: (e) => toast.error(e.message),
  });
  const create = useMutation({
    mutationFn: () =>
      api<GeneratePreview & { createdIds: number[] }>(`${path}?dryRun=false`, {
        method: 'POST',
        body,
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['org', org.orgSlug] });
      toast.success(
        `${r.createdIds.length} draft ${r.createdIds.length === 1 ? 'invoice' : 'invoices'} created. Review them, then issue.`,
      );
      setPreview(null);
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const reset = () => setPreview(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Generate invoices</DialogTitle>
          <DialogDescription>
            Property-years with final values and no invoice yet. Drafts are{' '}
            {preview?.grouping === 'PROPERTY_YEAR'
              ? 'one per property'
              : 'one per client, with a line per property'}
            ; nothing is sent until you issue them.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Tax year" htmlFor="g-year">
            <Input
              id="g-year"
              inputMode="numeric"
              value={taxYear}
              onChange={(e) => {
                setTaxYear(e.target.value);
                reset();
              }}
            />
          </Field>
          <Field label="County" htmlFor="g-county">
            <NativeSelect
              id="g-county"
              value={countyId}
              onChange={(e) => {
                setCountyId(e.target.value);
                reset();
              }}
            >
              <option value="">All counties</option>
              {counties.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Consultant" htmlFor="g-consultant">
            <NativeSelect
              id="g-consultant"
              value={consultantId}
              onChange={(e) => {
                setConsultantId(e.target.value);
                reset();
              }}
            >
              <option value="">All consultants</option>
              {consultants.data?.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        {preview && (
          <div className="max-h-[50vh] overflow-y-auto rounded-md border">
            {preview.invoices.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                Nothing to invoice for {preview.taxYear} with these filters.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Client</th>
                    <th className="px-3 py-2 text-left font-medium">Layout</th>
                    <th className="px-3 py-2 text-right font-medium">Properties</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.invoices.map((inv, i) => (
                    <tr key={i} className="border-t align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium">{inv.contact.displayName}</div>
                        <div className="text-xs text-muted-foreground">
                          {[...new Set(inv.lines.map((l) => l.property))].join(', ')}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline">{TEMPLATE_LABELS[inv.template]}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {new Set(inv.lines.map((l) => l.property)).size}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {formatMoney(inv.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {preview && preview.skipped.length > 0 && (
          <Alert>
            <div className="font-medium">
              {preview.skipped.length} property-{preview.skipped.length === 1 ? 'year' : 'years'}{' '}
              skipped
            </div>
            <ul className="mt-1 max-h-32 overflow-y-auto text-xs text-muted-foreground">
              {preview.skipped.map((s, i) => (
                <li key={i}>
                  {s.client} · {s.property}: {s.reason}
                </li>
              ))}
            </ul>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {!preview ? (
            <Button
              onClick={() => check.mutate()}
              disabled={check.isPending || !/^\d{4}$/.test(taxYear)}
            >
              {check.isPending && <Loader2 className="animate-spin" />} Preview
            </Button>
          ) : (
            <Button
              onClick={() => create.mutate()}
              disabled={create.isPending || preview.invoices.length === 0}
            >
              {create.isPending && <Loader2 className="animate-spin" />} Create{' '}
              {preview.invoices.length} {preview.invoices.length === 1 ? 'draft' : 'drafts'} ·{' '}
              {formatMoney(preview.total)}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
