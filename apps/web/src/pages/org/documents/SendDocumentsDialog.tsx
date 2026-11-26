import type { DocumentKind, EnvelopeDto, PropertySummary } from '@app/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, Loader2, Send } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { useOrg } from '@/hooks/useOrg';
import { qs } from '@/hooks/useUrlState';
import { api } from '@/lib/api';

const KINDS: { kind: DocumentKind; label: string; hint: string }[] = [
  {
    kind: 'ENGAGEMENT_CONTRACT',
    label: 'Engagement agreement',
    hint: 'Your firm’s wording, with the properties listed.',
  },
  {
    kind: 'AOA_50_162',
    label: 'Form 50-162',
    hint: 'Appointment of Agent, one per appraisal district.',
  },
];

/** BUILD_PLAN 8.8 flow: pick documents and properties → preview → send for signature. */
export function SendDocumentsDialog({
  open,
  onOpenChange,
  contact,
  properties,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contact: { id: number; displayName: string; email: string | null };
  properties: PropertySummary[];
}) {
  const org = useOrg();
  const qc = useQueryClient();
  const active = properties.filter((p) => !p.archivedAt);
  const [kinds, setKinds] = useState<DocumentKind[]>(['ENGAGEMENT_CONTRACT', 'AOA_50_162']);
  const [ids, setIds] = useState<number[]>(active.map((p) => p.id));
  const [taxYear, setTaxYear] = useState(String(new Date().getFullYear()));
  const [signerName, setSignerName] = useState(contact.displayName);
  const [signerEmail, setSignerEmail] = useState(contact.email ?? '');
  const send = useMutation({
    mutationFn: () =>
      api<EnvelopeDto>(`/orgs/${org.orgSlug}/contacts/${contact.id}/documents`, {
        method: 'POST',
        body: { kinds, propertyIds: ids, taxYear: Number(taxYear), signerName, signerEmail },
      }),
    onSuccess: (e) => {
      void qc.invalidateQueries({ queryKey: ['org', org.orgSlug] });
      toast.success(
        `Sent ${e.documents.length} ${e.documents.length === 1 ? 'document' : 'documents'} to ${e.signerEmail} for signature.`,
      );
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const toggle = <T,>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const previewUrl = (kind: DocumentKind) =>
    `/api/orgs/${org.orgSlug}/contacts/${contact.id}/documents/preview${qs({
      kind,
      propertyIds: ids.join(','),
      taxYear,
      signerName,
      signerEmail,
    })}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Send documents to sign</DialogTitle>
          <DialogDescription>
            {contact.displayName} gets one email with a link to read and sign everything at once.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {KINDS.map((k) => (
              <label key={k.kind} className="flex items-start gap-2 rounded-md border p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={kinds.includes(k.kind)}
                  onChange={() => setKinds(toggle(kinds, k.kind))}
                />
                <span className="grid gap-0.5">
                  <span className="font-medium">{k.label}</span>
                  <span className="text-xs text-muted-foreground">{k.hint}</span>
                  <a
                    href={previewUrl(k.kind)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    aria-disabled={ids.length === 0}
                  >
                    <Eye className="size-3" /> Preview
                  </a>
                </span>
              </label>
            ))}
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium">Properties</p>
            {active.length === 0 ? (
              <p className="text-sm text-muted-foreground">Add a property first.</p>
            ) : (
              <ul className="max-h-40 divide-y overflow-y-auto rounded-md border text-sm">
                {active.map((p) => (
                  <li key={p.id}>
                    <label className="flex items-center gap-2 px-3 py-1.5">
                      <input
                        type="checkbox"
                        checked={ids.includes(p.id)}
                        onChange={() => setIds(toggle(ids, p.id))}
                      />
                      <span className="font-mono">{p.accountNumber}</span>
                      <span className="text-muted-foreground">
                        {p.county.name} · {p.situsLine ?? 'No address'}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-[6rem_1fr_1fr]">
            <Field label="Tax year" htmlFor="doc-year">
              <Input
                id="doc-year"
                inputMode="numeric"
                value={taxYear}
                onChange={(e) => setTaxYear(e.target.value)}
              />
            </Field>
            <Field label="Signer name" htmlFor="doc-signer">
              <Input
                id="doc-signer"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
              />
            </Field>
            <Field label="Signer email" htmlFor="doc-email">
              <Input
                id="doc-email"
                type="email"
                value={signerEmail}
                onChange={(e) => setSignerEmail(e.target.value)}
              />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => send.mutate()}
            disabled={send.isPending || !kinds.length || !ids.length || !signerEmail.includes('@')}
          >
            {send.isPending ? <Loader2 className="animate-spin" /> : <Send />} Send for signature
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
