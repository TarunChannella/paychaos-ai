# PayChaos AI — Controlled Chaos Scenario Catalogue

**Project:** PayChaos AI — Autonomous Payment Reliability Engineer  
**Document Status:** Source-of-truth chaos specification  
**Primary Implementation Phase:** Phase 3 — Chaos Engine + Money Invariant Engine  
**Environment:** Razorpay Test Mode only  
**Target:** PayChaos-controlled Demo Merchant only  
**P0 Scenario Count:** 4  
**Runtime Cost Target:** ₹0

---

# 0. Purpose of This Document

This document defines every approved controlled chaos scenario for PayChaos AI.

It freezes:

- scenario IDs;
- priorities;
- injection mechanisms;
- safety boundaries;
- required evidence;
- invariant mappings;
- pass/fail conditions;
- reset behavior;
- implementation expectations.

Claude must implement the four mandatory P0 scenarios first and must not invent additional P0 chaos behavior. Existing P1 scenarios may be implemented only after Phase 3 P0 is complete, tested and manually verified.

PayChaos chaos testing exists to answer:

> Does the Demo Merchant remain financially and operationally correct when normal distributed-payment failure conditions occur?

Chaos testing does **not** mean:

- attacking Razorpay;
- breaking Razorpay infrastructure;
- sending malicious traffic to arbitrary systems;
- testing production payments;
- performing destructive security testing.

---

# 1. Non-Negotiable Safety Boundary

Every chaos scenario must obey all of the following.

```text
Razorpay Test Mode only
+
PayChaos Demo Merchant only
+
predefined scenario registry only
+
predefined fault primitives only
+
no arbitrary targets
+
no production credentials
+
no real customer data
```

The Chaos Runner must never accept:

- arbitrary URLs;
- arbitrary IP addresses;
- arbitrary webhook endpoints;
- arbitrary JavaScript;
- shell commands;
- arbitrary SQL;
- user-provided network targets.

A user chooses only from the predefined PayChaos scenario catalogue.

---

# 2. Frozen P0 and P1 Scenario Scope

The mandatory P0 suite contains exactly **4 scenarios**:

| ID | Scenario | Priority | Primary Risk |
|---|---|---|---|
| C01 | Duplicate webhook delivery | P0 | Duplicate processing / fulfilment |
| C03 | Invalid webhook signature | P0 | Forged event acceptance |
| C07 | Payment succeeds but client confirmation is lost | P0 | Payment-state divergence |
| C11 | Failed payment must never mark order paid | P0 | False paid / fulfilment |

The following existing wrappers are P1 and must not delay Phase 3 P0 approval:

| ID | Scenario | Priority | Primary Risk |
|---|---|---|---|
| C02 | Out-of-order webhook/event delivery | P1 | Invalid state transitions |
| C04 | Webhook handler timeout / slow processing | P1 | Lost/repeated processing |
| C05 | Webhook handler returns server error | P1 | Unsafe retry behavior |
| C06 | Duplicate fulfilment attempt | P1 | Duplicate business effect |
| C08 | Database failure during webhook processing | P1 | Partial money/business state |
| C09 | Replay of already processed old event | P1 | Stale replay / duplicate effect |
| C10 | Unknown/unhandled webhook event | P1 | Unsafe unknown-event handling |
| C12 | Checkout mismatch | P1 | Untrusted Checkout relationship |
| C13 | Stale state | P1 | Non-convergent provider/application state |
| C14 | Chaos interruption | P1 | False PASS / cleanup failure |
| C15 | Processor crash/recovery | P1 | Unsafe recovery |

This priority change affects the required scenario **wrappers**, not the underlying P0 correctness requirements. Phase 2/3 implementation and tests must still enforce all mandatory P0 protections defined by `RAZORPAY_GUIDE.md`, `DATABASE.md`, `MONEY_INVARIANTS.md`, `SECURITY.md` and `TESTING.md`.

Do not expand P0 beyond C01, C03, C07 and C11 without an approved scope change.

---

# 3. Chaos Mechanism Classification

Every scenario must declare its mechanism.

There are exactly three primary mechanisms.

---

## Mechanism A — Real Razorpay Test Mode Event

A real event means:

1. a real Razorpay Test Mode payment/order activity occurred;
2. Razorpay delivered the webhook;
3. PayChaos received it through the public webhook endpoint;
4. the webhook signature was successfully verified;
5. the event was persisted as authentic external evidence.

Canonical provenance:

```text
REAL_RAZORPAY_WEBHOOK
```

Only Razorpay-delivered and signature-verified webhook traffic may receive this label.

---

# 4. Mechanism B — Replay of Authentic Test Mode Evidence

PayChaos may reprocess a previously captured authentic Razorpay Test Mode event.

Preferred P0 replay source:

```text
verified webhook_events record
```

Replay creates a new internal processing attempt but does not create a new genuine Razorpay event.

Canonical provenance:

```text
PAYCHAOS_REPLAY
```

A replay means:

> PayChaos processed previously verified Razorpay Test Mode evidence again.

It does **not** mean:

> Razorpay delivered the event again.

---

## Captured Test Fixture

Sanitized copies of authentic Test Mode payloads may also be used in automated tests.

Their provenance is:

```text
TEST_FIXTURE
```

They do not prove that Razorpay delivered an event during the current run.

---

# 5. Mechanism C — PayChaos-Controlled Demo Merchant Fault Injection

PayChaos may deliberately alter its own controlled processing behavior.

Examples:

```text
delay processing
fail processing once
throw server error
simulate database transaction failure
drop frontend confirmation
use vulnerable idempotency-key strategy
interrupt chaos run
```

Canonical provenance:

```text
PAYCHAOS_SIMULATION
```

These faults occur inside PayChaos.

Never describe them as Razorpay failures.

---

# 6. Provenance Rules

Every chaos run must make its provenance visible.

Examples:

```text
Original source:
Razorpay Test Mode — Real Event

Processing:
PayChaos Replay

Fault:
PayChaos Simulation — Transient Handler Failure
```

A replay must reference its original:

```text
webhook_event_id
```

where applicable.

The original webhook record must remain unchanged.

---

# 7. Chaos Run Result Format

Chaos-run outcome is separate from Money Invariant results.

Each completed/terminal scenario execution receives one of:

```text
PASS
FAIL
UNKNOWN
BLOCKED
ERROR
```

## PASS

The scenario executed successfully, required evidence was collected, and every required scenario correctness condition passed.

## FAIL

The scenario executed and evidence proves the Demo Merchant violated at least one required correctness condition.

A deterministic invariant should normally support the failure.

## UNKNOWN

The scenario applies and ran far enough to evaluate, but required authoritative evidence is insufficient to prove PASS or FAIL.

UNKNOWN must not be converted to PASS.

## BLOCKED

The run did **not** execute replay/fault injection because a safety or prerequisite check failed.

Examples:

- Live credentials detected;
- database unavailable before run;
- required source event absent;
- Demo Merchant state not suitable;
- required Test Mode configuration missing.

`BLOCKED` is not `FAIL`.

No failure injection may occur.

## ERROR

The run began but PayChaos itself could not produce a valid test conclusion.

Examples:

- Chaos Runner internal exception;
- unexpected infrastructure error;
- evidence capture fails;
- run cannot complete or cleanly classify results.

`ERROR` must never be converted to `PASS`.

## NOT RUN

`NOT RUN` is a **derived catalogue/UI state**, not a stored `chaos_runs.outcome`.

It means no eligible completed run exists for that scenario in the current evaluation context.

Reliability scoring must distinguish NOT RUN from PASS.

---

# 8. Severity Format

Finding severity uses:

```text
Critical
High
Medium
Low
Info
```

---

## Critical

Possible direct money/business correctness violation.

Examples:

- duplicate fulfilment;
- forged webhook changes payment state;
- failed payment becomes paid.

---

## High

Serious reliability problem that can create payment/application divergence or unrecoverable processing.

---

## Medium

Important reliability weakness with limited immediate money impact.

---

## Low

Minor reliability issue.

---

## Info

Informational evidence only.

---

# 9. Authoritative Scenario-to-Invariant Contract

`MONEY_INVARIANTS.md` is authoritative for invariant IDs, meanings, PASS/FAIL/UNKNOWN semantics and scenario mappings.

This document must not maintain a second competing invariant catalogue.

The frozen mappings are:

| Scenario | Priority | Required Invariants |
|---|---|---|
| C01 | P0 | INV-001, INV-002, INV-006, INV-007 |
| C02 | P1 | INV-002, INV-004, INV-011 |
| C03 | P0 | INV-004, INV-005 |
| C04 | P1 | INV-001, INV-002, INV-009, INV-011 |
| C05 | P1 | INV-001, INV-002, INV-009, INV-011 |
| C06 | P1 | INV-002, INV-004, INV-007, INV-010 |
| C07 | P0 | INV-002, INV-004, INV-011 |
| C08 | P1 | INV-002, INV-009, INV-010, INV-011 |
| C09 | P1 | INV-002, INV-006, INV-011 |
| C10 | P1 | INV-012 |
| C11 | P0 | INV-003, INV-004, INV-011 |
| C12 | P1 | INV-004, INV-014 |
| C13 | P1 | INV-011 |
| C14 | P1 | No dedicated money invariant unless one independently evaluates |
| C15 | P1 | INV-001, INV-002, INV-009, INV-011 |

