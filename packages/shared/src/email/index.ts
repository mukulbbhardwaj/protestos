// Email templates (BUILD_PLAN 5.8). Plain text with {{placeholders}}: firms edit words, not
// HTML, so a template can never inject markup. Rendering escapes every value.

export const EMAIL_TEMPLATE_KEYS = [
  'INVOICE',
  'INVOICE_ZERO_SAVINGS',
  'PAYMENT_RECEIPT',
  'DOC_REMINDER',
  'PROSPECT_OUTREACH',
] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export const DELIVERY_STATUSES = [
  'QUEUED',
  'SENT',
  'DELIVERED',
  'OPENED',
  'BOUNCED',
  'FAILED',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const MAIL_EVENT_TYPES = ['delivered', 'opened', 'bounced', 'complained'] as const;
export type MailEventType = (typeof MAIL_EVENT_TYPES)[number];

/** Where a delivery ends up after an event; bounces win over everything else. */
export function nextDeliveryStatus(current: DeliveryStatus, event: MailEventType): DeliveryStatus {
  if (current === 'BOUNCED' || event === 'bounced' || event === 'complained') return 'BOUNCED';
  if (event === 'opened') return 'OPENED';
  return current === 'OPENED' ? 'OPENED' : 'DELIVERED';
}

const ORG = {
  'org.name': 'Lone Star Tax Consultants',
  'org.phone': '(713) 555-0100',
  'org.website': 'https://example.com',
  'org.paymentInstructions':
    'Zelle billing@example.com, or mail a check to 100 Main St, Houston, TX 77002.',
};
const CLIENT = { 'client.displayName': 'Jane Smith', 'client.clientNumber': '1042' };
const INVOICE = {
  'invoice.number': 'INV-0042',
  'invoice.taxYear': '2026',
  'invoice.total': '$1,240.50',
  'invoice.balance': '$1,240.50',
  'invoice.dueDate': 'Oct 15, 2026',
  'invoice.propertyCount': '2',
};

/** Placeholders each template can use, with the sample values the preview shows. */
export const TEMPLATE_PLACEHOLDERS: Record<EmailTemplateKey, Record<string, string>> = {
  INVOICE: { ...ORG, ...CLIENT, ...INVOICE },
  INVOICE_ZERO_SAVINGS: { ...ORG, ...CLIENT, ...INVOICE },
  PAYMENT_RECEIPT: {
    ...ORG,
    ...CLIENT,
    'payment.amount': '$500.00',
    'payment.receivedAt': 'Oct 2, 2026',
    'payment.method': 'Check',
    'payment.reference': '1234',
    'client.balance': '$740.50',
  },
  DOC_REMINDER: {
    ...ORG,
    ...CLIENT,
    'document.name': 'Appointment of Agent (Form 50-162)',
    'document.link': 'https://example.com/sign/abc',
  },
  PROSPECT_OUTREACH: {
    ...ORG,
    ...CLIENT,
    'estimate.savings': '$860',
    'property.address': '1700 St Charles St, Houston',
  },
};

export interface EmailTemplateContent {
  subject: string;
  body: string;
}

export const DEFAULT_TEMPLATES: Record<EmailTemplateKey, EmailTemplateContent & { name: string }> =
  {
    INVOICE: {
      name: 'Invoice',
      subject: 'Invoice {{invoice.number}} from {{org.name}}',
      body: [
        'Hi {{client.displayName}},',
        'Good news: we lowered your {{invoice.taxYear}} property values. Your invoice {{invoice.number}} for {{invoice.total}} is attached, with the savings for each property.',
        'It is due by {{invoice.dueDate}}.',
        'How to pay:\n{{org.paymentInstructions}}',
        'Thank you for trusting us with your protest.\n{{org.name}}\n{{org.phone}}',
      ].join('\n\n'),
    },
    INVOICE_ZERO_SAVINGS: {
      name: 'Invoice (no reduction)',
      subject: 'Your {{invoice.taxYear}} protest results from {{org.name}}',
      body: [
        'Hi {{client.displayName}},',
        "We protested your {{invoice.taxYear}} values but weren't able to get a reduction this year, so there is no contingency fee. Invoice {{invoice.number}} for your flat service fee of {{invoice.total}} is attached.",
        'It is due by {{invoice.dueDate}}.',
        'How to pay:\n{{org.paymentInstructions}}',
        "We'll be watching your values again next year.\n{{org.name}}\n{{org.phone}}",
      ].join('\n\n'),
    },
    PAYMENT_RECEIPT: {
      name: 'Payment receipt',
      subject: 'Payment received: thank you',
      body: [
        'Hi {{client.displayName}},',
        'We received your payment of {{payment.amount}} on {{payment.receivedAt}} ({{payment.method}} {{payment.reference}}).',
        'Your remaining balance is {{client.balance}}.',
        'Thank you,\n{{org.name}}',
      ].join('\n\n'),
    },
    DOC_REMINDER: {
      name: 'Document reminder',
      subject: 'Reminder: please sign your {{document.name}}',
      body: [
        'Hi {{client.displayName}},',
        'We still need your signature on the {{document.name}} so we can file your protest.',
        'Sign here: {{document.link}}',
        'Thank you,\n{{org.name}}\n{{org.phone}}',
      ].join('\n\n'),
    },
    PROSPECT_OUTREACH: {
      name: 'Prospect outreach',
      subject: 'You may be overpaying property tax on {{property.address}}',
      body: [
        'Hi {{client.displayName}},',
        'Based on similar homes nearby, we estimate you could save about {{estimate.savings}} a year by protesting the value of {{property.address}}.',
        "We only charge if we lower your taxes. Reply to this email and we'll take care of the rest.",
        '{{org.name}}\n{{org.phone}}',
      ].join('\n\n'),
    },
  };

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Placeholders a template uses that its key doesn't offer (typos), in order of first use. */
export function unknownPlaceholders(
  key: EmailTemplateKey,
  content: EmailTemplateContent,
): string[] {
  const known = TEMPLATE_PLACEHOLDERS[key];
  const out: string[] = [];
  for (const m of `${content.subject}\n${content.body}`.matchAll(PLACEHOLDER)) {
    const name = m[1]!;
    if (!(name in known) && !out.includes(name)) out.push(name);
  }
  return out;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Fills placeholders; values missing from `vars` render empty. */
export function renderTemplate(
  content: EmailTemplateContent,
  vars: Record<string, string | null | undefined>,
): { subject: string; html: string; text: string } {
  const fill = (s: string) => s.replace(PLACEHOLDER, (_, name: string) => vars[name] ?? '');
  const subject = fill(content.subject).replace(/\s+/g, ' ').trim();
  const text = fill(content.body)
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1c20">\n${paragraphs}\n</div>`;
  return { subject, html, text };
}
