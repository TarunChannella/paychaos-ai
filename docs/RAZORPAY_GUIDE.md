# PayChaos AI — Razorpay Test Mode Integration Guide

**Project:** PayChaos AI — Autonomous Payment Reliability Engineer  
**Primary Phase:** Phase 2 — Razorpay Test Mode + Payments + Webhooks  
**Environment:** Razorpay Test Mode only  
**Authority:** Current official Razorpay documentation + approved PayChaos architecture  
**Verified Against Razorpay Documentation:** August 22, 2026  
**Runtime Cost Target:** ₹0

---

# 0. Purpose and Authority of This Document

This document is the Razorpay-specific source of truth for PayChaos AI.

It defines:

- how Razorpay is used;
- what the developer must configure manually;
- what Claude must implement in Phase 2;
- what payment and webhook evidence can be trusted;
- security boundaries;
- Test Mode safety;
- webhook reliability rules;
- Phase 2 testing requirements.

For Razorpay-specific behavior, current official Razorpay documentation is the primary external authority.

If official Razorpay documentation changes after this document is written, the latest official documentation takes precedence for Razorpay platform behavior, but any resulting architectural change must still follow the PayChaos architecture-change process.

Items marked:

**`[VERIFY-LATEST]`**

must be checked against current official Razorpay documentation immediately before implementation because the corresponding Dashboard UI, test tooling, URLs, limits, or platform behavior may change.

---

# 1. What Razorpay Is Used for in PayChaos AI

Razorpay provides the real payment-provider side of the controlled PayChaos test environment.

PayChaos uses Razorpay for:

1. creating real Razorpay **Test Mode Orders**;
2. opening Razorpay **Standard Checkout**;
3. creating real Razorpay Test Mode payment attempts;
4. receiving Razorpay Test Mode payment identifiers;
5. verifying successful Checkout responses;
6. receiving real Razorpay Test Mode webhooks;
7. obtaining payment/order state evidence;
8. creating authentic Test Mode evidence that PayChaos can later use for controlled reliability tests.

Razorpay does **not** provide the PayChaos chaos engine.

PayChaos does not attempt to manipulate Razorpay infrastructure.

The boundary is:

```text
REAL RAZORPAY TEST MODE

Order
→ Checkout
→ Test Payment
→ Razorpay Payment State
→ Razorpay Webhook
→ PayChaos Evidence Store


PAYCHAOS-CONTROLLED TESTING

Verified Razorpay Evidence
→ Internal Replay / Controlled Simulation
→ Demo Merchant Processing
→ Money Invariants
```

---

# 2. Why Test Mode Is Mandatory

PayChaos is a pre-production reliability-testing system.

All Razorpay operations must therefore use **Test Mode**.

Razorpay describes Test Mode as a simulation environment where no real customer money moves. Test and Live environments have separate API credentials. Current Razorpay documentation also identifies Test Mode API keys with the `rzp_test_` prefix.

This project deliberately injects failure conditions.

Running these tests against real payments would violate the PayChaos safety model.

---

# 3. What Must Never Happen in Live Mode

PayChaos must never:

- run chaos scenarios using Razorpay Live Mode;
- create reliability-test payments using Live Mode credentials;
- replay production Razorpay webhooks;
- intentionally cause retries against production merchant processing;
- use real customer payments as chaos fixtures;
- modify real merchant payment state for testing;
- use live card/payment credentials;
- use live webhook payloads as demo fixtures;
- display a UI option that enables PayChaos chaos execution in Live Mode.

If a configured Key ID begins with:

```text
rzp_live_
```

PayChaos must refuse Razorpay integration startup or refuse the relevant operation.

The system must fail closed.

---

# 4. Razorpay Account Requirements

The developer needs a Razorpay account with access to the Payments Dashboard.

For Test Mode integration:

- a Razorpay account is required;
- Test Mode must be accessible;
- Test Mode API keys must be generated;
- the account user must have sufficient permission to manage API keys and webhooks.

Current Razorpay documentation states that Owner and Admin roles can access API-key generation and that Test Mode integration can begin without completing the requirements needed for accepting real Live Mode payments.

PayChaos does not require Live Mode activation.

---

# 5. Test Mode Activation / Setup

Before generating credentials or configuring webhooks:

1. log in to the Razorpay Dashboard;
2. locate the Test/Live mode control;
3. switch to **Test Mode**;
4. confirm the Dashboard visibly indicates Test Mode;
5. remain in Test Mode while creating PayChaos credentials and webhooks.

Current Razorpay documentation describes a Test/Live control at the top of the Dashboard, although the exact UI control may appear as a toggle or dropdown depending on the current Dashboard version.

**`[VERIFY-LATEST]`**  
Before manual setup, confirm the current Test/Live switch location in the official Dashboard documentation.

---

# 6. How to Obtain the Test API Key ID

While the Dashboard is in Test Mode:

1. open **Account & Settings**;
2. find **API Keys** under the website/app settings area;
3. choose **Generate Key**;
4. save the generated Key ID and Key Secret securely.

Current official instructions use:

```text
Account & Settings
→ API Keys
→ Generate Key
```

for the selected Test Mode.

The Test Key ID should identify itself as a Test Mode key, currently using the prefix:

```text
rzp_test_
```

PayChaos must validate this.

---

# 7. How to Obtain the Test API Key Secret

The Key Secret is generated together with the Test Key ID.

Important Razorpay behavior:

- the Key Secret is sensitive;
- Razorpay exposes it when generated;
- later the Dashboard shows the Key ID but not the Key Secret;
- if the secret is lost, the key may need to be regenerated.

Razorpay explicitly warns against sharing the Key Secret publicly.

The developer must copy the secret into a secure local password manager or environment configuration immediately.

---

# 8. How Secrets Must Be Stored

The following are secrets:

```text
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
```

They must be stored only in:

- `.env.local` during local development;
- Vercel server-side environment variables for deployed environments;
- another approved secret-storage mechanism if architecture changes later.

They must never be:

- hard-coded;
- committed to Git;
- pasted into frontend source;
- exposed through API responses;
- included in screenshots;
- included in handoff documents;
- included in logs.

`.env.local` must remain ignored by Git.

An `.env.example` may contain variable **names only**, never secret values.

---

# 9. What Must Never Be Exposed to the Browser

The browser must never receive:

```text
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
```

The browser may receive the Razorpay **Key ID** because Standard Checkout requires it.

The Key ID is not treated as an authentication secret by Razorpay, but PayChaos should still avoid committing the account-specific value to Git.

Preferred PayChaos design:

```text
Server Environment
    ├── RAZORPAY_KEY_ID
    ├── RAZORPAY_KEY_SECRET
    └── RAZORPAY_WEBHOOK_SECRET

Server
    ↓
Validates Test Mode
    ↓
Returns only Checkout-safe values
    ↓
Browser receives Key ID + Order data
```

---

# 10. Razorpay Standard Checkout Role

PayChaos uses **Razorpay Web Standard Checkout**.

Standard Checkout is responsible for the customer-facing Test Mode payment interaction.

For PayChaos, Checkout must:

