import { normalizeHeader } from '../normalize/index.js';

// What each import type can fill in, and the header names firms actually use for each
// (BUILD_PLAN 8.9; synonyms from the reference firm's exports). Auto-mapping compares
// normalized headers against these.

export const IMPORT_KINDS = [
  'CONTACTS_PROPERTIES',
  'TAX_YEAR_VALUES',
  'HISTORICAL_INVOICES',
] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
/** Kinds that can be imported now; historical invoices need invoices (M4). */
export const AVAILABLE_IMPORT_KINDS: readonly ImportKind[] = [
  'CONTACTS_PROPERTIES',
  'TAX_YEAR_VALUES',
];

export type ImportFieldType =
  | 'text'
  | 'email'
  | 'phone'
  | 'money'
  | 'percent'
  | 'date'
  | 'boolean'
  | 'year'
  | 'choice'
  | 'account'
  | 'county'
  | 'cityStateZip';

export interface ImportField {
  key: string;
  label: string;
  type: ImportFieldType;
  /** Grouping in the mapping screen. */
  group: string;
  /** A row can't be imported without it (after matching rules). */
  required?: boolean;
  /** Header names that map here automatically (compared after normalizeHeader). */
  synonyms: string[];
  /** Shown under the field in the mapping screen. */
  hint?: string;
}

const CONTACT = 'Client';
const PROPERTY = 'Property';
const YEAR = 'Tax year';

