# Phase 3D-D — C11-B `REAL_WEBHOOK_EVENT` Controlled Runtime Replay/Execution Handoff

**Project:** PayChaos AI — Autonomous Payment Reliability Engineer
**Branch:** `phase-3-chaos-engine`
**Frozen Phase 3D-C commit:** `a5fcadf96b03a8e1614abbd3bcc8ee9aecb661cd`
**Sub-phase:** Phase 3D-D — C11 (Failed Payment Must Never Mark Order Paid, `docs/CHAOS_SCENARIOS.md` Section 23) — Mechanism B, `failureEvidence.kind = REAL_WEBHOOK_EVENT`, controlled runtime replay/execution of the already-captured authentic `payment.failed` webhook. NOT C11-A manual observation (Phase 3D-D/E), NOT runtime `TEST_FIXTURE` execution (still permanently blocked — see Section 9).

---

## 1. Status

```text
IMPLEMENTED         = YES
TESTED              = YES
MANUALLY VERIFIED   = YES
DOCUMENTED          = YES

APPROVED            = YES
```

The real, authenticated end-to-end manual verification against the known real event (`webhook_event_id e0df759e-bbde-45c3-aa80-a5a2d6b61be9`) was performed as a two-step, architect-authorized one-shot procedure (preflight + PENDING-run creation, then execution) using temporary manual-verification helpers that were deleted immediately after architect review — see Section 12 "Manual Authentic Verification" below. Phase 3D-D is architect-approved.

## 2. Objective

Implement the LIVE/AUDITED automated C11-B execution path: given an already-persisted, eligible `chaos_runs` row (`scenario_id = C11`, `fault_type = null`, `data_classification = RECORDED_TEST_EVIDENCE`, `status = PENDING`, correlated to a real captured `payment.failed` webhook event), independently re-resolve the ONE authoritative source evidence, execute exactly one `PAYCHAOS_REPLAY` processing attempt through the existing, unmodified merchant processor, collect (never invariant-gate) post-replay merchant-state evidence, and durably finalize the run — all without a migration, without touching C01, without runtime `TEST_FIXTURE` support, and without any Razorpay/network call.

---

## 3. Architecture Confirmed / No Staleness Found (beyond the correction below)

C11 has two sources: A) genuine Test Mode failure observation (C11-A, deferred) and B) replay of already-captured authentic `payment.failed` evidence (C11-B, this phase). Phase 3D-C's `TEST_FIXTURE` remains test-infrastructure-only permanently — `failureEvidence.kind = TEST_FIXTURE` still cannot reach runtime `PRECHECK_PASSED` (regression-tested, Section 9 below). C11-B uses ONLY `failureEvidence.kind = REAL_WEBHOOK_EVENT`, already handled by the frozen `createChaosRun`. No migration was needed — `event_processing_attempts.source_kind = PAYCHAOS_REPLAY` and `chaos_run_id` were already accepted by the existing schema.

**Correction applied to `handoffs/PHASE-3D-C-HANDOFF.md`** (Sections 15/16 were stale): they previously described Phase 3D-D as requiring its own migration for `event_processing_attempts.source_kind` and as replaying "this fixture" (the TEST_FIXTURE). Both were wrong once this phase's actual architecture was confirmed. Corrected in place to state: no migration required (reuses already-accepted `PAYCHAOS_REPLAY`), and C11-B replays the real captured webhook (`e0df759e-bbde-45c3-aa80-a5a2d6b61be9`), never the TEST_FIXTURE.

---

## 4. Files Changed

**New:**

```text
lib/chaos/c11-execution-service.ts
app/api/chaos/runs/[runId]/execute-c11-b/route.ts
tests/unit/chaos/c11-execution-service.test.ts
tests/unit/api/chaos-c11-route.test.ts
tests/unit/chaos/c11-runtime-static-guard.test.ts
tests/unit/supabase/058-chaos-c11-real-webhook-replay-provenance-guard.test.ts
tests/integration/supabase/058-chaos-c11-real-webhook-replay.integration.test.ts
handoffs/PHASE-3D-D-HANDOFF.md   (this document)
```

