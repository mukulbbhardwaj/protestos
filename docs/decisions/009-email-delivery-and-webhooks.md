# 009: Email through a queue, plain-text templates, tracked by signed webhooks

Status: accepted (M5). Provider still open (BUILD_PLAN 13.1): Mukul chose "build with mock,
decide later".

## Decision

- **Templates are plain text with `{{placeholders}}`**, per firm, falling back to built-in
  wording (`packages/shared/src/email`). Each key (invoice, invoice with no reduction, payment
  receipt, document reminder, prospect outreach) offers a fixed set of placeholders; saving a
  template with an unknown one is refused. Rendering escapes every value and turns blank lines
  into paragraphs, so a template can't inject HTML. (The plan's TipTap editor isn't needed for
  this; rich text can come later without changing the stored format's meaning.)
- **Every email is an `EmailDelivery` row first**, then a `mail.deliver` job (pg-boss, 4
  retries with backoff) renders and sends it (`packages/mailer`, shared by worker and API
  tests). Only QUEUED or FAILED deliveries are sent, and the provider gets `delivery-{id}` as
  its idempotency key, so retries never duplicate.
- **Send requests carry a request key** (one per send dialog). `(orgId, idempotencyKey)` is
  unique with `idempotencyKey = requestKey:invoice:id`, so a double click, a retry, or two tabs
  sending the same request create and send each email once. Receipts use `receipt:payment:id`.
- **Tracking:** `POST /webhooks/mail` verifies an HMAC-SHA256 signature over the raw body
  (`MAIL_WEBHOOK_SECRET`), finds each delivery by the provider's message id (never by an org id
  in the payload), and applies the event in that org's scope. Event ids are stored, so replays
  change nothing. Status only moves forward (sent → delivered → opened); a bounce wins.
- **Mock provider until one is chosen:** `DevFileMailProvider` writes to `.dev-mail`; the dev
  mailbox shows attachments and can mark a message delivered/opened/bounced through the same
  event code path. Production refuses to start without a real provider. Adding Postmark or
  Brevo = one `MailProvider` class + its webhook parser mapped to `MailEvent`.

## Consequences

- Two webhook events for the same delivery arriving at the same instant could each read the
  old event list; the later write wins. Providers send events seconds apart, so this is
  accepted; a row lock can be added if it shows up.
- Imported (historical) invoices have no PDF and can't be emailed.
