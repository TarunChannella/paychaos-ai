# Phase 3C — Controlled Replay Engine Handoff

**Project:** PayChaos AI — Autonomous Payment Reliability Engineer
**Branch:** `phase-3-chaos-engine`
**Frozen Phase 3B baseline commit:** `ab2948de95c05b57471eab5ff65ef612325443d5`
**Sub-phase:** Phase 3C — Controlled Replay (`docs/PHASE_PLAN.md` Phase 3C: "Implement replay of previously verified Razorpay Test Mode evidence through the internal event processor")

---

## 1. Phase Identity / Objective

Phase 3C is the third Phase 3 sub-phase: the **Controlled Replay Engine**, and the first Phase 3 sub-phase that actually executes a chaos mechanism. It sits between the frozen, approved Phase 3B Chaos Run Model (durable `chaos_runs` audit persistence, zero execution) and the not-yet-implemented Phase 3D (C03/C07/C11 controlled failure injection). Phase 3C's scope is exactly one scenario — **C01, Duplicate Webhook Delivery** — implemented as a controlled internal replay of already-verified, already-persisted Razorpay Test Mode evidence through the existing, unmodified Phase 2F merchant event processor. It owns: the one narrow, architect-approved Phase 2F compatibility change; the replay source-resolution/insertion repository; the replay execution orchestration service; the atomic run-lifecycle transitions C01 needs; and the first untrusted HTTP execution boundary this codebase exposes. It does not implement any other scenario, any invariant evaluation, any evidence snapshot, or any UI.

---

## 2. Status

```text
IMPLEMENTED                        = YES
TESTED                             = YES
REMOTE MIGRATION APPLIED           = YES
REAL SUPABASE INTEGRATION VERIFIED = YES
MANUALLY VERIFIED                  = YES
DOCUMENTED                         = YES

APPROVED                           = YES
```

Phase 3C received architect approval after implementation, automated verification, real Supabase regression verification, authentic Razorpay Test Mode manual verification, and final handoff review. No commit or push has been performed for any Phase 3C work.

---

## 3. Completed Features

- Controlled internal C01 replay of already-persisted, already-verified authentic Razorpay Test Mode evidence — never a fabricated/synthetic webhook presented as genuine.
- Execution of an already-persisted `PENDING` `chaos_runs` row only — no in-memory-only run may ever execute (PRE-SEC-011 continuity from Phase 3B).
- Fixed server-side exactly-two replay attempts (`C01_REPLAY_ATTEMPT_COUNT = 2`) — never caller-configurable.
- `PAYCHAOS_REPLAY` execution provenance on every replay processing attempt, cleanly distinguished from the original evidence's own provenance (Section 8).
- Canonical `webhook_events` preservation — replay never creates a second canonical row and never mutates the original.
- `duplicate_delivery_count` is never incremented by a replay — that field represents genuine provider redelivery only.
- Atomic `PENDING → RUNNING` claim (single conditional `UPDATE ... WHERE status='PENDING' RETURNING`) — no SELECT-then-UPDATE race window.
- `RUNNING → COMPLETED/UNKNOWN` on successful mechanism execution; a best-effort `FAILED/ERROR` finalization if that final transition itself cannot be durably persisted (Section 7).
- Technical execution failure (during either replay attempt) → `FAILED/ERROR`, never a fabricated `PASS`/`FAIL` merchant-reliability verdict.
- Safe, deterministic failed-replay-attempt audit: a replay attempt that fails processor validation is itself durably marked `FAILED` with a safe code/message via the existing `markEventProcessingAttemptFailedIfNotFinal` — never left `PENDING`, never a raw Postgres/Supabase error persisted.
- Defense-in-depth source-envelope revalidation: the resolver re-checks `normalized_event.sourceKind`/`kind`/`eventType` agreement against the canonical webhook at replay time, not just at original-processing time — a historical `SUCCEEDED` status alone is not trusted as permanent proof the row is unchanged.
- The first untrusted HTTP execution boundary in this codebase: `POST /api/chaos/runs/[runId]/replay`, taking only the `runId` path segment — no body configuration, no caller-supplied target/count/authorization.
- Route-level same-origin defense-in-depth (`Sec-Fetch-Site`/`Origin` check) — no generic CSRF framework added.
- PRE-SEC-010 (operator/session authorization) implemented by reusing the existing `getAccessGateEnv()`/`verifySessionToken()`/`ACCESS_SESSION_COOKIE_NAME` primitives — never a caller-supplied `authorized: true`.
- PRE-SEC-011 continuity — unchanged from Phase 3B, satisfied structurally by `chaos_runs` itself.
- C01's PRE-SEC-007 decision: **no additional Razorpay secret is required** for internal replay, because the source is already signature-verified, persisted evidence — the event was authenticated once, at original ingestion; replay never re-authenticates it.
- No arbitrary target/URL/host/endpoint/caller-controlled replay count anywhere in the execution path — confirmed both by code inspection and by static/unit test coverage.

