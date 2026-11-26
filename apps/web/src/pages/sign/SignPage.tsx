import type { SigningSession } from '@app/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, FileText, Loader2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Logo } from '@/components/layout/Logo';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * The page a client signs on (mock e-signature provider, M6). No login: the link's token is
 * the credential. A real provider (DocuSign) would host this step instead.
 */
export function SignPage() {
  const { token = '' } = useParams();
  const base = `/sign/${token}`;
  const session = useQuery({
    queryKey: ['sign', token],
    queryFn: () => api<SigningSession>(base),
    retry: false,
  });
  const [index, setIndex] = useState(0);
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [declining, setDeclining] = useState(false);
  const sign = useMutation({
    mutationFn: () => api(base, { method: 'POST', body: { signerName: name, agree } }),
    onSuccess: () => void session.refetch(),
  });
  const decline = useMutation({
    mutationFn: (reason: string) => api(`${base}/decline`, { method: 'POST', body: { reason } }),
    onSuccess: () => void session.refetch(),
  });
  const s = session.data;

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="flex items-center gap-3 border-b bg-background px-4 py-3">
        <Logo />
        {s && <span className="text-sm text-muted-foreground">Documents from {s.firm}</span>}
      </header>
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        {session.error && <Alert variant="destructive">{session.error.message}</Alert>}
        {session.isPending && <Skeleton className="h-96" />}
        {s && s.status === 'SIGNED' && (
          <Done icon={<CheckCircle2 className="size-10 text-success" />} title="Signed. Thank you!">
            {s.firm} has your signed documents. You can download a copy below.
            <DocList s={s} base={base} />
          </Done>
        )}
        {s && s.status === 'DECLINED' && (
          <Done
            icon={<XCircle className="size-10 text-muted-foreground" />}
            title="You declined to sign"
          >
            We let {s.firm} know. Contact them if this was a mistake.
          </Done>
        )}
        {s && s.status === 'VOIDED' && (
          <Done
            icon={<XCircle className="size-10 text-muted-foreground" />}
            title="This request was cancelled"
          >
            {s.firm} cancelled these documents. They may send you new ones.
          </Done>
        )}
        {s && (s.status === 'SENT' || s.status === 'VIEWED') && (
          <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
            <Card className="overflow-hidden">
              <div className="flex gap-1 overflow-x-auto border-b p-2">
                {s.documents.map((d) => (
                  <button
                    key={d.index}
                    type="button"
                    onClick={() => setIndex(d.index)}
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm hover:bg-accent',
                      d.index === index && 'bg-accent font-medium',
                    )}
                  >
                    <FileText className="size-4" /> {d.title}
                  </button>
                ))}
              </div>
              <iframe
                key={index}
                title={s.documents[index]?.title}
                // Hide the viewer's thumbnail pane and fit the page to the width.
                src={`/api${base}/documents/${index}#navpanes=0&view=FitH`}
                className="h-[70vh] w-full bg-white"
              />
            </Card>
            <Card className="grid content-start gap-4 p-5">
              <div>
                <h1 className="text-lg font-semibold">
                  Sign{' '}
                  {s.documents.length === 1
                    ? 'this document'
                    : `these ${s.documents.length} documents`}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Hi {s.signerName}. Read each document, then type your full name to sign them all.
                </p>
              </div>
              <form
                className="grid gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  sign.mutate();
                }}
              >
                <Field label="Your full name" htmlFor="sign-name">
                  <Input
                    id="sign-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                  />
                </Field>
                {name.trim().length > 1 && (
                  <p className="rounded-md border bg-background px-3 py-2 font-serif text-2xl italic">
                    {name}
                  </p>
                )}
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={agree}
                    onChange={(e) => setAgree(e.target.checked)}
                  />
                  I have read these documents and agree to sign them electronically.
                </label>
                {sign.error && <Alert variant="destructive">{sign.error.message}</Alert>}
                <Button type="submit" disabled={!agree || name.trim().length < 2 || sign.isPending}>
                  {sign.isPending && <Loader2 className="animate-spin" />} Sign
                </Button>
              </form>
              {declining ? (
                <DeclineForm
                  pending={decline.isPending}
                  onDecline={(r) => decline.mutate(r)}
                  onCancel={() => setDeclining(false)}
                />
              ) : (
                <Button
                  variant="link"
                  size="sm"
                  className="justify-self-start px-0"
                  onClick={() => setDeclining(true)}
                >
                  I don&apos;t want to sign
                </Button>
              )}
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}

function Done({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="mx-auto grid max-w-lg justify-items-center gap-3 p-8 text-center">
      {icon}
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="text-sm text-muted-foreground">{children}</div>
    </Card>
  );
}

function DocList({ s, base }: { s: SigningSession; base: string }) {
  return (
    <ul className="mt-4 grid gap-1 text-left">
      {s.documents.map((d) => (
        <li key={d.index}>
          <a
            href={`/api${base}/documents/${d.index}`}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            {d.title}
          </a>
        </li>
      ))}
    </ul>
  );
}

function DeclineForm({
  pending,
  onDecline,
  onCancel,
}: {
  pending: boolean;
  onDecline: (r: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="grid gap-2 border-t pt-3">
      <Field label="Tell the firm why (optional)" htmlFor="decline-reason">
        <Input id="decline-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={() => onDecline(reason)}
        >
          Decline
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