1. receive a server-created Razorpay `order_id`;
2. display Razorpay's payment interface;
3. perform a Test Mode transaction;
4. return payment success information to the browser when appropriate.

Current Razorpay documentation recommends using the client-side handler for standard web integration and using webhooks for server-side confirmation.

Therefore PayChaos P0 uses:

```text
Standard Checkout handler
+
server-side verification
+
webhooks
```

rather than depending on a redirect callback as the primary architecture.

---

# 11. Orders API Role

Every PayChaos Test Mode payment must begin with a server-created Razorpay Order.

Current Razorpay documentation explicitly requires creating an Order on the server and passing its `order_id` to Checkout.

Conceptual flow:

```text
Internal Merchant Order
        ↓
Internal Payment Attempt
        ↓
Server
        ↓
Razorpay Orders API
        ↓
Razorpay order_id
        ↓
Persist correlation
        ↓
Standard Checkout
```

Amounts must be sent in the currency's smallest supported subunit.

For INR:

```text
₹500.00
=
50000 paise
```

PayChaos P0 should use INR unless a later approved requirement needs another currency.

---

# 12. Payments Role

A Razorpay Payment represents a payment attempt associated with the Razorpay Order.

PayChaos tracks Razorpay Payment IDs to correlate:

```text
Demo Merchant Order
↔ Internal Payment Attempt
↔ Razorpay Order
↔ Razorpay Payment
↔ Webhook Events
```

The payment's captured/failed state is Razorpay-side evidence.

PayChaos does not alter Razorpay's payment truth.

---

# 13. Webhook Role

Webhooks provide asynchronous server-to-server payment-state evidence.

This is critical because browser-based success handling may fail because of:

- browser closure;
- refresh;
- connectivity failure;
- page navigation;
- callback failure.

Razorpay recommends webhooks for payment automation and allows API status verification when immediate confirmation is needed.

PayChaos treats an authenticated Razorpay webhook as authoritative external evidence of the event contained in that webhook.

---

# 14. Webhook Endpoint Requirements

PayChaos freezes the P0 webhook path as:

```text
POST /api/webhooks/razorpay
```

The deployed URL therefore becomes conceptually:

```text
https://<paychaos-domain>/api/webhooks/razorpay
```

Requirements:

- public;
- HTTPS;
- reachable by Razorpay;
- no browser login/session required;
- no CSRF mechanism that blocks Razorpay;
- signature verification mandatory;
- request body available in original raw form;
- fast response;
- no AI processing;
- no long-running analytics.

Razorpay currently requires webhook URLs to be publicly reachable and rejects localhost as a webhook destination.

---

# 15. Webhook Secret Setup

PayChaos requires a dedicated webhook secret.

Although Razorpay's Dashboard documentation describes the secret as optional/recommended at the platform level, it is **mandatory for PayChaos** because unsigned webhooks cannot become authoritative evidence.

Use:

```text
RAZORPAY_WEBHOOK_SECRET
```

The webhook secret must:

- be randomly generated;
- be different from the Razorpay API Key Secret;
- be at least 32 random characters for PayChaos;
- be stored server-side only;
- never be committed to Git.

Do not reuse:

```text
RAZORPAY_KEY_SECRET
```

as the webhook secret.

---

# 16. Webhook Signature Verification

Every incoming Razorpay webhook must be authenticated.

Razorpay sends the webhook signature through:

```text
X-Razorpay-Signature
```

Current Razorpay documentation specifies:

```text
HMAC-SHA256
key     = webhook secret
message = raw webhook request body
```

The calculated digest is compared with the received signature.

Only after successful verification may the event be classified as:

```text
REAL_RAZORPAY_WEBHOOK
```

---

# 17. Raw-Body Verification Requirements

Webhook verification must use the exact raw request body received from Razorpay.

Do **not**:

```text
receive JSON
→ parse JSON
→ stringify JSON
→ verify signature
```

Parsing and serializing can change the body representation and break signature validation.

The required order is:

```text
Receive request
        ↓
Read raw body
        ↓
Verify signature
        ↓
Only then parse JSON
```

Razorpay explicitly instructs integrations not to parse or cast the body before signature generation/verification.

---

# 18. Event ID / Deduplication Requirements

Razorpay provides:

```text
x-razorpay-event-id
```

as a unique identifier for a webhook event.

PayChaos must persist this value.

A database uniqueness boundary must protect the canonical external-event identity.

Current Razorpay guidance specifically recommends using `x-razorpay-event-id` to identify duplicates.

Do not rely only on:

```text
SELECT event
if not found:
    INSERT event
```

because two concurrent webhook requests can race.

The database must enforce the uniqueness guarantee.

---

# 19. Duplicate Webhook Handling

Razorpay uses **at-least-once delivery semantics**.

Therefore the same event can legitimately be delivered multiple times.

PayChaos must distinguish:

```text
logical event identity
```

from:

```text
delivery attempt
```

For duplicate delivery:

1. verify the signature;
2. inspect `x-razorpay-event-id`;
3. detect that the logical event is already known;
4. record duplicate-delivery evidence if useful;
5. do not repeat the business effect;
6. return a successful 2xx response if the original event has already been consumed successfully.

Duplicate webhook delivery is expected distributed-system behavior, not automatically an application error.

---

# 20. Out-of-Order Webhook Handling

PayChaos must never assume chronological webhook delivery.

Razorpay explicitly states that events may arrive out of order.

Therefore:

- event processing must inspect current state;
- state transitions must be monotonic/safe where appropriate;
- timestamps are evidence, not processing instructions by themselves;
- an older event must not incorrectly move a merchant from a stronger final state to an earlier state.

For example:

```text
payment.captured
```

must not be undone merely because another earlier-state event is processed later.

---

# 21. Webhook Retry Behavior

Current Razorpay documentation states:

- any non-2xx response is treated as a delivery failure;
- webhook failures are retried using exponential/progressive backoff;
- retrying continues for up to 24 hours after event creation;
- if failures continue for 24 hours, the webhook may be disabled;
- the endpoint should respond within 5 seconds;
- an event accepted by the server but not acknowledged within 5 seconds may be delivered again.

Do not assume an exact number of retry attempts.

The supported contract is:

```text
at-least-once
+
progressive retry
+
24-hour failure window
```

**`[VERIFY-LATEST]`** before Phase 2 if exact retry behavior is important to a test.

## PayChaos P0 Webhook Timing Acceptance Rule

For the frozen P0 architecture, the critical durable webhook request path must return its HTTP response within the current documented 5-second Razorpay response expectation.

Required implementation/test behavior:

- record structured `latency_ms` for webhook request handling;
- keep signature verification, canonical event persistence, bounded deterministic merchant processing and required durable status updates inside the measured critical path;
- do **not** run diagnosis, AI/ML, Reliability Score calculation, report generation or other non-critical analytics before returning the webhook response;
- every real webhook used for Phase 2 manual approval must show a measured response latency below 5000 ms;
- an automated timing/budget test must prove the normal handler contains no intentional long sleep or unbounded work;
- if real deployed testing cannot reliably satisfy this requirement, Phase 2 must not be approved until an explicit architecture decision resolves the processing model.