**Modified (additive only — no existing exported function renamed/changed):**

```text
lib/chaos/replay-repository.ts
  + resolveAuthoritativeC11ReplaySource(...)  (new, additive)
  + C11ReplaySourceQuery / ResolvedC11ReplaySource types
  resolveAuthoritativeC01ReplaySource unchanged; verified by a dedicated
  regression assertion that it remains exported and unchanged.

lib/chaos/run-repository.ts
  + startPendingC11BRunAtomically(...)
  + completeRunningC11BRunUnknown(...)
  + failRunningC11BRunExecution(...)
  All three new, C11-specific, scoped strictly by scenario_id=C11 /
  fault_type IS NULL / data_classification=RECORDED_TEST_EVIDENCE — never
  renamed/reused from the frozen C01 lifecycle functions.

tests/unit/chaos/replay-repository.test.ts
  + ~20 tests covering resolveAuthoritativeC11ReplaySource

tests/unit/chaos/run-repository.test.ts
  + ~10 tests covering the three new C11-B lifecycle functions
  module-surface allowlist updated (fifteen -> eighteen approved exports)

handoffs/PHASE-3D-C-HANDOFF.md
  Sections 15/16 corrected — see Section 3 above.
```

**Untouched (confirmed by regression + static guards):** `lib/chaos/replay-service.ts` (C01), `lib/chaos/repository.ts` (TEST_FIXTURE resolver, still always returns `null`), `lib/chaos/safety-gate.ts`, `lib/chaos/run-service.ts`, `lib/events/processor.ts`, `lib/events/normalization.ts`, `lib/webhooks/*`, `lib/supabase/types.ts`, every migration, `app/api/chaos/runs/[runId]/replay/route.ts` (C01 route).

---

## 5. Database Changes

**NONE.** No migration. `event_processing_attempts.source_kind = PAYCHAOS_REPLAY` and `chaos_run_id` were already accepted by the schema (Phase 3C). No CHECK constraint was modified.

---

## 6. `lib/chaos/c11-execution-service.ts` — Sequence

`executeC11RealWebhookReplay(chaosRunId: string)` is the single trusted entry point (mirrors `executeC01Replay` exactly, narrowed to C11):

1. load the persisted `chaos_run` (PRE-SEC-011 — must already exist);
2. require it eligible: `scenario_id=C11`, `status=PENDING`, `fault_type=null`, `data_classification=RECORDED_TEST_EVIDENCE`, `source_webhook_event_id` present;
3. independently re-resolve the ONE authoritative source via `resolveAuthoritativeC11ReplaySource` (never trusts anything cached on the run row beyond its own correlation fields);
4. PRE-SEC-007: nothing additional required — the event was already authenticated when the canonical evidence was created;
5. atomically claim `PENDING -> RUNNING` (`startPendingC11BRunAtomically`);
6. create exactly `C11_REPLAY_ATTEMPT_COUNT` (= 1, fixed, server-owned, never `C01_REPLAY_ATTEMPT_COUNT`) new `PAYCHAOS_REPLAY` processing attempt, copying the original `normalized_event` VERBATIM, run through the existing, unmodified `processMerchantWebhookEvent`;
7. read (never invariant-gate on) post-replay merchant state (`readC11PostReplayMerchantState` — new, reads `orders`/`payment_attempts`/`payments`/`fulfilments`; a genuine read failure is `FAILED`/`POST_STATE_VERIFICATION_FAILED`, but the CONTENT of a successful read never itself decides `COMPLETED` vs `FAILED` — Phase 3F alone owns INV-003/INV-004/INV-011);
8. mark the run `COMPLETED`/`UNKNOWN` on success, or `FAILED`/`ERROR` on any technical failure after `RUNNING` was claimed, with best-effort finalization fallback exactly like `executeC01Replay`.

PRE-SEC-010 (operator/session authorization) is enforced by the untrusted route boundary, not this module.

---

## 7. Route — `POST /api/chaos/runs/[runId]/execute-c11-b`

