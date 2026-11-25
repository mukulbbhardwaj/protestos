// Realistic sample data for the demo firms: clients, prospects, properties across Texas
// counties, three tax years of values and protest-stage history.
//
// Deterministic (seeded PRNG): the same firm always gets the same data. Skips a firm that
// already has contacts, so re-running never duplicates anything. Development only.
import type { Prisma } from '../../src/generated/prisma/client.js';
import type { PrismaClient } from '../../src/raw.js';
import { DEMO_ORG, GULF_ORG } from './demo.js';
import { log } from './common.js';

// ---------------------------------------------------------------------------
// Deterministic randomness

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float(min = 0, max = 1) {
    return min + this.next() * (max - min);
  }
  int(min: number, max: number) {
    return Math.floor(this.float(min, max + 1));
  }
  chance(p: number) {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [item, w] of items) {
      r -= w;
      if (r <= 0) return item;
    }
    return items.at(-1)![0];
  }
  digits(n: number) {
    let s = '';
    for (let i = 0; i < n; i++) s += String(this.int(0, 9));
    return s;
  }
  date(year: number, fromMonth: number, toMonth: number) {
    const start = Date.UTC(year, fromMonth - 1, 1);
    const end = Date.UTC(year, toMonth, 0);
    return new Date(start + Math.floor(this.next() * (end - start)));
  }
}

// ---------------------------------------------------------------------------
// Texas flavour

interface CountyProfile {
  name: string;
  weight: number;
  /** Typical combined tax rate (%). */
  rate: number;
  cities: readonly (readonly [string, string])[]; // [city, zip prefix]
  phone: readonly string[];
  account: (r: Rng) => string;
}

const COUNTY_PROFILES: Record<string, CountyProfile> = {
  Harris: {
    name: 'Harris',
    weight: 30,
    rate: 2.21,
    cities: [
      ['Houston', '770'],
      ['Katy', '774'],
      ['Spring', '773'],
      ['Pasadena', '775'],
      ['Humble', '773'],
      ['Cypress', '774'],
    ],
    phone: ['713', '281', '832'],
    account: (r) => `${r.pick(['0', '1'])}${r.digits(12)}`, // 13 digits
  },
  Dallas: {
    name: 'Dallas',
    weight: 18,
    rate: 2.26,
    cities: [
      ['Dallas', '752'],
      ['Irving', '750'],
      ['Garland', '750'],
      ['Richardson', '750'],
      ['Mesquite', '751'],
    ],
    phone: ['214', '469', '972'],
    account: (r) => `${r.digits(5)}${r.digits(6)}${'0'.repeat(6)}`, // 17 chars
  },
  Travis: {
    name: 'Travis',
    weight: 14,
    rate: 1.93,
    cities: [
      ['Austin', '787'],
      ['Pflugerville', '786'],
      ['Lakeway', '787'],
      ['Manor', '786'],
    ],
    phone: ['512', '737'],
    account: (r) => String(r.int(100000, 999999)),
  },
  Tarrant: {
    name: 'Tarrant',
    weight: 13,
    rate: 2.3,
    cities: [
      ['Fort Worth', '761'],
      ['Arlington', '760'],
      ['Keller', '762'],
      ['Grapevine', '760'],
      ['Southlake', '760'],
    ],
    phone: ['817', '682'],
    account: (r) => `0${r.digits(7)}`,
  },
  Bexar: {
    name: 'Bexar',
    weight: 10,
    rate: 2.34,
    cities: [
      ['San Antonio', '782'],
      ['Converse', '781'],
      ['Helotes', '780'],
      ['Schertz', '781'],
    ],
    phone: ['210', '726'],
    account: (r) => `${r.digits(5)}${r.digits(3)}${r.digits(4)}`,
  },
  'Fort Bend': {
    name: 'Fort Bend',
    weight: 8,
    rate: 2.45,
    cities: [
      ['Sugar Land', '774'],
      ['Richmond', '774'],
      ['Missouri City', '774'],
      ['Fulshear', '774'],
    ],
    phone: ['281', '832'],
    account: (r) => `R${r.digits(6)}`,
  },
  Collin: {
    name: 'Collin',
    weight: 7,
    rate: 2.02,
    cities: [
      ['Plano', '750'],
      ['McKinney', '750'],
      ['Frisco', '750'],
      ['Allen', '750'],
    ],
    phone: ['469', '972'],
    account: (r) => `R-${r.digits(4)}-${r.digits(3)}-${r.digits(4)}-1`,
  },
  Galveston: {
    name: 'Galveston',
    weight: 0,
    rate: 2.28,
    cities: [
      ['Galveston', '775'],
      ['League City', '775'],
      ['Friendswood', '775'],
      ['Texas City', '775'],
    ],
    phone: ['409', '281'],
    account: (r) => r.digits(6),
  },
  Brazoria: {
    name: 'Brazoria',
    weight: 0,
    rate: 2.31,
    cities: [
      ['Pearland', '775'],
      ['Alvin', '775'],
      ['Lake Jackson', '775'],
      ['Angleton', '775'],
    ],
    phone: ['979', '281'],
    account: (r) => r.digits(6),
  },
  Montgomery: {
    name: 'Montgomery',
    weight: 0,
    rate: 2.05,
    cities: [
      ['The Woodlands', '773'],
      ['Conroe', '773'],
      ['Magnolia', '773'],
      ['Montgomery', '773'],
    ],
    phone: ['936', '281'],
    account: (r) => `R${r.digits(6)}`,
  },
};

