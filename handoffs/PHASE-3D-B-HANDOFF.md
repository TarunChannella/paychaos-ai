# Phase 3D-B — C07 Payment Succeeds but Client Confirmation Is Lost Handoff

**Project:** PayChaos AI — Autonomous Payment Reliability Engineer
**Branch:** `phase-3-chaos-engine`
**Frozen Phase 3D-0 baseline:** `supabase/migrations/20260831000000_phase3d_execution_safety.sql`
**Sub-phase:** Phase 3D-B — P0 Scenario C07, Payment Succeeds but Client Confirmation Is Lost (`docs/CHAOS_SCENARIOS.md` Section 19), fault_type `DROP_CLIENT_CONFIRMATION`

---

## 1. Status

```text
IMPLEMENTED             = YES
TESTED                  = YES
REAL SUPABASE VERIFIED  = YES
E2E REGRESSION VERIFIED = YES
MANUALLY VERIFIED       = YES
DOCUMENTED              = YES

APPROVED                = YES
```

**Phase 3D-B (C07 — Payment Succeeds but Client Confirmation Is Lost) is APPROVED by the architect**, after:

- automated regression verification (focused C07 unit suite, full real-Supabase integration suite, full offline unit suite, typecheck, lint, build);
- real Supabase verification of every C07 lifecycle transition and hardening fix, including the two correction rounds' blockers;
- genuine Razorpay Test Mode manual verification (Section 7) — a real Checkout payment, authenticated fault consumption, genuine webhook convergence, and production reconciliation to a durable `COMPLETED`/`UNKNOWN` terminal state;
- final build/E2E verification after manual-evidence cleanup;
- removal of the three temporary manual helper test files (`995`/`996`/`997`), confirmed absent, with the permanent `056` mechanics suite intact.

This report covers THREE rounds: the first correction round (four architect-identified blockers: authenticated first consume, truthful client suppression UI, exact fault_state shape/classification scoping, durable terminal-state proof for completion/cancellation), a second, final correction round that closed a residual race in the cancellation mutation itself and made the completion/cancellation repository-throw contract actually true, and the mandatory manual real-Razorpay-Test-Mode C07 verification (Section 7), which PASSED against a real Razorpay Test Mode payment and real persisted Supabase evidence.

---

## 2. Completed Features

### C07 lifecycle

- `armC07ClientConfirmationDrop(chaosRunId)` — atomically arms an eligible, already-persisted PENDING C07 run (`RUNNING` + `fault_state = {armed:true, consumed:false}`), enforcing PRE-SEC-007 and the Phase 3D-0 one-active-C07-fault-per-order partial unique index. Unchanged from the prior round.
- `checkAndSuppressC07ClientConfirmation(input)` — **rewritten this round (Blocker 1)**. Called from `verifyCheckoutAction` with the same Checkout fields the browser already submits (`paymentAttemptId`, `razorpayPaymentId`, `razorpayOrderId`, `razorpaySignature`) — never a chaos run id, fault switch, or scenario id. For the first unconsumed active fault it now:
  1. resolves the trusted persisted payment attempt;
  2. requires that attempt to already carry a trusted `razorpay_order_id`;
  3. requires the browser's `razorpayOrderId` to equal that trusted value;
  4. verifies the Checkout HMAC via the frozen, reused `verifyCheckoutSignature` (`lib/razorpay/checkout-verification.ts`) — never a reimplementation.
     Only once all four succeed does `consumed` ever flip to `true`. An invalid candidate (missing trusted order id, order mismatch, invalid signature, or verifier unavailable) never consumes, never persists evidence, and returns a narrow `REJECTED_INVALID_CONFIRMATION` result with a `reasonCategory`. `verifyCheckoutAndPersistPayment` is never called for a suppressed confirmation — the webhook remains sole authority for merchant/payment convergence. Already-consumed retries remain suppressed without re-verification (frozen retry semantics preserved).
- `reconcileC07ClientConfirmationDrop(chaosRunId)` — completes the run only once `resolveC07ConvergenceEvidence` proves authoritative webhook-driven convergence; never fabricates evidence.
- `cancelRunningC07Fault(chaosRunId)` — explicit, operator-initiated-only cancellation to `FAILED`/`ERROR`.

### Exact fault_state / provenance (Blocker 3)