This synchronous P0 handler is a **Test Mode buildathon simplification**. It must not be presented as a general production-scale webhook-processing recommendation.

---

# 22. Safe Webhook Response Behavior

The PayChaos webhook endpoint should follow this response policy.

## Verified + Successfully Processed

Return:

```text
2xx
```

preferably HTTP 200 or 204.

---

## Already Successfully Processed Duplicate

Return:

```text
2xx
```

quickly.

The duplicate is safe because processing is idempotent.

---

## Verified but Unsupported Event

Record safe metadata if useful and return:

```text
2xx
```

to prevent unnecessary retries.

---

## Invalid Signature

Return a non-2xx client/security error.

Do not update merchant state.

---

## Malformed Required Payload

Return a non-2xx response.

Do not trust the event.

---

## Database / Internal Processing Failure

If PayChaos has not successfully completed its durable P0 processing:

return:

```text
5xx
```

so Razorpay can retry.

Because P0 intentionally has no separate durable queue, PayChaos must not acknowledge successful processing before the critical durable operation has succeeded.

---

# 23. Relevant Event Types for the MVP

The frozen Phase 2 P0 subscriptions are:

```text
payment.captured
payment.failed
order.paid
```

Razorpay currently recommends these core payment/order events for Standard Checkout reliability.

## `payment.captured`

Primary payment-capture evidence.

Important for:

- merchant paid state;
- fulfilment eligibility;
- money invariants.

---

## `payment.failed`

Failure evidence when Razorpay emits it.

Important caveat:

`payment.failed` must **not** automatically become a permanent terminal state.

Razorpay documents cases where a `payment.failed` event may later be followed by `payment.captured` for the same transaction. Razorpay also documents that not every initial authorisation failure necessarily produces this webhook.

---

## `order.paid`

Corroborates that the Razorpay Order reached paid state after payment capture.

`payment.captured` and `order.paid` must not produce duplicate merchant fulfilment.

---

## `payment.authorized`

Not required for Phase 2 P0.

It may be added later only if an approved Phase 3 scenario specifically requires authorization-state evidence.

**`[VERIFY-LATEST]`** event catalogue before adding any new subscription.

---

# 24. Payment Success Flow

The canonical success path is:

```text
1. Demo Merchant creates internal order
2. Server creates internal payment attempt
3. Server generates unique Razorpay receipt
4. Server calls Razorpay Orders API
5. Razorpay returns order_id
6. Server persists order_id
7. Browser receives Checkout-safe order data
8. Browser opens Standard Checkout
9. User completes Test Mode payment
10. Checkout returns:
      razorpay_payment_id
      razorpay_order_id
      razorpay_signature
11. Browser sends those values to PayChaos server
12. Server loads trusted order_id from database
13. Server verifies Checkout signature
14. Verified Checkout evidence is stored
15. UI may show "payment response verified"
16. PayChaos waits for captured state evidence
17. Razorpay sends payment.captured and/or order.paid webhook
18. Webhook signature is verified
19. Event is stored/deduplicated
20. Merchant payment state becomes paid/captured
21. Business fulfilment occurs exactly once
```

Razorpay's Standard Checkout success response returns `razorpay_payment_id`, `razorpay_order_id`, and `razorpay_signature`.

---

# 25. Payment Failure Flow

The failure path must account for both browser UX and asynchronous Razorpay state.

Conceptually:

```text
Checkout attempt
      ↓
Failure shown in Checkout/browser
      ↓
PayChaos may record client-side failure observation
      ↓
No fulfilment
      ↓
Wait for authoritative provider evidence
      ↓
payment.failed webhook when Razorpay emits it
      ↓
Store verified failure evidence
```

A browser-reported failure is not sufficient to determine permanent payment truth.

PayChaos must tolerate later events.

If Razorpay later sends:

```text
payment.captured
```

for the same transaction, PayChaos must process the stronger/newer verified payment state rather than incorrectly keeping the transaction permanently failed. Razorpay documents this possibility.

---

# 26. Server-Side Payment Verification

Checkout success must always be verified on the server.

Razorpay requires payment signature verification using:

```text
trusted order_id from PayChaos database
+
razorpay_payment_id
+
RAZORPAY_KEY_SECRET
```

The verification relationship is:

```text
HMAC-SHA256(
    order_id + "|" + razorpay_payment_id,
    key_secret
)
```

The result must match:

```text
razorpay_signature
```

Critically, Razorpay instructs integrations to use the `order_id` from the application's server/database rather than trusting the copy returned by the browser.

## Important Authority Rule

Successful signature verification means:

> The Checkout success data is authentic.

It does **not by itself mean**:

> The merchant may permanently assume captured payment state.

Captured status should be confirmed through verified webhook evidence or, when necessary, an authenticated Razorpay status API. Razorpay recommends verifying that the payment is captured before providing goods/services.

---

# 27. Test Event Capture Strategy

Phase 2 must generate authentic Razorpay Test Mode evidence through actual Test Mode transactions.

Required capture process:

```text
Demo Merchant
→ Create Razorpay Test Order
→ Open Standard Checkout
→ Complete Test Mode payment
→ Receive Checkout response
→ Verify Checkout response
→ Receive genuine Razorpay webhook
→ Verify webhook
→ Persist event
```

Synthetic webhook JSON alone is insufficient for Phase 2 approval.

A real manually verified Test Mode webhook is mandatory.

---

# 28. Authentic Webhook Fixture Capture

PayChaos may preserve sanitized copies of real Razorpay Test Mode webhook payloads for automated testing.

Fixtures captured this way must be labeled:

```text
CAPTURED_RAZORPAY_TEST_MODE_FIXTURE
```

or equivalent explicit metadata.

Before committing a captured fixture to Git:

remove or replace:

- email;
- phone/contact;
- VPA/UPI identifiers;
- card/instrument details;
- personal data;
- secrets;
- webhook signatures;
- unnecessary account-specific information.

For evidence integrity, PayChaos may persist:

```text
raw_body_sha256
signature_verified = true
```

for the authentic incoming request while separately storing:

```text
raw_payload_redacted
```

for safe inspection.

A sanitized fixture can be used for:

- normalization tests;
- processing tests;
- replay tests.

It cannot be used as proof that a new Razorpay webhook was delivered during a later test.

---

# 29. Controlled Webhook Replay Strategy

Phase 3 replay must use an existing verified event.

Required architecture:

```text
Original verified Razorpay event
        ↓
immutable source evidence
        ↓
PayChaos creates processing/replay attempt
        ↓
source = PAYCHAOS_REPLAY
        ↓
internal Event Processor
```

Replay should not call the public webhook endpoint pretending to be Razorpay.

Replay does not require forging a Razorpay signature.

The original event remains unchanged.

---

# 30. Real Razorpay Event vs PayChaos Replay / Simulation

## Real Razorpay Test Mode Event

Definition:

An HTTP webhook actually delivered by Razorpay Test Mode to the PayChaos public webhook endpoint and successfully signature-verified.

Label:

```text
REAL_RAZORPAY_WEBHOOK
```

---

## PayChaos Replay

Definition:

PayChaos reprocesses stored evidence from a previously verified Razorpay event.

Label:

