# 008: Invoices freeze a fee snapshot at issue; payments are allocations

Status: accepted (M4)

## Decision

- **Grouping is a firm setting** (`Org.invoiceGrouping`): one invoice per client per tax year
  with a line per property (default, BUILD_PLAN 5.6), or one per property per tax year.
- **Drafts are live, issued invoices are frozen.** Generating writes draft lines with a fee
  snapshot (all fee-engine inputs, resolved terms and the result). Issuing recalculates every
  fee line from today's values, refuses if any property-year is now incomplete, then freezes
  the lines, assigns the number (row-locked increment, skipping numbers already used), sets
  the dates, stores the PDF (`Invoice.pdfKey`) and moves each property-year to INVOICED.
  Later edits to values, fee terms or firm defaults never change an issued invoice.
- **Payments are separate from invoices.** A `Payment` belongs to a client; `PaymentAllocation`
  rows spread it over open invoices (oldest due first by default, or amounts chosen by hand).
  What isn't allocated is the client's credit, applied later with "Apply credit".
  `amountPaid`, `balance` and PAID/PARTIALLY_PAID are recomputed from live allocations after
  every change (`recalcInvoice`); "past due" is derived, never stored.
- **Undo is explicit and audited.** Deleting a payment soft-deletes it and removes its
  allocations. Voiding releases payments to credit and returns property-years to the stage
  they had before invoicing, so they can be billed again. Write-offs keep payments and stop
  the invoice counting as outstanding. Each needs a reason.
- **Protest stage follows money:** issue → INVOICED, fully paid → PAID, reopened → INVOICED.
- **PDFs** come from `packages/pdf` (pdf-lib, standard fonts, deterministic output): four
  invoice layouts (standard, arbitration, homestead, zero savings) and a client statement.
  Rendered in the request at issue (milliseconds), not a background job.
- **Historical invoices** import as issued invoices (`historical = true`) with one line and an
  "Imported" payment for what was paid; re-importing a changed paid amount replaces that
  payment.

## Why

- Firms bill clients, not properties; the snapshot is what makes an invoice defensible when
  values are corrected later (BUILD_PLAN 7 "Snapshotting").
- Allocations make partial payments, overpayments and credit exact, with status derived from
  one source of truth.

## Consequences

- Two people generating for the same client at the same moment could both create drafts; the
  second issue still works but bills twice. Low risk for firm sizes we target; revisit with a
  per-org advisory lock if it happens.
- The stored PDF is the document as issued (balance at issue). Current balances are on the
  invoice page and the client statement.
