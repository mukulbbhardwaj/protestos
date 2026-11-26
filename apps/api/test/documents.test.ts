import { FIELD_MAP, FORM_PROPERTY_ROWS } from '@app/pdf';
import { PDFDocument } from 'pdf-lib';
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

// M6 "done when": a prospect gets a contract and a 50-162, signs, the app shows the signed
// PDFs, and the prospect becomes SIGNED (mock provider in place of DocuSign, per Mukul).

/** A stand-in fillable 50-162 with the mapped field names; the official PDF isn't committed. */
async function fakeForm() {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const form = doc.getForm();
  const names = [
    ...Object.values(FIELD_MAP.text).map((n) => n[0]!),
    ...Array.from({ length: FORM_PROPERTY_ROWS }, (_, i) => [
      FIELD_MAP.property.account[0]!.replace('{n}', String(i + 1)),
      FIELD_MAP.property.address[0]!.replace('{n}', String(i + 1)),
    ]).flat(),
  ];
  names.forEach((n, i) =>
    form.createTextField(n).addToPage(page, { x: 10, y: 10 + i * 18, width: 200, height: 14 }),
  );
  form
    .createCheckBox(FIELD_MAP.allMatters[0]!)
    .addToPage(page, { x: 300, y: 10, width: 10, height: 10 });
  return doc.save();
}

let t: TestContext;
let formInstalled = true;
let cookie: string;
let slug: string;
let orgId: number;
let harris: number;
let fortBend: number;

beforeAll(async () => {
  const blank = await fakeForm();
  t = await makeTestApp({ form50162: async () => (formInstalled ? blank : null) });
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDb();
  formInstalled = true;
  t.mail.sent.length = 0;
  const o = await ownerWithOrg(t.app, 'owner@example.com', 'Firm');
  cookie = o.cookie;
  slug = o.org.slug;
  orgId = o.org.id;
  harris = (
    await t.prisma.county.create({
      data: { state: 'TX', name: 'Harris', cadName: 'Harris Central Appraisal District' },
    })
  ).id;
  fortBend = (
    await t.prisma.county.create({
      data: { state: 'TX', name: 'Fort Bend', cadName: 'Fort Bend Central Appraisal District' },
    })
  ).id;
  await req('PATCH', '/settings', {
    agentName: 'Firm Tax Consultants LLC',
    agentLicense: 'PTC-42',
    defaultContingencyPct: '30',
  });
});

const req = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  path: string,
  payload?: object,
  c = cookie,
) =>
  t.app.inject({
    method,
    url: `/orgs/${slug}${path}`,
    headers: { cookie: c },
    ...(payload ? { payload } : {}),
  });
const pub = (method: 'GET' | 'POST', path: string, payload?: object) =>
  t.app.inject({ method, url: path, ...(payload ? { payload } : {}) });

async function prospect() {
  const c = (
    await req('POST', '/contacts', {
      kind: 'PROSPECT',
      displayName: 'Pat Prospect',
      email: 'pat@example.com',
    })
  ).json();
  const props: number[] = [];
  for (const [countyId, acct] of [
    [harris, '0660640130020'],
    [harris, '1041940000005'],
    [fortBend, 'R267426'],
  ] as const) {
    const p = await req('POST', '/properties', {
      contactId: c.id,
      accountNumber: acct,
      countyId,
      taxYear: 2026,
    });
    expect(p.statusCode).toBe(201);
    props.push(p.json().id);
  }
  return { contactId: c.id as number, props };
}

const send = (
  contactId: number,
  propertyIds: number[],
  kinds = ['ENGAGEMENT_CONTRACT', 'AOA_50_162'],
  c = cookie,
) =>
  req(
    'POST',
    `/contacts/${contactId}/documents`,
    {
      kinds,
      propertyIds,
      taxYear: 2026,
      signerName: 'Pat Prospect',
      signerEmail: 'pat@example.com',
    },
    c,
  );

const pageCount = async (bytes: Buffer) => (await PDFDocument.load(bytes)).getPageCount();

