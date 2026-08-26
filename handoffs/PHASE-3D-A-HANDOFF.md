# Phase 3D-A — C03 Invalid Webhook Signature Handoff

**Project:** PayChaos AI — Autonomous Payment Reliability Engineer
**Branch:** `phase-3-chaos-engine`
**Frozen Phase 3D-0 baseline commit:** `3c025d56c98a8c97c5abd6e695367464096e58fd`
**Sub-phase:** Phase 3D-A — P0 Scenario C03, Invalid Webhook Signature (`docs/CHAOS_SCENARIOS.md` Section 15)

---

## 1. Status

```text
IMPLEMENTED            = YES
TESTED                 = YES
REAL SUPABASE VERIFIED = YES
MANUALLY VERIFIED      = YES
DOCUMENTED             = YES

APPROVED               = YES
```

Architect final review passed. Phase 3D-A is approved and ready to freeze. No commit or push has been performed for any Phase 3D-A work yet — the approved snapshot must be committed/pushed before Phase 3D-B (C07) work begins.

---

## 2. Completed Features

- C03 `INVALID_SIGNATURE_TEST` chaos mechanism execution — Test Mode / `SYNTHETIC_DEMO` only, matching the frozen registry entry (`scenario_id=C03`, `fault_type=INVALID_SIGNATURE_TEST`, `data_classification=SYNTHETIC_DEMO`).
- **Verification-only runtime boundary**: the production executor calls the real, unmodified `verifyWebhookSignature` (`lib/razorpay/webhook-verification.ts`) directly — it does not invoke the webhook Route Handler, `lib/webhooks/service.ts`, any webhook/event-processing persistence repository, or the merchant processor, either directly or transitively.
- Exactly two fixed runtime cases, always in order: `WRONG_SIGNATURE` then `MISSING_SIGNATURE` — never caller-configurable, never a third case, never `MODIFIED_BODY` in production (that proof lives in an offline unit test only, using a synthetic test-only secret).
- No production HTTP/network call anywhere in the runtime mechanism — no `fetch`, no `http.request`/`https.request`, no `axios`, no `NextRequest` construction.
- No arbitrary target — the executor's only input is an internal `chaos_runs.id`.
- No webhook persistence path and no merchant mutation path — structurally impossible by the module's own import graph, not merely unexercised in this run.
- Successful mechanism execution → `status=COMPLETED`, `outcome=UNKNOWN` — Phase 3F remains authoritative for PASS/FAIL; C03 never decides a merchant-reliability verdict itself.
- Technical execution failure (a genuine verifier/config/infrastructure exception after `RUNNING` was claimed) → `status=FAILED`, `outcome=ERROR` — never fabricated for a run whose execution never started.
- PRE-SEC-007 (required server secrets exist) enforced immediately before execution, using the existing `getRazorpayWebhookSecret()` accessor — its return value is discarded, never used to construct a signature.
- **Durable BLOCKED proof requirement**: a PRE-SEC-007 failure only ever reports `outcome=BLOCKED` to a caller after independently verifying the exact durable row shape the database actually persisted (`execution_block_code=PRE-SEC-007`, `failed_precheck_id=NULL`, `started_at=NULL`, etc.) — a throw, `null`, lost race, or unexpected shape from the block-transition repository call instead reports a distinct `BLOCK_PERSISTENCE_FAILED` condition (mapped to a generic safe 500), and never claims BLOCKED without database proof.
- PRE-SEC-010 (operator/session authorization) enforced by the untrusted execution API route (`app/api/chaos/runs/[runId]/execute-c03/route.ts`), reusing the existing `getAccessGateEnv()`/`verifySessionToken()`/`ACCESS_SESSION_COOKIE_NAME` primitives — never a caller-supplied `authorized: true`, mirroring the frozen Phase 3C replay route's protections exactly (UUID path validation, same-origin defense-in-depth, no request body read).

---

## 3. Files Changed

**Added:**

```text
lib/chaos/c03-execution-service.ts
app/api/chaos/runs/[runId]/execute-c03/route.ts
tests/unit/chaos/c03-execution-service.test.ts
tests/unit/chaos/c03-static-guard.test.ts
tests/unit/api/chaos-c03-route.test.ts
tests/unit/api/webhooks-razorpay-route-modified-body.test.ts
tests/unit/api/webhooks-razorpay-route-signature-rejection.test.ts
tests/integration/supabase/055-chaos-c03-invalid-signature.integration.test.ts
handoffs/PHASE-3D-A-HANDOFF.md   (this document)
```

**Modified:**

```text
lib/chaos/run-repository.ts            — additive only: four new C03 lifecycle functions
                                          (blockPendingC03RunForPreSec007, startPendingC03RunAtomically,
                                          completeRunningChaosRunUnknown, failRunningChaosRunExecution)
                                          alongside the six frozen Phase 3B/3C functions, which remain
                                          byte-for-byte unchanged
tests/unit/chaos/run-repository.test.ts — module-surface allowlist test extended from six to ten
                                          approved exports
```

