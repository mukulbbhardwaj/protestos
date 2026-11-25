# Spec: Tax savings calculator (M2.5)

Status: draft for Mukul's review · Owner: Mukul · Milestone: M2.5 (before CSV import)

## 1. Why

Firms win clients by showing them, before they sign, roughly how much a protest would save.
Today they do this by hand, from the appraisal district (CAD) website and a spreadsheet. The
calculator does it in one click from public CAD data:

```
Account or address → the CAD's own values → comparable neighbors → indicated value
  → estimated value reduction → estimated tax savings per year → firm fee → client keeps
```

It is the first thing a firm sees in a demo, and it turns into a prospect with one button.

## 2. Rules it is built on (public law, Texas Tax Code)

| Rule                                                                                                                                                                                  | Where                      | How the calculator uses it                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------- |
| **Unequal appraisal.** A protest succeeds if the appraised value is more than the median appraised value of a reasonable number of comparable properties, appropriately adjusted.     | §41.43(b)(3), §42.26(a)(3) | The estimate method (section 5). Uses only public CAD data, so it works without sales data.   |
| **Homestead cap.** A homestead's appraised value can't rise more than 10% a year (plus new improvements).                                                                             | §23.23                     | A lower market value only saves tax when it falls below the capped appraised value.           |
| **Circuit breaker.** Non-homestead real property up to the statutory threshold (about $5M) is capped at 20% a year. Temporary, so check it still applies to the year being estimated. | §23.231                    | Same treatment as the homestead cap: savings start below the capped value.                    |
| **Exemptions.** Homestead (fixed-dollar school exemption plus optional local % exemptions), over-65 and disabled.                                                                     | §11.13                     | Taxable value per taxing unit comes from the CAD's own per-unit figures (section 4).          |
| **Tax ceiling.** Over-65 and disabled homesteads have school taxes frozen.                                                                                                            | §11.26                     | No school-tax savings are counted for these accounts.                                         |
| **Tax = Σ (taxable value × rate)** over each taxing unit (county, city, school district, special districts).                                                                          | Ch. 26                     | Savings are computed per taxing unit, not with one blended rate, when unit data is available. |

Dollar amounts in these rules (exemption sizes, cap threshold) change by legislation and
constitutional amendment. They are never hard-coded: they come from the CAD's per-account data
for the year being estimated.

What is **not** public and is out of scope for M2.5: sale prices (Texas is a non-disclosure
state, so market-value arguments need MLS or a paid data vendor), and proprietary win-probability
models.

## 3. Scope

### In scope (M2.5)

- **Counties with free bulk rolls**, each through a county adapter: Harris (HCAD format),
  Travis, Denton and Montgomery (Legacy 8.0.x export), Collin (Texas Open Data Portal), Fort
  Bend and Williamson (Orion). Dallas and Tarrant publish free files that this machine can't
  reach; Bexar has no bulk download (open-records request only).
- **Residential single-family** accounts (state class A1).
- **Commercial** accounts (state class F1), section 5a, in counties whose export gives each
  building's type and area (Harris first).
