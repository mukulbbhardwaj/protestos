import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { safe } from './layout.js';

export interface SignatureRecord {
  signerName: string;
  signerEmail: string;
  signedAt: Date;
  ip: string | null;
  reference: string;
  documentTitle: string;
}

/**
 * Electronic signature (mock provider, M6): a line on every page and a certificate page with
 * who signed, when, from where, and the envelope reference. A real provider returns its own
 * signed PDF instead.
 */
export async function stampSignature(pdf: Uint8Array, s: SignatureRecord): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const when = s.signedAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const line = safe(`Signed electronically by ${s.signerName} on ${when} - ref ${s.reference}`);
  for (const page of doc.getPages()) {
    page.drawText(line, { x: 36, y: 14, size: 7, font, color: rgb(0.1, 0.45, 0.25) });
  }
  const cert = doc.addPage([612, 792]);
  let y = 720;
  const row = (label: string, value: string) => {
    cert.drawText(safe(label), { x: 60, y, size: 9, font: bold });
    cert.drawText(safe(value), { x: 200, y, size: 9, font });
    y -= 18;
  };
  cert.drawText('Signature certificate', { x: 60, y: 750, size: 16, font: bold });
  row('Document', s.documentTitle);
  row('Signed by', s.signerName);
  row('Email', s.signerEmail);
  row('Signed at', when);
  row('IP address', s.ip ?? 'not recorded');
  row('Reference', s.reference);
  y -= 10;
  cert.drawText(safe(`${s.signerName} typed their name and agreed to sign electronically.`), {
    x: 60,
    y,
    size: 9,
    font,
    color: rgb(0.35, 0.35, 0.4),
  });
  return doc.save();
}
