// Exact fixed-point arithmetic on decimal strings, via BigInt. Money never goes through
// binary floating point, so rounding to the cent is exact and identical in browser and API.

export type DecimalLike = string | number;

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Parses "1234.5" at `scale` decimal places into a scaled integer (half-up beyond scale). */
export function toScaled(value: DecimalLike, scale: number): bigint {
  const text = typeof value === 'number' ? numberToPlain(value) : value.trim();
  if (!DECIMAL.test(text)) throw new RangeError(`Not a decimal number: "${String(value)}"`);
  const negative = text.startsWith('-');
  const [intPart, frac = ''] = text.replace('-', '').split('.') as [string, string?];
  const kept = frac.slice(0, scale).padEnd(scale, '0');
  let scaled = BigInt(intPart + kept);
  if ((frac[scale] ?? '0') >= '5') scaled += 1n; // half-up on the first dropped digit
  return negative ? -scaled : scaled;
}

function numberToPlain(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`Not a finite number: ${n}`);
  // Avoid exponent notation (1e-7) which the regex would reject.
  return n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
}

/** Formats a scaled integer back to a decimal string with exactly `scale` places. */
export function fromScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const int = digits.slice(0, digits.length - scale);
  const frac = scale > 0 ? `.${digits.slice(-scale)}` : '';
  return `${negative ? '-' : ''}${int}${frac}`;
}

/** round(a × b ÷ divisor), half away from zero. */
export function mulDivRound(a: bigint, b: bigint, divisor: bigint): bigint {
  const product = a * b;
  const negative = product < 0n !== divisor < 0n;
  const p = product < 0n ? -product : product;
  const d = divisor < 0n ? -divisor : divisor;
  const q = (p * 2n + d) / (2n * d);
  return negative ? -q : q;
}

export const ZERO_CENTS = 0n;
