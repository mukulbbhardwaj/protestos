import { z } from 'zod';
import { HEARING_STATUSES, HEARING_TYPES } from '../calendar/index.js';
import { Id } from './common.js';

// Hearings API (BUILD_PLAN 8.5, M7).

export const HearingDto = z.object({
  id: z.number(),
  taxYear: z.number(),
  scheduledAt: z.string(),
  type: z.enum(HEARING_TYPES),
  status: z.enum(HEARING_STATUSES),
  location: z.string().nullable(),
  panel: z.string().nullable(),
  notes: z.string().nullable(),
  property: z.object({
    id: z.number(),
    accountNumber: z.string(),
    county: z.string(),
    situsLine: z.string().nullable(),
  }),
  contact: z.object({ id: z.number(), displayName: z.string() }),
  assignedTo: z.object({ id: z.number(), name: z.string() }).nullable(),
});
export type HearingDto = z.infer<typeof HearingDto>;

const IsoInstant = z.iso.datetime({ offset: true, message: 'Enter a date and time.' });

export const HearingListQuery = z.object({
  from: IsoInstant.optional(),
  to: IsoInstant.optional(),
  status: z.enum(HEARING_STATUSES).optional(),
  countyId: Id.optional(),
  consultantId: Id.optional(),
  propertyId: Id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const CreateHearingInput = z.object({
  propertyId: Id,
  taxYear: z.coerce.number().int().min(2000).max(2100),
  scheduledAt: IsoInstant,
  type: z.enum(HEARING_TYPES).default('ARB'),
  location: optionalText(200),
  panel: optionalText(100),
  notes: optionalText(2000),
  assignedUserId: Id.nullable().optional(),
});
export type CreateHearingInput = z.input<typeof CreateHearingInput>;

export const UpdateHearingInput = z
  .object({
    scheduledAt: IsoInstant,
    type: z.enum(HEARING_TYPES),
    status: z.enum(HEARING_STATUSES),
    location: optionalText(200),
    panel: optionalText(100),
    notes: optionalText(2000),
    assignedUserId: Id.nullable(),
  })
  .partial();

export const CalendarFeedDto = z.object({ url: z.string() });