No frozen production file was modified: `app/api/webhooks/razorpay/route.ts`, `lib/webhooks/service.ts`, `lib/demo-merchant/service.ts`, `app/demo-merchant/actions.ts`, `lib/chaos/registry.ts`, `lib/chaos/types.ts`, `lib/chaos/safety-gate.ts`, `lib/chaos/repository.ts`, `lib/chaos/run-service.ts`, `lib/chaos/replay-repository.ts`, `lib/chaos/replay-service.ts`, the Phase 3D-0 migration, and every historical migration all remain byte-for-byte unchanged — verified by `git status`/`git diff` and by the static guard test reading the live webhook route source.

The two temporary manual-verification files created earlier in this engagement (`tests/integration/supabase/998-manual-c03-execute.integration.test.ts`, `tests/integration/supabase/999-manual-c03-prepare.integration.test.ts`) have been deleted per this finalization step and do not appear in the working tree.

---

## 4. Database Changes

**New migration in Phase 3D-A: NONE.**

Phase 3D-A depends entirely on the already-frozen, already-approved Phase 3D-0 schema (`supabase/migrations/20260831000000_phase3d_execution_safety.sql`), which contributed:

- `chaos_runs.execution_block_code` and its `PRE-SEC-007`-only CHECK constraint;
- the revised `chaos_runs_blocked_state_consistent`/`chaos_runs_pending_state_consistent` constraints supporting the execution-block shape;
- the C07 one-active-fault-per-order partial unique index.

None of these schema changes were introduced by Phase 3D-A — they are consumed as an already-approved dependency.

**Manual evidence row retained** (real Supabase, not deleted by this finalization step):

```text
chaos_runs.id = a0c5a66a-e70f-4e47-b9eb-0b3482c789d4
scenario_id           = C03
status                = COMPLETED
outcome               = UNKNOWN
fault_type            = INVALID_SIGNATURE_TEST
data_classification   = SYNTHETIC_DEMO
```

This row is **manual synthetic chaos evidence** produced by a controlled PayChaos-internal test — it is explicitly **not** genuine Razorpay Test Mode delivery evidence, and is not presented as such anywhere in this codebase or documentation. It carries no merchant entity correlation (`order_id`/`payment_attempt_id`/`payment_id`/`source_webhook_event_id` all `NULL`).

---

## 5. Architectural Decisions

**A. Production C03 does not invoke the webhook Route Handler.**
Reason: if signature validation ever regressed fail-open, a synthetic chaos request must still be structurally incapable of entering canonical webhook persistence — even when the merchant behavior under test is buggy, a controlled synthetic chaos test must never be capable of fabricating canonical provider evidence. Production path: C03 executor → the existing, real `verifyWebhookSignature` → a safe observation recorded in `fault_state`. No route, no `NextRequest`, no HTTP semantics.

**B. HTTP Route Handler rejection is tested separately, offline, with persistence collaborators mocked.**
Three proofs against the real unmodified route/service/verification chain: `WRONG_SIGNATURE`, `MISSING_SIGNATURE` (`tests/unit/api/webhooks-razorpay-route-signature-rejection.test.ts`), and `MODIFIED_BODY` (`tests/unit/api/webhooks-razorpay-route-modified-body.test.ts`).

**C. MODIFIED_BODY uses a fixed synthetic TEST-ONLY secret.**
Never the user's real `RAZORPAY_WEBHOOK_SECRET` — `lib/config/razorpay-webhook-env.ts`'s accessor is mocked to a hardcoded, obviously-synthetic value for that one offline test only.

**D. Unexpected acceptance is recorded as `UNEXPECTED_ACCEPTANCE`, but execution still reaches `COMPLETED`/`UNKNOWN`.**
A fail-open regression discovered at runtime is not itself a technical execution error — Phase 3F will decide whether that observation constitutes an invariant failure.

**E. PRE-SEC-007 cannot claim BLOCKED unless the durable returned `chaos_run` proves the exact BLOCKED shape.**
Verified persisted state is authoritative; a claim the database does not back is never acceptable (Correction Round 1, Blocker 1).

---

## 6. Test Results

```text
Focused correction suite:
  Test Files = 6 passed
  Tests      = 85 passed

Real Supabase 055:
  Test Files = 1 passed
  Tests      = 5 passed

Full real-Supabase integration:
  Test Files = 16 passed
  Tests      = 192 passed

Full unit:
  Test Files = 50 passed
  Tests      = 1037 passed

Typecheck: PASS

Lint: 0 errors
  1 pre-existing warning in:
  tests/integration/supabase/051-chaos-safety-gate.integration.test.ts

Build: PASS

Prettier: PASS after formatting

git diff --check: exit 0
  only Windows LF/CRLF warnings
```