---

## 4. Files Changed

**Added:**

```text
supabase/migrations/20260830000000_phase3c_controlled_replay.sql
lib/chaos/replay-repository.ts
lib/chaos/replay-service.ts
app/api/chaos/runs/[runId]/replay/route.ts
tests/unit/chaos/replay-repository.test.ts
tests/unit/chaos/replay-service.test.ts
tests/unit/api/chaos-replay-route.test.ts
tests/unit/supabase/053-chaos-replay-provenance-guard.test.ts
tests/integration/supabase/053-chaos-replay-execution.integration.test.ts
handoffs/PHASE-3C-HANDOFF.md   (this document)
```

**Modified:**

```text
lib/chaos/run-repository.ts   — additive only: three new C01 lifecycle functions
                                 (startPendingC01RunAtomically, completeRunningC01RunUnknown,
                                 failRunningC01RunExecution) alongside the three frozen Phase 3B
                                 functions, which are byte-for-byte unchanged
lib/supabase/types.ts         — event_processing_attempts gains chaos_run_id (nullable),
                                 source_kind widened to exactly REAL_RAZORPAY_WEBHOOK |
                                 PAYCHAOS_REPLAY (new EventProcessingAttemptSourceKind type)
docs/DATABASE.md              — event_processing_attempts: chaos_run_id documented as
                                 implemented; new "Column/Value Phasing Note" distinguishing
                                 currently-enabled vs. still-deferred source_kind values;
                                 Phase Ownership split into Phase 3B / Phase 3C / Later Phase 3
tests/unit/chaos/run-repository.test.ts        — extended for the three new lifecycle functions
tests/unit/supabase/migration.test.ts          — new Phase 3C describe block (structural coverage
                                                  + Finding 4 differential regression proof)
tests/unit/supabase/server.test.ts             — chaos_run_id removed from the forbidden-field
                                                  list (fault_action/state_before/state_after
                                                  remain forbidden); new source_kind-scope assertion
tests/integration/supabase/049-event-processing-attempts.integration.test.ts
                                — the one "invalid source_kind" test's probe value changed from
                                  PAYCHAOS_REPLAY (now legitimately valid) to a truly bogus value
```

No frozen Phase 3A file (`lib/chaos/types.ts`, `registry.ts`, `safety-gate.ts`, `repository.ts`, or their test files) was touched. No frozen Phase 3B file's exported behavior changed — `run-repository.ts`'s three original functions and all of `run-service.ts` are unmodified.

---

## 5. Database Changes

**Migration:** `supabase/migrations/20260830000000_phase3c_controlled_replay.sql` — **applied to the real Supabase project** (Supabase SQL Editor result: `Success. No rows returned`).

This migration does **not** edit either historical, already-applied migration file on disk (`20260827000000_phase2e_webhook_dedup.sql`, `20260828000000_phase2f_merchant_processing.sql` — both remain byte-for-byte unchanged). Every change is either a new additive statement or a `CREATE OR REPLACE FUNCTION` with an unchanged signature.

