import type { DecimalLike } from './decimal.js';

export type FeeSource = 'TAX_YEAR' | 'PROPERTY' | 'CLIENT' | 'FIRM';

export interface Resolved {
  value: string;
  source: FeeSource;
}

type Maybe = DecimalLike | null | undefined;

/** First level that is set wins. `0` counts as set: 0% is a real 0%. */
function firstSet(levels: [FeeSource, Maybe][], fallback: [FeeSource, DecimalLike]): Resolved {
  for (const [source, value] of levels) {
    if (value !== null && value !== undefined && value !== '')
      return { value: String(value), source };
  }
  return { value: String(fallback[1]), source: fallback[0] };
}

export interface FeeTermsInput {
  taxYear: { contingencyPctOverride?: Maybe; bppFee?: Maybe; bppRenderedAt?: unknown };
  property: { contingencyPct?: Maybe; flatFee?: Maybe; bppFee?: Maybe };
  client: { contingencyPct?: Maybe; flatFee?: Maybe; bppFee?: Maybe };
  firm: {
    defaultContingencyPct: DecimalLike;
    defaultFlatFee: DecimalLike;
    defaultBppFee: DecimalLike;
  };
}

export interface FeeTerms {
  contingencyPct: Resolved;
  flatFee: Resolved;
  /** Null when no BPP fee applies to this year (no rendition and no explicit fee). */
  bppFee: Resolved | null;
}

/**
 * BUILD_PLAN 7: contingency % resolves tax year → property → client → firm.
 * Flat and BPP fees resolve property → client → firm. A BPP fee applies to a year only when
 * that year has its own BPP fee or a rendition date.
 */
export function resolveFeeTerms(input: FeeTermsInput): FeeTerms {
  const { taxYear, property, client, firm } = input;
  const yearBpp = taxYear.bppFee;
  const bppApplies =
    (yearBpp !== null && yearBpp !== undefined && yearBpp !== '') || Boolean(taxYear.bppRenderedAt);
  return {
    contingencyPct: firstSet(
      [
        ['TAX_YEAR', taxYear.contingencyPctOverride],
        ['PROPERTY', property.contingencyPct],
        ['CLIENT', client.contingencyPct],
      ],
      ['FIRM', firm.defaultContingencyPct],
    ),
    flatFee: firstSet(
      [
        ['PROPERTY', property.flatFee],
        ['CLIENT', client.flatFee],
      ],
      ['FIRM', firm.defaultFlatFee],
    ),
    bppFee: bppApplies
      ? firstSet(
          [
            ['TAX_YEAR', yearBpp],
            ['PROPERTY', property.bppFee],
            ['CLIENT', client.bppFee],
          ],
          ['FIRM', firm.defaultBppFee],
        )
      : null,
  };
}
