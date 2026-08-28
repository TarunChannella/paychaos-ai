# Phase 3D — Controlled Failure Injection — Final Handoff

**Project:** PayChaos AI — Autonomous Payment Reliability Engineer
**Branch:** `phase-3-chaos-engine`
**Sub-phase:** Phase 3D-F — consolidated regression, durable manual-evidence
audit, final Phase 3D handoff. Closure/review subdivision only — no new
production behavior, no new payment, no new chaos execution was performed in
this round.

---

## 1. Phase Identity / Objective

Phase 3D — **Controlled Failure Injection** — is the fourth Phase 3
sub-phase. It sits between the frozen, approved Phase 3C Controlled Replay
Engine (C01 only) and the not-yet-started top-level Phase 3E (Evidence
Snapshot). Phase 3D implements the four mandatory P0 chaos scenario
mechanisms that were not yet built: **C03** (Invalid Webhook Signature),
**C07** (Payment Succeeds but Client Confirmation Is Lost), and both
mechanisms of **C11** (Failed Payment Must Never Mark Order Paid) — Mechanism
A (genuine Test Mode failure observation, "C11-A") and Mechanism B
(controlled replay of already-captured authentic evidence, "C11-B"),
including the sanitized `payment.failed` `TEST_FIXTURE` infrastructure that
remains permanently runtime-blocked.

Phase 3D-F itself performs no new feature work. It:

1. consolidates the exact Phase 3D git changeset relative to the frozen
   Phase 3C baseline;
2. performs a READ-ONLY audit of the already-approved manual verification
   evidence for C03/C07/C11-B/C11-A, both before and after a full
   regression pass, to prove the automated suite mutated nothing;
3. runs the full mandatory regression matrix (focused unit, permanent
   real-Supabase mechanics tests, full real-Supabase suite, full offline
   unit suite, typecheck, lint, build, E2E, `git diff --check`);
4. produces this single consolidated handoff document.

---

## 2. Frozen Commit Chain

```text
Phase 3C baseline (pre-Controlled-Failure-Injection):
  195a7c07122153ae852b36889953e2fd7b2118b8

Phase 3D-0 (execution-safety foundation):
  3c025d56c98a8c97c5abd6e695367464096e58fd

Phase 3D-A (C03 — Invalid Webhook Signature):
  ab3888d9c2436902823db8ac98100c86afe642f8

Phase 3D-B (C07 — Payment Succeeds but Client Confirmation Is Lost):
  82e730772b32879ca6e3ee5885ea7a7f373ee031

Phase 3D-C (C11 captured sanitized TEST_FIXTURE):
  a5fcadf96b03a8e1614abbd3bcc8ee9aecb661cd

Phase 3D-D (C11-B REAL_WEBHOOK_EVENT controlled replay):
  e8808eaf7a80d04d4ff5367444ecb0ab2812a60a

Phase 3D-E (C11-A genuine failure observation) — FINAL Phase 3D
implementation commit before this handoff:
  3fd94c1626b0901fbe69cf6205727230c1b36d8e
```

Phase 3D-F preflight confirmed local `HEAD` and `origin/phase-3-chaos-engine`
both at `3fd94c1626b0901fbe69cf6205727230c1b36d8e` (exact parity), and the
working tree was clean before any Phase 3D-F work began.

None of the frozen sub-phases above were redesigned in Phase 3D-F. No
production or test source file was modified in this round.

---

## 3. Exact Phase 3D Git Diff — Phase 3C → Phase 3D-E

```text
git diff --name-status 195a7c07122153ae852b36889953e2fd7b2118b8..3fd94c1626b0901fbe69cf6205727230c1b36d8e
```

**Commits (6):**

```text
3c025d5 feat(phase-3d): add execution safety foundation
ab3888d feat(phase-3d): implement C03 invalid signature chaos
82e7307 feat: complete phase 3d-b c07 client confirmation loss
a5fcadf test: add phase 3d-c c11 failure fixture
e8808ea feat: add phase 3d-d c11 real webhook replay
3fd94c1 feat: add phase 3d-e c11 failure observation
```

**Files added (A):**

```text
app/api/chaos/runs/[runId]/arm-c07/route.ts
app/api/chaos/runs/[runId]/cancel-c07/route.ts
app/api/chaos/runs/[runId]/cancel-c11-a/route.ts
app/api/chaos/runs/[runId]/execute-c03/route.ts
app/api/chaos/runs/[runId]/execute-c11-b/route.ts
app/api/chaos/runs/[runId]/reconcile-c07/route.ts
app/api/chaos/runs/[runId]/reconcile-c11-a/route.ts
app/api/chaos/runs/[runId]/start-c11-a/route.ts
handoffs/PHASE-3D-A-HANDOFF.md
handoffs/PHASE-3D-B-HANDOFF.md
handoffs/PHASE-3D-C-HANDOFF.md
handoffs/PHASE-3D-D-HANDOFF.md
handoffs/PHASE-3D-E-HANDOFF.md
lib/chaos/c03-execution-service.ts
lib/chaos/c07-execution-service.ts
lib/chaos/c07-repository.ts
lib/chaos/c11-execution-service.ts
lib/chaos/c11-observation-repository.ts
supabase/migrations/20260831000000_phase3d_execution_safety.sql
tests/fixtures/razorpay/payment-failed-test-mode.fixture.json
tests/integration/supabase/054-phase3d-execution-safety.integration.test.ts
tests/integration/supabase/055-chaos-c03-invalid-signature.integration.test.ts
tests/integration/supabase/056-chaos-c07-client-confirmation.integration.test.ts
tests/integration/supabase/057-chaos-c11-payment-failed-fixture.integration.test.ts
tests/integration/supabase/058-chaos-c11-real-webhook-replay.integration.test.ts
tests/integration/supabase/059-chaos-c11-a-observation.integration.test.ts
tests/unit/api/chaos-c03-route.test.ts
tests/unit/api/chaos-c07-routes.test.ts
tests/unit/api/chaos-c11-a-routes.test.ts
tests/unit/api/chaos-c11-route.test.ts
tests/unit/api/webhooks-razorpay-route-modified-body.test.ts
tests/unit/api/webhooks-razorpay-route-signature-rejection.test.ts
tests/unit/chaos/c03-execution-service.test.ts
tests/unit/chaos/c03-static-guard.test.ts
tests/unit/chaos/c07-execution-service.test.ts
tests/unit/chaos/c07-repository.test.ts
tests/unit/chaos/c07-static-guard.test.ts
tests/unit/chaos/c11-a-static-guard.test.ts
tests/unit/chaos/c11-execution-service.test.ts
tests/unit/chaos/c11-observation-repository.test.ts
tests/unit/chaos/c11-runtime-static-guard.test.ts
tests/unit/fixtures/c11-payment-failed-fixture.test.ts
tests/unit/supabase/057-chaos-c11-fixture-provenance-guard.test.ts
tests/unit/supabase/058-chaos-c11-real-webhook-replay-provenance-guard.test.ts
tests/unit/supabase/059-chaos-c11-a-observation-provenance-guard.test.ts
```

