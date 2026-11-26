import { z } from 'zod';
import { AGING_BUCKETS, PAYMENT_METHODS } from '../billing/index.js';
import { PROPERTY_TYPES } from './crm.js';
import { Id } from './common.js';

// Finance dashboard (BUILD_PLAN 8.10, M7). Money is "1234.50".

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const FinanceQuery = z.object({
  /** "Today" for the periods (defaults to today in the firm's time zone). */
  asOf: Day.optional(),
  /** Range for billed by county and recent payments (defaults to year to date). */
  from: Day.optional(),
  to: Day.optional(),
  taxYear: z.coerce.number().int().min(2000).max(2100).optional(),
  countyId: Id.optional(),
  consultantId: Id.optional(),
  propertyType: z.enum(PROPERTY_TYPES).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
});
export type FinanceQuery = z.input<typeof FinanceQuery>;

const BilledCollected = z.object({ billed: z.string(), collected: z.string() });

export const FinanceDashboard = z.object({
  asOf: z.string(),
  range: z.object({ from: z.string(), to: z.string() }),
  kpis: z.object({
    thisMonth: BilledCollected,
    lastMonth: BilledCollected,
    ytd: BilledCollected,
    lastYear: BilledCollected,
    /** Collected ÷ billed, year to date, as a percentage ("72.5"). */
    collectionRateYtd: z.string().nullable(),
  }),
  outstanding: z.object({
    total: z.string(),
    count: z.number(),
    buckets: z.record(z.enum(AGING_BUCKETS), z.string()),
  }),
  savings: z.object({
    taxYear: z.number(),
    properties: z.number(),
    valueReduced: z.string(),
    taxSavings: z.string(),
  }),
  monthly: z.array(z.object({ month: z.string(), billed: z.string(), collected: z.string() })),
  byCounty: z.array(z.object({ county: z.string(), billed: z.string() })),
  outcomes: z.array(
    z.object({
      taxYear: z.number(),
      settled: z.number(),
      boardOrder: z.number(),
      noChange: z.number(),
      withdrawn: z.number(),
      pending: z.number(),
    }),
  ),
  topOutstanding: z.array(
    z.object({
      contact: z.object({
        id: z.number(),
        displayName: z.string(),
        clientNumber: z.string().nullable(),
      }),
      balance: z.string(),
      pastDue: z.string(),
      invoices: z.number(),
    }),
  ),
  recentPayments: z.array(
    z.object({
      id: z.number(),
      receivedAt: z.string(),
      contact: z.object({ id: z.number(), displayName: z.string() }),
      method: z.enum(PAYMENT_METHODS),
      reference: z.string().nullable(),
      amount: z.string(),
    }),
  ),
});
export type FinanceDashboard = z.infer<typeof FinanceDashboard>;
