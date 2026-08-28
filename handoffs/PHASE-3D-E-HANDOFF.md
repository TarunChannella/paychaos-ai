# PHASE 3D-E HANDOFF — C11-A Genuine Razorpay Test Mode Failed-Payment Observation

**Branch:** `phase-3-chaos-engine`
**Frozen baseline HEAD (start of this phase):** `e8808eaf7a80d04d4ff5367444ecb0ab2812a60a`
**This handoff describes uncommitted working-tree changes** — nothing in this
phase has been committed or pushed.

---

## 1. Objective

Implement the production observation lifecycle for **C11 — Mechanism A**
("Failed Payment Must Never Mark Order Paid", genuine Razorpay Test Mode
event): create a C11-A run through the frozen `createChaosRun` path, start
it as a pure observation, allow the developer to later perform a genuine
Razorpay Test Mode failure manually, observe the genuine `payment.failed`
webhook through the existing frozen webhook/payment processing, reconcile
the authoritative evidence back to the run, complete it `COMPLETED`/
`UNKNOWN`, and allow explicit cancellation.

**This task did NOT perform the manual Razorpay payment.** That remains a
separate, later MANUAL VERIFICATION gate.

---

## 2. Frozen Baseline

Phase 3A / 3B / 3C / 3D-0 / 3D-A / 3D-B / 3D-C / 3D-D remain **FROZEN**.
Nothing in those phases' behavior was modified. C11-B
(`executeC11RealWebhookReplay`, `resolveAuthoritativeC11ReplaySource`,
`C11_REPLAY_ATTEMPT_COUNT`, the `execute-c11-b` route) is **byte-for-byte
unchanged** — see Section 8 below for the proof.

---

## 3. Files Changed

### New

- `lib/chaos/c11-observation-repository.ts` — read-only authoritative
  evidence resolution + read-only merchant-state collection for C11-A.
- `app/api/chaos/runs/[runId]/start-c11-a/route.ts`
- `app/api/chaos/runs/[runId]/reconcile-c11-a/route.ts`
- `app/api/chaos/runs/[runId]/cancel-c11-a/route.ts`
- `tests/unit/chaos/c11-observation-repository.test.ts`
- `tests/unit/api/chaos-c11-a-routes.test.ts`
- `tests/unit/chaos/c11-a-static-guard.test.ts`
- `tests/unit/supabase/059-chaos-c11-a-observation-provenance-guard.test.ts`
- `tests/integration/supabase/059-chaos-c11-a-observation.integration.test.ts`
- `handoffs/PHASE-3D-E-HANDOFF.md` (this file)

### Modified (additive only)

- `lib/chaos/run-repository.ts` — four new narrow C11-A lifecycle functions
  appended (`startPendingC11ARunAtomically`,
  `blockPendingC11ARunForPreSec007`, `completeRunningC11ARunWithEvidence`,
  `failRunningC11ARunExecution`). Every Phase 3B/3C/3D-A/3D-B/3D-D function
  is byte-for-byte unchanged.
- `lib/chaos/c11-execution-service.ts` — C11-B's entire original module
  (doc comment, imports, `C11_REPLAY_ATTEMPT_COUNT`,
  `executeC11RealWebhookReplay`, and its private helpers) is preserved
  verbatim at the top of the file. A clearly marked
  `// PHASE 3D-E — C11-A ...` section is appended below it with the three
  new exported functions (`startC11AFailureObservation`,
  `reconcileC11AFailedPaymentObservation`, `cancelRunningC11AObservation`)
  and their private helpers.
- `tests/unit/chaos/run-repository.test.ts` — added C11-A lifecycle test
  blocks; updated the pre-existing "exposes exactly the N approved
  functions" guard test from eighteen to twenty-two (the four new C11-A
  functions are additive, approved, narrow lifecycle transitions — the same
  category the test already enumerates for C01/C03/C07/C11-B).
- `tests/unit/chaos/c11-execution-service.test.ts` — added mocks for the
  four new run-repository C11-A exports,
  `lib/chaos/c11-observation-repository.ts`, `lib/chaos/repository.ts`,
  `lib/config/razorpay-env.ts`, `lib/config/razorpay-webhook-env.ts`, and
  three new C11-A describe blocks. Every existing C11-B test is untouched
  and still passes unmodified.

### Architect Correction Round 1 (this update)

Narrow follow-up correcting the durable technical-failure reporting defect
described in Section 9a below. Files touched by this correction round only:

- `lib/chaos/c11-execution-service.ts` — added `isValidFailedC11AShape`,
  `persistAndVerifyC11ATechnicalFailure`, the `FAILURE_PERSISTENCE_FAILED`
  result variant, and rewired all three technical-failure paths in
  `reconcileC11AFailedPaymentObservation` through the new verified helper.