- The **equity (unequal appraisal) estimate**, with the comparables shown.
- Loading the CAD's public bulk roll files with a backfill step (ADR 005 style), by hand, per year.
- An in-app **Calculator** page: search the whole county roll (not just the firm's clients) by
  account number, address or owner; see the estimate; create a prospect from it.
- An **equity estimate card** on the property page when the property's county and year are loaded.
- The firm fee and "client keeps" figures, from the firm's (or the client's/property's) contingency %.

### Out of scope for M2.5 (later, with an [ASK] first)

- Dallas, Tarrant and Bexar (see above).
- Multi-family, industrial, land and BPP accounts.
- Income-approach estimates for commercial property (needs rents and expenses, not public).
- Sales-comparable (market value) estimates. These need MLS or vendor data.
- A **public, logged-out calculator** for the firm's website (fits with the M8 lead form).
- Evidence packets (PDF of comparables for the hearing).
- Scheduled, automatic roll refreshes. Loading stays a manual backfill step.
- Storing estimate history. Estimates are computed when asked for.

## 4. Data

### Source

HCAD publishes the full roll as free bulk text files (tab-delimited) at
`https://download.hcad.org/data/CAMA/<year>/`. M2.5 uses:

| File                     | What we take from it                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `Real_acct_owner.zip`    | Account, owner, situs address, state class, neighborhood, land/improvement/market/appraised values |
| `Real_building_land.zip` | Living area, year built, quality grade of the main residential building                            |
| `Real_jur_exempt.zip`    | Taxing units per account, exemptions, taxable value per unit, and unit tax rates where published   |

The loader records which files and year it loaded, and when. The files are not committed
(`.data/` is ignored).

### Tables (platform reference data, like `County`)

They are not tenant data. They are readable by the tenant role and writable only by the
backfill. They have no `orgId`, because every firm sees the same public roll.

```
CadParcel     id, countyId, taxYear, accountNumber, stateClass, neighborhoodCode,
              ownerName, situsLine, situsZip,
              landValue, improvementValue, marketValue, appraisedValue,
              livingAreaSqft (building area for commercial), yearBuilt, qualityCode,
              propertyUse (building type, commercial), marketArea,
              homestead, over65OrDisabled,
              units Json  -- [{ code, taxableValue }]
              @@unique(countyId, taxYear, accountNumber)
              @@index(countyId, taxYear, neighborhoodCode, stateClass, livingAreaSqft)
              trigram indexes on situsLine and ownerName (search)
CadTaxUnit    id, countyId, taxYear, code, name, kind (SCHOOL|COUNTY|CITY|OTHER), ratePct
              @@unique(countyId, taxYear, code)
CadLoad       id, countyId, taxYear, source, files Json, parcelCount, loadedAt
```

Loading: `pnpm db:backfill cad --county harris --year 2026 [--dir .data/hcad/2026]`.
It downloads missing files, streams them, and replaces that county-year in one transaction, so
re-running is safe and readers never see a half-loaded year. Account numbers use the same
county normalizer as the rest of the app.

## 5a. Commercial accounts (state class F1)

The same equity method (§42.26(a)(3)) and the same arithmetic as section 5, with comparable
rules that fit commercial property:

- **Size is building area** (HCAD `bld_ar`), not living area.
- **Building type must match** (office, retail, warehouse …: HCAD's `impr_tp`, stored as its
  description). A warehouse is never compared with an office.
- Commercial properties are far sparser than homes, so the passes are wider:

  | Pass   | Area                 | Building area | Year built | Grade |
  | ------ | -------------------- | ------------- | ---------- | ----- |
  | Strict | same neighborhood    | ±50%          | ±25 years  | any   |
  | Wide   | same CAD market area | ±75%          | ±40 years  | any   |

  In Harris 2026, 62% of commercial accounts have at least 5 same-type comparables in their
  neighborhood and 92% within their market area.

- Counties whose export has no market area (the Legacy 8.0.x counties) use the situs ZIP
  code as the wider area. Commercial is loaded only where the export names each building's
  type: Harris and Montgomery so far. Denton's commercial rows say only "Main Area Comm", so
  its commercial accounts are left out rather than compared across building types.
- Ranking adds a grade term like section 5, but grade is never a filter.
- **High confidence** needs ≥10 strict comparables and a dispersion under 20% (commercial
  values vary more than homes).
- Homestead caps and over-65 ceilings don't apply; the 20% circuit-breaker cap (§23.231) is
  already in the CAD's appraised value.
- A prospect created from a commercial account gets property type COMMERCIAL.
- **Limits, stated on the page:** many commercial protests are argued on income, not equity.
  This estimate uses only the CAD's own values for similar buildings.

## 5. The estimate (`packages/shared/src/estimate`, pure, 100% coverage like the fee engine)

### Inputs

The subject parcel, its candidate comparables (fetched by the API from the same county, year,
neighborhood and state class), the taxing units with rates, and the resolved contingency %.

### Comparable selection

1. **Strict pass.** Same neighborhood code and state class; living area within ±25%; year built
   within ±15 years; same quality grade; market value and living area present; not the subject.
2. If the strict pass finds fewer than 5, a **wide pass** uses living area ±40%, year built ±30
   years, and any quality grade. The estimate is then marked low confidence.
3. If fewer than 5 remain, there is **no estimate** ("Not enough comparable homes in this
   neighborhood"). The page still shows the subject's values.
4. Rank by similarity: `|Δ area| / subject area + |Δ year built| / 30 + (grade differs ? 0.5 : 0)`.
   Keep the 15 most similar (ties go to the lower account number, so results are deterministic).

### Adjustment ("appropriately adjusted")

Each comparable is adjusted to the subject's land and size:

```
adjustedValue = subject.landValue + (comp.improvementValue / comp.livingAreaSqft) × subject.livingAreaSqft
```

So land differences are removed, and the comp's improvement value per square foot is applied
to the subject's size. Age and grade are handled by selection, not by adjustment, in M2.5.

### Indicated value and reduction

```
indicatedValue   = median(adjustedValue of the selected comps), whole dollars
marketReduction  = max(0, subject.marketValue − indicatedValue)
newMarket        = subject.marketValue − marketReduction
newAppraised     = min(subject.appraisedValue, newMarket)     -- caps (§23.23, §23.231)
appraisedReduction = subject.appraisedValue − newAppraised
```

If `appraisedReduction` is 0 but `marketReduction` > 0, say so plainly: "The market value
looks high, but your capped value is already below the indicated value, so a protest would
not lower this year's tax."

### Tax savings

When per-unit data is loaded:

```
for each taxing unit u on the account:
    if u.kind = SCHOOL and the account has an over-65/disabled ceiling: savings_u = 0
    else: savings_u = round2(min(u.taxableValue, appraisedReduction) × u.ratePct / 100)
taxSavings = Σ savings_u
```

Percentage homestead exemptions (for example a county's 20%) mean the taxable value falls by
less than the appraised value. Each unit's exemption rules are in the CAD data as a fixed amount
plus a percentage (HCAD: Houston ISD homestead = $140,000 + 20%; Harris County = 20%; over-65 =
a fixed amount). The loader stores, per account and unit, the percentage **actually applied**:
`(exemption amount − the rule's fixed amount) ÷ appraised value`, capped at the rule's
percentage. That handles partial homesteads (part rented, or one of several owners), which get
the percentage on only part of the value. Fixed-dollar exemptions don't change the margin, so
the reduction passes through them in full until taxable value reaches zero.

Accounts still under protest have "Not Certified" per-unit values in HCAD's files; their
taxable value is worked out from the account's appraised value and the same exemption rules.

HCAD's rate file has two rate columns, `curr` and `prop`. The loader uses `curr` when it is
set, and `prop` otherwise. **[ASK]** Confirm against one real 2026 tax bill which column is
the adopted rate.

When per-unit data is missing, a single combined rate is used (the property's tax-year rate or
the firm's entered rate), with a warning.

### Fee and outputs

```
firmFee      = round2(taxSavings × contingencyPct / 100)
clientKeeps  = taxSavings − firmFee
```

Output: `status` (ESTIMATE | NO_REDUCTION | INSUFFICIENT_COMPS | INCOMPLETE_SUBJECT),
`confidence` (HIGH: ≥10 strict comps and their adjusted values agree, a coefficient of
dispersion under 15%; MEDIUM: ≥5 strict comps; LOW: wide pass), the comps with their adjusted
values, every figure above, `warnings`, and `explanation` lines like the fee engine's
("Median of 12 neighbors, adjusted to your land and size: $312,400 …").

All money uses the fee engine's exact decimal maths (no floats).

## 6. API (tenant-scoped, `/orgs/:orgSlug/calculator`)

The roll is public, but the endpoints live in the tenant scope. They use the firm's fee terms,
and they link to the firm's own property when the account is one of theirs. Every route gets
an isolation test.

| Method & path                                       | Returns                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET /calculator/coverage`                          | Counties and tax years with a loaded roll                                                               |
| `GET /calculator/search?countyId&taxYear&q`         | Up to 20 parcels matching an account number, address or owner                                           |
| `GET /calculator/estimate?countyId&taxYear&account` | The estimate (section 5), plus `property` (the firm's matching property, if any) and the fee terms used |
| `POST /calculator/prospect`                         | Creates a prospect (source MANUAL) with the parcel as its property and the year's values. Audited.      |

Fee terms: if the account is one of the firm's properties, resolve property → client → firm
(the same chain as the fee engine). Otherwise use the firm default, which the page lets the
user override for "what if" without saving.

## 7. Screens

- **Calculator** (new nav item under Work, all roles can view; creating a prospect needs STAFF):
  county and year pickers (only loaded ones), one search box, a result list, then the estimate:
  - headline tiles: estimated value reduction, estimated tax savings per year, firm fee, client keeps
  - confidence badge and plain-language status
  - the subject's CAD values (market, appraised, land, improvement, area, year built, grade)
  - comparables table: account, address, area, year built, grade, market value, $/sq ft, adjusted value
  - the explanation lines and a short note on the method and its limits
  - actions: "Create prospect", or "Open property" when it is already the firm's
- **Property page**: an "Equity estimate" card beside the fee preview, for loaded county-years.

The disclaimer, always shown: "Estimate from public appraisal district data. Not a guarantee of
any result."

## 8. Acceptance (M2.5 is done when)

1. The Harris 2026 roll loads with one command; running it again changes nothing.
2. Every A1 account in the roll can be found by account number, and by address.
3. An estimate returns in under 500 ms at p95 on a laptop.
4. The estimate engine has 100% coverage, including caps, ceilings, no-reduction, too-few-comps
   and the wide pass.
5. Three real accounts hand-checked against the HCAD website: subject values match exactly, and
   the comps and arithmetic can be followed by hand from the comparables table.
6. Playwright: search an account → see an estimate → create a prospect → the prospect has the property.
7. Isolation tests for every calculator route.

## 9. Questions for Mukul [ASK]

1. Should the public, logged-out version (a lead magnet on the firm's site) move ahead of M3?
2. Which county comes next after Harris?
3. Do you want to pay for sales data (MLS access through a broker, or a vendor) later, for
   market-value estimates and evidence packets?
