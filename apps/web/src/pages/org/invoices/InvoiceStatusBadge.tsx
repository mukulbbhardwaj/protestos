import type { InvoiceStatus } from '@app/shared';
import { Badge } from '@/components/ui/badge';
import { INVOICE_STATUS } from '@/lib/billing';

export function InvoiceStatusBadge({
  status,
  pastDue,
}: {
  status: InvoiceStatus;
  pastDue?: boolean;
}) {
  if (pastDue) return <Badge variant="destructive">Past due</Badge>;
  return <Badge variant={INVOICE_STATUS[status].variant}>{INVOICE_STATUS[status].label}</Badge>;
}
