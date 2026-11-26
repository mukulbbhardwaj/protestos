import type { ContractBlock } from '@app/shared';
import { Flow, GRAY, hexColor, PAGE, RULE } from './layout.js';
import type { PdfOrg } from './invoice.js';

export interface ContractPdfData {
  org: PdfOrg;
  title: string;
  blocks: ContractBlock[];
  properties: { county: string; accountNumber: string; address: string | null }[];
  signer: { name: string; email: string };
}

/** The engagement agreement (BUILD_PLAN 8.8): the firm's wording, the properties, a signature block. */
export async function renderContractPdf(data: ContractPdfData): Promise<Uint8Array> {
  const f = await Flow.create(`${data.org.name} - ${data.title}`);
  const left = PAGE.margin;
  const right = PAGE.width - PAGE.margin;
  f.band(6, hexColor(data.org.primaryColor));
  f.y -= 6;
  f.text(data.org.name, left, { size: 14, bold: true });
  f.y -= 13;
  f.text(data.org.addressLines.join(' - '), left, { color: GRAY, size: 8.5 });
  f.y -= 22;

  for (const block of data.blocks) {
    if (block.type === 'properties') {
      f.need(30);
      f.text('COUNTY', left + 6, { size: 7.5, bold: true, color: GRAY });
      f.text('ACCOUNT', left + 100, { size: 7.5, bold: true, color: GRAY });
      f.text('PROPERTY ADDRESS', left + 240, { size: 7.5, bold: true, color: GRAY });
      f.y -= 6;
      f.rule();
      f.y -= 12;
      for (const p of data.properties) {
        f.need(14);
        f.text(p.county, left + 6);
        f.text(p.accountNumber, left + 100);
        f.text(p.address ?? '', left + 240);
        f.y -= 13;
      }
      f.rule(RULE);
      f.y -= 14;
      continue;
    }
    const heading = block.text === block.text.toUpperCase() && block.text.length < 80;
    f.paragraph(block.text, left, right - left, heading ? { size: 12, bold: true } : { size: 9.5 });
    f.y -= heading ? 8 : 7;
  }

  f.need(90);
  f.y -= 20;
  f.text('OWNER', left, { size: 7.5, bold: true, color: GRAY });
  f.y -= 30;
  f.page.drawLine({
    start: { x: left, y: f.y },
    end: { x: left + 240, y: f.y },
    thickness: 0.6,
    color: GRAY,
  });
  f.y -= 12;
  f.text(`${data.signer.name}  (${data.signer.email})`, left);
  f.y -= 12;
  f.text('Signature and date', left, { size: 7.5, color: GRAY });
  return f.save();
}
