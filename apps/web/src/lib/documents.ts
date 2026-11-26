import type { DocumentStatus } from '@app/shared';

export const DOCUMENT_STATUS: Record<
  DocumentStatus,
  {
    label: string;
    variant: 'outline' | 'secondary' | 'default' | 'success' | 'warning' | 'destructive';
  }
> = {
  DRAFT: { label: 'Draft', variant: 'outline' },
  SENT: { label: 'Sent', variant: 'default' },
  VIEWED: { label: 'Viewed', variant: 'warning' },
  SIGNED: { label: 'Signed', variant: 'success' },
  DECLINED: { label: 'Declined', variant: 'destructive' },
  VOIDED: { label: 'Voided', variant: 'secondary' },
};
