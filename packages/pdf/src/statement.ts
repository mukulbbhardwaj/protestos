import { day, Flow, GRAY, hexColor, PAGE, usd } from './layout.js';
import type { PdfOrg } from './invoice.js';

export interface StatementPdfData {
  org: PdfOrg;
  asOf: string;
  client: { name: string; clientNumber: string | null; addressLines: string[] };
  invoices: {
    number: string;
    taxYear: number;
    issueDate: string | null;
    dueDate: string | null;
    total: string;
    amountPaid: string;
    balance: string;
    pastDue: boolean;
  }[];
  payments: { receivedAt: string; method: string; reference: string | null; amount: string }[];
  credit: string;
  balanceDue: string;
}

/** A client's open invoices, recent payments, credit and balance due (M4). */
export async function renderStatementPdf(data: StatementPdfData): Promise<Uint8Array> {
  const { org } = data;
  const accent = hexColor(org.primaryColor);
  const f = await Flow.create(
    `${org.name} - Statement for ${data.client.name} as of ${day(data.asOf)}`,
  );
  const left = PAGE.margin;
  const right = PAGE.width - PAGE.margin;

  f.band(6, accent);
  f.y -= 6;
  f.text(org.name, left, { size: 16, bold: true });
  f.text('STATEMENT', right, { size: 16, bold: true, color: accent, align: 'right' });
  f.y -= 16;
  for (const l of org.addressLines) {
    f.text(l, left, { color: GRAY });
    f.y -= 12;
  }
  f.y -= 12;
  f.text(data.client.name, left, { size: 11, bold: true });
  f.text(`As of ${day(data.asOf)}`, right, { align: 'right', color: GRAY });
  f.y -= 13;
  if (data.client.clientNumber) {
    f.text(`Client ${data.client.clientNumber}`, left, { color: GRAY });
    f.y -= 12;
  }
  for (const l of data.client.addressLines) {
    f.text(l, left);
    f.y -= 12;
  }

  const cols = [left + 6, left + 110, left + 170, left + 250, right - 170, right - 90, right - 6];
  const section = (title: string) => {
    f.y -= 14;
    f.need(40);
    f.text(title, left, { size: 7.5, bold: true, color: GRAY });
    f.y -= 6;
    f.rule();
    f.y -= 12;
  };

  section('OPEN INVOICES');
  if (data.invoices.length === 0) {
    f.text('No open invoices.', cols[0]!, { color: GRAY });
    f.y -= 12;
  } else {
    const hdr = ['Invoice', 'Tax year', 'Issued', 'Due', 'Total', 'Paid', 'Balance'];
    hdr.forEach((h, i) =>
      f.text(h, cols[i]!, { size: 7.5, bold: true, color: GRAY, align: i >= 4 ? 'right' : 'left' }),
    );
    f.y -= 13;
    for (const inv of data.invoices) {
      f.need(14);
      const cells = [
        inv.number,
        String(inv.taxYear),
        day(inv.issueDate),
        `${day(inv.dueDate)}${inv.pastDue ? ' (past due)' : ''}`,
        usd(inv.total),
        usd(inv.amountPaid),
        usd(inv.balance),
      ];
      cells.forEach((c, i) =>
        f.text(c, cols[i]!, { align: i >= 4 ? 'right' : 'left', bold: i === 6 }),
      );
      f.y -= 13;
    }
  }

  section('RECENT PAYMENTS');
  if (data.payments.length === 0) {
    f.text('No payments yet.', cols[0]!, { color: GRAY });
    f.y -= 12;
  }
  for (const p of data.payments) {
    f.need(14);
    f.text(day(p.receivedAt), cols[0]!);
    f.text([p.method, p.reference].filter(Boolean).join(' '), cols[1]!);
    f.text(usd(p.amount), right - 6, { align: 'right' });
    f.y -= 13;
  }

  f.y -= 10;
  f.need(50);
  f.rule();
  f.y -= 16;
  if (Number(data.credit) > 0) {
    f.text('Credit on account', right - 160, { color: GRAY });
    f.text(usd(data.credit), right - 6, { align: 'right' });
    f.y -= 14;
  }
  f.text('Balance due', right - 160, { size: 11, bold: true, color: accent });
  f.text(usd(data.balanceDue), right - 6, { size: 11, bold: true, align: 'right' });
  f.y -= 18;
  if (org.paymentInstructions) {
    f.y -= 6;
    f.text('HOW TO PAY', left, { size: 7.5, bold: true, color: GRAY });
    f.y -= 12;
    f.paragraph(org.paymentInstructions, left, right - left);
  }
  return f.save();
}