describe('documents and e-signature', () => {
  it('sends a contract and a 50-162 per appraisal district, and signing makes the prospect SIGNED', async () => {
    const { contactId, props } = await prospect();
    const res = await send(contactId, props);
    expect(res.statusCode).toBe(201);
    const env = res.json();
    expect(env).toMatchObject({ status: 'SENT', provider: 'mock', signerEmail: 'pat@example.com' });
    expect(env.documents.map((d: { title: string }) => d.title)).toEqual([
      'Engagement agreement',
      'Appointment of Agent (Form 50-162) - Fort Bend Central Appraisal District',
      'Appointment of Agent (Form 50-162) - Harris Central Appraisal District',
    ]);
    expect(env.documents[2].properties).toHaveLength(2);
    expect((await req('GET', `/contacts/${contactId}`)).json().status).toBe('DOCS_SENT');

    // The signing email carries the link.
    const mail = t.mail.lastTo('pat@example.com')!;
    expect(mail.subject).toBe(
      'Please sign: Engagement agreement, Appointment of Agent (Form 50-162) - Fort Bend Central Appraisal District and Appointment of Agent (Form 50-162) - Harris Central Appraisal District',
    );
    const link = mail.text.match(/\/sign\/([\w-]+)/)![0];
    expect(env.signingUrl).toContain(link);

    // The 50-162 was filled from the firm and client.
    const aoaUnsigned = await req('GET', `/documents/${env.documents[2].id}/pdf`);
    const form = (await PDFDocument.load(aoaUnsigned.rawPayload)).getForm();
    expect(form.getTextField('Owner Name').getText()).toBe('Pat Prospect');
    expect(form.getTextField('Agent Name').getText()).toBe('Firm Tax Consultants LLC');
    expect(form.getTextField('Agent License').getText()).toBe('PTC-42');
    expect(form.getTextField('Account Number 2').getText()).toBe('1041940000005');

    // The signer opens the link, reads, and signs.
    const session = await pub('GET', link);
    expect(session.json()).toMatchObject({ firm: 'Firm', status: 'VIEWED' });
    expect(session.json().documents).toHaveLength(3);
    expect((await pub('GET', `${link}/documents/0`)).headers['content-type']).toBe(
      'application/pdf',
    );
    expect((await pub('POST', link, { signerName: 'Pat Prospect', agree: false })).statusCode).toBe(
      400,
    );
    expect((await pub('POST', link, { signerName: 'Pat Prospect', agree: true })).statusCode).toBe(
      200,
    );
    expect((await pub('POST', link, { signerName: 'Pat Prospect', agree: true })).statusCode).toBe(
      409,
    );

    const done = (await req('GET', `/envelopes/${env.id}`)).json();
    expect(done.status).toBe('SIGNED');
    expect(done.signingUrl).toBeNull();
    expect(
      done.documents.every(
        (d: { status: string; hasSigned: boolean }) => d.status === 'SIGNED' && d.hasSigned,
      ),
    ).toBe(true);
    const contract = env.documents[0].id;
    const unsigned = await req('GET', `/documents/${contract}/pdf?signed=false`);
    const signed = await req('GET', `/documents/${contract}/pdf`);
    expect(await pageCount(signed.rawPayload)).toBe((await pageCount(unsigned.rawPayload)) + 1);
    expect(signed.headers['content-disposition']).toContain('(signed)');

    expect((await req('GET', `/contacts/${contactId}`)).json().status).toBe('SIGNED');
    const years = await t.prisma.taxYearRecord.findMany({ where: { orgId } });
    expect(years.every((y) => y.protestStage === 'AOA_SIGNED')).toBe(true);
    expect(await t.prisma.protestStageEvent.count({ where: { note: 'Form 50-162 signed' } })).toBe(
      3,
    );
    expect((await req('GET', '/documents?status=SIGNED')).json().total).toBe(3);
    expect((await req('GET', '')).json().checklist.eSignatureConnected).toBe(true);
  });

  it('explains when the official 50-162 is not installed; the contract still sends', async () => {
    formInstalled = false;
    const { contactId, props } = await prospect();
    const res = await send(contactId, props);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('FORM_NOT_INSTALLED');
    expect((await send(contactId, props, ['ENGAGEMENT_CONTRACT'])).statusCode).toBe(201);
  });

  it('refuses to resend signed documents unless the firm allows it', async () => {
    const { contactId, props } = await prospect();
    const env = (await send(contactId, props, ['ENGAGEMENT_CONTRACT'])).json();
    await pub('POST', new URL(env.signingUrl).pathname, { signerName: 'Pat', agree: true });
    const again = await send(contactId, props, ['ENGAGEMENT_CONTRACT']);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.message).toMatch(/Already signed for 2026: Engagement agreement/);
    await req('PATCH', '/settings', { allowResendSigned: true });
    expect((await send(contactId, props, ['ENGAGEMENT_CONTRACT'])).statusCode).toBe(201);
  });

  it('reminds, voids and handles a decline', async () => {
    const { contactId, props } = await prospect();
    const a = (await send(contactId, props, ['ENGAGEMENT_CONTRACT'])).json();
    expect((await req('POST', `/envelopes/${a.id}/remind`)).statusCode).toBe(200);
    expect(t.mail.lastTo('pat@example.com')?.subject).toBe(
      'Reminder: please sign your Engagement agreement',
    );
    const voided = (
      await req('POST', `/envelopes/${a.id}/void`, { reason: 'Wrong signer' })
    ).json();
    expect(voided).toMatchObject({ status: 'VOIDED', voidReason: 'Wrong signer' });
    expect(voided.documents[0].status).toBe('VOIDED');
    const token = (await t.prisma.signatureEnvelope.findUniqueOrThrow({ where: { id: a.id } }))
      .signToken!;
    expect(
      (await pub('POST', `/sign/${token}`, { signerName: 'Pat', agree: true })).statusCode,
    ).toBe(409);

    const b = (await send(contactId, props, ['ENGAGEMENT_CONTRACT'])).json();
    expect(
      (
        await pub('POST', `${new URL(b.signingUrl).pathname}/decline`, {
          reason: 'Changed my mind',
        })
      ).statusCode,
    ).toBe(200);
    const declined = (await req('GET', `/envelopes/${b.id}`)).json();
    expect(declined.status).toBe('DECLINED');
    expect(declined.events.at(-1)).toMatchObject({ type: 'declined', detail: 'Changed my mind' });
    expect((await pub('GET', '/sign/not-a-real-token-at-all-000000')).statusCode).toBe(404);
  });

  it('accepts a paper signature as an uploaded PDF', async () => {
    const { contactId, props } = await prospect();
    const env = (await send(contactId, props.slice(0, 1))).json();
    const upload = (id: number, body: Buffer | string) =>
      t.app.inject({
        method: 'POST',
        url: `/orgs/${slug}/documents/${id}/signed`,
        headers: { cookie, 'content-type': 'application/pdf' },
        payload: body,
      });
    expect((await upload(env.documents[0].id, 'not a pdf')).statusCode).toBe(400);
    const paper = await PDFDocument.create();
    paper.addPage();
    const scan = Buffer.from(await paper.save());
    const r = await upload(env.documents[0].id, scan);
    expect(r.json()).toMatchObject({ status: 'SIGNED', signedOffline: true });
    expect((await req('GET', `/envelopes/${env.id}`)).json().status).toBe('SENT');
    await upload(env.documents[1].id, scan);
    expect((await req('GET', `/envelopes/${env.id}`)).json().status).toBe('SIGNED');
    expect((await req('GET', `/contacts/${contactId}`)).json().status).toBe('SIGNED');
  });

  it('only uses the client’s own properties, and read-only members can look but not send', async () => {
    const { contactId, props } = await prospect();
    const other = (await req('POST', '/contacts', { kind: 'CLIENT', displayName: 'Other' })).json();
    expect((await send(other.id, props)).statusCode).toBe(400);
    const viewer = await createUser('viewer@example.com');
    await addMember(orgId, viewer.id, 'READ_ONLY');
    const vc = await login(t.app, 'viewer@example.com');
    expect((await req('GET', '/documents', undefined, vc)).statusCode).toBe(200);
    expect((await send(contactId, props, undefined, vc)).statusCode).toBe(403);
  });
});

