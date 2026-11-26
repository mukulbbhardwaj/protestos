import { rgb } from 'pdf-lib';
import { day, Flow, GRAY, hexColor, PAGE, usd } from './layout.js';

export type InvoiceLayout = 'STANDARD' | 'ARBITRATION' | 'HOMESTEAD' | 'ZERO_SAVINGS';

export interface PdfOrg {
  name: string;
  addressLines: string[];
  phone: string | null;
  website: string | null;
  primaryColor: string | null;
  paymentInstructions: string | null;
}

export interface InvoicePdfLine {
  kind: 'CONTINGENCY' | 'FLAT' | 'BPP' | 'ADJUSTMENT';
  description: string;
  amount: string;
  property: { accountNumber: string; county: string; situsLine: string | null } | null;
  /** From the frozen fee snapshot, for contingency lines. */
  detail: {
    notice: string | null;
    final: string | null;
    reduction: string | null;
    taxRatePct: string | null;
    savings: string | null;
    contingencyPct: string;
  } | null;
}

export interface InvoicePdfData {
  org: PdfOrg;
  invoice: {
    number: string | null;
    status: string;
    template: InvoiceLayout;
    taxYear: number;
    issueDate: string | null;
    dueDate: string | null;
    subtotal: string;
    total: string;
    amountPaid: string;
    balance: string;
    notes: string | null;
  };
  billTo: { name: string; addressLines: string[]; email: string | null };
  lines: InvoicePdfLine[];
}

const INTRO: Record<InvoiceLayout, (year: number) => string> = {
  STANDARD: (y) =>
    `Thank you for letting us protest your ${y} property values. Our fee is a share of the tax you save this year, shown per property below.`,
  ARBITRATION: (y) =>
    `Your ${y} protest went to binding arbitration. The fee below reflects the value set by the arbitrator.`,
  HOMESTEAD: (y) =>
    `Thank you for letting us protest your ${y} homestead value. Savings are measured on the appraised value, after the homestead cap.`,
  ZERO_SAVINGS: (y) =>
    `We protested your ${y} values but did not obtain a reduction this year, so no contingency fee is due. The fees below are your flat service fees.`,
};