Mirrors `app/api/chaos/runs/[runId]/replay/route.ts` (C01) exactly: UUID path validation, same-origin defense (`Sec-Fetch-Site`/`Origin`), access-gate session check, delegates to `executeC11RealWebhookReplay`, maps `COMPLETED`->200 / `NOT_STARTABLE`->409 / `FAILED`->500, never leaks `reasonCategory` or any raw error. Never reads a request body — the only input is the `runId` path segment.

---

## 8. C11-Specific Lifecycle Functions (`lib/chaos/run-repository.ts`)

`startPendingC11BRunAtomically`, `completeRunningC11BRunUnknown`, `failRunningC11BRunExecution` — deliberately stricter than the existing C01 completion/fail functions (which only check `status=RUNNING`): each additionally scopes on `scenario_id=C11`, `fault_type IS NULL`, `data_classification=RECORDED_TEST_EVIDENCE`. All are single atomic conditional-`UPDATE...WHERE...RETURNING` calls — a losing concurrent race returns `null`, never a double transition.

---

## 9. Frozen C11 TEST_FIXTURE Permanence — Confirmed Unchanged

`lib/chaos/repository.ts`'s `loadC11TestFixtureFailureEvidence` continues to always return `null`. `failureEvidence.kind = TEST_FIXTURE` cannot reach `PRECHECK_PASSED` at runtime — confirmed by the frozen, unmodified `tests/unit/chaos/safety-gate.test.ts` + `tests/unit/chaos/repository.test.ts` regression (71/71 pass verbatim this round). `tests/unit/chaos/c11-runtime-static-guard.test.ts` additionally statically confirms `lib/chaos/c11-execution-service.ts` never imports/loads the TEST_FIXTURE JSON path or `loadC11TestFixtureFailureEvidence`, and that `lib/chaos/repository.ts` never imports the new execution service.

---

## 10. Tests

### A. New C11-B resolver mechanics (offline, mocked) — `tests/unit/chaos/replay-repository.test.ts`

~20 new tests for `resolveAuthoritativeC11ReplaySource`: valid resolution; null `sourceWebhookEventId`; wrong `event_type`; `signature_verified=false`; wrong `source_kind`; `processing_status != PROCESSED`; zero/multiple candidates; exact query-filter-argument assertions (including truthful `.is(col,null)` vs `.eq(col,value)` NULL-equality construction); defensive `webhook_event_id`-null check; malformed/wrong-shaped `normalized_event` (not-object, wrong `eventType`/`kind`/`sourceKind`/`razorpayPaymentStatus`); repository-error throw tests; a correlation-mismatch test proving the resolver passes the run's own `paymentAttemptId`/`paymentId` as exact `.eq()` filter arguments; and a sanity check that `resolveAuthoritativeC01ReplaySource` remains exported/unchanged.

### B. New C11-B lifecycle mechanics (offline, mocked) — `tests/unit/chaos/run-repository.test.ts`

~10 new tests across the three new functions, mirroring the C01 test patterns exactly but additionally asserting the stricter `scenario_id="C11"` / `fault_type IS NULL` / `data_classification` scoping (and, for start, the `.not("source_webhook_event_id","is",null)` call). Module-surface allowlist updated (fifteen -> eighteen approved exports).

### C. New C11-B execution-service orchestration (offline, fully mocked) — `tests/unit/chaos/c11-execution-service.test.ts` (26 tests)

