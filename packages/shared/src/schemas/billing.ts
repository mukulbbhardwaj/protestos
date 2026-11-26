import { z } from 'zod';
import {
  AGING_BUCKETS,
  INVOICE_LINE_KINDS,
  INVOICE_STATUSES,
  INVOICE_TEMPLATES,
  PAYMENT_METHODS,
} from '../billing/index.js';
import { DELIVERY_STATUSES } from '../email/index.js';
import { Id } from './common.js';
import { DeliveryDto } from './email.js';
import { PageQuery } from './crm.js';

// Invoicing and payments API (BUILD_PLAN 8.6, 8.7). Money travels as "1234.50" strings.

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date like 2026-09-15.');
/** Signed money for adjustment lines: "-50" is a discount. */
const SignedMoney = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim().replace(/[$,]/g, ''))
  .pipe(z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'Enter an amount, like 150 or -25.50.'));
const Money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim().replace(/[$,]/g, ''))
  .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount, like 150 or 150.50.'));

const ContactRef = z.object({
  id: z.number(),
  displayName: z.string(),
  clientNumber: z.string().nullable(),
});

export const InvoiceSummary = z.object({
  id: z.number(),
  number: z.string().nullable(),
  contact: ContactRef,
  taxYear: z.number(),
  status: z.enum(INVOICE_STATUSES),
  pastDue: z.boolean(),
  template: z.enum(INVOICE_TEMPLATES),
  issueDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  total: z.string(),
  amountPaid: z.string(),
  balance: z.string(),
  propertyCount: z.number(),
  historical: z.boolean(),
  sentAt: z.string().nullable(),
  /** Latest email of this invoice, if any (M5). */
  delivery: z.object({ status: z.enum(DELIVERY_STATUSES), toEmail: z.string() }).nullable(),
  createdAt: z.string(),
});
export type InvoiceSummary = z.infer<typeof InvoiceSummary>;

export const InvoiceLine = z.object({
  id: z.number(),
  kind: z.enum(INVOICE_LINE_KINDS),
  description: z.string(),
  amount: z.string(),
  property: z
    .object({
      id: z.number(),
      accountNumber: z.string(),
      county: z.string(),
      situsLine: z.string().nullable(),
    })
    .nullable(),
  taxYearRecordId: z.number().nullable(),
  /** Fee-engine inputs and outputs (frozen at issue). */
  snapshot: z.record(z.string(), z.unknown()).nullable(),
});
export type InvoiceLine = z.infer<typeof InvoiceLine>;

export const InvoiceDetail = InvoiceSummary.extend({
  subtotal: z.string(),
  notes: z.string().nullable(),
  voidedAt: z.string().nullable(),
  voidReason: z.string().nullable(),
  writtenOffAt: z.string().nullable(),
  writeOffReason: z.string().nullable(),
  hasPdf: z.boolean(),
  lines: z.array(InvoiceLine),
  payments: z.array(
    z.object({
      paymentId: z.number(),
      receivedAt: z.string(),
      method: z.enum(PAYMENT_METHODS),
      reference: z.string().nullable(),
      amount: z.string(),
    }),
  ),
  billTo: z.object({
    name: z.string(),
    email: z.string().nullable(),
    addressLines: z.array(z.string()),
  }),
  deliveries: z.array(DeliveryDto),
});
export type InvoiceDetail = z.infer<typeof InvoiceDetail>;

export const InvoiceListQuery = PageQuery.extend({
  status: z.enum([...INVOICE_STATUSES, 'OPEN', 'PAST_DUE']).optional(),
  taxYear: z.coerce.number().int().optional(),
  contactId: Id.optional(),
  q: z.string().trim().max(100).optional(),
  delivery: z.enum(['NOT_SENT', 'SENT', 'BOUNCED']).optional(),
  sort: z.enum(['newest', 'number', 'due', 'balance']).default('newest'),
});
export type InvoiceListQuery = z.infer<typeof InvoiceListQuery>;

export const InvoiceTotals = z.object({
  count: z.number(),
  total: z.string(),
  balance: z.string(),
});