```text
PAYCHAOS_REPLAY
```

---

## PayChaos Simulation

Definition:

PayChaos generates a controlled internal test condition that did not originate as a new Razorpay event.

Label:

```text
PAYCHAOS_SIMULATION
```

---

## Test Fixture

Definition:

Static data used by automated tests.

Label:

```text
TEST_FIXTURE
```

---

# 31. Required UI Labels for Simulated / Replayed Events

Judge-facing UI must use clear badges or text.

Preferred wording:

```text
Razorpay Test Mode — Real Event
PayChaos Replay
PayChaos Simulation
Automated Test Fixture
```

Never display:

```text
Razorpay Webhook
```

for something that was only internally replayed.

---

# 32. Payment Data PayChaos May Store

P0 may persist payment reliability evidence such as:

- internal merchant order ID;
- internal payment attempt ID;
- Razorpay Order ID;
- Razorpay Payment ID;
- Razorpay webhook event ID;
- unique Razorpay receipt;
- amount in smallest currency subunit;
- currency;
- Razorpay order state;
- Razorpay payment state;
- event type;
- payment-method category where useful;
- timestamps;
- captured/failed state;
- verification status;
- processing status;
- Razorpay error code;
- Razorpay error source;
- Razorpay error step;
- Razorpay error reason;
- redacted webhook payload;
- hash of original webhook body;
- event provenance.

Store only what supports reliability testing.

---

# 33. Payment / Card Data PayChaos Must Never Store

PayChaos must never intentionally store:

- PAN/full card number;
- CVV;
- card PIN;
- raw card credentials;
- authentication OTP;
- real customer banking credentials;
- full bank-account credentials;
- reusable payment tokens unless an approved feature later requires them;
- unnecessary VPA/UPI identifiers;
- unnecessary customer email/phone data;
- Razorpay Key Secret;
- webhook secret.

The Demo Merchant should use Razorpay Checkout for sensitive payment entry.

Sensitive payment credentials must never pass through the PayChaos backend.

---

# 34. Razorpay-Related Database Fields

The final database schema is defined in `DATABASE.md`. Phase 2 must preserve the following ownership boundaries rather than collapsing Razorpay Order and Razorpay Payment state into one record.

## Internal Payment Attempt / Razorpay Order Ownership

`payment_attempts` owns the server-created Razorpay Order correlation and attempt lifecycle. Required Razorpay-related fields include:

```text
razorpay_receipt
razorpay_order_id
razorpay_order_status
```

The payment attempt also owns the internal attempt amount/currency and lifecycle fields defined in `DATABASE.md`.

## Canonical Razorpay Payment Ownership

`payments` owns Razorpay Payment identity, Checkout verification evidence and payment-state observations. Required fields include:

```text
razorpay_payment_id
razorpay_payment_status
amount_subunits
currency
checkout_signature_verified
checkout_verified_at
first_observed_at
last_observed_at
captured_at
failed_at
error_code
error_description_redacted
error_source
error_step
error_reason
```

Do not store `razorpay_payment_id`, Checkout verification state or Razorpay payment status on `payment_attempts` merely for convenience. `DATABASE.md` remains authoritative.

## External Webhook Event

Required canonical event semantics include:

```text
razorpay_event_id
event_type
source_kind
signature_verified
received_at
raw_body_sha256
raw_payload_redacted
processing_status
processed_at
duplicate_delivery_count
```

Correlation fields to the payment attempt/payment are defined by `DATABASE.md`.

## Integrity Requirements

At minimum:

```text
razorpay_order_id       UNIQUE where applicable
razorpay_payment_id     UNIQUE in canonical payment record
razorpay_event_id       UNIQUE for canonical external event
razorpay_receipt        UNIQUE
```

Current Razorpay Orders API documentation states that `receipt` must be unique and currently treats duplicate receipt order creation as a duplicate request/idempotency condition.

---

# 35. Razorpay-Related Logging Fields

Structured server logs may contain:

```text
event_name
event_source
merchant_order_id
payment_attempt_id
razorpay_order_id
razorpay_payment_id
razorpay_event_id
event_type
signature_verified
duplicate_detected
processing_status
http_status
latency_ms
error_code
error_reason
```

Never log:

```text
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
full raw card data
CVV
full unredacted webhook body
```

---

# 36. Razorpay Security Requirements

All of the following are mandatory.

## SR-RZP-001

Only Test Mode credentials may be accepted.

## SR-RZP-002

A `rzp_live_` Key ID must cause rejection.

## SR-RZP-003

Key Secret remains server-side.

## SR-RZP-004

Webhook Secret remains server-side.

## SR-RZP-005

Checkout success is verified server-side.

## SR-RZP-006

Trusted server `order_id` is used during payment-signature verification.

## SR-RZP-007

Webhook signatures are checked using the raw body.

## SR-RZP-008

Invalid signatures cannot mutate authoritative state.

## SR-RZP-009

External event IDs have a database uniqueness boundary.

## SR-RZP-010

Business fulfilment has a separate idempotency boundary.

## SR-RZP-011

No card/CVV storage.

## SR-RZP-012

No arbitrary webhook/chaos target.

## SR-RZP-013

Real versus replayed events remain distinguishable.

---

# 37. Razorpay Error Handling

Razorpay-related errors fall into different classes.

## Configuration Error

Examples:

- missing Key ID;
- missing Key Secret;
- Live Mode key configured;
- missing webhook secret.

Action:

```text
fail closed
```

---

## Checkout Signature Error

Action:

- reject verification;
- do not mark paid;
- do not fulfil;
- record safe failure evidence.

Razorpay explicitly treats payment-signature verification as mandatory.

---

## Webhook Signature Error

Action:

- reject event;
- do not normalize it as trusted evidence;
- do not process merchant state;
- log safe security metadata.

---

## Razorpay 4xx Request Error

Action:

- validate request/configuration;
- do not blindly retry malformed/authentication errors.

---

## Razorpay 5xx / Network Error

Action:

- treat as potentially transient;
- retry safely only when the operation semantics allow;
- preserve correlation identifiers.

---

## Ambiguous Payment State

Action:

- do not guess;
- wait for webhook or fetch Razorpay state through the authenticated server API.

---

# 38. Idempotency Requirements

PayChaos requires three different idempotency boundaries.

## 38.1 Razorpay Order Creation

Create a stable unique `receipt` from the internal payment attempt.

Do not generate a brand-new receipt simply because a network request timed out.

Current Razorpay Orders API documentation treats `receipt` as unique and rejects duplicate creation using the same receipt.

---

## 38.2 Webhook Event Identity

Use:

```text
x-razorpay-event-id
```

for external event deduplication.

---

## 38.3 Business Effect

Even different Razorpay events may represent the same business outcome.

For example:

```text
payment.captured
+
order.paid
```

must not result in:

```text
FULFIL_ORDER
FULFIL_ORDER
```

The merchant effect must itself be idempotent.

---

# 39. Rate-Limit / API-Failure Handling

Razorpay APIs may return rate-limit responses.

Current Razorpay API guidance recommends handling HTTP 429 with backoff and avoiding aggressive polling.

PayChaos rules:

