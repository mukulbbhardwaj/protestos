import { parseChoice, type ImportAction } from '@app/shared';
import {
  accountKey,
  combine,
  countyLookup,
  parseAccount,
  parseRow,
  rowValues,
  sameValue,
  summarize,
  type ImportContext,
  type ImportInput,
  type ImportOutcome,
  type Mode,
  type RowResult,
} from './common.js';

// Clients + properties (BUILD_PLAN 8.9): a row is a client, optionally with one property.
// Clients match on client number, then email, then the owner of the row's property; properties
// match on (county, account number). Blank cells never erase anything.

interface ContactState {
  id: number;
  kind: 'CLIENT' | 'PROSPECT';
  clientNumber: string | null;
  displayName: string;
  entityType: 'INDIVIDUAL' | 'COMPANY';
  email: string | null;
  billingEmail: string | null;
  phone: string | null;
  mailingAddress: Record<string, unknown> | null;
  nameOnCad: string | null;
  contingencyPct: unknown;
  flatFee: unknown;
  bppFee: unknown;
  notes: string | null;
  convertedAt: Date | null;
}

interface PropertyState {
  id: number;
  countyId: number;
  contactId: number;
  accountNumber: string;
  situsLine: string | null;
  situsAddress: Record<string, unknown> | null;
  propertyType: string;
  consultantUserId: number | null;
  contingencyPct: unknown;
  flatFee: unknown;
  bppFee: unknown;
  notes: string | null;
}

const CONTACT_SELECT = {
  id: true,
  kind: true,
  clientNumber: true,
  displayName: true,
  entityType: true,
  email: true,
  billingEmail: true,
  phone: true,
  mailingAddress: true,
  nameOnCad: true,
  contingencyPct: true,
  flatFee: true,
  bppFee: true,
  notes: true,
  convertedAt: true,
} as const;

const PROPERTY_TYPES = ['RESIDENTIAL', 'COMMERCIAL', 'BPP', 'LAND', 'OTHER'] as const;
const PROPERTY_ALIASES = {
  RES: 'RESIDENTIAL',
  HOME: 'RESIDENTIAL',
  SINGLE_FAMILY: 'RESIDENTIAL',
  COM: 'COMMERCIAL',
  COMM: 'COMMERCIAL',
  BUSINESS_PERSONAL_PROPERTY: 'BPP',
  PERSONAL: 'BPP',
  VACANT_LAND: 'LAND',
  LOT: 'LAND',
} as const;
const KIND_ALIASES = { LEAD: 'PROSPECT', CUSTOMER: 'CLIENT' } as const;
const ENTITY_ALIASES = {
  PERSON: 'INDIVIDUAL',
  RESIDENTIAL: 'INDIVIDUAL',
  BUSINESS: 'COMPANY',
  COMMERCIAL: 'COMPANY',
  LLC: 'COMPANY',
  INC: 'COMPANY',
  CORP: 'COMPANY',
  CORPORATION: 'COMPANY',
  TRUST: 'COMPANY',
  PARTNERSHIP: 'COMPANY',
} as const;

const CONTACT_FIELD_LABELS: Record<string, string> = {
  displayName: 'name',
  entityType: 'entity type',
  email: 'email',
  billingEmail: 'billing email',
  phone: 'phone',
  mailingAddress: 'mailing address',
  nameOnCad: 'name on CAD',
  contingencyPct: 'contingency %',
  flatFee: 'flat fee',
  bppFee: 'BPP fee',
  notes: 'notes',
  kind: 'converted to client',
};

const chunks = <T>(items: T[], size = 1000) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, i * size + size),
  );

