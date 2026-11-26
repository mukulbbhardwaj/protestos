import {
  HEARING_TYPES,
  parseChoice,
  parseTime,
  zonedToUtc,
  type HearingType,
  type ProtestStage,
} from '@app/shared';
import {
  accountKey,
  countyLookup,
  parseAccount,
  parseRow,
  rowValues,
  summarize,
  type ImportContext,
  type ImportInput,
  type ImportOutcome,
  type Mode,
  type RowResult,
} from './common.js';

// Hearing schedules (BUILD_PLAN 8.5): appraisal districts send lists of hearings. Rows match
// the firm's property by county + account; a hearing is matched on property + tax year + type,
// so re-importing an updated schedule reschedules instead of duplicating.

const TYPE_ALIASES: Record<string, HearingType> = {
  INFORMAL_MEETING: 'INFORMAL',
  INFORMAL_REVIEW: 'INFORMAL',
  APPRAISAL_REVIEW_BOARD: 'ARB',
  FORMAL: 'ARB',
  HEARING: 'ARB',
  BINDING_ARBITRATION: 'ARBITRATION',
  LAWSUIT: 'LITIGATION',
};
/** Stages a new hearing moves a property-year out of. */
export const BEFORE_HEARING: ProtestStage[] = [
  'NOT_STARTED',
  'AOA_SIGNED',
  'NOTICE_RECEIVED',
  'PROTEST_FILED',
];