If any mapping in this document conflicts with `MONEY_INVARIANTS.md`, correct this document before implementation. Do not implement using the superseded provisional invariant catalogue.

---

# 10. Recommended Fix Categories

Scenarios use the following deterministic recommendation categories.

```text
FIX-IDEMPOTENCY
FIX-STATE-MACHINE
FIX-WEBHOOK-AUTH
FIX-WEBHOOK-TIMEOUT
FIX-RETRY-HANDLING
FIX-BUSINESS-IDEMPOTENCY
FIX-CLIENT-INDEPENDENCE
FIX-TRANSACTION-ATOMICITY
FIX-PROVENANCE
FIX-UNSUPPORTED-EVENT-GUARD
FIX-PAYMENT-FAILURE-GUARD
FIX-CHECKOUT-VERIFICATION
FIX-RECONCILIATION
FIX-CHAOS-CLEANUP
FIX-PROCESSOR-RECOVERY
```

Phase 4 may expand the human-readable recommendation text.

---

# 11. CHAOS RUN PRECHECK

Every scenario must pass the Chaos Run Precheck before any injection/replay occurs.

---

## PRECHECK-01 — Environment Is TEST

Application configuration must explicitly contain:

```text
RAZORPAY_MODE=test
```

Failure:

```text
BLOCKED
```

---

## PRECHECK-02 — Test Razorpay Key

Configured Key ID must represent Razorpay Test Mode.

A Live Mode key must immediately block the run.

Failure:

```text
BLOCKED
```

---

## PRECHECK-03 — No Production Credentials

The runner must confirm no supported configuration indicates production/live Razorpay execution.

If production credentials are detected:

```text
BLOCKED
```

No chaos logic executes.

---

## PRECHECK-04 — Registered Demo Merchant Target

Target must be the internally registered PayChaos Demo Merchant.

No target URL is accepted from the user.

Failure:

```text
BLOCKED
```

---

## PRECHECK-05 — Scenario Is Registered

`scenario_id` must exist in the static server-side scenario registry.

Unknown scenario:

```text
BLOCKED
```

---

## PRECHECK-06 — Database Reachable

Supabase/PostgreSQL must be reachable before the run.

Failure:

```text
BLOCKED
```

This is different from a scenario such as C08 where database failure is deliberately injected **after** the precheck succeeds.

---

## PRECHECK-07 — Required Evidence Exists

If a scenario requires an authentic webhook:

the source must exist and have:

```text
signature_verified = true
```

and appropriate Test Mode provenance.

Failure:

```text
BLOCKED
```

---

## PRECHECK-08 — Known Demo State

The target order/payment must be in the required known baseline state.

Examples:

```text
PAID + fulfilled exactly once
```

or:

```text
UNPAID + zero fulfilments
```

depending on scenario.

Failure:

```text
BLOCKED
```

---

## PRECHECK-09 — Fault Is Allowed

Requested `fault_type` must be allowed for the scenario.

Failure:

```text
BLOCKED
```

---

## PRECHECK-10 — No Arbitrary External Target

Chaos configuration must contain no arbitrary:

- host;
- URL;
- IP;
- external endpoint.

Failure:

```text
BLOCKED
```

---

# 12. Precheck Failure Rule

If any mandatory safety precheck fails:

```text
Chaos Run Result = BLOCKED
```

and:

```text
NO REPLAY
NO FAULT INJECTION
NO PAYMENT MUTATION
NO EXTERNAL CALL
```

may occur.

---

# 13. P0 SCENARIO C01

## 1. Scenario ID

```text
C01
```

## 2. Scenario Name

**Duplicate Webhook Delivery**

## 3. Priority

**P0**

## 4. Problem Tested

Tests whether repeated processing of the same logical Razorpay webhook can create duplicate state changes or fulfilment.

## 5. Why It Matters

Webhook systems use retry/at-least-once delivery models.

A merchant integration that assumes exactly-once delivery can:

- fulfil twice;
- send duplicate confirmation;
- change inventory twice;
- create duplicate business records.

## 6. Preconditions

Required:

- approved Phase 2 integration;
- one verified real `payment.captured` or `order.paid` webhook;
- associated payment/order correlation;
- baseline merchant state known;
- baseline fulfilment count known.

Preferred baseline:

```text
order = PAID
fulfilment count = 1
```

## 7. Test Setup

Record:

- original `webhook_event_id`;
- Razorpay event ID;
- order state;
- payment state;
- fulfilment count;
- raw-body hash.

Create C01 chaos run.

## 8. Exact Injection / Replay Method

**Mechanism B**

Replay the same verified webhook through the internal Event Processor at least twice.

Each replay creates a new:

```text
event_processing_attempt
```

with:

```text
source_kind = PAYCHAOS_REPLAY
```

Do not create additional `webhook_events` rows.

## 9. Inputs / Events Used

Preferred:

```text
payment.captured
```

Optional:

```text
order.paid
```

## 10. Expected Correct Behavior

- one canonical webhook event;
- replay attempts safely processed/skipped;
- merchant remains PAID;
- fulfilment remains exactly once;
- original event remains unchanged.

## 11. Expected Vulnerable Behavior

Examples:

- fulfilment count becomes 2+;
- duplicate merchant effects;
- replay becomes new canonical event;
- payment state changes inconsistently.

## 12. Invariants Checked

```text
INV-001
INV-002
INV-006
INV-007
```

## 13. Evidence Required

- chaos run ID;
- original event ID;
- source provenance;
- processing attempt IDs;
- fulfilment count before/after;
- order state before/after;
- canonical event row count;
- invariant results.

## 14. Failure Severity

**Critical**

## 15. Likely Root Causes

- missing event idempotency;
- application-only dedupe race;
- business effect not idempotent;
- idempotency key derived from processing attempt rather than logical action.

## 16. Recommended Fix Category

```text
FIX-IDEMPOTENCY
FIX-BUSINESS-IDEMPOTENCY
```

## 17. Regression Test

Replay the exact same source event again after the fix.

Required result:

```text
one fulfilment only
```

## 18. Manual Verification

1. select paid order;
2. verify fulfilment count is 1;
3. open C01;
4. confirm source badge shows real original Razorpay event;
5. run duplicate replay;
6. inspect both replay attempts;
7. verify they say `PAYCHAOS_REPLAY`;
8. verify canonical event count remains one;
9. verify fulfilment count remains one.

## 19. Automation Requirements

Automated integration test must replay the same source event multiple times and assert database uniqueness and business-effect uniqueness.

## 20. Pass Criteria

All mapped invariants PASS.

## 21. Fail Criteria

Any duplicate business effect or canonical event duplication occurs.

## 22. Cleanup / Reset

No global fault remains.

Restore baseline through Demo Reset if vulnerable mode intentionally produced duplicates.

## 23. Implemented In

**Phase 3**

---

# 14. P1 SCENARIO C02

## 1. Scenario ID

```text
C02
```

## 2. Scenario Name

**Out-of-Order Webhook / Event Delivery**

## 3. Priority

**P1**

## 4. Problem Tested

Tests whether merchant logic incorrectly assumes event-processing order.

## 5. Why It Matters

Distributed event delivery cannot be treated as perfectly chronological.

Order-dependent state machines can:

- regress payment state;
- ignore valid capture;
- fulfil twice;
- leave orders permanently pending.

## 6. Preconditions

Need two verified events correlated to the same Razorpay payment/order, preferably:

```text
payment.captured
order.paid
```

## 7. Test Setup

Create a fresh/reset merchant state suitable for replay.

Record original event order and state.

## 8. Exact Injection / Replay Method

**Mechanism B**

Replay the recorded events through the internal processor in the deliberately controlled order:

```text
order.paid
→ payment.captured
```

regardless of their original received order.

A second automated variation should test the opposite sequence.

## 9. Inputs / Events Used

```text
payment.captured
order.paid
```

## 10. Expected Correct Behavior

Final merchant state:

```text
PAID
FULFILLED
```

with exactly one fulfilment.

No later processing may downgrade final state.

## 11. Expected Vulnerable Behavior

- state regresses;
- order remains pending;
- event ignored because predecessor not seen;
- fulfilment happens twice.

## 12. Invariants Checked

```text
INV-002
INV-004
INV-011
```

## 13. Evidence Required

- original event timestamps;
- replay sequence;
- processing attempt sequence;
- state before/after each event;
- fulfilment rows;
- final order/payment state.

## 14. Failure Severity

**High**

## 15. Likely Root Causes

- chronological delivery assumption;
- invalid state machine;
- non-monotonic updates;
- each event independently performing fulfilment.

## 16. Recommended Fix Category

```text
FIX-STATE-MACHINE
FIX-IDEMPOTENCY
```

## 17. Regression Test

Rerun both supported orderings.

Both must converge to the same correct final state.

## 18. Manual Verification

