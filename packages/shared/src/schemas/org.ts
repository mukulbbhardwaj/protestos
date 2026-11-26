import { INVOICE_GROUPINGS } from '../billing/index.js';
import { z } from 'zod';
import { ORG_ROLES } from '../roles.js';
import { DecimalString, Email, percentString } from './common.js';
import { DashboardStats } from './crm.js';

export const CreateOrgInput = z.object({
  name: z.string().trim().min(2, 'Enter your firm name.').max(120),
  defaultContingencyPct: percentString('Contingency'),
});
export type CreateOrgInput = z.infer<typeof CreateOrgInput>;

const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #1d4ed8.')
  .nullable();

export const OrgSettings = z.object({
  name: z.string(),
  slug: z.string(),
  state: z.string(),
  timezone: z.string(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  addressLines: z.array(z.string()),
  primaryColor: z.string().nullable(),
  defaultContingencyPct: z.string(),
  defaultFlatFee: z.string(),
  defaultBppFee: z.string(),
  invoicePrefix: z.string(),
  nextInvoiceNumber: z.number(),
  invoiceDueDays: z.number(),
  taxYearDefault: z.number().nullable(),
  savingsBasis: z.enum(['APPRAISED', 'MARKET']),
  flatFeeCurrentYearOnly: z.boolean(),
  invoiceGrouping: z.enum(INVOICE_GROUPINGS),
  paymentInstructions: z.string().nullable(),
  agentName: z.string().nullable(),
  agentTitle: z.string().nullable(),
  agentLicense: z.string().nullable(),
  allowResendSigned: z.boolean(),
  plan: z.string(),
  planStatus: z.string(),
  trialEndsAt: z.string().nullable(),
});
export type OrgSettings = z.infer<typeof OrgSettings>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

export const UpdateOrgSettingsInput = z
  .object({
    name: z.string().trim().min(2, 'Enter your firm name.').max(120),
    timezone: z.string().min(1),
    phone: optionalText(40),
    website: optionalText(200),
    addressLines: z.array(z.string().trim().max(200)).max(4),
    primaryColor: HexColor,
    defaultContingencyPct: percentString('Contingency'),
    defaultFlatFee: DecimalString,
    defaultBppFee: DecimalString,
    invoicePrefix: z.string().trim().max(12),
    nextInvoiceNumber: z.coerce.number().int().min(1),
    invoiceDueDays: z.coerce.number().int().min(0).max(365),
    taxYearDefault: z.coerce.number().int().min(2000).max(2100).nullable(),
    savingsBasis: z.enum(['APPRAISED', 'MARKET']),
    flatFeeCurrentYearOnly: z.boolean(),
    invoiceGrouping: z.enum(INVOICE_GROUPINGS),
    paymentInstructions: optionalText(2000),
    agentName: optionalText(120),
    agentTitle: optionalText(80),
    agentLicense: optionalText(40),
    allowResendSigned: z.boolean(),
  })
  .partial();
export type UpdateOrgSettingsInput = z.infer<typeof UpdateOrgSettingsInput>;

export const Member = z.object({
  id: z.number(),
  userId: z.number(),
  name: z.string(),
  email: z.string(),
  role: z.enum(ORG_ROLES),
  status: z.enum(['ACTIVE', 'INVITED', 'DISABLED']),
  joinedAt: z.string(),
});
export type Member = z.infer<typeof Member>;

export const UpdateMemberInput = z
  .object({
    role: z.enum(ORG_ROLES),
    status: z.enum(['ACTIVE', 'DISABLED']),
  })
  .partial();
export type UpdateMemberInput = z.infer<typeof UpdateMemberInput>;

export const CreateInvitationInput = z.object({
  email: Email,
  role: z.enum(ORG_ROLES),
});
export type CreateInvitationInput = z.infer<typeof CreateInvitationInput>;

export const Invitation = z.object({
  id: z.number(),
  email: z.string(),
  role: z.enum(ORG_ROLES),
  status: z.enum(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED']),
  expiresAt: z.string(),
  createdAt: z.string(),
  invitedBy: z.string().nullable(),
});
export type Invitation = z.infer<typeof Invitation>;

export const InvitationPreview = z.object({
  orgName: z.string(),
  email: z.string(),
  role: z.enum(ORG_ROLES),
  status: z.enum(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED']),
});
export type InvitationPreview = z.infer<typeof InvitationPreview>;

export const AuditEntry = z.object({
  id: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  actor: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
  createdAt: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const OrgOverview = z.object({
  org: z.object({ id: z.number(), name: z.string(), slug: z.string() }),
  role: z.enum(ORG_ROLES),
  plan: z.object({ status: z.string(), trialEndsAt: z.string().nullable() }),
  stats: z.lazy(() => DashboardStats),
  counts: z.object({ members: z.number(), pendingInvitations: z.number() }),
  checklist: z.object({
    importedData: z.boolean(),
    brandingSet: z.boolean(),
    teamInvited: z.boolean(),
    eSignatureConnected: z.boolean(),
  }),
});
export type OrgOverview = z.infer<typeof OrgOverview>;
