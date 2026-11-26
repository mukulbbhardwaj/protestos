import { SAMPLE_CSVS } from '@app/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  createUser,
  login,
  makeTestApp,
  ownerWithOrg,
  resetDb,
  type TestContext,
} from './helpers.js';

let t: TestContext;
let cookie: string;
let slug: string;
let orgId: number;

beforeAll(async () => {
  t = await makeTestApp();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDb();
  const o = await ownerWithOrg(t.app, 'owner@example.com', 'Firm');
  cookie = o.cookie;
  slug = o.org.slug;
  orgId = o.org.id;
  await t.prisma.county.createMany({
    data: [
      { state: 'TX', name: 'Harris', cadName: 'Harris CAD' },
      { state: 'TX', name: 'Fort Bend', cadName: 'Fort Bend CAD' },
    ],
  });
});

const req = (method: 'GET' | 'POST' | 'PATCH', path: string, payload?: object, c = cookie) =>
  t.app.inject({
    method,
    url: `/orgs/${slug}${path}`,
    headers: { cookie: c },
    ...(payload ? { payload } : {}),
  });

const upload = (kind: string, csv: string, fileName = 'clients.csv', c = cookie) =>
  t.app.inject({
    method: 'POST',
    url: `/orgs/${slug}/imports?kind=${kind}&fileName=${encodeURIComponent(fileName)}`,
    headers: { cookie: c, 'content-type': 'text/csv' },
    payload: csv,
  });

/** Upload → dry run → run; returns the job id and both summaries. */
async function importFile(kind: string, csv: string) {
  const up = await upload(kind, csv);
  expect(up.statusCode).toBe(201);
  const id = up.json().id as number;
  const preview = await req('POST', `/imports/${id}/preview`);
  expect(preview.statusCode).toBe(200);
  const run = await req('POST', `/imports/${id}/run`);
  expect(run.statusCode).toBe(202);
  const done = (await req('GET', `/imports/${id}`)).json();
  return { id, preview: preview.json().summary, done };
}