1. choose eligible payment;
2. inspect source events;
3. run C02;
4. confirm displayed processing order is intentionally different;
5. inspect state timeline;
6. verify final paid state;
7. verify exactly one fulfilment.

## 19. Automation Requirements

At least two event-order permutations.

## 20. Pass Criteria

Correct final state independent of tested event order.

## 21. Fail Criteria

Order-dependent incorrect state or duplicate effect.

## 22. Cleanup / Reset

Reset merchant state before rerunning another permutation.

## 23. Implemented In

**Phase 3**

---

# 15. P0 SCENARIO C03

## 1. Scenario ID

```text
C03
```

## 2. Scenario Name

**Invalid Webhook Signature**

## 3. Priority

**P0**

## 4. Problem Tested

Tests whether unauthenticated webhook data can enter trusted payment processing.

## 5. Why It Matters

Accepting an invalid webhook could allow untrusted input to mark orders paid or fulfilled.

## 6. Preconditions

- webhook verification service available;
- fixed PayChaos webhook verification path;
- safe test payload available.

## 7. Test Setup

Capture merchant/payment state before test.

The payload must not contain real sensitive customer data.

## 8. Exact Injection / Replay Method

**Mechanism C**

Use a controlled test payload and deliberately invalid signature.

The test target is fixed internally to PayChaos's own webhook verification path.

No arbitrary endpoint is supplied.

Do not use or expose the actual webhook secret.

## 9. Inputs / Events Used

A sanitized test payload structurally equivalent to a supported webhook.

Provenance:

```text
TEST_FIXTURE / PAYCHAOS_SIMULATION
```

Never `REAL_RAZORPAY_WEBHOOK`.

## 10. Expected Correct Behavior

- signature validation fails;
- no canonical trusted webhook row;
- no payment-state mutation;
- no fulfilment;
- no internal event processing.

## 11. Expected Vulnerable Behavior

Invalid payload is accepted and changes merchant/payment state.

## 12. Invariants Checked

```text
INV-004
INV-005
```

## 13. Evidence Required

- chaos run ID;
- verification result = invalid;
- state before/after;
- trusted webhook row count before/after;
- fulfilment count;
- HTTP/result classification.

Never store actual secret.

## 14. Failure Severity

**Critical**

## 15. Likely Root Causes

- signature verification skipped;
- parsed body used incorrectly;
- fail-open webhook path;
- verification result ignored.

## 16. Recommended Fix Category

```text
FIX-WEBHOOK-AUTH
```

## 17. Regression Test

Repeat invalid-signature request and verify rejection.

## 18. Manual Verification

1. open C03;
2. run controlled invalid-signature test;
3. confirm result indicates rejection;
4. inspect payment state;
5. verify no trusted webhook event was created;
6. verify no fulfilment occurred.

## 19. Automation Requirements

Required integration tests:

- wrong signature;
- missing signature;
- changed raw body.

## 20. Pass Criteria

Request rejected with zero authoritative mutation.

## 21. Fail Criteria

Unverified payload creates trusted state/effect.

## 22. Cleanup / Reset

Normally none because correct behavior creates no payment mutation.

The mutation snapshot performs **read-only** `SELECT`s and creates, updates and deletes nothing, so it adds no cleanup obligation of its own.

## 22a. Execution-Time Mutation Evidence (Phase 3F evidence-compatibility correction)

C03 remains **verification-only**. It still calls the fixed internal `verifyWebhookSignature` primitive directly, still creates **zero** `webhook_events` rows, **zero** `event_processing_attempts` rows and **zero** merchant mutation, still carries all four `chaos_runs` foreign keys as `NULL`, and still performs no Razorpay network call and no arbitrary-target request.

What changed: the before/after merchant state this scenario's §7 ("Capture merchant/payment state before test") and §13 ("state before/after; trusted webhook row count before/after") already required is now actually captured, during the same C03 execution, and persisted on the existing `chaos_runs.fault_state` column as `mutationEvidence`. See `docs/DATABASE.md` → `chaos_runs` → "C03 `fault_state` shape" for the exact structure.

**Phase 4F scoring cross-reference.** Because C03's request is constructed internally by PayChaos, its runs are correctly classified `SYNTHETIC_DEMO` and are never authentic Razorpay deliveries. Phase 4F's `RELIABILITY-V1` therefore carries an explicit **scenario-aware eligibility exception**: C03 is score-eligible under `SYNTHETIC_DEMO`, while C01, C07 and C11 still require `RECORDED_TEST_EVIDENCE` (`docs/AI_DESIGN.md` → "Scenario-Aware Classification Eligibility"). This changes only which runs the score may select. It does **not** change C03's mechanism, its provenance labelling, or how it is described anywhere: a PayChaos-controlled simulation is never presented as a real Razorpay webhook.

Frozen execution order:

```text
capture BEFORE
  → WRONG_SIGNATURE check
  → MISSING_SIGNATURE check
→ capture AFTER
→ persist { checks, mutationEvidence }
→ complete the run through the existing lifecycle
```

Capture is instrumentation. It never gates the two signature checks, never becomes merchant-state authority, and never fails the run: a capture failure is recorded truthfully as `null` rather than replaced with a fabricated snapshot.

**Mandatory test precondition (ARCH-3F-014).** Run C03 in the controlled Demo Merchant sandbox with **no concurrent payment flow in progress**. A legitimate concurrent payment landing between the two captures would change the snapshot, and the evidence cannot distinguish that from a mutation C03 caused. This is an operator rule, not a lock.

**Historical runs are not backfilled.** The already-approved historical C03 run predates this evidence and keeps INV-004 `NOT_APPLICABLE` / INV-005 `UNKNOWN` permanently. Only a **new** C03 run executed after this correction can produce an INV-005 `PASS`/`FAIL`.

## 23. Implemented In

**Phase 3 scenario wrapper**  
Underlying verification is established in **Phase 2**.

---

# 16. P1 SCENARIO C04

## 1. Scenario ID

```text
C04
```

## 2. Scenario Name

**Webhook Handler Timeout / Slow Processing**

## 3. Priority

**P1**

## 4. Problem Tested

Tests whether slow/uncompleted processing results in unsafe acknowledgement, partial state, or duplicate effects.

## 5. Why It Matters

Webhook processing may exceed the provider's delivery expectations.

If a handler cannot complete safely, repeated delivery may follow.

The merchant must remain retry-safe.

## 6. Preconditions

- verified source event;
- healthy database;
- payment/order baseline;
- no active fault.

## 7. Test Setup

Create chaos run.

Record order/payment/fulfilment state.

## 8. Exact Injection / Replay Method

**Mechanism B + C**

Replay a verified event while enabling:

```text
SIMULATED_HANDLER_DEADLINE_EXCEEDED
```

P0 should **not** depend on actually sleeping for long wall-clock periods.

The controlled fault simulates that the handler cannot complete inside its allowed processing budget.

The first attempt should fail safely rather than falsely acknowledge successful durable processing.

Then release the fault and retry.

## 9. Inputs / Events Used

Preferred:

```text
payment.captured
```

## 10. Expected Correct Behavior

First attempt:

- no unsafe partial business state;
- processing marked failed/held appropriately;
- no duplicate fulfilment.

Retry:

- succeeds;
- final order PAID;
- exactly one fulfilment.

## 11. Expected Vulnerable Behavior

- handler acknowledges before durable state;
- event permanently lost;
- duplicate fulfilment after retry;
- partial state persists.

## 12. Invariants Checked

```text
INV-001
INV-002
INV-009
INV-011
```

## 13. Evidence Required

- processing start/end;
- fault action;
- first attempt status;
- simulated deadline condition;
- state before/after;
- retry processing attempt;
- final fulfilment count.

## 14. Failure Severity

**High**

## 15. Likely Root Causes

- acknowledgement before commit;
- long blocking work inside webhook handler;
- no retry-safe design;
- non-idempotent retry.

## 16. Recommended Fix Category

```text
FIX-WEBHOOK-TIMEOUT
FIX-RETRY-HANDLING
```

## 17. Regression Test

Run timeout fault once, then retry without the fault.

## 18. Manual Verification

1. select eligible event;
2. run C04;
3. inspect intentionally timed-out first processing attempt;
4. verify no partial fulfilment;
5. release/retry;
6. verify one successful final fulfilment.

## 19. Automation Requirements

Must use deterministic timeout/deadline injection rather than fragile long sleeps.

## 20. Pass Criteria

Safe initial failure + idempotent successful retry.

## 21. Fail Criteria

Lost event, partial commit, duplicate effect, or false success.

## 22. Cleanup / Reset

Disable timeout fault unconditionally in a `finally`/cleanup path.

## 23. Implemented In

**Phase 3**

---

# 17. P1 SCENARIO C05

## 1. Scenario ID

```text
C05
```

## 2. Scenario Name

**Webhook Handler Returns Server Error**

## 3. Priority

**P1**

## 4. Problem Tested

Tests transient webhook-handler failure followed by retry.

## 5. Why It Matters

Temporary application or dependency failures occur.

Retries must not corrupt merchant state.

