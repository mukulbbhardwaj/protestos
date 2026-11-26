import type { EmailTemplateDto, EmailTemplateKey, RenderedEmail } from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrg } from '@/hooks/useOrg';
import { useOrgQuery } from '@/hooks/useOrgQuery';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Settings → Emails: edit the wording of each email, with a live preview (M5). */
export function EmailTemplatesPage() {
  const list = useOrgQuery<EmailTemplateDto[]>('/email-templates');
  const [key, setKey] = useState<EmailTemplateKey>('INVOICE');
  if (list.error) return <Alert variant="destructive">{list.error.message}</Alert>;
  if (list.isPending) return <Skeleton className="h-96 w-full" />;
  const current = list.data.find((t) => t.key === key)!;
  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <nav aria-label="Emails" className="grid content-start gap-1">
        {list.data.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setKey(t.key)}
            aria-current={t.key === key}
            className={cn(
              'flex items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent',
              t.key === key && 'bg-accent font-medium',
            )}
          >
            {t.name}
            {t.isCustom && <Badge variant="outline">Edited</Badge>}
          </button>
        ))}
      </nav>
      <Editor key={`${current.key}-${current.updatedAt}`} template={current} />
    </div>
  );
}

function Editor({ template }: { template: EmailTemplateDto }) {
  const org = useOrg();
  const qc = useQueryClient();
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [debounced, setDebounced] = useState({ subject, body });
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced({ subject, body }), 300);
    return () => clearTimeout(t);
  }, [subject, body]);
  const base = `/orgs/${org.orgSlug}/email-templates`;
  const preview = useQuery({
    queryKey: ['org', org.orgSlug, 'email-preview', template.key, debounced],
    queryFn: () =>
      api<RenderedEmail>(`${base}/preview`, {
        method: 'POST',
        body: { key: template.key, ...debounced },
      }),
    retry: false,
    enabled: Boolean(debounced.subject.trim() && debounced.body.trim()),
  });
  const done = (message: string) => () => {
    void qc.invalidateQueries({ queryKey: ['org', org.orgSlug, '/email-templates'] });
    toast.success(message);
  };
  const save = useMutation({
    mutationFn: () => api(base, { method: 'PUT', body: { key: template.key, subject, body } }),
    onSuccess: done('Email saved.'),
    onError: (e) => toast.error(e.message),
  });
  const reset = useMutation({
    mutationFn: () => api(`${base}/reset`, { method: 'POST', body: { key: template.key } }),
    onSuccess: done('Back to the built-in wording.'),
    onError: (e) => toast.error(e.message),
  });
  const dirty = subject !== template.subject || body !== template.body;

  function insert(name: string) {
    const el = bodyRef.current;
    const token = `{{${name}}}`;
    if (!el) return setBody(body + token);
    const { selectionStart: a, selectionEnd: b } = el;
    setBody(body.slice(0, a) + token + body.slice(b));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + token.length, a + token.length);
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{template.name}</CardTitle>
          <CardDescription>
            {template.isCustom
              ? `Edited${template.updatedBy ? ` by ${template.updatedBy}` : ''}${template.updatedAt ? ` · ${formatDateTime(template.updatedAt)}` : ''}`
              : 'Built-in wording. Edit it to make it yours.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="Subject" htmlFor="tpl-subject">
            <Input id="tpl-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field
            label="Email"
            htmlFor="tpl-body"
            hint="Plain text. A blank line starts a new paragraph."
          >
            <textarea
              id="tpl-body"
              ref={bodyRef}
              className="min-h-72 rounded-md border bg-transparent px-3 py-2 font-mono text-sm"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Insert</p>
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
          </div>
          <div className="flex justify-end gap-2">
            {template.isCustom && (
              <Button variant="ghost" onClick={() => reset.mutate()} disabled={reset.isPending}>
                <RotateCcw /> Use built-in
              </Button>
            )}
            <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />} Save
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>With sample values.</CardDescription>
        </CardHeader>
        {preview.error ? (
          <Alert variant="destructive" className="m-4">
            {preview.error.message}
          </Alert>
        ) : preview.data ? (
          <div className="border-t">
            <p className="border-b px-5 py-3 text-sm font-medium">{preview.data.subject}</p>
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={preview.data.html}
              className="h-[28rem] w-full bg-white"
            />
          </div>
        ) : (
          <Skeleton className="m-4 h-64" />
        )}
      </Card>
    </div>
  );
}
