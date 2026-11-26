import type { InvoiceStatus, InvoiceTemplate, PaymentMethod } from '@app/shared';

export const INVOICE_STATUS: Record<
  InvoiceStatus,
  {
    label: string;
    variant: 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive';
  }
> = {
  DRAFT: { label: 'Draft', variant: 'outline' },
  ISSUED: { label: 'Issued', variant: 'default' },
  PARTIALLY_PAID: { label: 'Part paid', variant: 'warning' },
  PAID: { label: 'Paid', variant: 'success' },
  VOID: { label: 'Void', variant: 'secondary' },
  WRITTEN_OFF: { label: 'Written off', variant: 'secondary' },
};

export const TEMPLATE_LABELS: Record<InvoiceTemplate, string> = {
  STANDARD: 'Standard',
  ARBITRATION: 'Arbitration',
  HOMESTEAD: 'Homestead',
  ZERO_SAVINGS: 'Zero savings',
};

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  ZELLE: 'Zelle',
  CHECK: 'Check',
  ACH: 'ACH',
  CASH: 'Cash',
  CARD: 'Card',
  OTHER: 'Other',
};

/** Today in Central time, YYYY-MM-DD (the default for payment and issue dates). */
export const todayIso = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