## HTTP 429

Use:

```text
exponential/stepped backoff
+
small random jitter
```

Do not continuously retry.

Prefer webhooks rather than frequent polling.

---

## GET / Status Queries

Transient network/5xx failures may be retried with bounded backoff.

---

## Order Creation

Do not blindly create a second Order with a new receipt after a timeout.

Instead:

1. retain the internal payment-attempt ID;
2. retain the same receipt;
3. determine whether the first request succeeded;
4. use the Orders API/query by receipt where necessary;
5. only create another logical payment attempt when the first outcome is resolved.

Current Razorpay APIs support filtering orders by receipt, which assists reconciliation of ambiguous order creation.

---

# 40. Local Development Requirements

The web application itself may run on localhost.

Razorpay's webhook service cannot send directly to:

```text
localhost
```

because webhook endpoints must be publicly reachable.

## Preferred PayChaos Phase 2 Strategy

Use a temporary Vercel preview deployment for real webhook verification.

This provides:

- HTTPS;
- public URL;
- same Next.js runtime;
- no paid infrastructure.

## Alternative

Current Razorpay documentation suggests `zrok` for exposing localhost because several common webhook-testing/tunnel domains are blacklisted.

**`[VERIFY-LATEST]`**

Do not assume:

- ngrok;
- localhost.run;
- webhook.site;
- requestbin;
- another tunnel

is currently accepted.

Verify the current Razorpay webhook-domain restrictions first.

---

# 41. Public Deployment / Webhook Requirements

For deployed Phase 2 and final Phase 5 verification:

- endpoint must use HTTPS;
- endpoint must be public;
- endpoint must remain stable while configured in Razorpay;
- endpoint must respond within Razorpay's 5-second requirement;
- endpoint must not redirect to authentication;
- webhook verification must use the configured Test Mode secret;
- Test Mode webhook must point only to the PayChaos deployment;
- deployment environment may be called "Production" by Vercel, but Razorpay remains **Test Mode**.

If a new Vercel URL is created:

update the Razorpay Test Mode webhook configuration.

---

# 42. RAZORPAY MANUAL SETUP — USER ACTIONS

These are the exact manual actions the developer must perform.

Dashboard wording may change. Where Razorpay changes labels, look for the equivalent function described below rather than guessing.

---

## Step 1 — Create or Log In to Razorpay Account

### Where to click

Open the Razorpay Dashboard and sign in.

### What to create

Nothing if an account already exists.

Otherwise create a normal Razorpay account.

### What to copy

Nothing.

### Secret?

No.

### Commit to GitHub?

Nothing to commit.

---

## Step 2 — Switch the Dashboard to Test Mode

### Where to click

Look at the top portion of the Razorpay Dashboard for the Test/Live mode control.

Current official documentation describes a Test/Live toggle or dropdown.

Choose:

```text
Test Mode
```

### What to create

Nothing.

### What to copy

Nothing.

### Secret?

No.

### Commit to GitHub?

No.

### Verification

Do not continue until the Dashboard clearly indicates Test Mode.

---

## Step 3 — Generate Test API Keys

### Where to click

Current documented path:

```text
Account & Settings
→ Website and app settings
→ API Keys
→ Generate Key
```



### What to create

One Test Mode API-key pair.

### What to copy

Copy:

```text
Key ID
Key Secret
```

### Secret?

| Value | Secret? |
|---|---|
| Key ID | No, but account-specific |
| Key Secret | **YES** |

### Where it will later be stored

```text
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
```

in `.env.local` and later Vercel server environment variables.

### Commit to GitHub?

```text
Key ID: NO
Key Secret: NEVER
```

Even though Key ID is client-safe, PayChaos keeps actual account configuration outside source control.

---

## Step 4 — Verify the Key Is Test Mode

Inspect the Key ID.

Current Test Mode keys should begin:

```text
rzp_test_
```

If it begins:

```text
rzp_live_
```

stop immediately.

Do not use it.

### Secret?

The prefix is not secret.

### Commit?

Do not commit the actual key.

---

## Step 5 — Check Payment Capture Setting

PayChaos P0 expects a normal captured-payment flow.

Current Razorpay behavior defaults to automatic capture for standard customers, but the developer must confirm the account's actual setting.

### Where to click

Look under:

```text
Account & Settings
→ Payments / Payments & Refunds
→ Payment Capture
```

Current official pages use wording such as:

```text
Payments Capture
```

or:

```text
Capture and refund settings
```

depending on Dashboard version.

### What to configure

For PayChaos P0:

**Auto-capture payments**.

Do not introduce manual capture complexity unless later approved.

### What to copy

Nothing.

### Secret?

No.

### Commit?

No.

### `VERIFY-LATEST`

Confirm the current Dashboard label before changing the setting.

---

## Step 6 — Wait Until Claude Implements the Webhook Endpoint

Do not configure the PayChaos webhook URL until the application contains:

```text
POST /api/webhooks/razorpay
```

and the endpoint is deployed to a public HTTPS URL.

### What to copy

Copy the public base deployment URL once available.

Example shape:

```text
https://<deployment-domain>
```

Do not treat this example as the final domain.

---

## Step 7 — Construct the PayChaos Webhook URL

Combine the deployed domain with:

```text
/api/webhooks/razorpay
```

Result:

```text
https://<deployment-domain>/api/webhooks/razorpay
```

### Secret?

No.

### Commit?

The route path may be committed.

The deployment URL may be documented later if desired.

---

## Step 8 — Create a Webhook Secret

Use a secure random-value generator or password manager.

Create a random secret of at least 32 characters.

### What to copy

Copy the generated secret.

### Where it will later be stored

```text
RAZORPAY_WEBHOOK_SECRET
```

### Secret?

**YES — HIGHLY SENSITIVE**

### Commit to GitHub?

**NEVER**

Do not use the Razorpay API Key Secret as this value.

---

## Step 9 — Open Razorpay Webhook Settings

Ensure the Dashboard is still in Test Mode.

### Where to click

Current official path:

```text
Account & Settings
→ Website and app settings
→ Webhooks
→ + Add New Webhook
```



### What to create

One PayChaos Test Mode webhook configuration.

---

## Step 10 — Enter the PayChaos Webhook URL

### Where

Inside the webhook setup form, find the webhook URL/website URL field.

### Value

Paste:

```text
https://<deployment-domain>/api/webhooks/razorpay
```

### Secret?

No.

### Commit?

No secret concern, but do not hard-code deployment-specific URLs unnecessarily.

---

## Step 11 — Enter the Webhook Secret

### Where

Find the field named:

```text
Secret
```

or equivalent webhook-signing secret field.

### Value

Paste the value created in Step 8.

### Secret?

**YES**

### Commit?

**NEVER**

---

## Step 12 — Enter Alert Email

Razorpay's current webhook configuration includes an alert email used for webhook failures/deactivation.

### Value

Use an email address the developer actively monitors.

### Secret?

No, but personal information.

### Commit?

Do not commit unless intentionally public.

---

## Step 13 — Select MVP Webhook Events

Under the event-selection / Active Events section, enable:

```text
payment.captured
payment.failed
order.paid
```