export const IMPORT_FIELDS: Record<Exclude<ImportKind, 'HISTORICAL_INVOICES'>, ImportField[]> = {
  CONTACTS_PROPERTIES: [
    {
      key: 'clientNumber',
      label: 'Client number',
      type: 'text',
      group: CONTACT,
      synonyms: ['client', 'client id', 'client #', 'customer', 'customer id'],
      hint: 'Matches existing clients first; new clients get the next number when blank.',
    },
    {
      key: 'displayName',
      label: 'Client name',
      type: 'text',
      group: CONTACT,
      synonyms: ['client name', 'name', 'owner', 'owner name', 'customer name', 'full name'],
      hint: 'Required for a new client.',
    },
    {
      key: 'kind',
      label: 'Client or prospect',
      type: 'choice',
      group: CONTACT,
      synonyms: ['type', 'kind', 'client or prospect', 'status'],
      hint: 'Defaults to client.',
    },
    {
      key: 'entityType',
      label: 'Individual or company',
      type: 'choice',
      group: CONTACT,
      synonyms: ['entity', 'entity type', 'type of acct', 'account type', 'ownership type'],
    },
    {
      key: 'email',
      label: 'Email',
      type: 'email',
      group: CONTACT,
      synonyms: ['email', 'email address', 'e mail'],
      hint: 'Matches existing clients when there is no client number.',
    },
    {
      key: 'billingEmail',
      label: 'Billing email',
      type: 'email',
      group: CONTACT,
      synonyms: ['billing email', 'invoice email'],
    },
    {
      key: 'phone',
      label: 'Phone',
      type: 'phone',
      group: CONTACT,
      synonyms: ['phone', 'telephone', 'contact', 'mobile', 'cell', 'phone number'],
    },
    {
      key: 'mailingLine1',
      label: 'Mailing address',
      type: 'text',
      group: CONTACT,
      synonyms: [
        'mailing address',
        'mail address',
        'address',
        'street',
        'address 1',
        'mailing address 1',
      ],
    },
    {
      key: 'mailingLine2',
      label: 'Mailing address line 2',
      type: 'text',
      group: CONTACT,
      synonyms: ['address 2', 'mailing address 2', 'suite', 'unit'],
    },
    {
      key: 'mailingCity',
      label: 'Mailing city',
      type: 'text',
      group: CONTACT,
      synonyms: ['city', 'mailing city', 'mail city'],
    },
    {
      key: 'mailingState',
      label: 'Mailing state',
      type: 'text',
      group: CONTACT,
      synonyms: ['state', 'mailing state', 'st'],
    },
    {
      key: 'mailingZip',
      label: 'Mailing ZIP',
      type: 'text',
      group: CONTACT,
      synonyms: ['zip', 'zip code', 'mailing zip', 'postal code'],
    },
    {
      key: 'mailingCityStateZip',
      label: 'Mailing city, state ZIP (one column)',
      type: 'cityStateZip',
      group: CONTACT,
      synonyms: [
        'city state zip',
        'city zip code',
        'city tx zip',
        'mailing address city tx zip',
        'city state',
      ],
    },
    {
      key: 'nameOnCad',
      label: 'Name on CAD',
      type: 'text',
      group: CONTACT,
      synonyms: ['cad name', 'name on cad', 'owner on cad'],
    },
    {
      key: 'contingencyPct',
      label: 'Contingency %',
      type: 'percent',
      group: CONTACT,
      synonyms: [
        'contingency',
        'contingency fee',
        'contingency fee due',
        'contingency pct',
        'contingency percent',
        'fee percent',
      ],
    },
    {
      key: 'flatFee',
      label: 'Flat fee',
      type: 'money',
      group: CONTACT,
      synonyms: ['flat fee', 'flat'],
    },
    {
      key: 'bppFee',
      label: 'BPP fee',
      type: 'money',
      group: CONTACT,
      synonyms: ['bpp fee', 'bpp'],
    },
    {
      key: 'notes',
      label: 'Client notes',
      type: 'text',
      group: CONTACT,
      synonyms: ['notes', 'client notes', 'comments'],
    },
    {
      key: 'county',
      label: 'County',
      type: 'county',
      group: PROPERTY,
      synonyms: ['county', 'cad county', 'cad', 'appraisal district'],
      hint: 'Needed with an account number to add a property.',
    },
    {
      key: 'accountNumber',
      label: 'CAD account number',
      type: 'account',
      group: PROPERTY,
      synonyms: [
        'account',
        'account number',
        'cad account',
        'acct',
        'acct #',
        'property id',
        'prop id',
        'geo id',
        'quick ref id',
      ],
    },
    {
      key: 'situsLine1',
      label: 'Property address',
      type: 'text',
      group: PROPERTY,
      synonyms: [
        'property address',
        'property addresses',
        'situs',
        'situs address',
        'physical address',
        'physical or situs address of property',
        'site address',
      ],
    },
    {
      key: 'situsCity',
      label: 'Property city',
      type: 'text',
      group: PROPERTY,
      synonyms: ['property city', 'situs city', 'cad city'],
    },
    {
      key: 'situsZip',
      label: 'Property ZIP',
      type: 'text',
      group: PROPERTY,
      synonyms: ['property zip', 'situs zip', 'cad zip code', 'cad zip'],
    },
    {
      key: 'propertyType',
      label: 'Property type',
      type: 'choice',
      group: PROPERTY,
      synonyms: ['property type', 'prop type', 'property class'],
    },
    {
      key: 'consultantEmail',
      label: 'Consultant (email)',
      type: 'email',
      group: PROPERTY,
      synonyms: ['consultant', 'consultant email', 'assigned to', 'agent'],
      hint: 'Must be an active member of your firm.',
    },
    {
      key: 'propertyContingencyPct',
      label: 'Property contingency %',
      type: 'percent',
      group: PROPERTY,
      synonyms: ['property contingency', 'property contingency pct'],
    },
    {
      key: 'propertyFlatFee',
      label: 'Property flat fee',
      type: 'money',
      group: PROPERTY,
      synonyms: ['property flat fee'],
    },
    {
      key: 'propertyBppFee',
      label: 'Property BPP fee',
      type: 'money',
      group: PROPERTY,
      synonyms: ['property bpp fee'],
    },
    {
      key: 'propertyNotes',
      label: 'Property notes',
      type: 'text',
      group: PROPERTY,
      synonyms: ['property notes'],
    },
  ],
  TAX_YEAR_VALUES: [
    {
      key: 'county',
      label: 'County',
      type: 'county',
      group: PROPERTY,
      required: true,
      synonyms: ['county', 'cad county', 'cad', 'appraisal district'],
    },
    {
      key: 'accountNumber',
      label: 'CAD account number',
      type: 'account',
      group: PROPERTY,
      required: true,
      synonyms: [
        'account',
        'account number',
        'cad account',
        'acct',
        'acct #',
        'property id',
        'prop id',
        'geo id',
        'quick ref id',
      ],
    },
    {
      key: 'taxYear',
      label: 'Tax year',
      type: 'year',
      group: YEAR,
      required: true,
      synonyms: ['tax year', 'year', 'yr'],
    },
    {
      key: 'noticeLand',
      label: 'Notice land',
      type: 'money',
      group: YEAR,
      synonyms: ['notice land', 'noticed land', 'land notice'],
    },
    {
      key: 'noticeImprovement',
      label: 'Notice improvement',
      type: 'money',
      group: YEAR,
      synonyms: ['notice improvement', 'noticed improvement', 'improvement notice', 'notice impr'],
    },
    {
      key: 'noticeMarket',
      label: 'Notice market',
      type: 'money',
      group: YEAR,
      synonyms: [
        'notice market',
        'noticed market',
        'notice value',
        'noticed value',
        'market notice',
      ],
    },
    {
      key: 'noticeAppraised',
      label: 'Notice appraised',
      type: 'money',
      group: YEAR,
      synonyms: ['notice appraised', 'noticed appraised', 'appraised notice'],
    },
    { key: 'finalLand', label: 'Final land', type: 'money', group: YEAR, synonyms: ['final land'] },
    {
      key: 'finalImprovement',
      label: 'Final improvement',
      type: 'money',
      group: YEAR,
      synonyms: ['final improvement', 'final impr'],
    },
    {
      key: 'finalMarket',
      label: 'Final market',
      type: 'money',
      group: YEAR,
      synonyms: ['final market', 'final value', 'settled value', 'settlement value'],
    },
    {
      key: 'finalAppraised',
      label: 'Final appraised',
      type: 'money',
      group: YEAR,
      synonyms: ['final appraised', 'appraised final'],
    },
    {
      key: 'taxRatePct',
      label: 'Combined tax rate %',
      type: 'percent',
      group: YEAR,
      synonyms: ['tax rate', 'combined rate', 'combined tax rate', 'rate'],
    },
    {
      key: 'homestead',
      label: 'Homestead',
      type: 'boolean',
      group: YEAR,
      synonyms: ['homestead', 'hs', 'homestead exemption'],
    },
    {
      key: 'underLitigation',
      label: 'Under litigation',
      type: 'boolean',
      group: YEAR,
      synonyms: ['litigation', 'under litigation'],
    },
    {
      key: 'underArbitration',
      label: 'Under arbitration',
      type: 'boolean',
      group: YEAR,
      synonyms: ['arbitration', 'under arbitration'],
    },
    {
      key: 'protestStage',
      label: 'Protest stage',
      type: 'choice',
      group: YEAR,
      synonyms: ['stage', 'protest stage', 'protest status'],
    },
    {
      key: 'noticeReceivedAt',
      label: 'Notice received',
      type: 'date',
      group: YEAR,
      synonyms: ['notice received', 'notice date', 'notice received date'],
    },
    {
      key: 'protestFiledAt',
      label: 'Protest filed',
      type: 'date',
      group: YEAR,
      synonyms: ['protest filed', 'filed', 'filed date', 'protest date'],
    },
    {
      key: 'resultType',
      label: 'Result',
      type: 'choice',
      group: YEAR,
      synonyms: ['result', 'outcome', 'result type'],
    },
    {
      key: 'resultAt',
      label: 'Result date',
      type: 'date',
      group: YEAR,
      synonyms: ['result date', 'settlement date', 'outcome date'],
    },
    {
      key: 'bppRenderedAt',
      label: 'BPP rendition date',
      type: 'date',
      group: YEAR,
      synonyms: ['rendition date', 'bpp rendered', 'bpp rendition'],
    },
    {
      key: 'bppFee',
      label: 'BPP fee (this year)',
      type: 'money',
      group: YEAR,
      synonyms: ['bpp fee', 'bpp'],
    },
    {
      key: 'contingencyPctOverride',
      label: 'Contingency % (this year)',
      type: 'percent',
      group: YEAR,
      synonyms: ['contingency override', 'year contingency'],
    },
    { key: 'notes', label: 'Notes', type: 'text', group: YEAR, synonyms: ['notes', 'comments'] },
  ],
};