## 6. Preconditions

- verified source webhook;
- known baseline;
- database healthy.

## 7. Test Setup

Configure one-time fault:

```text
FAIL_HANDLER_ONCE
```

## 8. Exact Injection / Replay Method

**Mechanism B + C**

First processing attempt throws/returns a controlled server failure before successful durable completion.

After the fault is consumed:

run the same logical event again through the internal processing path.

## 9. Inputs / Events Used

Preferred:

```text
payment.captured
```

## 10. Expected Correct Behavior

Attempt 1:

```text
FAILED
```

No incorrect business effect.

Attempt 2:

```text
SUCCEEDED
```

Exactly one business effect.

## 11. Expected Vulnerable Behavior

- event marked processed despite failure;
- retry ignored although first attempt failed;
- retry duplicates fulfilment;
- payment remains permanently stale.

## 12. Invariants Checked

```text
INV-001
INV-002
INV-009
INV-011
```

## 13. Evidence Required

- both processing attempts;
- fault action;
- error code;
- state snapshots;
- fulfilment count;
- final processing state.

## 14. Failure Severity

**High**

## 15. Likely Root Causes

- incorrect retry state;
- event marked processed too early;
- non-idempotent handler;
- no distinction between event identity and processing attempt.

## 16. Recommended Fix Category

```text
FIX-RETRY-HANDLING
FIX-IDEMPOTENCY
```

## 17. Regression Test

Fail once, retry once, assert single successful effect.

## 18. Manual Verification

1. run C05;
2. inspect first failed attempt;
3. confirm no fulfilment;
4. execute/review retry;
5. confirm final PAID state;
6. confirm one fulfilment.

## 19. Automation Requirements

Fault must be deterministic and one-time.

## 20. Pass Criteria

Retry safely recovers once.

## 21. Fail Criteria

Lost event or duplicated business effect.

## 22. Cleanup / Reset

One-time error flag must clear even if run errors.

## 23. Implemented In

**Phase 3**

---

# 18. P1 SCENARIO C06

## 1. Scenario ID

```text
C06
```

## 2. Scenario Name

**Duplicate Fulfilment Attempt**

## 3. Priority

**P1**

## 4. Problem Tested

Tests merchant-side business idempotency independently of webhook deduplication.

## 5. Why It Matters

Even different events such as:

```text
payment.captured
order.paid
```

can refer to the same successful payment.

Both must not independently fulfil the order.

## 6. Preconditions

- captured payment;
- paid order;
- no existing fulfilment for vulnerable demonstration, or controlled reset state;
- Demo Merchant fault profiles available.

## 7. Test Setup

Two supported paths exist:

### Healthy Path

Two attempts use the same semantic fulfilment idempotency key.

### Vulnerable Demo Path

Use controlled profile:

```text
BUGGY_IDEMPOTENCY_KEY
```

that incorrectly includes processing-attempt identity in the key.

This safely demonstrates how two logically identical effects can evade a badly designed idempotency key.

Do **not** drop database constraints.

## 8. Exact Injection Method

**Mechanism C**

Invoke fulfilment logic twice for the same logical paid order.

## 9. Inputs / Events Used

Can be triggered from:

```text
payment.captured
+
order.paid
```

or two controlled processing attempts for one capture.

## 10. Expected Correct Behavior

Successful fulfilment rows for the order:

```text
1
```

## 11. Expected Vulnerable Behavior

Successful fulfilment rows:

```text
2+
```

## 12. Invariants Checked

```text
INV-002
INV-004
INV-007
INV-010
```

## 13. Evidence Required

- both processing attempts;
- idempotency keys;
- order/payment IDs;
- fulfilment rows;
- state snapshots;
- fault profile.

## 14. Failure Severity

**Critical**

## 15. Likely Root Causes

- business idempotency missing;
- idempotency key too granular;
- fulfilment keyed to webhook event instead of order/payment effect;
- multiple success event types independently fulfil.

## 16. Recommended Fix Category

```text
FIX-BUSINESS-IDEMPOTENCY
```

## 17. Regression Test

Switch to fixed semantic idempotency strategy and repeat two fulfilment attempts.

## 18. Manual Verification

1. run vulnerable C06 profile;
2. inspect duplicate fulfilment finding;
3. verify it is labeled PayChaos-controlled faulty merchant behavior;
4. switch to fixed profile;
5. rerun;
6. confirm only one fulfilment.

## 19. Automation Requirements

Automated tests must cover both:

```text
vulnerable demonstration
fixed regression
```

## 20. Pass Criteria

Fixed merchant implementation creates one effect only.

## 21. Fail Criteria

Two or more logical fulfilments occur.

## 22. Cleanup / Reset

Disable vulnerable profile and reset duplicated demo records before other scenarios.

## 23. Implemented In

**Phase 3**

---

# 19. P0 SCENARIO C07

## 1. Scenario ID

```text
C07
```

## 2. Scenario Name

**Payment Succeeds but Frontend / Client Confirmation Is Lost**

## 3. Priority

**P0**

## 4. Problem Tested

Tests whether merchant correctness incorrectly depends on the browser success callback.

## 5. Why It Matters

The customer may:

- close the tab;
- lose connectivity;
- refresh;
- fail to deliver browser confirmation.

The provider payment can still succeed.

## 6. Preconditions

- real Razorpay Test Mode payment capability;
- working webhook endpoint;
- Demo Merchant supports controlled client-confirmation drop.

## 7. Test Setup

Create a fresh merchant order/payment attempt.

Enable:

```text
DROP_CLIENT_CONFIRMATION
```

for that controlled test.

## 8. Exact Injection Method

**Mechanism A + C**

1. perform real Razorpay Test Mode Checkout;
2. allow the Test Mode payment to succeed;
3. deliberately suppress/ignore PayChaos browser success submission;
4. allow genuine Razorpay webhook processing to continue.

Automated internal tests may use authentic captured fixtures, but final manual verification should use a real Test Mode payment.

## 9. Inputs / Events Used

Real:

```text
payment.captured
order.paid
```

as available.

## 10. Expected Correct Behavior

Even without client confirmation:

- verified webhook evidence is persisted;
- payment converges to captured;
- merchant order becomes PAID;
- fulfilment occurs once.

## 11. Expected Vulnerable Behavior

- payment stays pending/unpaid forever;
- no fulfilment despite capture;
- user is told payment failed although money state is successful.

## 12. Invariants Checked

```text
INV-002
INV-004
INV-011
```

## 13. Evidence Required

- internal order/payment attempt;
- client-confirmation suppression marker;
- real webhook event IDs;
- payment state;
- merchant state timeline;
- fulfilment.

## 14. Failure Severity

**High**

## 15. Likely Root Causes

- browser callback treated as source of truth;
- webhook path only supplements client state;
- missing server-side convergence logic.

## 16. Recommended Fix Category

```text
FIX-CLIENT-INDEPENDENCE
FIX-STATE-MACHINE
```

## 17. Regression Test

Perform another successful Test Mode payment while suppressing client confirmation.

## 18. Manual Verification

1. create fresh order;
2. enable C07;
3. complete Razorpay Test Mode payment;
4. verify client confirmation is intentionally suppressed;
5. wait for verified webhook processing;
6. refresh application;
7. confirm order becomes PAID;
8. confirm exactly one fulfilment.

## 19. Automation Requirements

Internal automation must test webhook-driven convergence.

The actual external Checkout component may remain a manual Phase 2/5 verification step.

## 20. Pass Criteria

Captured provider evidence independently converges merchant state.

## 21. Fail Criteria

Order remains incorrectly unpaid/pending or duplicates effects.

## 22. Cleanup / Reset

Client-drop fault must clear immediately after the scoped run.

## 23. Implemented In

**Phase 3**, using Phase 2 real payment/webhook infrastructure.

---

# 20. P1 SCENARIO C08

## 1. Scenario ID

```text
C08
```

## 2. Scenario Name

**Database Failure During Webhook Processing**

## 3. Priority

**P1**

## 4. Problem Tested

Tests whether database errors create partially committed payment/business state.

## 5. Why It Matters

Payment processing often changes several pieces of application state.

If only some writes commit, the merchant can end up with:

- PAID without fulfilment;
- fulfilment without correct payment state;
- processed event without business effect;
- retry that duplicates previous partial work.

## 6. Preconditions

- database reachable during precheck;
- verified source event;
- transaction-capable processing path.

## 7. Test Setup

Create a fresh/reset target.

Enable scoped controlled database fault.

## 8. Exact Injection Method

**Mechanism B + C**

Replay verified payment evidence while injecting failure inside the transaction boundary.

P0 must test at least:

### Fault Point A

After payment/order update logic has begun but before commit.

### Fault Point B

After fulfilment intent has been created logically but before transaction commit.

Fault is implemented as a controlled exception/rollback.

Do not actually damage Supabase.

## 9. Inputs / Events Used

Preferred:

```text
payment.captured
```

## 10. Expected Correct Behavior

Failed attempt:

- transaction rolls back;
- no inconsistent partial authoritative state;
- event remains retryable.

Retry without fault:

