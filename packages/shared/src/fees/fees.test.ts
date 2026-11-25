import { describe, expect, it } from 'vitest';
import {
  calculateFee,
  fromScaled,
  mulDivRound,
  resolveFeeTerms,
  toScaled,
  type FeeInput,
} from './index.js';

const base: FeeInput = {
  noticeMarket: '500000',
  finalMarket: '460000',
  noticeAppraised: '450000',
  finalAppraised: '410000',
  taxRatePct: '2.15',
  contingencyPct: '30',
  flatFee: '0',
  bppFee: '0',
  applyFlatFee: true,
  savingsBasis: 'APPRAISED',
};

describe('decimal helpers', () => {
  it('parses and formats exactly', () => {
    expect(toScaled('1234.5', 2)).toBe(123450n);
    expect(toScaled('-0.07', 2)).toBe(-7n);
    expect(toScaled(12, 2)).toBe(1200n);
    expect(toScaled(0.0000001, 4)).toBe(0n);
    expect(toScaled(' 3 ', 0)).toBe(3n);
    expect(fromScaled(123450n, 2)).toBe('1234.50');
    expect(fromScaled(-7n, 2)).toBe('-0.07');
    expect(fromScaled(5n, 0)).toBe('5');
  });

  it('rounds half-up when dropping digits', () => {
    expect(toScaled('1.005', 2)).toBe(101n);
    expect(toScaled('1.004', 2)).toBe(100n);
    expect(toScaled('-1.005', 2)).toBe(-101n);
  });

  it('rejects non-numbers', () => {
    expect(() => toScaled('abc', 2)).toThrow(RangeError);
    expect(() => toScaled('1e5', 2)).toThrow(RangeError);
    expect(() => toScaled(Number.NaN, 2)).toThrow(RangeError);
  });

  it('mulDivRound rounds half away from zero', () => {
    expect(mulDivRound(5n, 1n, 2n)).toBe(3n);
    expect(mulDivRound(-5n, 1n, 2n)).toBe(-3n);
    expect(mulDivRound(5n, 1n, -2n)).toBe(-3n);
    expect(mulDivRound(4n, 1n, 3n)).toBe(1n);
  });
});

describe('calculateFee', () => {
  it('computes the plan example: $40,000 × 2.15% = $860 × 30% = $258', () => {
    const r = calculateFee(base);
    expect(r).toMatchObject({
      status: 'READY',
      missing: [],
      marketReduction: '40000.00',
      appraisedReduction: '40000.00',
      reduction: '40000.00',
      taxableSavings: '860.00',
      contingencyPct: '30.0000',
      contingencyFee: '258.00',
      total: '258.00',
      isZeroSavings: false,
      warnings: [],
    });
    expect(r.explanation[0]).toBe('Reduction $40,000.00 × 2.15% = $860.00 savings × 30% = $258.00');
    expect(r.explanation.at(-1)).toBe('Total $258.00');
  });

  it('measures savings on market value when the firm says so', () => {
    const r = calculateFee({ ...base, finalMarket: '440000', savingsBasis: 'MARKET' });
    expect(r.reduction).toBe('60000.00');
    expect(r.taxableSavings).toBe('1290.00');
  });

  it('gives zero savings when the final value is higher than notice, with a warning', () => {
    const r = calculateFee({ ...base, finalAppraised: '470000' });
    expect(r.appraisedReduction).toBe('0.00');
    expect(r.contingencyFee).toBe('0.00');
    expect(r.total).toBe('0.00');
    expect(r.isZeroSavings).toBe(true);
    expect(r.warnings[0]).toMatch(/higher than the notice value/);
  });

  it('is INCOMPLETE without a final value, notice value or tax rate', () => {
    expect(calculateFee({ ...base, finalAppraised: null })).toMatchObject({
      status: 'INCOMPLETE',
      missing: ['finalValue'],
      total: null,
      contingencyFee: null,
    });
    expect(calculateFee({ ...base, noticeAppraised: undefined }).missing).toEqual(['noticeValue']);
    const noRate = calculateFee({ ...base, taxRatePct: '' });
    expect(noRate.missing).toEqual(['taxRate']);
    expect(noRate.taxableSavings).toBeNull();
    expect(noRate.explanation.at(-1)).toMatch(/Enter the notice value/);
  });

  it('leaves the market reduction empty when market values are missing', () => {
    const r = calculateFee({ ...base, noticeMarket: null, finalMarket: null });
    expect(r.marketReduction).toBeNull();
    expect(r.status).toBe('READY'); // savings are measured on appraised value
  });

  it('treats a 0% contingency as a real 0%', () => {
    const r = calculateFee({ ...base, contingencyPct: '0' });
    expect(r.contingencyFee).toBe('0.00');
    expect(r.total).toBe('0.00');
    expect(r.isZeroSavings).toBe(true);
  });

  it('warns when the tax rate looks like a fraction', () => {
    const r = calculateFee({ ...base, taxRatePct: '0.0215' });
    expect(r.warnings[0]).toBe(
      'The tax rate 0.0215% looks like a fraction. If you meant 2.15%, enter 2.15.',
    );
    expect(r.taxableSavings).toBe('8.60');
  });

  it('does not warn for a 0% rate', () => {
    expect(calculateFee({ ...base, taxRatePct: '0' }).warnings).toEqual([]);
  });

  it('rounds to the cent, half up', () => {
    // 12,345 × 2.1234% = 262.133... → 262.13; × 33.3333% = 87.376... → 87.38
    const r = calculateFee({
      ...base,
      noticeAppraised: '112345',
      finalAppraised: '100000',
      taxRatePct: '2.1234',
      contingencyPct: '33.3333',
    });
    expect(r.taxableSavings).toBe('262.13');
    expect(r.contingencyFee).toBe('87.38');
    // exactly half a cent rounds up: 1 × 50% → 0.005 → 0.01
    const half = calculateFee({
      ...base,
      noticeAppraised: '100',
      finalAppraised: '99',
      taxRatePct: '1',
      contingencyPct: '50',
    });
    expect(half.taxableSavings).toBe('0.01');
    expect(half.contingencyFee).toBe('0.01');
  });

  it('adds flat and BPP fees; a zero-savings invoice can be flat fee only', () => {
    const r = calculateFee({ ...base, finalAppraised: '450000', flatFee: '150', bppFee: '250' });
    expect(r).toMatchObject({
      contingencyFee: '0.00',
      flatFee: '150.00',
      bppFee: '250.00',
      total: '400.00',
      isZeroSavings: true,
    });
    expect(r.explanation).toContain('Flat fee $150.00');
    expect(r.explanation).toContain('BPP rendition fee $250.00');
  });

  it('skips the flat fee outside the current billing year', () => {
    const r = calculateFee({ ...base, flatFee: '150', applyFlatFee: false });
    expect(r.flatFee).toBe('0.00');
    expect(r.total).toBe('258.00');
    expect(r.explanation).toContain('Flat fee not charged for this tax year');
  });

  it('handles very large commercial values exactly', () => {
    const r = calculateFee({
      ...base,
      noticeAppraised: '48000000',
      finalAppraised: '41000000',
      taxRatePct: '2.4567',
      contingencyPct: '25',
    });
    expect(r.taxableSavings).toBe('171969.00');
    expect(r.contingencyFee).toBe('42992.25');
  });
});

