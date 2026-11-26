// Hearings calendar helpers (BUILD_PLAN 8.5): CAD local times and the iCal feed.

export const HEARING_TYPES = ['INFORMAL', 'ARB', 'ARBITRATION', 'LITIGATION'] as const;
export type HearingType = (typeof HEARING_TYPES)[number];
export const HEARING_STATUSES = [
  'SCHEDULED',
  'ATTENDED',
  'RESCHEDULED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export type HearingStatus = (typeof HEARING_STATUSES)[number];

export const HEARING_TYPE_LABELS: Record<HearingType, string> = {
  INFORMAL: 'Informal',
  ARB: 'ARB hearing',
  ARBITRATION: 'Arbitration',
  LITIGATION: 'Litigation',
};

/** Offset (minutes east of UTC) of a time zone at an instant, e.g. -300 for CDT. */
function offsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const local = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'));
  return Math.round((local - at.getTime()) / 60_000);
}

/**
 * A wall-clock time in a zone (CAD schedules are local) → the UTC instant.
 * "2026-06-15" + "09:30" in America/Chicago → 2026-06-15T14:30:00Z (CDT).
 */
export function zonedToUtc(day: string, time: string, timeZone = 'America/Chicago'): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  // Two passes settle the offset across a DST change.
  let at = new Date(guess.getTime() - offsetMinutes(timeZone, guess) * 60_000);
  at = new Date(guess.getTime() - offsetMinutes(timeZone, at) * 60_000);
  return at;
}

/** "9:30 AM", "09:30", "2pm", "14:05" → "HH:MM" (24-hour), or null. */
export function parseTime(raw: string): string | null {
  const m =
    /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m?\.?\s*$/i.exec(raw) ??
    /^\s*(\d{1,2}):(\d{2})\s*$/.exec(raw);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ampm = m[3]?.toLowerCase();
  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (ampm === 'p' && h !== 12) h += 12;
    if (ampm === 'a' && h === 12) h = 0;
  }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export interface CalendarEvent {
  uid: string;
  start: Date;
  minutes: number;
  summary: string;
  description?: string;
  location?: string;
  updated: Date;
  cancelled?: boolean;
}

const ics = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** Folds lines at 75 octets as RFC 5545 asks (ASCII-safe approximation: 73 chars + CRLF + space). */
function fold(line: string): string {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += 73) out.push(line.slice(i, i + 73));
  return out.join('\r\n ');
}

/** A read-only iCal feed (subscribed to from Google or Outlook). */
export function buildICalendar(name: string, events: CalendarEvent[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ProtestOS//Hearings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${ics(name)}`,
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp(e.updated)}`,
      `DTSTART:${stamp(e.start)}`,
      `DTEND:${stamp(new Date(e.start.getTime() + e.minutes * 60_000))}`,
      `SUMMARY:${ics(e.summary)}`,
      ...(e.description ? [`DESCRIPTION:${ics(e.description)}`] : []),
      ...(e.location ? [`LOCATION:${ics(e.location)}`] : []),
      `STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