- payment/order correct;
- one fulfilment only.

## 11. Expected Vulnerable Behavior

Examples:

```text
order = PAID
fulfilment = 0
event = PROCESSED
```

or:

```text
fulfilment = 1
payment state not committed
```

followed by unsafe duplication during retry.

## 12. Invariants Checked

```text
INV-002
INV-009
INV-010
INV-011
```

## 13. Evidence Required

- injected transaction checkpoint;
- processing attempt status;
- database row counts before/after;
- transaction failure;
- state snapshots;
- retry result.

## 14. Failure Severity

**Critical**

## 15. Likely Root Causes

- multi-write processing without transaction;
- event marked processed before business commit;
- partial transaction boundaries;
- retry not idempotent.

## 16. Recommended Fix Category

```text
FIX-TRANSACTION-ATOMICITY
FIX-RETRY-HANDLING
```

## 17. Regression Test

Repeat every supported transaction fault point and then retry.

## 18. Manual Verification

1. select C08;
2. run Fault Point A;
3. inspect database state;
4. confirm rollback;
5. retry;
6. confirm final correct state;
7. repeat Fault Point B;
8. confirm same properties.

## 19. Automation Requirements

Database integration test required.

Do not mock away the transaction behavior being tested.

## 20. Pass Criteria

No partial authoritative state survives; retry succeeds exactly once.

## 21. Fail Criteria

Partial commit or duplicate effect.

## 22. Cleanup / Reset

Database fault hook must be scoped to one chaos run and cleared unconditionally.

## 23. Implemented In

**Phase 3**

---

# 21. P1 SCENARIO C09

## 1. Scenario ID

```text
C09
```

## 2. Scenario Name

**Replay of an Already Processed Old Event**

## 3. Priority

**P1**

## 4. Problem Tested

Tests behavior when stale historical event evidence is processed again after the order already reached its final state.

## 5. Why It Matters

Old events may be:

- retried;
- manually replayed during operations;
- accidentally reprocessed;
- consumed from historical queues.

They must not undo or duplicate final state.

## 6. Preconditions

Order is:

```text
PAID
FULFILLED
```

Original verified webhook exists and has already been successfully processed.

## 7. Test Setup

Record current state and fulfilment count.

## 8. Exact Injection / Replay Method

**Mechanism B**

Replay an older verified webhook through the Event Processor.

Record as:

```text
PAYCHAOS_REPLAY
```

## 9. Inputs / Events Used

Preferred:

```text
payment.captured
```

or:

```text
order.paid
```

## 10. Expected Correct Behavior

- order remains PAID;
- fulfilment remains one;
- original event unchanged;
- replay clearly labeled;
- stale evidence cannot regress state.

## 11. Expected Vulnerable Behavior

- another fulfilment;
- state regression;
- replay stored as new real event;
- timestamps incorrectly replace stronger/current state.

## 12. Invariants Checked

```text
INV-002
INV-006
INV-011
```

## 13. Evidence Required

- original event age/time;
- current state;
- replay attempt;
- source provenance;
- before/after state;
- fulfilment count.

## 14. Failure Severity

**Critical**

## 15. Likely Root Causes

- no replay idempotency;
- last-write-wins state update;
- timestamps ignored/misused;
- provenance model broken.

## 16. Recommended Fix Category

```text
FIX-IDEMPOTENCY
FIX-STATE-MACHINE
FIX-PROVENANCE
```

## 17. Regression Test

Replay same historical event after the fix.

## 18. Manual Verification

1. choose completed payment;
2. confirm old event processed previously;
3. run C09;
4. inspect replay source label;
5. verify no new canonical real event;
6. verify final state unchanged;
7. verify fulfilment remains one.

## 19. Automation Requirements

Required replay integration test.

## 20. Pass Criteria

Historical replay is harmless and provenance remains correct.

## 21. Fail Criteria

Duplicate effect, state regression, or provenance corruption.

## 22. Cleanup / Reset

None if correct; reset if vulnerable path produces duplicate demo state.

## 23. Implemented In

**Phase 3**

---

# 22. P1 SCENARIO C10

## 1. Scenario ID

```text
C10
```

## 2. Scenario Name

**Unknown / Unhandled Webhook Event**

## 3. Priority

**P1**

## 4. Problem Tested

Tests whether event-processing code fails unsafely when it encounters an event type outside the P0 supported catalogue.

## 5. Why It Matters

External providers may introduce or send events the merchant does not actively process.

Unknown events must not trigger arbitrary payment-state logic.

## 6. Preconditions

- event normalizer/processor available;
- safe unknown test fixture available.

## 7. Test Setup

Create known merchant state.

Record row counts/state before test.

## 8. Exact Injection Method

**Mechanism C**

Pass a controlled event fixture with an intentionally unsupported event type through the internal normalization/processing boundary.

Use provenance:

```text
TEST_FIXTURE
```

or:

```text
PAYCHAOS_SIMULATION
```

Do not forge it as a genuine Razorpay delivery.

## 9. Inputs / Events Used

Example internal test event identifier:

```text
paychaos.test.unknown_event
```

This name is intentionally PayChaos-specific so nobody can mistake it for a Razorpay event.

## 10. Expected Correct Behavior

- event identified as unsupported;
- processing safely skipped;
- no paid-state mutation;
- no fulfilment;
- no crash of unrelated processing.

## 11. Expected Vulnerable Behavior

- unknown event treated as payment success;
- generic handler mutates merchant state;
- processor crashes and leaves bad state.

## 12. Invariants Checked

```text
INV-012
```

## 13. Evidence Required

- simulated event type;
- source classification;
- processing result;
- state before/after;
- fulfilment count.

## 14. Failure Severity

**High**

## 15. Likely Root Causes

- unsafe default event handler;
- event-type validation missing;
- unknown event falls through success branch.

## 16. Recommended Fix Category

```text
FIX-UNSUPPORTED-EVENT-GUARD
```

## 17. Regression Test

Run same unknown fixture after the fix.

## 18. Manual Verification

1. open C10;
2. verify UI states the event is a PayChaos test fixture;
3. run it;
4. verify `unsupported/skipped`;
5. confirm merchant state unchanged.

## 19. Automation Requirements

Required unit + integration test.

## 20. Pass Criteria

Unknown event creates no authoritative business effect.

## 21. Fail Criteria

Unknown event mutates payment/order/fulfilment state.

## 22. Cleanup / Reset

No cleanup should be required after correct behavior.

## 23. Implemented In

**Phase 3**

---

# 23. P0 SCENARIO C11

## 1. Scenario ID

```text
C11
```

## 2. Scenario Name

**Failed Payment Must Never Mark Order Paid**

## 3. Priority

**P0**

## 4. Problem Tested

Tests the fundamental negative payment-safety path.

## 5. Why It Matters

A merchant must never treat failure evidence as successful payment.

Doing so can result in goods/services being delivered without valid captured payment.

## 6. Preconditions

Preferred:

- fresh merchant order;
- real Razorpay Test Mode failed payment capability.

Alternative automation:

- sanitized authentic captured failure fixture.

## 7. Test Setup

Create fresh:

```text
UNPAID
OPEN
```

order with zero fulfilments.

## 8. Exact Injection / Replay Method

Preferred manual mechanism:

**Mechanism A**

Generate a genuine Razorpay Test Mode failed payment and process verified failure evidence when supplied by Razorpay.

Automated mechanism:

**Mechanism B**

Replay a previously captured authentic `payment.failed` Test Mode fixture/evidence.

If suitable failure evidence does not exist:

```text
BLOCKED
```

Do not invent a real Razorpay failure.

## 9. Inputs / Events Used

Preferred:

```text
payment.failed
```

## 10. Expected Correct Behavior

After failure evidence:

```text
order != PAID
fulfilment count = 0
```

A later verified capture, if legitimately observed, may still move state to PAID.

## 11. Expected Vulnerable Behavior

- order marked PAID;
- fulfilment occurs;
- failure treated as terminal in a way that rejects later valid capture.

## 12. Invariants Checked

```text
INV-003
INV-004
INV-011
```

## 13. Evidence Required

- payment failure evidence;
- provider/payment ID;
- order state;
- fulfilment count;
- state timeline.

## 14. Failure Severity

**Critical**

## 15. Likely Root Causes

- generic payment-event success handler;
- failure/success branch inversion;
- client status trusted;
- incorrect payment-state mapping.

## 16. Recommended Fix Category

```text
FIX-PAYMENT-FAILURE-GUARD
FIX-STATE-MACHINE
```

## 17. Regression Test

Repeat failed payment handling and verify zero fulfilment.

## 18. Manual Verification

1. create new order;
2. trigger approved Razorpay Test Mode failure;
3. inspect failure evidence;
4. verify order is not PAID;
5. verify fulfilment count is zero.

## 19. Automation Requirements

Captured sanitized failure fixture must exercise deterministic failure processing.

## 20. Pass Criteria

Failure never causes paid/fulfilled state.

## 21. Fail Criteria

Failure produces PAID or fulfilment.

## 22. Cleanup / Reset

Reset failed test order before unrelated scenarios if desired.