Do not enable every event.

Keep P0 small.

### Secret?

No.

### Commit?

The event names may be documented and committed.

---

## Step 14 — Create / Save the Webhook

Click:

```text
Create Webhook
```

or the current equivalent.

Razorpay currently calls this action **Create Webhook**.

If Test Mode setup asks for the current documented test OTP, Razorpay's documentation currently lists:

```text
754081
```

for Test Mode webhook configuration.

**`[VERIFY-LATEST]`** before using this value because Dashboard verification behavior can change.

---

## Step 15 — Confirm the Webhook Is Enabled

Return to the Webhooks list.

Confirm the PayChaos webhook is:

```text
Enabled
```

and configured for the correct URL.

### Secret?

No.

### Commit?

No.

---

## Step 16 — Configure Local Environment

Create local environment values:

```text
RAZORPAY_MODE=test
RAZORPAY_KEY_ID=<Test Key ID>
RAZORPAY_KEY_SECRET=<Test Key Secret>
RAZORPAY_WEBHOOK_SECRET=<Webhook Secret>
```

### Commit?

```text
RAZORPAY_MODE=test          may appear in .env.example
variable names              may be committed
real credential values      NEVER
```

---

## Step 17 — Configure Vercel Environment Later

When Phase 2 needs public webhook verification:

open the Vercel project's environment-variable settings.

Add:

```text
RAZORPAY_MODE
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
```

Use the same Test Mode credentials.

Do not create Live credentials.

Redeploy after environment changes if Vercel requires it.

---

# 43. Manual Verification Checklist

Phase 2 manual verification must include the following.

## Credential Verification

- [ ] Razorpay Dashboard is in Test Mode.
- [ ] Key ID starts with `rzp_test_`.
- [ ] Key Secret exists only server-side.
- [ ] Webhook Secret exists only server-side.
- [ ] No secret appears in Git.

## Order Verification

- [ ] Demo Merchant creates internal order.
- [ ] Server creates Razorpay Test Mode Order.
- [ ] Razorpay `order_id` is persisted.
- [ ] amount matches expected merchant amount.
- [ ] currency matches.

## Successful Payment Verification

- [ ] Checkout opens.
- [ ] Test Mode is obvious.
- [ ] a Test Mode payment succeeds.
- [ ] payment ID is returned.
- [ ] Checkout signature verifies.
- [ ] payment becomes captured.
- [ ] merchant order becomes paid.
- [ ] fulfilment occurs once.

Razorpay currently supports Test Mode mechanisms including mock success/failure behavior; where UPI Test Mode is available, official docs currently list `success@razorpay` and `failure@razorpay` as test VPAs.

## Webhook Verification

- [ ] real Razorpay Test Mode webhook reaches endpoint.
- [ ] `X-Razorpay-Signature` is present.
- [ ] signature verification succeeds.
- [ ] `x-razorpay-event-id` is stored.
- [ ] event is labeled `REAL_RAZORPAY_WEBHOOK`.
- [ ] event correlates with the correct order/payment.

## Failure Verification

- [ ] a supported Test Mode payment failure is triggered.
- [ ] merchant is not fulfilled.
- [ ] failure evidence is recorded safely.
- [ ] later state changes would still be accepted correctly.

## Duplicate Verification

- [ ] same logical webhook/event is processed twice through approved testing.
- [ ] canonical event remains one logical event.
- [ ] business fulfilment remains exactly once.

## Invalid Signature Verification

- [ ] intentionally invalid test signature is rejected.
- [ ] no merchant state changes.
- [ ] no trusted event is created.

---

# 44. Phase 2 Acceptance Criteria

## RZP-AC-001

PayChaos accepts only Test Mode configuration.

## RZP-AC-002

Live Key ID causes a safe rejection.

## RZP-AC-003

Server creates a real Razorpay Test Mode Order.

## RZP-AC-004

Razorpay `order_id` is stored against the internal payment attempt.

## RZP-AC-005

Standard Checkout opens using the server-created Order.

## RZP-AC-006

A real Test Mode payment can be completed.

## RZP-AC-007

Checkout signature is verified server-side.

## RZP-AC-008

Verification uses the trusted internal `order_id`.

## RZP-AC-009

A public Razorpay webhook endpoint exists.

## RZP-AC-010

A real Test Mode webhook reaches the endpoint.

## RZP-AC-011

Webhook signature verification uses the raw body.

## RZP-AC-012

Invalid signatures are rejected.

## RZP-AC-013

`x-razorpay-event-id` is persisted.

## RZP-AC-014

Database-level external-event deduplication exists.

## RZP-AC-015

Duplicate deliveries do not create duplicate business effects.

## RZP-AC-016

Out-of-order processing cannot regress final merchant state incorrectly.

## RZP-AC-017

`payment.captured`, `payment.failed`, and `order.paid` are supported.

## RZP-AC-018

Real Razorpay Test Mode events are explicitly labeled as real.

## RZP-AC-019

No PAN/CVV is stored.

## RZP-AC-020

Automated tests pass.

## RZP-AC-021

Manual Test Mode verification passes.

## RZP-AC-022

The deployed normal critical durable webhook request path is measured below 5000 ms for the real webhook used in Phase 2 manual approval.

---

# 45. Razorpay Integration Tests

Phase 2 must include automated tests for the following.

## Configuration Tests

- Test Key accepted;
- Live Key rejected;
- missing Key ID rejected;
- missing Key Secret rejected;
- missing webhook secret rejected.

## Order Tests

- valid amount creates correct order request;
- amount uses smallest currency subunit;
- internal receipt remains stable;
- duplicate receipt behavior handled safely;
- Razorpay order ID persisted;
- API failure does not create uncontrolled duplicate order.

## Checkout Verification Tests

- valid signature accepted;
- invalid signature rejected;
- wrong payment ID rejected;
- wrong internal order ID rejected;
- browser-provided order ID cannot override trusted server order.

## Webhook Signature Tests

- valid raw body + signature accepted;
- modified body rejected;
- wrong secret rejected;
- missing signature rejected;
- parsed/reserialized body is not used for verification.

## Event Tests

- supported event normalized;
- unsupported verified event safely ignored;
- payment/order IDs correlate correctly;
- event source is correct.

## Deduplication Tests

- duplicate `x-razorpay-event-id`;
- concurrent duplicate insertion where feasible;
- duplicate HTTP delivery does not duplicate canonical event.

## Business Idempotency Tests

- `payment.captured` repeated;
- `order.paid` repeated;
- both events refer to same successful payment;
- fulfilment occurs at most once.

## Ordering Tests

- order.paid before payment.captured;
- payment.captured before order.paid;
- earlier event arriving after final state;
- state remains correct.

## Response Tests

- processed event returns 2xx;
- processed duplicate returns 2xx;
- invalid signature returns non-2xx;
- internal failure returns 5xx.

---

# 46. Final Demo Razorpay Flow

The judge-facing Razorpay portion of the final demo should be:

