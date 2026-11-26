import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATES,
  EMAIL_TEMPLATE_KEYS,
  nextDeliveryStatus,
  renderTemplate,
  TEMPLATE_PLACEHOLDERS,
  unknownPlaceholders,
} from './index.js';

describe('email templates', () => {
  it('ships defaults that use only known placeholders', () => {
    for (const key of EMAIL_TEMPLATE_KEYS) {
      expect(unknownPlaceholders(key, DEFAULT_TEMPLATES[key])).toEqual([]);
      const r = renderTemplate(DEFAULT_TEMPLATES[key], TEMPLATE_PLACEHOLDERS[key]);
      expect(r.text).not.toMatch(/\{\{/);
    }
  });

  it('finds typos once each', () => {
    expect(
      unknownPlaceholders('INVOICE', {
        subject: '{{invoice.numbr}}',
        body: '{{ invoice.numbr }} {{payment.amount}}',
      }),
    ).toEqual(['invoice.numbr', 'payment.amount']);
  });

  it('escapes values and keeps paragraphs and line breaks', () => {
    const r = renderTemplate(
      {
        subject: '  Invoice\n{{invoice.number}} ',
        body: 'Hi {{client.displayName}},  \n\nLine 1\nLine 2 {{missing}}',
      },
      { 'invoice.number': 'INV-1', 'client.displayName': '<b>Jane & Co</b>' },
    );
    expect(r.subject).toBe('Invoice INV-1');
    expect(r.text).toBe('Hi <b>Jane & Co</b>,\n\nLine 1\nLine 2');
    expect(r.html).toContain('<p>Hi &lt;b&gt;Jane &amp; Co&lt;/b&gt;,</p>');
    expect(r.html).toContain('<p>Line 1<br>Line 2</p>');
  });
});

describe('nextDeliveryStatus', () => {
  it('moves forward and lets bounces win', () => {
    expect(nextDeliveryStatus('SENT', 'delivered')).toBe('DELIVERED');
    expect(nextDeliveryStatus('DELIVERED', 'opened')).toBe('OPENED');
    expect(nextDeliveryStatus('OPENED', 'delivered')).toBe('OPENED');
    expect(nextDeliveryStatus('DELIVERED', 'bounced')).toBe('BOUNCED');
    expect(nextDeliveryStatus('SENT', 'complained')).toBe('BOUNCED');
    expect(nextDeliveryStatus('BOUNCED', 'opened')).toBe('BOUNCED');
  });
});