**`event_processing_attempts.chaos_run_id`** — new nullable FK → `chaos_runs.id`, `ON DELETE RESTRICT`, plus its own index (`event_processing_attempts_chaos_run_id_idx`). NOT NULL for `PAYCHAOS_REPLAY` rows (see provenance CHECK below); nullable for `REAL_RAZORPAY_WEBHOOK` rows — the column comment was corrected mid-review to say only that a genuine delivery _ordinarily_ carries no chaos-run link, not that the schema forbids one, since a future Phase 3 scenario may legitimately correlate real provider processing with a chaos run.

**`source_kind` CHECK widened ONLY to:**

```text
REAL_RAZORPAY_WEBHOOK
PAYCHAOS_REPLAY
```

`PAYCHAOS_SIMULATION` and `TEST_FIXTURE` remain **approved future target values** (`docs/DATABASE.md` Section 14) that are **not enabled** by the current database CHECK constraint — they stay unimplemented surface until the later phases that actually produce them (C07/C11 fault mechanisms, fixture work) exist. This document does not claim otherwise.

**`event_processing_attempts_replay_provenance_valid`** — new CHECK: a `PAYCHAOS_REPLAY` row must have `webhook_event_id IS NOT NULL`, `chaos_run_id IS NOT NULL`, and `is_duplicate_delivery = false`. A replay references genuine canonical evidence but is explicitly never a genuine duplicate provider delivery.

**`process_webhook_payment_event(uuid)`** — revised via `CREATE OR REPLACE FUNCTION` with the identical signature. The processing-attempt provenance admission gate now accepts `PAYCHAOS_REPLAY` (requiring `chaos_run_id IS NOT NULL` and `is_duplicate_delivery = false`) in addition to `REAL_RAZORPAY_WEBHOOK`; every other line of Phase 2F business logic — lock order, envelope validation, `payment.captured`/`payment.failed`/`order.paid` branches, fulfilment idempotency, error codes — is unchanged (see Section 6). `normalized_event.sourceKind` must still equal `REAL_RAZORPAY_WEBHOOK` regardless of the attempt's own `source_kind`, and the correlated canonical `webhook_events` row must still independently be `REAL_RAZORPAY_WEBHOOK`/`signature_verified = true` — both checks are byte-for-byte unchanged from Phase 2F.

