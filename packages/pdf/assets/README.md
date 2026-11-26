# Official forms

`tx-50-162.pdf` — Texas Comptroller Form 50-162, _Appointment of Agent for Property Tax
Matters_ (fillable PDF). Texas Tax Code §1.111 requires the Comptroller's prescribed form, so
ProtestOS fills the official PDF rather than drawing its own.

- Source: https://comptroller.texas.gov/forms/50-162.pdf
- Not committed yet: download it here (it is public). Then run
  `pnpm --filter @app/pdf forms:fields assets/tx-50-162.pdf` and check the field names in
  `src/forms/tx-50-162.ts` against the list (they are marked "verify" until checked).
- Record the form's revision date (bottom of page 1) here when you add or replace it.
