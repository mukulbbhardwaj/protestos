# Build Plan: Multi-Tenant Property Tax Protest Platform (v1)

> **Who this is for:** a Claude Code agent starting a new repo from scratch.
> **Who owns it:** Mukul (product owner). Ask Mukul before making any decision marked **[ASK]**.
> **Working name:** `protest-os`. This is a placeholder, so keep the name in one config constant and don't hard-code it.

---

## 0. How to use this document (instructions for the agent)

1. Read the whole document before writing any code.
2. Build **one milestone at a time**, in order (section 9). A milestone is done only when all of its acceptance criteria pass and its tests are green.
3. After each milestone:
   - update `PROGRESS.md` (what was done, what was deferred, open questions)
   - commit on a feature branch
   - stop and summarize for Mukul
4. **Tenant isolation is the top rule.** Any query that can return another firm's data is a P0 bug. Every new table gets an `orgId`, and every new endpoint gets an isolation test.
5. Don't add scope beyond v1 (section 3, "Out of scope"). If something seems needed, write it in `PROGRESS.md` under "Proposed".
6. Never commit secrets, keys or `.env` files. Add `.env.example` with placeholder values.
7. Prefer boring, well-known libraries. Pin exact versions.

### Reference implementation (read-only)

A single-tenant version of this product already runs one Texas firm at `/Users/mukul/Documents/Work/lava/lsptax-dash`. **Do not copy code from it** (ownership is not settled). You may read it to understand the **domain rules**. The most useful files:

- `api/prisma/schema.prisma`: the entities and fields a real firm needs
- `api/src/utils/invoiceYearlyData.js`: how the fee is calculated
- `api/src/config/lifecycleConstants.js`: the stages of a property's protest
- `api/src/services/financialMetrics.js`: definitions for billed, collected and unpaid
- `api/src/config/csvColumnMapping.js`: the columns firms really export
- `api/doc/document-signing-process.md`: the e-signature flow
- `docs/specs/financial-dashboard-13-week.md`: the owner reporting rules

Write everything fresh, in TypeScript, multi-tenant from the first line.

---

## 1. Product summary

A web app for **property tax consulting firms** (starting in Texas). These firms protest property valuations for their clients and charge a **contingency fee** (a percentage of the tax saved), sometimes plus flat or BPP fees.

The app takes a firm from lead to cash:

```
Lead → Prospect → Contract + Appointment of Agent (Form 50-162) signed
     → Client → Properties (CAD accounts) → Tax-year record (notice → final values)
     → Hearings → Fee calculated → Invoice sent → Payment recorded → Reporting
```

**Target customer for v1:** Texas firms with 1–30 staff, managing 200–20,000 property accounts. Today they use spreadsheets, QuickBooks and email.

**v1 value proposition:**
- **A tax savings calculator** (the MVP's headline, spec: [`docs/specs/savings-calculator.md`](specs/savings-calculator.md)): any homeowner's account → an equity-based estimate of the tax a protest would save, built on public appraisal district data, and turned into a prospect in one click.
- One place for clients, properties, hearings and billing.
- The contingency invoice is calculated automatically from notice and final values.
- Bulk invoice emails with delivery tracking.
- An owner dashboard showing billed, collected and outstanding money.

---

## 2. Users and roles

| Role | Scope | Can |
|---|---|---|
| `SUPER_ADMIN` | Platform (Mukul) | See all orgs, impersonate for support (logged), manage plans, turn features on or off |
| `OWNER` | One org | Everything in the org, including billing, the subscription, users, settings and finance |
| `ADMIN` | One org | Everything except the subscription and deleting the org |
| `STAFF` | One org | Ops screens (clients, properties, hearings, invoices). No finance dashboard, settings or users |
| `READ_ONLY` | One org | View only |

One user can belong to several orgs (`Membership` table) and switches between them in the UI. v1 can assume one org per user, but the schema must support several.

---

## 3. Scope

### In scope for v1
1. Multi-tenant orgs, sign-up, invitations, roles, org switcher
2. Prospects (pipeline with statuses) and the public lead-capture form embed for each org
3. Clients (contacts, fee defaults, notes)
4. Proper, type, assigned consultant)
5. Tax-year records for each property (notice values, final values, tax rate, flags)
6. A protest stage tracker for each property-year
7. Hearings (calendar, status)
8. Fee engine (shared package, fully unit-tested)
9. Invoices (generate, statuses, PDF, email, delivery tracking)
10. Payments (a real `Payment` table, partial payments, method, allocation)
11. Documents:
    - an engagement contract built from the org's template
    - Texas Form 50-162 filled in
    - e-signature