```text
1. Show "Razorpay Test Mode"
2. Open Demo Merchant
3. Create merchant order
4. Show expected amount
5. Start payment
6. PayChaos server creates Razorpay Order
7. Open Razorpay Standard Checkout
8. Complete Test Mode payment
9. Show verified Checkout result
10. Show Razorpay Payment ID
11. Show Razorpay Order ID
12. Show real webhook event
13. Show signature verified
14. Show event source:
       Razorpay Test Mode — Real Event
15. Show correct merchant paid state
16. Show exactly one fulfilment effect
17. Later use this verified event for controlled PayChaos replay
18. Clearly label replay as PayChaos Replay
```

The narration must explicitly separate:

```text
what Razorpay actually did
```

from:

```text
what PayChaos deliberately replayed or simulated
```

---

# 47. Common Mistakes to Avoid

## Mistake 1

Using a Live Mode Key by accident.

**Prevention:** validate `rzp_test_`.

---

## Mistake 2

Putting `RAZORPAY_KEY_SECRET` into frontend environment variables.

**Prevention:** server-only variable.

---

## Mistake 3

Using the browser's order ID as trusted verification input.

**Prevention:** load `order_id` from PayChaos database.

---

## Mistake 4

Treating Checkout success as final captured payment truth.

**Prevention:** verify signature and use webhook/API state.

---

## Mistake 5

Parsing webhook JSON before signature verification.

**Prevention:** verify raw body first.

---

## Mistake 6

Ignoring `x-razorpay-event-id`.

**Prevention:** database uniqueness.

---

## Mistake 7

Deduplicating webhooks but not merchant fulfilment.

**Prevention:** separate business-effect idempotency.

---

## Mistake 8

Assuming webhooks arrive in order.

**Prevention:** order-independent state processing.

---

## Mistake 9

Returning 2xx before important P0 state is durably handled when no queue exists.

**Prevention:** acknowledge only after required durable processing.

---

## Mistake 10

Taking more than 5 seconds to respond.

**Prevention:** keep webhook path small.

---

## Mistake 11

Running diagnosis/AI during webhook ingestion.

**Prevention:** keep Phase 2 deterministic and bounded.

---

## Mistake 12

Using the API Key Secret as webhook secret.

**Prevention:** independent secrets.

---

## Mistake 13

Using localhost as Razorpay webhook URL.

**Prevention:** public HTTPS deployment/tunnel.

---

## Mistake 14

Assuming every tunnel service is accepted.

**Prevention:** check current Razorpay blacklist.

---

## Mistake 15

Blindly retrying Order creation with a new receipt.

**Prevention:** stable receipt + reconciliation.

---

## Mistake 16

Treating `payment.failed` as permanently terminal.

**Prevention:** allow later captured evidence.

---

## Mistake 17

Storing card/UPI/customer information unnecessarily.

**Prevention:** minimum evidence storage.

---

## Mistake 18

Calling a PayChaos replay a "Razorpay retry."

**Prevention:** explicit provenance labels.

---

# 48. Troubleshooting

## Problem — Cannot Generate Test API Key

Check:

1. Dashboard mode is Test;
2. account permissions;
3. API Keys section under Account & Settings.

Razorpay currently permits Test Mode API keys without adding a production website.

---

## Problem — Key Secret Is No Longer Visible

Razorpay does not continue displaying it after generation.

If lost:

regenerate the Test key and update every PayChaos environment that uses it.

---

## Problem — Razorpay API Authentication Fails

Check:

- Test Key ID and Test Key Secret belong to the same pair;
- no whitespace was copied;
- keys are not expired/regenerated;
- Dashboard mode matches the keys;
- PayChaos is not using a Live/Test combination.

Do not print the secret during debugging.

---

## Problem — Checkout Opens but Order Is Not Correlated

Check:

- Razorpay Order was created server-side;
- `order_id` was persisted before Checkout;
- the same `order_id` was supplied to Checkout;
- internal payment attempt ID maps to it.

---

## Problem — Checkout Signature Mismatch

Check:

- server uses stored trusted `order_id`;
- payment ID matches Checkout result;
- correct Test Key Secret is loaded;
- data is concatenated exactly according to Razorpay verification rules.

Never "fix" this by skipping verification.

---

## Problem — Webhook Does Not Arrive

Check:

1. Dashboard is Test Mode;
2. webhook is Enabled;
3. URL is correct;
4. URL is HTTPS/public;
5. required event is selected;
6. current deployment is reachable;
7. webhook is not disabled from repeated failures;
8. endpoint responds within 5 seconds.

Current Razorpay documentation says persistent failures for 24 hours can disable a webhook.

---

## Problem — Localhost Webhook Does Not Work

Expected.

Razorpay requires a public URL.

Use the approved Vercel preview strategy or current supported tunnel approach.

---

## Problem — Tunnel URL Rejected

Some tunneling/testing domains are blocked by Razorpay.

Check the current official blacklist.

Do not assume ngrok or another historical option works.

**`[VERIFY-LATEST]`**

---

## Problem — Webhook Signature Mismatch

Check:

- raw request body was preserved;
- body was not parsed before verification;
- correct webhook secret is used;
- header is `X-Razorpay-Signature`;
- webhook secret was not recently changed.

Razorpay notes that older retries may still require the old secret after a secret rotation.

For PayChaos P0, avoid rotating the webhook secret during an active demo cycle.

---

## Problem — Duplicate Events Appear

Expected possibility.

Check:

```text
x-razorpay-event-id
```

and verify database deduplication.

---

## Problem — Events Arrive in Unexpected Order

Expected possibility.

Do not sort processing logic based only on delivery order.

Use safe state-transition rules.

---

## Problem — Payment Shows Authorized Instead of Captured

Check the Razorpay Payment Capture setting.

Razorpay currently defaults to automatic capture for standard accounts, but authorized payments can exist in some circumstances.

Do not fulfil until captured state is verified.

---

## Problem — API Returns HTTP 429

Reduce request frequency.

Use bounded exponential backoff with jitter.

Prefer webhook notification over frequent polling.

---

## Problem — Order API Timed Out

Do not immediately create a different order.

Use the same internal payment attempt and receipt, then reconcile whether Razorpay already created the Order.

---

# 49. Environment Variables Required

P0 Razorpay configuration uses:

```text
RAZORPAY_MODE=test

RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
```

## `RAZORPAY_MODE`

Value:

```text
test
```

Secret:

No.

Purpose:

Explicit PayChaos safety guard.

---

## `RAZORPAY_KEY_ID`

Example shape:

```text
rzp_test_...
```

Secret:

No.

Browser exposure:

Permitted only where required for Checkout.

GitHub:

Do not commit actual value.

---

## `RAZORPAY_KEY_SECRET`

Secret:

**YES**

Browser exposure:

**NEVER**

GitHub:

**NEVER**

Purpose:

- Razorpay API authentication;
- Checkout payment-signature verification.

---

## `RAZORPAY_WEBHOOK_SECRET`

Secret:

**YES**

Browser exposure:

**NEVER**

GitHub:

**NEVER**

Purpose:

Webhook signature verification.

---

## Optional Rotation Variable

Not required in P0.

If webhook-secret rotation becomes necessary, an old-secret mechanism may temporarily be required because Razorpay retries older events using the old secret. This must be implemented only after checking the latest Razorpay documentation.