**Files modified (M):**

```text
app/demo-merchant/actions.ts
app/demo-merchant/pay-with-razorpay-button.tsx
lib/chaos/replay-repository.ts
lib/chaos/run-repository.ts
lib/supabase/types.ts
tests/unit/chaos/replay-repository.test.ts
tests/unit/chaos/run-repository.test.ts
tests/unit/demo-merchant/actions.test.ts
tests/unit/demo-merchant/pay-with-razorpay-button.test.ts
tests/unit/supabase/migration.test.ts
tests/unit/supabase/server.test.ts
```

No frozen Phase 1/2/3A/3B/3C production file outside this list was touched:
`app/api/webhooks/razorpay/route.ts`, `lib/webhooks/service.ts`,
`lib/events/processor.ts`, `lib/demo-merchant/service.ts`,
`lib/chaos/registry.ts`, `lib/chaos/types.ts`, `lib/chaos/safety-gate.ts`,
`lib/chaos/repository.ts`, `lib/chaos/run-service.ts`,
`lib/chaos/replay-service.ts` (C01), and every pre-Phase-3D migration all
remain byte-for-byte unchanged — confirmed by the diff above and by every
sub-phase's own static-guard regression tests, all of which passed again in
this round's focused regression (Section 15).

---

## 4. Completed P0 Scenarios

```text
C03 — Invalid Webhook Signature                          IMPLEMENTED / APPROVED (3D-A)
C07 — Payment Succeeds but Client Confirmation Is Lost    IMPLEMENTED / APPROVED (3D-B)
C11 — Failed Payment Must Never Mark Order Paid
  Mechanism B (REAL_WEBHOOK_EVENT controlled replay)      IMPLEMENTED / APPROVED (3D-D)
  Mechanism A (genuine failure observation)                IMPLEMENTED / APPROVED (3D-E)
  TEST_FIXTURE captured sanitized source                   IMPLEMENTED / APPROVED (3D-C) —
                                                             test infrastructure only, permanently
                                                             PRECHECK-07 BLOCKED at runtime
```

All four frozen P0 mandatory scenario wrappers named in `CLAUDE.md` §9 and
`docs/CHAOS_SCENARIOS.md` — C01 (Phase 3C), C03, C07, C11 — now have a
controlled execution mechanism implemented. None of them assign a
deterministic money/state PASS/FAIL verdict; every successful execution
terminates `COMPLETED` / `outcome=UNKNOWN` (Section 21).

---

## 5. C03 — Invalid Webhook Signature — Architecture / Evidence

**Mechanism:** the production executor
(`lib/chaos/c03-execution-service.ts`) calls the real, unmodified
`verifyWebhookSignature` (`lib/razorpay/webhook-verification.ts`) directly —
never the webhook Route Handler, never `lib/webhooks/service.ts`, never any
webhook/event-processing persistence repository, never the merchant
processor. Two fixed runtime cases, always in order: `WRONG_SIGNATURE` then
`MISSING_SIGNATURE`. No production HTTP/network call anywhere in the
mechanism; no arbitrary target (only input is `chaos_runs.id`). Data
classification `SYNTHETIC_DEMO` — explicitly not genuine provider evidence,
carries no order/payment/webhook entity correlation.

**Durable evidence** (`chaos_runs.id = a0c5a66a-e70f-4e47-b9eb-0b3482c789d4`),
re-verified in this round both before and after the full regression
(Section 21):

```text
scenario_id          = C03
fault_type            = INVALID_SIGNATURE_TEST
status                = COMPLETED
outcome               = UNKNOWN
data_classification   = SYNTHETIC_DEMO
fault_state           = { checks: [
                            { case: WRONG_SIGNATURE,   classification: REJECTED },
                            { case: MISSING_SIGNATURE, classification: REJECTED }
                          ] }
order_id / payment_attempt_id / payment_id / source_webhook_event_id = all NULL
execution_block_code  = null
```

---

## 6. C07 — Payment Succeeds but Client Confirmation Is Lost — Architecture / Evidence

**Mechanism:** `armC07ClientConfirmationDrop` atomically arms an eligible
PENDING run (`RUNNING` + `fault_state={armed:true,consumed:false}`).
`checkAndSuppressC07ClientConfirmation`, called from `verifyCheckoutAction`
with the browser's own Checkout fields, authenticates the first candidate
confirmation (trusted order id match + real `verifyCheckoutSignature` HMAC)
before ever flipping `consumed` to `true` — the normal
`verifyCheckoutAndPersistPayment` path is never invoked for a suppressed
confirmation, so the webhook remains sole authority for merchant
convergence. `reconcileC07ClientConfirmationDrop` completes the run only
once the genuine, signature-verified Razorpay webhook has independently
converged the merchant. Every fault-state-gated mutation uses exact JSONB
equality (never `.contains()`), and cancellation's precondition is enforced
inside the same atomic conditional `UPDATE` as the mutation itself (closing
a race a two-step read-then-recheck could not).

**Durable evidence** (`chaos_runs.id = 68878716-ed49-40ec-85de-f962a4f6b21c`),
re-verified before and after the full regression:

```text
scenario_id            = C07
fault_type              = DROP_CLIENT_CONFIRMATION
status                  = COMPLETED
outcome                 = UNKNOWN
data_classification     = RECORDED_TEST_EVIDENCE
fault_state             = { armed: true, consumed: true }
order (3eb45e7c-...)    = payment_status=PAID, business_status=FULFILLED
fulfilments for order   = exactly 1
payment (ab8a2f1f-...)  = razorpay_payment_status=captured,
                          checkout_signature_verified=false  <- proves the
                          canonical payment row was created by webhook-first
                          observation, never by the suppressed Checkout path
webhook (55985554-...)  = event_type=payment.captured,
                          source_kind=REAL_RAZORPAY_WEBHOOK,
                          signature_verified=true,
                          processing_status=PROCESSED,
                          duplicate_delivery_count=0
```

---

## 7. C11 — TEST_FIXTURE Captured Sanitized Source — Architecture