- One pure validator triad in `lib/chaos/c07-repository.ts` — `parseExactC07FaultState`, `isExactArmedUnconsumedFaultState`, `isExactArmedConsumedFaultState` — requiring `typeof object`, not null, not array, exactly the two own keys `armed`/`consumed`, `armed === true`, `consumed` a boolean. Used consistently across arm proof, active-fault lookup, suppression, reconciliation, and cancellation.
- `resolveActiveArmedC07FaultForOrder` now also scopes its query on `data_classification = RECORDED_TEST_EVIDENCE` and independently re-validates the exact fault_state shape before ever returning a row as "active."
- Every C07 write helper in `run-repository.ts` that gates on `fault_state` now uses **exact JSONB equality**, not containment: `consumeC07ClientConfirmationDrop` requires exactly `{armed:true, consumed:false}` before flipping to `{armed:true, consumed:true}`; `completeRunningC07RunWithEvidence` requires exactly `{armed:true, consumed:true}`. A malformed row (extra key, wrong type) can never satisfy either mutation — it fails closed.

### Durable terminal state is authoritative (Blocker 4)

- `completeRunningC07RunWithEvidence`/`reconcileC07ClientConfirmationDrop`: after the repository UPDATE returns, the service independently re-validates id/scenario/fault type/classification/order/status=COMPLETED/outcome=UNKNOWN/evidence FK exact match/fault_state exactly `{armed:true,consumed:true}`/timestamps/null block fields before ever reporting `COMPLETED`. Any deviation reports `COMPLETION_PERSISTENCE_FAILED`.
- `cancelRunningC07Fault`: captures the exact pre-cancel `fault_state` before mutating, then requires the returned row to independently prove id/order/scenario/fault/classification/status=FAILED/outcome=ERROR/both timestamps set/null block fields/non-null redacted reason **and** `fault_state` exactly unchanged from the captured pre-state (guards against a concurrent consume racing underneath the cancel). Any deviation reports `CANCEL_PERSISTENCE_FAILED`, mapped by the route to a safe generic 500.

### Truthful client suppression UI (Blocker 2)

- `app/demo-merchant/pay-with-razorpay-button.tsx` — narrow, authorized addition: a `result.ok && result.suppressed` branch handled **before** the existing generic `!result.ok || !result.payment` failure branch, rendering a dedicated `data-testid="c07-client-confirmation-suppressed"` message. Never calls `setVerified`, never claims captured/failed/paid/fulfilled, uses the server's safe message with a documented fallback. State is cleared on every fresh Checkout attempt. Every existing Phase 2G behavior (webhook-confirmed message rule, shared formatter, normal success/failure/launch paths) is unchanged.

### Repository/route hardening

- All C07 write helpers remain scenario-specific (hardcoded `scenario_id=C07`, `fault_type=DROP_CLIENT_CONFIRMATION`); `completeRunningC07RunWithEvidence`/`cancelRunningC07Fault` additionally take an `expectedOrderId` parameter and scope on it.
- `app/api/chaos/runs/[runId]/cancel-c07/route.ts` maps the new `CANCEL_PERSISTENCE_FAILED` result to a generic safe 500, never exposing the run id or internal detail.
- Static guard (`tests/unit/chaos/c07-static-guard.test.ts`) updated to permit the C07 service's import of `verifyCheckoutSignature` while continuing to forbid `fetch`/HTTP/`axios`/Razorpay-API-adapter/public-webhook-import/`verifyCheckoutAction`/`verifyCheckoutAndPersistPayment`/merchant-mutation/fulfilment-insert/arbitrary-target, and additionally proves the C07 files never reimplement HMAC (`createHmac`/`timingSafeEqual`/`node:crypto` absent).

### A genuine correctness bug found and fixed during the first correction round's verification

While running the 056 real-Supabase integration test, `consumeC07ClientConfirmationDrop` and `completeRunningC07RunWithEvidence` threw `22P02 invalid input syntax for type json` on every real database call. Root cause: `postgrest-js`'s `.eq(column, value)` does not JSON-serialize a non-primitive `value` — it interpolates it as a string, producing the literal text `"[object Object]"`, which Postgres correctly rejected. The original implementation of the Blocker 3 exact-equality gate (`.eq("fault_state", {armed:true, consumed:false})`) would have failed on **every** real invocation, not merely a malformed one — this was caught only because this round ran the mechanics test against real Supabase rather than mocks. Fixed by supplying the JSON text explicitly through `.filter("fault_state", "eq", JSON.stringify({...}))`, postgrest-js's documented raw-syntax escape hatch, which is also the only form whose TypeScript signature accepts a string value for a `Record<string, unknown>`-typed column (the original `.eq()` form also failed `tsc --noEmit` once exercised). This is a mocked-unit-test blind spot precedent worth carrying into future correction rounds: **any new `.eq()`/`.contains()` filter against a JSONB column must be verified at least once against real Supabase before being considered proven**, since a Supabase-mocked unit test cannot catch a query-encoding failure the real PostgREST layer would reject.

