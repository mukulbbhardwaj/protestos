import type { ImportJobDto, ImportKind, ImportListItem } from '@app/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrg } from '@/hooks/useOrg';
import { useOrgQuery } from '@/hooks/useOrgQuery';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export const KIND_INFO: Record<ImportKind, { title: string; body: string }> = {
  CONTACTS_PROPERTIES: {
    title: 'Clients & properties',
    body: 'One row per property, with its owner. Clients match on client number, then email; properties on county and account number.',
  },
  TAX_YEAR_VALUES: {
    title: 'Tax-year values',
    body: 'Notice and final values, tax rate, dates and stage for properties you already have. Matches on county, account number and tax year.',
  },
  HISTORICAL_INVOICES: {
    title: 'Past invoices',
    body: 'Invoices and payments from your previous system, so balances carry over. Matches on invoice number; clients on client number, email or name.',
  },
};

export const STATUS_BADGE: Record<
  ImportListItem['status'],
  { label: string; variant: 'secondary' | 'warning' | 'success' | 'destructive' | 'outline' }
> = {
  UPLOADED: { label: 'Needs mapping', variant: 'outline' },
  PREVIEWED: { label: 'Dry run ready', variant: 'secondary' },
  RUNNING: { label: 'Importing…', variant: 'warning' },
  DONE: { label: 'Imported', variant: 'success' },
  FAILED: { label: 'Failed', variant: 'destructive' },
};

export function ImportsPage() {
  const org = useOrg();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<ImportKind>('CONTACTS_PROPERTIES');
  const list = useOrgQuery<ImportListItem[]>('/imports');

  const upload = useMutation({
    mutationFn: async (file: File) =>
      api<ImportJobDto>(
        `/orgs/${org.orgSlug}/imports?kind=${kind}&fileName=${encodeURIComponent(file.name)}`,
        { method: 'POST', csv: await file.text() },
      ),
    onSuccess: (job) => {
      void qc.invalidateQueries({ queryKey: ['org', org.orgSlug, '/imports'] });
      navigate(`/${org.orgSlug}/imports/${job.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="Imports"
        description="Bring in clients, properties and tax-year values from your spreadsheets. Every import starts with a dry run, and re-importing a file never creates duplicates."
      />
      <Card className="mb-6 p-5">
        <div className="grid gap-3 md:grid-cols-3">
          {(Object.keys(KIND_INFO) as ImportKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={cn(
                'rounded-lg border p-4 text-left transition-colors hover:bg-muted/40',
                kind === k && 'border-primary bg-primary/5 ring-1 ring-primary',
              )}
            >
              <div className="font-medium">{KIND_INFO[k].title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{KIND_INFO[k].body}</p>
              <a
                href={`/api/orgs/${org.orgSlug}/imports/template?kind=${k}`}
                onClick={(e) => e.stopPropagation()}
                className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Download className="size-3" /> Sample file
              </a>
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            aria-label="CSV file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
              e.target.value = '';
            }}
          />
          <Button onClick={() => input.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Upload CSV for{' '}
            {KIND_INFO[kind].title.toLowerCase()}
          </Button>
          <p className="text-xs text-muted-foreground">
            CSV files up to 20 MB and 50,000 rows. Save Excel sheets as CSV first.
          </p>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Recent imports</CardTitle>
          <CardDescription>The last 100 uploads for your firm.</CardDescription>
        </CardHeader>
        {list.error ? (
          <Alert variant="destructive" className="m-4">
            {list.error.message}
          </Alert>
        ) : list.isPending ? (
          <Skeleton className="m-4 h-32" />
        ) : list.data.length === 0 ? (
          <p className="px-5 pb-6 text-sm text-muted-foreground">No imports yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-2.5 text-left font-medium">File</th>
                <th className="px-5 py-2.5 text-left font-medium">Type</th>
                <th className="px-5 py-2.5 text-right font-medium">Rows</th>
                <th className="px-5 py-2.5 text-left font-medium">Status</th>
                <th className="px-5 py-2.5 text-left font-medium">Result</th>
                <th className="px-5 py-2.5 text-left font-medium">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((j) => (
                <tr key={j.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-5 py-2.5">
                    <Link
                      to={`/${org.orgSlug}/imports/${j.id}`}
                      className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                    >
                      <FileSpreadsheet className="size-4" /> {j.fileName}
                    </Link>
                  </td>
                  <td className="px-5 py-2.5">{KIND_INFO[j.kind].title}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">
                    {j.rowCount.toLocaleString()}
                  </td>
                  <td className="px-5 py-2.5">
                    <Badge variant={STATUS_BADGE[j.status].variant}>
                      {STATUS_BADGE[j.status].label}
                    </Badge>
                  </td>
                  <td className="px-5 py-2.5 text-xs text-muted-foreground">
                    {j.summary
                      ? `${j.summary.CREATE} new · ${j.summary.UPDATE} updated · ${j.summary.UNCHANGED} unchanged · ${j.summary.ERROR} errors`
                      : '—'}
                  </td>
                  <td className="px-5 py-2.5 text-xs text-muted-foreground">
                    {formatDateTime(j.createdAt)}
                    {j.createdBy && <> · {j.createdBy}</>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