## 23. Implemented In

**Phase 3**, using Phase 2 failure handling.

---

# 24. Evaluation of Additional Candidate Scenarios

The following suggested scenarios were reviewed against the one-week scope.

| Candidate | Decision | Reason |
|---|---|---|
| Failed payment must never mark order paid | **P0 → C11** | Fundamental payment correctness |
| Payment verification mismatch | **P1 → C12** | Phase 2 already requires verification tests; Chaos UI is optional differentiation |
| Repeated retry attempt | **Covered by P1 C05/C08/C09 wrappers + mandatory P0 retry/idempotency tests** | Another scenario would duplicate existing coverage |
| Stale payment state | **P1 → C13** | Mandatory P0 state-machine/client-loss correctness tests already cover core convergence |
| Partial DB transaction failure | **P1 wrapper → C08** | Transaction rollback/atomicity remains a mandatory P0 database/invariant test |
| Duplicate ledger/business record | **P1 wrapper → C06** | `fulfilments` is the P0 business-effect record and duplicate-effect protection remains mandatory P0 correctness |
| Chaos-run interruption | **P1 → C14** | Tests Chaos Runner robustness rather than core merchant payment path |
| Event processing crash and recovery | **P1 → C15** | Useful but overlaps C05/C08 recovery paths |

No additional P2 scenarios are frozen.

P2 chaos work remains uncommitted until P0 and selected P1 work are fully stable.

---

# 25. P1 SCENARIO C12

## Scenario ID

```text
C12
```

## Scenario Name

**Checkout Payment Verification Mismatch**

## Priority

**P1**

## Problem Tested

Tests server handling of a mismatched or invalid Checkout success verification.

## Mechanism

**C — PayChaos-controlled invalid Checkout evidence**

No real secret is exposed.

## Preconditions

Known payment attempt and trusted server `order_id`.

## Injection

Submit controlled Checkout result data containing:

- mismatched payment ID;
- mismatched order relation; or
- invalid signature.

## Expected Correct Behavior

- verification rejected;
- no paid state;
- no fulfilment.

## Vulnerable Behavior

Browser-supplied success becomes authoritative.

## Invariants

```text
INV-005
INV-008
INV-015
```

## Evidence

- internal payment attempt;
- verification failure classification;
- state before/after;
- zero fulfilment.

## Severity

**Critical**

## Root Cause

Browser trust or signature verification bug.

## Fix

```text
FIX-CHECKOUT-VERIFICATION
```

## Regression

Repeat mismatch after fix.

## Manual Verification

Run controlled C12 test and confirm rejection.

## Automation

Already mandatory as Phase 2 integration/security tests.

## Pass

No trusted payment state created.

## Fail

Invalid Checkout evidence marks order paid.

## Cleanup

None normally.

## Phase

**Phase 3 P1**, built only after P0.

---

# 26. P1 SCENARIO C13

## Scenario ID

```text
C13
```

## Scenario Name

**Stale Merchant Payment State / Delayed Convergence**

## Priority

**P1**

## Problem Tested

Tests a merchant state that remains stale while newer verified payment evidence exists.

## Mechanism

**B + C**

Hold application-state application after a verified captured event, then release/reconcile.

## Expected Correct Behavior

Merchant state eventually converges to verified captured state.

## Vulnerable Behavior

Order remains stale indefinitely.

## Invariants

```text
INV-003
INV-007
```

## Severity

**High**

## Fix

```text
FIX-RECONCILIATION
FIX-STATE-MACHINE
```

## Regression

Repeat delay/release and verify convergence.

## Phase

**Phase 3 P1**

---

# 27. P1 SCENARIO C14

## Scenario ID

```text
C14
```

## Scenario Name

**Chaos Run Interrupted Before Completion**

## Priority

**P1**

## Problem Tested

Tests whether the Chaos Runner itself falsely reports success or leaves faults enabled after interruption.

## Mechanism

**C**

Deliberately abort execution after the fault has been activated but before invariant evaluation completes.

## Expected Correct Behavior

- run becomes ERROR/FAILED;
- never PASS;
- cleanup executes;
- no global fault remains.

## Vulnerable Behavior

- run reported PASS;
- active fault leaks into next test;
- incomplete evidence used for scoring.

## Invariants

```text
INV-014
```

## Severity

**Medium**

## Fix

```text
FIX-CHAOS-CLEANUP
```

## Regression

Interrupt again and confirm deterministic cleanup.

## Phase

**Phase 3 P1**

---

# 28. P1 SCENARIO C15

## Scenario ID

```text
C15
```

## Scenario Name

**Event Processor Crash and Recovery**

## Priority

**P1**

## Problem Tested

Tests abrupt event-processing failure followed by a controlled recovery.

## Mechanism

**B + C**

Replay verified event and throw a controlled processor exception after processing begins but before successful completion.

Retry after recovery.

## Expected Correct Behavior

- original attempt fails;
- no partial unsafe state;
- retry succeeds;
- exactly one fulfilment.

## Vulnerable Behavior

- duplicate effect;
- event permanently lost;
- processor marks success before completion.

## Invariants

```text
INV-001
INV-009
INV-013
INV-016
```

## Severity

**High**

## Fix

```text
FIX-PROCESSOR-RECOVERY
FIX-RETRY-HANDLING
```

## Regression

Crash once and retry.

## Phase

**Phase 3 P1**

---

# 29. P2 Scenario Policy

No P2 chaos scenario is frozen in this version.

This is intentional.

Do not spend the one-week schedule implementing:

- random chaos campaigns;
- combined multi-fault scenarios;
- high-volume load chaos;
- arbitrary event fuzzing;
- network packet manipulation;
- external merchant testing;
- complex retry-storm generators.

P2 may be proposed only after:

```text
P0 APPROVED
+
selected P1 APPROVED
+
final demo stable
```

---

# 30. Chaos Scenario Registry Contract

The server-side registry must conceptually contain, for every scenario:

```text
scenario_id
name
priority
enabled
allowed_mechanisms
required_source_event_types
allowed_fault_types
required_invariants
default_failure_severity
requires_real_payment
requires_verified_webhook
requires_reset
```

The scenario registry is application code.

It is not a database table.

---

# 31. Allowed Fault Primitives by Priority

P0 must implement only the primitives required by the four mandatory P0 scenario wrappers:

```text
REPLAY_EVENT
INVALID_SIGNATURE_TEST
DROP_CLIENT_CONFIRMATION
```

C11 primarily uses genuine verified failure evidence and does not need an unsafe merchant fault.

The following existing primitives are P1 and may be added only when their corresponding P1 scenario wrapper is selected:

```text
REORDER_EVENTS
SIMULATED_HANDLER_DEADLINE_EXCEEDED
FAIL_HANDLER_ONCE
BUGGY_IDEMPOTENCY_KEY
FAIL_DATABASE_TRANSACTION
REPLAY_STALE_EVENT
UNKNOWN_EVENT_FIXTURE
```

Underlying P0 retry, ordering, atomicity, unsupported-event and business-idempotency protections may still be implemented/tested directly without exposing their dedicated P1 chaos wrapper.

---

# 32. Fault Primitive Restrictions

Every fault primitive must be:

- scoped to one chaos run;
- disabled by default;
- server-controlled;
- recorded in `chaos_runs`;
- reversible;
- automatically cleaned up.

A fault must not persist globally after a run.

---

# 33. CHAOS RUN EXECUTION ORDER

The safest required P0 execution order is deliberately small.

Before the suite:

```text
HEALTHY BASELINE
```

must pass.

## Step 0 — Establish Baseline

Perform a healthy Razorpay Test Mode payment.

Verify:

- order correct;
- captured payment;
- real verified webhook;
- one fulfilment;
- baseline invariants passing.

Do not begin chaos testing without a healthy baseline.

## Step 1 — C03 Invalid Signature

Verify the webhook trust boundary first.

Expected:

```text
zero trusted mutation
```

## Step 2 — C01 Duplicate Webhook Replay

Use verified real Test Mode webhook evidence to test event/business idempotency and provide the primary final demo story.

## Step 3 — C07 Lost Client Confirmation

Verify that final captured-payment convergence does not depend on the browser callback.

## Step 4 — C11 Failed Payment Safety

Verify that failure-only evidence cannot mark the merchant order paid or cause fulfilment.

Only after these four mandatory P0 wrappers are implemented, tested and manually verified may selected P1 wrappers be added. A sensible optional P1 order is:

```text
C10 → C09 → C02 → C06 → C05 → C04 → C08 → C12 → C13 → C14 → C15
```

The P1 order is advisory and must never delay Phase 3 P0 approval.

---

# 34. Execution Isolation Rule

Do not run multiple P0 chaos scenarios concurrently against the same Demo Merchant order/payment.

P0 should prefer:

```text
one active chaos run per target payment/order
```

This makes:

- evidence clear;
- cleanup reliable;
- invariant results explainable.

Parallel chaos is outside P0 scope.

---

# 35. Evidence Collection Contract

Every chaos run must capture enough evidence to answer:

