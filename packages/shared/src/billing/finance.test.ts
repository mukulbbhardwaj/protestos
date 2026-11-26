import { describe, expect, it } from 'vitest';
import { addMoney, collectionRate, financePeriods, inRange, monthsEnding } from './finance.js';

describe('finance periods', () => {
  it('works out month, last month, YTD and last year', () => {
    expect(financePeriods('2026-03-15')).toEqual({
      thisMonth: { from: '2026-03-01', to: '2026-03-15' },
      lastMonth: { from: '2026-02-01', to: '2026-02-28' },
      ytd: { from: '2026-01-01', to: '2026-03-15' },
      lastYear: { from: '2025-01-01', to: '2025-12-31' },
    });
    expect(financePeriods('2026-01-10').lastMonth).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
  });
  it('lists months across a year boundary', () => {
    expect(monthsEnding('2026-02-10', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
  it('checks ranges and rates', () => {
    expect(inRange('2026-03-01', { from: '2026-03-01', to: '2026-03-31' })).toBe(true);
    expect(inRange(null, { from: '2026-03-01', to: '2026-03-31' })).toBe(false);
    expect(collectionRate('800.00', '580.00')).toBe('72.5');
    expect(collectionRate('3', '2')).toBe('66.7');
    expect(collectionRate('0', '10')).toBeNull();
    expect(addMoney('1.10', '2.25')).toBe('3.35');
  });
});