**`[VERIFY-LATEST]`**

---

# 50. Exact Client-Side vs Server-Side Credential Separation

| Value | Client | Server | Secret | Git |
|---|---:|---:|---:|---:|
| Razorpay Test Key ID | Yes, Checkout only | Yes | No | Do not commit actual value |
| Razorpay Test Key Secret | **No** | **Yes** | **Yes** | **Never** |
| Webhook Secret | **No** | **Yes** | **Yes** | **Never** |
| Razorpay Order ID | Yes | Yes | No | Runtime data |
| Razorpay Payment ID | Yes after payment | Yes | No | Runtime data |
| Checkout Signature | Browser receives, immediately forwards | Yes | Not credential secret | Do not log |
| Webhook Signature | No normal UI need | Yes | Not signing key | Do not log unnecessarily |
| `x-razorpay-event-id` | UI may display | Yes | No | Runtime evidence |

The preferred flow is:

```text
SERVER
holds credentials
    ↓
creates Razorpay Order
    ↓
returns only:
Key ID
order_id
amount
currency
safe display data
    ↓
BROWSER
opens Checkout
```

The browser never receives credentials capable of authenticated Razorpay API access.

---

# RAZORPAY SAFETY RULES

These rules are non-negotiable.

## Safety Rule 1 — Test Mode Only

All PayChaos payment activity uses Razorpay Test Mode.

---

## Safety Rule 2 — No Live Chaos

Never execute PayChaos chaos behavior against Razorpay Live Mode.

---

## Safety Rule 3 — No Real Customer Payment Data

Do not use real customers for PayChaos testing.

---

## Safety Rule 4 — No Real Card Details Stored

Sensitive payment entry occurs through Razorpay Checkout.

---

## Safety Rule 5 — Never Store CVV

CVV must never enter PayChaos persistence.

---

## Safety Rule 6 — Never Commit Secrets

Never commit:

```text
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
```

---

## Safety Rule 7 — Never Expose Key Secret

The Key Secret never enters browser code.

---

## Safety Rule 8 — Never Expose Webhook Secret

Webhook Secret is server-side only.

---

## Safety Rule 9 — Chaos Targets Only the Demo Merchant

Controlled replay and fault injection occur only against PayChaos-controlled processing.

---

## Safety Rule 10 — Never Attack Arbitrary Endpoints

Users cannot provide arbitrary:

- URLs;
- APIs;
- IPs;
- webhooks

for chaos testing.

---

## Safety Rule 11 — Never Misrepresent Replay

A PayChaos replay must never be described as a new Razorpay-generated event.

---

## Safety Rule 12 — Webhook Verification Is Mandatory

Unsigned/unverified payloads never become authoritative Razorpay evidence.

---

## Safety Rule 13 — Browser Payment Result Is Not Final Money Truth

Checkout result must be verified server-side and captured state must be supported by trusted payment evidence.

---

# Razorpay Source-of-Truth Hierarchy

For Razorpay behavior:

```text
Latest Official Razorpay Documentation
        ↓
RAZORPAY_GUIDE.md
        ↓
ARCHITECTURE.md
        ↓
PHASE_PLAN.md
        ↓
Phase 2 Implementation
```

For overall PayChaos product/safety scope:

```text
PROJECT_CONTEXT.md
```

remains the project authority.

If current official Razorpay behavior requires an architectural change:

1. verify the official documentation;
2. record the conflict;
3. create an architecture decision;
4. update documentation;
5. then modify implementation.

Do not silently redesign Phase 2.

---

# Razorpay Details Requiring Latest-Docs Verification

Immediately before Phase 2 manual setup, verify current official Razorpay documentation for:

```text
[VERIFY-LATEST] Dashboard Test/Live control location
[VERIFY-LATEST] API Keys Dashboard labels
[VERIFY-LATEST] Webhook configuration labels
[VERIFY-LATEST] Test webhook OTP behavior
[VERIFY-LATEST] Current blocked webhook/tunnel domains
[VERIFY-LATEST] Current recommended local tunnel option
[VERIFY-LATEST] Supported Test Mode payment methods
[VERIFY-LATEST] Current webhook event catalogue
[VERIFY-LATEST] Current webhook retry/deactivation policy
[VERIFY-LATEST] Any changed payment capture settings
```

These are operational details that Razorpay may change without requiring a PayChaos architectural redesign.

---

# RAZORPAY PHASE 2 DEFINITION OF DONE

Phase 2 is not complete merely because Razorpay-related code exists.

The required state progression remains:

```text
IMPLEMENTED
→ TESTED
→ MANUALLY VERIFIED
→ DOCUMENTED
→ APPROVED
```

Phase 2 may be approved only when all of the following are true.

## Credentials

- [ ] Test Mode credentials are configured securely.
- [ ] Key ID is confirmed as Test Mode.
- [ ] Key Secret is server-side only.
- [ ] Webhook Secret is server-side only.
- [ ] no Razorpay secret exists in Git or client bundle.

## Order / Payment

- [ ] server creates real Razorpay Test Mode Orders.
- [ ] Order ID correlates to internal payment attempt.
- [ ] Standard Checkout works.
- [ ] a real Test Mode payment succeeds.
- [ ] Checkout signature verification works.
- [ ] invalid Checkout signatures are rejected.

## Webhooks

- [ ] public webhook endpoint works.
- [ ] a real Razorpay Test Mode webhook is received.
- [ ] webhook signature verification works using raw body.
- [ ] invalid signatures are rejected.
- [ ] `x-razorpay-event-id` is stored.
- [ ] event data is persisted correctly.
- [ ] duplicate handling is verified.
- [ ] business-effect idempotency is verified.
- [ ] out-of-order processing is safe.
- [ ] required MVP events are handled:
  - [ ] `payment.captured`
  - [ ] `payment.failed`
  - [ ] `order.paid`

## Evidence

- [ ] real Razorpay events are labeled as real.
- [ ] replay/simulation cannot be mistaken for Razorpay delivery.
- [ ] payment/order/event IDs are correlated.
- [ ] no prohibited card/customer data is stored.

## Tests

- [ ] configuration tests pass.
- [ ] payment-signature tests pass.
- [ ] webhook-signature tests pass.
- [ ] invalid-signature tests pass.
- [ ] deduplication tests pass.
- [ ] business-idempotency tests pass.
- [ ] event-ordering tests pass.
- [ ] API-error handling tests pass.
- [ ] production build passes.

## Manual Verification

- [ ] developer performs real Razorpay Test Mode payment.
- [ ] developer verifies captured payment in Razorpay Dashboard.
- [ ] developer verifies real webhook arrival.
- [ ] developer verifies Supabase event record.
- [ ] developer verifies exactly one merchant business effect.
- [ ] developer verifies no secret is browser-accessible.

## Documentation

- [ ] Razorpay configuration changes are recorded in the Phase 2 handoff.
- [ ] no secret value appears in documentation.
- [ ] any latest-doc differences are recorded.
- [ ] known Razorpay limitations are recorded.

Only after all mandatory items pass may Phase 2 move to:

```text
APPROVED
```

and Phase 3 may depend on its Razorpay evidence pipeline.