describe('resolveFeeTerms', () => {
  const firm = { defaultContingencyPct: '30', defaultFlatFee: '75', defaultBppFee: '300' };

  it('falls back to the firm defaults', () => {
    const t = resolveFeeTerms({ taxYear: {}, property: {}, client: {}, firm });
    expect(t.contingencyPct).toEqual({ value: '30', source: 'FIRM' });
    expect(t.flatFee).toEqual({ value: '75', source: 'FIRM' });
    expect(t.bppFee).toBeNull();
  });

  it('prefers tax year → property → client', () => {
    expect(
      resolveFeeTerms({
        taxYear: {},
        property: {},
        client: { contingencyPct: '35', flatFee: '100' },
        firm,
      }),
    ).toMatchObject({
      contingencyPct: { value: '35', source: 'CLIENT' },
      flatFee: { value: '100', source: 'CLIENT' },
    });
    expect(
      resolveFeeTerms({
        taxYear: {},
        property: { contingencyPct: '25', flatFee: '50' },
        client: { contingencyPct: '35' },
        firm,
      }),
    ).toMatchObject({
      contingencyPct: { source: 'PROPERTY' },
      flatFee: { value: '50', source: 'PROPERTY' },
    });
    expect(
      resolveFeeTerms({
        taxYear: { contingencyPctOverride: '20' },
        property: { contingencyPct: '25' },
        client: {},
        firm,
      }).contingencyPct,
    ).toEqual({ value: '20', source: 'TAX_YEAR' });
  });

  it('treats 0 as set and null/empty as unset', () => {
    expect(
      resolveFeeTerms({
        taxYear: { contingencyPctOverride: 0 },
        property: { contingencyPct: '25' },
        client: {},
        firm,
      }).contingencyPct,
    ).toEqual({ value: '0', source: 'TAX_YEAR' });
    expect(
      resolveFeeTerms({
        taxYear: { contingencyPctOverride: null },
        property: { contingencyPct: '' },
        client: {},
        firm,
      }).contingencyPct.source,
    ).toBe('FIRM');
  });

  it('applies a BPP fee only with a rendition or an explicit year fee', () => {
    expect(
      resolveFeeTerms({
        taxYear: { bppRenderedAt: '2026-04-01' },
        property: { bppFee: '500' },
        client: {},
        firm,
      }).bppFee,
    ).toEqual({ value: '500', source: 'PROPERTY' });
    expect(
      resolveFeeTerms({
        taxYear: { bppRenderedAt: new Date() },
        property: {},
        client: { bppFee: '350' },
        firm,
      }).bppFee,
    ).toEqual({ value: '350', source: 'CLIENT' });
    expect(
      resolveFeeTerms({ taxYear: { bppFee: '125' }, property: {}, client: {}, firm }).bppFee,
    ).toEqual({
      value: '125',
      source: 'TAX_YEAR',
    });
    expect(
      resolveFeeTerms({ taxYear: { bppRenderedAt: new Date() }, property: {}, client: {}, firm })
        .bppFee,
    ).toEqual({
      value: '300',
      source: 'FIRM',
    });
  });
});
