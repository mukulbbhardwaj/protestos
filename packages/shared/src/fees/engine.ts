import { fromScaled, mulDivRound, toScaled, type DecimalLike } from './decimal.js';

export type SavingsBasis = 'APPRAISED' | 'MARKET';

export interface FeeInput {
  noticeMarket?: DecimalLike | null;
  finalMarket?: DecimalLike | null;
  noticeAppraised?: DecimalLike | null;
  finalAppraised?: DecimalLike | null;
  /** Combined tax rate as a percentage: 2.15 means 2.15%. */
  taxRatePct?: DecimalLike | null;
  /** Resolved contingency %, e.g. "30". */
  contingencyPct: DecimalLike;
  /** Resolved flat fee in dollars. */
  flatFee: DecimalLike;
  /** Resolved BPP fee in dollars (0 when none applies). */
  bppFee: DecimalLike;
  /** The flat fee is charged only when this is true (e.g. current billing year only). */
  applyFlatFee: boolean;
  /** Which value savings are measured on (firm setting). */
  savingsBasis: SavingsBasis;
}

export type MissingField = 'noticeValue' | 'finalValue' | 'taxRate';

export interface FeeResult {
  /** READY: can be invoiced. INCOMPLETE: a value needed for the contingency fee is missing. */
  status: 'READY' | 'INCOMPLETE';
  missing: MissingField[];
  marketReduction: string | null;
  appraisedReduction: string | null;
  /** The reduction savings are measured on (appraised or market). */
  reduction: string | null;
  taxableSavings: string | null;
  contingencyPct: string;
  contingencyFee: string | null;
  flatFee: string;
  bppFee: string;
  total: string | null;
  /** True when the invoice would carry no contingency (only flat/BPP fees). */
  isZeroSavings: boolean;
  warnings: string[];
  /** Human-readable steps, shown in the UI and printed on invoices. */
  explanation: string[];
}

const CENTS = 2;
const RATE = 4;
const RATE_DIVISOR = 100n * 10n ** BigInt(RATE); // percent, at 4 decimal places

const isSet = (v: DecimalLike | null | undefined): v is DecimalLike =>
  v !== null && v !== undefined && v !== '';

/** $1,234.56. Amounts here are never negative (reductions are clamped at zero). */
function usd(cents: bigint): string {
  const [int, frac] = fromScaled(cents, CENTS).split('.') as [string, string];
  return `$${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

function pct(scaled: bigint): string {
  return `${fromScaled(scaled, RATE).replace(/\.?0+$/, '')}%`;
}

function reductionOf(
  notice: DecimalLike | null | undefined,
  final: DecimalLike | null | undefined,
) {
  if (!isSet(notice) || !isSet(final)) return null;
  const diff = toScaled(notice, CENTS) - toScaled(final, CENTS);
  return { cents: diff > 0n ? diff : 0n, increased: diff < 0n };
}

/** BUILD_PLAN 7. Pure: no I/O, same answer in the browser and the API. */
export function calculateFee(input: FeeInput): FeeResult {
  const warnings: string[] = [];
  const explanation: string[] = [];

  const market = reductionOf(input.noticeMarket, input.finalMarket);
  const appraised = reductionOf(input.noticeAppraised, input.finalAppraised);
  const basis = input.savingsBasis === 'MARKET' ? market : appraised;
  const [noticeBasis, finalBasis] =
    input.savingsBasis === 'MARKET'
      ? [input.noticeMarket, input.finalMarket]
      : [input.noticeAppraised, input.finalAppraised];
  const basisLabel = input.savingsBasis === 'MARKET' ? 'market' : 'appraised';

  const missing: MissingField[] = [];
  if (!isSet(noticeBasis)) missing.push('noticeValue');
  if (!isSet(finalBasis)) missing.push('finalValue');
  if (!isSet(input.taxRatePct)) missing.push('taxRate');

  const contingencyPct = toScaled(input.contingencyPct, RATE);
  const flat = input.applyFlatFee ? toScaled(input.flatFee, CENTS) : 0n;
  const bpp = toScaled(input.bppFee, CENTS);

  let taxableSavings: bigint | null = null;
  let contingencyFee: bigint | null = null;

  if (isSet(input.taxRatePct)) {
    const rate = toScaled(input.taxRatePct, RATE);
    if (rate > 0n && rate < toScaled('0.5', RATE)) {
      const meant = fromScaled(rate * 100n, RATE).replace(/\.?0+$/, '');
      warnings.push(
        `The tax rate ${pct(rate)} looks like a fraction. If you meant ${meant}%, enter ${meant}.`,
      );
    }
    if (basis) {
      if (basis.increased) {
        warnings.push(
          `The final ${basisLabel} value is higher than the notice value, so there are no savings.`,
        );
      }
      taxableSavings = mulDivRound(basis.cents, rate, RATE_DIVISOR);
      contingencyFee = mulDivRound(taxableSavings, contingencyPct, RATE_DIVISOR);
      explanation.push(
        `Reduction ${usd(basis.cents)} × ${pct(rate)} = ${usd(taxableSavings)} savings × ${pct(contingencyPct)} = ${usd(contingencyFee)}`,
      );
    }
  }

  if (input.applyFlatFee && flat > 0n) explanation.push(`Flat fee ${usd(flat)}`);
  if (!input.applyFlatFee && toScaled(input.flatFee, CENTS) > 0n) {
    explanation.push('Flat fee not charged for this tax year');
  }
  if (bpp > 0n) explanation.push(`BPP rendition fee ${usd(bpp)}`);

  const ready = missing.length === 0 && contingencyFee !== null;
  const total = ready ? contingencyFee! + flat + bpp : null;
  if (total !== null) explanation.push(`Total ${usd(total)}`);
  else explanation.push('Enter the notice value, final value and tax rate to calculate the fee.');

  return {
    status: ready ? 'READY' : 'INCOMPLETE',
    missing,
    marketReduction: market ? fromScaled(market.cents, CENTS) : null,
    appraisedReduction: appraised ? fromScaled(appraised.cents, CENTS) : null,
    reduction: basis ? fromScaled(basis.cents, CENTS) : null,
    taxableSavings: taxableSavings === null ? null : fromScaled(taxableSavings, CENTS),
    contingencyPct: fromScaled(contingencyPct, RATE),
    contingencyFee: contingencyFee === null ? null : fromScaled(contingencyFee, CENTS),
    flatFee: fromScaled(flat, CENTS),
    bppFee: fromScaled(bpp, CENTS),
    total: total === null ? null : fromScaled(total, CENTS),
    isZeroSavings: ready && contingencyFee === 0n,
    warnings,
    explanation,
  };
}
