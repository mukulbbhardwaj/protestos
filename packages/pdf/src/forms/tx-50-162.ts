import { PDFCheckBox, PDFDocument, PDFTextField } from 'pdf-lib';

// Texas Form 50-162, Appointment of Agent for Property Tax Matters (BUILD_PLAN 8.8).
//
// FIELD_MAP maps what we fill to the fillable PDF's field names. Several names are listed per
// item so a form revision that renames a field still fills; the first one present wins.
// VERIFY these against the official PDF (assets/README.md) before relying on them: the names
// below follow the form's printed labels and are not yet checked against the file.

export interface Form50162Data {
  owner: { name: string; address: string; phone: string | null; email: string | null };
  /** Appraisal district for the listed accounts. */
  appraisalDistrict: string;
  /** Up to 6 accounts on the form itself; more go on the continuation page. */
  properties: { accountNumber: string; address: string }[];
  agent: {
    name: string;
    title: string | null;
    address: string;
    phone: string | null;
    license: string | null;
  };
  taxYear: number;
}

type TextKey =
  | 'ownerName'
  | 'ownerAddress'
  | 'ownerPhone'
  | 'ownerEmail'
  | 'appraisalDistrict'
  | 'agentName'
  | 'agentTitle'
  | 'agentAddress'
  | 'agentPhone'
  | 'agentLicense';

export const FIELD_MAP: {
  text: Record<TextKey, string[]>;
  property: { account: string[]; address: string[] };
  /** "Authorized to act on all property tax matters" (Step 4). */
  allMatters: string[];
} = {
  text: {
    ownerName: ['Owner Name', 'Name of property owner', 'Property Owner Name'],
    ownerAddress: ['Owner Address', 'Mailing address city state ZIP code'],
    ownerPhone: ['Owner Phone', 'Telephone Number area code and number'],
    ownerEmail: ['Owner Email', 'Email address'],
    appraisalDistrict: ['Appraisal District Name', 'Appraisal District'],
    agentName: ['Agent Name', 'Name of agent for property tax matters'],
    agentTitle: ['Agent Title', 'Title'],
    agentAddress: ['Agent Address', 'Agent mailing address'],
    agentPhone: ['Agent Phone', 'Agent telephone number'],
    agentLicense: ['Agent License', 'Agent ID Number'],
  },
  property: {
    // Numbered 1..6 on the form: "Account Number 1", "Property Address 1", ...
    account: ['Account Number {n}', 'Appraisal District Account Number {n}'],
    address: ['Property Address {n}', 'Physical address legal description {n}'],
  },
  allMatters: ['All Property Tax Matters', 'all property tax matters'],
};

export const FORM_PROPERTY_ROWS = 6;

/**
 * Fills the official form. Returns the filled PDF and any mapped item whose field wasn't
 * found (so a renamed field shows up as a warning instead of a silently blank form).
 */
export async function fill50162(
  blank: Uint8Array,
  data: Form50162Data,
): Promise<{ pdf: Uint8Array; missing: string[] }> {
  const doc = await PDFDocument.load(blank);
  const form = doc.getForm();
  const names = new Set(form.getFields().map((f) => f.getName()));
  const missing: string[] = [];
  const pick = (candidates: string[], n?: number) =>
    candidates.map((c) => c.replace('{n}', String(n))).find((c) => names.has(c));
  const setText = (label: string, candidates: string[], value: string | null, n?: number) => {
    if (!value) return;
    const name = pick(candidates, n);
    const field = name ? form.getField(name) : null;
    if (field instanceof PDFTextField) field.setText(value);
    else missing.push(label);
  };

  const t = FIELD_MAP.text;
  setText('owner name', t.ownerName, data.owner.name);
  setText('owner address', t.ownerAddress, data.owner.address);
  setText('owner phone', t.ownerPhone, data.owner.phone);
  setText('owner email', t.ownerEmail, data.owner.email);
  setText('appraisal district', t.appraisalDistrict, data.appraisalDistrict);
  setText('agent name', t.agentName, data.agent.name);
  setText('agent title', t.agentTitle, data.agent.title);
  setText('agent address', t.agentAddress, data.agent.address);
  setText('agent phone', t.agentPhone, data.agent.phone);
  setText('agent license', t.agentLicense, data.agent.license);
  data.properties.slice(0, FORM_PROPERTY_ROWS).forEach((p, i) => {
    setText(`account ${i + 1}`, FIELD_MAP.property.account, p.accountNumber, i + 1);
    setText(`property address ${i + 1}`, FIELD_MAP.property.address, p.address, i + 1);
  });
  const all = pick(FIELD_MAP.allMatters);
  const box = all ? form.getField(all) : null;
  if (box instanceof PDFCheckBox) box.check();
  else missing.push('all property tax matters checkbox');

  return { pdf: await doc.save(), missing };
}

/** Field names in a fillable PDF, for checking FIELD_MAP against a new form revision. */
export async function listFormFields(pdf: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(pdf);
  return doc
    .getForm()
    .getFields()
    .map((f) => `${f.constructor.name.replace('PDF', '')}: ${f.getName()}`);
}