```text
What scenario ran?
What original payment/event was used?
Was the source real, replayed, simulated, or fixture?
What fault was applied?
What state existed before?
What processing attempts occurred?
What state existed afterward?
What business effects occurred?
Which invariants evaluated the result?
Why did the run PASS/FAIL/BLOCK/ERROR?
```

---

# 36. Required Common Chaos Evidence

Every executed run should preserve:

```text
chaos_run_id
scenario_id
priority
fault_type
fault_config
data_classification
order_id
payment_attempt_id
payment_id when applicable
source_webhook_event_id when applicable
started_at
completed_at
run result
state before
state after
processing attempt IDs
invariant result IDs
finding IDs if created
```

---

# 37. Real / Synthetic Metric Rule

Chaos results used in the genuine Reliability Score must derive from eligible real Test Mode evidence or approved controlled processing of that evidence.

Runs classified:

```text
SYNTHETIC_DEMO
```

must not silently affect genuine score calculations.

If synthetic metrics are displayed:

they must visibly say:

```text
Synthetic / Demo Only
```

---

# 38. Finding Generation Rule

Scenario status and invariant status are distinct.

For example:

```text
Chaos run = FAIL
Invariant INV-001 = FAIL
Finding created
```

A finding must originate from deterministic invariant failure.

Do not create a payment reliability finding merely because:

```text
Chaos Runner encountered ERROR
```

unless a deterministic payment invariant itself failed.

---

# 39. BLOCKED Run Rule

A BLOCKED scenario must record:

- scenario;
- timestamp;
- failed precheck;
- safe reason.

It must **not** create a money/reliability finding.

Example:

```text
C01 BLOCKED
Reason: no verified source webhook available
```

This is a test-readiness problem, not proof of payment unreliability.

---

# 40. ERROR Run Rule

An ERROR result must be visibly different from FAIL.

Example:

```text
C08 ERROR
Reason:
Chaos Runner lost database connection before controlled fault setup.
```

This is not sufficient evidence to say the merchant integration failed C08.

---

# 41. NOT RUN Rule

`NOT RUN` scenarios must not be counted as passing.

`NOT RUN` is derived when no eligible completed run exists for the scenario in the current evaluation context. It must not be persisted as `chaos_runs.outcome`.

Reliability scoring must distinguish:

```text
tested and passed
```

from:

```text
never tested
```

---

# 42. Regression Requirements

Every P0 scenario must support a deterministic regression strategy.

The standard regression path is:

```text
Original FAIL
        ↓
Finding
        ↓
Developer / Demo Fix
        ↓
Same Scenario ID
        ↓
Equivalent Preconditions
        ↓
Same Relevant Source Evidence
        ↓
Same Invariant IDs
        ↓
New Chaos Run
        ↓
PASS / FAIL
```

Regression must not delete original failure evidence.

---

# 43. Vulnerable Demo Profiles

For judge-facing demonstration, certain scenarios may use intentionally vulnerable Demo Merchant profiles.

Approved principle:

```text
Controlled buggy Demo Merchant behavior
```

must be explicitly labeled.

Good example:

```text
Buggy profile:
idempotency key incorrectly includes processing attempt ID

Fixed profile:
stable semantic idempotency key based on order/business effect
```

Bad example:

```text
Disable database constraints globally
```

Do not weaken the entire database just to manufacture a failure.

---

# 44. Recommended Final Demo Scenario

The frozen primary buildathon demonstration is:

```text
C01 — Duplicate Webhook Delivery
```

Recommended story:

```text
Real Razorpay Test Mode Payment
        ↓
Real Verified payment.captured Event
        ↓
Healthy baseline: one fulfilment
        ↓
PayChaos replays the same authentic event
        ↓
Controlled vulnerable Demo Merchant mishandles duplicate processing
        ↓
Duplicate fulfilment appears
        ↓
C01 mapped Money Invariants FAIL
        ↓
Finding
        ↓
Evidence-backed idempotency diagnosis
        ↓
Recommended fix
        ↓
Use corrected Demo Merchant behavior
        ↓
Re-run C01
        ↓
C01 mapped invariants PASS
```

The demo narration must say clearly:

> The original payment and webhook are real Razorpay Test Mode evidence. PayChaos deliberately replays that authentic event against its own controlled Demo Merchant to test duplicate-delivery safety.

Never claim Razorpay delivered the event twice unless duplicate external delivery evidence proves that happened.

---

# 45. Optional Supporting Demo Scenario

If P1 work is completed after mandatory P0 approval, C06 may be shown as a supporting business-idempotency scenario.

It must not replace C01 as the primary final demo and must not be presented as mandatory P0 coverage.

---

# 46. Automated Testing Requirements

Every P0 scenario must have automated coverage for:

1. preconditions;
2. safety precheck;
3. fault activation;
4. provenance;
5. expected correct path;
6. relevant invariant evaluation;
7. evidence creation;
8. cleanup;
9. regression.

---

# 47. Scenario Unit Tests

Unit tests should primarily cover:

- scenario-registry validation;
- fault configuration validation;
- invariant mapping;
- run-result derivation;
- cleanup-state logic.

---

# 48. Scenario Integration Tests

Integration tests must cover:

- database records;
- event processing;
- fulfilment effects;
- replay provenance;
- transaction rollback;
- finding creation;
- duplicate constraints.

---

# 49. Manual Verification Requirements

Every P0 scenario must receive one manual verification before Phase 3 approval.

Manual verification must record:

```text
Scenario ID
Source evidence
Mechanism
Expected outcome
Actual outcome
Invariant results
Finding if any
Cleanup result
Verifier
Date
```

---

# 50. Scenario Acceptance Matrix

| Scenario | Priority | Automated | Manual | Regression | Required for Phase 3 P0 Approval |
|---|---|---:|---:|---:|---:|
| C01 | P0 | Yes | Yes | Yes | Yes |
| C02 | P1 | If implemented | If implemented | If implemented | No |
| C03 | P0 | Yes | Yes | Yes | Yes |
| C04 | P1 | If implemented | If implemented | If implemented | No |
| C05 | P1 | If implemented | If implemented | If implemented | No |
| C06 | P1 | If implemented | If implemented | If implemented | No |
| C07 | P0 | Internal automation + real manual payment | Yes | Yes | Yes |
| C08 | P1 | If implemented | If implemented | If implemented | No |
| C09 | P1 | If implemented | If implemented | If implemented | No |
| C10 | P1 | If implemented | If implemented | If implemented | No |
| C11 | P0 | Fixture automation + real/manual failure where available | Yes | Yes | Yes |
| C12–C15 | P1 | If implemented | If implemented | If implemented | No |

A required P0 scenario with an unavailable genuine external prerequisite must be reported honestly as:

```text
BLOCKED
```

and cannot be treated as PASS. Phase 3 approval requires all four mandatory P0 scenarios to satisfy their documented evidence requirements.

Do not fake missing evidence.

---

# 51. Scenario Failure Severity Summary

| Scenario | Failure Severity |
|---|---|
| C01 Duplicate webhook | Critical |
| C02 Out-of-order delivery | High |
| C03 Invalid signature | Critical |
| C04 Timeout/slow handler | High |
| C05 Server error/retry | High |
| C06 Duplicate fulfilment | Critical |
| C07 Lost client confirmation | High |
| C08 Database processing failure | Critical |
| C09 Old event replay | Critical |
| C10 Unknown event | High |
| C11 Failed payment becomes paid | Critical |

---

# 52. Scenario-to-Invariant Matrix

This matrix uses the authoritative invariant IDs frozen in `MONEY_INVARIANTS.md`.

| Scenario | Priority | Required Invariants |
|---|---|---|
| C01 | P0 | INV-001, INV-002, INV-006, INV-007 |
| C02 | P1 | INV-002, INV-004, INV-011 |
| C03 | P0 | INV-004, INV-005 |
| C04 | P1 | INV-001, INV-002, INV-009, INV-011 |
| C05 | P1 | INV-001, INV-002, INV-009, INV-011 |
| C06 | P1 | INV-002, INV-004, INV-007, INV-010 |
| C07 | P0 | INV-002, INV-004, INV-011 |
| C08 | P1 | INV-002, INV-009, INV-010, INV-011 |
| C09 | P1 | INV-002, INV-006, INV-011 |
| C10 | P1 | INV-012 |
| C11 | P0 | INV-003, INV-004, INV-011 |
| C12 | P1 | INV-004, INV-014 |
| C13 | P1 | INV-011 |
| C14 | P1 | No dedicated money invariant unless an independent money invariant evaluates |
| C15 | P1 | INV-001, INV-002, INV-009, INV-011 |

`MONEY_INVARIANTS.md` remains authoritative if invariant semantics are reviewed later through the documented change process.

---

# 53. Scenario-to-Mechanism Matrix