export function importFields(kind: ImportKind): ImportField[] {
  return kind === 'HISTORICAL_INVOICES' ? [] : IMPORT_FIELDS[kind];
}

/**
 * Header → field key. A saved mapping wins (by normalized header); otherwise the first unused
 * field whose synonym matches. Unmatched headers map to null (ignored).
 */
export function autoMapColumns(
  kind: ImportKind,
  headers: readonly string[],
  saved: Record<string, string> = {},
): Record<string, string | null> {
  const fields = importFields(kind);
  const keys = new Set(fields.map((f) => f.key));
  const savedByNorm = new Map(Object.entries(saved).map(([h, k]) => [normalizeHeader(h), k]));
  const used = new Set<string>();
  const mapping: Record<string, string | null> = {};
  for (const header of headers) {
    const norm = normalizeHeader(header);
    const remembered = savedByNorm.get(norm);
    let key: string | null =
      remembered && keys.has(remembered) && !used.has(remembered) ? remembered : null;
    if (!key) {
      key =
        fields.find((f) => !used.has(f.key) && f.synonyms.some((s) => normalizeHeader(s) === norm))
          ?.key ?? null;
    }
    if (key) used.add(key);
    mapping[header] = key;
  }
  return mapping;
}

/** A small sample file per import type: the header row and two example rows. */
export const SAMPLE_CSVS: Record<Exclude<ImportKind, 'HISTORICAL_INVOICES'>, string> = {
  CONTACTS_PROPERTIES: [
    'Client Number,Client Name,Email,Phone,Mailing Address,"City, State ZIP",Contingency Fee,Flat Fee,County,Account Number,Property Address,Property Type',
    '1042,Jane Smith,jane@example.com,(281) 555-1234,123 Main St,"Houston, TX 77002",30%,,Harris,0660640130020,1700 St Charles St,Residential',
    '1042,Jane Smith,jane@example.com,(281) 555-1234,123 Main St,"Houston, TX 77002",30%,,Fort Bend,R267426,9607 Tree Sparrow Ln,Residential',
    ',Acme Holdings LLC,ap@acme.example,713-555-0100,500 Commerce St,"Houston, TX 77002",25%,$150.00,Harris,1165880010001,10470 W Bellfort St,Commercial',
  ].join('\n'),
  TAX_YEAR_VALUES: [
    'County,Account Number,Tax Year,Notice Market,Notice Appraised,Final Market,Final Appraised,Tax Rate,Homestead,Notice Received,Protest Filed,Stage',
    'Harris,0660640130020,2026,"$524,819","$376,607","$489,000","$376,607",2.15%,Yes,04/17/2026,05/01/2026,Settled',
    'Fort Bend,R267426,2026,"$273,584","$273,584","$255,000","$255,000",2.36,Yes,04/10/2026,05/02/2026,Protest filed',
  ].join('\n'),
};
