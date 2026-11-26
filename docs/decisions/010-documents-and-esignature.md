# 010: Documents are rendered once and signed as an envelope; the mock signs on our own page

Status: accepted (M6). Provider still open: Mukul chose "build with mock, decide later".

## Decision

- **Engagement agreement wording is per firm**, plain text with placeholders (like emails,
  ADR 009) and a `{{properties.table}}` paragraph. Every save bumps `version`, and each
  document records the version it was made from.
- **Form 50-162 is the Comptroller's own fillable PDF** (Tax Code §1.111 requires the prescribed
  form), filled with pdf-lib through `FIELD_MAP` (`packages/pdf/src/forms/tx-50-162.ts`). One
  form per appraisal district, listing that owner's accounts there. Missing fields are reported,
  not silently left blank. The official PDF is not committed yet: until it is added
  (`packages/pdf/assets/README.md`), creating a 50-162 returns FORM_NOT_INSTALLED and the
  agreement still works. Tests fill a stand-in form with the mapped field names; the names must
  be checked against the official file with `pnpm --filter @app/pdf forms:fields`.
- **One envelope per signing request** (`SignatureEnvelope`): one signer, several documents.
  PDFs are rendered once at send time and stored; what the client signs is exactly what was
  sent.
- **`SignatureProvider`** abstracts the provider. `MockSignatureProvider` (now) records the
  envelope; ProtestOS emails the "Documents to sign" link and hosts `/sign/:token` (a 32-byte
  random token is the only credential, rate-limited). Signing stamps each page and appends a
  certificate page (name, email, time, IP, reference). A real provider sets `sendsOwnEmail`,
  and its "completed" webhook calls the same `completeEnvelope` with `getSignedDocuments`.
- **Completion side effects** (whether signed online, via webhook, or uploaded on paper):
  documents SIGNED with the signed copy stored, envelope SIGNED, 50-162 property-years →
  AOA_SIGNED (created if missing), prospect status → SIGNED.
- **Guard rails:** resending a document already signed for that tax year is refused unless the
  firm turns on `allowResendSigned`; void and decline end the link; reminders re-email it.

## Consequences

- The mock's signature is a typed-name electronic signature with an audit certificate; firms
  wanting a provider's certificate of completion need the real provider.
- Before production use of the 50-162: add the official PDF and verify `FIELD_MAP`.
