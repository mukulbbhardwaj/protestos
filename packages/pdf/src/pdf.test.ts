import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  FIELD_MAP,
  fill50162,
  FORM_PROPERTY_ROWS,
  listFormFields,
  renderContractPdf,
  renderInvoicePdf,
  renderStatementPdf,
  stampSignature,
  type InvoicePdfData,
} from './index.js';

const org = {
  name: 'Lone Star Demo Tax Consultants',
  addressLines: ['100 Main St', 'Houston, TX 77002'],
  phone: '(713) 555-0100',
  website: null,
  primaryColor: '#0f766e',
  paymentInstructions: 'Zelle billing@example.com or mail a check to 100 Main St.',
};

const invoice = (template: InvoicePdfData['invoice']['template'], lines = 3): InvoicePdfData => ({
  org,
  invoice: {
    number: 'INV-0042',
    status: 'ISSUED',
    template,
    taxYear: 2026,
    issueDate: '2026-09-15',
    dueDate: '2026-10-15',
    subtotal: '1250.00',
    total: '1250.00',
    amountPaid: '0.00',
    balance: '1250.00',
    notes: 'Thank you — “quoted” notes with unicode → fine ✓',
  },
  billTo: {
    name: 'Jane Owner',
    addressLines: ['1 Elm St', 'Houston, TX 77005'],
    email: 'jane@example.com',
  },
  lines: Array.from({ length: lines }, (_, i) => ({
    kind: 'CONTINGENCY' as const,
    description: 'Contingency fee (30%)',
    amount: '416.67',
    property: {
      accountNumber: `10419400000${String(i).padStart(2, '0')}`,
      county: 'Harris',
      situsLine: '3235 Trail Lake Dr',
    },
    detail: {
      notice: '450000',
      final: '400000',
      reduction: '50000',
      taxRatePct: '2.15',
      savings: '1075.00',
      contingencyPct: '30',
    },
  })),
});

async function pages(bytes: Uint8Array) {
  expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
  return (await PDFDocument.load(bytes)).getPageCount();
}

describe('invoice PDF', () => {
  it('renders all four layouts', async () => {
    for (const t of ['STANDARD', 'ARBITRATION', 'HOMESTEAD', 'ZERO_SAVINGS'] as const) {
      expect(await pages(await renderInvoicePdf(invoice(t)))).toBe(1);
    }
  });
  it('breaks long invoices across pages, and renders drafts', async () => {
    const data = invoice('STANDARD', 40);
    data.invoice.number = null;
    expect(await pages(await renderInvoicePdf(data))).toBeGreaterThan(1);
  });
  it('is deterministic', async () => {
    const a = await renderInvoicePdf(invoice('STANDARD'));
    const b = await renderInvoicePdf(invoice('STANDARD'));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe('statement PDF', () => {
  it('renders open invoices, payments, credit and balance', async () => {
    const bytes = await renderStatementPdf({
      org,
      asOf: '2026-11-26',
      client: { name: 'Jane Owner', clientNumber: '1001', addressLines: ['1 Elm St'] },
      invoices: [
        {
          number: 'INV-0042',
          taxYear: 2026,
          issueDate: '2026-09-15',
          dueDate: '2026-10-15',
          total: '1250',
          amountPaid: '250',
          balance: '1000',
          pastDue: true,
        },
      ],
      payments: [{ receivedAt: '2026-10-01', method: 'CHECK', reference: '1234', amount: '250' }],
      credit: '10',
      balanceDue: '990',
    });
    expect(await pages(bytes)).toBe(1);
    const empty = await renderStatementPdf({
      org: { ...org, paymentInstructions: null, primaryColor: null },
      asOf: '2026-11-26',
      client: { name: 'No Invoices', clientNumber: null, addressLines: [] },
      invoices: [],
      payments: [],
      credit: '0',
      balanceDue: '0',
    });
    expect(await pages(empty)).toBe(1);
  });
});

describe('documents', () => {
  it('renders a contract with its properties table and stamps a signature', async () => {
    const bytes = await renderContractPdf({
      org,
      title: 'Engagement agreement',
      blocks: [
        { type: 'text', text: 'PROPERTY TAX CONSULTING AGREEMENT' },
        { type: 'text', text: 'Owner engages Consultant.' },
        { type: 'properties' },
      ],
      properties: [
        { county: 'Harris', accountNumber: '0660640130020', address: '1700 St Charles St' },
      ],
      signer: { name: 'Jane Owner', email: 'jane@example.com' },
    });
    expect(await pages(bytes)).toBe(1);
    const signed = await stampSignature(bytes, {
      signerName: 'Jane Owner',
      signerEmail: 'jane@example.com',
      signedAt: new Date('2026-11-26T15:00:00Z'),
      ip: '203.0.113.5',
      reference: 'ENV-1',
      documentTitle: 'Engagement agreement',
    });
    expect(await pages(signed)).toBe(2);
  });

  it('fills Form 50-162 fields by the field map and reports any it cannot find', async () => {
    // A stand-in fillable form with the mapped field names (the official PDF isn't committed).
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const form = doc.getForm();
    const names = [
      FIELD_MAP.text.ownerName[0]!,
      FIELD_MAP.text.ownerAddress[0]!,
      FIELD_MAP.text.appraisalDistrict[0]!,
      FIELD_MAP.text.agentName[0]!,
      FIELD_MAP.text.agentAddress[0]!,
      FIELD_MAP.text.agentLicense[0]!,
      ...Array.from({ length: FORM_PROPERTY_ROWS }, (_, i) => [
        FIELD_MAP.property.account[0]!.replace('{n}', String(i + 1)),
        FIELD_MAP.property.address[1]!.replace('{n}', String(i + 1)),
      ]).flat(),
    ];
    names.forEach((n, i) =>
      form.createTextField(n).addToPage(page, { x: 10, y: 10 + i * 20, width: 200, height: 14 }),
    );
    form
      .createCheckBox(FIELD_MAP.allMatters[0]!)
      .addToPage(page, { x: 300, y: 10, width: 10, height: 10 });
    const blank = await doc.save();

    const { pdf, missing } = await fill50162(blank, {
      owner: {
        name: 'Jane Owner',
        address: '1 Elm St, Houston, TX 77005',
        phone: '713-555-0100',
        email: null,
      },
      appraisalDistrict: 'Harris Central Appraisal District',
      properties: Array.from({ length: 8 }, (_, i) => ({
        accountNumber: `A${i + 1}`,
        address: `${i + 1} Main St`,
      })),
      agent: {
        name: 'Lone Star Tax',
        title: null,
        address: '100 Main St',
        phone: null,
        license: 'PTC-1',
      },
      taxYear: 2026,
    });
    const filled = (await PDFDocument.load(pdf)).getForm();
    expect(filled.getTextField('Owner Name').getText()).toBe('Jane Owner');
    expect(filled.getTextField('Account Number 6').getText()).toBe('A6');
    expect(filled.getTextField('Physical address legal description 1').getText()).toBe('1 Main St');
    expect(filled.getCheckBox('All Property Tax Matters').isChecked()).toBe(true);
    // Phone has no field in the stand-in form: reported, not silently dropped.
    expect(missing).toEqual(['owner phone']);
    expect(await listFormFields(blank)).toContain('TextField: Owner Name');
  });
});
