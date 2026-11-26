// Demo invoices, payments and hearings for the demo firms (development only, M7), so the
// finance dashboard, invoice lists and hearings calendar have something realistic to show.
// Built from the sample tax-year records; deterministic (seeded); skipped when a firm already
// has demo invoices. Numbers look like LS-2025-0001 so they never clash with issued ones.
import type { Prisma } from '../../src/generated/prisma/client.js';
import type { PrismaClient } from '../../src/raw.js';
import { log } from './common.js';
import { DEMO_ORG, GULF_ORG } from './demo.js';
import { Rng } from './sample-data.js';

const FIRMS = [
  { slug: DEMO_ORG, prefix: 'LS', seed: 4401 },
  { slug: GULF_ORG, prefix: 'GC', seed: 4402 },
];
const DAY = 86_400_000;
const PAID_SHARE: Record<number, number> = { 2024: 0.95, 2025: 0.86, 2026: 0.5 };
const METHODS = [
  ['CHECK', 40],
  ['ZELLE', 30],
  ['ACH', 18],
  ['CARD', 8],
  ['CASH', 4],
] as const;
const LOCATIONS: Record<string, string> = {
  Harris: 'HCAD, 13013 Northwest Fwy, Houston',
  Travis: 'TCAD, 850 E Anderson Ln, Austin',
  'Fort Bend': 'FBCAD, 2801 B F Terry Blvd, Rosenberg',
  Montgomery: 'MCAD, 109 Gladstell St, Conroe',
  Collin: 'CCAD, 250 Eldorado Pkwy, McKinney',
  Denton: 'DCAD, 3911 Morse St, Denton',
  Williamson: 'WCAD, 625 FM 1460, Georgetown',
  Galveston: 'GCAD, 9850 Emmett F Lowry Expy, Texas City',
  Brazoria: 'BCAD, 500 N Chenango St, Angleton',
};

const day = (d: Date) => d.toISOString().slice(0, 10);
const atDay = (d: Date) => new Date(`${day(d)}T00:00:00Z`);
const cents = (v: { toString(): string }) => Math.round(Number(v.toString()) * 100);
const money = (c: number) => (c / 100).toFixed(2);