const csvIds = z
  .union([z.array(Id), z.string()])
  .transform((v) =>
    Array.isArray(v)
      ? v
      : v
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isInteger(n) && n > 0),
  )
  .optional();

export const GenerateInvoicesInput = z.object({
  taxYear: z.coerce.number().int().min(2000).max(2100),
  contactIds: csvIds,
  countyIds: csvIds,
  consultantIds: csvIds,
});
export type GenerateInvoicesInput = z.infer<typeof GenerateInvoicesInput>;

export const GeneratePreview = z.object({
  taxYear: z.number(),
  grouping: z.enum(['CLIENT_YEAR', 'PROPERTY_YEAR']),
  invoices: z.array(
    z.object({
      contact: ContactRef,
      template: z.enum(INVOICE_TEMPLATES),
      total: z.string(),
      lines: z.array(
        z.object({
          taxYearRecordId: z.number(),
          property: z.string(),
          kind: z.enum(INVOICE_LINE_KINDS),
          description: z.string(),
          amount: z.string(),
        }),
      ),
    }),
  ),
  skipped: z.array(z.object({ property: z.string(), client: z.string(), reason: z.string() })),
  total: z.string(),
});
export type GeneratePreview = z.infer<typeof GeneratePreview>;

export const UpdateInvoiceInput = z
  .object({
    template: z.enum(INVOICE_TEMPLATES),
    notes: z
      .string()
      .trim()
      .max(2000)
      .transform((v) => (v === '' ? null : v))
      .nullable(),
  })
  .partial();

export const AddInvoiceLineInput = z.object({
  description: z.string().trim().min(1, 'Describe the adjustment.').max(300),
  amount: SignedMoney,
});

export const IssueInvoiceInput = z.object({
  issueDate: Day.optional(),
  dueDate: Day.optional(),
});

export const ReasonInput = z.object({
  reason: z.string().trim().min(3, 'Give a reason.').max(500),
});

export const AllocationInput = z.object({ invoiceId: Id, amount: Money });

export const CreatePaymentInput = z.object({
  contactId: Id,
  receivedAt: Day,
  amount: Money.refine((v) => Number(v) > 0, 'Enter an amount more than zero.'),
  method: z.enum(PAYMENT_METHODS),
  reference: z
    .string()
    .trim()
    .max(100)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  notes: z
    .string()
    .trim()
    .max(1000)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  /** Omitted: allocated oldest first. An empty list keeps it all as credit. */
  allocations: z.array(AllocationInput).optional(),
  /** Email the client a receipt (PAYMENT_RECEIPT template). */
  sendReceipt: z.boolean().optional(),
});
export type CreatePaymentInput = z.input<typeof CreatePaymentInput>;
export type CreatePaymentData = z.infer<typeof CreatePaymentInput>;

export const PaymentDto = z.object({
  id: z.number(),
  contact: ContactRef,
  receivedAt: z.string(),
  amount: z.string(),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().nullable(),
  notes: z.string().nullable(),
  allocated: z.string(),
  unallocated: z.string(),
  allocations: z.array(
    z.object({ invoiceId: z.number(), number: z.string().nullable(), amount: z.string() }),
  ),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  receipt: z.object({ status: z.enum(DELIVERY_STATUSES), toEmail: z.string() }).nullable(),
});
export type PaymentDto = z.infer<typeof PaymentDto>;

export const PaymentListQuery = PageQuery.extend({
  contactId: Id.optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  from: Day.optional(),
  to: Day.optional(),
});

export const ClientBilling = z.object({
  contact: ContactRef,
  /** Payments not yet allocated to invoices. */
  credit: z.string(),
  openBalance: z.string(),
  pastDueBalance: z.string(),
  /** Has a billing email or email, so receipts and invoices can be emailed. */
  hasEmail: z.boolean(),
  openInvoices: z.array(InvoiceSummary),
});
export type ClientBilling = z.infer<typeof ClientBilling>;

export { AGING_BUCKETS };
