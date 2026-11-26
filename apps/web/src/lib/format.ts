import type { OrgRole } from '@app/shared';

export const ROLE_LABELS: Record<OrgRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  STAFF: 'Staff',
  READ_ONLY: 'Read only',
};

export const ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
  OWNER: 'Everything, including billing and the subscription',
  ADMIN: 'Everything except the subscription',
  STAFF: 'Clients, properties, hearings and invoices',
  READ_ONLY: 'View only',
};

/** BUILD_PLAN 11: dates are MM/DD/YYYY in the org's timezone. */
export function formatDate(iso: string | null | undefined, timeZone = 'America/Chicago'): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

export function formatDateTime(iso: string, timeZone = 'America/Chicago'): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** BUILD_PLAN 11: money is always $1,234.56. */
export function formatMoney(value: string | number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    Number(value),
  );
}

export function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

/** A calendar date (YYYY-MM-DD, no time zone) as MM/DD/YYYY, without shifting the day. */
export function formatDay(day: string | null | undefined): string {
  if (!day) return '—';
  const [y, m, d] = day.slice(0, 10).split('-');
  return `${m}/${d}/${y}`;
}