### Final correction round — Blocker A: cancellation is atomic with its pre-cancel fault_state

The first correction round validated the pre-cancel `fault_state` (read) and the post-cancel returned row (re-checked) as two SEPARATE steps, leaving a real race: a genuine Checkout confirmation could consume the fault (`false -> true`) in the window between the service's read and the cancel `UPDATE`, and that `UPDATE` — scoped only on `id`/`order_id`/`scenario_id`/`fault_type`/`status` — could still match and terminalize the run to `FAILED`/`ERROR` while silently leaving the newly-`true` `consumed` value in place. The post-hoc shape check would then correctly detect the mismatch and report `CANCEL_PERSISTENCE_FAILED`, but by then the run had already been incorrectly terminalized and the one-active-fault-per-order index slot had already been released — a truthful-sounding failure result describing a lifecycle event that had, in fact, already silently succeeded.

Fixed by moving the exact pre-state check into the SAME atomic conditional `UPDATE` the mutation itself performs. `cancelRunningC07Fault` (repository) now takes `expectedConsumed: boolean` from its caller and constructs `{armed: true, consumed: expectedConsumed}` itself — never accepting a caller-supplied JSON object — then requires the persisted `fault_state` to match that exact value via `.filter("fault_state", "eq", JSON.stringify(...))` (never `.contains()`) as part of the WHERE clause of the transitioning UPDATE. A losing race (a consume that reaches the database first) now causes this UPDATE to match zero rows, so the run correctly remains `RUNNING` with its new, genuinely-current `fault_state` — the service reports `CANCEL_PERSISTENCE_FAILED` and the operator may safely retry cancellation against the newly-observed state. This was proven directly against real Supabase (Section 6, new race-guard test in `056-...test.ts`): a stale `expectedConsumed=false` passed to the low-level repository function after a real consume had already flipped the state to `true` is proven to return `null` and leave the row `RUNNING`, after which a legitimate service-level cancel (reading current state) succeeds normally.

### Final correction round — Blocker B: repository throws now actually map to the documented safe results

The handoff previously claimed a repository throw during completion/cancellation maps to `COMPLETION_PERSISTENCE_FAILED`/`CANCEL_PERSISTENCE_FAILED`, but neither service function actually wrapped its persistence call in a `try/catch` — a genuine repository exception would have propagated unhandled. Both `reconcileC07ClientConfirmationDrop` and `cancelRunningC07Fault` now wrap ONLY the persistence call itself in a narrow `try/catch`; on a caught exception they log only a safe error name plus the chaos run id (never the raw DB message, never a secret, never a signature) and return the corresponding safe typed failure — never re-mutating the durable row to compensate. The earlier authoritative-evidence READ inside reconciliation (`resolveC07ConvergenceEvidence`) remains deliberately unwrapped — a transient read failure still propagates and leaves the run `RUNNING`, exactly as before.

---

## 3. Files Changed

**New:**

```text
lib/chaos/c07-execution-service.ts
lib/chaos/c07-repository.ts
app/api/chaos/runs/[runId]/arm-c07/route.ts
app/api/chaos/runs/[runId]/reconcile-c07/route.ts
app/api/chaos/runs/[runId]/cancel-c07/route.ts
tests/unit/chaos/c07-execution-service.test.ts
tests/unit/chaos/c07-repository.test.ts
tests/unit/chaos/c07-static-guard.test.ts
tests/unit/api/chaos-c07-routes.test.ts
tests/integration/supabase/056-chaos-c07-client-confirmation.integration.test.ts
handoffs/PHASE-3D-B-HANDOFF.md   (this document)
```

**Modified (narrow, pre-approved compatibility changes only):**