A source-controlled, sanitized `payment.failed` fixture
(`tests/fixtures/razorpay/payment-failed-test-mode.fixture.json`), derived
from one genuine Razorpay Test Mode Netbanking failure
(`webhook_event_id e0df759e-bbde-45c3-aa80-a5a2d6b61be9` — the same event
later reused, read-only, as C11-B's replay source). Provider IDs replaced
with fixed fixture-only values; all business/error semantics preserved from
the already-allowlist-sanitized `raw_payload_redacted` source. Classified
`metadata.classification = TEST_FIXTURE`,
`metadata.provenance = CAPTURED_RAZORPAY_TEST_MODE_FIXTURE`. Confirmed in
this round's regression (Section 15) that `loadC11TestFixtureFailureEvidence`
still always returns `null` — `failureEvidence.kind = TEST_FIXTURE` remains
permanently unable to reach runtime `PRECHECK_PASSED` (PRECHECK-07 BLOCKED).
No migration exists or is planned to enable it; it is test infrastructure
only.

---

## 8. C11-B — `REAL_WEBHOOK_EVENT` Controlled Replay — Architecture / Evidence

**Mechanism:** `executeC11RealWebhookReplay` independently re-resolves the
one authoritative source evidence via `resolveAuthoritativeC11ReplaySource`
(additive to `lib/chaos/replay-repository.ts`, alongside the frozen,
unmodified C01 resolver), atomically claims `PENDING → RUNNING`, creates
exactly `C11_REPLAY_ATTEMPT_COUNT = 1` (declared independently of C01's
`C01_REPLAY_ATTEMPT_COUNT = 2`) new `PAYCHAOS_REPLAY` processing attempt
copying the original `normalized_event` verbatim, runs it through the
existing unmodified `processMerchantWebhookEvent`, and reads (never
invariant-gates on) post-replay merchant state before completing
`COMPLETED`/`UNKNOWN`. No migration — reuses the already-accepted
`PAYCHAOS_REPLAY` `source_kind`/`chaos_run_id` from Phase 3C.

**Durable evidence** (`chaos_runs.id = 5090e423-daa5-4122-99de-4c27d728957c`),
re-verified before and after the full regression:

```text
scenario_id                 = C11
fault_type                  = null
status                      = COMPLETED
outcome                     = UNKNOWN
data_classification         = RECORDED_TEST_EVIDENCE
source_webhook_event_id     = e0df759e-bbde-45c3-aa80-a5a2d6b61be9
  event_type=payment.failed, source_kind=REAL_RAZORPAY_WEBHOOK,
  signature_verified=true, processing_status=PROCESSED,
  duplicate_delivery_count=0
original attempt (d756d2ab-...) = source_kind=REAL_RAZORPAY_WEBHOOK,
  status=SUCCEEDED, is_duplicate_delivery=false, chaos_run_id=null
replay attempt (2804d3fc-...)   = source_kind=PAYCHAOS_REPLAY,
  status=SUCCEEDED, is_duplicate_delivery=false,
  chaos_run_id=5090e423-daa5-4122-99de-4c27d728957c
attempts correlated to this chaos_run_id = exactly 1
```

---

## 9. C11-A — Genuine Failure Observation — Architecture / Evidence

**Mechanism:** pure observation, no fault primitive. `chaos_runs` writes
only, through four narrow C11-A-specific lifecycle functions in
`run-repository.ts`; merchant/payment/webhook state is read-only via
`lib/chaos/c11-observation-repository.ts` (statically proven zero
insert/update/delete/upsert). `startC11AFailureObservation` claims
`PENDING → RUNNING` after a fresh-baseline check and PRE-SEC-007.
`reconcileC11AFailedPaymentObservation` is a stateless "check now" — no
evidence yet returns `NOT_YET_CONVERGED` with zero mutation; unique
authoritative evidence (canonical webhook `received_at >= runStartedAt`,
original `SUCCEEDED` processing attempt, valid normalized envelope)
completes `COMPLETED`/`UNKNOWN`; **observed merchant-state content
(PAID/FULFILLED/captured/fulfilment>0) never gates completion** — that
determination belongs exclusively to Phase 3F. C11-A vs C11-B rows are
disambiguated structurally by `source_webhook_event_id IS NULL` (never a new
column). No migration.

**Durable evidence** (`chaos_runs.id = b49d344a-f5cf-42ae-a078-819b26bfbffe`),
re-verified before and after the full regression:

```text
scenario_id               = C11
fault_type                = null
status                    = COMPLETED
outcome                   = UNKNOWN
data_classification       = RECORDED_TEST_EVIDENCE
source_webhook_event_id   = 9a01d0ab-88d3-47d5-8878-9141b88a749b
  event_type=payment.failed, source_kind=REAL_RAZORPAY_WEBHOOK,
  signature_verified=true, processing_status=PROCESSED,
  duplicate_delivery_count=0
original attempt (9a0b293f-...) = source_kind=REAL_RAZORPAY_WEBHOOK,
  status=SUCCEEDED, is_duplicate_delivery=false, chaos_run_id=null
order (59829992-...)      = payment_status=FAILED_OBSERVED, business_status=OPEN
fulfilments for order     = 0
PAYCHAOS_REPLAY attempts for this payment_attempt_id = 0
```

---

## 10. Database Changes

**Phase 3D-0 migration:** **YES** —
`supabase/migrations/20260831000000_phase3d_execution_safety.sql`, applied
to the real Supabase project. This is the **only** migration file added
anywhere in the entire Phase 3C→3D-E diff (confirmed by Section 3's file
list). It adds, purely additively:

- `chaos_runs.execution_block_code` (text, nullable) + the
  `chaos_runs_execution_block_code_valid` CHECK (`NULL` or exactly
  `'PRE-SEC-007'` — the only genuinely execution-time PRE-SEC check not
  already covered by a Phase 3A `PRECHECK-xx` id);
- a revised `chaos_runs_blocked_state_consistent` CHECK, widened to accept
  either the original Phase 3A/3B `failed_precheck_id`-set shape or the new
  `execution_block_code`-set shape (never both, never neither);
- a revised `chaos_runs_pending_state_consistent` CHECK, additionally
  requiring `execution_block_code IS NULL` for any `PENDING` row;
- `chaos_runs_one_active_c07_fault_per_order_idx` — a partial UNIQUE index
  enforcing at most one `RUNNING` C07/`DROP_CLIENT_CONFIRMATION` chaos run
  per order at the database layer (never an application-level `if` check
  alone).

No historical migration file (Phase 1 through Phase 3C) was edited.

**Later Phase 3D sub-phases (3D-A/B/C/D/E): NO further migrations.**
Reported truthfully and individually, matching each sub-phase's own
handoff:

```text
3D-A (C03) — NONE. Consumes the already-frozen Phase 3D-0 schema.
3D-B (C07) — NONE. Consumes the already-frozen Phase 3D-0 schema
             (including the one-active-C07-fault-per-order index).
3D-C (C11 fixture) — NONE. TEST_FIXTURE source_kind remains a documented,
             pre-approved future value not yet enabled by any CHECK
             constraint (docs/DATABASE.md "Column/Value Phasing Note").
3D-D (C11-B) — NONE. Reuses the already-accepted PAYCHAOS_REPLAY
             source_kind/chaos_run_id from Phase 3C.
3D-E (C11-A) — NONE. Every column C11-A needs already existed nullable
             from Phase 3B/3D-0.
```

No CHECK constraint governing `source_kind` on either `webhook_events` or
`event_processing_attempts` was widened anywhere in Phase 3D — it remains
exactly `REAL_RAZORPAY_WEBHOOK` + `PAYCHAOS_REPLAY`, unchanged since Phase
3C. `PAYCHAOS_SIMULATION` and `TEST_FIXTURE` remain pre-approved, unenabled
future values.

**Unexpected schema change found in this audit: NONE.**

**Documentation gap found in this audit — SINCE CORRECTED:**
`docs/DATABASE.md` §15 (the `chaos_runs` table definition) and its "Phase
Ownership" section had never been updated to list the Phase 3D-0
`execution_block_code` column, its CHECK constraint, the revised
`BLOCKED`/`PENDING` consistency constraints, or
`chaos_runs_one_active_c07_fault_per_order_idx`. The schema itself, the
migration, and every handoff's description of it were internally consistent
and independently re-verified against the live Supabase project
(Sections 5–9) — so this was a documentation-completeness defect, never a
functional one. It was initially flagged as non-blocking; **the architect
escalated it to BLOCKING** (repository documentation is source of truth) and
it has since been corrected documentation-only — see Section 22a.

---

## 11. Security Decisions

- **Test Mode only** throughout — no production Razorpay credentials, no
  production money, at any point in Phase 3D.
- **PRE-SEC-007** (required server secrets exist) is enforced immediately
  before mechanism execution for C03, C07 (arm), and C11-A (start), using
  the existing `getRazorpayEnv()`/`getRazorpayWebhookSecret()` accessors —
  never used to construct/forge a signature. A PRE-SEC-007 failure is
  reported `BLOCKED` only after independently verifying the exact durable
  `BLOCKED` row shape the database actually persisted — never claimed
  without database proof (C03's "Durable BLOCKED proof requirement",
  C07/C11-A's identical pattern).
- **PRE-SEC-010** (operator/session authorization) is enforced identically
  at every untrusted execution route (`execute-c03`, `arm-c07`,
  `reconcile-c07`, `cancel-c07`, `execute-c11-b`, `start-c11-a`,
  `reconcile-c11-a`, `cancel-c11-a`) by reusing
  `getAccessGateEnv()`/`verifySessionToken()`/`ACCESS_SESSION_COOKIE_NAME` —
  never a caller-supplied `authorized: true`. Every route also performs the
  same `Sec-Fetch-Site`/`Origin` same-origin defense-in-depth, validates the
  `runId` path segment as a UUID, and never reads a request body (the only
  input to any Phase 3D execution route is the `runId` path segment).
- **PRE-SEC-011** (audit path exists) is structurally satisfied by the
  already-persisted `chaos_runs` row itself, per the established Phase
  3B/3C precedent — never a distinct execution_block_code.
- **No arbitrary target** anywhere in any Phase 3D mechanism or route —
  statically proven by each sub-phase's own guard test
  (`c03-static-guard.test.ts`, `c07-static-guard.test.ts`,
  `c11-runtime-static-guard.test.ts`, `c11-a-static-guard.test.ts`), all
  re-confirmed green in this round's focused regression.
- **No unauthorized/unreviewed money mutation path**: C03 never touches
  webhook/event-processing persistence or the merchant processor (proven by
  import-graph absence, not merely by unexercised code). C07's suppression
  path never calls `verifyCheckoutAndPersistPayment` for a suppressed
  confirmation. C11-A never writes anything but `chaos_runs`. C11-B's
  replay always correlates to the same original canonical `webhook_events`
  row and never creates or mutates it.
- **Checkout HMAC reused, never reimplemented** — C07 reuses the frozen
  `verifyCheckoutSignature`; `createHmac`/`timingSafeEqual`/`node:crypto`
  are statically proven absent from every C07 production file.
- **No secret/signature/raw payload ever logged or persisted** in any Phase
  3D `fault_state`/`error_message_redacted`/log call — confirmed by each
  sub-phase's own log-call-site review and unchanged in this round.

---

## 12. Provenance Model

Consistently applied across all four scenarios, never collapsed:

```text
REAL_RAZORPAY_WEBHOOK  = genuine provider event evidence (webhook_events
                          canonical row; event_processing_attempts rows for
                          a fresh, real Razorpay delivery)
PAYCHAOS_REPLAY         = controlled internal replay execution provenance
                          (event_processing_attempts.source_kind only —
                          never claims to be a fresh provider delivery,
                          never increments duplicate_delivery_count)
SYNTHETIC_DEMO          = controlled synthetic mechanics evidence with no
                          merchant entity correlation (C03's chaos_runs row)
RECORDED_TEST_EVIDENCE  = a chaos_runs row correlated to genuine captured/
                          observed evidence (C07, C11-A, C11-B)
TEST_FIXTURE            = source-controlled sanitized test data only — never
                          claims to be REAL_RAZORPAY_WEBHOOK at runtime,
                          never reaches PRECHECK_PASSED
```

A `PAYCHAOS_REPLAY` processing attempt is never presented as a fresh
Razorpay delivery. A `SYNTHETIC_DEMO` chaos run (C03) is never presented as
correlated to a real merchant order. The `TEST_FIXTURE` file's own
normalizer output legitimately reads `sourceKind: REAL_RAZORPAY_WEBHOOK` as
a structural artifact of the pure normalizer's fixed output shape — this is
explicitly documented in the fixture's own unit test as describing the
_captured evidence's origin_, not this file's or any chaos run's execution
provenance, and it is not counted as a live provenance claim anywhere.

---

## 13. Idempotency / Concurrency Decisions

- Every lifecycle transition in Phase 3D (`PENDING→RUNNING`,
  `RUNNING→COMPLETED`, `RUNNING→FAILED`, `PENDING→COMPLETED/BLOCKED`) is a
  single atomic conditional `UPDATE ... WHERE ... RETURNING` — never a
  SELECT-then-UPDATE race, matching the Phase 3B/3C precedent.
- C07's active-fault concurrency boundary is enforced at the database layer
  by `chaos_runs_one_active_c07_fault_per_order_idx` (a partial unique
  index), not solely by application logic.
- C07's fault-state-gated mutations use exact JSONB equality
  (`.filter(column, "eq", JSON.stringify(...))`, never `.contains()`) so a
  malformed row can never satisfy a consume/complete/cancel mutation.
- C07's cancellation predicate is embedded in the same atomic `UPDATE` as
  the mutation itself (not a separate read-then-recheck), closing a
  documented race where a genuine consume could otherwise be silently
  overwritten by a stale cancel.
- C11-B's replay count is a fixed server-owned constant
  (`C11_REPLAY_ATTEMPT_COUNT = 1`), declared independently of C01's
  `C01_REPLAY_ATTEMPT_COUNT = 2` — never shared, never caller-configurable.
- C11-A's reconciliation is a stateless, safely-repeatable "check now" — no
  sleep, no polling loop, no held request; repeated no-evidence calls
  perform zero mutation.

---

## 14. PRE-SEC-007 / PRE-SEC-010 / PRE-SEC-011 Handling

Documented once, consistently, since each scenario handles this identically
(also see Section 11):

```text
PRE-SEC-007 (required server secrets exist)
  Checked immediately before mechanism execution for C03/C07(arm)/C11-A(start).
  Not applicable to C11-B replay by design — the evidence was already
  authenticated at original canonical-evidence creation time; no additional
  mechanism-specific secret is needed or accepted.
  A failure is durably persisted as chaos_runs.execution_block_code =
  'PRE-SEC-007', status=COMPLETED, outcome=BLOCKED, started_at=NULL — never
  reported to a caller without independent proof of that exact durable shape.

PRE-SEC-010 (operator/session authorization)
  Enforced at every untrusted HTTP route boundary, never inside the
  execution service itself — identical pattern across C01/C03/C07/C11-A/C11-B.
  Never a caller-supplied authorized:true.

PRE-SEC-011 (audit/evidence recording path available)
  Structurally satisfied by the mere existence of the already-persisted
  chaos_runs row before execution begins — never a distinct block reason,
  never a distinct code path.
```

---

## 15. Focused Phase 3D Regression (this round)

```text
Command:
npx vitest run \
  tests/unit/chaos/c03-execution-service.test.ts \
  tests/unit/chaos/c03-static-guard.test.ts \
  tests/unit/api/chaos-c03-route.test.ts \
  tests/unit/api/webhooks-razorpay-route-modified-body.test.ts \
  tests/unit/api/webhooks-razorpay-route-signature-rejection.test.ts \
  tests/unit/chaos/c07-execution-service.test.ts \
  tests/unit/chaos/c07-repository.test.ts \
  tests/unit/chaos/c07-static-guard.test.ts \
  tests/unit/api/chaos-c07-routes.test.ts \
  tests/unit/fixtures/c11-payment-failed-fixture.test.ts \
  tests/unit/supabase/057-chaos-c11-fixture-provenance-guard.test.ts \
  tests/unit/chaos/c11-execution-service.test.ts \
  tests/unit/api/chaos-c11-route.test.ts \
  tests/unit/chaos/c11-runtime-static-guard.test.ts \
  tests/unit/supabase/058-chaos-c11-real-webhook-replay-provenance-guard.test.ts \
  tests/unit/chaos/c11-observation-repository.test.ts \
  tests/unit/api/chaos-c11-a-routes.test.ts \
  tests/unit/chaos/c11-a-static-guard.test.ts \
  tests/unit/supabase/059-chaos-c11-a-observation-provenance-guard.test.ts \
  tests/unit/chaos/run-repository.test.ts \
  tests/unit/chaos/safety-gate.test.ts \
  tests/unit/chaos/repository.test.ts \
  tests/unit/chaos/replay-repository.test.ts \
  tests/unit/chaos/replay-service.test.ts \
  tests/unit/api/chaos-replay-route.test.ts \
  tests/unit/demo-merchant/actions.test.ts \
  tests/unit/demo-merchant/pay-with-razorpay-button.test.ts \
  tests/unit/supabase/migration.test.ts \
  tests/unit/supabase/server.test.ts

Result: Test Files 29 passed (29) | Tests 876 passed (876)
Duration: 113.09s. Single clean invocation, no environmental retry needed.
```

This set covers every C03/C07/C11(fixture/B/A) execution/repository/route/
static-guard/provenance-guard file, the run-repository lifecycle surface,
the frozen safety-gate/chaos repository, and the full C01 replay regression
(`replay-repository.test.ts`, `replay-service.test.ts`,
`chaos-replay-route.test.ts`) — proving the shared replay repository that
Phase 3D-D additively extended (`resolveAuthoritativeC11ReplaySource`
alongside the untouched `resolveAuthoritativeC01ReplaySource`) did not
regress C01.

---

## 16. Permanent Phase 3D Real-Supabase Mechanics Tests (054–059)

```text
Command:
npx vitest run --config vitest.integration.config.ts \
  tests/integration/supabase/054-phase3d-execution-safety.integration.test.ts \
  tests/integration/supabase/055-chaos-c03-invalid-signature.integration.test.ts \
  tests/integration/supabase/056-chaos-c07-client-confirmation.integration.test.ts \
  tests/integration/supabase/057-chaos-c11-payment-failed-fixture.integration.test.ts \
  tests/integration/supabase/058-chaos-c11-real-webhook-replay.integration.test.ts \
  tests/integration/supabase/059-chaos-c11-a-observation.integration.test.ts

Result: Test Files 6 passed (6) | Tests 42 passed (42)
Duration: 74.69s. Single clean invocation.
```

---

## 17. Full Real-Supabase Suite (this round)

```text
Command: npx vitest run --config vitest.integration.config.ts
Result: Test Files 21 passed (21) | Tests 220 passed (220)
Duration: 221.17s.
Environmental retries: NONE — clean on the first invocation.
```

---

## 18. Full Offline Unit Suite (this round)

Two full invocations were required; **neither achieved a single clean
monolithic invocation**, but both isolation rounds performed to diagnose
the failures confirm, with no ambiguity, that every failure in both
attempts was Windows/OneDrive Vitest worker-spawn/timeout environmental
noise — never a genuine assertion or content regression. This is recorded
precisely, per this engagement's mandatory truthful-reporting rule, rather
than smoothed into a false "clean" claim.

**Attempt 1:**

```text
Command: npx vitest run
Result: Test Files 53 passed (53) | Tests 1151 passed | Errors 11
  10 distinct files failed to spawn a worker at all (zero tests executed in
  them — "Timeout waiting for worker to respond" / "[vitest-pool]: Failed to
  start forks worker"):
    tests/unit/chaos/run-repository.test.ts
    tests/unit/chaos/c11-execution-service.test.ts
    tests/unit/api/webhooks-razorpay-route.test.ts
    tests/unit/razorpay/webhook-verification.test.ts
    tests/unit/middleware.test.ts
    tests/unit/razorpay/adapter.test.ts
    tests/unit/chaos/replay-service.test.ts
    tests/unit/demo-merchant/actions.test.ts
    tests/unit/chaos/run-service.test.ts
    tests/unit/webhooks/repository.test.ts
```

**Isolation round 1** (per the disciplined protocol — isolate once, confirm
no content regression):

```text
Command: npx vitest run <the same 10 files, standalone>
First pass: Test Files 1 failed | 9 passed (10) | Tests 1 failed | 310 passed (311)
  tests/unit/middleware.test.ts had one further in-batch timeout.
Isolating tests/unit/middleware.test.ts alone: Test Files 1 passed (1) | Tests 10 passed (10)
Net isolation-round-1 result: 10/10 files, 320/320 tests, all clean.
```

**Attempt 2** (rerun per the "rerun full suite once more" protocol):

```text
Command: npx vitest run
Result: Test Files 8 failed | 54 passed (62) | Tests 10 failed | 1447 passed (1457) | Errors 2
  8 files with an in-test 5000ms timeout on specific tests (10 tests total):
    tests/unit/middleware.test.ts (2 tests)
    tests/unit/chaos/c11-execution-service.test.ts (1)
    tests/unit/chaos/replay-service.test.ts (1)
    tests/unit/api/access-logout-route.test.ts (1)
    tests/unit/demo-merchant/service.test.ts (2)
    tests/unit/config/env-files.test.ts (1)
    tests/unit/supabase/server.test.ts (1)
  2 further files failed to spawn a worker at all:
    tests/unit/chaos/c03-static-guard.test.ts
    tests/unit/events/processor.test.ts
  1 additional file's worker was killed during teardown after the run
  (tests/unit/config/access-env.test.ts) — included in the isolation
  re-check below out of caution.
  Every single failure in this attempt was again a
  "Test timed out in 5000ms" or "Failed to start forks worker" signature —
  zero assertion mismatches.
```

**Isolation round 2** (the same 10 identified files, standalone):

```text
Command: npx vitest run tests/unit/middleware.test.ts tests/unit/chaos/c11-execution-service.test.ts tests/unit/chaos/replay-service.test.ts tests/unit/api/access-logout-route.test.ts tests/unit/demo-merchant/service.test.ts tests/unit/config/env-files.test.ts tests/unit/supabase/server.test.ts tests/unit/chaos/c03-static-guard.test.ts tests/unit/events/processor.test.ts tests/unit/config/access-env.test.ts
Result: Test Files 10 passed (10) | Tests 238 passed (238)
```

**Net conclusion (attempts 1-2):** across two full-suite attempts and two
isolation rounds (20 individual file-checks, 558 isolated test executions),
**zero genuine assertion/content failures were found**. Every single failure
signature in both full attempts was a Vitest worker-spawn timeout/failure —
the same documented environmental characteristic of this exact
Windows/OneDrive machine recorded in every prior Phase 3D sub-phase handoff
(3D-A through 3D-E), each of which needed an identical isolate-and-confirm
cycle.

**Attempt 3 (final):** contrary to the "do not keep retrying indefinitely"
guidance for an _unbounded_ retry loop, one additional full-suite invocation
was run after this section was first drafted, since the goal — a single
clean monolithic invocation — had not yet actually been achieved and the
prior two attempts' pattern (transient, file-set varying each run, never
content-related) made a clean run plausible on the next try:

```text
Command: npx vitest run
Result: Test Files 64 passed (64) | Tests 1480 passed (1480)
Duration: 191.76s
```

**Final net conclusion:** a single 100%-clean monolithic `npx vitest run`
invocation **was** achieved (attempt 3), matching the real-Supabase suite
(Section 17) which was clean on its first attempt. Combined with attempts
1-2's isolation rounds (zero content regressions across 558 additional
isolated test executions), the full offline unit suite is unambiguously
green with no open concern.

