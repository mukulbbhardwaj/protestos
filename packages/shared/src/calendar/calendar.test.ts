import { describe, expect, it } from 'vitest';
import { buildICalendar, parseTime, zonedToUtc } from './index.js';

describe('zonedToUtc', () => {
  it('converts Central time with daylight saving', () => {
    expect(zonedToUtc('2026-06-15', '09:30').toISOString()).toBe('2026-06-15T14:30:00.000Z');
    expect(zonedToUtc('2026-01-15', '09:30').toISOString()).toBe('2026-01-15T15:30:00.000Z');
    expect(zonedToUtc('2026-03-08', '12:00').toISOString()).toBe('2026-03-08T17:00:00.000Z');
    expect(zonedToUtc('2026-06-15', '09:30', 'UTC').toISOString()).toBe('2026-06-15T09:30:00.000Z');
  });
});

describe('parseTime', () => {
  it('reads common spreadsheet times', () => {
    expect(parseTime('9:30 AM')).toBe('09:30');
    expect(parseTime('12:15 pm')).toBe('12:15');
    expect(parseTime('12 a.m.')).toBe('00:00');
    expect(parseTime('2pm')).toBe('14:00');
    expect(parseTime('14:05')).toBe('14:05');
    expect(parseTime('13 pm')).toBeNull();
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('soon')).toBeNull();
  });
});

describe('buildICalendar', () => {
  it('escapes text, folds long lines and marks cancellations', () => {
    const out = buildICalendar('Hearings; Jane', [
      {
        uid: 'h1@protestos',
        start: new Date('2026-06-15T14:30:00Z'),
        minutes: 30,
        summary: 'ARB hearing, Harris 0660640130020',
        description: `Line one\nLine two ${'x'.repeat(100)}`,
        location: 'HCAD, Room 4',
        updated: new Date('2026-06-01T00:00:00Z'),
      },
      {
        uid: 'h2@protestos',
        start: new Date('2026-06-16T14:30:00Z'),
        minutes: 15,
        summary: 'Informal',
        updated: new Date('2026-06-01T00:00:00Z'),
        cancelled: true,
      },
    ]);
    expect(out).toContain('X-WR-CALNAME:Hearings\\; Jane\r\n');
    expect(out).toContain('DTSTART:20260615T143000Z\r\nDTEND:20260615T150000Z');
    expect(out).toContain('SUMMARY:ARB hearing\\, Harris 0660640130020');
    expect(out).toContain('LOCATION:HCAD\\, Room 4');
    expect(out).toContain('DESCRIPTION:Line one\\nLine two');
    expect(out).toContain('\r\n x');
    expect(out).toContain('STATUS:CANCELLED');
    expect(out.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});