Happy path (exactly 1 replay insertion, exactly 1 processor call, `PAYCHAOS_REPLAY` repository function, `normalized_event` copied unchanged via reference-identity assertion, zero writes through the raw Supabase client the post-state reader uses); not-startable matrix (`RUN_NOT_FOUND`, `RUN_NOT_ELIGIBLE` for every ineligible field including C01/C03/C07 scenario_id and non-null `fault_type`, `SOURCE_EVIDENCE_UNRESOLVED`, `ALREADY_STARTED_OR_NOT_PENDING` on a losing atomic claim); technical execution failure (safe reason never leaks the raw error; the replay attempt itself is marked FAILED with the safe `MerchantProcessingError` code/message; best-effort fail-finalization never masks the original error); post-state verification failure (a genuine read failure -> `FAILED`/`POST_STATE_VERIFICATION_FAILED`, safe reason never leaks the raw error, `COMPLETED` never claimed; explicitly proves the CONTENT of a successful read — even an "unexpected-looking" `PAID`/`FULFILLED` read — never itself decides `COMPLETED` vs `FAILED`; missing `claimed.order_id`/`source.paymentAttemptId` correctly treated as a technical anomaly); finalization-stranding protection (`completeRunningC11BRunUnknown` returning `null` or throwing both correctly finalize FAILED via best-effort fallback, raw errors never leak); module-surface checks (`server-only` import, exact one-parameter signature, no reuse of `C01_REPLAY_ATTEMPT_COUNT`/the C01 service).

### D. New C11-B route (offline, mocked) — `tests/unit/api/chaos-c11-route.test.ts` (18 tests)

Invalid UUID; cross-origin rejection/acceptance matrix; access-gate matrix (misconfigured/no-cookie/invalid-cookie/valid-cookie/disabled-gate, including a proof that a caller-supplied `{authorized:true}` body claim is never honored); service-result mapping (`COMPLETED`->200 with safe body incl. fixed `replayAttemptCount:1`, `NOT_STARTABLE`->409 without leaking `reasonCategory`, `FAILED`->500 without leaking `reasonCategory`, a thrown error ->500 without leaking the raw message); module-surface checks (never reads a request body, no arbitrary target/authorization/replay-count/mechanism field names in functional code, never imports the C01 replay service/route).

### E. Static runtime safety/provenance guard (offline) — `tests/unit/chaos/c11-runtime-static-guard.test.ts` (18 tests)

Targets the actual RUNTIME files (`lib/chaos/c11-execution-service.ts` and the route), not a test file — protects the production execution surface itself. Required-present: `C11_REPLAY_ATTEMPT_COUNT = 1`, `insertReplayProcessingAttempt`, `processMerchantWebhookEvent`, `PAYCHAOS_REPLAY`. Required-absent (comment-stripped functional source): TEST_FIXTURE runtime loading / the JSON fixture path / `loadC11TestFixtureFailureEvidence`; `webhook_events` inserts/updates; `record_webhook_duplicate_delivery`; a real Razorpay SDK/client call (`new Razorpay(`, `require("razorpay")`) or arbitrary network call (`fetch(`, `axios`, `http(s).request(`) — while explicitly still permitting the legitimate `razorpay_payment_status` column-name reads; an arbitrary target URL/host/endpoint parameter; `C01_REPLAY_ATTEMPT_COUNT` reuse; a caller-supplied replay count (exact one-parameter signature assertion); a caller-supplied `RECORDED_TEST_EVIDENCE`/`data_classification` override (every occurrence is either a `===` runtime equality check or a TypeScript type-narrowing literal, never a write value); `verifyCheckoutAction`/`verifyCheckoutAndPersistPayment`; the C01 replay service/route. Also confirms `lib/chaos/repository.ts` never imports the new C11-B execution service.

### F. Real-Supabase mechanics — `tests/integration/supabase/058-chaos-c11-real-webhook-replay.integration.test.ts` (3 tests, PASS against real project)