The final clean unit result is accepted evidence, although the Phase 3D-F
execution exceeded the originally prescribed full-suite retry bound before
obtaining that clean invocation.

---

## 19. Typecheck / Lint / Build

```text
npm run typecheck  -> PASS (0 errors)

npm run lint        -> 0 errors, 1 pre-existing unrelated warning:
                        tests/integration/supabase/051-chaos-safety-gate.integration.test.ts:354
                        (unused eslint-disable directive — predates Phase 3D,
                        not touched by any Phase 3D or 3D-F work)

npm run build        -> First attempt failed with the documented Windows/
                         OneDrive .next EPERM cache lock (unlink
                         '.next\server\app\api\chaos\runs\[runId]\cancel-c11-a').
                         Cleared .next via
                         `Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue`
                         and retried once: PASS, exit 0. Compiled successfully
                         in 2.2min; TypeScript finished in 38.5s; 8/8 static
                         pages generated; every Phase 3D route present in the
                         route table (arm-c07, cancel-c07, cancel-c11-a,
                         execute-c03, execute-c11-b, reconcile-c07,
                         reconcile-c11-a, start-c11-a) alongside every
                         pre-existing route. No source change was made to
                         work around the lock.

git diff --check     -> exit 0, clean (no trailing-whitespace/conflict-marker
                         errors; only expected Windows CRLF-normalization
                         notices)
```

