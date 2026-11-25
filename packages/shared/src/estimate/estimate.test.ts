import { describe, expect, it } from 'vitest';
import {
  estimateSavings,
  type EstimateInput,
  type EstimateParcel,
  type EstimateTaxUnit,
} from './index.js';

// Subject: $100,000 land + $300,000 improvement on 2,000 sq ft = $400,000 market.
const subject: EstimateInput['subject'] = {
  accountNumber: '0000000000001',
  situsLine: '1 MAIN ST',
  landValue: '100000',
  improvementValue: '300000',
  marketValue: '400000',
  appraisedValue: '400000',
  livingAreaSqft: 2000,
  yearBuilt: 2005,
  qualityCode: 'B',
  taxCeiling: false,
};

/** A neighbor whose improvement is worth `perSqft` dollars a square foot. */
function comp(
  n: number,
  over: Partial<EstimateParcel> & { perSqft?: number } = {},
): EstimateParcel {
  const { perSqft = 130, ...rest } = over;
  const area = rest.livingAreaSqft ?? 1900 + n * 10;
  return {
    accountNumber: `00000000001${String(n).padStart(2, '0')}`,
    situsLine: `${n} OAK ST`,
    landValue: '90000',
    improvementValue: String(perSqft * area),
    marketValue: String(90000 + perSqft * area),
    appraisedValue: String(90000 + perSqft * area),
    livingAreaSqft: area,
    yearBuilt: 2000 + (n % 10),
    qualityCode: 'B',
    ...rest,
  };
}

const neighbors = (count: number, over: Partial<EstimateParcel> & { perSqft?: number } = {}) =>
  Array.from({ length: count }, (_, i) => comp(i + 1, over));

const units: EstimateTaxUnit[] = [
  { code: '001', name: 'Houston ISD', kind: 'SCHOOL', ratePct: '1.0', taxableValue: '400000' },
  {
    code: '040',
    name: 'Harris County',
    kind: 'COUNTY',
    ratePct: '0.38',
    taxableValue: '320000',
    exemptPct: '20',
  },
  { code: '061', name: 'City of Houston', kind: 'CITY', ratePct: '0.55', taxableValue: '400000' },
];

const base: EstimateInput = {
  subject,
  candidates: neighbors(12),
  units,
  contingencyPct: '30',
};