Follows the exact `053`/`057` SYNTHETIC_DEMO + `PAYCHAOS_REPLAY` mechanics discipline (see the file's own module doc comment for the full three-layer provenance breakdown). Test 1: builds an isolated synthetic order/payment_attempt/payment/webhook_events(`payment.failed`) fixture, runs an ORIGINAL `REAL_RAZORPAY_WEBHOOK` attempt through the real processor to reach genuine `SUCCEEDED`/`PROCESSED` state (the RPC's own side effect sets `webhook_events.processing_status='PROCESSED'` — never hand-set), creates a `SYNTHETIC_DEMO` `chaos_run` via `createPendingChaosRun` (never `runChaosPrecheck`/`createChaosRun`/any execution service), calls the real `resolveAuthoritativeC11ReplaySource` against real Postgres and asserts it resolves the exact original attempt with the `normalized_event` byte-identical, then builds exactly ONE `PAYCHAOS_REPLAY` attempt from the RESOLVED source (never re-derived) and processes it, asserting provenance (`source_kind=PAYCHAOS_REPLAY`, `chaos_run_id` set, `is_duplicate_delivery=false`), exactly one replay attempt for the run, the original attempt unchanged, and full business post-conditions (`failed`/`FAILED_OBSERVED`/`FAILED_OBSERVED`/zero fulfilments/`duplicate_delivery_count=0`/webhook row count still 1). Test 2: a real-DB negative proof that the resolver returns `null` (fail-closed) when the correlated `webhook_events.processing_status` has not yet reached `PROCESSED`. Test 3: optional read-only recheck of the genuine historical event, never a hard dependency.

A dedicated static provenance guard (`tests/unit/supabase/058-chaos-c11-real-webhook-replay-provenance-guard.test.ts`, 9 tests) enforces the same discipline mechanically so it cannot silently regress, mirroring `057`'s guard.

**DEFERRED TO MANUAL VERIFICATION — not performed here, per explicit instruction:** the claim "the C11-B production service (`executeC11RealWebhookReplay`/the route) successfully replayed the AUTHENTIC captured evidence at `webhook_event_id e0df759e-bbde-45c3-aa80-a5a2d6b61be9`" is not proven by any file in this round.

---

## 11. Test Results (final, this round)

```text
New/updated C11-B focused unit tests
  (replay-repository.test.ts + run-repository.test.ts +
   c11-execution-service.test.ts + chaos-c11-route.test.ts +
   c11-runtime-static-guard.test.ts +
   058-chaos-c11-real-webhook-replay-provenance-guard.test.ts):
  Test Files = 6 passed
  Tests      = combined into the full-suite totals below; individually
  verified: replay-repository.test.ts 46/46, run-repository.test.ts 53/53,
  and the 4 wholly-new files 71/71 in one combined run, all clean.

Frozen C11 TEST_FIXTURE PRECHECK-07 regression
  (safety-gate.test.ts + repository.test.ts):
  71 passed, unchanged, verbatim.

C01 replay regression (replay-repository.test.ts + replay-service.test.ts)
  + fixture tests (057 guard + fixture unit test):
  Combined regression run (7 files): 207 passed.

Real-Supabase 058 mechanics test (isolated run):
  Test Files = 1 passed
  Tests      = 3 passed

Full real-Supabase integration suite:
  Test Files = 19 passed  (up from 18 — new 058)
  Tests      = 212 passed (up from 209 — +3)

Full offline unit suite — final clean invocation (after prettier --write):
  Test Files = 60 passed  (up from 56 — 4 wholly-new files)
  Tests      = 1309 passed (up from 1206 — +103)
  Single clean invocation; no retry needed this run. One earlier combined
  3-file parallel run showed one Windows/OneDrive vitest worker-spawn
  timeout in the route test file — isolated and reconfirmed 18/18 clean in
  under 12s standalone; not a regression, matching this machine's
  well-documented environmental issue class.

npm run typecheck: PASS (0 errors)

npm run lint: 0 errors, 1 pre-existing unrelated warning
  (tests/integration/supabase/051-chaos-safety-gate.integration.test.ts:354,
  unchanged from Phase 3D-C)

npm run build: PASS (exit 0) on the second attempt — the first attempt hit
  this machine's well-documented `.next`/OneDrive EPERM build-lock issue
  (unlink failure on a stale .next/static file); cleared the regenerable
  .next cache directory and retried once, clean build (new
  /api/chaos/runs/[runId]/execute-c11-b route correctly listed in the route
  table). No source change was made to work around this — it is the same
  environmental issue class already documented for this machine.

Prettier --check: found 7 files needing formatting on first pass
  (lib/chaos/c11-execution-service.ts + 6 test files) — ran --write on
  exactly those 7 files (mechanical formatting only, no functional change),
  reconfirmed --check PASS, and reran the full unit suite afterward
  (60/60, 1309/1309, clean) to confirm no behavioral change.

git diff --check: exit 0. Only pre-existing LF->CRLF line-ending advisory
  warnings on Windows (not whitespace errors) on files this round touched.
```

