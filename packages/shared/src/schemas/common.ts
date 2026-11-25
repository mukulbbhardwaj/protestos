import { z } from 'zod';

export const Email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.'));

export const Password = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200, 'Use at most 200 characters.');

/** Decimal values travel as strings so money and percentages never lose precision. */
export const DecimalString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d+(\.\d+)?$/, 'Enter a number, like 30 or 30.5.'));

export function percentString(label: string) {
  return DecimalString.refine((v) => Number(v) <= 100, `${label} can't be more than 100%.`);
}

export const Id = z.coerce.number().int().positive();

export const ApiErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
