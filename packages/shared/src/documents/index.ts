// Documents (BUILD_PLAN 5.7, 8.8): the engagement contract's wording and what it can fill in.

export const DOCUMENT_KINDS = ['ENGAGEMENT_CONTRACT', 'AOA_50_162'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_STATUSES = [
  'DRAFT',
  'SENT',
  'VIEWED',
  'SIGNED',
  'DECLINED',
  'VOIDED',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_TITLES: Record<DocumentKind, string> = {
  ENGAGEMENT_CONTRACT: 'Engagement agreement',
  AOA_50_162: 'Appointment of Agent (Form 50-162)',
};

/** Where the properties table goes in the contract; it must be on a line of its own. */
export const PROPERTIES_TABLE = 'properties.table';

/** Contract placeholders, with the sample values the editor preview shows. */
export const CONTRACT_PLACEHOLDERS: Record<string, string> = {
  'org.name': 'Lone Star Tax Consultants',
  'org.address': '100 Main St, Houston, TX 77002',
  'org.phone': '(713) 555-0100',
  'agent.name': 'Lone Star Tax Consultants',
  'agent.license': 'PTC-12345',
  'client.displayName': 'Jane Smith',
  'client.address': '123 Elm St, Houston, TX 77005',
  contingencyPct: '30%',
  flatFee: '$0.00',
  taxYear: '2026',
  date: 'November 26, 2026',
  [PROPERTIES_TABLE]: '',
};

export const DEFAULT_CONTRACT = {
  name: 'Engagement agreement',
  body: [
    'PROPERTY TAX CONSULTING AGREEMENT',
    'This agreement is made on {{date}} between {{client.displayName}} ("Owner"), of {{client.address}}, and {{org.name}} ("Consultant"), of {{org.address}}.',
    '1. Services. Owner engages Consultant to protest the {{taxYear}} appraised values of the properties below before the appraisal district and the appraisal review board, including informal reviews and hearings, and to advise Owner on settlement offers.',
    '{{properties.table}}',
    '2. Fee. Owner will pay Consultant {{contingencyPct}} of the property tax saved for {{taxYear}}: the reduction in value multiplied by the tax rate. If there is no reduction, no contingency fee is owed. A flat service fee of {{flatFee}} per property also applies. Invoices are due 30 days after they are sent.',
    '3. Appointment of agent. Owner will sign Texas Comptroller Form 50-162 appointing {{agent.name}} as agent for these properties.',
    '4. Owner duties. Owner will send Consultant any notice of appraised value received, and tell Consultant about any damage, sale or change to the properties.',
    '5. Term. This agreement covers the {{taxYear}} tax year and renews for each later year unless either party cancels in writing before January 31 of that year.',
    'By signing, Owner agrees to these terms.',
  ].join('\n\n'),
};

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Placeholders the contract uses that don't exist, in order of first use. */
export function unknownContractPlaceholders(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(PLACEHOLDER)) {
    if (!(m[1]! in CONTRACT_PLACEHOLDERS) && !out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}

export type ContractBlock = { type: 'text'; text: string } | { type: 'properties' };

/** Fills the contract into paragraphs; a paragraph that is just the table placeholder becomes the table. */
export function renderContract(body: string, vars: Record<string, string>): ContractBlock[] {
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p): ContractBlock =>
      new RegExp(`^\\{\\{\\s*${PROPERTIES_TABLE.replace('.', '\\.')}\\s*\\}\\}$`).test(p)
        ? { type: 'properties' }
        : {
            type: 'text',
            text: p.replace(PLACEHOLDER, (_, name: string) => vars[name] ?? '').trim(),
          },
    );
}
