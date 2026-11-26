import {
  importFields,
  type ImportJobDto,
  type ImportRowDto,
  type ImportSummary,
} from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, Loader2, Play, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Pagination } from '@/components/data/Pagination';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrg } from '@/hooks/useOrg';
import { qs } from '@/hooks/useUrlState';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { KIND_INFO, STATUS_BADGE } from './ImportsPage';

/** What one row did, for the rows table (the tiles above count them). */
const ROW_RESULT: Record<keyof ImportSummary, string> = {
  CREATE: 'New',
  UPDATE: 'Updated',
  UNCHANGED: 'Unchanged',
  ERROR: 'Error',
};

const ACTIONS: { key: keyof ImportSummary; label: string; tone: string }[] = [
  { key: 'CREATE', label: 'New', tone: 'text-success' },
  { key: 'UPDATE', label: 'Updated', tone: 'text-primary' },
  { key: 'UNCHANGED', label: 'Unchanged', tone: 'text-muted-foreground' },
  { key: 'ERROR', label: 'Errors', tone: 'text-destructive' },
];

export function ImportDetailPage() {
  const { importId = '' } = useParams();
  const org = useOrg();
  const qc = useQueryClient();
  const base = `/orgs/${org.orgSlug}/imports/${importId}`;
  const job = useQuery({
    queryKey: ['org', org.orgSlug, 'import', importId],
    queryFn: () => api<ImportJobDto>(base),
    // While the worker runs it, check every 2 seconds.
    refetchInterval: (q) => (q.state.data?.status === 'RUNNING' ? 2000 : false),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['org', org.orgSlug, 'import', importId] });
    void qc.invalidateQueries({ queryKey: ['org', org.orgSlug, '/imports'] });
  };

  if (job.error) return <Alert variant="destructive">{job.error.message}</Alert>;
  if (job.isPending) return <Skeleton className="h-96 w-full" />;
  const j = job.data;
  const kindTitle = KIND_INFO[j.kind].title;

  return (
    <>
      <Link
        to={`/${org.orgSlug}/imports`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Imports
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{j.fileName}</h1>
        <Badge variant={STATUS_BADGE[j.status].variant}>{STATUS_BADGE[j.status].label}</Badge>
        <span className="text-sm text-muted-foreground">
          {kindTitle} · {j.rowCount.toLocaleString()} rows
        </span>
      </div>
      <Steps status={j.status} />
      {j.status === 'FAILED' && j.error && (
        <Alert variant="destructive" className="mb-6">
          {j.error}
        </Alert>
      )}
      {j.status === 'UPLOADED' || j.status === 'PREVIEWED' || j.status === 'FAILED' ? (
        <Mapping job={j} base={base} onSaved={refresh} />
      ) : null}
      {j.summary && <Results job={j} base={base} onRun={refresh} />}
    </>
  );
}

function Steps({ status }: { status: ImportJobDto['status'] }) {
  const step = status === 'UPLOADED' ? 1 : status === 'PREVIEWED' ? 2 : 3;
  return (
    <ol className="mb-6 flex flex-wrap gap-2 text-sm">
      {['Map columns', 'Check the dry run', 'Import'].map((label, i) => (
        <li
          key={label}
          className={cn(
            'rounded-full border px-3 py-1',
            i + 1 === step
              ? 'border-primary bg-primary/10 font-medium text-primary'
              : 'text-muted-foreground',
            i + 1 < step && 'border-success/40 text-success',
          )}
        >
          {i + 1}. {label}
        </li>
      ))}
    </ol>
  );
}