---

## 12. Manual Authentic Verification

Performed as a two-step, architect-authorized one-shot procedure against the real Supabase project, using temporary manual-verification helpers (`tests/integration/supabase/998-manual-c11-b-prepare.integration.test.ts` and `tests/integration/supabase/997-manual-c11-b-execute.integration.test.ts`) that were run exactly once each and deleted after architect review — neither was ever committed.

**Step 1 (preflight + create PENDING run):** re-verified the authentic historical `payment.failed` evidence, recorded the exact pre-execution baseline, and created exactly ONE genuine production C11-B `PENDING` chaos run via the real `createChaosRun(...)` entry point (Mechanism B, `failureEvidence.kind=REAL_WEBHOOK_EVENT`). No execution occurred in this step.

**Step 2 (authoritative one-shot execution):** re-verified the prepared run was still genuinely `PENDING` with zero processing attempts, then called the real production executor `executeC11RealWebhookReplay(...)` exactly once — never the HTTP route (the route's own security behavior is separately unit-tested; this step targets the production execution service itself against authentic persisted evidence).

**Results (safe metadata only):**

```text
Chaos run ID                    = 5090e423-daa5-4122-99de-4c27d728957c
Authentic source webhook event  = e0df759e-bbde-45c3-aa80-a5a2d6b61be9
Original processing attempt ID  = d756d2ab-649a-4922-9caa-916af8bee11e
Replay processing attempt ID    = 2804d3fc-1070-4bb7-9cf9-2f6a694c4a54
Execution calls                 = 1
Run transition                  = PENDING -> RUNNING -> COMPLETED
Final outcome                   = UNKNOWN (Phase 3F alone owns PASS/FAIL —
                                   never converted to PASS here)
Replay count                    = 1 (exactly C11_REPLAY_ATTEMPT_COUNT)
Replay attempt source_kind      = PAYCHAOS_REPLAY
Replay attempt status           = SUCCEEDED
Replay attempt is_duplicate_delivery = false
normalized_event copied verbatim = true (contents never logged/printed)
Canonical webhook rows before/after = 1 / 1 (0 new rows)
duplicate_delivery_count before/after = 0 / 0
Original REAL attempt unchanged = source_kind=REAL_RAZORPAY_WEBHOOK,
                                   status=SUCCEEDED,
                                   is_duplicate_delivery=false,
                                   chaos_run_id=null
Attempt delta for source event  = 1 -> 2 (1 REAL_RAZORPAY_WEBHOOK + 1 PAYCHAOS_REPLAY)
Merchant post-state              = order.payment_status=FAILED_OBSERVED,
                                    order.business_status=OPEN,
                                    fulfilment count=0
Payment post-state               = razorpay_payment_status=failed,
                                    captured_at=null, failed_at present
Success-side-effect proof        = order PAID=false, business FULFILLED=false,
                                    payment captured=false, new fulfilments=0,
                                    new payment row=false
```

This is the genuine positive proof that the C11-B production execution service correctly replays authentic captured `payment.failed` evidence with zero canonical-evidence mutation and zero success-side effect. The chaos run (`5090e423-daa5-4122-99de-4c27d728957c`) and its replay attempt (`2804d3fc-1070-4bb7-9cf9-2f6a694c4a54`) remain in Supabase permanently as historical verification evidence — never deleted.

---

## 13. Architecture Decisions

- **`readC11PostReplayMerchantState`** (new, inside `c11-execution-service.ts` rather than a new repository file, since no existing repository helper reads a `payments` row by internal `id` and the architect's expected file scope did not list a new C11 repository file): gates `FAILED` ONLY on a genuine read failure, never on read content — absolute compliance with "Phase 3D never assigns invariant PASS/FAIL" (Phase 3F alone owns INV-003/INV-004/INV-011).
- **C11-specific lifecycle functions deliberately stricter than C01's** (additional `scenario_id`/`fault_type`/`data_classification` scoping on every atomic transition) — an explicit, architect-requested exactness increase for C11, not a correction of a C01 deficiency.
- **`C11_REPLAY_ATTEMPT_COUNT = 1`** declared independently, never imported from or sharing an identifier with `C01_REPLAY_ATTEMPT_COUNT = 2` — C01 deliberately tests duplicate-delivery handling (2 replays); C11-B tests failed-payment safety and requires exactly 1.

---

## 14. Security Review

- PRE-SEC-011 (run must already exist): satisfied — `getChaosRunById` loads from durable storage before any claim.
- PRE-SEC-010 (operator/session authorization): enforced entirely at the untrusted route boundary, identical pattern to C01/C03/C07.
- PRE-SEC-007: not applicable to C11-B replay by design (documented in the module doc comment) — the event was already authenticated when the canonical evidence was created; no additional mechanism-specific secret is needed or accepted.
- No secret, signature, or raw database error is ever returned in an HTTP response body (route tests assert this explicitly for every result kind).
- No arbitrary target/URL/host/endpoint/authorization-boolean/replay-count is ever accepted from any caller input (statically guarded).
- Same-origin/cross-origin defense identical to every other chaos execution route in this codebase.

---

## 15. Known Issues

- The pre-existing lint warning in `051-chaos-safety-gate.integration.test.ts` remains (pre-existing, untouched file).
- This machine's well-documented Windows/OneDrive `.next` EPERM build-lock and Vitest worker-spawn-timeout issue classes both surfaced once each this round; both were isolated, retried, and confirmed non-regressions (see Section 11).
- No C11-B mechanics or provenance blocker is currently known.

---

## 16. Deferred Work

```text
C11-A manual real-failure observation verification                — Phase 3D-E
Money invariant PASS/FAIL evaluation (INV-003/004/011)              — Phase 3F
Evidence snapshot system                                            — Phase 3E
Findings                                                             — Phase 3G
UI polish                                                            — Phase 3H/5
```

---

## 17. Next Dependency

Phase 3D-E — C11-A genuine failure observation / reconciliation path. Begins only after explicit architect authorization; not started, and no files have been changed for it.

---

## 18. Do Not Break

- `lib/chaos/replay-service.ts`'s `executeC01Replay` and `C01_REPLAY_ATTEMPT_COUNT = 2` — untouched, regression-verified (207/207 in the combined C01/fixture regression run).
- `lib/chaos/repository.ts`'s `loadC11TestFixtureFailureEvidence` — must continue to always return `null`; TEST_FIXTURE must remain permanently blocked at `PRECHECK-07`.
- `resolveAuthoritativeC01ReplaySource` in `lib/chaos/replay-repository.ts` — unchanged, verified by an explicit regression assertion.
- The existing `event_processing_attempts.source_kind`/`webhook_events.source_kind` CHECK constraints — unchanged, no migration.

---

## 19. Phase Completion Checklist

```text
IMPLEMENTED         [x]
TESTED              [x]
MANUALLY VERIFIED   [x]
DOCUMENTED          [x]
APPROVED            [x]
```

---

## 20. Final Architect Approval

Phase 3D-D — C11-B `REAL_WEBHOOK_EVENT` controlled runtime replay/execution — is architect-approved. Manual authentic verification (Section 12) is accepted as genuine positive proof against real, authentic Razorpay Test Mode evidence, with zero canonical-evidence mutation and zero success-side effect. The chaos run (`5090e423-daa5-4122-99de-4c27d728957c`) and its replay attempt (`2804d3fc-1070-4bb7-9cf9-2f6a694c4a54`) are retained permanently in Supabase as historical verification evidence. The `UNKNOWN` outcome is intentional and permanent for this phase — Phase 3F alone will later evaluate deterministic money invariants (INV-003/INV-004/INV-011) against this and future evidence; it is never converted to `PASS` here.
