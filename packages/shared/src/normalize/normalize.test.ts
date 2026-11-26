import { describe, expect, it } from 'vitest';
import {
  normalizeAccountNumber,
  normalizeEmail,
  normalizeHeader,
  normalizePhone,
  parseBoolean,
  parseChoice,
  parseDate,
  parseMoney,
  parsePercent,
  parseYear,
  splitCityStateZip,
} from './index.js';

describe('normalizeHeader', () => {
  it('makes header variants comparable', () => {
    expect(normalizeHeader('Client  #')).toBe('client');
    expect(normalizeHeader('client_no.')).toBe('client');
    expect(normalizeHeader('CLIENT Number')).toBe('client');
    expect(normalizeHeader('Contingency Fee Due:')).toBe('contingency fee due');
    expect(normalizeHeader('E-mail')).toBe('e mail');
  });
});

describe('normalizeAccountNumber', () => {
  it('requires a value', () => {
    expect(normalizeAccountNumber('  ')).toEqual({
      ok: false,
      error: 'Enter the CAD account number.',
    });
  });

  it('keeps punctuation and leading zeros for counties without a known format', () => {
    expect(normalizeAccountNumber(' r-0780-000 1650-1 ', 'Collin')).toEqual({
      ok: true,
      value: 'R-0780-0001650-1',
    });
    expect(normalizeAccountNumber('00123', null)).toEqual({ ok: true, value: '00123' });
  });

  it('compacts Harris accounts and restores dropped leading zeros', () => {
    expect(normalizeAccountNumber('066-064-013-0020', 'Harris')).toEqual({
      ok: true,
      value: '0660640130020',
    });
    expect(normalizeAccountNumber('660640130020', 'harris')).toEqual({
      ok: true,
      value: '0660640130020',
      warning: 'Leading zeros restored: 0660640130020.',
    });
  });

  it('warns when a known format has the wrong length', () => {
    const r = normalizeAccountNumber('12345678901234', 'Harris');
    expect(r).toMatchObject({ ok: true, value: '12345678901234' });
    expect(r.ok && r.warning).toMatch(/usually 13 characters; this one has 14/);
    expect(normalizeAccountNumber('00000776533000000', 'Dallas')).toEqual({
      ok: true,
      value: '00000776533000000',
    });
    expect(normalizeAccountNumber('1234', 'Tarrant')).toMatchObject({ value: '00001234' });
  });
});

describe('contact details', () => {
  it('normalizes emails', () => {
    expect(normalizeEmail(' Jane@Example.COM ')).toEqual({ ok: true, value: 'jane@example.com' });
    expect(normalizeEmail('jane@')).toMatchObject({ ok: false });
  });

  it('turns US phone numbers into E.164', () => {
    expect(normalizePhone('(281) 555-1234')).toEqual({ ok: true, value: '+12815551234' });
    expect(normalizePhone('1-281-555-1234')).toEqual({ ok: true, value: '+12815551234' });
    expect(normalizePhone('281.555.1234 ext. 12')).toEqual({ ok: true, value: '+12815551234' });
    expect(normalizePhone('555-1234')).toMatchObject({ ok: true, value: '555-1234' });
    expect(normalizePhone('555-1234').ok && normalizePhone('555-1234')).toHaveProperty('warning');
  });

  it('splits city, state and ZIP', () => {
    expect(splitCityStateZip('HOUSTON, TX 77002-1234')).toEqual({
      ok: true,
      value: { city: 'HOUSTON', state: 'TX', zip: '77002' },
    });
    expect(splitCityStateZip('Sugar Land tx. 77479')).toEqual({
      ok: true,
      value: { city: 'Sugar Land', state: 'TX', zip: '77479' },
    });
    expect(splitCityStateZip('Houston')).toMatchObject({ ok: false });
  });
});

describe('parseMoney', () => {
  it('reads amounts with symbols and separators', () => {
    expect(parseMoney('$1,234.56')).toEqual({ ok: true, value: '1234.56' });
    expect(parseMoney('450000')).toEqual({ ok: true, value: '450000' });
    expect(parseMoney('12.5')).toEqual({ ok: true, value: '12.5' });
  });

  it('rounds past the cent with a warning', () => {
    expect(parseMoney('10.005')).toMatchObject({ ok: true, value: '10.01' });
  });

  it('refuses negatives and text', () => {
    expect(parseMoney('(1,234)')).toMatchObject({ ok: false });
    expect(parseMoney('-5')).toMatchObject({ ok: false });
    expect(parseMoney('$-5')).toMatchObject({ ok: false });
    expect(parseMoney('n/a')).toMatchObject({ ok: false });
  });
});