const FIRST = [
  'James',
  'Mary',
  'Robert',
  'Patricia',
  'John',
  'Jennifer',
  'Michael',
  'Linda',
  'David',
  'Elizabeth',
  'William',
  'Barbara',
  'Richard',
  'Susan',
  'Joseph',
  'Jessica',
  'Thomas',
  'Sarah',
  'Carlos',
  'Karen',
  'Daniel',
  'Lisa',
  'Matthew',
  'Nancy',
  'Anthony',
  'Sandra',
  'Mark',
  'Ashley',
  'Jose',
  'Kimberly',
  'Luis',
  'Emily',
  'Juan',
  'Donna',
  'Kevin',
  'Michelle',
  'Brian',
  'Carol',
  'Hector',
  'Amanda',
  'Wei',
  'Melissa',
  'Anh',
  'Deborah',
  'Raj',
  'Stephanie',
  'Omar',
  'Rebecca',
  'Tyler',
  'Laura',
  'Ricardo',
  'Sharon',
  'Grace',
  'Ana',
  'Tom',
  'Rosa',
  'Minh',
  'Fatima',
  'Ethan',
  'Hannah',
];
const LAST = [
  'Smith',
  'Johnson',
  'Williams',
  'Brown',
  'Jones',
  'Garcia',
  'Miller',
  'Davis',
  'Rodriguez',
  'Martinez',
  'Hernandez',
  'Lopez',
  'Gonzalez',
  'Wilson',
  'Anderson',
  'Thomas',
  'Taylor',
  'Moore',
  'Jackson',
  'Martin',
  'Lee',
  'Perez',
  'Thompson',
  'White',
  'Harris',
  'Sanchez',
  'Clark',
  'Ramirez',
  'Lewis',
  'Robinson',
  'Walker',
  'Young',
  'Allen',
  'King',
  'Wright',
  'Scott',
  'Torres',
  'Nguyen',
  'Hill',
  'Flores',
  'Green',
  'Adams',
  'Nelson',
  'Baker',
  'Hall',
  'Rivera',
  'Campbell',
  'Mitchell',
  'Carter',
  'Roberts',
  'Patel',
  'Tran',
  'Kim',
  'Cruz',
  'Reyes',
  'Morales',
  'Ortiz',
  'Gutierrez',
  'Chavez',
  'Ramos',
];
const COMPANY_WORDS = [
  'Lone Star',
  'Bluebonnet',
  'Pecan',
  'Brazos',
  'Trinity',
  'Gulf',
  'Hill Country',
  'Prairie',
  'Cypress',
  'Live Oak',
  'Mesquite',
  'Red River',
  'Alamo',
  'Riverbend',
  'Cedar Creek',
  'Stonegate',
  'Westpark',
  'Northgate',
  'Granite',
  'Sabine',
];
const COMPANY_KINDS = [
  'Holdings LLC',
  'Properties LLC',
  'Investments LP',
  'Real Estate LLC',
  'Partners LP',
  'Development Corp',
  'Capital LLC',
  'Ventures LLC',
  'Retail Center LLC',
  'Industrial LP',
];
const STREETS = [
  'Oak',
  'Elm',
  'Main',
  'Cedar',
  'Pecan',
  'Magnolia',
  'Willow',
  'Live Oak',
  'Bluebonnet',
  'Lakeview',
  'Sunset',
  'Highland',
  'Meadow',
  'Ridge',
  'Post Oak',
  'Westheimer',
  'Preston',
  'Lamar',
  'Congress',
  'Camp Bowie',
  'Broadway',
  'Shiloh',
  'Coit',
  'Kirby',
  'Memorial',
];
const STREET_TYPES = ['St', 'Ave', 'Dr', 'Ln', 'Blvd', 'Ct', 'Way', 'Pkwy', 'Trl'];