describe('engagement agreement wording', () => {
  it('edits, versions, previews and resets', async () => {
    const def = (await req('GET', '/document-template')).json();
    expect(def).toMatchObject({ isCustom: false, version: 0 });
    expect(def.placeholders).toContain('properties.table');
    expect(
      (
        await req('PUT', '/document-template', {
          body: 'Agreement with {{clent.name}} and more words',
        })
      ).statusCode,
    ).toBe(400);
    const body =
      'OUR AGREEMENT\n\nWe protest for {{client.displayName}} at {{contingencyPct}}.\n\n{{properties.table}}';
    expect((await req('PUT', '/document-template', { body })).json()).toMatchObject({
      isCustom: true,
      version: 1,
    });
    expect(
      (await req('PUT', '/document-template', { body: `${body}\n\nThanks.` })).json().version,
    ).toBe(2);
    const preview = await req('POST', '/document-template/preview', { body });
    expect(preview.headers['content-type']).toBe('application/pdf');

    const { contactId, props } = await prospect();
    await send(contactId, props, ['ENGAGEMENT_CONTRACT']);
    expect((await t.prisma.document.findFirstOrThrow()).templateVersion).toBe(2);
    const p = await req(
      'GET',
      `/contacts/${contactId}/documents/preview?kind=ENGAGEMENT_CONTRACT&propertyIds=${props.join(',')}&taxYear=2026&signerName=Pat`,
    );
    expect(p.headers['content-type']).toBe('application/pdf');
    expect((await req('POST', '/document-template/reset')).json().isCustom).toBe(false);
  });
});