```text
lib/chaos/run-repository.ts               — additive C07 exports; first correction round corrected the
                                             exact-equality filter mechanics (.eq -> .filter) on
                                             consumeC07ClientConfirmationDrop/completeRunningC07RunWithEvidence
                                             and added expectedOrderId scoping to
                                             completeRunningC07RunWithEvidence/cancelRunningC07Fault; the
                                             FINAL correction round further changed cancelRunningC07Fault's
                                             signature to add expectedConsumed: boolean and moved the exact
                                             fault_state predicate into the same atomic conditional UPDATE
                                             (Blocker A)
lib/chaos/c07-execution-service.ts        — FINAL correction round only: cancelRunningC07Fault now forwards
                                             preState.consumed as expectedConsumed to the repository instead
                                             of relying on a post-hoc-only check; both
                                             completeRunningC07RunWithEvidence and cancelRunningC07FaultRepo
                                             calls are now wrapped in narrow try/catch mapping a throw to
                                             COMPLETION_PERSISTENCE_FAILED/CANCEL_PERSISTENCE_FAILED (Blocker B)
app/demo-merchant/actions.ts              — narrow C07 branch: calls checkAndSuppressC07ClientConfirmation
                                             with the full Checkout field object; new
                                             REJECTED_INVALID_CONFIRMATION -> safe error branch
                                             (unchanged in the final correction round)
app/demo-merchant/pay-with-razorpay-button.tsx — narrow, architect-authorized truthful suppression-result
                                             handling (Blocker 2), placed before the existing generic
                                             failure branch; no other Phase 2G behavior changed
                                             (unchanged in the final correction round)
tests/unit/chaos/run-repository.test.ts   — updated assertions for the corrected .filter() call sites and
                                             new completeRunningC07RunWithEvidence/cancelRunningC07Fault
                                             signatures; FINAL round added tests proving the exact
                                             expectedConsumed=false/true predicate and the absence of
                                             .contains()
tests/unit/chaos/c07-execution-service.test.ts — FINAL round added: expectedConsumed forwarding (both
                                             boolean values), cancellation repository throw ->
                                             CANCEL_PERSISTENCE_FAILED, completion repository throw ->
                                             COMPLETION_PERSISTENCE_FAILED, with safe-logging assertions
tests/integration/supabase/056-chaos-c07-client-confirmation.integration.test.ts — FINAL round added one
                                             deterministic real-Supabase race-guard test (Section 6)
tests/unit/demo-merchant/actions.test.ts  — updated call assertion + new REJECTED_INVALID_CONFIRMATION test
                                             (unchanged in the final correction round)
tests/unit/demo-merchant/pay-with-razorpay-button.test.ts — new structural describe block for the
                                             suppression UI (Blocker 2) (unchanged in the final correction
                                             round)
```

No other frozen Phase 1/2/3A/3B/3C/3D-A production file was modified. `app/api/webhooks/razorpay/route.ts`, `lib/webhooks/service.ts`, `lib/events/processor.ts`, `lib/demo-merchant/service.ts`, `lib/chaos/registry.ts`, `lib/chaos/repository.ts`, `lib/chaos/safety-gate.ts`, `lib/chaos/run-service.ts`, `lib/chaos/replay-repository.ts`, `lib/chaos/replay-service.ts`, and every migration remain byte-for-byte unchanged — confirmed by the static guard's frozen-file describe block and by `git status`/`git diff`.

---

## 4. Database Changes

**New migration: NONE.** This correction round performs no schema change. It depends entirely on the already-frozen, already-approved Phase 3D-0 schema (`supabase/migrations/20260831000000_phase3d_execution_safety.sql`), including the `chaos_runs_one_active_c07_fault_per_order_idx` partial unique index. All fixes in this round are application/repository-layer, fail-closed validation and query-encoding corrections only.

---

## 5. Architectural Decisions

**A. Authenticate the first client confirmation before ever consuming the fault.**
Reason: a `paymentAttemptId` alone is not proof of a genuine Checkout success callback. Reusing the frozen `verifyCheckoutSignature` against the trusted persisted `razorpay_order_id` closes the gap without ever making the browser authoritative over money state, and without ever calling the real payment-persistence path for a suppressed confirmation.

**B. Exact JSONB equality, not containment, for every fault_state-gated mutation.**
`.contains()` tolerates extra keys; `.eq()`/`.filter(..., "eq", ...)` on the full JSON value does not. This is the only way a malformed persisted row (however it arose) can be guaranteed to never satisfy a consume/complete mutation.

**C. Durable returned state is authoritative, never a non-null UPDATE result.**
Extends the same principle already applied to C03's PRE-SEC-007 correction to C07's completion and cancellation — a technically-successful UPDATE racing against a concurrent state change is reported as a persistence-failure result, never a false-positive success.

