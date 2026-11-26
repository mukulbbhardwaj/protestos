import { roleAtLeast, type DocumentDto, type EnvelopeDto } from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Ban, Copy, FileDown, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ReasonDialog } from '@/components/ReasonDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useOrg } from '@/hooks/useOrg';
import { api, uploadFile } from '@/lib/api';
import { DOCUMENT_STATUS } from '@/lib/documents';
import { formatDate, formatDateTime } from '@/lib/format';

/** Documents with their status, signed/unsigned copies, and the signing request's actions. */
export function DocumentsTable({
  documents,
  showClient,
}: {
  documents: DocumentDto[];
  showClient?: boolean;
}) {
  const org = useOrg();
  const [envelopeId, setEnvelopeId] = useState<number | null>(null);
  const canEdit = roleAtLeast(org.role, 'STAFF');
  const base = `/api/orgs/${org.orgSlug}/documents`;
  return (
    <>
      <table className="w-full text-sm">
        <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-5 py-2.5 text-left font-medium">Document</th>
            {showClient && <th className="px-5 py-2.5 text-left font-medium">Client</th>}
            <th className="px-5 py-2.5 text-left font-medium">Properties</th>
            <th className="px-5 py-2.5 text-left font-medium">Status</th>
            <th className="px-5 py-2.5 text-left font-medium">Sent</th>
            <th className="px-5 py-2.5 text-right font-medium">Files</th>
          </tr>
        </thead>
        <tbody>
          {documents.length === 0 && (
            <tr>
              <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                No documents yet.
              </td>
            </tr>
          )}
          {documents.map((d) => (
            <tr key={d.id} className="border-b last:border-0">
              <td className="px-5 py-2.5">
                <button
                  type="button"
                  className="text-left font-medium hover:underline disabled:no-underline"
                  disabled={!d.envelopeId}
                  onClick={() => setEnvelopeId(d.envelopeId)}
                >
                  {d.title}
                </button>
                {d.taxYear && (
                  <span className="ml-1.5 text-xs text-muted-foreground">{d.taxYear}</span>
                )}
              </td>
              {showClient && (
                <td className="px-5 py-2.5">
                  <Link to={`/${org.orgSlug}/contacts/${d.contact.id}`} className="hover:underline">
                    {d.contact.displayName}
                  </Link>
                </td>
              )}
              <td className="px-5 py-2.5 text-xs text-muted-foreground">
                {d.properties.map((p) => `${p.county} ${p.accountNumber}`).join(', ')}
              </td>
              <td className="px-5 py-2.5">
                <Badge variant={DOCUMENT_STATUS[d.status].variant}>
                  {DOCUMENT_STATUS[d.status].label}
                </Badge>
                {d.signedOffline && (
                  <span className="ml-1.5 text-xs text-muted-foreground">on paper</span>
                )}
              </td>
              <td className="px-5 py-2.5 text-muted-foreground">{formatDate(d.createdAt)}</td>
              <td className="px-5 py-2.5 text-right">
                <div className="flex justify-end gap-1">
                  {d.hasSigned && (
                    <Button size="sm" variant="outline" asChild>
                      <a href={`${base}/${d.id}/pdf`} target="_blank" rel="noreferrer">
                        <FileDown /> Signed
                      </a>
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" asChild>
                    <a href={`${base}/${d.id}/pdf?signed=false`} target="_blank" rel="noreferrer">
                      Original
                    </a>
                  </Button>
                  {canEdit && !d.hasSigned && d.status !== 'VOIDED' && <UploadSigned id={d.id} />}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {envelopeId && <EnvelopeDialog id={envelopeId} onClose={() => setEnvelopeId(null)} />}
    </>
  );
}

function UploadSigned({ id }: { id: number }) {
  const org = useOrg();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => uploadFile(`/orgs/${org.orgSlug}/documents/${id}/signed`, file),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['org', org.orgSlug] });
      toast.success('Marked as signed with the uploaded copy.');
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        className="hidden"
        aria-label="Signed PDF"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate(f);
          e.target.value = '';
        }}
      />
      <Button
        size="sm"
        variant="ghost"
        title="Signed on paper? Upload the scan."
        onClick={() => input.current?.click()}
      >
        <Upload /> Upload signed
      </Button>
    </>
  );
}

function EnvelopeDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const org = useOrg();
  const qc = useQueryClient();
  const [voiding, setVoiding] = useState(false);
  const path = `/orgs/${org.orgSlug}/envelopes/${id}`;
  const e = useQuery({
    queryKey: ['org', org.orgSlug, 'envelope', id],
    queryFn: () => api<EnvelopeDto>(path),
  });
  const canEdit = roleAtLeast(org.role, 'STAFF');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['org', org.orgSlug] });
  const remind = useMutation({
    mutationFn: () => api(`${path}/remind`, { method: 'POST' }),
    onSuccess: () => {
      refresh();
      toast.success('Reminder sent.');
    },
    onError: (err) => toast.error(err.message),
  });
  const voidIt = useMutation({
    mutationFn: (reason: string) => api(`${path}/void`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      refresh();
      setVoiding(false);
      toast.success('Signing request cancelled.');
    },
    onError: (err) => toast.error(err.message),
  });
  const env = e.data;
  const open = env && (env.status === 'SENT' || env.status === 'VIEWED');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Signing request</DialogTitle>
          <DialogDescription>
            {env ? `To ${env.signerName} (${env.signerEmail})` : 'Loading…'}
          </DialogDescription>
        </DialogHeader>
        {env && (
          <div className="grid gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant={DOCUMENT_STATUS[env.status].variant}>
                {DOCUMENT_STATUS[env.status].label}
              </Badge>
              <span className="text-muted-foreground">
                {env.documents.map((d) => d.title).join(', ')}
              </span>
            </div>
            <ol className="grid gap-1 border-l pl-3 text-xs text-muted-foreground">
              {env.events.map((ev, i) => (
                <li key={i}>
                  <span className="font-medium text-foreground">
                    {ev.type[0]!.toUpperCase() + ev.type.slice(1)}
                  </span>{' '}
                  {formatDateTime(ev.at)}
                  {ev.detail && ` · ${ev.detail}`}
                </li>
              ))}
            </ol>
            {env.voidReason && <p className="text-muted-foreground">Cancelled: {env.voidReason}</p>}
            {canEdit && open && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => remind.mutate()}
                  disabled={remind.isPending}
                >
                  <Bell /> Send reminder
                </Button>
                {env.signingUrl && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(env.signingUrl!);
                      toast.success('Signing link copied.');
                    }}
                  >
                    <Copy /> Copy signing link
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setVoiding(true)}>
                  <Ban /> Cancel request
                </Button>
              </div>
            )}
          </div>
        )}
        <ReasonDialog
          open={voiding}
          onOpenChange={setVoiding}
          title="Cancel this signing request?"
          description="The link stops working. Documents already signed stay signed."
          action="Cancel request"
          pending={voidIt.isPending}
          onConfirm={(r) => voidIt.mutate(r)}
        />
      </DialogContent>
    </Dialog>
  );
}