export async function backfillSampleBilling(prisma: PrismaClient) {
  const today = new Date();
  for (const firm of FIRMS) {
    const org = await prisma.org.findUnique({ where: { slug: firm.slug } });
    if (!org) continue;
    if (
      await prisma.invoice.count({
        where: { orgId: org.id, number: { startsWith: `${firm.prefix}-20` } },
      })
    ) {
      log(`sample-billing: ${firm.slug} already has demo invoices; skipped`);
      continue;
    }
    const r = new Rng(firm.seed);
    const pct = Number(org.defaultContingencyPct.toString()) || 30;
    const staff = (
      await prisma.membership.findMany({
        where: { orgId: org.id, status: 'ACTIVE', role: 'STAFF' },
        select: { userId: true },
      })
    ).map((m) => m.userId);
    const records = await prisma.taxYearRecord.findMany({
      where: {
        orgId: org.id,
        property: { archivedAt: null, contact: { kind: 'CLIENT', archivedAt: null } },
        invoiceLines: { none: {} },
      },
      include: {
        property: {
          select: {
            id: true,
            contactId: true,
            consultantUserId: true,
            county: { select: { name: true } },
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    // ---- Invoices: one per client per year, for settled years with a reduction ----------
    const groups = new Map<string, typeof records>();
    for (const rec of records) {
      if (
        !['SETTLED', 'BOARD_ORDER'].includes(rec.protestStage) ||
        !rec.finalAppraised ||
        !rec.noticeAppraised ||
        !rec.taxRatePct
      )
        continue;
      if (cents(rec.noticeAppraised) <= cents(rec.finalAppraised)) continue;
      const key = `${rec.property.contactId}:${rec.taxYear}`;
      groups.set(key, [...(groups.get(key) ?? []), rec]);
    }
    const seq: Record<number, number> = {};
    let invoices = 0;
    let payments = 0;
    const invoiced: { id: number; stage: 'INVOICED' | 'PAID'; from: string; at: Date }[] = [];
    for (const [key, recs] of groups) {
      const [contactId, year] = key.split(':').map(Number) as [number, number];
      const issue = new Date(Date.UTC(year, 6, 1) + r.int(0, 120) * DAY);
      if (issue > today) continue;
      const due = new Date(issue.getTime() + 30 * DAY);
      const lines = recs.map((rec) => {
        const saved = Math.round(
          ((cents(rec.noticeAppraised!) - cents(rec.finalAppraised!)) *
            Number(rec.taxRatePct!.toString())) /
            100,
        );
        return { rec, amount: Math.max(1, Math.round((saved * pct) / 100)) };
      });
      const total = lines.reduce((s, l) => s + l.amount, 0);
      // How much was paid, and when.
      let paid = 0;
      const pays: { at: Date; amount: number }[] = [];
      if (r.chance(PAID_SHARE[year] ?? 0.5)) {
        const at = new Date(issue.getTime() + r.int(5, 75) * DAY);
        if (at <= today) {
          pays.push({ at, amount: total });
          paid = total;
        }
      } else if (r.chance(0.35)) {
        const at = new Date(issue.getTime() + r.int(10, 50) * DAY);
        if (at <= today) {
          const part = Math.round(total * r.float(0.25, 0.6));
          pays.push({ at, amount: part });
          paid = part;
        }
      }
      const writtenOff = paid < total && year === 2024 && r.chance(0.5);
      const status =
        paid >= total
          ? 'PAID'
          : writtenOff
            ? 'WRITTEN_OFF'
            : paid > 0
              ? 'PARTIALLY_PAID'
              : 'ISSUED';
      seq[year] = (seq[year] ?? 0) + 1;
      const inv = await prisma.invoice.create({
        data: {
          orgId: org.id,
          contactId,
          number: `${firm.prefix}-${year}-${String(seq[year]).padStart(4, '0')}`,
          taxYear: year,
          status,
          issueDate: atDay(issue),
          dueDate: atDay(due),
          template: 'STANDARD',
          subtotal: money(total),
          total: money(total),
          amountPaid: money(paid),
          balance: money(total - paid),
          sentAt: issue,
          ...(writtenOff
            ? {
                writtenOffAt: new Date(due.getTime() + 200 * DAY),
                writeOffReason: 'Uncollectable (demo data)',
              }
            : {}),
        },
      });
      await prisma.invoiceLine.createMany({
        data: lines.map((l, i) => ({
          orgId: org.id,
          invoiceId: inv.id,
          propertyId: l.rec.propertyId,
          taxYearRecordId: l.rec.id,
          kind: 'CONTINGENCY' as const,
          description: `Contingency fee (${pct}% of tax saved)`,
          amount: money(l.amount),
          sortOrder: i,
        })),
      });
      for (const p of pays) {
        const pay = await prisma.payment.create({
          data: {
            orgId: org.id,
            contactId,
            receivedAt: atDay(p.at),
            amount: money(p.amount),
            method: r.weighted(METHODS),
            reference: r.chance(0.6) ? String(r.int(1000, 9999)) : null,
          },
        });
        await prisma.paymentAllocation.create({
          data: { orgId: org.id, paymentId: pay.id, invoiceId: inv.id, amount: money(p.amount) },
        });
        payments += 1;
      }
      for (const l of lines) {
        invoiced.push({
          id: l.rec.id,
          stage: status === 'PAID' ? 'PAID' : 'INVOICED',
          from: l.rec.protestStage,
          at: pays[0]?.at ?? issue,
        });
      }
      invoices += 1;
    }

    // Protest stage follows the money (as it would have in the app).
    const events: Prisma.ProtestStageEventCreateManyInput[] = [];
    for (const s of ['INVOICED', 'PAID'] as const) {
      const ids = invoiced.filter((x) => x.stage === s).map((x) => x.id);
      for (let i = 0; i < ids.length; i += 1000) {
        await prisma.taxYearRecord.updateMany({
          where: { id: { in: ids.slice(i, i + 1000) } },
          data: { protestStage: s },
        });
      }
    }
    for (const x of invoiced) {
      events.push({
        orgId: org.id,
        taxYearRecordId: x.id,
        fromStage: x.from as never,
        toStage: 'INVOICED',
        note: 'Invoice (demo)',
        at: x.at,
        createdAt: x.at,
      });
      if (x.stage === 'PAID')
        events.push({
          orgId: org.id,
          taxYearRecordId: x.id,
          fromStage: 'INVOICED',
          toStage: 'PAID',
          note: 'Paid (demo)',
          at: x.at,
          createdAt: x.at,
        });
    }
    for (let i = 0; i < events.length; i += 5000)
      await prisma.protestStageEvent.createMany({ data: events.slice(i, i + 5000) });

    // ---- Hearings: upcoming for "hearing scheduled", attended for this year's results -----
    const hearings: Prisma.HearingCreateManyInput[] = [];
    const year = today.getUTCFullYear();
    for (const rec of records.filter((x) => x.taxYear === year)) {
      const scheduled = rec.protestStage === 'HEARING_SCHEDULED';
      const attended =
        ['SETTLED', 'BOARD_ORDER', 'NO_CHANGE'].includes(rec.protestStage) && r.chance(0.35);
      if (!scheduled && !attended) continue;
      const base = scheduled
        ? today.getTime() + r.int(-3, 45) * DAY
        : Date.UTC(year, 5, 1) + r.int(0, 80) * DAY;
      const at = new Date(base);
      // 8:30 to 15:30 Central (13:30–20:30 UTC in daylight time), on the half hour, weekdays.
      while ([0, 6].includes(at.getUTCDay())) at.setTime(at.getTime() + DAY);
      at.setUTCHours(13 + r.int(0, 7), r.chance(0.5) ? 0 : 30, 0, 0);
      hearings.push({
        orgId: org.id,
        propertyId: rec.propertyId,
        taxYear: year,
        scheduledAt: at,
        type: r.chance(0.3) ? 'INFORMAL' : 'ARB',
        status: scheduled ? 'SCHEDULED' : 'ATTENDED',
        location:
          LOCATIONS[rec.property.county.name] ?? `${rec.property.county.name} appraisal district`,
        panel: r.chance(0.6) ? String(r.int(1, 40)) : null,
        assignedUserId: rec.property.consultantUserId ?? (staff.length ? r.pick(staff) : null),
      });
    }
    for (let i = 0; i < hearings.length; i += 2000)
      await prisma.hearing.createMany({ data: hearings.slice(i, i + 2000) });
    log(
      `sample-billing: ${firm.slug}: ${invoices} invoices, ${payments} payments, ${hearings.length} hearings`,
    );
  }
}

/** Removes demo billing and hearings (and anything else hanging off sample records) before a reset. */
export async function resetSampleBilling(prisma: PrismaClient, orgId: number) {
  const where = { orgId };
  await prisma.hearing.deleteMany({ where });
  await prisma.emailDelivery.deleteMany({ where });
  await prisma.document.deleteMany({ where });
  await prisma.signatureEnvelope.deleteMany({ where });
  await prisma.paymentAllocation.deleteMany({ where });
  await prisma.payment.deleteMany({ where });
  await prisma.invoiceLine.deleteMany({ where });
  await prisma.invoice.deleteMany({ where });
}