**D. `.filter(column, "eq", value)` is the correct primitive for a JSONB-exact-equality filter in this codebase's postgrest-js version, not `.eq(column, object)`.**
`.eq()` interpolates a non-primitive value as a string rather than serializing it, and its TypeScript typing also rejects a string value for a `Record<string, unknown>`-typed column. `.filter()` is postgrest-js's documented raw-PostgREST-syntax escape hatch and is otherwise behaviorally identical to `.eq()`.

**E. `pay-with-razorpay-button.tsx` may be touched, narrowly, for C07 (architect-authorized reversal of the prior round's "STOP and report" boundary).**
A missing `payment` field previously fell into the generic failure message, which would misrepresent a genuine C07 suppression as a Checkout failure. This is now the third and final pre-approved compatibility file for Phase 3D-B, alongside `run-repository.ts` and `actions.ts`.

**F. Cancellation's exact pre-state check belongs in the mutation's WHERE clause, not in a read-then-recheck sequence (final correction round).**
A check performed before AND after a mutation, but not atomically WITH it, still leaves a window for a concurrent writer to invalidate the precondition in between — the mutation must encode the precondition itself. This is the same "compare-and-swap" principle the codebase already uses for `consumeC07ClientConfirmationDrop`'s `false -> true` transition; cancellation's `RUNNING -> FAILED/ERROR` transition needed the identical treatment, keyed on `fault_state` instead of `status`.

**G. A repository throw must be caught at the exact boundary the persistence call crosses, not left to the caller's caller.**
Wrapping only the persistence call (never the earlier authoritative read) in `try/catch` keeps the "transient read failures propagate, leaving the run safely retryable" rule intact while making the "throw maps to a safe typed failure" rule actually true, rather than aspirational documentation the code did not yet enforce.

---

## 6. Test Results

### First correction round (historical — superseded by the final numbers below)

```text
Focused correction-round suite (8 files, pre-fix):     8 files / 216 tests passed
056 real-Supabase (initial run, pre-fix):              1 file failed, 6 failed | 8 passed (14)
  Cause: genuine bug — .eq("fault_state", object) is not valid PostgREST syntax. Fixed via .filter().
056 real-Supabase (after fix):                         1 file / 14 tests passed
Full real-Supabase integration suite:                  17 files / 206 tests passed
Full offline unit suite (first run):                   1 file failed (environmental timeout,
                                                        unrelated frozen file), 53/54 files,
                                                        1186/1187 tests; isolated retry: 54/54 clean
npm run e2e (1st/2nd attempts):                        environmental webServer timeout (confirmed via
                                                        manual `next dev` boot in 9.3s); 3rd attempt: 2/2 pass
Typecheck (1st run):                                   3 errors (2 real .eq() type-mismatch bugs, 1
                                                        redundant regex flag) — all fixed; PASS after
Lint:                                                  0 errors, 1 pre-existing unrelated warning
Build:                                                 PASS
Prettier / git diff --check:                           clean (only CRLF/LF warnings)
```

### Final correction round (Blockers A & B) — this is the current, authoritative result

```text
Focused C07 unit suite (8 named files):
  Test Files = 8 passed
  Tests      = 222 passed
  (up from 216 in the first round — 6 new tests added for Blockers A/B)

056 real-Supabase integration (with the new race-guard test):
  Test Files = 1 passed
  Tests      = 15 passed
  (up from 14 — the new deterministic cancellation-race proof)

Full real-Supabase integration suite:
  Test Files = 17 passed
  Tests      = 207 passed

Final full offline unit suite — ONE clean invocation, no environmental retry needed this time:
  Test Files = 54 passed
  Tests      = 1193 passed
  (up from 1187 in the first round — 6 new tests)

npm run typecheck: PASS (0 errors)

npm run lint: 0 errors
  1 pre-existing warning (unrelated, untouched file):
  tests/integration/supabase/051-chaos-safety-gate.integration.test.ts:354

npm run build: PASS (exit 0)
  First attempt hit the previously-documented Windows/OneDrive `.next` EPERM
  lock (EPERM: operation not permitted, unlink '.next\server\app\access');
  cleared `.next` via PowerShell `Remove-Item -Recurse -Force` and retried —
  second attempt compiled successfully (59s), TypeScript finished in 35.2s,
  8/8 static pages generated, exit 0. Same established precedent as prior
  phases, not a code regression.

npm run e2e: PASS on the first attempt this round
  2 passed (1.8m)
    app-shell.spec.ts        - PASS (5.9s)
    demo-merchant.spec.ts    - PASS (26.4s)

Prettier: run on the 6 files this round actually touched
  (lib/chaos/run-repository.ts, lib/chaos/c07-execution-service.ts,
  tests/unit/chaos/run-repository.test.ts,
  tests/unit/chaos/c07-execution-service.test.ts,
  tests/integration/supabase/056-...test.ts, this handoff)
  1 file reformatted (c07-execution-service.test.ts), 5 already-formatted.
  Re-ran tests/unit/chaos/c07-execution-service.test.ts after formatting:
  42/42 pass.

git --no-pager diff --check: exit 0 (only Windows LF/CRLF warnings)
git status --short: matches the exact Section 9 frozen-scope expectation —
  only run-repository.ts and c07-execution-service.ts are new production
  changes this round; every other file matches the already-authorized
  first-round diff.
```

No stale count from the first round is being carried forward as current — the numbers above are from a single fresh invocation of each gate performed after both final-round fixes landed.

### Final regression pass — after manual verification and temporary-file cleanup

Performed once production evidence for the manual Razorpay Test Mode verification (Section 7) was recorded and the three temporary manual test files were deleted, to confirm the working tree still matches the intended permanent diff and nothing regressed:

```text
Focused C07 unit suite (8 files):     8 files / 222 tests passed — matches historical exactly
056 real-Supabase:                    1 file / 15 tests passed — matches historical exactly
Full real-Supabase integration:       17 files / 207 tests passed — matches historical exactly
Full unit suite:                      54 files / 1193 tests passed — matches historical exactly
Typecheck:                            PASS (0 errors)
Lint:                                 0 errors, 1 pre-existing unrelated warning (unchanged)
Build:                                PASS on the first attempt (no .next EPERM retry needed this time)
E2E:                                  2/2 passed after one retry (see below)
```

Three environmental blips were encountered and resolved during this pass, none a code regression:

1. The focused C07 suite's first two invocations reported all 8 files failing with `[vitest-pool]: Failed to start forks worker` / `Timeout waiting for worker to respond` — zero tests even started. Five orphaned `node` processes from prior background build/test invocations were found still running and were terminated; the next invocation ran cleanly (8/8 files, 222/222 tests).
2. The full unit suite's first invocation similarly reported 22 files failing to spawn a worker (partial run: 32/54 files, 729/1193 tests); no orphaned processes were found this time (transient Windows/OneDrive contention). A second invocation reduced this to two isolated test-level timeouts in unrelated, untouched frozen files (`tests/unit/api/access-logout-route.test.ts`, `tests/unit/api/chaos-replay-route.test.ts`) — both passed cleanly in isolation (18/18), and a third full-suite invocation was clean end to end (54/54, 1193/1193).
3. `npm run e2e`'s first attempt failed at `demo-merchant.spec.ts`'s very first assertion (`getByText("PayChaos Test Product")` not visible within the default 5000ms) — this is the exact cold-compile-on-first-navigation risk the test's own code comments already document (only the URL-navigation assertion immediately before it has an extended 20s timeout; the content assertion right after it does not). No live process held port 3100 (confirmed via `Get-NetTCPConnection`, only closing `TIME_WAIT` sockets) — not a port conflict. A retry passed cleanly (2/2).

No production or test code was modified to resolve any of the above — every one was resolved by clearing stale OS-level processes and/or a single retry of the exact same command, consistent with this engagement's established Windows/OneDrive environmental-noise precedent.

---

## 6A. Real Supabase Race Proof (Blocker A)

```text
Stale expected state:              expectedConsumed=false (captured before a genuine consume)
Genuine consume in between:        consumeC07ClientConfirmationDrop -> fault_state {armed:true,consumed:true}
Stale cancel attempt (low-level repository, expectedConsumed=false):
  Result:                          null (zero rows matched)
Durable state after rejected stale cancel:
  status                          = RUNNING
  fault_state                     = {armed:true, consumed:true}   (unchanged, exactly as the real consume left it)
Final legitimate cancel (service-level, reads current state itself):
  Result:                         { kind: "CANCELLED", chaosRunId }
  Durable state:                  status=FAILED, outcome=ERROR, fault_state={armed:true,consumed:true}
```

This proves a stale pre-cancel snapshot cannot terminalize a run whose `fault_state` has since genuinely changed, and that a legitimate subsequent cancel (which reads current state rather than relying on a stale value) still succeeds normally.

---

## 7. Manual Verification — MANUAL RAZORPAY TEST MODE VERIFICATION

**PASSED.** A genuine Razorpay Test Mode Checkout payment was completed against a manually-created Demo Merchant order, using a one-shot temporary preparation test (arm), a real Checkout payment, and a one-shot temporary reconciliation test (verify + reconcile). Both temporary tests ran exactly once each; production code was not modified to make this pass.

**Exact identifiers:**

```text
chaos run          = 68878716-ed49-40ec-85de-f962a4f6b21c
internal order      = 3eb45e7c-bc29-49fd-b5f2-1c8d0d4a2550
payment attempt      = b47f79cb-1cb9-425b-867c-518b05463ff1
Razorpay Test Order  = order_TUicVQUsaroxc4
persisted payment    = ab8a2f1f-ec2b-402c-91e0-020a1223ad2d
preferred real webhook = 55985554-6040-4326-bf68-c1b1b0d8f945
```

**Pre-payment armed state** (proved by the one-shot `997-manual-c07-prepare-arm.integration.test.ts`, run once, via the real `runChaosPrecheck`/`createChaosRun`/`armC07ClientConfirmationDrop` production path):

```text
scenario_id = C07, fault_type = DROP_CLIENT_CONFIRMATION, data_classification = RECORDED_TEST_EVIDENCE
status = RUNNING, outcome = null
fault_state = { armed: true, consumed: false }
order: payment_status = UNPAID, business_status = OPEN, fulfilment count = 0
payment attempt: status = ORDER_CREATED, razorpay_order_status = created
payments correlated to attempt = 0, webhook_events correlated = 0
```

**Real payment / C07 consumption proof** (the user clicked Pay with Razorpay once and completed one genuine Razorpay Test Mode card payment; proved BEFORE reconciliation by the one-shot `995-manual-c07-post-payment-reconcile.integration.test.ts`, run once):

```text
run status = RUNNING, outcome = null
fault_state EXACTLY { armed: true, consumed: true }   <- the fault was authenticated and consumed
order: payment_status = PAID, business_status = FULFILLED, fulfilment count = exactly 1
payment attempt: status = CAPTURED, razorpay_order_status = paid
payment: razorpay_payment_status = captured, checkout_signature_verified = false, checkout_verified_at = null
```

`checkout_signature_verified = false` is the concrete, DB-provable fact that **the normal Checkout confirmation persistence path never became authoritative** — the canonical `payments` row was created by `insertPaymentFromWebhookEvidence` (webhook-first observation), never by `verifyCheckoutAndPersistPayment`/`insertVerifiedPayment` (the path a suppressed C07 confirmation must never reach).

**Real webhook evidence** (the exact correlated `REAL_RAZORPAY_WEBHOOK` row `resolveC07ConvergenceEvidence` selected, preferring `payment.captured` over `order.paid`):

```text
webhook event id     = 55985554-6040-4326-bf68-c1b1b0d8f945
event_type           = payment.captured
source_kind          = REAL_RAZORPAY_WEBHOOK
signature_verified   = true
processing_status    = PROCESSED
duplicate_delivery_count = 0
correlated payment_id         = ab8a2f1f-ec2b-402c-91e0-020a1223ad2d
correlated payment_attempt_id = b47f79cb-1cb9-425b-867c-518b05463ff1
correlated razorpay_order_id  = order_TUicVQUsaroxc4
```

**Reconciliation proof** — `reconcileC07ClientConfirmationDrop(chaosRunId)` was called exactly once (no loop, no retry, no direct `chaos_runs` update):

```text
result = { kind: "COMPLETED", chaosRunId: "68878716-ed49-40ec-85de-f962a4f6b21c" }
```

**Durable terminal state**, independently re-read and re-validated after reconciliation:

```text
status = COMPLETED, outcome = UNKNOWN
fault_state EXACTLY { armed: true, consumed: true }
payment_attempt_id      = b47f79cb-1cb9-425b-867c-518b05463ff1
payment_id              = ab8a2f1f-ec2b-402c-91e0-020a1223ad2d
source_webhook_event_id = 55985554-6040-4326-bf68-c1b1b0d8f945
failed_precheck_id = null, execution_block_code = null, completed_at != null
```

`outcome = UNKNOWN` is expected, correct C07 behavior, **not a failure** — Phase 3D-B records successful controlled execution and evidence only; Phase 3F's Money Invariant Engine is the only phase authorized to assign an actual PASS/FAIL finding.

**Completed run no longer an active suppression fault**: the same `995` test's final assertion, `resolveActiveArmedC07FaultForOrder(orderId) === null` after `COMPLETED`, passed — the exact pure, read-only production decision boundary `checkAndSuppressC07ClientConfirmation` itself uses to decide suppression eligibility confirms a terminal C07 run can never again suppress a client confirmation for this order.

**Summary of what this proves, end to end:** armed → authenticated genuine Checkout confirmation consumed the fault → client confirmation was never persisted as the authoritative convergence path → the real, signature-verified Razorpay webhook independently converged the merchant to PAID/FULFILLED with exactly one fulfilment → production reconciliation completed against that evidence exactly once → the durable terminal row carries the exact correct evidence FKs → the completed run is structurally no longer an active suppressor.

The three temporary one-shot test files used to perform this manual sequence (`995-manual-c07-post-payment-reconcile.integration.test.ts`, `996-diagnose-c07-order-visibility.integration.test.ts`, `997-manual-c07-prepare-arm.integration.test.ts`) have been deleted as part of this cleanup step and were never committed. The permanent `056-chaos-c07-client-confirmation.integration.test.ts` mechanics suite remains.

---

## 8. Security Evidence

- Test Mode only; no production Razorpay credentials or money at any point.
- The C07 service never calls the Razorpay API, any HTTP/network endpoint, the public webhook route, `verifyCheckoutAction`, or `verifyCheckoutAndPersistPayment` — statically proven absent (`c07-static-guard.test.ts`).
- The C07 service reuses, and never reimplements, the frozen `verifyCheckoutSignature` HMAC primitive — `createHmac`/`timingSafeEqual`/`node:crypto` are statically proven absent from all C07 production files.
- The Checkout signature, Key Secret, and raw Checkout response are never logged or persisted — proven by scanning every `logEvent` call site in the C07 service.
- The browser Checkout handler payload gains no new field (`chaosRunId`, fault type, scenario id, or an "authorized"/chaos-enabled boolean are all statically proven absent from `pay-with-razorpay-button.tsx`).
- A caller who knows only a `paymentAttemptId` can no longer flip `consumed` to `true` — the trusted order-id/signature check must succeed first.
- A malformed `fault_state` (extra key, wrong type) is proven, against real Supabase, to fail closed at every gate: active-fault lookup, consume, reconciliation, and cancellation.
- A stale pre-cancel snapshot can no longer terminalize a run whose `fault_state` has genuinely changed since it was read — the cancellation mutation's own atomic predicate (Blocker A) guarantees this, proven against real Supabase.
- A repository throw during completion or cancellation can no longer propagate unhandled or trigger a compensating re-mutation of the durable row — it maps deterministically to a safe typed failure, logging only a safe error name and the chaos run id (Blocker B).
- The webhook Route Handler, `lib/webhooks/service.ts`, `lib/events/processor.ts`, and `lib/demo-merchant/service.ts` remain byte-for-byte unchanged — the webhook path is the sole authority for final merchant/payment convergence.
- Every C07 route enforces the same PRE-SEC-010 (session/CORS) boundary as the frozen C01/C03 routes and reads no request body.

---

## 9. Known Issues

- The Vite integration config emits its existing future-native-loader warning (pre-existing, unrelated to Phase 3D-B).
- The existing lint warning in `051-chaos-safety-gate.integration.test.ts` remains (pre-existing, untouched file, out of this round's scope).
- The Windows/OneDrive `.next` EPERM build lock recurred once this round; resolved by the established `Remove-Item -Recurse -Force ".next"` precedent before retrying the build — not a code issue.
- No C07 P0 functional blocker is currently known following both correction rounds.

---

## 10. Deferred Work

```text
Money invariant PASS/FAIL evaluation             — deferred to Phase 3F
Evidence snapshot system                         — deferred to Phase 3E
Findings                                         — deferred to Phase 3G
UI polish                                        — deferred to Phase 3H/5
C11                                              — remains untouched
```

---

## 11. Next Dependency

Phase 3D-B (C07) is approved and frozen. The next dependency is architect-directed: the next planned Phase 3 work item begins only after this approved snapshot is committed, pushed, and confirmed frozen — matching the same sequencing discipline every prior sub-phase in this engagement followed.

---

## 12. Phase Completion Checklist

```text
IMPLEMENTED             [x]
TESTED                  [x]
REAL SUPABASE VERIFIED  [x]
E2E REGRESSION VERIFIED [x]
MANUALLY VERIFIED       [x]
DOCUMENTED              [x]
APPROVED                [x]  — approved by architect after final regression + manual verification review
```