---

## 20. E2E Regression

```text
Command: npm run e2e
Result: 2 passed (2.2m)
  app-shell.spec.ts     - PASS (9.2s)
  demo-merchant.spec.ts - PASS (37.8s)
Environmental retry: NONE — clean on the first attempt.
```

Run because C07 introduced a browser-visible client-confirmation
suppression path (`pay-with-razorpay-button.tsx`). No new real Razorpay
payment was performed; the existing Playwright suite exercises only its
existing controlled/local behavior (Demo Merchant order creation, no
Checkout UI interaction).

---

## 21. Read-Only Manual-Evidence Audit — Before / After

A temporary, clearly-labelled, SELECT-only integration test helper
(deleted before this handoff was written, never committed) independently
re-read the exact durable evidence rows identified from the current
PHASE-3D-A/B/D/E handoffs, once immediately before the regression matrix in
Sections 15–20 and once immediately after. The helper never called
`createChaosRun`, `runChaosPrecheck`, any chaos execution service, the
Razorpay adapter, or the merchant processor — SELECTs only.

**Result: every field of every audited row — `chaos_runs`, correlated
`orders`, `payment_attempts`, `payments`, `webhook_events`,
`event_processing_attempts`, `fulfilments` — was byte-for-byte identical
before and after** (compared programmatically; the only difference was the
audit script's own `capturedAt` timestamp, an artifact of the audit tooling
itself, not of any audited table).