| Scenario | A — Real Razorpay | B — Replay Authentic Evidence | C — PayChaos Fault |
|---|---:|---:|---:|
| C01 | Source only | **Yes** | No |
| C02 | Source only | **Yes** | No |
| C03 | No | Fixture input | **Yes** |
| C04 | Source only | **Yes** | **Yes** |
| C05 | Source only | **Yes** | **Yes** |
| C06 | May provide source | Optional | **Yes** |
| C07 | **Yes** | Automated fallback | **Yes** |
| C08 | Source only | **Yes** | **Yes** |
| C09 | Source only | **Yes** | No |
| C10 | No | No genuine replay required | **Yes** |
| C11 | **Preferred** | Automated fixture/replay | No merchant fault |

---

# 54. Database Records Used by Chaos

The approved database model is:

```text
orders
payment_attempts
payments
fulfilments
webhook_events
event_processing_attempts
chaos_runs
invariant_results
findings
regression_runs
```

Chaos scenarios use these existing records.

Do not introduce:

```text
chaos_scenario_runs
fault_injection_settings
generic evidence
```

tables.

---

# 55. Chaos Run Storage Responsibilities

`chaos_runs` stores:

- scenario ID;
- target;
- source event;
- fault type;
- fault configuration;
- run state;
- real/synthetic classification;
- aggregate outcome.

`event_processing_attempts` stores each actual processing attempt.

`invariant_results` stores deterministic correctness.

`findings` stores failed invariant issues.

---

# 56. Cleanup Rules

Every scenario must define cleanup.

General cleanup requirements:

```text
fault disabled
held processing released/cancelled
temporary vulnerable profile disabled
no global setting remains active
run receives final status
evidence retained
original webhook retained
```

Cleanup must run even after:

```text
ERROR
```

where technically possible.

---

# 57. Reset Rules

Use Demo Reset when a scenario intentionally corrupts the controlled merchant state.

Examples:

- C06 vulnerable duplicate fulfilment;
- deliberately inconsistent state fixture;
- partially completed development test.

Reset removes runtime demo records according to `DATABASE.md`.

It must not delete:

- schema;
- migrations;
- secrets;
- Razorpay configuration.

---

# 58. What Chaos Must Never Modify

Chaos must never directly modify:

- Razorpay Test Mode infrastructure;
- Razorpay Dashboard settings;
- API credentials;
- webhook secret;
- Vercel environment secrets;
- Supabase schema during a run;
- production systems.

Chaos changes only controlled PayChaos runtime behavior/data.

---

# 59. What Counts as a Real Razorpay Failure

Only an actual observed Razorpay Test Mode result may be described as:

```text
Razorpay Test Mode payment failed
```

A PayChaos-controlled failure must be described as:

```text
PayChaos simulated merchant handler failure
```

or equivalent.

Never merge these concepts in UI or demo narration.

---

# 60. What Counts as a Real Razorpay Retry

If Razorpay actually redelivers a webhook:

that may be displayed as:

```text
Real Razorpay duplicate/retry delivery
```

if verified from external delivery evidence.

If PayChaos manually reprocesses the event:

display:

```text
PayChaos Replay
```

not:

```text
Razorpay Retry
```

---

# 61. Security Requirements

## CHAOS-SEC-001

No Live Mode.

## CHAOS-SEC-002

No arbitrary targets.

## CHAOS-SEC-003

No arbitrary script execution.

## CHAOS-SEC-004

No arbitrary SQL.

## CHAOS-SEC-005

Fault catalogue is server-authoritative.

## CHAOS-SEC-006

Original verified webhook remains immutable.

## CHAOS-SEC-007

Replay provenance is explicit.

## CHAOS-SEC-008

No secrets appear in evidence.

## CHAOS-SEC-009

No card/CVV/customer payment credentials are used.

## CHAOS-SEC-010

Database failures are simulated safely; Supabase itself is not attacked.

---

# 62. Phase 3 Implementation Order

Claude should implement chaos in this order:

```text
1. Scenario Registry
2. Chaos Precheck
3. Chaos Run lifecycle
4. Replay mechanism
5. Evidence snapshots
6. Invariant interfaces
7. C01
8. C03
9. C07
10. C11
11. Full P0 scenario/invariant regression tests
12. Manual P0 verification
13. Documentation/handoff
14. Only then consider selected P1 scenario wrappers
```

C01 is the first working P0 chaos scenario and the final judge-facing primary demo scenario.

---

# 63. Frozen P0 Scope

The mandatory Phase 3 P0 scenario wrappers are:

```text
C01 Duplicate webhook delivery
C03 Invalid signature
C07 Lost client confirmation
C11 Failed payment safety
```

This four-scenario set is already the approved one-week scope cut. Do not restore C02/C04/C05/C06/C08/C09/C10 to mandatory P0 without an explicit scope decision.

If schedule pressure remains, protect the complete end-to-end C01 story, deterministic invariant correctness, security, evidence and regression before adding any P1 wrapper.

---

# 64. P1 Implementation Rule

Do not implement P1 scenario wrappers until:

```text
C01 + C03 + C07 + C11 implemented
+
automated P0 tests passing
+
manual core scenarios verified
```

P1 wrappers include:

```text
C02 C04 C05 C06 C08 C09 C10 C12 C13 C14 C15
```

P1 must never delay Phase 3 P0 approval.

---

# 65. CHAOS SCENARIO DEFINITION OF DONE

A scenario is not complete because the Chaos Runner button works.

Every scenario must pass the following lifecycle.

---

## 65.1 Injection / Replay

- [ ] approved mechanism works;
- [ ] source provenance is correct;
- [ ] fault is scoped to the run;
- [ ] no arbitrary target exists.

---

## 65.2 Expected Behavior

- [ ] healthy behavior is explicitly defined;
- [ ] vulnerable behavior is explicitly defined;
- [ ] run result derivation is deterministic.

---

## 65.3 Invariant Checks

- [ ] mapped invariants are implemented;
- [ ] PASS behavior is tested;
- [ ] FAIL behavior is tested;
- [ ] UNKNOWN behavior is tested where evidence can be incomplete.

---

## 65.4 Evidence

- [ ] chaos run stored;
- [ ] processing attempts stored;
- [ ] before/after state stored;
- [ ] provenance stored;
- [ ] fulfilment evidence stored;
- [ ] invariant results stored.

---

## 65.5 Vulnerable Path

Where required for the demo:

- [ ] vulnerable path can be demonstrated safely;
- [ ] vulnerable mode is explicitly labeled;
- [ ] no external system is harmed;
- [ ] no production system is involved.

---

## 65.6 Fixed Path

- [ ] corrected implementation passes;
- [ ] business state is correct;
- [ ] money/state invariants pass.

---

## 65.7 Regression

- [ ] regression run exists;
- [ ] same scenario can be rerun;
- [ ] old failure history remains;
- [ ] fixed result creates new evidence.

---

## 65.8 Automated Tests

- [ ] automated test executes;
- [ ] assertions pass;
- [ ] safety tests pass;
- [ ] cleanup test passes.

---

## 65.9 Manual Verification

- [ ] developer manually executes scenario;
- [ ] UI labels are correct;
- [ ] evidence is understandable;
- [ ] reset/cleanup works.

---

## 65.10 Documentation

- [ ] scenario documentation matches implementation;
- [ ] any deviation is recorded;
- [ ] Phase 3 handoff includes results.

---

# 66. Scenario Completion State

Only after all required checks above can an individual scenario be considered:

```text
IMPLEMENTED
→ TESTED
→ MANUALLY VERIFIED
→ DOCUMENTED
→ APPROVED
```

---

# 67. Phase 3 Chaos Completion Gate

The chaos portion of Phase 3 is ready only when:

```text
CHAOS PRECHECK                PASS
STATIC SCENARIO REGISTRY      PASS
NO ARBITRARY TARGETS          VERIFIED
TEST MODE ENFORCEMENT         VERIFIED
REPLAY PROVENANCE             PASS
ORIGINAL EVIDENCE IMMUTABLE   VERIFIED
C01 + C03 + C07 + C11         IMPLEMENTED
P0 INVARIANTS                 IMPLEMENTED
EVIDENCE CAPTURE              PASS
FINDING GENERATION            PASS
AUTOMATED TESTS               PASS
MANUAL VERIFICATION           PASS
CLEANUP                       PASS
DOCUMENTATION                 COMPLETE
```

P1 scenarios are not required for this gate.

---

# 68. CHAOS SCENARIO FREEZE RULE

Once this document is approved:

```text
C01–C15 IDs
priority classifications
mechanism classifications
safety boundaries
required core behavior
scenario/invariant mappings
```

become stable Phase 3 contracts.

Later implementation may refine:

- internal function names;
- UI wording;
- test helper structure;
- fault implementation details

without redesigning the scenario.

Changing:

- scenario meaning;
- safety boundary;
- real/replay provenance;
- invariant intent;
- P0 membership

requires a documented reason.

Valid reasons remain:

1. confirmed bug;
2. confirmed security issue;
3. verified Razorpay constraint;
4. verified platform constraint;
5. incorrect frozen assumption;
6. unavoidable P0 dependency.

---

# Final Chaos Principle

PayChaos must always be able to explain:

```text
What really happened at Razorpay?
What did PayChaos deliberately inject?
What evidence proves the result?
Which deterministic rule decided correctness?
```

If those four questions cannot be answered clearly, the chaos scenario is not ready for the project.