describe('CSV imports', () => {
  it('imports the sample clients file, and a second import of it changes nothing', async () => {
    const up = await upload('CONTACTS_PROPERTIES', SAMPLE_CSVS.CONTACTS_PROPERTIES);
    expect(up.json()).toMatchObject({
      status: 'UPLOADED',
      rowCount: 3,
      columnMapping: expect.objectContaining({
        'Client Number': 'clientNumber',
        'Account Number': 'accountNumber',
      }),
    });
    expect(up.json().sample).toHaveLength(3);

    const first = await importFile('CONTACTS_PROPERTIES', SAMPLE_CSVS.CONTACTS_PROPERTIES);
    expect(first.preview).toEqual({ CREATE: 3, UPDATE: 0, UNCHANGED: 0, ERROR: 0 });
    expect(first.done).toMatchObject({ status: 'DONE', phase: 'APPLY', summary: first.preview });

    const jane = await t.prisma.contact.findFirstOrThrow({
      where: { orgId, clientNumber: '1042' },
      include: { properties: { include: { county: true } } },
    });
    expect(jane).toMatchObject({
      kind: 'CLIENT',
      source: 'IMPORT',
      email: 'jane@example.com',
      phone: '+12815551234',
      mailingAddress: { line1: '123 Main St', city: 'Houston', state: 'TX', zip: '77002' },
    });
    expect(jane.contingencyPct?.toString()).toBe('30');
    expect(jane.properties.map((p) => [p.county.name, p.accountNumber]).sort()).toEqual([
      ['Fort Bend', 'R267426'],
      ['Harris', '0660640130020'],
    ]);
    // The client without a number got the firm's next one.
    const acme = await t.prisma.contact.findFirstOrThrow({
      where: { orgId, displayName: 'Acme Holdings LLC' },
    });
    expect(acme.clientNumber).toBe('1001');
    expect(acme.flatFee?.toString()).toBe('150');
    const commercial = await t.prisma.property.findFirstOrThrow({ where: { contactId: acme.id } });
    expect(commercial.propertyType).toBe('COMMERCIAL');

    // BUILD_PLAN M3: importing it again makes zero changes.
    const counts = async () => [
      await t.prisma.contact.count({ where: { orgId } }),
      await t.prisma.property.count({ where: { orgId } }),
    ];
    const before = await counts();
    const again = await importFile('CONTACTS_PROPERTIES', SAMPLE_CSVS.CONTACTS_PROPERTIES);
    expect(again.preview).toEqual({ CREATE: 0, UPDATE: 0, UNCHANGED: 3, ERROR: 0 });
    expect(again.done.summary).toEqual(again.preview);
    expect(await counts()).toEqual(before);
    expect(await t.prisma.auditLog.count({ where: { orgId, action: 'import.completed' } })).toBe(2);
  });

  it('updates only what changed, and never erases a value with a blank cell', async () => {
    await importFile('CONTACTS_PROPERTIES', SAMPLE_CSVS.CONTACTS_PROPERTIES);
    const csv = [
      'Client Number,Client Name,Email,Phone,Contingency Fee',
      '1042,Jane Smith,,(281) 555-9999,',
    ].join('\n');
    const { id, preview } = await importFile('CONTACTS_PROPERTIES', csv);
    expect(preview).toEqual({ CREATE: 0, UPDATE: 1, UNCHANGED: 0, ERROR: 0 });
    const rows = (await req('GET', `/imports/${id}/rows`)).json();
    expect(rows.items[0]).toMatchObject({ action: 'UPDATE', changes: ['phone'] });
    const jane = await t.prisma.contact.findFirstOrThrow({
      where: { orgId, clientNumber: '1042' },
    });
    expect(jane).toMatchObject({ phone: '+12815559999', email: 'jane@example.com' });
    expect(jane.contingencyPct?.toString()).toBe('30');
  });

  it('imports tax-year values onto existing properties, idempotently', async () => {
    await importFile('CONTACTS_PROPERTIES', SAMPLE_CSVS.CONTACTS_PROPERTIES);
    const first = await importFile('TAX_YEAR_VALUES', SAMPLE_CSVS.TAX_YEAR_VALUES);
    expect(first.preview).toEqual({ CREATE: 2, UPDATE: 0, UNCHANGED: 0, ERROR: 0 });
    const record = await t.prisma.taxYearRecord.findFirstOrThrow({
      where: { orgId, taxYear: 2026, property: { accountNumber: '0660640130020' } },
      include: { stageEvents: true },
    });
    expect(record).toMatchObject({ protestStage: 'SETTLED', homestead: true });
    expect(record.noticeMarket?.toString()).toBe('524819');
    expect(record.taxRatePct?.toString()).toBe('2.15');
    expect(record.noticeReceivedAt?.toISOString().slice(0, 10)).toBe('2026-04-17');
    expect(record.stageEvents.map((e) => e.toStage)).toEqual(['SETTLED']);

    const again = await importFile('TAX_YEAR_VALUES', SAMPLE_CSVS.TAX_YEAR_VALUES);
    expect(again.preview).toEqual({ CREATE: 0, UPDATE: 0, UNCHANGED: 2, ERROR: 0 });

    // A later stage is a change, recorded in the stage history.
    const later = [
      'County,Account Number,Tax Year,Stage',
      'Harris,066-064-013-0020,2026,Withdrawn',
    ].join('\n');
    const changed = await importFile('TAX_YEAR_VALUES', later);
    expect(changed.preview).toEqual({ CREATE: 0, UPDATE: 1, UNCHANGED: 0, ERROR: 0 });
    const events = await t.prisma.protestStageEvent.findMany({
      where: { taxYearRecordId: record.id },
      orderBy: { id: 'asc' },
    });
    expect(events.map((e) => [e.fromStage, e.toStage])).toEqual([
      [null, 'SETTLED'],
      ['SETTLED', 'WITHDRAWN'],
    ]);
  });

  it('reports bad rows, imports the good ones, and offers the errors as a CSV to fix', async () => {
    await importFile('CONTACTS_PROPERTIES', SAMPLE_CSVS.CONTACTS_PROPERTIES);
    const csv = [
      'Client Number,Client Name,Email,County,Account Number,Contingency Fee',
      '2001,Good Client,good@example.com,Harris,1111111111111,25',
      '2002,Bad County,bad@example.com,Atlantis,123,25',
      '2003,Taken Account,taken@example.com,Harris,0660640130020,25',
      '2004,Bad Fee,fee@example.com,Harris,2222222222222,lots',
      ',,,,,',
      ',No Key Client,,,,',
    ].join('\n');
    const { id, preview, done } = await importFile('CONTACTS_PROPERTIES', csv);
    expect(preview).toEqual({ CREATE: 1, UPDATE: 0, UNCHANGED: 0, ERROR: 4 });
    expect(done.summary).toEqual(preview);
    const errors = (await req('GET', `/imports/${id}/rows?action=ERROR`)).json();
    expect(
      errors.items.map((r: { rowNumber: number; messages: string[] }) => [
        r.rowNumber,
        r.messages[0],
      ]),
    ).toEqual([
      [2, 'County: "Atlantis" isn\'t a Texas county.'],
      [3, 'Account 0660640130020 in Harris already belongs to Jane Smith (1042).'],
      [4, 'Contingency %: "lots" isn\'t a percentage, like 30 or 30%.'],
      [
        5,
        'A client without a property needs a client number or email, so re-importing finds it again.',
      ],
    ]);
    // Nothing from a bad row was saved.
    expect(
      await t.prisma.contact.count({
        where: { orgId, clientNumber: { in: ['2002', '2003', '2004'] } },
      }),
    ).toBe(0);

    const file = await req('GET', `/imports/${id}/errors.csv`);
    expect(file.headers['content-type']).toContain('text/csv');
    expect(file.headers['content-disposition']).toContain('clients-errors.csv');
    const lines = file.body.trim().split('\n');
    expect(lines[0]).toBe(
      'Client Number,Client Name,Email,County,Account Number,Contingency Fee,Import error',
    );
    expect(lines).toHaveLength(5);
    expect(lines[1]).toBe(
      '2002,Bad County,bad@example.com,Atlantis,123,25,"County: ""Atlantis"" isn\'t a Texas county."',
    );
  });

  it('remembers a corrected mapping for the next file', async () => {
    const csv = 'Cust Code,Who,County,Acct\n9001,Pat Doe,Harris,3333333333333\n';
    const up = (await upload('CONTACTS_PROPERTIES', csv)).json();
    expect(up.columnMapping).toEqual({
      'Cust Code': null,
      Who: null,
      County: 'county',
      Acct: 'accountNumber',
    });
    const mapped = await req('PATCH', `/imports/${up.id}/mapping`, {
      columnMapping: {
        'Cust Code': 'clientNumber',
        Who: 'displayName',
        County: 'county',
        Acct: 'accountNumber',
      },
    });
    expect(mapped.statusCode).toBe(200);
    expect((await req('POST', `/imports/${up.id}/preview`)).json().summary).toEqual({
      CREATE: 1,
      UPDATE: 0,
      UNCHANGED: 0,
      ERROR: 0,
    });
    const next = (await upload('CONTACTS_PROPERTIES', csv, 'again.csv')).json();
    expect(next.columnMapping).toEqual({
      'Cust Code': 'clientNumber',
      Who: 'displayName',
      County: 'county',
      Acct: 'accountNumber',
    });

    const twice = await req('PATCH', `/imports/${up.id}/mapping`, {
      columnMapping: { 'Cust Code': 'clientNumber', Who: 'clientNumber' },
    });
    expect(twice.statusCode).toBe(400);
  });

  it('checks files and the order of steps', async () => {
    expect((await upload('CONTACTS_PROPERTIES', '')).statusCode).toBe(400);
    expect((await upload('CONTACTS_PROPERTIES', 'a,a\n1,2')).json().error.message).toMatch(
      /Two columns/,
    );
    expect((await upload('HISTORICAL_INVOICES', 'a\n1')).statusCode).toBe(400);
    const id = (await upload('TAX_YEAR_VALUES', SAMPLE_CSVS.TAX_YEAR_VALUES)).json().id;
    expect((await req('POST', `/imports/${id}/run`)).statusCode).toBe(409);
    const sample = await req('GET', '/imports/template?kind=TAX_YEAR_VALUES');
    expect(sample.body).toContain('County,Account Number,Tax Year');
    expect((await req('GET', '/imports')).json()).toHaveLength(1);
  });

  it('is for staff and up', async () => {
    const viewer = await createUser('viewer@example.com');
    await addMember(orgId, viewer.id, 'READ_ONLY');
    const c = await login(t.app, 'viewer@example.com');
    expect((await req('GET', '/imports', undefined, c)).statusCode).toBe(403);
  });

  // BUILD_PLAN M3 "done when": a 5,000-row file imports; importing it again makes zero changes.
  it(
    'imports a 5,000-row file and re-imports it with zero changes',
    { timeout: 300_000 },
    async () => {
      const lines = [
        'Client Number,Client Name,Email,County,Account Number,Property Address,Contingency Fee',
      ];
      for (let i = 0; i < 5000; i++) {
        const client = 10_000 + Math.floor(i / 2); // two properties per client
        lines.push(
          `${client},Client ${client},c${client}@example.com,${i % 2 ? 'Fort Bend' : 'Harris'},${String(5_000_000_000_000 + i)},${i} Test St,30%`,
        );
      }
      const csv = lines.join('\n');
      const first = await importFile('CONTACTS_PROPERTIES', csv);
      expect(first.preview).toEqual({ CREATE: 5000, UPDATE: 0, UNCHANGED: 0, ERROR: 0 });
      expect(first.done.summary).toEqual(first.preview);
      expect(await t.prisma.contact.count({ where: { orgId } })).toBe(2500);
      expect(await t.prisma.property.count({ where: { orgId } })).toBe(5000);

      const again = await importFile('CONTACTS_PROPERTIES', csv);
      expect(again.preview).toEqual({ CREATE: 0, UPDATE: 0, UNCHANGED: 5000, ERROR: 0 });
      expect(again.done.summary).toEqual(again.preview);
      expect(await t.prisma.property.count({ where: { orgId } })).toBe(5000);
    },
  );
});