export async function importContacts(
  ctx: ImportContext,
  input: ImportInput,
  mode: Mode,
): Promise<ImportOutcome> {
  const { db, orgId } = ctx;
  const county = await countyLookup(db);
  const parsedRows = rowValues(input).map((values) => ({
    values,
    ...parseRow('CONTACTS_PROPERTIES', values),
  }));

  // --- Preload everything the rows refer to, in a few queries.
  const numbers = [
    ...new Set(parsedRows.map((r) => r.parsed.get('clientNumber') as string).filter(Boolean)),
  ];
  const emails = [
    ...new Set(parsedRows.map((r) => r.parsed.get('email') as string).filter(Boolean)),
  ];
  const countyIds = [
    ...new Set(
      parsedRows
        .map((r) => (r.values.get('county') ? county(r.values.get('county')!)?.id : undefined))
        .filter((id): id is number => id !== undefined),
    ),
  ];
  const contacts = new Map<number, ContactState>();
  const byNumber = new Map<string, number>();
  const byEmail = new Map<string, number>();
  const remember = (c: ContactState) => {
    contacts.set(c.id, c);
    if (c.clientNumber) byNumber.set(c.clientNumber, c.id);
    if (c.email) byEmail.set(c.email, c.id);
  };
  for (const part of chunks(numbers)) {
    for (const c of await db.contact.findMany({
      where: { clientNumber: { in: part } },
      select: CONTACT_SELECT,
    })) {
      remember(c as ContactState);
    }
  }
  for (const part of chunks(emails)) {
    for (const c of await db.contact.findMany({
      where: { email: { in: part } },
      select: CONTACT_SELECT,
    })) {
      if (!contacts.has(c.id)) remember(c as ContactState);
    }
  }
  const properties = new Map<string, PropertyState>();
  if (countyIds.length) {
    const rows = await db.property.findMany({
      where: { countyId: { in: countyIds } },
      select: {
        id: true,
        countyId: true,
        contactId: true,
        accountNumber: true,
        situsLine: true,
        situsAddress: true,
        propertyType: true,
        consultantUserId: true,
        contingencyPct: true,
        flatFee: true,
        bppFee: true,
        notes: true,
      },
    });
    for (const p of rows)
      properties.set(accountKey(p.countyId, p.accountNumber), p as PropertyState);
  }
  // Owners of the properties rows mention, for matching rows that have no number or email.
  const ownerIds = [...new Set([...properties.values()].map((p) => p.contactId))].filter(
    (id) => !contacts.has(id),
  );
  for (const part of chunks(ownerIds)) {
    for (const c of await db.contact.findMany({
      where: { id: { in: part } },
      select: CONTACT_SELECT,
    })) {
      remember(c as ContactState);
    }
  }
  const members = await db.membership.findMany({
    where: { status: 'ACTIVE' },
    select: { userId: true, user: { select: { email: true } } },
  });
  const consultantByEmail = new Map(members.map((m) => [m.user.email.toLowerCase(), m.userId]));

  // Client numbers for new clients: the firm's counter, skipping any number already in use.
  const org = await db.org.findFirstOrThrow({ select: { nextClientNumber: true } });
  let nextNumber = org.nextClientNumber;
  const taken = new Set([...numbers]);
  const takeNumber = () => {
    while (taken.has(String(nextNumber)) || byNumber.has(String(nextNumber))) nextNumber++;
    const n = String(nextNumber++);
    taken.add(n);
    return n;
  };

  let tempId = -1;
  const byLocalName = new Map<string, number>();
  const results: RowResult[] = [];

  for (const [i, row] of parsedRows.entries()) {
    const rowNumber = i + 1;
    const messages = [...row.errors, ...row.warnings];
    const fail = (message?: string) =>
      results.push({
        rowNumber,
        action: 'ERROR',
        label: (row.values.get('displayName') ?? row.values.get('clientNumber') ?? null) || null,
        changes: [],
        messages: message ? [message, ...messages] : messages,
      });
    if (row.errors.length) {
      fail();
      continue;
    }
    const p = row.parsed;
    const get = (k: string) => p.get(k) as string | undefined;

    // --- Choices
    const kindChoice = get('kind')
      ? parseChoice(get('kind')!, ['CLIENT', 'PROSPECT'] as const, KIND_ALIASES)
      : null;
    const entityChoice = get('entityType')
      ? parseChoice(get('entityType')!, ['INDIVIDUAL', 'COMPANY'] as const, ENTITY_ALIASES)
      : null;
    const typeChoice = get('propertyType')
      ? parseChoice(get('propertyType')!, PROPERTY_TYPES, PROPERTY_ALIASES)
      : null;
    const choiceError = [
      ['Client or prospect', kindChoice],
      ['Individual or company', entityChoice],
      ['Property type', typeChoice],
    ].find(([, c]) => c && !(c as { ok: boolean }).ok);
    if (choiceError) {
      fail(`${choiceError[0]}: ${(choiceError[1] as { error: string }).error}`);
      continue;
    }

    // --- Property reference (county + account)
    const hasProperty = row.values.has('county') || row.values.has('accountNumber');
    let propertyCounty: { id: number; name: string } | null = null;
    let account: string | null = null;
    if (hasProperty) {
      if (!row.values.has('county') || !row.values.has('accountNumber')) {
        fail('A property needs both a county and an account number.');
        continue;
      }
      propertyCounty = county(row.values.get('county')!);
      if (!propertyCounty) {
        fail(`County: "${row.values.get('county')}" isn't a Texas county.`);
        continue;
      }
      const acct = parseAccount(row.values.get('accountNumber')!, propertyCounty);
      if (!acct.ok) {
        fail(`CAD account number: ${acct.error}`);
        continue;
      }
      account = acct.value;
      if (acct.warning) messages.push(`CAD account number: ${acct.warning}`);
    }
    const existingProperty =
      propertyCounty && account
        ? properties.get(accountKey(propertyCounty.id, account))
        : undefined;

    // --- Which client
    // The property's owner only stands in when the row has no client number or email: a row
    // naming a different client must not edit the owner.
    const hasKey = Boolean(get('clientNumber') || get('email'));
    let contactId: number | undefined =
      (get('clientNumber') && byNumber.get(get('clientNumber')!)) ||
      (get('email') && byEmail.get(get('email')!)) ||
      (!hasKey ? existingProperty?.contactId : undefined) ||
      undefined;
    const localKey =
      !get('clientNumber') && !get('email') && get('displayName')
        ? `name:${get('displayName')!.toLowerCase()}`
        : null;
    if (contactId === undefined && localKey) contactId = byLocalName.get(localKey);
    if (!contactId && !get('displayName')) {
      fail(
        hasProperty
          ? 'New client needs a name (or a client number or email that matches an existing client).'
          : 'Each row needs a client number, an email or a name.',
      );
      continue;
    }
    if (!hasProperty && !get('clientNumber') && !get('email') && contactId === undefined) {
      fail(
        'A client without a property needs a client number or email, so re-importing finds it again.',
      );
      continue;
    }

    // An account that belongs to someone else is refused before anything is written.
    if (existingProperty && existingProperty.contactId !== contactId) {
      const owner = contacts.get(existingProperty.contactId);
      fail(
        `Account ${account} in ${propertyCounty!.name} already belongs to ${owner ? `${owner.displayName}${owner.clientNumber ? ` (${owner.clientNumber})` : ''}` : 'another client'}.`,
      );
      continue;
    }

    // --- Client patch
    const address: Record<string, string> = {};
    if (get('mailingLine1')) address.line1 = get('mailingLine1')!;
    if (get('mailingLine2')) address.line2 = get('mailingLine2')!;
    const csz = p.get('mailingCityStateZip') as
      { city: string; state: string; zip: string } | undefined;
    if (csz) Object.assign(address, csz);
    if (get('mailingCity')) address.city = get('mailingCity')!;
    if (get('mailingState')) address.state = get('mailingState')!.toUpperCase();
    if (get('mailingZip')) address.zip = get('mailingZip')!;
    const patch: Record<string, unknown> = {};
    for (const k of [
      'displayName',
      'email',
      'billingEmail',
      'phone',
      'nameOnCad',
      'contingencyPct',
      'flatFee',
      'bppFee',
      'notes',
    ]) {
      if (p.has(k)) patch[k] = p.get(k);
    }
    if (entityChoice?.ok) patch.entityType = entityChoice.value;

    let contactAction: ImportAction = 'UNCHANGED';
    const contactChanges: string[] = [];
    let contact = contactId !== undefined ? contacts.get(contactId) : undefined;
    try {
      if (!contact) {
        const kind = kindChoice?.ok ? kindChoice.value : 'CLIENT';
        const data = {
          kind,
          status: kind === 'PROSPECT' ? ('NEW' as const) : null,
          clientNumber: kind === 'CLIENT' ? (get('clientNumber') ?? takeNumber()) : null,
          displayName: get('displayName')!,
          entityType: (entityChoice?.ok
            ? entityChoice.value
            : 'INDIVIDUAL') as ContactState['entityType'],
          email: get('email') ?? null,
          billingEmail: get('billingEmail') ?? null,
          phone: get('phone') ?? null,
          mailingAddress: Object.keys(address).length
            ? { line1: '', city: '', state: 'TX', zip: '', ...address }
            : null,
          nameOnCad: get('nameOnCad') ?? null,
          contingencyPct: get('contingencyPct') ?? null,
          flatFee: get('flatFee') ?? null,
          bppFee: get('bppFee') ?? null,
          notes: get('notes') ?? null,
          convertedAt: kind === 'CLIENT' ? new Date() : null,
        };
        const id =
          mode === 'apply'
            ? (
                await db.contact.create({
                  data: {
                    orgId,
                    source: 'IMPORT',
                    ...data,
                    mailingAddress: data.mailingAddress ?? undefined,
                  },
                  select: { id: true },
                })
              ).id
            : tempId--;
        contact = { id, ...data };
        remember(contact);
        if (localKey) byLocalName.set(localKey, id);
        contactAction = 'CREATE';
      } else {
        const update: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(patch)) {
          if (!sameValue(contact[k as keyof ContactState] as never, v)) {
            update[k] = v;
            contactChanges.push(CONTACT_FIELD_LABELS[k] ?? k);
          }
        }
        if (Object.keys(address).length) {
          const current = (contact.mailingAddress ?? {}) as Record<string, unknown>;
          if (Object.entries(address).some(([k, v]) => !sameValue(current[k] as never, v))) {
            update.mailingAddress = {
              line1: '',
              city: '',
              state: 'TX',
              zip: '',
              ...current,
              ...address,
            };
            contactChanges.push('mailing address');
          }
        }
        if (kindChoice?.ok && kindChoice.value === 'CLIENT' && contact.kind === 'PROSPECT') {
          update.kind = 'CLIENT';
          update.status = 'SIGNED';
          update.clientNumber = contact.clientNumber ?? get('clientNumber') ?? takeNumber();
          update.convertedAt = contact.convertedAt ?? new Date();
          contactChanges.push('converted to client');
        } else if (kindChoice?.ok && kindChoice.value === 'PROSPECT' && contact.kind === 'CLIENT') {
          messages.push('Already a client; it stays a client.');
        }
        if (contactChanges.length) {
          if (mode === 'apply' && contact.id > 0) {
            await db.contact.update({ where: { id: contact.id }, data: update });
          }
          Object.assign(contact, update);
          remember(contact);
          contactAction = 'UPDATE';
        }
      }
    } catch (e) {
      fail(`Couldn't save the client: ${(e as Error).message.split('\n').at(-1)}`);
      continue;
    }

    // --- Property
    let propertyAction: ImportAction | null = null;
    const propertyChanges: string[] = [];
    if (propertyCounty && account) {
      let consultantUserId: number | null | undefined;
      if (get('consultantEmail')) {
        consultantUserId = consultantByEmail.get(get('consultantEmail')!);
        if (consultantUserId === undefined) {
          messages.push(
            `Consultant: ${get('consultantEmail')} isn't an active member of your firm, so none was assigned.`,
          );
        }
      }
      const situs: Record<string, string> = {};
      if (get('situsLine1')) situs.line1 = get('situsLine1')!;
      if (get('situsCity')) situs.city = get('situsCity')!;
      if (get('situsZip')) situs.zip = get('situsZip')!;
      const situsLine = (s: Record<string, unknown>) =>
        [s.line1, s.city, s.zip].filter(Boolean).join(', ') || null;
      const pPatch: Record<string, unknown> = {};
      if (typeChoice?.ok) pPatch.propertyType = typeChoice.value;
      if (consultantUserId !== undefined) pPatch.consultantUserId = consultantUserId;
      if (p.has('propertyContingencyPct')) pPatch.contingencyPct = p.get('propertyContingencyPct');
      if (p.has('propertyFlatFee')) pPatch.flatFee = p.get('propertyFlatFee');
      if (p.has('propertyBppFee')) pPatch.bppFee = p.get('propertyBppFee');
      if (p.has('propertyNotes')) pPatch.notes = p.get('propertyNotes');
      try {
        if (!existingProperty) {
          const situsAddress = Object.keys(situs).length
            ? { line1: '', city: '', state: 'TX', zip: '', ...situs }
            : null;
          const data = {
            countyId: propertyCounty.id,
            contactId: contact.id,
            accountNumber: account,
            situsLine: situsAddress ? situsLine(situsAddress) : null,
            situsAddress,
            propertyType: (pPatch.propertyType as string) ?? 'RESIDENTIAL',
            consultantUserId: (pPatch.consultantUserId as number | null | undefined) ?? null,
            contingencyPct: pPatch.contingencyPct ?? null,
            flatFee: pPatch.flatFee ?? null,
            bppFee: pPatch.bppFee ?? null,
            notes: (pPatch.notes as string | undefined) ?? null,
          };
          const id =
            mode === 'apply'
              ? (
                  await db.property.create({
                    data: {
                      orgId,
                      ...data,
                      propertyType: data.propertyType as (typeof PROPERTY_TYPES)[number],
                      contingencyPct: data.contingencyPct as string | null,
                      flatFee: data.flatFee as string | null,
                      bppFee: data.bppFee as string | null,
                      situsAddress: data.situsAddress ?? undefined,
                    },
                    select: { id: true },
                  })
                ).id
              : tempId--;
          properties.set(accountKey(propertyCounty.id, account), { id, ...data });
          propertyAction = 'CREATE';
        } else {
          const update: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(pPatch)) {
            if (!sameValue(existingProperty[k as keyof PropertyState] as never, v)) {
              update[k] = v;
              propertyChanges.push(
                (
                  {
                    propertyType: 'property type',
                    consultantUserId: 'consultant',
                    contingencyPct: 'property contingency %',
                    flatFee: 'property flat fee',
                    bppFee: 'property BPP fee',
                    notes: 'property notes',
                  } as Record<string, string>
                )[k] ?? k,
              );
            }
          }
          if (Object.keys(situs).length) {
            const current = (existingProperty.situsAddress ?? {}) as Record<string, unknown>;
            if (Object.entries(situs).some(([k, v]) => !sameValue(current[k] as never, v))) {
              const next = { line1: '', city: '', state: 'TX', zip: '', ...current, ...situs };
              update.situsAddress = next;
              update.situsLine = situsLine(next);
              propertyChanges.push('property address');
            }
          }
          if (propertyChanges.length) {
            if (mode === 'apply' && existingProperty.id > 0) {
              await db.property.update({ where: { id: existingProperty.id }, data: update });
            }
            Object.assign(existingProperty, update);
            propertyAction = 'UPDATE';
          } else propertyAction = 'UNCHANGED';
        }
      } catch (e) {
        fail(`Couldn't save the property: ${(e as Error).message.split('\n').at(-1)}`);
        continue;
      }
    }

    results.push({
      rowNumber,
      action: combine(contactAction, propertyAction),
      label: `${contact.displayName}${contact.clientNumber ? ` (${contact.clientNumber})` : ''}${propertyCounty && account ? ` · ${propertyCounty.name} ${account}` : ''}`,
      changes: [...contactChanges, ...propertyChanges],
      messages,
    });
  }

  if (mode === 'apply' && nextNumber !== org.nextClientNumber) {
    // Only ever forward: staff may have added clients by hand while this ran.
    await db.org.updateMany({
      where: { nextClientNumber: { lt: nextNumber } },
      data: { nextClientNumber: nextNumber },
    });
  }
  return { rows: results, summary: summarize(results) };
}
