import { describe, expect, it } from 'vitest';
import { formatDate, formatMoney } from './format';
import { initials } from './utils';

describe('formatters', () => {
  it('formats money as $1,234.56', () => {
    expect(formatMoney('1234.5')).toBe('$1,234.50');
    expect(formatMoney(0)).toBe('$0.00');
  });

  it('formats dates as MM/DD/YYYY in the org timezone', () => {
    // 03:00 UTC on Jan 2 is still Jan 1 in Texas.
    expect(formatDate('2026-01-02T03:00:00Z')).toBe('01/01/2026');
    expect(formatDate(null)).toBe('—');
  });

  it('builds initials', () => {
    expect(initials('Olivia Owner')).toBe('OO');
    expect(initials('Cher')).toBe('C');
  });
});
