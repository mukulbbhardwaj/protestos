import { describe, expect, it } from 'vitest';
import { parseCsv } from '../normalize/index.js';
import { autoMapColumns, importFields, SAMPLE_CSVS } from './fields.js';

describe('autoMapColumns', () => {
  it('maps the reference firm’s headers', () => {
    const mapping = autoMapColumns('CONTACTS_PROPERTIES', [
      'CLIENT  Number #',
      'CLIENT NAME',
      'Email Address',
      'PHONE NUMBER',
      'MAILING ADDRESS',
      'MAILING ADDRESS CITY, TX ZIP',
      'Contingency Fee Due:',
      'CAD COUNTY',
      'Account Number',
      'Physical or Situs Address of Property',
      'Something else',
    ]);
    expect(mapping).toEqual({
      'CLIENT  Number #': 'clientNumber',
      'CLIENT NAME': 'displayName',
      'Email Address': 'email',
      'PHONE NUMBER': 'phone',
      'MAILING ADDRESS': 'mailingLine1',
      'MAILING ADDRESS CITY, TX ZIP': 'mailingCityStateZip',
      'Contingency Fee Due:': 'contingencyPct',
      'CAD COUNTY': 'county',
      'Account Number': 'accountNumber',
      'Physical or Situs Address of Property': 'situsLine1',
      'Something else': null,
    });
  });

  it('uses each field once and lets a saved mapping win', () => {
    expect(autoMapColumns('TAX_YEAR_VALUES', ['Notes', 'Comments'])).toEqual({
      Notes: 'notes',
      Comments: null,
    });
    expect(
      autoMapColumns('TAX_YEAR_VALUES', ['Value 1', 'Year'], {
        'value  1': 'finalMarket',
        Year: 'nope',
      }),
    ).toEqual({ 'Value 1': 'finalMarket', Year: 'taxYear' });
  });

  it('maps every column of the sample files', () => {
    for (const kind of ['CONTACTS_PROPERTIES', 'TAX_YEAR_VALUES'] as const) {
      const [headers] = parseCsv(SAMPLE_CSVS[kind]);
      expect(Object.values(autoMapColumns(kind, headers!))).not.toContain(null);
    }
    expect(importFields('HISTORICAL_INVOICES')).toEqual([]);
  });
});