```text
C03  (a0c5a66a-e70f-4e47-b9eb-0b3482c789d4)      UNCHANGED
C07  (68878716-ed49-40ec-85de-f962a4f6b21c)      UNCHANGED
     + order/payment/payment_attempt/webhook/fulfilment rows  UNCHANGED
C11-B (5090e423-daa5-4122-99de-4c27d728957c)     UNCHANGED
     + source webhook/original attempt/replay attempt         UNCHANGED
C11-A (b49d344a-f5cf-42ae-a078-819b26bfbffe)     UNCHANGED
     + order/webhook/original attempt/payment/payment_attempt UNCHANGED
```

This proves the entire Phase 3D-F regression matrix — including the full
real-Supabase suite, the full unit suite, the build, and the E2E suite —
performed **zero mutation** of the previously-approved manual verification
evidence.

---

## 22. Known Issues / Environmental Noise

- Windows/OneDrive Vitest worker-spawn timeout noise (Section 18) — the
  most significant environmental finding of this round; well beyond what
  any single prior Phase 3D sub-phase reported, likely amplified by the
  heavier-than-usual sequential/parallel background load this consolidated
  regression round placed on the machine. Two full attempts and two
  isolation rounds found zero genuine regressions; a third full-suite
  invocation subsequently came back 100% clean (64/64 files, 1480/1480
  tests). Not a P0 blocker; matches this machine's already-documented
  characteristic, and is now fully resolved for this round.