describe('estimateSavings', () => {
  it('estimates from 12 close neighbors with high confidence', () => {
    // Every comp: $130/sq ft → 100,000 + 130 × 2,000 = $360,000 adjusted.
    const r = estimateSavings(base);
    expect(r).toMatchObject({
      status: 'ESTIMATE',
      confidence: 'HIGH',
      widened: false,
      indicatedValue: '360000.00',
      dispersionPct: '0.0000',
      marketReduction: '40000.00',
      newMarket: '360000.00',
      newAppraised: '360000.00',
      appraisedReduction: '40000.00',
      // ISD 40,000 × 1% = 400.00; county 32,000 × 0.38% = 121.60; city 40,000 × 0.55% = 220.00
      taxSavings: '741.60',
      contingencyPct: '30.0000',
      firmFee: '222.48',
      clientKeeps: '519.12',
      warnings: [],
    });
    expect(r.comps).toHaveLength(12);
    expect(r.comps[0]).toMatchObject({ improvementPerSqft: '130.00', adjustedValue: '360000.00' });
    expect(r.units.map((u) => [u.code, u.taxableReduction, u.savings, u.note])).toEqual([
      ['001', '40000.00', '400.00', null],
      ['040', '32000.00', '121.60', null],
      ['061', '40000.00', '220.00', null],
    ]);
    expect(r.explanation).toEqual([
      'Median of 12 neighbors, adjusted to this home’s land and size: $360,000',
      'Market value $400,000 − indicated $360,000 = reduction $40,000',
      'Tax savings across 3 taxing units: $741.60 a year',
      'Firm fee 30% of $741.60 = $222.48; client keeps $519.12',
    ]);
  });

  it('keeps the 15 most similar comps, closest first, ties by account', () => {
    const r = estimateSavings({ ...base, candidates: [...neighbors(20)].reverse() });
    expect(r.comps).toHaveLength(15);
    // 1,950 sq ft built in 2005 (score 0.025) beats 2,000 sq ft built in 2000 (score 0.167).
    expect(r.comps[0]).toMatchObject({ livingAreaSqft: 1950, yearBuilt: 2005 });
    const twins = estimateSavings({
      ...base,
      candidates: [
        comp(2, { livingAreaSqft: 2000, yearBuilt: 2005 }),
        comp(1, { livingAreaSqft: 2000, yearBuilt: 2005 }),
        ...neighbors(6).slice(2),
      ],
    });
    expect(twins.comps.slice(0, 2).map((c) => c.accountNumber)).toEqual([
      '0000000000101',
      '0000000000102',
    ]);
  });

  it('is medium confidence with fewer than 10 strict comps, or a wide spread', () => {
    expect(estimateSavings({ ...base, candidates: neighbors(6) }).confidence).toBe('MEDIUM');
    const spread = neighbors(12).map((c, i) => (i % 2 ? c : comp(i + 1, { perSqft: 200 })));
    const r = estimateSavings({ ...base, candidates: spread });
    expect(r.confidence).toBe('MEDIUM');
    expect(Number(r.dispersionPct)).toBeGreaterThan(15);
  });

  it('takes the mean of the two middle values for an even count', () => {
    const r = estimateSavings({
      ...base,
      candidates: [...neighbors(3, { perSqft: 120 }), ...neighbors(6, { perSqft: 121 }).slice(3)],
    });
    // Adjusted 340,000 ×3 and 342,000 ×3 → median 341,000.
    expect(r.indicatedValue).toBe('341000.00');
  });

  it('rounds adjusted values and the median to whole dollars', () => {
    const odd = comp(1, {
      livingAreaSqft: 1999,
      improvementValue: '260001',
      marketValue: '350001',
    });
    const r = estimateSavings({ ...base, candidates: [odd, ...neighbors(5).slice(1)] });
    // 260,001 × 2,000 / 1,999 = 260,131.07 → 100,000 + that = $360,131
    expect(r.comps.find((c) => c.accountNumber === odd.accountNumber)?.adjustedValue).toBe(
      '360131.00',
    );
    expect(r.comps.find((c) => c.accountNumber === odd.accountNumber)?.improvementPerSqft).toBe(
      '130.07',
    );
  });

  it('widens the search when strict matches are too few, with low confidence', () => {
    const r = estimateSavings({ ...base, candidates: neighbors(8, { qualityCode: 'C' }) });
    expect(r).toMatchObject({ status: 'ESTIMATE', confidence: 'LOW', widened: true });
    expect(r.warnings[0]).toMatch(/widened/);
  });

  it('filters by area and year built', () => {
    const r = estimateSavings({
      ...base,
      candidates: [
        ...neighbors(5),
        comp(30, { livingAreaSqft: 3000 }), // +50%: outside both passes
        comp(31, { yearBuilt: 1950 }), // 55 years: outside both passes
        comp(32, { livingAreaSqft: 1300 }), // −35%: wide pass only
      ],
    });
    expect(r.comps.map((c) => c.accountNumber)).not.toContain('0000000000130');
    expect(r.comps.map((c) => c.accountNumber)).not.toContain('0000000000131');
    expect(r.comps.map((c) => c.accountNumber)).not.toContain('0000000000132');
  });

  it('ignores the subject itself and unusable candidates, and copes with unknown years', () => {
    const r = estimateSavings({
      ...base,
      subject: { ...subject, yearBuilt: null },
      candidates: [
        { ...comp(1), accountNumber: subject.accountNumber },
        comp(2, { livingAreaSqft: null }),
        comp(3, { livingAreaSqft: 0 }),
        comp(4, { landValue: null }),
        comp(5, { marketValue: '0' }),
        comp(6, { yearBuilt: null }),
        ...neighbors(12).slice(6),
      ],
    });
    expect(r.comps).toHaveLength(7);
    expect(r.comps.map((c) => c.accountNumber)).toContain('0000000000106');
  });

  it('needs at least 5 comps', () => {
    const r = estimateSavings({ ...base, candidates: neighbors(4) });
    expect(r).toMatchObject({ status: 'INSUFFICIENT_COMPS', comps: [], taxSavings: null });
    expect(r.explanation[0]).toMatch(/Only 4 comparable homes/);
    expect(estimateSavings({ ...base, candidates: neighbors(1) }).explanation[0]).toMatch(
      /Only 1 comparable home found/,
    );
  });

  it('needs the subject’s values and living area', () => {
    for (const s of [
      { ...subject, livingAreaSqft: null },
      { ...subject, appraisedValue: null },
      { ...subject, improvementValue: '' },
    ]) {
      expect(estimateSavings({ ...base, subject: s }).status).toBe('INCOMPLETE_SUBJECT');
    }
  });

  it('finds no reduction when the appraisal is in line with neighbors', () => {
    const r = estimateSavings({ ...base, candidates: neighbors(12, { perSqft: 160 }) });
    expect(r).toMatchObject({
      status: 'NO_REDUCTION',
      marketReduction: '0.00',
      taxSavings: '0.00',
      firmFee: '0.00',
      clientKeeps: '0.00',
    });
    expect(r.explanation.at(-1)).toMatch(/in line with comparable neighbors/);
  });

  it('applies the homestead cap: no savings when the capped value is already low', () => {
    const r = estimateSavings({ ...base, subject: { ...subject, appraisedValue: '300000' } });
    expect(r).toMatchObject({
      status: 'NO_REDUCTION',
      marketReduction: '40000.00',
      newAppraised: '300000.00',
      appraisedReduction: '0.00',
    });
    expect(r.explanation.at(-1)).toMatch(/capped appraised value is already below/);
  });

  it('applies the homestead cap: savings only below the capped value', () => {
    const r = estimateSavings({ ...base, subject: { ...subject, appraisedValue: '380000' } });
    expect(r).toMatchObject({ newAppraised: '360000.00', appraisedReduction: '20000.00' });
    expect(r.explanation[2]).toBe(
      'Appraised (capped) value $380,000 → $360,000: reduction $20,000',
    );
  });

  it('counts no school savings under an over-65 ceiling, and caps at taxable value', () => {
    const r = estimateSavings({
      ...base,
      subject: { ...subject, taxCeiling: true },
      units: [
        ...units,
        {
          code: '599',
          name: 'Port of Houston',
          kind: 'OTHER',
          ratePct: '0.006',
          taxableValue: '0',
        },
        { code: '600', name: 'MUD 1', kind: 'OTHER', ratePct: '0.8', taxableValue: '10000' },
      ],
    });
    expect(r.units.map((u) => [u.code, u.savings, u.note])).toEqual([
      ['001', '0.00', 'School taxes are frozen (over-65 or disabled ceiling).'],
      ['040', '121.60', null],
      ['061', '220.00', null],
      ['599', '0.00', 'Already fully exempt in this unit.'],
      ['600', '80.00', null],
    ]);
    expect(r.taxSavings).toBe('421.60');
  });

  it('warns when some units have no rate', () => {
    const r = estimateSavings({
      ...base,
      units: [
        ...units,
        { code: '700', name: 'ESD', kind: 'OTHER', ratePct: null, taxableValue: '1' },
      ],
    });
    expect(r.taxSavings).toBe('741.60');
    expect(r.warnings).toEqual([
      'Some taxing units have no published rate yet, so the savings may be low.',
    ]);
  });

  it('falls back to one combined rate', () => {
    const r = estimateSavings({ ...base, units: [], fallbackTaxRatePct: '2.15' });
    expect(r).toMatchObject({ taxSavings: '860.00', firmFee: '258.00', clientKeeps: '602.00' });
    expect(r.explanation).toContain('Reduction $40,000 × 2.15% = $860 a year');
  });

  it('reports the reduction without savings when there is no rate at all', () => {
    const r = estimateSavings({ ...base, units: [], fallbackTaxRatePct: null });
    expect(r).toMatchObject({
      status: 'ESTIMATE',
      appraisedReduction: '40000.00',
      taxSavings: null,
      firmFee: null,
      clientKeeps: null,
    });
    expect(r.warnings).toContain(
      'No tax rate is available for this account, so savings can’t be computed.',
    );
  });

  it('handles a zero indicated value without dividing by zero', () => {
    const r = estimateSavings({
      ...base,
      subject: { ...subject, landValue: '0' },
      candidates: neighbors(6, { perSqft: 0, marketValue: '90000' }),
    });
    expect(r).toMatchObject({ indicatedValue: '0.00', dispersionPct: '0.0000' });
  });
});