export async function importHearings(
  ctx: ImportContext,
  input: ImportInput,
  mode: Mode,
): Promise<ImportOutcome> {
  const { db, orgId } = ctx;
  const county = await countyLookup(db);
  const rows = rowValues(input).map((values) => ({ values, ...parseRow('HEARINGS', values) }));
  const countyIds = [
    ...new Set(
      rows
        .map((r) => county(r.values.get('county') ?? '')?.id)
        .filter((x): x is number => x !== undefined),
    ),
  ];
  const properties = new Map<string, { id: number; accountNumber: string }>();
  if (countyIds.length) {
    for (const p of await db.property.findMany({
      where: { countyId: { in: countyIds } },
      select: { id: true, countyId: true, accountNumber: true },
    })) {
      properties.set(accountKey(p.countyId, p.accountNumber), p);
    }
  }
  const members = new Map(
    (
      await db.membership.findMany({
        where: { status: 'ACTIVE' },
        select: { userId: true, user: { select: { email: true } } },
      })
    ).map((m) => [m.user.email.toLowerCase(), m.userId]),
  );
  const hearings = new Map<
    string,
    {
      id: number;
      scheduledAt: Date;
      location: string | null;
      panel: string | null;
      assignedUserId: number | null;
    }
  >();
  const ids = [...properties.values()].map((p) => p.id);
  for (let i = 0; i < ids.length; i += 1000) {
    for (const h of await db.hearing.findMany({
      where: {
        propertyId: { in: ids.slice(i, i + 1000) },
        deletedAt: null,
        status: { not: 'CANCELLED' },
      },
    })) {
      hearings.set(`${h.propertyId}:${h.taxYear}:${h.type}`, h);
    }
  }

  let tempId = -1;
  const results: RowResult[] = [];
  for (const [i, row] of rows.entries()) {
    const rowNumber = i + 1;
    const messages = [...row.errors, ...row.warnings];
    const label =
      [row.values.get('county'), row.values.get('accountNumber'), row.values.get('hearingDate')]
        .filter(Boolean)
        .join(' ') || null;
    const fail = (m?: string) =>
      results.push({
        rowNumber,
        action: 'ERROR',
        label,
        changes: [],
        messages: m ? [m, ...messages] : messages,
      });
    if (row.errors.length) {
      fail();
      continue;
    }
    const missing = (['county', 'accountNumber', 'hearingDate'] as const).filter(
      (k) => !row.values.has(k),
    );
    if (missing.length) {
      fail(
        `Missing ${missing.map((k) => ({ county: 'county', accountNumber: 'account number', hearingDate: 'hearing date' })[k]).join(', ')}.`,
      );
      continue;
    }
    const c = county(row.values.get('county')!);
    if (!c) {
      fail(`County: "${row.values.get('county')}" isn't a Texas county.`);
      continue;
    }
    const acct = parseAccount(row.values.get('accountNumber')!, c);
    if (!acct.ok) {
      fail(`CAD account number: ${acct.error}`);
      continue;
    }
    const property = properties.get(accountKey(c.id, acct.value));
    if (!property) {
      fail(`No property with account ${acct.value} in ${c.name} in your firm.`);
      continue;
    }
    const time = row.values.has('hearingTime')
      ? parseTime(row.values.get('hearingTime')!)
      : '09:00';
    if (!time) {
      fail(`Hearing time: "${row.values.get('hearingTime')}" isn't a time. Use 9:30 AM or 14:30.`);
      continue;
    }
    const type = row.values.has('hearingType')
      ? parseChoice(row.values.get('hearingType')!, HEARING_TYPES, TYPE_ALIASES)
      : ({ ok: true, value: 'ARB' } as const);
    if (!type.ok) {
      fail(`Type: ${type.error}`);
      continue;
    }
    const email = row.parsed.get('consultantEmail') as string | undefined;
    const assignedUserId = email ? members.get(email) : undefined;
    if (email && assignedUserId === undefined) {
      fail(`Consultant: ${email} isn't an active member of your firm.`);
      continue;
    }
    const day = row.parsed.get('hearingDate') as string;
    const taxYear = (row.parsed.get('taxYear') as number | undefined) ?? Number(day.slice(0, 4));
    const scheduledAt = zonedToUtc(day, time);
    const location = row.values.get('location') ?? null;
    const panel = row.values.get('panel') ?? null;
    const key = `${property.id}:${taxYear}:${type.value}`;
    const existing = hearings.get(key);
    const label2 = `${c.name} ${property.accountNumber} · ${day} ${time}`;
    try {
      if (!existing) {
        let id = tempId--;
        if (mode === 'apply') {
          id = (
            await db.hearing.create({
              data: {
                orgId,
                propertyId: property.id,
                taxYear,
                scheduledAt,
                type: type.value,
                location,
                panel,
                assignedUserId: assignedUserId ?? null,
              },
              select: { id: true },
            })
          ).id;
          await moveToHearingScheduled(ctx, property.id, taxYear);
        }
        hearings.set(key, {
          id,
          scheduledAt,
          location,
          panel,
          assignedUserId: assignedUserId ?? null,
        });
        results.push({ rowNumber, action: 'CREATE', label: label2, changes: [], messages });
        continue;
      }
      const changes: string[] = [];
      const update: Record<string, unknown> = {};
      if (existing.scheduledAt.getTime() !== scheduledAt.getTime()) {
        changes.push('date and time');
        update.scheduledAt = scheduledAt;
        update.status = 'SCHEDULED';
      }
      // Blank cells never erase.
      if (location && location !== existing.location) {
        changes.push('location');
        update.location = location;
      }
      if (panel && panel !== existing.panel) {
        changes.push('panel');
        update.panel = panel;
      }
      if (assignedUserId !== undefined && assignedUserId !== existing.assignedUserId) {
        changes.push('consultant');
        update.assignedUserId = assignedUserId;
      }
      if (changes.length && mode === 'apply' && existing.id > 0) {
        await db.hearing.update({ where: { id: existing.id }, data: update });
      }
      Object.assign(existing, update);
      results.push({
        rowNumber,
        action: changes.length ? 'UPDATE' : 'UNCHANGED',
        label: label2,
        changes,
        messages,
      });
    } catch (e) {
      fail(`Couldn't save the hearing: ${(e as Error).message.split('\n').at(-1)}`);
    }
  }
  return { rows: results, summary: summarize(results) };
}

/** A scheduled hearing moves its property-year to HEARING_SCHEDULED (creating the year if needed). */
export async function moveToHearingScheduled(
  ctx: ImportContext,
  propertyId: number,
  taxYear: number,
) {
  const { db, orgId, actorUserId } = ctx;
  const rec = await db.taxYearRecord.findFirst({ where: { propertyId, taxYear } });
  if (rec && !BEFORE_HEARING.includes(rec.protestStage)) return;
  const id = rec
    ? (
        await db.taxYearRecord.update({
          where: { id: rec.id },
          data: { protestStage: 'HEARING_SCHEDULED' },
        })
      ).id
    : (
        await db.taxYearRecord.create({
          data: { orgId, propertyId, taxYear, protestStage: 'HEARING_SCHEDULED' },
        })
      ).id;
  await db.protestStageEvent.create({
    data: {
      orgId,
      taxYearRecordId: id,
      fromStage: rec?.protestStage ?? null,
      toStage: 'HEARING_SCHEDULED',
      note: 'Hearing scheduled',
      actorUserId,
    },
  });
}
