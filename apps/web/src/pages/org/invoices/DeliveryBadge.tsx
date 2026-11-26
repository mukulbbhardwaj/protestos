import type { DeliveryStatus } from '@app/shared';
import { Badge } from '@/components/ui/badge';

const LABELS: Record<
  DeliveryStatus,
  { label: string; variant: 'outline' | 'secondary' | 'default' | 'success' | 'destructive' }
> = {
  QUEUED: { label: 'Sending', variant: 'outline' },
  SENT: { label: 'Sent', variant: 'secondary' },
  DELIVERED: { label: 'Delivered', variant: 'default' },
  OPENED: { label: 'Opened', variant: 'success' },
  BOUNCED: { label: 'Bounced', variant: 'destructive' },
  FAILED: { label: 'Failed', variant: 'destructive' },
};

export function DeliveryBadge({ status }: { status: DeliveryStatus }) {
  return <Badge variant={LABELS[status].variant}>{LABELS[status].label}</Badge>;
}