---

## 7. Manual Verification

**Preparation** — real production creation path, no raw SQL insert:

```text
runChaosPrecheck({ scenarioId: "C03", mechanism: "C", faultType: "INVALID_SIGNATURE_TEST" })
  → PRECHECK_PASSED

createChaosRun(rawInput)
  → PERSISTED_PENDING

manual chaos run: a0c5a66a-e70f-4e47-b9eb-0b3482c789d4
```

**Pre-execution baseline** (freshly re-verified immediately before execution, matching the recorded preparation-time baseline):

```text
webhook_events            = 4
event_processing_attempts = 6
orders                    = 4
payment_attempts          = 4
payments                  = 3
fulfilments               = 2
```

**Execution** — `executeC03InvalidSignatureTest(chaosRunId)`, called exactly once, no retry, no loop, no `Promise.all`:

```text
WRONG_SIGNATURE   = REJECTED
MISSING_SIGNATURE = REJECTED
```

**Final persisted state:**

```text
status                        = COMPLETED
outcome                       = UNKNOWN
data_classification           = SYNTHETIC_DEMO
processingAttemptsForRun      = 0
syntheticCanonicalWebhookRows = 0
```

**Post-execution counts** (identical to the pre-execution baseline):

```text
webhook_events            = 4
event_processing_attempts = 6
orders                    = 4
payment_attempts          = 4
payments                  = 3
fulfilments               = 2
```

All six baseline comparisons: **SAME**.

**Manual execution test:**

```text
Test Files = 1 passed
Tests      = 1 passed
```

The two temporary files used to perform this manual sequence (`999-manual-c03-prepare.integration.test.ts`, `998-manual-c03-execute.integration.test.ts`) were explicitly one-off and have been deleted as part of this finalization step — they were never committed.

---

## 8. Security Evidence

- Test Mode only — no production Razorpay credentials, no production money.
- No Razorpay production call anywhere in the C03 path.
- No `fetch`/`http.request`/`https.request`/`axios` in the C03 production executor — confirmed by static source-guard tests.
- No arbitrary external target — the executor's only input is an internal `chaos_runs.id`; the route's only input is the `runId` path segment.
- No secret, signature, or raw payload persisted anywhere — `fault_state` carries only `{case, classification}` pairs.
- No caller-configurable payload/signature/count — the two runtime cases and their fixed inputs are hardcoded server-side.
- No canonical webhook persistence imports in the production C03 executor (`lib/webhooks/repository.ts`, `lib/webhooks/event-processing-repository.ts`) — statically proven absent.
- No merchant processor import (`lib/events/processor.ts`) — statically proven absent.
- The production webhook Route Handler remained byte-for-byte unchanged throughout Phase 3D-A.
- The actual configured webhook secret is never retrieved by the C03 executor to manufacture a test signature — `verifyWebhookSignature` uses it internally, transparently, exactly as the real route does.
- Deterministic money/state logic remains authoritative — C03 never decides PASS/FAIL; that remains Phase 3F's exclusive responsibility.

---

## 9. Known Issues

- The Vite integration config (`vitest.integration.config.ts`) emits the existing future-native-loader warning because the sequencer import lacks an explicit file extension — pre-existing, unrelated to Phase 3D-A.
- The existing lint warning remains in the untouched `051-chaos-safety-gate.integration.test.ts` (unused `no-console` eslint-disable directive).
- No C03 P0 functional blocker is currently known.

---

## 10. Deferred Work

```text
Money invariant PASS/FAIL evaluation   — deferred to Phase 3F
Evidence snapshot system               — deferred to Phase 3E
Findings                               — deferred to Phase 3G
UI                                     — deferred to Phase 3H
C07 (DROP_CLIENT_CONFIRMATION)         — begins only after 3D-A is architect-approved/frozen
C11                                    — remains untouched
```

---

## 11. Next Dependency

**Phase 3D-B — C07, DROP_CLIENT_CONFIRMATION.** Not implemented in this task. Phase 3D-A has now received architect approval; work on Phase 3D-B begins only AFTER the approved Phase 3D-A snapshot is committed/pushed and frozen, matching the same sequencing discipline every prior sub-phase in this engagement followed.

---

## 12. Phase Completion Checklist

```text
IMPLEMENTED            [x]
TESTED                 [x]
REAL SUPABASE VERIFIED [x]
MANUALLY VERIFIED      [x]
DOCUMENTED             [x]
APPROVED               [x]
```

Phase 3D-A received architect approval after implementation, automated verification, real Supabase regression verification, manual C03 verification, and final handoff review. Ready to freeze. Commit and push are the remaining steps to freeze this phase; Phase 3D-B (C07) must not begin until that freeze commit is made.