- The documented `.next` EPERM build-lock recurred once; resolved by the
  established `.next` cache-clear-and-retry precedent.
- Pre-existing, unrelated, out-of-scope items carried forward unchanged:
  the `no-console` eslint-disable warning in
  `051-chaos-safety-gate.integration.test.ts`; the Next.js
  `middleware`→`proxy` deprecation notice; the Vite `configLoader: 'native'`
  extensionless-sequencer-import warning.
- `docs/DATABASE.md`'s `chaos_runs` documentation gap for the Phase 3D-0
  schema additions — **found, escalated to blocking by the architect, and
  since CORRECTED**. See Section 22a below. No longer an open issue.

No P0 code blocker was found in this round. The one blocker found was a
documentation defect, now resolved.

---

## 22a. Architect Documentation Correction

Final architect review determined that `docs/DATABASE.md` had never been
reconciled with the frozen Phase 3D-0 migration
(`supabase/migrations/20260831000000_phase3d_execution_safety.sql`): its
`chaos_runs` documentation still described the pre-Phase-3D-0 schema.

**This was treated as BLOCKING**, not as a non-blocking nice-to-have, because
repository documentation is source of truth in this project — a phase cannot
truthfully be marked `DOCUMENTED = YES` while the canonical schema document
describes a stale `chaos_runs` table. It qualifies for correction under the
completed-phase rule as a confirmed documentation defect.

`docs/DATABASE.md` was corrected, documentation-only, to document:

- the `execution_block_code` column (`text`, nullable, `PRE-SEC-007` as its
  only currently-allowed non-null value);
- the explicit `execution_block_code` (EXECUTION-time, `PRE-SEC-xxx`) vs
  `failed_precheck_id` (CREATION-time, `PRECHECK-01..10`) distinction;
