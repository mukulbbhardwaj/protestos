import { HEARING_STATUSES, HEARING_TYPE_LABELS, roleAtLeast, type HearingDto } from '@app/shared';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { CalendarPlus, ChevronLeft, ChevronRight, Copy, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { useOrg } from '@/hooks/useOrg';
import { useConsultants, useCounties } from '@/hooks/useReference';
import { qs, useUrlState } from '@/hooks/useUrlState';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { HEARING_STATUS_LABELS, HearingDialog } from './HearingDialog';

const KEYS = ['view', 'date', 'status', 'countyId', 'consultantId'] as const;
const TZ = 'America/Chicago';
const DAY = 86_400_000;

/** Midnight (local) of a YYYY-MM-DD, as a Date in the browser. */
const local = (day: string) => new Date(`${day}T00:00:00`);
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

/** The days shown: a list (next 60 days), a week (Mon–Sun) or a month grid (Mon-first weeks). */
function visibleRange(view: string, anchor: Date) {
  if (view === 'list')
    return { from: anchor, to: new Date(anchor.getTime() + 60 * DAY), days: [] as Date[] };
  const start = view === 'week' ? anchor : new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const monday = new Date(start);
  monday.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const count = view === 'week' ? 7 : 42;
  const days = Array.from(
    { length: count },
    (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i),
  );
  return { from: days[0]!, to: new Date(days.at(-1)!.getTime() + DAY), days };
}

export function HearingsPage() {
  const org = useOrg();
  const counties = useCounties();
  const consultants = useConsultants();
  const { values, set } = useUrlState(KEYS);
  const view = values.view || 'week';
  const anchor = values.date ? local(values.date) : local(ymd(new Date()));
  const w = visibleRange(view, anchor);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<HearingDto | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const canEdit = roleAtLeast(org.role, 'STAFF');
  const q = useQuery({
    queryKey: ['org', org.orgSlug, 'hearings', values, w.from.toISOString()],
    queryFn: () =>
      api<{ items: HearingDto[]; total: number }>(
        `/orgs/${org.orgSlug}/hearings${qs({
          from: w.from.toISOString(),
          to: w.to.toISOString(),
          status: values.status,
          countyId: values.countyId,
          consultantId: values.consultantId,
          pageSize: 500,
        })}`,
      ),
    placeholderData: keepPreviousData,
  });
  const hearings = q.data?.items ?? [];
  const byDay = new Map<string, HearingDto[]>();
  for (const h of hearings) {
    const k = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(h.scheduledAt));
    byDay.set(k, [...(byDay.get(k) ?? []), h]);
  }
  const move = (dir: number) => {
    const d = new Date(anchor);
    if (view === 'month') d.setMonth(d.getMonth() + dir, 1);
    else d.setDate(d.getDate() + dir * (view === 'week' ? 7 : 60));
    set({ date: ymd(d) });
  };
  const title =
    view === 'month'
      ? anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : view === 'week'
        ? `Week of ${w.days[0]!.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
        : `From ${anchor.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  return (
    <>
      <PageHeader
        title="Hearings"
        description="Informal meetings, ARB hearings and arbitration across your firm. Times are Central."
        actions={
          <>
            <Button variant="outline" onClick={() => setSubscribing(true)}>
              <CalendarPlus /> Subscribe
            </Button>
            {canEdit && (
              <Button onClick={() => setAdding(true)}>
                <Plus /> Schedule hearing
              </Button>
            )}
          </>
        }
      />
      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="flex rounded-md border p-0.5" role="tablist" aria-label="View">
          {(['week', 'month', 'list'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => set({ view: v === 'week' ? '' : v })}
              className={cn(
                'rounded px-3 py-1 text-sm capitalize',
                view === v && 'bg-accent font-medium',
              )}
            >
              {v}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="icon" aria-label="Previous" onClick={() => move(-1)}>
          <ChevronLeft />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => set({ date: '' })}>
          Today
        </Button>
        <Button variant="ghost" size="icon" aria-label="Next" onClick={() => move(1)}>
          <ChevronRight />
        </Button>
        <span className="font-medium">{title}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <NativeSelect
            aria-label="Status"
            className="w-auto"
            value={values.status}
            onChange={(e) => set({ status: e.target.value })}
          >
            <option value="">All statuses</option>
            {HEARING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {HEARING_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="County"
            className="w-auto"
            value={values.countyId}
            onChange={(e) => set({ countyId: e.target.value })}
          >
            <option value="">All counties</option>
            {counties.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Consultant"
            className="w-auto"
            value={values.consultantId}
            onChange={(e) => set({ consultantId: e.target.value })}
          >
            <option value="">All consultants</option>
            {consultants.data?.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </Card>
      {q.error && (
        <Alert variant="destructive" className="mb-4">
          {q.error.message}
        </Alert>
      )}

      {view === 'list' ? (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-2.5 text-left font-medium">When</th>
                <th className="px-5 py-2.5 text-left font-medium">Property</th>
                <th className="px-5 py-2.5 text-left font-medium">Type</th>
                <th className="px-5 py-2.5 text-left font-medium">Location</th>
                <th className="px-5 py-2.5 text-left font-medium">Consultant</th>
                <th className="px-5 py-2.5 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {hearings.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                    No hearings in the next 60 days.
                  </td>
                </tr>
              )}
              {hearings.map((h) => (
                <tr
                  key={h.id}
                  className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                  onClick={() => setEditing(h)}
                >
                  <td className="px-5 py-2.5 whitespace-nowrap">
                    {new Date(h.scheduledAt).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      timeZone: TZ,
                    })}{' '}
                    {time(h.scheduledAt)}
                  </td>
                  <td className="px-5 py-2.5">
                    <Link
                      to={`/${org.orgSlug}/properties/${h.property.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium hover:underline"
                    >
                      {h.property.county} {h.property.accountNumber}
                    </Link>
                    <div className="text-xs text-muted-foreground">{h.contact.displayName}</div>
                  </td>
                  <td className="px-5 py-2.5">{HEARING_TYPE_LABELS[h.type]}</td>
                  <td className="px-5 py-2.5 text-muted-foreground">
                    {[h.location, h.panel && `Panel ${h.panel}`].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-5 py-2.5">
                    {h.assignedTo?.name ?? (
                      <span className="text-muted-foreground">Unassigned</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5">
                    <StatusBadge status={h.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="px-2 py-2 text-center font-medium">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {w.days.map((d) => {
              const k = ymd(d);
              const items = byDay.get(k) ?? [];
              const outside = view === 'month' && d.getMonth() !== anchor.getMonth();
              const isToday = k === ymd(new Date());
              return (
                <div
                  key={k}
                  className={cn(
                    'border-b border-r p-1.5 [&:nth-child(7n)]:border-r-0',
                    view === 'week' ? 'min-h-72' : 'min-h-28',
                    outside && 'bg-muted/30 text-muted-foreground',
                  )}
                >
                  <div
                    className={cn(
                      'mb-1 text-xs',
                      isToday &&
                        'inline-flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground',
                    )}
                  >
                    {d.getDate()}
                  </div>
                  <div className="grid gap-1">
                    {items.slice(0, view === 'week' ? 20 : 3).map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => setEditing(h)}
                        className={cn(
                          'truncate rounded border-l-2 border-primary bg-primary/10 px-1.5 py-0.5 text-left text-xs hover:bg-primary/15',
                          h.status === 'CANCELLED' &&
                            'border-muted-foreground bg-muted line-through',
                        )}
                        title={`${time(h.scheduledAt)} ${HEARING_TYPE_LABELS[h.type]}: ${h.contact.displayName} (${h.property.county} ${h.property.accountNumber})`}
                      >
                        <span className="tabular-nums">{time(h.scheduledAt)}</span>{' '}
                        {h.contact.displayName}
                      </button>
                    ))}
                    {items.length > (view === 'week' ? 20 : 3) && (
                      <button
                        type="button"
                        className="text-left text-xs text-primary"
                        onClick={() => set({ view: 'list', date: k })}
                      >
                        +{items.length - (view === 'week' ? 20 : 3)} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {adding && <HearingDialog open onOpenChange={setAdding} />}
      {editing && (
        <HearingDialog open hearing={editing} onOpenChange={(o) => !o && setEditing(null)} />
      )}
      {subscribing && <SubscribeDialog onClose={() => setSubscribing(false)} />}
    </>
  );
}

function StatusBadge({ status }: { status: HearingDto['status'] }) {
  const variant =
    status === 'ATTENDED'
      ? 'success'
      : status === 'CANCELLED' || status === 'NO_SHOW'
        ? 'secondary'
        : 'default';
  return <Badge variant={variant}>{HEARING_STATUS_LABELS[status]}</Badge>;
}

function SubscribeDialog({ onClose }: { onClose: () => void }) {
  const org = useOrg();
  const feed = useQuery({
    queryKey: ['org', org.orgSlug, 'calendar-feed'],
    queryFn: () => api<{ url: string }>(`/orgs/${org.orgSlug}/calendar-feed`),
  });
  const rotate = useMutation({
    mutationFn: () =>
      api<{ url: string }>(`/orgs/${org.orgSlug}/calendar-feed/rotate`, { method: 'POST' }),
    onSuccess: () => {
      void feed.refetch();
      toast.success('New link made. The old one stopped working.');
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your hearings calendar</DialogTitle>
          <DialogDescription>
            Hearings assigned to you, in Google Calendar or Outlook. Add it there with “Subscribe
            from URL” (Google: Other calendars → From URL). Keep the link private.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            readOnly
            value={feed.data?.url ?? 'Loading…'}
            aria-label="Calendar link"
            onFocus={(e) => e.target.select()}
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="Copy link"
            disabled={!feed.data}
            onClick={() => {
              void navigator.clipboard.writeText(feed.data!.url);
              toast.success('Link copied.');
            }}
          >
            <Copy />
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="justify-self-start"
          onClick={() => rotate.mutate()}
          disabled={rotate.isPending}
        >
          <RefreshCw /> Make a new link
        </Button>
      </DialogContent>
    </Dialog>
  );
}