- `app/api/chaos/runs/[runId]/reconcile-c11-a/route.ts` — added the
  `FAILURE_PERSISTENCE_FAILED` -> safe generic 500 mapping.
- `tests/unit/chaos/c11-execution-service.test.ts` — corrected the three
  affected tests to use a durably-valid `FAILED`/`ERROR` fixture, fixed one
  pre-existing test whose title claimed "failure persistence failure never
  claims durable FAILED" while its assertion actually asserted the opposite
  (a direct instance of the defect), and added the full required matrix of
  throw/null/wrong-shape persistence-failure tests.
- `tests/unit/api/chaos-c11-a-routes.test.ts` — added the
  `FAILURE_PERSISTENCE_FAILED` route-mapping test.
- `handoffs/PHASE-3D-E-HANDOFF.md` — this update.

No other file was touched by this correction round.
`lib/chaos/run-repository.ts`, `lib/chaos/c11-observation-repository.ts`,
`tests/unit/chaos/c11-a-static-guard.test.ts`, and the 059 tests are
byte-for-byte unchanged — the static guard's existing assertions already
covered the corrected code without modification, and no new forbidden
pattern was introduced.

### Database Changes

**NONE.** No migration. No schema change. `chaos_runs` already had every
column C11-A needs (`payment_attempt_id`/`payment_id`/
`source_webhook_event_id` all nullable, `data_classification`,
`fault_type` nullable) from Phase 3B/3D-0.

---

## 4. C11-A Pure-Observation Architecture

C11-A has **no fault primitive** and performs:

- no Checkout interception;
- no client-confirmation suppression;
- no replay;
- no TEST_FIXTURE runtime path;
- no synthetic/forged webhook;
- no new payment-processing implementation.

Its only writes are to `chaos_runs`, through the four narrow C11-A-specific
`lib/chaos/run-repository.ts` lifecycle functions.
Merchant/payment/webhook/`event_processing_attempts` state is **read-only**
from C11-A code, exclusively via
`lib/chaos/c11-observation-repository.ts`'s two functions
(`resolveC11AFailureObservationEvidence`, `readC11AObservedMerchantState`) —
neither performs an `insert`/`update`/`delete`/`upsert` anywhere (statically
enforced by `tests/unit/chaos/c11-a-static-guard.test.ts`).

The real, existing Razorpay Test Mode Checkout + public webhook + frozen
`process_webhook_payment_event` processor remain the **sole** authority for
all merchant/payment state. `verifyCheckoutAction`,
`verifyCheckoutAndPersistPayment`, `app/api/webhooks/razorpay/route.ts`,
`lib/webhooks/service.ts`, `lib/events/processor.ts`,
`lib/chaos/safety-gate.ts`, `lib/chaos/run-service.ts`,
`lib/chaos/registry.ts`, `lib/chaos/types.ts`, the Phase 3D-C fixture files,
and all migrations are **unmodified**.

---

## 5. C11-A vs C11-B Run Disambiguation

Both mechanisms produce `chaos_runs` rows with `scenario_id = C11`,
`fault_type = NULL`, `data_classification = RECORDED_TEST_EVIDENCE`. Every
new C11-A lifecycle function distinguishes them using persisted evidence
shape, not a new column:

| Field                     | C11-A eligibility | C11-B PENDING/RUNNING shape                                                                       |
| ------------------------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| `order_id`                | `IS NOT NULL`     | non-null                                                                                          |
| `source_webhook_event_id` | `IS NULL`         | always non-null (Mechanism B never persists PENDING without it)                                   |
| `payment_attempt_id`      | `IS NULL`         | always non-null (Mechanism B requires `webhookEvent.payment_attempt_id` truthy before persisting) |
| `payment_id`              | `IS NULL`         | usually non-null                                                                                  |