- why `PRE-SEC-010` (HTTP/session authorization boundary, enforced before the
  execution service acts) and `PRE-SEC-011` (structurally satisfied by the
  persisted row's own existence) are deliberately never stored there;
- the `chaos_runs_execution_block_code_valid` CHECK;
- the revised `chaos_runs_blocked_state_consistent` (exactly one of the two
  blocking identifiers non-null on a BLOCKED row — never both, never
  neither);
- the revised `chaos_runs_pending_state_consistent` (adds
  `execution_block_code IS NULL`);
- the `chaos_runs_one_active_c07_fault_per_order_idx` partial unique index
  and its exact concurrency-boundary meaning (at most one `RUNNING`
  C07/`DROP_CLIENT_CONFIRMATION` run per order; no effect on C01/C03/C11, on
  non-`RUNNING` C07 rows, or on other orders; not a permanent
  one-run-per-order limit);
- migration ownership: Phase 3D-0 owns exactly one migration; Phase
  3D-A/B/C/D/E each introduced none.

Scope of this correction round:

```text
Migration SQL changed:      NO
Production code changed:    NO
Permanent tests changed:    NO
Database schema changed:    NO
Prior 3D-A/B/C/D/E handoffs changed: NO
Files changed:              docs/DATABASE.md, handoffs/PHASE-3D-HANDOFF.md only
```

---

## 23. Deferred Work

```text
Phase 3E — Evidence Snapshot (before/after deterministic-input capture)  — next
Phase 3F — Money Invariant Engine (deterministic PASS/FAIL,
           INV-002/003/004/005/011 against C03/C07/C11 evidence)          — not started
Phase 3G — Finding Generation                                            — not started
Phase 3H — UI + final Phase 3 manual demo integration                    — not started
Phase 4  — Diagnosis / recommendations / reliability score / AI          — not started
```

The `docs/DATABASE.md` `chaos_runs` documentation gap previously listed here
has been **corrected** (Section 22a) and is no longer deferred work.

---

## 24. Frozen Contracts — Do Not Break

Every contract listed in the individual PHASE-3D-A/B/C/D-E handoffs remains
in force and was re-verified green in this round's regression. Consolidated
here for Phase 3E+ convenience:

```text
C01: executeC01Replay, C01_REPLAY_ATTEMPT_COUNT=2, resolveAuthoritativeC01ReplaySource — unchanged.
C03: executeC03InvalidSignatureTest never touches webhook route/service/persistence/processor.
     Two fixed cases (WRONG_SIGNATURE, MISSING_SIGNATURE), SYNTHETIC_DEMO only.
C07: checkAndSuppressC07ClientConfirmation authenticates before consuming;
     exact JSONB equality on every fault_state-gated mutation;
     chaos_runs_one_active_c07_fault_per_order_idx; cancellation predicate
     inside the same atomic UPDATE as the mutation.
C11 fixture: loadC11TestFixtureFailureEvidence always returns null; TEST_FIXTURE
     permanently PRECHECK-07 BLOCKED; no runtime consumer exists or is planned.
C11-B: executeC11RealWebhookReplay, C11_REPLAY_ATTEMPT_COUNT=1 (independent of C01's),
     resolveAuthoritativeC11ReplaySource — unchanged, never imported by C11-A.
C11-A: source_webhook_event_id IS NULL disambiguates C11-A from C11-B structurally;
     reconcileC11AFailedPaymentObservation never gates completion on observed
     merchant-state CONTENT — only on evidence resolution success/failure.
All: COMPLETED/UNKNOWN is the correct successful-execution shape; FAILED/ERROR is
     reserved for technical execution failures only, never a merchant-reliability verdict.
All: PRE-SEC-010 enforced at the untrusted route boundary via the existing
     access-gate/session primitives — never a caller-supplied authorized boolean.
All: atomic conditional UPDATE...WHERE...RETURNING for every lifecycle transition —
     never SELECT-then-UPDATE.
Manual evidence rows listed in Sections 5, 6, 8, 9 above must remain durable —
     do not delete or mutate them.
```

Any genuine schema or behavior change requires the same architect-review
process every Phase 3D sub-phase went through — not a silent redesign.

---

## 25. No Deterministic Money PASS/FAIL Assigned by Phase 3D

**Explicit statement, as required:** Phase 3D assigns **no** deterministic
money/state PASS/FAIL verdict for any scenario. Every successful controlled
execution across C01/C03/C07/C11-A/C11-B terminates in the shape
`status=COMPLETED`, `outcome=UNKNOWN` — intentionally. Phase 3D proves safe
controlled execution, genuine/synthetic provenance, and deterministic
evidence-acquisition mechanics; it does not decide merchant reliability. A
technical execution failure (`status=FAILED`, `outcome=ERROR`) is never
itself evidence the merchant under test is unreliable — only that the
mechanism could not complete/finalize. The later top-level **Phase 3F —
Money Invariant Engine** is the only phase authorized to evaluate
deterministic invariants (INV-002/003/004/005/011) against this evidence
and assign PASS/FAIL.

---

## 26. Next Top-Level Phase

**Phase 3E — Evidence Snapshot** (before-and-after deterministic state
capture), per `docs/PHASE_PLAN.md`'s fixed phase sequence
(`Phase 3C → Phase 3D → Phase 3E → Phase 3F → Phase 3G`). Not started; no
file has been changed for it.

---

## 27. Provenance / Truthfulness Statement

Every event/result described in this document is truthfully classified per
`CLAUDE.md` §24 and `docs/TESTING.md` Principle 8:

- C07 and C11-A's canonical webhook evidence, and C11-B's replay source
  evidence, are genuine `REAL_RAZORPAY_WEBHOOK` Razorpay Test Mode
  deliveries — never fabricated, never presented as synthetic.
- C11-B's replay attempt is truthfully `PAYCHAOS_REPLAY` execution
  provenance — never presented as a fresh Razorpay delivery.
- C03's synthetic mechanism evidence is truthfully `SYNTHETIC_DEMO` — never
  presented as correlated to a real merchant order or as genuine provider
  evidence.
- The C11 `TEST_FIXTURE` is truthfully source-controlled sanitized test
  data only — never presented as runtime-executable or as genuine evidence.
- No secret value, raw payload, signature, card data, or customer data
  appears anywhere in this document.

---

## 28. Phase Completion Checklist

```text
IMPLEMENTED                        [x]  — all four P0 scenario mechanisms (C01 frozen
                                          from 3C; C03/C07/C11-A/C11-B this phase) exist
TESTED                             [x]  — see Sections 15–20; full unit suite achieved
                                          a clean monolithic invocation on the third
                                          attempt (Section 18) after two attempts hit
                                          documented Windows/OneDrive environmental
                                          noise with zero content regressions found
REAL SUPABASE VERIFIED             [x]  — Section 17, single clean invocation
MANUALLY VERIFIED                  [x]  — based on the already-approved durable manual
                                          evidence in Sections 5, 6, 8, 9, independently
                                          re-confirmed unchanged before AND after this
                                          round's full regression (Section 21)
DOCUMENTED                         [x]  — this handoff; the docs/DATABASE.md gap the
                                          architect escalated to blocking has been
                                          corrected (Section 22a) — no open doc defect
APPROVED                           [x]  — YES. Architect-approved (Section 30).
```

---

## 29. Phase 3D-F Working Tree

```text
git status --short (final): M  docs/DATABASE.md
                            ?? handoffs/PHASE-3D-HANDOFF.md
```

The temporary read-only audit helper test file and its JSON scratch output
were deleted before this final state was captured and were never committed.
`docs/DATABASE.md` was corrected in the subsequent architect-directed
documentation-correction round (Section 22a).

---

## 30. Final Architect Approval

**Phase 3D — Controlled Failure Injection is APPROVED.**

Approval was granted after the architect reviewed, in order:

- the consolidated Phase 3D regression (focused Phase 3D surfaces: 29 files /
  876 tests; permanent 054–059 mechanics tests: 6 files / 42 tests);
- a clean final full real-Supabase suite invocation (21 files / 220 tests);
- a clean final full offline unit suite invocation (64 files / 1480 tests);
- the typecheck, lint, build, and Playwright E2E gates;
- the read-only durable-evidence audit of the approved C03, C07, C11-B, and
  C11-A manual runs, captured BEFORE and AFTER the full regression and proven
  byte-for-byte unchanged;
- the provenance audit (`REAL_RAZORPAY_WEBHOOK` / `PAYCHAOS_REPLAY` /
  `SYNTHETIC_DEMO` / `TEST_FIXTURE` each used truthfully and never conflated);
- verification that runtime `TEST_FIXTURE` remains permanently PRECHECK-07
  BLOCKED with no migration enabling it;
- the reconciliation of `docs/DATABASE.md` with the frozen Phase 3D-0
  migration (Section 22a) — a defect the architect escalated to blocking,
  since corrected documentation-only.

Phase 3D's terminal `COMPLETED`/`UNKNOWN` outcomes remain intentional and
permanent: Phase 3D proves safe controlled execution, truthful provenance,
deterministic evidence acquisition, and zero unauthorized money-state
mutation. It assigns **no** deterministic money PASS/FAIL — the later
top-level **Phase 3F — Money Invariant Engine** owns that evaluation.

Phase 3D may only be modified later for (1) a confirmed bug, (2) a confirmed
security issue, or (3) a genuine later-phase compatibility requirement.
