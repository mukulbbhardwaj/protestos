import { HEARING_TYPE_LABELS, roleAtLeast, type HearingDto } from '@app/shared';
import { CalendarPlus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useOrg } from '@/hooks/useOrg';
import { useOrgQuery } from '@/hooks/useOrgQuery';
import { formatDateTime } from '@/lib/format';
import { HEARING_STATUS_LABELS, HearingDialog } from '../hearings/HearingDialog';

export function PropertyHearingsCard({
  propertyId,
  label,
  archived,
}: {
  propertyId: number;
  label: string;
  archived: boolean;
}) {
  const org = useOrg();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<HearingDto | null>(null);
  const q = useOrgQuery<{ items: HearingDto[] }>(`/hearings?propertyId=${propertyId}&pageSize=100`);
  const canEdit = roleAtLeast(org.role, 'STAFF') && !archived;
  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>Hearings</CardTitle>
          <CardDescription>Scheduling one moves the year to “Hearing scheduled”.</CardDescription>
        </div>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <CalendarPlus /> Schedule
          </Button>
        )}
      </CardHeader>
      <table className="w-full text-sm">
        <tbody>
          {q.data?.items.length === 0 && (
            <tr>
              <td className="border-t px-5 py-6 text-center text-muted-foreground">
                No hearings yet.
              </td>
            </tr>
          )}
          {q.data?.items.map((h) => (
            <tr
              key={h.id}
              className="cursor-pointer border-t hover:bg-muted/40"
              onClick={() => canEdit && setEditing(h)}
            >
              <td className="px-5 py-2.5">{formatDateTime(h.scheduledAt)}</td>
              <td className="px-5 py-2.5">
                {HEARING_TYPE_LABELS[h.type]} · {h.taxYear}
              </td>
              <td className="px-5 py-2.5 text-muted-foreground">{h.location ?? '—'}</td>
              <td className="px-5 py-2.5">{h.assignedTo?.name ?? 'Unassigned'}</td>
              <td className="px-5 py-2.5">{HEARING_STATUS_LABELS[h.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {adding && (
        <HearingDialog open onOpenChange={setAdding} property={{ id: propertyId, label }} />
      )}
      {editing && (
        <HearingDialog open hearing={editing} onOpenChange={(o) => !o && setEditing(null)} />
      )}
    </Card>
  );
}
