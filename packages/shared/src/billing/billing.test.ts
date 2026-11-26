import { describe, expect, it } from 'vitest';
import {
  addDays,
  agingBucket,
  allocateOldestFirst,
  checkAllocations,
  chooseTemplate,
  deriveInvoiceStatus,
  formatInvoiceNumber,
  isPastDue,
  sumMoney,
} from './index.js';

describe('deriveInvoiceStatus', () => {
  it('keeps hand-set statuses', () => {
    expect(deriveInvoiceStatus('DRAFT', '10', '10')).toBe('DRAFT');
    expect(deriveInvoiceStatus('VOID', '10', '0')).toBe('VOID');
    expect(deriveInvoiceStatus('WRITTEN_OFF', '10', '5')).toBe('WRITTEN_OFF');
  });
  it('derives from what is paid', () => {
    expect(deriveInvoiceStatus('ISSUED', '100.00', '0')).toBe('ISSUED');
    expect(deriveInvoiceStatus('ISSUED', '100.00', '0.01')).toBe('PARTIALLY_PAID');
    expect(deriveInvoiceStatus('PARTIALLY_PAID', '100.00', '100')).toBe('PAID');
    expect(deriveInvoiceStatus('PAID', '100.00', '40')).toBe('PARTIALLY_PAID');
  });
});

describe('past due and aging', () => {
  it('only open invoices are past due', () => {
    expect(isPastDue('ISSUED', '2026-03-01', '2026-03-02')).toBe(true);
    expect(isPastDue('ISSUED', '2026-03-02', '2026-03-02')).toBe(false);
    expect(isPastDue('PAID', '2026-03-01', '2026-03-02')).toBe(false);
    expect(isPastDue('ISSUED', null, '2026-03-02')).toBe(false);
  });
  it('buckets by days past due', () => {
    expect(agingBucket(null, '2026-03-31')).toBe('NOT_DUE');
    expect(agingBucket('2026-03-31', '2026-03-31')).toBe('NOT_DUE');
    expect(agingBucket('2026-03-01', '2026-03-31')).toBe('0-30');
    expect(agingBucket('2026-03-01', '2026-04-01')).toBe('31-60');
    expect(agingBucket('2026-01-01', '2026-03-31')).toBe('61-90');
    expect(agingBucket('2025-12-31', '2026-04-01')).toBe('90+');
  });
});

describe('allocateOldestFirst', () => {
  const open = [
    { id: 3, balance: '50.00', dueDate: '2026-05-01', issueDate: '2026-04-01' },
    { id: 1, balance: '100.00', dueDate: '2026-04-01', issueDate: '2026-03-01' },
    { id: 2, balance: '0', dueDate: '2026-03-01', issueDate: null },
    { id: 4, balance: '20.00', dueDate: null, issueDate: null },
  ];
  it('pays the oldest first and leaves the rest as credit', () => {
    expect(allocateOldestFirst('120', open)).toEqual({
      allocations: [
        { invoiceId: 1, amount: '100.00' },
        { invoiceId: 3, amount: '20.00' },
      ],
      unallocated: '0.00',
    });
    expect(allocateOldestFirst('200', open).unallocated).toBe('30.00');
  });
  it('breaks ties by id', () => {
    const r = allocateOldestFirst('5', [
      { id: 9, balance: '5', dueDate: null, issueDate: null },
      { id: 8, balance: '5', dueDate: null, issueDate: null },
    ]);
    expect(r.allocations).toEqual([{ invoiceId: 8, amount: '5.00' }]);
  });
});

describe('checkAllocations', () => {
  const balances = new Map<number, string>([
    [1, '100.00'],
    [2, '50.00'],
  ]);
  it('accepts allocations within balances and the payment', () => {
    expect(
      checkAllocations(
        '150',
        [
          { invoiceId: 1, amount: '100' },
          { invoiceId: 2, amount: '50' },
        ],
        balances,
      ),
    ).toBeNull();
  });
  it('explains each problem', () => {
    expect(
      checkAllocations(
        '10',
        [
          { invoiceId: 1, amount: '5' },
          { invoiceId: 1, amount: '5' },
        ],
        balances,
      ),
    ).toMatch(/once/);
    expect(checkAllocations('10', [{ invoiceId: 7, amount: '5' }], balances)).toMatch(/isn't open/);
    expect(checkAllocations('10', [{ invoiceId: 1, amount: '0' }], balances)).toMatch(
      /more than zero/,
    );
    expect(checkAllocations('500', [{ invoiceId: 2, amount: '60' }], balances)).toBe(
      "That's more than the invoice's balance of $50.00.",
    );
    expect(checkAllocations('40', [{ invoiceId: 1, amount: '50' }], balances)).toMatch(
      /more than the payment/,
    );
  });
});

describe('chooseTemplate', () => {
  it('picks zero savings when nothing is contingency', () => {
    expect(
      chooseTemplate([
        { kind: 'FLAT', amount: '150' },
        { kind: 'CONTINGENCY', amount: '0' },
      ]),
    ).toBe('ZERO_SAVINGS');
  });
  it('picks arbitration, homestead or standard', () => {
    expect(chooseTemplate([{ kind: 'CONTINGENCY', amount: '10', underArbitration: true }])).toBe(
      'ARBITRATION',
    );
    expect(
      chooseTemplate([
        { kind: 'CONTINGENCY', amount: '10', homestead: true },
        { kind: 'ADJUSTMENT', amount: '-5' },
      ]),
    ).toBe('HOMESTEAD');
    expect(
      chooseTemplate([
        { kind: 'CONTINGENCY', amount: '10', homestead: true },
        { kind: 'BPP', amount: '5' },
      ]),
    ).toBe('STANDARD');
    expect(chooseTemplate([])).toBe('STANDARD');
  });
});

describe('helpers', () => {
  it('formats numbers, dates and sums', () => {
    expect(formatInvoiceNumber('INV-', 42)).toBe('INV-0042');
    expect(formatInvoiceNumber('LS', 12345)).toBe('LS12345');
    expect(addDays('2026-12-15', 30)).toBe('2027-01-14');
    expect(sumMoney(['10.10', '-0.10', '5'])).toBe('15.00');
  });
});