`startPendingC11ARunAtomically`/`blockPendingC11ARunForPreSec007`/
`completeRunningC11ARunWithEvidence`/`failRunningC11ARunExecution` all
require `source_webhook_event_id IS NULL` (or, for completion, it is the
precondition the function's own `UPDATE` requires and then sets) —
structurally, a genuine C11-B row can never satisfy any C11-A lifecycle
`WHERE` clause. This is proven at the mocked-Supabase unit level
(`tests/unit/chaos/run-repository.test.ts`, `tests/unit/chaos/c11-execution-service.test.ts`)
and at the real-Postgres level (`tests/integration/supabase/059-...`, which
constructs a genuinely C11-B-shaped PENDING row and proves
`startPendingC11ARunAtomically` returns `null` for it).

---

## 6. PRE-SEC-007 Handling

`startC11AFailureObservation` checks `getRazorpayEnv()` and
`getRazorpayWebhookSecret()` — the same frozen configuration helpers C07's
`armC07ClientConfirmationDrop` uses — **before** claiming `RUNNING`. On
failure, the run transitions `PENDING → COMPLETED/BLOCKED` with
`execution_block_code = 'PRE-SEC-007'` via the new
`blockPendingC11ARunForPreSec007` (mirrors `blockPendingC07RunForPreSec007`
exactly). No new `execution_block_code` value, no migration.

---

## 7. Start Lifecycle

`startC11AFailureObservation(chaosRunId)`:

1. load run, verify exact C11-A PENDING shape;
2. re-read the trusted order baseline (`getOrderBaseline` +
   `isFreshBaseline`) immediately before claiming `RUNNING` — if no longer
   fresh, `NOT_STARTABLE/BASELINE_NOT_FRESH`, no mutation, no retroactive
   PRECHECK result;
3. PRE-SEC-007 check (Section 6);
4. atomically claim `PENDING → RUNNING` via `startPendingC11ARunAtomically`
   (single conditional `UPDATE ... WHERE ... RETURNING`, same idiom as
   every other lifecycle transition in this codebase);
5. independently validate the exact returned durable row shape before ever
   reporting `OBSERVING`.

A concurrent second start call loses the atomic claim and returns
`NOT_STARTABLE/ALREADY_STARTED_OR_NOT_PENDING`.

---

## 8. Authoritative Observation (`lib/chaos/c11-observation-repository.ts`)

`resolveC11AFailureObservationEvidence(orderId, runStartedAt)` requires, in
order:

1. **Canonical webhook event** — exactly ONE `webhook_events` row
   correlated (via `payment_attempt_id`) to `orderId`'s payment attempts,
   with `event_type = payment.failed`, `source_kind =
REAL_RAZORPAY_WEBHOOK`, `signature_verified = true`,
   `processing_status = PROCESSED`, `payment_attempt_id`/`payment_id` both
   non-null, and `received_at >= runStartedAt` (the timestamp bound —
   Section 5 of the architect spec, distinguishes a genuinely NEW failure
   from a stale pre-existing one).
2. **Original processing attempt** — exactly ONE `event_processing_attempts`
   row: `source_kind = REAL_RAZORPAY_WEBHOOK`, `status = SUCCEEDED`,
   `is_duplicate_delivery = false`, `chaos_run_id IS NULL`, correlated to
   the exact webhook event's own `payment_attempt_id`/`payment_id`.
3. **Normalized event envelope** — `sourceKind = REAL_RAZORPAY_WEBHOOK`,
   `eventType = payment.failed`, `kind = payment.failed`,
   `razorpayPaymentStatus = failed`.

Zero candidates at step 1 or 2, or an envelope validation failure at step
3, resolves `NOT_YET_CONVERGED`. **More than one** candidate at step 1 or 2
resolves a **distinct** `AMBIGUOUS` outcome — fail closed, never
"latest"/"first". A genuine DB read failure throws
`C11ObservationRepositoryError`.

**Why this does not reuse `resolveAuthoritativeC11ReplaySource`:** that
shared C11-B resolver collapses "zero candidates" and "more than one
candidate" into the same `null` return. C11-A's spec requires the
_opposite_ — `NOT_YET_CONVERGED` (keep waiting) must never be conflated
with `AMBIGUOUS` (terminalize `FAILED`/`ERROR`). Reusing it as-is would
erase that required distinction, so this module implements the same checks
narrowly instead, per the architect's own documented fallback ("Otherwise
implement the same validation narrowly inside the observation
repository"). `resolveAuthoritativeC11ReplaySource` itself is **never
imported** by this module (statically enforced) and is completely
unmodified.

`readC11AObservedMerchantState(orderId, paymentAttemptId, paymentId)` reads
`orders.payment_status`/`business_status`, `payment_attempts.status`/
`order_id`, `payments.razorpay_payment_status`/`captured_at`/`failed_at`,
and the order's fulfilment count — all `SELECT`-only, never gating on
content (see Section 9).

Timestamp bound: enforced (`received_at >= runStartedAt`), proven at the
real-Postgres level in `059-...integration.test.ts` (a stale event received
before the run started resolves `NOT_YET_CONVERGED`).

---

## 9. Reconciliation

`reconcileC11AFailedPaymentObservation(chaosRunId)` is a **stateless CHECK
NOW** — no sleep, no internal polling loop, no timer, no held request, no
background job. Safe to call repeatedly.

- **No evidence yet** → `NOT_YET_CONVERGED`, **zero mutation** (proven by a
  dedicated "repeated no-evidence calls" unit test).
- **Authoritative evidence resolves uniquely** → collect observed merchant
  state read-only, then `RUNNING → COMPLETED`/`outcome = UNKNOWN`
  (`completeRunningC11ARunWithEvidence` stores
  `payment_attempt_id`/`payment_id`/`source_webhook_event_id`), then
  independently re-validate the exact returned durable row before ever
  reporting `COMPLETED`.
- **Unsafe observed merchant-state values (PAID/FULFILLED/captured/
  fulfilment_count > 0) DO NOT gate completion.** This is the single most
  important architectural point in this phase (the "IMPORTANT ARCHITECT
  REFINEMENT"): `readC11AObservedMerchantState` is void-returning and its
  success is the only thing that matters to the caller — its _content_ is
  never inspected by `reconcileC11AFailedPaymentObservation`. A dedicated
  unit test (`"merchant state observed as unexpectedly PAID/FULFILLED/
captured/fulfilment>0 STILL completes COMPLETED/UNKNOWN"`) proves this by
  mocking the read to succeed with exactly those "unsafe" values and
  asserting the result is still `COMPLETED`. Phase 3D gathers evidence;
  Phase 3F alone judges PASS/FAIL via INV-003/INV-004/INV-011.
- **Ambiguous evidence** or a **genuine technical read failure** →
  attempts `RUNNING → FAILED`/`ERROR`, but the service reports `FAILED`
  **only after independently verifying** the durable `chaos_runs` row
  actually reached that exact shape (architect correction round 1 — see
  Section 9a below). Durable persisted state is authoritative in this
  codebase; a service result must never claim `FAILED` merely because the
  failure-update function was called and did not throw.
- **Completion persistence failure** (`null` return or wrong shape) →
  `COMPLETION_PERSISTENCE_FAILED`, run stays `RUNNING`, safely retryable.

### 9a. Architect Correction Round 1 — Durable Technical-Failure State Is Authoritative

**Original defect:** the first implementation of the three technical
reconciliation-failure paths (evidence-resolution throw, `AMBIGUOUS`
evidence, post-state-read throw) called
`failRunningC11ARunExecution(...).catch(() => {})` and then _unconditionally_
returned `{ kind: "FAILED", ... }` — never checking whether the write
actually succeeded, returned a matching row, or reached the exact expected
shape. A thrown persistence error, a `null` return (no matching row — e.g.
the run was concurrently cancelled/mutated), or an unexpected returned shape
would all still be reported to the caller as a confirmed, durable `FAILED`
run. That is a false claim of persisted state and directly violates this
project's "verified persisted state is authoritative" principle.

**Correction:** added `isValidFailedC11AShape(row, chaosRunId,
expectedOrderId)` — an independent validator requiring `scenario_id="C11"`,
`fault_type=null`, `data_classification="RECORDED_TEST_EVIDENCE"`,
`order_id=expectedOrderId`, `status="FAILED"`, `outcome="ERROR"`,
`started_at`/`completed_at` both non-null, `failed_precheck_id=null`,
`execution_block_code=null`, `source_webhook_event_id=null`,
`payment_attempt_id=null`, `payment_id=null` (C11-A only ever attaches
evidence FKs via `completeRunningC11ARunWithEvidence` on a successful
`COMPLETED` reconciliation — a technical-failure path never reaches that),
and `error_message_redacted` non-null — mirroring the same
independently-verify-the-durable-row discipline every other C11-A terminal
transition (`OBSERVING`, `BLOCKED_PRE_SEC_007`, `COMPLETED`, `CANCELLED`)
already used. Added a single choke-point helper,
`persistAndVerifyC11ATechnicalFailure(chaosRunId, expectedOrderId,
safeReason)`, that calls `failRunningC11ARunExecution`, catches a thrown
persistence error, and returns `true` only when the returned row passes
`isValidFailedC11AShape` — every technical-failure path in
`reconcileC11AFailedPaymentObservation` now routes through it. Added a new
result variant, `{ kind: "FAILURE_PERSISTENCE_FAILED", chaosRunId }`, which
is returned instead of `FAILED` whenever persistence could not be durably
verified. `app/api/chaos/runs/[runId]/reconcile-c11-a/route.ts` maps
`FAILURE_PERSISTENCE_FAILED` to the same generic safe 500 as every other
internal-error outcome — it never claims `FAILED`/`COMPLETED`, never exposes
`reasonCategory`, the persisted reason text, or any raw error detail.
`NOT_YET_CONVERGED` semantics, the unsafe-merchant-state-does-not-gate-
completion refinement, and cancellation's own pre-existing durable-shape
verification (`isValidCancelledC11AShape`/`CANCEL_PERSISTENCE_FAILED`, left
untouched) are all unchanged by this correction.

Evidence FKs stored on completion: `payment_attempt_id`, `payment_id`,
`source_webhook_event_id` — all three, exactly the resolved values, never
fabricated, never caller-supplied.

---

## 10. Cancellation

`cancelRunningC11AObservation(chaosRunId)`: explicit,
operator-initiated-only. `RUNNING → FAILED`/`ERROR` with the fixed safe
reason `"The C11-A observation was explicitly cancelled by the operator."`
Reuses `failRunningC11ARunExecution` (same repository primitive a genuine
technical reconciliation failure uses) — the distinct fixed reason string
and this function's own eligibility/logging keep the two conceptually and
observably separate. Never deletes the run. Never mutates merchant/
payment/webhook evidence (statically proven — the observation repository
performs zero writes, and this function never touches any table besides
`chaos_runs`). Never converts to `BLOCKED` after `RUNNING`. A `PENDING` or
already-terminal run cannot be cancelled; a C11-B-shaped run cannot be
cancelled through this helper (same `source_webhook_event_id IS NULL`
disambiguation as every other C11-A lifecycle function).

---

## 11. Routes

Three narrow routes, each mirroring the frozen C07/C11-B route pattern
exactly: UUID path validation, `isKnownCrossOriginRequest` same-origin
defense, access-gate/session check (PRE-SEC-010) before ever calling the
service, safe HTTP status mapping (never leaks `reasonCategory` or raw
error text), `logEvent`-only logging, **no request body ever read**
(statically proven).

- `POST /api/chaos/runs/{runId}/start-c11-a` → `startC11AFailureObservation`
- `POST /api/chaos/runs/{runId}/reconcile-c11-a` →
  `reconcileC11AFailedPaymentObservation`
- `POST /api/chaos/runs/{runId}/cancel-c11-a` →
  `cancelRunningC11AObservation`

---

## 12. Zero Merchant-State Mutation / Zero Replay / Zero TEST_FIXTURE Proof

`tests/unit/chaos/c11-a-static-guard.test.ts` statically proves, over the
functional (comment-stripped) source of the observation repository, the
three new routes, and (scoped to the C11-A section only, via a marker
comment) the execution service:

- no `.insert(`/`.update(`/`.delete(`/`.upsert(` anywhere in the
  observation repository;
- no `insertReplayProcessingAttempt`, no `processMerchantWebhookEvent`, no
  `verifyCheckoutAction`/`verifyCheckoutAndPersistPayment`;
- no `fetch(`/`axios`/`https?.request(`/`new Razorpay(`/
  `require("razorpay")`;
- no `record_webhook_duplicate_delivery`;
- no `targetUrl`/`targetHost`/`url:`/`host:` caller-input surface;
- no `TEST_FIXTURE`/the Phase 3D-C fixture path;
- no route ever calls `.from(...)` directly (all data access is delegated
  through the service/repository layers), and no route reads a request
  body.

---

## 13. Static Provenance Guard (059)

`tests/unit/supabase/059-chaos-c11-a-observation-provenance-guard.test.ts`
statically proves the new integration test:

- uses `resolveC11AFailureObservationEvidence`/
  `readC11AObservedMerchantState`/`startPendingC11ARunAtomically` (the
  functions under test);
- classifies every `chaos_runs` row it creates `SYNTHETIC_DEMO` — never
  writes `RECORDED_TEST_EVIDENCE` as a value;
- uses only the repository-level `createPendingChaosRun` — never
  `runChaosPrecheck`/`createChaosRun`/`startC11AFailureObservation`/
  `reconcileC11AFailedPaymentObservation`/`cancelRunningC11AObservation`;
- never imports/calls `executeC11RealWebhookReplay`/`executeC01Replay` or
  either production execution service;
- never calls `processMerchantWebhookEvent`/`insertReplayProcessingAttempt`;
- uses the real, unmodified `normalizeRazorpayEvent`;
- documents the three-layer provenance distinction;
- performs child-before-parent cleanup and independently proves zero
  remaining rows for all six owned tables.

---

## 14. Tests Performed (exact commands + results)

### A. Focused C11-A unit tests

```
npx vitest run tests/unit/chaos/c11-observation-repository.test.ts
```

21 passed / 21.

```
npx vitest run tests/unit/chaos/run-repository.test.ts
```

64 passed / 64 (includes the updated "exactly twenty-two functions" guard
and 4 new C11-A lifecycle `describe` blocks).

```
npx vitest run tests/unit/chaos/c11-execution-service.test.ts
```

67 passed / 67 (43 pre-existing C11-B tests + 24 new C11-A tests, all
green).

```
npx vitest run tests/unit/api/chaos-c11-a-routes.test.ts
```

54 passed / 54.

```
npx vitest run tests/unit/chaos/c11-a-static-guard.test.ts
```

20 passed / 20.

### B. C11-B regression

```
npx vitest run tests/unit/chaos/c11-execution-service.test.ts tests/unit/chaos/c11-runtime-static-guard.test.ts tests/unit/api/chaos-c11-route.test.ts tests/unit/chaos/replay-repository.test.ts tests/unit/chaos/c07-execution-service.test.ts tests/unit/api/chaos-c07-routes.test.ts
```

5 files / 163 tests passed / 163 in this combined run. Individually
reconfirmed: `c11-runtime-static-guard.test.ts` 18/18,
`chaos-c11-route.test.ts` 18/18, `c11-execution-service.test.ts` 67/67
(43 pre-existing C11-B + 24 new C11-A).

### C. C07 regression

```
npx vitest run tests/unit/chaos/c07-execution-service.test.ts tests/unit/chaos/c07-repository.test.ts tests/unit/api/chaos-c07-routes.test.ts
```

`c07-repository.test.ts` 32/32 (individually reconfirmed); the other two
files reconfirmed green above and via the earlier full batch run and an
isolated timeout retry (chaos-c07-routes.test.ts, Section 16).

### D. Frozen C11 TEST_FIXTURE PRECHECK-07 regression

```
npx vitest run tests/unit/chaos/safety-gate.test.ts
```

47 passed / 47.

### E. New 059 real-Supabase mechanics test

```
npx vitest run --config vitest.integration.config.ts tests/integration/supabase/059-chaos-c11-a-observation.integration.test.ts
```

7 passed / 7, against the real configured Supabase project. Synthetic
provenance classification: every `chaos_runs` row created is
`SYNTHETIC_DEMO`; every canonical `webhook_events` row is a documented
synthetic compatibility row; child-before-parent cleanup verified zero
remaining rows across all six owned tables.

### F. Full real Supabase integration suite

```
npx vitest run --config vitest.integration.config.ts
```

**20 files passed, 219 tests passed / 219** (includes `05-final-state`
end-state leak verification).

### G. Full unit suite

```
npx vitest run
```

First invocation: 9 files / 11 tests failed, every single one with
`Error: Test timed out in 5000ms` (Vitest worker-spawn timeout, the
documented Windows/OneDrive environmental issue class — never a real
assertion failure). Isolated and retried standalone:

```
npx vitest run tests/unit/config/env-files.test.ts tests/unit/api/chaos-c07-routes.test.ts tests/unit/api/chaos-c11-a-routes.test.ts tests/unit/api/chaos-c11-route.test.ts tests/unit/api/webhooks-razorpay-route-modified-body.test.ts tests/unit/api/webhooks-razorpay-route-signature-rejection.test.ts
```

→ 130 passed / 130.

Second full invocation (retry): 3 files / 4 tests failed, again all
`Test timed out in 5000ms`, on a _different_ set of pre-existing frozen
files unrelated to this task (`instrumentation.test.ts`,
`middleware.test.ts`, `demo-merchant/service.test.ts`). Isolated and
retried standalone:

```
npx vitest run tests/unit/instrumentation.test.ts tests/unit/middleware.test.ts tests/unit/demo-merchant/service.test.ts
```

→ 73 passed / 73.

**Net result: 1467/1467 unit tests pass** — every failure across both full
runs was environmental worker-spawn timeout noise (confirmed by the
`Test timed out in 5000ms` error message on every single failing test, and
by every affected file passing 100% when rerun in isolation), never a
genuine logic failure, and never concentrated on this task's own new
files beyond the ordinary noise distribution.

### H. Typecheck

```
npm run typecheck
```

Clean — 0 errors (run 3 times across the session, clean every time
including the final state).

### I. Lint

```
npm run lint
```

`0 errors`, `1 warning` — the warning is a pre-existing, unrelated
"Unused eslint-disable directive" in
`tests/integration/supabase/051-chaos-safety-gate.integration.test.ts`
(a file this task never touched).

### J. Build

```
npm run build
```

First attempt hit the documented `.next` EPERM lock
(`unlink '...\.next\server\app\api\chaos\runs\[runId]\execute-c11-b'`).
Cleaned `.next` and retried once:

```
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
```

✓ Compiled successfully, TypeScript check passed, all 8 static pages +
all dynamic API routes generated, including the three new routes
(`cancel-c11-a`, `reconcile-c11-a`, `start-c11-a`) alongside every
pre-existing route.

### K. Prettier

```
npx prettier --check <every file this task changed>
```

First pass found 6 files needing formatting (all newly-written files —
never an existing frozen file). Ran `prettier --write` on the same file
list, then re-ran `--check` → **all matched files use Prettier code
style.** Re-ran typecheck and all affected unit test files after the
reformat to confirm no behavioral change — all green.

### L. `git diff --check`

```
git diff --check
```

No trailing-whitespace/conflict-marker errors reported — only expected
Windows CRLF-normalization notices on files this task modified/created.

### M. Final architect-accepted evidence (after the correction round)

Sections A-L above capture the initial implementation round. After the
architect correction round (durable technical-failure authority fix —
`isValidFailedC11AShape`/`persistAndVerifyC11ATechnicalFailure`/
`FAILURE_PERSISTENCE_FAILED`), the final accepted automated gates are:

```text
Focused C11-A/C11-B/C07/TEST_FIXTURE regression batch: 15 files / 525 tests PASS
059 isolated real Supabase:                             7 / 7 PASS
Final clean full real-Supabase invocation:               20 files / 219 tests PASS
Final clean full unit invocation:                        64 files / 1480 tests PASS
Typecheck:                                                PASS
Lint:                                                     0 errors, 1 pre-existing unrelated warning
Build:                                                    PASS after one known Windows/OneDrive .next EPERM cache-clear retry
Prettier:                                                 PASS
git diff --check:                                         PASS
```

These are the final numbers this handoff's Phase State (Section 20) reports.

---

## 15. Manual Authentic C11-A Verification

Performed as a two-step, architect-authorized one-shot procedure against the
real Supabase project and a genuinely performed Razorpay Test Mode failed
payment, using temporary manual-verification helpers
(`tests/integration/supabase/996-manual-c11-a-start.integration.test.ts` and
`tests/integration/supabase/995-manual-c11-a-reconcile.integration.test.ts`)
that were run exactly once each and deleted after architect approval —
neither was ever committed. A fresh internal Demo Merchant order was used —
the historical C11 source event
`e0df759e-bbde-45c3-aa80-a5a2d6b61be9` was never touched, read, or reused.

**Step 1 (create PENDING run + start RUNNING observation):** created exactly
ONE genuine production C11-A `PENDING` chaos run via the real
`createChaosRun(...)` entry point (Mechanism A, `freshOrderId`), then started
it exactly once via the real production `startC11AFailureObservation(...)`
service — proving it durably reached `RUNNING` with zero merchant mutation.

**Step 2 (reconcile exactly once):** after the developer manually performed a
genuine Razorpay Test Mode failed payment against that same order, called the
real production `reconcileC11AFailedPaymentObservation(...)` service exactly
once — never the HTTP route, never a direct repository call, never a manual
FK attach.

**Results (safe metadata only):**

```text
Internal order ID                = 59829992-b8e3-4ca0-a8ab-5b642e6b57e1
Chaos run ID                     = b49d344a-f5cf-42ae-a078-819b26bfbffe
Run transition                   = PENDING -> RUNNING -> COMPLETED
Final outcome                    = UNKNOWN (Phase 3F alone owns PASS/FAIL —
                                    never converted to PASS here)
Run started_at                   = 2026-08-28T09:54:34.215+00:00
Run completed_at                 = 2026-08-28T10:05:33.365+00:00
Genuine payment.failed webhook   = 9a01d0ab-88d3-47d5-8878-9141b88a749b
Razorpay event ID                = TV9HVG3naJ7m8j
Webhook source_kind              = REAL_RAZORPAY_WEBHOOK
Webhook signature_verified       = true
Webhook processing_status        = PROCESSED
Webhook duplicate_delivery_count = 0
Webhook received_at              = 2026-08-28T09:59:03.290427+00:00
                                    (correctly AFTER the run's started_at —
                                    proves the run-started-before-evidence
                                    timestamp bound)
Payment attempt ID               = 513468d6-e5fc-4248-8dfe-c98fb51f91b5
Payment ID                       = 37424b08-4880-44d6-a729-eb5db88087cd
Original processing attempt ID   = 9a0b293f-a80c-40cc-92e3-7ed4b609cfa4
Original attempt provenance      = source_kind=REAL_RAZORPAY_WEBHOOK,
                                    status=SUCCEEDED,
                                    is_duplicate_delivery=false,
                                    chaos_run_id=null
Reconciliation calls             = 1
Terminal run evidence FKs        = payment_attempt_id/payment_id/
                                    source_webhook_event_id all attached,
                                    matching the resolved chain exactly
Merchant state (pre AND post)    = order.payment_status=FAILED_OBSERVED,
                                    order.business_status=OPEN,
                                    fulfilment count=0
Payment state (pre AND post)     = razorpay_payment_status=failed,
                                    captured_at=null, failed_at non-null
Success-side-effect proof        = order PAID=false, business FULFILLED=false,
                                    payment captured=false, new fulfilments=0
Observation immutability         = canonical webhook rows 1->1,
                                    duplicate_delivery_count 0->0,
                                    PAYCHAOS_REPLAY attempts=0,
                                    new webhook rows from reconcile=0,
                                    new event_processing_attempts from
                                    reconcile=0, new payment rows from
                                    reconcile=0
```

This is the genuine positive proof that the C11-A production observation
lifecycle correctly starts, waits, and reconciles against an authentic
genuine `payment.failed` event with zero canonical-evidence mutation, zero
replay, and zero success-side effect — proving C11-A is pure observation.
The chaos run (`b49d344a-f5cf-42ae-a078-819b26bfbffe`) and every correlated
evidence row (the webhook, payment attempt, payment, and original processing
attempt listed above) remain in Supabase permanently as historical
verification evidence — never deleted.

---

## 16. Known Issues

- Windows/OneDrive Vitest worker-spawn timeout noise remains a
  machine-level environmental characteristic of this dev box (documented
  across prior phase handoffs too) — every full-suite invocation this
  session hit a handful of `Test timed out in 5000ms` failures on files
  unrelated to this task, always resolved by an isolated single retry.
  This is not a defect in Phase 3D-E's code.
- The pre-existing `no-console` ESLint warning in
  `051-chaos-safety-gate.integration.test.ts` remains unresolved — it
  predates this task and this task does not own that file.

---

## 17. Deferred Work

- **Manual C11-A verification** — complete (Section 15 above). No further
  deferred work here.
- Phase 3F (Money Invariant Engine, deterministic PASS/FAIL for
  INV-003/INV-004/INV-011 against the evidence C11-A collects) —
  unaffected by and not started in this phase.
- P1 chaos scenario wrappers remain out of scope.
- Phase 3D-F — Phase 3D consolidated regression/manual-evidence review and
  final Phase 3D handoff (an internal subdivision of Controlled Failure
  Injection, not the top-level Phase 3F Money Invariant Engine) — not
  started.

---

## 18. Next Phase Dependencies

Phase 3F's invariant evaluators can rely on:

- a `COMPLETED`/`UNKNOWN` C11-A run always carrying resolved, non-null
  `payment_attempt_id`/`payment_id`/`source_webhook_event_id`, all
  referring to a genuine `payment.failed` chain — now proven end-to-end
  against a real Razorpay Test Mode failure (Section 15);
- C11-A never having pre-judged PASS/FAIL — `outcome` is always `UNKNOWN`
  on completion, exactly like every other Phase 3D mechanism;
- the observation repository's evidence resolution being independently
  re-checkable/re-runnable (stateless, side-effect-free reads) to support
  Phase 4's Regression Engine re-test foundation.

---

## 19. Do Not Break

- `resolveAuthoritativeC11ReplaySource`, `C11_REPLAY_ATTEMPT_COUNT`,
  `executeC11RealWebhookReplay`, and the `execute-c11-b` route's exact
  behavior (C11-B, frozen).
- The C11-A vs C11-B disambiguation predicates in
  `lib/chaos/run-repository.ts` (`source_webhook_event_id`/
  `payment_attempt_id`/`payment_id` NULL-ness) — any future column reuse
  must re-verify these still uniquely distinguish the two mechanisms.
- The "never gate on observed merchant-state content" rule in
  `reconcileC11AFailedPaymentObservation` — this is the load-bearing
  architectural decision of this entire phase and must not be
  "corrected" to add a safety check without an explicit, approved scope
  change.

---

## 20. Phase State

```text
IMPLEMENTED                     = YES
TESTED                          = YES (1480/1480 unit, 219/219 integration —
                                        final counts after the architect
                                        correction round's durable-failure-
                                        authority fix; all environmental
                                        noise isolated and retried, never a
                                        genuine failure)
REAL SUPABASE MECHANICS VERIFIED = YES (059, 7/7, against the real
                                         configured Supabase project)
MANUALLY VERIFIED               = YES (Section 15 — real Razorpay Test Mode
                                        failed payment, genuine C11-A
                                        observation, reconciled exactly once)
DOCUMENTED                      = YES
APPROVED                        = YES
```

## 21. Final Architect Approval

Phase 3D-E — C11-A genuine Razorpay Test Mode failed-payment observation +
reconciliation — is architect-approved. Manual authentic verification
(Section 15) is accepted as genuine positive proof against a real,
authentically failed Razorpay Test Mode payment, with zero canonical-evidence
mutation, zero replay, and zero success-side effect. The chaos run
(`b49d344a-f5cf-42ae-a078-819b26bfbffe`) and every correlated evidence row are
retained permanently in Supabase as historical verification evidence. The
`UNKNOWN` outcome is intentional and permanent for this phase — Phase 3F
alone will later evaluate deterministic money invariants (INV-003/INV-004/
INV-011) against this and future evidence; it is never converted to `PASS`
here.