describe('estimateSavings: commercial (spec 5a)', () => {
  it('treats state class F as commercial', async () => {
    const { propertyKindOf } = await import('./index.js');
    expect(propertyKindOf('F1')).toBe('COMMERCIAL');
    expect(propertyKindOf('a1')).toBe('RESIDENTIAL');
  });

  // Subject: a 10,000 sq ft office on $200,000 of land, $1,700,000 market.
  const office: EstimateInput['subject'] = {
    accountNumber: '0010000000001',
    situsLine: '1 COMMERCE ST',
    landValue: '200000',
    improvementValue: '1500000',
    marketValue: '1700000',
    appraisedValue: '1700000',
    livingAreaSqft: 10_000,
    yearBuilt: 1995,
    qualityCode: 'C',
    neighborhoodCode: 'N1',
    propertyUse: 'Office',
    taxCeiling: false,
  };

  /** Same-use buildings worth $120/sq ft (→ 200,000 + 1,200,000 = $1.4M adjusted). */
  function building(
    n: number,
    over: Partial<EstimateParcel> & { perSqft?: number } = {},
  ): EstimateParcel {
    const { perSqft = 120, ...rest } = over;
    const area = rest.livingAreaSqft ?? 8_000 + n * 300;
    return {
      accountNumber: `00200000000${String(n).padStart(2, '0')}`,
      situsLine: `${n} MAIN ST`,
      landValue: '150000',
      improvementValue: String(perSqft * area),
      marketValue: String(150000 + perSqft * area),
      appraisedValue: String(150000 + perSqft * area),
      livingAreaSqft: area,
      yearBuilt: 1990 + (n % 10),
      qualityCode: n % 2 ? 'C' : 'B',
      neighborhoodCode: 'N1',
      propertyUse: 'Office',
      ...rest,
    };
  }
  const buildings = (count: number, over: Partial<EstimateParcel> & { perSqft?: number } = {}) =>
    Array.from({ length: count }, (_, i) => building(i + 1, over));

  const commercial: EstimateInput = {
    kind: 'COMMERCIAL',
    subject: office,
    candidates: buildings(12),
    units: [
      { code: '040', name: 'County', kind: 'COUNTY', ratePct: '0.4', taxableValue: '1700000' },
    ],
    contingencyPct: '25',
  };

  it('compares same-type buildings in the neighborhood, any grade', () => {
    const r = estimateSavings(commercial);
    expect(r).toMatchObject({
      status: 'ESTIMATE',
      confidence: 'HIGH',
      indicatedValue: '1400000.00',
      appraisedReduction: '300000.00',
      // 300,000 × 0.4% = 1,200; 25% fee = 300
      taxSavings: '1200.00',
      firmFee: '300.00',
    });
    expect(r.comps).toHaveLength(12);
    expect(r.explanation[0]).toBe(
      'Median of 12 comparable Office properties, adjusted to this property’s land and building size: $1,400,000',
    );
  });

  it('never compares a different building type, and widens to the market area', () => {
    const r = estimateSavings({
      ...commercial,
      candidates: [
        ...buildings(8, { propertyUse: 'Warehouse' }),
        ...buildings(3),
        ...buildings(6, { neighborhoodCode: 'N2' }).map((b, i) => ({
          ...b,
          accountNumber: `00300000000${i}`,
        })),
      ],
    });
    expect(r).toMatchObject({ status: 'ESTIMATE', confidence: 'LOW', widened: true });
    expect(r.comps).toHaveLength(9);
    expect(r.comps.every((c) => !c.accountNumber.startsWith('0020000000009'))).toBe(true);
    expect(r.warnings[0]).toMatch(/same building type across the market area/);
  });

  it('allows a wider spread for high confidence than homes do', () => {
    // Half at $120/sq ft, half at $170: adjusted $1.4M and $1.9M, dispersion about 15.2%.
    const mixed = buildings(12).map((b, i) => (i % 2 ? b : building(i + 1, { perSqft: 170 })));
    const c = estimateSavings({ ...commercial, candidates: mixed });
    const spread = Number(c.dispersionPct);
    expect(spread).toBeGreaterThan(15);
    expect(spread).toBeLessThan(20);
    expect(c.confidence).toBe('HIGH');
  });

  it('explains too few comparables and missing building area in commercial terms', () => {
    expect(estimateSavings({ ...commercial, candidates: buildings(1) }).explanation[0]).toBe(
      'Only 1 comparable property found in this market area; at least 5 are needed for an estimate.',
    );
    expect(estimateSavings({ ...commercial, candidates: buildings(3) }).explanation[0]).toMatch(
      /^Only 3 comparable properties/,
    );
    const r = estimateSavings({ ...commercial, subject: { ...office, livingAreaSqft: null } });
    expect(r.explanation[0]).toMatch(/missing its values or building area/);
  });

  it('says when the appraisal is in line with comparable properties', () => {
    const r = estimateSavings({ ...commercial, candidates: buildings(12, { perSqft: 200 }) });
    expect(r.status).toBe('NO_REDUCTION');
    expect(r.explanation.at(-1)).toMatch(/in line with comparable properties/);
  });

  it('works without a use or neighborhood on record', () => {
    const r = estimateSavings({
      ...commercial,
      subject: { ...office, propertyUse: null, neighborhoodCode: null },
      candidates: buildings(6, { propertyUse: null, neighborhoodCode: undefined }),
    });
    expect(r.comps).toHaveLength(6);
    expect(r.explanation[0]).toMatch(/^Median of 6 comparable commercial properties/);
    // A comparable with no neighborhood on record isn't excluded by the subject's.
    const unknownHood = estimateSavings({
      ...commercial,
      candidates: buildings(6, { neighborhoodCode: null }),
    });
    expect(unknownHood).toMatchObject({ widened: false, comps: expect.any(Array) });
    expect(unknownHood.comps).toHaveLength(6);
  });
});