type Stage =
  | 'NOT_STARTED'
  | 'AOA_SIGNED'
  | 'NOTICE_RECEIVED'
  | 'PROTEST_FILED'
  | 'HEARING_SCHEDULED'
  | 'SETTLED'
  | 'BOARD_ORDER'
  | 'NO_CHANGE'
  | 'WITHDRAWN';
type PropertyType = 'RESIDENTIAL' | 'COMMERCIAL' | 'BPP' | 'LAND' | 'OTHER';

const money = (n: number) => (Math.round(n / 10) * 10).toFixed(2); // CADs round to $10

function addressFor(r: Rng, county: CountyProfile) {
  const [city, zipPrefix] = r.pick(county.cities);
  const line1 = `${r.int(100, 19999)} ${r.pick(STREETS)} ${r.pick(STREET_TYPES)}`;
  return { line1, line2: null, city, state: 'TX', zip: `${zipPrefix}${r.digits(2)}` };
}

function phoneFor(r: Rng, county: CountyProfile) {
  return `(${r.pick(county.phone)}) 555-${String(r.int(100, 9999)).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------

interface FirmPlan {
  slug: string;
  seed: number;
  clients: number;
  prospects: number;
  counties: readonly (readonly [string, number])[];
  emailDomain: string;
}

const PLANS: FirmPlan[] = [
  {
    slug: DEMO_ORG,
    seed: 2026,
    clients: 900,
    prospects: 120,
    counties: Object.values(COUNTY_PROFILES)
      .filter((c) => c.weight > 0)
      .map((c) => [c.name, c.weight] as const),
    emailDomain: 'example.com',
  },
  {
    slug: GULF_ORG,
    seed: 77550,
    clients: 260,
    prospects: 45,
    counties: [
      ['Harris', 40],
      ['Galveston', 25],
      ['Brazoria', 15],
      ['Fort Bend', 10],
      ['Montgomery', 10],
    ],
    emailDomain: 'example.net',
  },
];

const TAX_YEARS = [2024, 2025, 2026] as const;
const CURRENT_YEAR = 2026;

/** Removes the sample data (contacts, properties, tax years, history) from the demo firms. */
export async function resetSampleData(prisma: PrismaClient) {
  for (const plan of PLANS) {
    const org = await prisma.org.findUnique({ where: { slug: plan.slug } });
    if (!org) continue;
    const where = { orgId: org.id };
    await prisma.taxYearRecord.deleteMany({ where }); // cascades to stage events
    await prisma.property.deleteMany({ where });
    const removed = await prisma.contact.deleteMany({ where });
    await prisma.auditLog.deleteMany({
      where: { ...where, entityType: { in: ['Contact', 'Property', 'TaxYearRecord'] } },
    });
    await prisma.org.update({ where: { id: org.id }, data: { nextClientNumber: 1001 } });
    log(`sample: reset ${plan.slug} (${removed.count} contacts removed)`);
  }
}

export async function backfillSampleData(prisma: PrismaClient) {
  const counties = await prisma.county.findMany({ where: { state: 'TX' } });
  const countyId = new Map(counties.map((c) => [c.name, c.id]));
  if (countyId.size < 254) throw new Error('Run the counties backfill first.');

  for (const plan of PLANS) {
    const org = await prisma.org.findUnique({ where: { slug: plan.slug } });
    if (!org) {
      log(`sample: firm ${plan.slug} not found; run the demo backfill first`);
      continue;
    }
    const existing = await prisma.contact.count({ where: { orgId: org.id } });
    if (existing > 0) {
      log(`sample: ${plan.slug} already has ${existing} contacts; skipped`);
      continue;
    }
    await fillFirm(prisma, org.id, org.nextClientNumber, plan, countyId);
  }
}

async function fillFirm(
  prisma: PrismaClient,
  orgId: number,
  firstClientNumber: number,
  plan: FirmPlan,
  countyId: Map<string, number>,
) {
  const r = new Rng(plan.seed);
  const started = Date.now();
  const members = await prisma.membership.findMany({
    where: { orgId, status: 'ACTIVE' },
    include: { user: { select: { id: true, name: true } } },
  });
  const consultantIds = members.filter((m) => m.role === 'STAFF').map((m) => m.userId);
  const actorIds = members.map((m) => m.userId);
  const usedEmails = new Set<string>();
  const usedAccounts = new Set<string>();

  // ---- Contacts --------------------------------------------------------------
  const contacts: Prisma.ContactCreateManyInput[] = [];
  const contactMeta: {
    company: boolean;
    county: CountyProfile;
    archived: boolean;
    sinceYear: number;
    mailing: ReturnType<typeof addressFor>;
  }[] = [];
  let clientNumber = firstClientNumber;

  const total = plan.clients + plan.prospects;
  for (let i = 0; i < total; i++) {
    const isClient = i < plan.clients;
    const county = COUNTY_PROFILES[r.weighted(plan.counties)]!;
    const company = r.chance(isClient ? 0.24 : 0.15);
    const first = r.pick(FIRST);
    const last = r.pick(LAST);
    const displayName = company
      ? r.chance(0.2)
        ? `${last} Family Trust`
        : `${r.pick(COMPANY_WORDS)} ${r.pick(COMPANY_KINDS)}`
      : r.chance(0.12)
        ? `${first} & ${r.pick(FIRST)} ${last}`
        : `${first} ${last}`;

    let email: string | null = null;
    if (r.chance(0.93)) {
      const base = company
        ? `${r.pick(['accounting', 'ap', 'office', 'admin', first.toLowerCase()])}.${displayName
            .split(' ')[0]!
            .toLowerCase()
            .replace(/[^a-z]/g, '')}`
        : `${first.toLowerCase()}.${last.toLowerCase()}`;
      let candidate = `${base}@${plan.emailDomain}`;
      let n = 2;
      while (usedEmails.has(candidate)) candidate = `${base}${n++}@${plan.emailDomain}`;
      usedEmails.add(candidate);
      email = candidate;
    }

    const mailing = addressFor(r, county);
    // Clients signed up over the past ~7 years; most recent years busiest.
    const sinceYear = isClient
      ? r.weighted([
          [2019, 6],
          [2020, 8],
          [2021, 10],
          [2022, 13],
          [2023, 16],
          [2024, 18],
          [2025, 17],
          [2026, 12],
        ])
      : CURRENT_YEAR;
    const convertedAt = isClient
      ? r.date(sinceYear, 1, sinceYear === CURRENT_YEAR ? 10 : 12)
      : null;
    const createdAt = isClient
      ? new Date(convertedAt!.getTime() - r.int(3, 40) * 86_400_000)
      : new Date(Date.UTC(2026, 10, 25) - r.int(0, 150) * 86_400_000);
    const archived = isClient && r.chance(0.04);

    contacts.push({
      orgId,
      kind: isClient ? 'CLIENT' : 'PROSPECT',
      status: isClient
        ? null
        : r.weighted([
            ['NEW', 35],
            ['CONTACTED', 30],
            ['DOCS_SENT', 18],
            ['SIGNED', 5],
            ['LOST', 12],
          ] as const),
      clientNumber: isClient ? String(clientNumber++) : null,
      displayName,
      entityType: company ? 'COMPANY' : 'INDIVIDUAL',
      email,
      billingEmail: company && email && r.chance(0.5) ? email.replace(/^[^.]+/, 'billing') : null,
      phone: r.chance(0.9) ? phoneFor(r, county) : null,
      mailingAddress: mailing,
      billingAddress: company && r.chance(0.3) ? addressFor(r, county) : undefined,
      nameOnCad: company
        ? displayName.toUpperCase()
        : `${last.toUpperCase()} ${first.toUpperCase()}`,
      contingencyPct: r.chance(0.15) ? r.pick(['25', '27.5', '33', '35', '40']) : null,
      flatFee: company && r.chance(0.25) ? r.pick(['150', '250', '350', '500']) : null,
      bppFee: null,
      source: isClient
        ? r.weighted([
            ['MANUAL', 40],
            ['REFERRAL', 30],
            ['WEB_FORM', 20],
            ['IMPORT', 10],
          ] as const)
        : r.weighted([
            ['WEB_FORM', 55],
            ['REFERRAL', 25],
            ['MANUAL', 20],
          ] as const),
      notes: r.chance(0.08)
        ? r.pick([
            'Prefers email over phone.',
            'Owner is out of state; send everything to the billing contact.',
            'Referred by an existing client.',
            'Ask about adding their rental properties next year.',
            'Paid late last year; send reminders early.',
          ])
        : null,
      convertedAt,
      archivedAt: archived ? r.date(2025, 1, 12) : null,
      createdAt,
    });
    contactMeta.push({ company, county, archived, sinceYear, mailing });
  }

  const createdContacts: { id: number }[] = [];
  for (let i = 0; i < contacts.length; i += 1000) {
    createdContacts.push(
      ...(await prisma.contact.createManyAndReturn({
        data: contacts.slice(i, i + 1000),
        select: { id: true },
      })),
    );
  }
  await prisma.org.update({ where: { id: orgId }, data: { nextClientNumber: clientNumber } });

  // ---- Properties ------------------------------------------------------------
  interface PropMeta {
    type: PropertyType;
    county: CountyProfile;
    homestead: boolean;
    baseMarket: number;
    firstYear: number;
    clientSince: number;
    isProspect: boolean;
  }
  const properties: Prisma.PropertyCreateManyInput[] = [];
  const propMeta: PropMeta[] = [];

  createdContacts.forEach((c, idx) => {
    const meta = contactMeta[idx]!;
    const isProspect = contacts[idx]!.kind === 'PROSPECT';
    const count = isProspect
      ? r.weighted([
          [1, 80],
          [2, 15],
          [3, 5],
        ] as const)
      : meta.company
        ? r.weighted([
            [1, 10],
            [2, 20],
            [3, 18],
            [4, 14],
            [5, 10],
            [6, 8],
            [8, 8],
            [10, 6],
            [14, 4],
            [20, 2],
          ] as const)
        : r.weighted([
            [1, 58],
            [2, 24],
            [3, 12],
            [4, 6],
          ] as const);

    for (let p = 0; p < count; p++) {
      // Most properties sit in the owner's home county; some elsewhere in the firm's area.
      const county =
        p === 0 || r.chance(0.75) ? meta.county : COUNTY_PROFILES[r.weighted(plan.counties)]!;
      const type: PropertyType = meta.company
        ? r.weighted([
            ['COMMERCIAL', 55],
            ['BPP', 18],
            ['LAND', 14],
            ['RESIDENTIAL', 10],
            ['OTHER', 3],
          ] as const)
        : r.weighted([
            ['RESIDENTIAL', 88],
            ['LAND', 7],
            ['OTHER', 3],
            ['COMMERCIAL', 2],
          ] as const);
      let account = county.account(r);
      while (usedAccounts.has(`${county.name}:${account}`)) account = county.account(r);
      usedAccounts.add(`${county.name}:${account}`);

      const baseMarket = {
        RESIDENTIAL: r.weighted([
          [r.float(180_000, 350_000), 45],
          [r.float(350_000, 700_000), 38],
          [r.float(700_000, 2_400_000), 17],
        ] as const),
        COMMERCIAL: r.weighted([
          [r.float(600_000, 2_500_000), 55],
          [r.float(2_500_000, 12_000_000), 35],
          [r.float(12_000_000, 48_000_000), 10],
        ] as const),
        BPP: r.float(40_000, 2_200_000),
        LAND: r.float(60_000, 1_800_000),
        OTHER: r.float(80_000, 900_000),
      }[type];
      // An individual's first property is usually their home (same as the mailing address).
      const situs =
        p === 0 && !meta.company && type === 'RESIDENTIAL' ? meta.mailing : addressFor(r, county);
      const firstYear = isProspect
        ? CURRENT_YEAR + 1
        : Math.max(2024, meta.sinceYear + (p > 0 && r.chance(0.2) ? 1 : 0));

      properties.push({
        orgId,
        contactId: c.id,
        accountNumber: account,
        countyId: countyId.get(county.name)!,
        situsAddress: situs,
        situsLine: `${situs.line1}, ${situs.city}, TX ${situs.zip}`,
        propertyType: type,
        consultantUserId: consultantIds.length && r.chance(0.92) ? r.pick(consultantIds) : null,
        contingencyPct: r.chance(0.04) ? r.pick(['20', '25', '35']) : null,
        flatFee: null,
        bppFee: type === 'BPP' ? r.pick(['250', '350', '500', '750']) : null,
        notes: r.chance(0.04)
          ? r.pick([
              'Pool and detached garage.',
              'Foundation issues documented in 2024.',
              'Vacant since tenant left.',
              'Recent sale comps available.',
              'Flood damage: photos on file.',
            ])
          : null,
        archivedAt: meta.archived ? contacts[idx]!.archivedAt : null,
        archivedWithContact: meta.archived,
      });
      propMeta.push({
        type,
        county,
        homestead: type === 'RESIDENTIAL' && !meta.company && r.chance(0.7),
        baseMarket,
        firstYear,
        clientSince: meta.sinceYear,
        isProspect,
      });
    }
  });

  const createdProps: { id: number }[] = [];
  for (let i = 0; i < properties.length; i += 1000) {
    createdProps.push(
      ...(await prisma.property.createManyAndReturn({
        data: properties.slice(i, i + 1000),
        select: { id: true },
      })),
    );
  }

  // ---- Tax years and stage history --------------------------------------------
  const records: Prisma.TaxYearRecordCreateManyInput[] = [];
  /** Per record, the stages it passed through and when. */
  const histories: { stage: Stage; at: Date }[][] = [];

  createdProps.forEach((prop, idx) => {
    const m = propMeta[idx]!;
    let market = m.baseMarket;
    let prevAppraised: number | null = null;
    const rate = Math.max(1.4, m.county.rate + r.float(-0.25, 0.25));

    for (const year of TAX_YEARS) {
      // Values rise most years; the 2024 Texas market cooled a little.
      market *= year === 2024 ? r.float(0.97, 1.06) : r.float(1.01, 1.09);
      if (year < m.firstYear) {
        prevAppraised = market;
        continue;
      }
      const noticeMarket = market;
      const landShare = m.type === 'LAND' ? 1 : m.type === 'BPP' ? 0 : r.float(0.18, 0.38);
      // Homestead cap: appraised value can't rise more than 10% a year.
      const noticeAppraised: number =
        m.homestead && prevAppraised ? Math.min(noticeMarket, prevAppraised * 1.1) : noticeMarket;

      const inProgress = year === CURRENT_YEAR;
      const stage: Stage = inProgress
        ? r.weighted([
            ['SETTLED', 50],
            ['BOARD_ORDER', 12],
            ['NO_CHANGE', 13],
            ['WITHDRAWN', 3],
            ['HEARING_SCHEDULED', 10],
            ['PROTEST_FILED', 5],
            ['NOTICE_RECEIVED', 3],
            ['AOA_SIGNED', 2],
            ['NOT_STARTED', 2],
          ] as const)
        : r.weighted([
            ['SETTLED', 58],
            ['BOARD_ORDER', 16],
            ['NO_CHANGE', 20],
            ['WITHDRAWN', 6],
          ] as const);
      const resolved = ['SETTLED', 'BOARD_ORDER', 'NO_CHANGE', 'WITHDRAWN'].includes(stage);
      const hasNotice = !['NOT_STARTED', 'AOA_SIGNED'].includes(stage);

      let finalMarket: number | null = null;
      let finalAppraised: number | null = null;
      if (resolved) {
        const cut =
          stage === 'SETTLED'
            ? r.float(0.02, 0.12)
            : stage === 'BOARD_ORDER'
              ? r.float(0.03, 0.16)
              : 0;
        finalMarket = noticeMarket * (1 - cut);
        finalAppraised =
          m.homestead && prevAppraised ? Math.min(finalMarket, prevAppraised * 1.1) : finalMarket;
      }

      const noticeAt = r.date(year, 4, 4);
      const filedAt = new Date(noticeAt.getTime() + r.int(5, 35) * 86_400_000);
      const arbitration =
        inProgress && stage === 'HEARING_SCHEDULED' && m.type === 'COMMERCIAL' && r.chance(0.3);
      const resultAt = resolved ? r.date(year, 6, m.type === 'COMMERCIAL' ? 10 : 8) : null;

      records.push({
        orgId,
        propertyId: prop.id,
        taxYear: year,
        noticeLand: hasNotice ? money(noticeMarket * landShare) : null,
        noticeImprovement: hasNotice ? money(noticeMarket * (1 - landShare)) : null,
        noticeMarket: hasNotice ? money(noticeMarket) : null,
        noticeAppraised: hasNotice ? money(noticeAppraised) : null,
        finalLand: finalMarket !== null ? money(finalMarket * landShare) : null,
        finalImprovement: finalMarket !== null ? money(finalMarket * (1 - landShare)) : null,
        finalMarket: finalMarket !== null ? money(finalMarket) : null,
        finalAppraised: finalAppraised !== null ? money(finalAppraised) : null,
        taxRatePct: rate.toFixed(4),
        bppRenderedAt: m.type === 'BPP' && hasNotice ? r.date(year, 3, 4) : null,
        bppFee: null,
        underLitigation:
          inProgress && m.type === 'COMMERCIAL' && stage === 'BOARD_ORDER' && r.chance(0.08),
        underArbitration: arbitration,
        homestead: m.homestead,
        protestStage: stage,
        noticeReceivedAt: hasNotice ? noticeAt : null,
        protestFiledAt: hasNotice && stage !== 'NOTICE_RECEIVED' ? filedAt : null,
        resultType: resolved
          ? (
              {
                SETTLED: 'SETTLEMENT',
                BOARD_ORDER: 'BOARD_ORDER',
                NO_CHANGE: 'NO_CHANGE',
                WITHDRAWN: 'WITHDRAWN',
              } as const
            )[stage as 'SETTLED']
          : null,
        resultAt,
        // 0 is a real 0% (a favour for a long-standing client).
        contingencyPctOverride: r.chance(0.01) ? r.pick(['0', '20', '25']) : null,
        notes: null,
      });

      // Stage path for the history log.
      const order: Stage[] = [
        'NOT_STARTED',
        'AOA_SIGNED',
        'NOTICE_RECEIVED',
        'PROTEST_FILED',
        'HEARING_SCHEDULED',
      ];
      const path: Stage[] = resolved
        ? [
            ...order.slice(
              1,
              stage === 'WITHDRAWN' ? 4 : stage === 'SETTLED' && r.chance(0.6) ? 4 : 5,
            ),
            stage,
          ]
        : order.slice(1, order.indexOf(stage) + 1);
      const signedAt = new Date(Date.UTC(year, 0, 5) + r.int(0, 60) * 86_400_000);
      const hearingAt = new Date(filedAt.getTime() + r.int(10, 40) * 86_400_000);
      const at: Record<Stage, Date> = {
        NOT_STARTED: signedAt,
        AOA_SIGNED: signedAt,
        NOTICE_RECEIVED: noticeAt,
        PROTEST_FILED: filedAt,
        HEARING_SCHEDULED: hearingAt,
        SETTLED: resultAt ?? hearingAt,
        BOARD_ORDER: resultAt ?? hearingAt,
        NO_CHANGE: resultAt ?? hearingAt,
        WITHDRAWN: resultAt ?? hearingAt,
      };
      histories.push(path.map((stage) => ({ stage, at: at[stage] })));
      // Next year's homestead cap is measured from this year's appraised value.
      prevAppraised = finalAppraised ?? noticeAppraised;
    }
  });

  const createdRecords: { id: number }[] = [];
  for (let i = 0; i < records.length; i += 2000) {
    createdRecords.push(
      ...(await prisma.taxYearRecord.createManyAndReturn({
        data: records.slice(i, i + 2000),
        select: { id: true },
      })),
    );
  }

  const events: Prisma.ProtestStageEventCreateManyInput[] = [];
  createdRecords.forEach((rec, i) => {
    let from: Stage = 'NOT_STARTED';
    histories[i]!.forEach(({ stage: to, at }) => {
      events.push({
        orgId,
        taxYearRecordId: rec.id,
        fromStage: from,
        toStage: to,
        note: null,
        actorUserId: actorIds.length ? r.pick(actorIds) : null,
        at,
        createdAt: at,
      });
      from = to;
    });
  });
  for (let i = 0; i < events.length; i += 5000) {
    await prisma.protestStageEvent.createMany({ data: events.slice(i, i + 5000) });
  }

  log(
    `sample: ${plan.slug}: ${plan.clients} clients, ${plan.prospects} prospects, ` +
      `${createdProps.length} properties, ${createdRecords.length} tax-year records, ` +
      `${events.length} stage events (${((Date.now() - started) / 1000).toFixed(1)}s)`,
  );
}
