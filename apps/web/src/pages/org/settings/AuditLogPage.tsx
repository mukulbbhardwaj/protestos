import type { AuditEntry } from '@app/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useOrg } from '@/hooks/useOrg';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface Page {
  entries: AuditEntry[];
  nextBefore: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  'org.created': 'Created the firm',
  'membership.created': 'Added a member',
  'membership.updated': 'Changed a member',
  'membership.disabled': 'Removed access',
  'invitation.created': 'Sent an invitation',
  'invitation.resent': 'Resent an invitation',
  'invitation.revoked': 'Revoked an invitation',
  'invitation.accepted': 'Accepted an invitation',
  'settings.updated': 'Updated settings',
};

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.join(', ') || '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function Changes({ before, after }: { before: unknown; after: unknown }) {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  if (keys.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="space-y-0.5 text-xs">
      {keys.map((k) => (
        <li key={k}>
          <span className="font-medium">{k}</span>:{' '}
          {k in b && <span className="text-muted-foreground line-through">{show(b[k])}</span>}
          {k in b && k in a && ' → '}
          {k in a && <span>{show(a[k])}</span>}
        </li>
      ))}
    </ul>
  );
}

export function AuditLogPage() {
  const org = useOrg();
  const query = useInfiniteQuery({
    queryKey: ['org', org.orgSlug, '/audit-log'],
    queryFn: ({ pageParam }) =>
      api<Page>(`/orgs/${org.orgSlug}/audit-log${pageParam ? `?before=${pageParam}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
  const entries = query.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <CardDescription>
          Every change to your firm’s data, who made it and when. Entries can’t be edited or
          deleted.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {query.error && (
          <Alert variant="destructive" className="mx-5">
            {query.error.message}
          </Alert>
        )}
        {query.isPending ? (
          <div className="space-y-2 px-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-sm text-muted-foreground">
            <History className="mb-2 size-5" /> Nothing recorded yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Changes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(e.createdAt)}
                  </TableCell>
                  <TableCell>{e.actor ?? 'System'}</TableCell>
                  <TableCell>
                    {ACTION_LABELS[e.action] ?? e.action}
                    <span className="block text-xs text-muted-foreground">
                      {e.entityType} #{e.entityId}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-md">
                    <Changes before={e.before} after={e.after} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {query.hasNextPage && (
          <div className="px-5 pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              Load older entries
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