function Mapping({ job, base, onSaved }: { job: ImportJobDto; base: string; onSaved: () => void }) {
  const fields = importFields(job.kind);
  const [mapping, setMapping] = useState(job.columnMapping);
  const used = new Set(Object.values(mapping).filter(Boolean));
  const required = fields.filter((f) => f.required && !used.has(f.key));
  const groups = [...new Set(fields.map((f) => f.group))];
  const save = useMutation({
    mutationFn: async () => {
      await api(`${base}/mapping`, {
        method: 'PATCH',
        body: { columnMapping: mapping, remember: true },
      });
      return api<ImportJobDto>(`${base}/preview`, { method: 'POST' });
    },
    onSuccess: (j) => {
      onSaved();
      const errors = j.summary?.ERROR ?? 0;
      toast.success(
        errors === 0
          ? 'Dry run ready: no errors.'
          : `Dry run ready: ${errors.toLocaleString()} ${errors === 1 ? 'row has' : 'rows have'} errors.`,
      );
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Map columns</CardTitle>
          <CardDescription>
            Each column in your file feeds one field, or is ignored. Matched automatically from the
            column names; your choices are remembered for the next file.
          </CardDescription>
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending || required.length > 0}>
          {save.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {job.status === 'UPLOADED' ? 'Run dry run' : 'Re-run dry run'}
        </Button>
      </CardHeader>
      {required.length > 0 && (
        <p className="px-5 pb-3 text-sm text-destructive">
          Map a column to: {required.map((f) => f.label).join(', ')}.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-5 py-2.5 text-left font-medium">Column in your file</th>
              <th className="px-5 py-2.5 text-left font-medium">Sample values</th>
              <th className="px-5 py-2.5 text-left font-medium">Goes into</th>
            </tr>
          </thead>
          <tbody>
            {job.headers.map((header, col) => (
              <tr key={header} className="border-b last:border-0">
                <td className="px-5 py-2 font-medium">{header}</td>
                <td className="max-w-xs truncate px-5 py-2 text-xs text-muted-foreground">
                  {job.sample
                    .map((r) => r[col])
                    .filter(Boolean)
                    .slice(0, 3)
                    .join(' · ') || '—'}
                </td>
                <td className="px-5 py-2">
                  <NativeSelect
                    aria-label={`Field for ${header}`}
                    className="h-8 w-72"
                    value={mapping[header] ?? ''}
                    onChange={(e) => setMapping({ ...mapping, [header]: e.target.value || null })}
                  >
                    <option value="">Ignore this column</option>
                    {groups.map((g) => (
                      <optgroup key={g} label={g}>
                        {fields
                          .filter((f) => f.group === g)
                          .map((f) => (
                            <option
                              key={f.key}
                              value={f.key}
                              disabled={used.has(f.key) && mapping[header] !== f.key}
                            >
                              {f.label}
                              {f.required ? ' (required)' : ''}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </NativeSelect>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Results({ job, base, onRun }: { job: ImportJobDto; base: string; onRun: () => void }) {
  const org = useOrg();
  const [action, setAction] = useState<keyof ImportSummary | ''>('');
  const [page, setPage] = useState(1);
  const rows = useQuery({
    queryKey: [
      'org',
      org.orgSlug,
      'import-rows',
      job.id,
      job.status,
      job.previewedAt,
      job.finishedAt,
      action,
      page,
    ],
    queryFn: () =>
      api<{ items: ImportRowDto[]; total: number; page: number; pageSize: number }>(
        `${base}/rows${qs({ action, page })}`,
      ),
  });
  const run = useMutation({
    mutationFn: () => api<ImportJobDto>(`${base}/run`, { method: 'POST' }),
    onSuccess: () => {
      onRun();
      toast.success('Import started. It runs in the background; you can leave this page.');
    },
    onError: (e) => toast.error(e.message),
  });
  const s = job.summary!;
  const isApply = job.phase === 'APPLY';
  const changes = s.CREATE + s.UPDATE;
  const running = job.status === 'RUNNING';
  const title = useMemo(
    () => (running ? 'Importing…' : isApply ? 'Import finished' : 'Dry run'),
    [running, isApply],
  );

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            {running && <Loader2 className="size-4 animate-spin" />} {title}
          </CardTitle>
          <CardDescription>
            {running
              ? 'Saving rows in the background. This page updates by itself.'
              : isApply
                ? 'What each row did. Rows with errors were skipped; fix them in the error file and upload it.'
                : 'What each row would do. Nothing has been saved yet.'}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {s.ERROR > 0 && (
            <Button asChild variant="outline">
              <a href={`/api${base}/errors.csv`}>
                <Download /> Error rows ({s.ERROR})
              </a>
            </Button>
          )}
          {job.status === 'PREVIEWED' && (
            <Button onClick={() => run.mutate()} disabled={run.isPending || changes === 0}>
              {run.isPending ? <Loader2 className="animate-spin" /> : <Play />}
              {changes === 0 ? 'Nothing to import' : `Import ${changes.toLocaleString()} rows`}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {ACTIONS.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => {
                setAction(action === a.key ? '' : a.key);
                setPage(1);
              }}
              aria-pressed={action === a.key}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors hover:bg-muted/40',
                action === a.key && 'ring-1 ring-primary',
              )}
            >
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{a.label}</div>
              <div className={cn('text-2xl font-semibold tabular-nums', a.tone)}>
                {s[a.key].toLocaleString()}
              </div>
            </button>
          ))}
        </div>
      </CardContent>
      {rows.data && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5 text-right font-medium">Row</th>
                  <th className="px-5 py-2.5 text-left font-medium">Result</th>
                  <th className="px-5 py-2.5 text-left font-medium">Record</th>
                  <th className="px-5 py-2.5 text-left font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.data.items.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                      No rows here.
                    </td>
                  </tr>
                )}
                {rows.data.items.map((r) => (
                  <tr key={r.rowNumber} className="border-b align-top last:border-0">
                    <td className="px-5 py-2 text-right tabular-nums text-muted-foreground">
                      {r.rowNumber + 1}
                    </td>
                    <td className="px-5 py-2">
                      <span
                        className={cn('font-medium', ACTIONS.find((a) => a.key === r.action)?.tone)}
                      >
                        {ROW_RESULT[r.action]}
                      </span>
                    </td>
                    <td className="px-5 py-2">{r.label ?? '—'}</td>
                    <td className="px-5 py-2 text-xs">
                      {r.changes.length > 0 && <div>Changed: {r.changes.join(', ')}</div>}
                      {r.messages.map((m) => (
                        <div
                          key={m}
                          className={
                            r.action === 'ERROR' ? 'text-destructive' : 'text-muted-foreground'
                          }
                        >
                          {m}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={rows.data.page}
            pageSize={rows.data.pageSize}
            total={rows.data.total}
            onPage={setPage}
          />
        </>
      )}
    </Card>
  );
}
