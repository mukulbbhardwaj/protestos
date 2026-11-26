# 011: Hearings in Central time with per-member iCal feeds; finance computed from invoices and payments

Status: accepted (M7)

## Decision

- **Hearings** are stored as UTC instants. Appraisal-district schedules are local, so imports
  convert wall-clock Central time with `zonedToUtc` (DST-safe). A hearing (created by hand or
  imported) moves its property-year to HEARING_SCHEDULED when it was earlier in the pipeline.
- **CAD schedule import** (`HEARINGS` import type) matches property + tax year + hearing type,
  so an updated schedule reschedules the existing hearing instead of adding a second one;
  blank cells never erase.
- **Calendar feed per member:** `Membership.calendarToken` (random, rotatable) in a public
  read-only `/calendar/:token.ics` URL with the hearings assigned to that member. The token is
  the only credential; rotating it kills the old URL.
- **Finance dashboard** is computed per request from invoices, lines and payments (firms have
  thousands of invoices, not millions). Definitions (BUILD_PLAN 8.10): billed by issue date
  (drafts and void excluded, write-offs included); collected by payment received date, or,
  with an invoice filter (tax year, county, consultant, property type), only the money
  allocated to matching invoices; outstanding = open invoices, aged by days past due; savings
  for a tax year from final values. An `asOf` parameter makes the numbers reproducible; the
  test fixture checks every figure against hand calculations.
- **Charts** follow the dataviz rules: one axis, palette slots 1–2 validated in light and
  dark, legend for two series, hover tooltips, table view and CSV export for every table.

## Consequences

- If a firm grows to tens of thousands of invoices a year, move the aggregation into SQL
  (the definitions stay the same; the fixture test guards them).