describe('parsePercent', () => {
  it('reads percentages', () => {
    expect(parsePercent('30%')).toEqual({ ok: true, value: '30' });
    expect(parsePercent(' 2.15 ')).toEqual({ ok: true, value: '2.15' });
    expect(parsePercent('0.5%')).toEqual({ ok: true, value: '0.5' });
    expect(parsePercent('0')).toEqual({ ok: true, value: '0' });
  });

  it('reads a bare fraction as a percentage, with a warning', () => {
    expect(parsePercent('0.3')).toEqual({
      ok: true,
      value: '30',
      warning: '"0.3" was read as 30%.',
    });
    expect(parsePercent('0.3', { allowFraction: false })).toEqual({ ok: true, value: '0.3' });
  });

  it('refuses text and more than 100%', () => {
    expect(parsePercent('thirty')).toMatchObject({ ok: false });
    expect(parsePercent('150')).toMatchObject({ ok: false });
  });
});

describe('parseDate', () => {
  it.each([
    ['04/15/2026', '2026-04-15'],
    ['4/5/26', '2026-04-05'],
    ['4-5-99', '1999-04-05'],
    ['2026-04-15', '2026-04-15'],
    ['2026-04-15T00:00:00Z', '2026-04-15'],
    ['Apr 15, 2026', '2026-04-15'],
    ['April 15 2026', '2026-04-15'],
    ['15-Apr-2026', '2026-04-15'],
    ['15 April 2026', '2026-04-15'],
  ])('%s → %s', (raw, iso) => {
    expect(parseDate(raw)).toEqual({ ok: true, value: iso });
  });

  it('reads Excel serial dates, with a warning', () => {
    expect(parseDate('46127')).toMatchObject({ ok: true, value: '2026-04-15' });
  });

  it('refuses impossible and unreadable dates', () => {
    expect(parseDate('02/30/2026')).toEqual({
      ok: false,
      error: '2/30/2026 isn’t a real date.'.replace('’', "'"),
    });
    expect(parseDate('Foo 15, 2026')).toMatchObject({ ok: false });
    expect(parseDate('15-Foo-2026')).toMatchObject({ ok: false });
    expect(parseDate('soon')).toMatchObject({ ok: false });
  });
});

describe('parseBoolean, parseYear, parseChoice', () => {
  it('reads yes/no', () => {
    for (const v of ['Y', 'yes', 'TRUE', '1', 'x'])
      expect(parseBoolean(v)).toEqual({ ok: true, value: true });
    for (const v of ['n', 'No', 'false', '0'])
      expect(parseBoolean(v)).toEqual({ ok: true, value: false });
    expect(parseBoolean('maybe')).toMatchObject({ ok: false });
  });

  it('reads tax years', () => {
    expect(parseYear('2026')).toEqual({ ok: true, value: 2026 });
    expect(parseYear('1999')).toMatchObject({ ok: false });
    expect(parseYear('26')).toMatchObject({ ok: false });
  });

  it('matches choices by code, label or alias', () => {
    const types = ['RESIDENTIAL', 'COMMERCIAL'] as const;
    expect(parseChoice('residential', types)).toEqual({ ok: true, value: 'RESIDENTIAL' });
    expect(parseChoice('Res', types, { RES: 'RESIDENTIAL' })).toEqual({
      ok: true,
      value: 'RESIDENTIAL',
    });
    expect(parseChoice('farm', types)).toEqual({
      ok: false,
      error: '"farm" isn\'t one of: residential, commercial.',
    });
  });
});

describe('parseCsv / toCsvLine', () => {
  it('parses quoted fields, CRLF, a BOM, and skips blank rows', async () => {
    const { parseCsv } = await import('./index.js');
    expect(
      parseCsv('﻿Name,Note\r\n"Smith, Jane","She said ""hi""\nthen left"\r\n\r\n,\nBob,x'),
    ).toEqual([
      ['Name', 'Note'],
      ['Smith, Jane', 'She said "hi"\nthen left'],
      ['Bob', 'x'],
    ]);
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a,b\r1,')).toEqual([
      ['a', 'b'],
      ['1', ''],
    ]);
  });

  it('writes lines with quoting where needed', async () => {
    const { toCsvLine } = await import('./index.js');
    expect(toCsvLine(['plain', 'a,b', 'say "hi"', 'two\nlines'])).toBe(
      'plain,"a,b","say ""hi""","two\nlines"',
    );
  });
});
