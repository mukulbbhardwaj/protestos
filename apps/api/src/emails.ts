import { APP_CONFIG } from '@app/shared';
import type { MailMessage } from '@app/providers';

// Platform emails (account and team). Per-org editable templates arrive in M5.

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function layout(title: string, body: string, cta: { label: string; url: string }): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f172a;max-width:560px;margin:0 auto;padding:24px">
<h1 style="font-size:20px">${escapeHtml(title)}</h1>
${body}
<p><a href="${escapeHtml(cta.url)}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${escapeHtml(cta.label)}</a></p>
<p style="color:#64748b;font-size:13px">Or paste this link into your browser:<br>${escapeHtml(cta.url)}</p>
<p style="color:#64748b;font-size:13px">${escapeHtml(APP_CONFIG.displayName)}</p>
</body></html>`;
}

export function verifyEmail(to: string, name: string, url: string): MailMessage {
  return {
    to,
    orgId: null,
    tag: 'verify-email',
    subject: `Confirm your email for ${APP_CONFIG.displayName}`,
    text: `Hi ${name},\n\nConfirm your email address: ${url}\n\nThis link expires in 24 hours.`,
    html: layout(
      'Confirm your email',
      `<p>Hi ${escapeHtml(name)}, confirm your email address to finish setting up your account. This link expires in 24 hours.</p>`,
      { label: 'Confirm email', url },
    ),
  };
}

export function resetPassword(to: string, url: string): MailMessage {
  return {
    to,
    orgId: null,
    tag: 'reset-password',
    subject: `Reset your ${APP_CONFIG.displayName} password`,
    text: `Reset your password: ${url}\n\nThis link expires in 1 hour. If you didn't ask for this, ignore this email.`,
    html: layout(
      'Reset your password',
      `<p>Use the button below to choose a new password. This link expires in 1 hour. If you didn't ask for this, you can ignore this email.</p>`,
      { label: 'Choose a new password', url },
    ),
  };
}

export function invitation(
  to: string,
  orgId: number,
  orgName: string,
  inviterName: string,
  role: string,
  url: string,
): MailMessage {
  const roleLabel = role.replace('_', ' ').toLowerCase();
  return {
    to,
    orgId,
    tag: 'invitation',
    subject: `${inviterName} invited you to ${orgName}`,
    text: `${inviterName} invited you to join ${orgName} as ${roleLabel}.\n\nAccept: ${url}\n\nThis invitation expires in 7 days.`,
    html: layout(
      `Join ${orgName}`,
      `<p>${escapeHtml(inviterName)} invited you to join <strong>${escapeHtml(orgName)}</strong> as <strong>${escapeHtml(roleLabel)}</strong>. This invitation expires in 7 days.</p>`,
      { label: 'Accept invitation', url },
    ),
  };
}
