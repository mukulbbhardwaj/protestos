import type { DocumentTemplateDto, OrgSettings } from '@app/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, Loader2, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrg } from '@/hooks/useOrg';
import { useOrgQuery } from '@/hooks/useOrgQuery';
import { api, apiBlob } from '@/lib/api';

/** Settings → Documents: the engagement agreement's wording and the agent on Form 50-162. */
export function DocumentSettingsPage() {
  const template = useOrgQuery<DocumentTemplateDto>('/document-template');
  const settings = useOrgQuery<OrgSettings>('/settings');
  if (template.error) return <Alert variant="destructive">{template.error.message}</Alert>;
  if (template.isPending || settings.isPending) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="grid gap-6">
      {settings.data && <AgentCard settings={settings.data} />}
      <AgreementEditor key={template.data.version} template={template.data} />
    </div>
  );
}

function AgentCard({ settings }: { settings: OrgSettings }) {
  const org = useOrg();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    agentName: settings.agentName ?? '',
    agentTitle: settings.agentTitle ?? '',
    agentLicense: settings.agentLicense ?? '',
    allowResendSigned: settings.allowResendSigned,
  });
  const save = useMutation({
    mutationFn: () => api(`/orgs/${org.orgSlug}/settings`, { method: 'PATCH', body: form }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['org', org.orgSlug, '/settings'] });
      toast.success('Saved.');
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent on Form 50-162</CardTitle>
        <CardDescription>
          Who clients appoint as their agent. The address and phone come from your firm profile.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Agent name" htmlFor="agent-name" hint={`Blank: ${org.orgName}`}>
            <Input
              id="agent-name"
              value={form.agentName}
              onChange={(e) => setForm({ ...form, agentName: e.target.value })}
            />
          </Field>
          <Field label="Title" htmlFor="agent-title">
            <Input
              id="agent-title"
              value={form.agentTitle}
              onChange={(e) => setForm({ ...form, agentTitle: e.target.value })}
            />
          </Field>
          <Field label="TDLR registration #" htmlFor="agent-license">
            <Input
              id="agent-license"
              value={form.agentLicense}
              onChange={(e) => setForm({ ...form, agentLicense: e.target.value })}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.allowResendSigned}
            onChange={(e) => setForm({ ...form, allowResendSigned: e.target.checked })}
          />
          Allow sending signed documents again for the same tax year
        </label>
        <Button
          className="justify-self-end"
          onClick={() => save.mutate()}
          disabled={save.isPending}
        >
          {save.isPending && <Loader2 className="animate-spin" />} Save
        </Button>
      </CardContent>
    </Card>
  );
}

function AgreementEditor({ template }: { template: DocumentTemplateDto }) {
  const org = useOrg();
  const qc = useQueryClient();
  const [body, setBody] = useState(template.body);
  const [preview, setPreview] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const base = `/orgs/${org.orgSlug}/document-template`;
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const done = (message: string) => () => {
    void qc.invalidateQueries({ queryKey: ['org', org.orgSlug, '/document-template'] });
    toast.success(message);
  };
  const save = useMutation({
    mutationFn: () => api(base, { method: 'PUT', body: { body } }),
    onSuccess: done('Agreement saved. New documents use this version.'),
    onError: (e) => toast.error(e.message),
  });
  const reset = useMutation({
    mutationFn: () => api(`${base}/reset`, { method: 'POST' }),
    onSuccess: done('Back to the built-in agreement.'),
    onError: (e) => toast.error(e.message),
  });
  const show = useMutation({
    mutationFn: () => apiBlob(`${base}/preview`, { method: 'POST', body: { body } }),
    onSuccess: (blob) => setPreview(URL.createObjectURL(blob)),
    onError: (e) => toast.error(e.message),
  });
  function insert(name: string) {
    const el = ref.current;
    const token = `{{${name}}}`;
    if (!el) return setBody(body + token);
    const { selectionStart: a, selectionEnd: b } = el;
    setBody(body.slice(0, a) + token + body.slice(b));
  }
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Engagement agreement</CardTitle>
          <CardDescription>
            {template.isCustom
              ? `Your wording, version ${template.version}.`
              : 'Built-in starting point.'}{' '}
            Have your attorney review it. Put {'{{properties.table}}'} on its own paragraph for the
            list of properties.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <textarea
            ref={ref}
            aria-label="Agreement text"
            className="min-h-96 rounded-md border bg-transparent px-3 py-2 font-mono text-sm"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex flex-wrap gap-1.5">
            {template.placeholders.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => insert(p)}
                className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-xs hover:bg-accent"
              >
                {p}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {template.isCustom && (
              <Button variant="ghost" onClick={() => reset.mutate()} disabled={reset.isPending}>
                <RotateCcw /> Use built-in
              </Button>
            )}
            <Button variant="outline" onClick={() => show.mutate()} disabled={show.isPending}>
              {show.isPending ? <Loader2 className="animate-spin" /> : <Eye />} Preview PDF
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={body === template.body || save.isPending}
            >
              {save.isPending && <Loader2 className="animate-spin" />} Save
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>With sample client and properties.</CardDescription>
        </CardHeader>
        {preview ? (
          <iframe
            title="Agreement preview"
            src={preview}
            className="h-[36rem] w-full border-t bg-white"
          />
        ) : (
          <p className="px-5 pb-6 text-sm text-muted-foreground">
            Click “Preview PDF” to see it as clients will.
          </p>
        )}
      </Card>
    </div>
  );
}