/** BUILD_PLAN 8.6 "Invoice PDF": one line per property, totals, payment instructions. */
export async function renderInvoicePdf(data: InvoicePdfData): Promise<Uint8Array> {
  const { org, invoice, billTo } = data;
  const accent = hexColor(org.primaryColor);
  const title = invoice.number ? `Invoice ${invoice.number}` : 'Draft invoice';
  const f = await Flow.create(`${org.name} - ${title}`);
  const right = PAGE.width - PAGE.margin;
  const left = PAGE.margin;

  f.band(6, accent);
  f.y -= 6;
  f.text(org.name, left, { size: 16, bold: true });
  f.text(invoice.number ? 'INVOICE' : 'DRAFT', right, {
    size: 16,
    bold: true,
    color: accent,
    align: 'right',
  });
  f.y -= 16;
  const orgLines = [...org.addressLines, org.phone, org.website].filter(Boolean) as string[];
  const meta: [string, string][] = [
    ['Invoice', invoice.number ?? 'Not issued'],
    ['Tax year', String(invoice.taxYear)],
    ['Issued', day(invoice.issueDate)],
    ['Due', day(invoice.dueDate)],
  ];
  const rows = Math.max(orgLines.length, meta.length);
  for (let i = 0; i < rows; i++) {
    if (orgLines[i]) f.text(orgLines[i]!, left, { color: GRAY });
    if (meta[i]) {
      f.text(meta[i]![0], right - 120, { color: GRAY });
      f.text(meta[i]![1], right, { bold: true, align: 'right' });
    }
    f.y -= 12;
  }

  f.y -= 14;
  f.text('BILL TO', left, { size: 7.5, bold: true, color: GRAY });
  f.y -= 13;
  f.text(billTo.name, left, { size: 11, bold: true });
  f.y -= 13;
  for (const l of [...billTo.addressLines, billTo.email].filter(Boolean) as string[]) {
    f.text(l, left);
    f.y -= 12;
  }

  f.y -= 8;
  f.paragraph(INTRO[invoice.template](invoice.taxYear), left, right - left, { color: GRAY });
  f.y -= 10;

  // Table: description (with property and fee working) | amount.
  const head = () => {
    f.page.drawRectangle({
      x: left,
      y: f.y - 5,
      width: right - left,
      height: 18,
      color: rgb(0.95, 0.96, 0.97),
    });
    f.text('PROPERTY / DESCRIPTION', left + 6, { size: 7.5, bold: true, color: GRAY, y: f.y + 1 });
    f.text('AMOUNT', right - 6, { size: 7.5, bold: true, color: GRAY, align: 'right', y: f.y + 1 });
    f.y -= 22;
  };
  head();
  let lastProperty = '';
  for (const line of data.lines) {
    const p = line.property;
    const propKey = p ? `${p.county}|${p.accountNumber}` : '';
    const detail =
      line.detail && invoice.template !== 'ZERO_SAVINGS' ? workings(line.detail) : null;
    const h = (p && propKey !== lastProperty ? 26 : 0) + 14 + (detail ? 12 : 0);
    if (f.y - h < PAGE.margin + 24) {
      f.newPage();
      head();
    }
    if (p && propKey !== lastProperty) {
      f.y -= 2;
      f.text(`${p.county} ${p.accountNumber}`, left + 6, { bold: true });
      f.y -= 11;
      f.text(p.situsLine ?? '', left + 6, { color: GRAY, size: 8 });
      f.y -= 13;
      lastProperty = propKey;
    }
    f.text(line.description, left + 14, {});
    f.text(usd(line.amount), right - 6, { align: 'right' });
    f.y -= 12;
    if (detail) {
      f.text(detail, left + 14, { size: 7.5, color: GRAY });
      f.y -= 12;
    }
    f.y -= 2;
    f.rule();
    f.y -= 10;
  }

  f.need(80);
  f.y -= 4;
  const totals: [string, string, boolean][] = [
    ['Total', usd(invoice.total), false],
    ...(Number(invoice.amountPaid) > 0
      ? [['Paid', usd(invoice.amountPaid), false] as [string, string, boolean]]
      : []),
    ['Balance due', usd(invoice.balance), true],
  ];
  for (const [label, value, strong] of totals) {
    f.text(label, right - 150, {
      bold: strong,
      size: strong ? 11 : 9,
      color: strong ? accent : GRAY,
    });
    f.text(value, right - 6, { bold: strong, size: strong ? 11 : 9, align: 'right' });
    f.y -= strong ? 16 : 13;
  }

  if (org.paymentInstructions) {
    f.y -= 10;
    f.need(40);
    f.text('HOW TO PAY', left, { size: 7.5, bold: true, color: GRAY });
    f.y -= 12;
    f.paragraph(org.paymentInstructions, left, right - left);
  }
  if (invoice.notes) {
    f.y -= 8;
    f.need(30);
    f.text('NOTES', left, { size: 7.5, bold: true, color: GRAY });
    f.y -= 12;
    f.paragraph(invoice.notes, left, right - left);
  }
  return f.save();
}

function workings(d: NonNullable<InvoicePdfLine['detail']>): string | null {
  if (!d.reduction) return null;
  const parts = [
    d.notice && d.final ? `Notice ${usd(d.notice)} -> final ${usd(d.final)}` : null,
    `reduction ${usd(d.reduction)}`,
    d.taxRatePct ? `x ${Number(d.taxRatePct)}% tax rate` : null,
    d.savings ? `= ${usd(d.savings)} saved` : null,
    `x ${Number(d.contingencyPct)}%`,
  ];
  return parts.filter(Boolean).join(' ');
}