**Execute privilege** on `process_webhook_payment_event` remains `service_role`-only — `REVOKE ALL ... FROM PUBLIC` and `GRANT EXECUTE ... TO service_role` are re-asserted explicitly in the new migration (Postgres already preserves grants across a same-signature `CREATE OR REPLACE`, but this codebase's convention is to state them explicitly in every migration that touches a function). No RLS/policy/grant surface was widened anywhere in this migration.

No historical migration file was edited. No new table was created.

---

## 6. Phase 2F Compatibility Decision

The frozen Phase 2F `process_webhook_payment_event` unconditionally rejected any `event_processing_attempts` row whose `source_kind` was not exactly `REAL_RAZORPAY_WEBHOOK` — a hard blocker discovered during Phase 3C preparation review, since Phase 3C's entire purpose requires that same processor to accept `PAYCHAOS_REPLAY` attempts. The architect explicitly approved a narrow, signature-preserving `CREATE OR REPLACE FUNCTION` compatibility revision through the new Phase 3C migration, never an edit to the applied Phase 2F file.

**Differential regression proof:** `tests/unit/supabase/migration.test.ts` contains a dedicated static test (Finding 4) that extracts both function bodies from their respective migration files, strips all `--` comments, collapses whitespace, substitutes the Phase 3C admission block back to the frozen Phase 2F admission block in the normalized text, and asserts **byte-for-byte equality** with the normalized Phase 2F body. This test passed, confirming the Phase 3C RPC body is semantically identical to frozen Phase 2F outside the one approved admission-block delta — no unrelated business logic, lock ordering, correlation validation, fulfilment logic, `payment.failed` precedence, supported-event set, or final-state update changed.

---

## 7. Lifecycle Decision

**Successful Phase 3C mechanism execution:**

```text
status  = COMPLETED
outcome = UNKNOWN
```

`UNKNOWN` is intentional — Money Invariant evaluation does not run until Phase 3F. `COMPLETED` means only that the chaos mechanism itself finished; it is explicitly not a merchant-reliability verdict.

**Technical execution failure** (during a replay attempt, or if the final `COMPLETED`/`UNKNOWN` transition itself cannot be durably persisted after both replay attempts succeeded):

```text
status  = FAILED
outcome = ERROR
```

Merchant reliability FAIL is **never** inferred in Phase 3C — a technical execution failure is not evidence the merchant is unreliable, only that the replay mechanism could not complete/finalize. `COMPLETED + ERROR` remains explicitly reserved for a future pipeline stage (Phase 3F+) where the chaos mechanism itself durably completed but a later deterministic evaluation/evidence stage cannot produce a valid judgment — Phase 3C never produces that shape.

Both `chaos_runs_pending_state_consistent` and `chaos_runs_blocked_state_consistent` (frozen Phase 3B CHECK constraints) were re-verified to be silent on `RUNNING`, `COMPLETED`+`UNKNOWN`, and `FAILED`+`ERROR` — no schema contradiction exists with this decision.

---

## 8. Provenance Model

Three distinct fields, three distinct meanings — never collapsed:

| Field                                                                           | Meaning                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event_processing_attempts.source_kind = PAYCHAOS_REPLAY`                       | **Execution provenance** — this row records PayChaos's own internal replay of evidence, not a fresh provider delivery.                                      |
| `event_processing_attempts.normalized_event.sourceKind = REAL_RAZORPAY_WEBHOOK` | **Original evidence provenance** — copied verbatim from the original attempt; describes where the underlying evidence came from, never rewritten by replay. |
| `webhook_events.source_kind = REAL_RAZORPAY_WEBHOOK`                            | **Canonical provider evidence** — the one, never-duplicated, never-mutated real Razorpay delivery record. A replay never creates or alters this row.        |

A `PAYCHAOS_REPLAY` processing attempt is therefore simultaneously: PayChaos's own execution artifact (`source_kind`), truthfully describing genuine original evidence (`normalized_event.sourceKind`), correlated to an untouched canonical provider record (`webhook_events`).

---

## 9. Automated Test Evidence

Recorded exactly as run, with dates/attempts noted where relevant — no fabricated aggregate figures.

**Real Supabase (post-migration):**

```text
Focused: tests/integration/supabase/053-chaos-replay-execution.integration.test.ts
→ Test Files 1 passed (1), Tests 11 passed (11)

Full suite: npx vitest run --config vitest.integration.config.ts
→ Test Files 14 passed (14), Tests 177 passed (177)
   (includes 045 demo-merchant, 050 merchant processing, 051 chaos safety gate,
   052 chaos run persistence, 053 controlled replay, 05 final-state cleanup — all PASS)
```

**Offline unit (this task's final verification pass):**

```text
npm run test
→ Test Files 41 passed | 4 failed (45), Tests 962 passed | 4 failed (966)
   The full offline run had four 5-second timeouts under parallel load,
   including one Phase 3C route-test file and three pre-existing access/
   middleware files:
     tests/unit/middleware.test.ts               — pre-existing/unrelated
     tests/unit/api/access-login-route.test.ts    — pre-existing/unrelated
     tests/unit/api/access-logout-route.test.ts   — pre-existing/unrelated
     tests/unit/api/chaos-replay-route.test.ts    — Phase 3C test file
   An immediate isolated run of exactly those four files passed 38/38
   (Test Files 4 passed (4), Tests 38 passed (38)), supporting
   classification as environmental/resource contention (Windows/OneDrive
   worker startup under full-suite parallel load) rather than an
   assertion/content regression. This is recorded precisely, not smoothed
   over: no single clean 966/966 full run occurred in this task; the
   closest true figures are 962/966 (one full attempt) plus 38/38 (isolated
   re-confirmation of every file that failed, including the one Phase 3C
   file among them).

npm run typecheck → PASS (clean)
npm run lint       → PASS (0 errors; 1 pre-existing warning, unrelated,
                     frozen 051-chaos-safety-gate.integration.test.ts)
npm run build      → PASS (only the pre-existing Next.js middleware→proxy
                     deprecation notice)
Prettier           → PASS (clean on every Phase 3C file)
git diff --check   → PASS (clean; only informational CRLF line-ending notices)
```

**Targeted unit suites (all independently re-confirmed clean during this engagement, most recently in the round immediately prior to this handoff):**

```text
tests/unit/supabase/053-chaos-replay-provenance-guard.test.ts → 6/6
tests/unit/api/chaos-replay-route.test.ts → 17/17
tests/unit/chaos/replay-repository.test.ts + replay-service.test.ts + run-repository.test.ts → 77/77
tests/unit/supabase/migration.test.ts + server.test.ts (+ provenance guard) → 177/177
```

---

## 10. Cleanup Defect History (integration-fixture reliability engineering)

`053-chaos-replay-execution.integration.test.ts`'s `afterAll` cleanup went through three correction rounds during development — documented here because it demonstrates real evidence-based debugging, not because it affected any functional C01 assertion:

1. **Round 1**: the original cleanup order (`event_processing_attempts` → `chaos_runs` → `fulfilments` → `payments` → `webhook_events`) violated `fulfilments.trigger_processing_attempt_id → event_processing_attempts` (`ON DELETE RESTRICT`) — deleting all tracked attempts in one `.in(...)` chunk while a `fulfilments` row still referenced one aborted the entire statement, leaving all 15 tracked attempt ids (and, by the same mechanism, the tracked `chaos_runs` ids) undeleted in one real run.
2. **Round 2**: after reordering `fulfilments` first, a second real run exposed a missed edge — `webhook_events.payment_id → payments` (`ON DELETE RESTRICT`, Phase 2D) — `payments` was still being deleted before `webhook_events`.
3. **Round 3**: the cleanup also incorrectly assumed `payment_attempts`/`orders` were cleaned up by a "shared integration-suite final-state convention". Inspection of `05-final-state.integration.test.ts` and `helpers.ts` confirmed no such convention exists — that file only _verifies_ tracked ledgers are empty, it never deletes; every other file in the suite deletes its own created orders/payment_attempts directly. This gap caused a leaked-row incident: 10 orders/10 payment_attempts per successful 053 run were never deleted, which in turn caused `045-demo-merchant-service.integration.test.ts` to fail separately (a leaked `FULFILLED` order whose `fulfilments` row 053 _had_ correctly deleted violated the domain invariant "`FULFILLED` requires ≥1 fulfilment" — correct production behavior detecting a genuine leak, not a bug in `045`).

Each round: the functional C01 replay/mechanics assertions passed throughout (11/11 in every run) — only cleanup ordering/completeness was ever wrong. The 20 leaked rows from two successful runs (10 + 10) were identified with a narrow, read-only, provenance-scoped SQL query (using 053's own unique `payments`-table ownership and label-tagged `razorpay_receipt` pattern — no other suite file creates `payments` rows at all) before any deletion was designed, and removed with fail-closed, exact-ID-scoped deletes only — never a broad/prefix/table-wide delete. **No genuine historical Phase 2 evidence was mutated or deleted during the cleanup incident or cleanup recovery. Existing Phase 2G evidence was read only for regression confirmation** — `053`'s own "historical real Phase 2 evidence remains unchanged" describe block explicitly reads the known genuine Phase 2G order/payment (read-only `SELECT`s) on every run, and the real-Supabase results confirmed "the known real Phase 2G order/payment are untouched by this file's mechanics tests." Reading it for regression confirmation was intended and correct; only mutation or deletion would have been a violation, and neither occurred.

**Final, verified-correct cleanup order:**

```text
fulfilments → event_processing_attempts → chaos_runs → webhook_events → payments → payment_attempts → orders
```

Final focused `053` run: **11/11 PASS** (functional) with clean cleanup. Final full Supabase suite: **177/177 PASS**, including `05-final-state` cleanup verification.

---

## 11. Manual Verification — Authentic C01 Replay (genuine Razorpay Test Mode evidence)

Performed against the deployed Vercel Demo Merchant's real Razorpay Test Mode integration — **not synthetic data**:

```text
fresh Vercel Demo Merchant order
  → real Razorpay Test Mode order (order_TUTAwB0hwX5mZi)
  → Razorpay Test Mode successful payment (pay_TUTFdgnaTJGpu4)
  → genuine signature-verified payment.captured webhook (event TUTFlxH8Xe8NgV)
  → C01 precheck: PRECHECK_PASSED (real runChaosPrecheck call, no synthesis)
  → exactly one RECORDED_TEST_EVIDENCE PENDING chaos_run created via the real
    createChaosRun(rawInput) production path (chaos_run 40a08f61-11dd-48c1-9460-238166150283)
  → executeC01Replay(chaosRunId) invoked exactly once (lib/chaos/replay-service.ts)
  → exactly 2 PAYCHAOS_REPLAY attempts created (2eedbad2-3385-41b3-a386-075080091046,
    f2449505-6805-483a-beb9-96b1696999a2), both SUCCEEDED
  → canonical webhook_events remained exactly 1 row, source_kind=REAL_RAZORPAY_WEBHOOK,
    signature_verified=true, duplicate_delivery_count=0 (unchanged before/after)
  → original REAL processing attempt (1780186f-b414-4f16-a04a-6e14182f51b3) unchanged:
    status=SUCCEEDED, source_kind=REAL_RAZORPAY_WEBHOOK, chaos_run_id=NULL
  → payment remained captured; order remained payment_status=PAID, business_status=FULFILLED
  → fulfilment count remained exactly 1 (same fulfilment row before and after)
  → chaos_run reached status=COMPLETED, outcome=UNKNOWN
```

Internal Order ID `3aa79377-57f1-4c7e-9b53-5762fcc8fb4b`; Payment Attempt `ea8dca4e-4164-42b8-8ffe-8c1ed172f460`; Payment `a5afbc15-1773-4896-926b-c5cbd2e48868`. All verification performed via targeted, temporary, read-only-except-one-mutation scripts that were deleted immediately after use — no leftover tooling in the repository, no repeated execution, no retry.

**This is genuine Razorpay TEST MODE evidence** — not a synthetic fixture, and not reused/mutated historical Phase 2G evidence. It is preserved durably in the real Supabase project as the record of this manual verification and must not be deleted.

---

## 12. Security

- Test Mode only throughout — no production Razorpay credentials, no production money.
- No arbitrary external target — `executeC01Replay`'s only input is an internal `chaos_runs.id`; the route's only input is the `runId` path segment.
- No raw webhook fabrication — replay always copies the original, already-verified `normalized_event` verbatim; it is never recomputed or synthesized.
- No Razorpay API request during replay — confirmed by design (the replay path never imports the Razorpay adapter) and by manual verification.
- No public webhook HTTP request during replay — replay never calls `POST /api/webhooks/razorpay`.
- No secrets logged or persisted anywhere in the replay path — `error_message_redacted` only ever carries fixed, safe strings; `logEvent` calls carry only safe category/name fields.
- The execution route accepts only `runId` — no body is read, no caller-supplied target/count/authorization field exists anywhere in its code.
- Authorization is derived entirely server-side, reusing the existing `getAccessGateEnv()`/`verifySessionToken()` primitives — never a caller-supplied `authorized: true`.
- Same-origin defense-in-depth (`Sec-Fetch-Site`/`Origin` check) on the route — no new CSRF dependency introduced.
- RLS/service-role boundaries are unchanged — no policy was added, no grant was widened beyond the function's own `service_role`-only execute privilege.

---

## 13. Known Issues

- The Phase 3C replay route (`POST /api/chaos/runs/[runId]/replay`) has **not** been exercised through a newly deployed Vercel build. The manual verification in Section 11 exercised the underlying production **service** (`executeC01Replay`) directly, locally, against the real Supabase project — the currently deployed Vercel build predates this route. The production _service_ behavior is manually verified; the _deployed HTTP route_ is not yet manually verified end-to-end through Vercel. Full deployment/UI integration belongs to the later Phase 3H/Phase 5 flow.
- Windows/OneDrive Vitest worker/test-timeout environmental noise recurred during this task's final offline verification (Section 9) — recorded precisely there, not smoothed into a false clean-run claim.
- Non-blocking, pre-existing, out-of-scope items carried forward unchanged: the unused `no-console` eslint-disable warning in the frozen `051-chaos-safety-gate.integration.test.ts`; the Next.js `middleware`→`proxy` deprecation notice; Vite's `configLoader: 'native'` warning about the extensionless sequencer import.

---

## 14. Deferred to Phase 3D and Beyond

```text
Phase 3D — C03 / C07 / C11 controlled failure injection
Phase 3E — before/after evidence snapshots
Phase 3F — money invariant evaluation and PASS/FAIL
Phase 3G — findings
Phase 3H — UI + final Phase 3 manual demo integration
Phase 4  — diagnosis / recommendations / reliability score / AI differentiators
```

---

## 15. Dependencies / Frozen Contracts for Phase 3D+

Phase 3D onward may treat the following as stable and depend on them directly — **do not redesign casually**:

```text
Canonical webhook_events never represents a PayChaos replay — a replay always correlates
  to the SAME original row, never creates or mutates one
event_processing_attempts.source_kind = PAYCHAOS_REPLAY is execution provenance only
normalized_event retains its original REAL_RAZORPAY_WEBHOOK sourceKind through replay,
  unrewritten
C01's exactly-two replay constant (C01_REPLAY_ATTEMPT_COUNT) unless formally redesigned
  through the same architect-review process
No caller-controlled arbitrary target, host, endpoint, or replay count anywhere in the
  execution path
Atomic PENDING -> RUNNING claim via a single conditional UPDATE ... RETURNING — never a
  SELECT-then-UPDATE race
COMPLETED + UNKNOWN is the correct successful-execution shape before Phase 3F exists
FAILED + ERROR is reserved for technical execution failures only, never a merchant-
  reliability verdict
Route/session authorization reuses lib/access/session.ts + lib/config/access-env.ts —
  never a caller-supplied authorized boolean
Source-envelope revalidation (sourceKind/kind/eventType agreement with the canonical
  webhook) at replay time, not just at original-processing time
Phase 2F processor semantics (lock order, envelope validation, fulfilment idempotency,
  error codes) are byte-for-byte preserved outside the one approved admission-block delta
The authentic manual C01 evidence recorded in Section 11 (chaos_run
  40a08f61-11dd-48c1-9460-238166150283 and its correlated rows) must remain durable —
  do not delete it
```

Any genuine schema or behavior change requires the same architect-review process this phase itself went through — not a silent redesign.

---

## 16. Phase Completion Checklist

```text
IMPLEMENTED                        [x]
TESTED                             [x]
REMOTE MIGRATION APPLIED           [x]
REAL SUPABASE INTEGRATION VERIFIED [x]
MANUALLY VERIFIED                  [x]
DOCUMENTED                         [x]
APPROVED                           [x]
```

Phase 3C received architect approval after implementation, automated verification, real Supabase regression verification, authentic Razorpay Test Mode manual verification, and final handoff review. Commit and push are the remaining steps to freeze this phase; Phase 3D must not begin until that freeze commit is made.
