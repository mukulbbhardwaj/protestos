import {
  HEARING_STATUSES,
  HEARING_TYPE_LABELS,
  HEARING_TYPES,
  type HearingDto,
  type HearingStatus,
  type HearingType,
  type PropertySummary,
} from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
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
import { Input, NativeSelect } from '@/components/ui/input';
import { useOrg } from '@/hooks/useOrg';
import { useConsultants } from '@/hooks/useReference';
import { qs } from '@/hooks/useUrlState';
import { api } from '@/lib/api';

export const HEARING_STATUS_LABELS: Record<HearingStatus, string> = {
  SCHEDULED: 'Scheduled',
  ATTENDED: 'Attended',
  RESCHEDULED: 'Rescheduled',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No show',
};

/** "2026-06-15T14:30:00Z" → "2026-06-15T09:30" in the browser's time zone, for datetime-local. */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

/** Add a hearing (property chosen or preselected) or edit one. */
export function HearingDialog({
  open,
  onOpenChange,
  hearing,
  property,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  hearing?: HearingDto;
  property?: { id: number; label: string };
}) {
  const org = useOrg();
  const qc = useQueryClient();
  const consultants = useConsultants();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(
    property ??
      (hearing
        ? {
            id: hearing.property.id,
            label: `${hearing.property.county} ${hearing.property.accountNumber}`,
          }
        : null),
  );
  const [when, setWhen] = useState(hearing ? toLocalInput(hearing.scheduledAt) : '');
  const [type, setType] = useState<HearingType>(hearing?.type ?? 'ARB');
  const [status, setStatus] = useState<HearingStatus>(hearing?.status ?? 'SCHEDULED');
  const [taxYear, setTaxYear] = useState(String(hearing?.taxYear ?? new Date().getFullYear()));
  const [location, setLocation] = useState(hearing?.location ?? '');
  const [panel, setPanel] = useState(hearing?.panel ?? '');
  const [assigned, setAssigned] = useState(String(hearing?.assignedTo?.id ?? ''));
  const [notes, setNotes] = useState(hearing?.notes ?? '');
  const matches = useQuery({
    queryKey: ['org', org.orgSlug, 'hearing-property-search', search],
    queryFn: () =>
      api<{ items: PropertySummary[] }>(
        `/orgs/${org.orgSlug}/properties${qs({ q: search, pageSize: 8 })}`,
      ),
    enabled: open && !picked && search.trim().length > 1,
  });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        scheduledAt: new Date(when).toISOString(),
        type,
        location,
        panel,
        notes,
        assignedUserId: assigned ? Number(assigned) : null,
      };
      return hearing
        ? api<HearingDto>(`/orgs/${org.orgSlug}/hearings/${hearing.id}`, {
            method: 'PATCH',
            body: { ...body, status },
          })
        : api<HearingDto>(`/orgs/${org.orgSlug}/hearings`, {
            method: 'POST',
            body: { ...body, propertyId: picked!.id, taxYear: Number(taxYear) },
          });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['org', org.orgSlug] });
      toast.success(hearing ? 'Hearing updated.' : 'Hearing scheduled.');
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{hearing ? 'Edit hearing' : 'Schedule a hearing'}</DialogTitle>
          <DialogDescription>
            {picked ? picked.label : 'Find the property by account number, address or owner.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {!picked && (
            <div className="grid gap-2">
              <Field label="Property" htmlFor="h-search">
                <Input
                  id="h-search"
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Account, address or owner"
                />
              </Field>
              <ul className="divide-y rounded-md border empty:hidden">
                {matches.data?.items.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                      onClick={() =>
                        setPicked({
                          id: p.id,
                          label: `${p.county.name} ${p.accountNumber} · ${p.contact.displayName}`,
                        })
                      }
                    >
                      <span className="font-mono">{p.accountNumber}</span> {p.county.name} ·{' '}
                      <span className="text-muted-foreground">{p.contact.displayName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-[1fr_9rem_6rem]">
            <Field label="Date and time" htmlFor="h-when">
              <Input
                id="h-when"
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
            </Field>
            <Field label="Type" htmlFor="h-type">
              <NativeSelect
                id="h-type"
                value={type}
                onChange={(e) => setType(e.target.value as HearingType)}
              >
                {HEARING_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {HEARING_TYPE_LABELS[t]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Tax year" htmlFor="h-year">
              <Input
                id="h-year"
                inputMode="numeric"
                disabled={Boolean(hearing)}
                value={taxYear}
                onChange={(e) => setTaxYear(e.target.value)}
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <Field label="Location" htmlFor="h-location">
              <Input
                id="h-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="CAD office, room, or phone"
              />
            </Field>
            <Field label="Panel" htmlFor="h-panel">
              <Input id="h-panel" value={panel} onChange={(e) => setPanel(e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Consultant" htmlFor="h-consultant">
              <NativeSelect
                id="h-consultant"
                value={assigned}
                onChange={(e) => setAssigned(e.target.value)}
              >
                <option value="">Unassigned</option>
                {consultants.data?.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {hearing && (
              <Field label="Status" htmlFor="h-status">
                <NativeSelect
                  id="h-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as HearingStatus)}
                >
                  {HEARING_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {HEARING_STATUS_LABELS[s]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </div>
          <Field label="Notes" htmlFor="h-notes">
            <Input id="h-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!picked || !when || save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}{' '}
              {hearing ? 'Save' : 'Schedule'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