12. CSV import (clients and properties, tax-year values, historical invoices) with a dry-run preview
13. Dashboards: ops and owner finance
14. Email templates for each org (invoice, payment receipt, prospect outreach)
15. Global search
16. Audit log
17. Org settings (branding, fee defaults, invoice numbering, sender identity)
18. SaaS billing through Stripe (plans, trial, seat or account limits)
19. A super-admin console (basic)
20. **Tax savings calculator** (M2.5): an equity (unequal appraisal) estimate from the CAD's public bulk roll, starting with Harris County residential. See [`docs/specs/savings-calculator.md`](specs/savings-calculator.md).

### Out of scope for v1 (do not build)
- Scraping CAD websites, and scheduled automatic CAD data pulls. (Loading a CAD's published bulk roll files by hand, for the calculator, is in scope.)
- Evidence packets, and sales-comparable estimates (they need MLS or vendor sales data; Texas doesn't publish sale prices)
- Electronic protest filing with appraisal districts
- Any state other than Texas. Keep the code ready for more states, but don't add them.
- A client-facing portal (clients logging in)
- SMS
- Accounting sync (QuickBooks)
- Mobile apps
- AI features

---

## 4. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | `apps/web`, `apps/api`, `packages/shared`, `packages/db`, `packages/pdf` |
| Language | TypeScript (strict) everywhere | |
| Frontend | React 18 + Vite, React Router, TanStack Query, TanStack Table, react-hook-form + zod, Tailwind + shadcn/ui, Recharts, TipTap (template editor) | |
| Backend | Node 22, **Fastify** with zod type provider | Or Express. Pick one and stick to it. |
| ORM / DB | Prisma + PostgreSQL 16 with `pg_trgm` | Row-level security as a second line of defense (section 6) |
| Auth | **Better Auth** (or Lucia-style sessions written in-house): email+password, email verification, password reset, invitations | Session cookies (httpOnly, SameSite=Lax). No JWT in localStorage. |
| Jobs / queues | **pg-boss** (runs on Postgres, no Redis needed) | Email sends, PDF generation, imports, webhooks |
| File storage | S3-compatible (Cloudflare R2 or Supabase Storage) behind an interface | Signed URLs only. Key prefix `org/{orgId}/...` |
| PDF | Server-side: **Playwright/Chromium HTML→PDF** for invoices and contracts; **pdf-lib** to fill Form 50-162 | Never generate PDFs in the browser |
| Email | **Postmark** or **Brevo** behind a `MailProvider` interface, with webhooks for delivered, opened and bounced | **[ASK]** which provider |
| E-signature | **DocuSign** through a `SignatureProvider` interface. v1 uses one platform DocuSign account and sends on the org's behalf, with the org's branding. | **[ASK]**: platform account, or each org connects its own. Design the interface so both work. |
| SaaS billing | Stripe Billing + Customer Portal | |
| Testing | Vitest (unit/integration), Supertest/Fastify inject, Playwright (e2e), Testcontainers or a docker-compose Postgres | |
| Lint/format | ESLint + Prettier, `tsc --noEmit` in CI | |
| CI | GitHub Actions: lint, typecheck, test, build | |
| Hosting | Web on Vercel or Cloudflare Pages. API and worker on Fly.io or Render. DB on Neon or Supabase Postgres. | **[ASK]** |
| Observability | Sentry (web + api), structured JSON logs (pino), request ids | |

---

## 5. Data model

All money uses `Decimal(15,2)`. Percentages and rates use `Decimal(9,4)`. **All dates use real `DATE` or `TIMESTAMPTZ` columns, never text.** Every tenant table has `orgId`, `createdAt`, `updatedAt`, and an index that starts with `orgId`. Soft delete uses an `archivedAt` column where noted.

### 5.1 Platform and tenancy
```
Org            id, name, slug (unique), state ('TX'), timezone ('America/Chicago'),
               logoKey, primaryColor, addressLines, phone, website,
               defaultContingencyPct, defaultFlatFee, defaultBppFee,
               invoicePrefix, nextInvoiceNumber, invoiceDueDa (default 30),
               taxYearDefault, stripeCustomerId, plan, planStatus, trialEndsAt,
               propertyLimit, seatLimit, createdAt, updatedAt
User           id, email (unique), name, passwordHash/authId, emailVerifiedAt, isSuperAdmin
Membership     id, orgId, userId, role (OWNER|ADMIN|STAFF|READ_ONLY), status (ACTIVE|INVITED|DISABLED)
               @@unique(orgId, userId)
Invitation     id, orgId, email, role, tokenHash, expiresAt, acceptedAt, invitedById
AuditLog       id, orgId, actorUserId, action, entityType, entityId, before Json, after Json, ip, createdAt
OrgSetting     orgId, key, value (non-secret settings only; secrets go in env/KMS)
```

### 5.2 CRM
```
Contact        id, orgId, kind (PROSPECT|CLIENT), status (prospect statuses below),
               clientNumber (unique per org, assigned on conversion), displayName,
               entityType (INDIVIDUAL|COMPANY), email, billingEmail, phone,
               mailingAddress {line1,line2,city,state,zip}, billingAddress {...},
               nameOnCad, contingencyPct (nullable → org default), flatFee, bppFee,
               source (WEB_FORM|MANUAL|IMPORT|REFERRAL), notes, convertedAt, archivedAt
               @@unique(orgId, clientNumber)
ProspectStatus NEW | CONTACTED | DOCS_SENT | SIGNED | LOST
```
Clients and prospects share one table, as in the reference app. Converting a prospect means changing `kind`, assigning a `clientNumber` and stamping `convertedAt`. The original sign-up date (`convertedAt`) must **never be overwritten**.

### 5.3 Properties and tax years
```
Property       id, orgId, contactId, accountNumber (CAD account; NOT globally unique),
               county (enum of TX counties from a seed table), cadName,
               situsAddress {...}, propertyType (RESIDENTIAL|COMMERCIAL|BPP|LAND|OTHER),
               consultantUserId, contingencyPct (nullable override), flatFee (nullable),
               notes, archivedAt, archivedWithContact (bool)
               @@unique(orgId, county, accountNumber)
TaxYearRecord  id, orgId, propertyId, taxYear,
               noticeLand, noticeImprovement, noticeMarket, noticeAppraised,
               finalLand, finalImprovement, finalMarket, finalAppraised,
               taxRatePct (combined rate, e.g. 2.1500), bppRenderedAt, bppFee,
               underLitigation, underArbitration, homestead (bool),
               protestStage (enum, see 5.4), protestFiledAt, noticeReceivedAt,
               resultType (SETTLEMENT|BOARD_ORDER|NO_CHANGE|WITHDRAWN|null), resultAt,
               contingencyPctOverride (nullable; 0 is a real value), notes
               @@unique(propertyId, taxYear)
County         id, state, name, cadName, cadWebsite (seed all 254 TX counties)
```
Computed values (market reduction, appraised reduction, taxable savings, fee) are **not stored** on `TaxYearRecord`. They come from the fee engine. They are only **snapshotted onto the Invoice** when the invoice is issued.

### 5.4 Protest stage (one per property-year)
```
NOT_STARTED → AOA_SIGNED → NOTICE_RECEIVED → PROTEST_FILED → HEARING_SCHEDULED
→ SETTLED | BOARD_ORDER | NO_CHANGE | WITHDRAWN → INVOICED → PAID
```
`ProtestStageEvent` (id, orgId, taxYearRecordId, from, to, note, actorUserId, at) is an append-only history.
Some changes happen automatically. Signing an AOA moves the record to `AOA_SIGNED`. Issuing an invoice moves it to `INVOICED`. Paying the invoice in full moves it to `PAID`.

### 5.5 Hearings
```
Hearing        id, orgId, propertyId, taxYear, scheduledAt (timestamptz), type (INFORMAL|ARB|ARBITRATION|LITIGATION),
               status (SCHEDULED|ATTENDED|RESCHEDULED|CANCELLED|NO_SHOW), location/panel, notes,
               assignedUserId, deletedAt
```

### 5.6 Billing
```
Invoice        id, orgId, contactId, number (org prefix + sequence, unique per org),
               taxYear, status (DRAFT|ISSUED|PARTIALLY_PAID|PAID|VOID|WRITTEN_OFF),
               issueDate (date), dueDate (date), template (STANDARD|ARBITRATION|HOMESTEAD|ZERO_SAVINGS),
               subtotal, total, amountPaid, balance, currency='USD',
               pdfKey, sentAt, voidedAt, voidReason, notes
InvoiceLine    id, orgId, invoiceId, propertyId, taxYearRecordId (nullable), kind (CONTINGENCY|FLAT|BPP|ADJUSTMENT),
               description, snapshot Json (all fee-engine inputs + outputs at issue time), amount
Payment        id, orgId, contactId, receivedAt (date), amount, method (ZELLE|CHECK|ACH|CASH|CARD|OTHER),
               reference (check #), notes, createdById
PaymentAllocation id, orgId, paymentId, invoiceId, amount
InvoiceDelivery id, orgId, invoiceIds Int[], contactId, toEmail, provider, providerMessageId,
               status (QUEUED|SENT|DELIVERED|OPENED|BOUNCED|FAILED), events Json, attachmentKeys String[],
               error, sentAt
```
**Important change from the reference app.** An invoice is **one invoice per client per tax year (or per batch), with one line per property**. It is not one invoice per property. Firms bill clients, and clients pay invoices. **[ASK]** Confirm with 2–3 firms. Also support a "one invoice per property" org setting.

"Past due" is **derived** (`status=ISSUED|PARTIALLY_PAID AND dueDate < today`). It is never stored.

### 5.7 Documents and e-signature
```
DocumentTemplate id, orgId, kind (ENGAGEMENT_CONTRACT|AOA_50_162|CUSTOM), name, bodyHtml (for HTML templates),
               fieldMap Json (for PDF form templates), isDefault, version
Document       id, orgId, contactId, propertyId (nullable), templateId, kind, status
               (DRAFT|SENT|VIEWED|SIGNED|DECLINED|VOIDED|EXPIRED), unsignedKey, signedKey,
               provider, envelopeId, sentAt, signedAt, signerName, signerEmail
```
An AOA can cover **several properties of the same owner**, because Form 50-162 allows several accounts on one form. Use a `DocumentProperty` join table.

### 5.8 Email templates and imports
```
EmailTemplate  id, orgId, key (INVOICE|INVOICE_ZERO_SAVINGS|PAYMENT_RECEIPT|PROSPECT_OUTREACH|DOC_REMINDER|CUSTOM),
               name, subject, bodyHtml, isBuiltin, updatedById
ImportJob      id, orgId, kind (CONTACTS_PROPERTIES|TAX_YEAR_VALUES|HISTORICAL_INVOICES), status
               (UPLOADED|PREVIEWED|RUNNING|DONE|FAILED), fileKey, columnMapping Json,
               summary Json (created/updated/skipped/errors), rowResults Json (or a separate table), createdById
```

---

## 6. Multi-tenancy and security (non-negotiable)

1. **Tenant context:** each request resolves `{ userId, orgId, role }` from the session and the active org (a header or the URL `/:orgSlug/...`). Membership is checked on every request.
2. **Repository layer:** all data access goes through `db.forOrg(orgId)`. That is either a Prisma client extension that injects `where: { orgId }` on every read and write and sets `orgId` on create, or explicit repository functions. Calling the raw Prisma client in route handlers is banned. Enforce this with an ESLint rule.
3. **Postgres RLS as a backstop:** set `app.current_org_id` for each transaction (`SET LOCAL`) and add RLS policies `orgId = current_setting('app.current_org_id')::int` on every tenant table. Super-admin tooling uses a separate DB role that bypasses RLS.
4. **Isolation tests:** a shared test helper creates org A and org B, seeds data in both, and checks that every list, get, update and delete endpoint in org A cannot see or change org B's rows. Run it in CI for every route. Don't skip it.
5. **Files:** storage keys are `org/{orgId}/{kind}/{uuid}.pdf`. Downloads go only through the API: check the org, then issue a signed URL that lasts 60 seconds or less.
6. **Secrets:** env vars only. Ship `.env.example`. Add a gitleaks pre-commit hook and a CI check.
7. **Webhooks** (email, e-signature, Stripe): verify the signature, keep the processing idempotent (store event ids), and map each event back to its org through the stored provider ids. Never trust an org id sent in the payload.
8. **Rate limiting:** login, the public lead form, and send endpoints.
9. **Audit log:** every create, update or delete on Contact, Property, TaxYearRecord, Invoice, Payment, Document, Membership and Settings writes an `AuditLog` row with a before/after diff.
10. **PII:** don't log email bodies or addresses at info level.
11. **Backups:** rely on managed Postgres point-in-time recovery. Document the restore steps in `docs/ops.md`.

---

## 7. Fee engine (`packages/shared/fees`)

These are pure functions with no I/O, used by both the API and the web (for live previews). This is the most important module to get right. Aim for 100% branch coverage.

### Inputs (for each property-year)
```
noticeMarket, finalMarket, noticeAppraised, finalAppraised,
taxRatePct, contingencyPct (resolved), flatFee (resolved), bppFee, isCurrentBillingYear
```

### Resolving the contingency %
1. `TaxYearRecord.contingencyPctOverride`, if it is not null. **0 is a real 0%.**
2. Otherwise `Property.contingencyPct`, if it is not null.
3. Otherwise `Contact.contingencyPct`, if it is not null.
4. Otherwise `Org.defaultContingencyPct`.

Flat fee and BPP fee resolve the same way (property → contact → org). The reference app only adds the flat fee on the **current billing year**. Keep that rule, but make it an org setting.

### Formulas
```
marketReduction    = max(0, noticeMarket − finalMarket)
appraisedReduction = max(0, noticeAppraised − finalAppraised)
taxableSavings     = round2(appraisedReduction × taxRatePct / 100)
contingencyFee     = round2(taxableSavings × contingencyPct / 100)
total              = contingencyFee + flatFee(if applicable) + bppFee
```
- **[ASK]** Which value the savings are measured on (appraised or market) must be an org setting. Default to appraised.
- The output includes an `explanation` array of human-readable steps. It is shown in the UI and printed on the invoice ("Reduction $40,000 × 2.15% = $860 savings × 30% = $258").
- Edge cases to test:
  - final value higher than notice (savings are 0)
  - a missing final value (can't be invoiced yet)
  - a 0% override
  - a tax rate given as a decimal fraction (0.0215) by mistake: catch values below 0.5 and warn
  - rounding to the cent
  - a "zero savings" invoice that is flat fee only

### Snapshotting
When an invoice is **issued**, store the full input and output of the fee engine in `InvoiceLine.snapshot`. Editing a tax-year record afterwards must **not** change an issued invoice. Show a "values changed since invoicing" badge and offer "void and reissue".

---

## 8. Feature specs

### 8.1 Onboarding
- Sign up → verify email → create the org (name, county list, default contingency %, logo upload) → land on an empty dashboard with a checklist:
  1. Import clients and properties
  2. Set up invoice branding
  3. Invite your team
  4. Connect e-signature
- A 14-day trial with no card needed **[ASK]**. Stripe Checkout when the trial ends.

### 8.2 Prospects
- A list with status tabs and a kanban toggle (`NEW → CONTACTED → DOCS_SENT → SIGNED / LOST`).
- **Public lead form:** each org gets `https://app/{orgSlug}/lead`. Also provide an embeddable `<iframe>` or `<script>` snippet. It captures name, email, phone, property address and county. Protect it with a honeypot, rate limits and Cloudflare Turnstile. A new lead sends the org an email notification.
- Send an outreach email from a template.
- "Send documents" creates the contract plus AOA(s) for the prospect's properties and sends them for signature.
- When everything is signed, automatically move to `SIGNED` and prompt "Convert to client" (or convert automatically, as an org setting).

### 8.3 Clients
- A list with search, filters (county, consultant, has unpaid balance) and server-side pagination, plus CSV/XLSX export.
- The detail page has tabs:
  - **Overview:** contact details, fee defaults, notes
  - **Properties**
  - **Documents:** status and signed-PDF download
  - **Invoices and Payments:** balance and statement
  - **Activity:** audit log and emails sent
- Archive and restore. Archiving cascades to properties with `archivedWithContact=true`, and restoring brings back only those properties.
- "Download statement PDF" (all invoices and payments for a year).

### 8.4 Properties
- A list with filters (county, type, consultant, protest stage, tax year), bulk assignment of a consultant, and bulk stage changes.
- The detail page shows a header (account, county, owner, address, CAD link) and a **tax-year table** that is editable inline. A live fee preview per row comes from the shared fee engine. It also has a stage timeline, hearings and documents.
- A "Roll over to new tax year" bulk action creates empty `TaxYearRecord`s for the selected properties.

### 8.5 Hearings
- List and calendar (week/month) views, filtered by consultant, county and status.
- Add hearings from a property. Bulk-add hearings from CSV (appraisal districts send schedules).
- **iCal feed for each user** (a read-only URL with a secret token) so consultants can subscribe in Google or Outlook.
- Ops dashboard tiles: hearings today and this week.

### 8.6 Invoicing
- **Generate:**
  1. Pick a tax year and filters (clients, counties, consultants). Only property-years with final values and no invoice yet are eligible.
  2. Preview a table of what will be created, with totals.
  3. Create **draft** invoices, grouped per client (or per property if the org setting says so).
- **Review:** edit or add adjustment lines on drafts, pick the template, preview the PDF.
- **Issue:**
  - assign the number
  - snapshot the values
  - set the issue and due dates
  - render the PDF in a background job and store it
  - move the stage to `INVOICED`
- **Send:** one at a time or in bulk.
  - Choose the email template (pick `INVOICE_ZERO_SAVINGS` automatically when the total comes only from flat fees).
  - Preview the recipients (billing email, falling back to email; flag clients with no email).
  - Queue the send jobs.
- **Track:** the delivery status (sent, delivered, opened, bounced) appears on the invoice and in the list. Bounces show as an alert on the dashboard.
- **Void / write off:** both require a reason, and both are audited.
- **Invoice PDF:**
  - the org's logo, address and colors
  - invoice number, dates, client billing block
  - one line per property: account, county, address, notice → final appraised, reduction, tax rate, savings, contingency %, fee
  - totals, payment instructions (an org setting: Zelle, check address, ACH), notes
  - three layouts plus zero-savings

### 8.7 Payments
- Record a payment against a client: date, amount, method, reference. Allocate it across that client's open invoices (oldest first by default, adjustable by hand).
- Partial payments are allowed. Invoice status and balance are derived from the allocations.
- Overpayment is kept as client credit (an unallocated balance) and can be applied later.
- Optionally send a payment receipt email from a template.
- Undo or delete a payment by reversing its allocations (audited).

### 8.8 Documents and e-signature
- **Engagement contract:** an HTML template for each org (TipTap editor) with placeholders (`{{client.displayName}}`, `{{properties.table}}`, `{{org.name}}`, `{{contingencyPct}}`, `{{date}}`). It is rendered to PDF.
- **Form 50-162 (Appointment of Agent):**
  - Fill the official PDF with pdf-lib, using owner, agent (org), property account(s), county and the authority checkboxes.
  - The agent details come from org settings.
  - Store the field mapping in `packages/pdf/forms/tx-50-162.ts`.
  - Download the official blank form from the Texas Comptroller website into `packages/pdf/assets/`, and record its source URL and version.
- **Flow:**
  1. Preview.
  2. Send. The signer gets an email from the e-signature provider.
  3. A webhook arrives, the signed PDF is stored, status becomes `SIGNED`, and the stage becomes `AOA_SIGNED`.
- Reminders, void and resend. An org setting decides whether resending a signed document is allowed.
- **Offline fallback:** "Mark as signed and upload PDF", for documents signed on paper.

### 8.9 CSV imports
- Steps:
  1. Upload.
  2. **Column mapping**: auto-match on header names and synonyms, with manual dropdowns to fix it. Each org can save its mapping.
  3. **Dry run** shows created, updated, unchanged and error counts for each row, with downloadable error rows.
  4. Confirm.
  5. A background job runs the import.
  6. A summary is shown.
- Three import types:
  - Contacts + Properties: match on `clientNumber`, else email; properties match on `(county, accountNumber)`.
  - Tax-year values: match on `(county, accountNumber, taxYear)`.
  - Historical invoices and payments: for migration.
- Normalize account numbers (trim, keep leading zeros, strip dashes and spaces according to each county's format), phones (E.164) and dates (several formats).
- Provide downloadable sample CSVs.
- Imports must be **idempotent**: re-running the same file creates no duplicates.

### 8.10 Dashboards
**Ops dashboard (all roles):**
- active clients, properties this tax year, new prospects in the last 30 days
- hearings today and this week
- documents waiting for signature
- property-years by protest stage (a funnel)
- my assigned properties (for staff)

**Finance dashboard (OWNER/ADMIN):**
- KPIs:
  - Billed is counted by issue date. Collected is counted by payment received date.
  - Billed and Collected this month, last month, YTD and calendar year
  - Collection rate
  - Outstanding, split into not-yet-due and past-due by age (0–30, 31–60, 61–90, 90+)
  - Total value reduced and total client tax savings for the tax year
- Charts:
  - monthly billed vs collected (bars), with a running total line
  - billed by county
  - protest outcomes by tax year
- Tables: largest outstanding balances (click through to the client), recent payments.
- Filters: date range, tax year, county, consultant, property type, payment method.
- Export every table as CSV.
- **Rules:**
  - Tax year means protest year. It is never the billing month.
  - Archived records are excluded.
  - "Collected" comes from `Payment.receivedAt`.
  - An invoice issued in August and paid in September counts as billed in August and collected in September.

### 8.11 Settings (org)
- Profile, branding (logo, color), address, agent details for Form 50-162
- Fee defaults
- Invoice numbering, due days, payment instructions, layout
- Billing model (per client or per property)
- Email sender name and reply-to (the platform domain at first; custom domain verification is post-v1)
- Email templates (TipTap editor, placeholder picker, test-send, reset to default)
- Document templates
- Users and invitations
- Subscription (Stripe Customer Portal link)
- A data export ("Download all my data" as a zip of CSVs, as a trust signal)

### 8.12 Global search
- `Cmd/Ctrl+K`. Trigram search across contacts (name, client number, email, phone), properties (account number, address, CAD name) and invoices (number). Results are always scoped to the org. Aim for under 200ms at 50k rows.

### 8.13 Super-admin console (`/admin`, `isSuperAdmin` only)
- A list of orgs with plan, status, user count, property count and last activity.
- Impersonate: read-only by default and recorded in the audit log, with a banner in the UI.
- Extend a trial, change the plan, disable an org.

### 8.14 SaaS plans (Stripe)
**[ASK]** Final pricing. Placeholder tiers, enforced by `propertyLimit` and `seatLimit`:

| Plan | Price/mo | Active properties | Seats |
|---|---|---|---|
| Starter | $299 | 1,000 | 3 |
| Growth | $699 | 5,000 | 10 |
| Pro | $1,499 | 20,000 | unlimited |

- Handle the webhook events `checkout.session.completed`, `customer.subscription.updated|deleted` and `invoice.payment_failed`. A failed payment starts a grace period, then the org becomes read-only.
- When a plan limit is hit, show a soft warning at 90% and block creation at 100%. Never delete data.

---

## 9. Milestones

Each milestone ends with a demo checklist, green CI and an update to `PROGRESS.md`.

### M0: Repo foundation (2–3 days)
- Monorepo scaffold, TypeScript configs, ESLint/Prettier, Vitest, Playwright, GitHub Actions
- docker-compose with Postgres. `pnpm dev` runs web + api + worker.
- `packages/db` Prisma schema covering only Org/User/Membership/AuditLog
- pino logging, a request id, Sentry wiring (DSN from env), a `/health` endpoint
- gitleaks hook, `.env.example`, `README.md` with setup steps
- **Done when:**
  - `pnpm i && pnpm dev` works on a clean machine
  - CI is green
  - there are no secrets in the repo

### M1: Auth, orgs and tenancy (4–5 days)
- Sign up, verify email, log in and out, reset password
- Create an org, invitations, roles, org switcher
- Tenant context, the `forOrg` data layer, RLS policies and the **isolation test harness**
- Audit log middleware
- App shell: sidebar, header, empty pages for every module, role-gated navigation
- **Done when:**
  - two orgs created through the UI cannot see each other's data
  - a STAFF user gets 403 on the finance and settings APIs
  - isolation tests pass

### M2: Contacts, properties and tax years (5–6 days)
- CRUD for prospects and clients, conversion, archive cascade
- Properties CRUD, county seed (all 254 TX counties), consultant assignment
- Tax-year record editing, stage tracker with history
- Fee engine package, fully unit-tested, with a live preview in the tax-year table
- Global search
- **Done when:**
  - you can create a client with 3 properties, enter notice and final values, and see a correct fee preview
  - fee engine coverage is 100%

### M2.5: Tax savings calculator (4–5 days)
Spec: [`docs/specs/savings-calculator.md`](specs/savings-calculator.md). Added after M2 as the MVP's headline feature; built before M3.
- CAD roll loader (backfill step) for Harris County: parcels, buildings, taxing units, rates
- Estimate engine in `packages/shared/estimate`: comparable selection, adjustment, median, caps, per-unit tax savings, fee
- Calculator page (search the county roll → estimate → create prospect) and an estimate card on the property page
- **Done when:** the spec's section 8 acceptance criteria pass, including 100% engine coverage and three hand-checked real accounts

### M3: CSV import (3–4 days)
- The upload → mapping → dry run → confirm → job pipeline for the three import types
- Normalization utilities with tests
- Sample CSVs
- **Done when:**
  - importing a 5,000-row file works
  - importing it again makes zero changes
  - error rows can be downloaded

### M4: Invoicing and payments (7–8 days)
- Generate drafts, review, issue with snapshot and number
- Server-side PDF rendering with 4 layouts
- Payments with allocation, credits, derived statuses
- Client statement PDF
- **Done when:**
  - generating, issuing, partially paying and then fully paying works end to end
  - balances are correct
  - editing values after issue doesn't change the invoice
  - Playwright covers this flow

### M5: Email and delivery tracking (3–4 days)
- `MailProvider` interface and its implementation, email templates and editor
- Single and bulk invoice sends through the queue
- Webhook tracking, a bounce alert, payment receipt emails
- **Done when:**
  - a bulk send to 50 test clients finishes, each one is tracked, and a bounce shows in the UI
  - sending the same request twice doesn't send twice (idempotency key)

### M6: Documents and e-signature (5–6 days)
- Engagement contract HTML template, Form 50-162 PDF filling (several accounts)
- `SignatureProvider` with DocuSign: send, webhook, signed PDF stored, stage auto-advanced
- Offline upload fallback
- Prospect "send documents" flow and automatic SIGNED status
- **Done when:**
  - a prospect gets a contract and a 50-162 in the DocuSign sandbox, signs, and the portal shows the signed PDFs
  - the prospect becomes SIGNED

### M7: Hearings and dashboards (4–5 days)
- Hearings list, calendar, bulk CSV import, iCal feed
- Ops dashboard
- Finance dashboard with filters, aging and exports
- **Done when:**
  - the dashboard numbers match a hand-calculated fixture dataset (put the fixture plus expected values in tests)

### M8: Public lead form and prospect pipeline polish (2 days)
- Public form, embed snippet, Turnstile, notification email, kanban view

### M9: SaaS billing, onboarding and super-admin (4–5 days)
- Stripe plans, trial, limits, read-only on non-payment
- Onboarding checklist, "download my data" export
- Super-admin console with audited impersonation
- **Done when:**
  - a new firm can sign up, go through the trial and pay with a Stripe test card without help from Mukul

### M10: Hardening and pilot readiness (4–5 days)
- Performance:
  - seed 3 orgs × 20k properties
  - list pages under 500ms at p95
  - search under 200ms
- Security pass:
  - isolation tests for every route
  - rate limits
  - headers (CSP, HSTS)
  - dependency audit
- Accessibility pass on the main flows. Empty, loading and error states everywhere.
- Docs: `docs/ops.md` (deploy, backup, restore), `docs/onboarding-a-firm.md`, `docs/architecture.md`
- Production deploy plus a staging environment
- **Done when:**
  - a pilot firm can be onboarded by importing its spreadsheets in under 1 hour

**Total:** about 45–55 working days for one developer working with Claude.

---

## 10. Testing strategy
- **Unit:** fee engine, normalizers, date windows, allocation logic, metrics. These are pure functions with high coverage.
- **Integration:** each API route against a real Postgres (Testcontainers), including an isolation test for each route.
- **E2E (Playwright), the critical paths:**
  1. Sign up → create org → invite user
  2. Import CSV → generate → issue → send invoice
  3. Record a partial payment, then the full payment → dashboard updates
  4. Prospect → send docs (mocked provider) → signed → convert
- **Fixtures:** `packages/db/seed` creates a demo org with realistic Texas data (Harris, Dallas, Travis, Tarrant, Bexar, Fort Bend, Collin counties). It is used for demos and screenshots.
- Mock external providers in tests behind their interfaces. Real-sandbox smoke tests are a separate CI job you start by hand.

---

## 11. UX guidelines
- Desktop-first (firms work at desks), but usable on a tablet. Light and dark mode.
- Every list has server-side pagination, sorting, filters stored in the URL (so links can be shared), a column picker and CSV export.
- Bulk actions on every list where it makes sense (select all matching the filter, not just the current page).
- Forms validate with zod, the same schema shared by web and api.
- Money is always formatted `$1,234.56`. Percentages show up to 2 decimals. Dates are `MM/DD/YYYY` in the org's timezone.
- Every destructive action asks for confirmation and is audited. Use soft delete wherever possible.
- Error messages are plain sentences that tell the user what to do next.

---

## 12. Repo layout
```
protest-os/
  apps/
    web/            React app
    api/            Fastify HTTP API
    worker/         pg-boss job runner (emails, PDFs, imports, webhooks processing)
  packages/
    shared/         zod schemas, types, fee engine, metrics, formatters
    db/             Prisma schema, migrations, forOrg extension, seed
    pdf/            HTML→PDF renderer, invoice/contract templates, 50-162 filler
    providers/      mail, signature, storage, billing interfaces + implementations
  docs/
    architecture.md  ops.md  onboarding-a-firm.md  decisions/ (ADRs)
  PROGRESS.md
```
Record each significant choice as a short ADR in `docs/decisions/NNN-title.md`.

---

## 13. Open questions for Mukul (ask before the milestone that needs each answer)
1. **M0:** Where to host, and which email provider (Postmark or Brevo)?
2. **M4:** Should the default be one invoice per client-year or per property? Are savings measured on appraised or market value? Is the flat fee charged only in the current year?
3. **M6:** One platform DocuSign account, or each firm connects its own? Is a cheaper provider (Dropbox Sign, Documenso) acceptable?
4. **M9:** Final pricing and trial length. Charge per property or per seat?
5. **Any time:** The product name and domain.
5a. **After M2.5:** Should the public (logged-out) calculator ship before M3? Which county is next? Is buying sales data (MLS or a vendor) worth it?
6. **Before the pilot:** The terms of service, privacy policy and a data processing agreement. Mukul needs to get these written. They are not built in code.

---

## 14. Definition of done for v1
- All milestones M0–M10 are accepted.
- One pilot firm (not LSPTax) is live with its real data and has gone through a full cycle: import, invoice, email and payment.
- No P0 or P1 bugs are open. The isolation test suite covers 100% of tenant routes.
- Restoring from a backup has been tested once and documented.
