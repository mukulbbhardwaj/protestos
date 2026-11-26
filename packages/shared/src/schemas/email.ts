import { z } from 'zod';
import { DELIVERY_STATUSES, EMAIL_TEMPLATE_KEYS } from '../email/index.js';
import { Id } from './common.js';

// Email templates and delivery tracking (M5).

export const EmailTemplateDto = z.object({
  key: z.enum(EMAIL_TEMPLATE_KEYS),
  name: z.string(),
  subject: z.string(),
  body: z.string(),
  isCustom: z.boolean(),
  placeholders: z.array(z.string()),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
});
export type EmailTemplateDto = z.infer<typeof EmailTemplateDto>;

export const SaveEmailTemplateInput = z.object({
  key: z.enum(EMAIL_TEMPLATE_KEYS),
  subject: z.string().trim().min(1, 'Enter a subject.').max(200),
  body: z.string().trim().min(1, 'Write the email.').max(10_000),
});
export type SaveEmailTemplateInput = z.infer<typeof SaveEmailTemplateInput>;

export const EmailTemplateKeyInput = z.object({ key: z.enum(EMAIL_TEMPLATE_KEYS) });

export const RenderedEmail = z.object({ subject: z.string(), html: z.string(), text: z.string() });
export type RenderedEmail = z.infer<typeof RenderedEmail>;

export const MailEventDto = z.object({
  id: z.string(),
  type: z.string(),
  at: z.string(),
  detail: z.string().optional(),
});

export const DeliveryDto = z.object({
  id: z.number(),
  templateKey: z.enum(EMAIL_TEMPLATE_KEYS),
  toEmail: z.string(),
  subject: z.string().nullable(),
  status: z.enum(DELIVERY_STATUSES),
  events: z.array(MailEventDto),
  error: z.string().nullable(),
  queuedAt: z.string(),
  sentAt: z.string().nullable(),
  lastEventAt: z.string().nullable(),
});
export type DeliveryDto = z.infer<typeof DeliveryDto>;

export const SendInvoicesInput = z.object({
  invoiceIds: z.array(Id).min(1).max(500),
  /** Generated once per send dialog: resending the same request never sends twice. */
  requestKey: z.string().trim().min(8).max(100),
  dryRun: z.boolean().default(false),
});
export type SendInvoicesInput = z.input<typeof SendInvoicesInput>;

const SendTarget = z.object({
  invoiceId: z.number(),
  number: z.string().nullable(),
  client: z.string(),
});

export const SendInvoicesResult = z.object({
  queued: z.array(
    SendTarget.extend({
      toEmail: z.string(),
      templateKey: z.enum(EMAIL_TEMPLATE_KEYS),
      deliveryId: z.number().nullable(),
    }),
  ),
  skipped: z.array(SendTarget.extend({ reason: z.string() })),
  /** True when this request key was already used: nothing new was queued. */
  repeated: z.boolean(),
});
export type SendInvoicesResult = z.infer<typeof SendInvoicesResult>;
