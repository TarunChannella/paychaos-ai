# PayChaos AI — Phase 4E Handoff

Internal sub-phase handoff for **Phase 4E — Regression Engine** (`docs/PHASE_PLAN.md` Section 8.7, "Phase 4E — Regression Engine").

**This is NOT the full Phase 4 handoff.** `handoffs/PHASE-4-HANDOFF.md` belongs to the end of the whole phase, once 4A–4G P0 work is complete, and is deliberately not created here.

```text
IMPLEMENTED             = YES
TESTED                  = YES
MANUALLY VERIFIED       = YES
DOCUMENTED              = YES
ARCHITECT APPROVAL      = YES
```

**Phase 4 as a whole is NOT COMPLETE.** The Reliability Score (4F) and Go-Live Readiness (4G) are unimplemented, and P4-AC-10, P4-AC-11, P4-AC-13 and P4-AC-14 remain open. Nothing in this document should be read as Phase 4 completion.

---

## 1. Phase 4E Objective

Phase 4E closes the re-test half of the product loop:

```text
existing Finding (historical FAIL)
  -> resolve the authoritative ORIGINAL scenario from persisted evidence
    -> create a NEW chaos run through the EXISTING safety-gated Chaos Runner
      -> link Finding -> new run in regression_runs
        -> execute / arm through the EXISTING frozen scenario services
          -> gather NEW evidence
            -> evaluate the authoritative relevant invariant set
              -> deterministic regression decision (frozen Phase 4E-R1 rules)
                -> terminalize the regression FIRST
                  -> update the Finding lifecycle SECOND
```

It deliberately stops there. Phase 4E does **not** calculate a Reliability Score, does not derive Go-Live Readiness, builds no Phase 4 UI, and uses no AI, ML or LLM of any kind.

**The original failure evidence is never overwritten.** A regression produces new evidence beside the old, never in place of it.

---

## 2. Completion State

| Item                                    | State                                           |
| --------------------------------------- | ----------------------------------------------- |
| R1 regression foundation                | Implemented, tested, checkpointed               |
| R2 trusted orchestration                | Implemented, tested, checkpointed               |
| R3-A regression API                     | Implemented, tested, checkpointed               |
| R3-B C07 manual provider verification   | Verified on genuine Razorpay Test Mode evidence |
| R3-B C11-A manual provider verification | Verified on genuine Razorpay Test Mode evidence |
| INV-011 v1 → v2 contract correction     | Implemented, tested, checkpointed               |
| Terminal-convergence correction         | Implemented, tested, checkpointed               |
| Reliability Score (4F)                  | NOT STARTED                                     |
| Go-Live Readiness (4G)                  | NOT STARTED                                     |

---

## 3. Starting Dependency Contract From Approved Phase 4D

Phase 4E consumed, and did not modify, the Phase 4D contract:

- `findings` rows carrying the seven diagnosis/recommendation columns, all optional;
- `RECOMMENDATION-CATALOGUE-V1` / `TEMPLATE-V1` / `DETERMINISTIC_CATALOGUE` as frozen advisory output;
- the Phase 4A `DiagnosisEvidencePackV1`, Phase 4B `DiagnosticSignalSetV1` and Phase 4C `RootCauseClassificationV1` chains;
- the rule that a recommendation is **advisory** and never authoritative over money state.

Phase 4E adds the lifecycle transitions Phase 4D deliberately left alone (`status`, `resolved_at`). A regression never reads or requires a diagnosis or a recommendation: eligibility is decided from persisted identifiers, never from generated prose.

---

## 4. R1 — Regression Foundation

Checkpoint commit `fa6a172b3b2fd54cbb8c41bd43e7c38a3e22a421`.

R1 is pure structure and persistence, with no orchestration:

- `lib/regression/types.ts` — `RegressionRun`, the active/terminal status sets, repository and ineligibility error codes, `RegressionEligibility`, `RegressionFindingAction` (`RESOLVE` / `MARK_STILL_FAILING` / `NO_CHANGE`) and the decision reasons.
- `lib/regression/repository.ts` — reads (`findRegressionRunById`, `listRegressionRunsForFinding` ordered `created_at DESC, id DESC`, `findActiveRegressionForFinding`), one insert, and four explicit status transitions. Every transition is a single conditional `UPDATE … .eq("id") .in("status", [...from])` with one re-read on a miss; there is no retry loop.
- `lib/regression/eligibility.ts` — **SELECT-only**. Traces `finding.invariant_result_id → invariant_results.chaos_run_id → chaos_runs.scenario_id → getScenarioDefinition(...).requiredInvariants`. It never reads a title, diagnosis or recommendation, and there is deliberately no local scenario→invariant table in the directory.
- `lib/regression/finalization.ts` — the pure frozen decision, no I/O.

**All three Finding statuses are eligible in principle** (`OPEN`, `STILL_FAILING`, `RESOLVED`): a resolved Finding may legitimately be re-verified later. Status is reported, never used to reject.

---

## 5. R2 — Trusted Orchestration

Checkpoint commit `a92a2d83792f25b4adc484173a02d5549ec31b34`.

`lib/regression/service.ts` composes only frozen Phase 3 services — `createChaosRun`, the five scenario execution services, `evaluateChaosRun` and `decideRegressionOutcome`. **There is no second chaos runner and no reimplementation of webhook processing, replay, signature verification, C07 suppression, C11 observation or invariant evaluation.**

`lib/regression/finding-lifecycle-repository.ts` is the only Finding lifecycle writer in the codebase. It writes exactly `status`, `resolved_at` and `updated_at`, guarded by a compare-and-set on the `updated_at` the caller observed.

Properties established in R2 and preserved since:

- **Persisted state is authoritative.** After calling an execution service the module re-reads `chaos_runs` and decides from the durable row, never from the in-memory result alone.
- **The Finding follows the newest CONCLUSIVE attempt.** An `ERROR` attempt carries `NO_CHANGE` and can never mask an older `RESOLVED`/`STILL_FAILING` verdict.
- **`SUPERSEDED` is service-level only.** `regression_runs` has no such status, and no historical row is ever rewritten.
- **A historical order can never be reused** as the fresh subject for C07 or C11-A.

---

## 6. R3 — API and Manual Provider Verification

Checkpoint commit `f2dc0ef36c780cd9a9d965acb504a4c74ded6ab8` (R3-A). R3-B was manual verification against Production and produced no source change of its own.

### API surface — exactly two routes

| Route                                             | Purpose                |
| ------------------------------------------------- | ---------------------- |
| `POST /api/findings/{findingId}/regressions`      | Start a regression     |
| `POST /api/regressions/{regressionRunId}/advance` | Resume a persisted one |

Both are adapters. Neither reaches a database, creates or evaluates a chaos run, calls a scenario execution service, writes a Finding, touches Razorpay, or makes any outbound network call. Both reuse the existing conventions verbatim: UUID path validation, targeted cross-origin rejection, the existing access-gate session check that fails closed when misconfigured, and safe response envelopes that never leak a database message, hint, stack or secret.

**The caller controls almost nothing.** The start route's body allowlist is exactly `["freshOrderId"]`, and an unknown key is a rejected request rather than a silently ignored one. The advance route accepts **no** operational payload at all and refuses any body carrying keys. There is no way to supply a scenario, a mechanism, a fault type, an invariant, a diagnosis, a result, a URL or a host — the scenario and its relevant invariant set are re-derived server-side from persisted evidence on every call.

---

## 7. Regression Data Model

Migration: `supabase/migrations/20260904000000_phase4e_regression_runs.sql`. **Final migration count: 13. Currently deployed: YES.** Neither later correction required a migration.

`public.regression_runs` — seven columns, and deliberately **no `updated_at`**:

| Column         | Notes                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | uuid PK, `gen_random_uuid()`                                                                                                                        |
| `finding_id`   | → `public.findings (id)` **ON DELETE RESTRICT**; not unique — a Finding may be re-tested many times and every attempt is retained                   |
| `chaos_run_id` | → `public.chaos_runs (id)` **ON DELETE RESTRICT**; **UNIQUE** — one chaos run belongs to at most one regression, and never the original failing run |
| `status`       | CHECK over the five values below                                                                                                                    |
| `started_at`   | set on `PENDING → RUNNING`; stays NULL if the regression terminalized before starting                                                               |
| `completed_at` | set exactly once on reaching a terminal status; preserved verbatim on idempotent repeat finalization                                                |
| `created_at`   | row creation                                                                                                                                        |

**Evidence preservation is enforced at the database layer.** Both foreign keys are `ON DELETE RESTRICT`, so neither a Finding nor a chaos run can be deleted out from under its regression history.

**Active-per-Finding protection** — a partial unique index, not a one-regression-ever rule:

```sql
create unique index regression_runs_active_finding_uniq
  on public.regression_runs (finding_id)
  where status in ('PENDING', 'RUNNING');
```

Terminal rows are excluded, so a Finding can accumulate unlimited history while at most one attempt is in flight.

Three plain indexes exist on `finding_id`, `status` and `created_at`.

**RLS / write model:** RLS enabled with **zero policies**; `revoke all privileges … from anon, authenticated`; `grant select, insert, update, delete … to service_role`. There is no browser-reachable write path.

---

## 8. Regression Status Lifecycle

```text
PENDING  -> RUNNING -> RESOLVED
                    -> STILL_FAILING
                    -> ERROR
PENDING  -> ERROR                     (terminalized before starting)
```

`ERROR` means the regression established **neither** fixed nor still-failing proof — an inconclusive `UNKNOWN` evaluation, a `BLOCKED` run, or a technical execution failure. **It is not a claim that a payment failed**, and an inconclusive regression never resolves a Finding.

`SUPERSEDED` is a service-level result only and is never a database status.

---

## 9. Finding Lifecycle Semantics

Frozen decision rules (`lib/regression/finalization.ts`):

| New evaluation                                                                     | Regression      | Finding              |
| ---------------------------------------------------------------------------------- | --------------- | -------------------- |
| aggregate FAIL                                                                     | `STILL_FAILING` | `MARK_STILL_FAILING` |
| aggregate PASS **and** the original Finding's invariant PASS on the new evaluation | `RESOLVED`      | `RESOLVE`            |
| aggregate PASS but the original invariant not proven PASS                          | `ERROR`         | `NO_CHANGE`          |
| aggregate UNKNOWN                                                                  | `ERROR`         | `NO_CHANGE`          |

Non-negotiables, all enforced in code and covered by tests:

- **UNKNOWN is never PASS.**
- **BLOCKED or technical failure never resolves a Finding.**
- FAIL is checked **first**, so an aggregate FAIL yields `STILL_FAILING` even when the original invariant itself passed.
- **Durable ordering:** the regression row is terminalized _before_ the Finding lifecycle write. A terminal regression whose Finding has not caught up is recoverable and honest; a Finding claiming `RESOLVED` above a still-running regression would not be.
- `generateFindingsForChaosRun` is **never** called automatically for a regression. A re-test never manufactures a new Finding.
- A `RESOLVED` Finding re-resolved later keeps its **original** `resolved_at` — the moment a defect was first proven fixed is a historical fact.
- Reopening a `RESOLVED` Finding to `STILL_FAILING` clears `resolved_at` in the same statement, so no stale resolution timestamp survives.

---

## 10. Original Failure-History Preservation

The design rule, enforced at four layers:

1. `invariant_results` is immutable append-only; the Phase 3F-A migration grants **no UPDATE privilege to any role**, and `Database["public"]["Tables"]["invariant_results"]["Update"]` is typed `never`.
2. A unique index pins one result row per `(chaos_run_id, invariant_id)`.
3. `regression_runs` foreign keys are `ON DELETE RESTRICT`.
4. A regression always creates a **new** chaos run; the original run is read for its shape and never re-executed or re-evaluated.

---

## 11. Existing Chaos Runner Reuse

Every effect in a regression is produced by a frozen Phase 3 service:

| Scenario | Mechanism | Execution service                | Step           |
| -------- | --------- | -------------------------------- | -------------- |
| C01      | B         | `executeC01Replay`               | single-step    |
| C03      | C         | `executeC03InvalidSignatureTest` | single-step    |
| C07      | A+C       | `armC07ClientConfirmationDrop`   | **multi-step** |
| C11-B    | B         | `executeC11RealWebhookReplay`    | single-step    |
| C11-A    | A         | `startC11AFailureObservation`    | **multi-step** |

`createChaosRun` runs the full frozen precheck gate for every regression; the regression service adds no bypass.

---

## 12. Authoritative Scenario / Invariant Mapping Reuse

The relevant invariant set comes from `getScenarioDefinition(...).requiredInvariants` — the single authoritative registry:

```text
C01 -> INV-001, INV-002, INV-006, INV-007
C03 -> INV-004, INV-005
C07 -> INV-002, INV-004, INV-011
C11 -> INV-003, INV-004, INV-011
```

There is deliberately no second copy in `lib/regression/`; a duplicate could only ever drift.

The C11 mechanism discriminator is the **original run's persisted shape**, never prose and never a caller's choice:

- `source_webhook_event_id` non-null → **C11-B** (replay of a genuine signature-verified `payment.failed`);
- `source_webhook_event_id` null **and** `order_id` non-null → **C11-A** (observation of a genuine Test Mode failed payment);
- neither → `ORIGINAL_PATH_UNRESOLVED`; the service refuses to guess.

---

## 13. Provider-Dependent C07 Flow

C07 genuinely requires a real Razorpay Test Mode payment in a browser. The server arms the client-confirmation drop and returns `AWAITING_EXTERNAL_ACTION` with continuation `C07_TEST_MODE_CHECKOUT`. **Nothing fabricates a Checkout, a payment or a webhook**, and the scenario is never reported complete because the server did its half.

A genuinely new fresh order is required; reuse of the original run's order is refused structurally with `FRESH_ORDER_REUSE_FORBIDDEN` before any eligibility call.

---

## 14. Provider-Dependent C11-A Flow

C11-A is **pure observation**: `fault_type` is null, `fault_state` is `{}`, and no payment state is mutated by the server. The run is started, returns `AWAITING_EXTERNAL_ACTION` with continuation `C11_A_TEST_MODE_FAILED_PAYMENT`, and waits for a genuine Test Mode **failed** payment. The reconcile route then correlates the persisted genuine evidence itself — no provider evidence is ever supplied by the caller.

---

## 15. INV-011 v1 → v2 Correction

Correction commit `09fa3070468a50e179287efc127572ade2058fda` — `fix: version inv-011 failure transition`.

### What the genuine evidence proved

The first genuine C11-A regression produced `INV-003/v1 PASS` but `INV-011/v1 FAIL`, with the observed summary _"illegal order payment-status transition UNPAID -> FAILED_OBSERVED"_.

INV-011/v1's Rule A legal set had **seven** transitions and did not contain `UNPAID → FAILED_OBSERVED`. But the frozen Phase 2F processing path sets `orders.payment_status = 'FAILED_OBSERVED'` (unless already `PAID`) on a verified `payment.failed`, leaving `business_status = OPEN` with no fulfilment — and nothing in the real flow moves the **order** to `PENDING` merely because Checkout opened. Only the payment **attempt** advances to `CHECKOUT_IN_PROGRESS`. Checkout is not provider authority; the genuine signature-verified `payment.failed` webhook is.

The v1 set therefore modelled a `PENDING` waypoint the implementation deliberately does not create, and failed a run in which **no money-safety guarantee was broken** — the order was never paid and nothing was fulfilled.

### The correction

```text
INV-011 version      = "2"
INV-011 evaluatorKey = "INV-011/v2"
legal transition set = 8 members
```

The **only** addition is `UNPAID → FAILED_OBSERVED`. The complete v2 set:

```text
UNPAID          -> PENDING
UNPAID          -> FAILED_OBSERVED   [ADDED IN v2]
UNPAID          -> PAID
PENDING         -> FAILED_OBSERVED
PENDING         -> PAID
FAILED_OBSERVED -> PENDING
FAILED_OBSERVED -> PAID
PAID            -> PAID
```

Explicitly unchanged:

- **PAID monotonicity holds.** `PAID → UNPAID`, `PAID → PENDING` and `PAID → FAILED_OBSERVED` remain ILLEGAL; the only legal successor of `PAID` is `PAID`.
- `UNPAID → UNPAID`, `PENDING → PENDING` and `FAILED_OBSERVED → FAILED_OBSERVED` remain `NO_TRANSITION`, not legal-set members.
- **No fulfilment on failure** is permitted; INV-004's authority rules are untouched.
- **No client-reported failure becomes authoritative**; only verified provider processing writes `FAILED_OBSERVED` at all.
- **No Phase 2 merchant processing change.** No artificial `PENDING` transition was introduced merely to satisfy the invariant.
- **Historical INV-011/v1 rows are unchanged. No backfill.** Every result row stores its own `invariant_version`, so a v1 verdict stays distinguishable from a v2 verdict and is read under v1 semantics.

Documentation updated in the same commit: `docs/MONEY_INVARIANTS.md` §10 (state diagram), §11 + new §11.1 (rationale), §26 §8 Rule A, new §48.1 (version history table), §57 (test matrix).

---

## 16. Terminal-Regression Convergence Correction

Correction commit `e06c527f78f847c722f59e38aba3a09f8afccd0c` — `fix: preserve terminal regression verdicts`.

### The confirmed bug

Pre-start convergence called `completeRegression(previous.id)` on the newest conclusive regression, which called `evaluateChaosRun(previous.chaosRunId)` on its historical run.

After INV-011 moved v1 → v2, that re-evaluated old v1 evidence under current v2 semantics and produced a different verdict for the same evidence. `persistInvariantResult` correctly raised `INVARIANT_RESULT_INTEGRITY_CONFLICT` rather than rewrite the immutable `(chaos_run_id, invariant_id)` row, so the start failed with `NOT_STARTED / PRIOR_CONVERGENCE_FAILED` — **permanently, for every future attempt on that Finding**. This was observed for real when the final C11-A retest was first attempted.

Nothing was corrupted: zero writes occurred, and the failure was fail-closed by design.

### The final behaviour

**An already-terminal regression's stored `RESOLVED` / `STILL_FAILING` status is the durable verdict.** The run, the evaluation and the deterministic finalization all happened before that row was written, so the only durable step that can still be missing is the later Finding write — and recovering it needs the stored status and nothing else.

Pre-start convergence is now **Finding-lifecycle convergence only**. It uses `listRegressionRunsForFinding`, `readFindingLifecycle`, `resolveFindingAfterRegression` and `markFindingStillFailingAfterRegression` with the existing CAS protection. A Finding already matching the stored verdict is a **zero-write** no-op.

It **must not**, and structurally cannot, call `completeRegression`, `evaluateChaosRun`, `evaluateInvariant`, `persistInvariantResult`, `createChaosRun`, `insertPendingRegressionRun` or any scenario execution service — enforced by static guard 34e.

Preserved from the original safety boundary: the newest CONCLUSIVE attempt is still selected (an intervening `ERROR` never masks an older verdict); any missing Finding, failed read, CAS conflict or repository failure still fails closed to `PRIOR_CONVERGENCE_FAILED` **before** `createChaosRun` and before the regression row insert.

`completeRegression` keeps its own semantics for a `PENDING`/`RUNNING` attempt. Invariant-result immutability was **not** weakened.

**Why this is not a weakening:** determinism in `docs/MONEY_INVARIANTS.md` is _"same evidence + SAME invariant version = same result"_. A v1 run must never be silently reinterpreted under v2. A re-test does not reinterpret old evidence — it produces new evidence.

---

## 17. Files Added / Modified Across Phase 4E

### Production code

| Path                                                     | Introduced / changed by            |
| -------------------------------------------------------- | ---------------------------------- |
| `lib/regression/types.ts`                                | R1, extended in R2                 |
| `lib/regression/repository.ts`                           | R1                                 |
| `lib/regression/eligibility.ts`                          | R1                                 |
| `lib/regression/finalization.ts`                         | R1                                 |
| `lib/regression/service.ts`                              | R2, corrected in `e06c527`         |
| `lib/regression/finding-lifecycle-repository.ts`         | R2                                 |
| `app/api/findings/[findingId]/regressions/route.ts`      | R3-A                               |
| `app/api/regressions/[regressionRunId]/advance/route.ts` | R3-A                               |
| `lib/supabase/types.ts`                                  | R1 (`regression_runs` types)       |
| `lib/invariants/registry.ts`                             | `09fa307` (INV-011 v2)             |
| `lib/invariants/evaluator-utils.ts`                      | `09fa307` (eight-member set)       |
| `lib/invariants/evaluators.ts`                           | `09fa307` (comment only)           |
| `lib/demo-merchant/transitions.ts`                       | `09fa307` (domain legality helper) |

### Migration

`supabase/migrations/20260904000000_phase4e_regression_runs.sql` (R1). The only Phase 4E migration.

### Tests

`tests/unit/regression/` — `types`, `repository`, `eligibility`, `finalization`, `finding-lifecycle-repository`, `service`, plus static guards `phase4e-r1-migration-static-guard`, `phase4e-r1-static-guard`, `phase4e-r2-static-guard`, `phase4e-r3-static-guard`.
`tests/unit/api/` — `regression-start-route`, `regression-advance-route`.
`tests/integration/supabase/` — `071` foundation, `072` orchestration, `073` API, `074` terminal convergence.
Advanced (not weakened): `061`, `065`, `066` provenance tripwires; Phase 4D guards `phase4d-r1`/`phase4d-r2`; `tests/unit/supabase/migration.test.ts`, `server.test.ts`; `tests/unit/invariants/{evaluators,registry}.test.ts`, `tests/unit/demo-merchant/transitions.test.ts`, `tests/unit/findings/service.test.ts`; `tests/integration/supabase/066-phase3h-read-models.integration.test.ts`.

### Documentation

`docs/MONEY_INVARIANTS.md` (`09fa307`). No other approved doc required a change.

---

## 18. Phase 4E Commit Chain

Derived from `git log`, not from memory. Current final source commit: **`e06c527f78f847c722f59e38aba3a09f8afccd0c`**.

| #   | SHA                                        | Subject                                       | Purpose                                                      |
| --- | ------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------ |
| 1   | `fa6a172b3b2fd54cbb8c41bd43e7c38a3e22a421` | `feat: add phase 4e regression foundation`    | Migration, types, repository, eligibility, pure finalization |
| 2   | `a92a2d83792f25b4adc484173a02d5549ec31b34` | `feat: add phase 4e regression orchestration` | `service.ts`, Finding lifecycle repository, the trusted loop |
| 3   | `f2dc0ef36c780cd9a9d965acb504a4c74ded6ab8` | `feat: add phase 4e regression api`           | The two adapter routes and their tests                       |
| 4   | `09fa3070468a50e179287efc127572ade2058fda` | `fix: version inv-011 failure transition`     | INV-011 v1 → v2, docs, domain helper                         |
| 5   | `e06c527f78f847c722f59e38aba3a09f8afccd0c` | `fix: preserve terminal regression verdicts`  | Convergence uses the stored verdict; suite 074               |

Parent of the chain: `c172fa2` (Phase 4D final). No historical commit was rewritten.

---

## 19. Environment / Configuration / Razorpay

**No environment variable was added, removed or changed in Phase 4E.** No Razorpay configuration change of any kind: no new key, no webhook URL change, no new provider endpoint, no new external host. The existing access gate is reused by both new routes; no new authentication mechanism was introduced. Razorpay remains **Test Mode only**.

---

## 20. Automated Test Evidence

Accepted final gates **after** the terminal-convergence correction, at `e06c527`:

| Gate                                                     | Result                                     |
| -------------------------------------------------------- | ------------------------------------------ |
| regression focused (`tests/unit/regression/`)            | **10 files / 306 tests / PASS** (exit 0)   |
| `074` terminal convergence, real Supabase                | **1 file / 7 tests / PASS** (exit 0)       |
| full offline (`npm run test`)                            | **131 files / 3645 tests / PASS** (exit 0) |
| full real Supabase (`npm run test:integration:supabase`) | **35 files / 481 tests / PASS** (exit 0)   |
| `npx tsc --noEmit`                                       | PASS                                       |
| `npx eslint .`                                           | **0 errors**, 1 known pre-existing warning |
| `npm run build`                                          | PASS                                       |
| Prettier on changed files                                | PASS                                       |
| `git diff --check`                                       | PASS                                       |

Earlier gates in the chain, from the same evidence trail:

| Checkpoint              | Full offline           | Full real Supabase   |
| ----------------------- | ---------------------- | -------------------- |
| `a92a2d8` (R2)          | 128 files / 3569 tests | 33 files / 460 tests |
| `f2dc0ef` (R3-A)        | 131 files / 3624 tests | 34 files / 474 tests |
| `09fa307` (INV-011 v2)  | 131 files / 3633 tests | 34 files / 474 tests |
| `e06c527` (convergence) | 131 files / 3645 tests | 35 files / 481 tests |

### Environmental runs — rejected, never counted as passes

Windows/OneDrive intermittently causes Vitest **fork worker-start faults** (`Failed to start forks worker` / `Timeout waiting for worker to respond`) and occasional 5 s / 20 s import timeouts in frozen Phase 2 route test files. Every such run was **rejected and re-run**, per the established rule; none was ever reported as a pass, and no timeout was raised and no test weakened to accommodate them.

### Known `.next` EPERM recovery

`next build` on this OneDrive-synced path intermittently fails with `EPERM: operation not permitted, unlink '…/.next/server/app/api/chaos/runs/route'`. Approved recovery, applied truthfully and reported each time it was used: **delete ONLY `.next`, retry the build once.** It was needed at the `09fa307` gate and not at the `e06c527` gate.

---

## 21. Real Supabase Evidence

Four Phase 4E integration suites run against the live project:

- **071** — foundation: schema shape, FK behaviour, unique constraints, active-regression boundary, RLS.
- **072** — the whole orchestration loop over C03 (the only fully internal P0 scenario: no Razorpay call, no Checkout, no order, no source webhook).
- **073** — the two API routes end to end.
- **074** — the terminal-convergence regression test: a Finding with a prior terminal `STILL_FAILING` regression whose run holds a deliberately **superseded** persisted invariant version. It proves the start now succeeds, the historical run's `invariant_results` are byte-for-byte unchanged, the historical regression row is untouched, and the new attempt owns its own new run and regression row. This test fails against the pre-correction implementation.

All four use test-owned `SYNTHETIC_DEMO` fixtures, create no provider evidence, and clean up by exact UUID, children before parents, with per-table leak assertions.

---

## 22. Manual Verification — C07 (genuine Razorpay Test Mode)

Provenance note: the **original** C07 Finding came from a controlled test-owned `SYNTHETIC_DEMO` fixture. It is **not** real merchant performance and must never be presented as such.

| Item                             | Value                                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Finding                          | `ce2ebfa3-31a6-441d-8075-ba2ebbf2b2b0` — _INV-011 — Payment State Is Legal, Monotonic and Convergent_                                                                                |
| Original invariant result        | `e6979f8c-2ea4-4dee-a9ef-9c43dcea8737` — INV-011/v1 **FAIL**, CRITICAL                                                                                                               |
| Original synthetic run           | `d295a28e-2e7c-4ab4-97ac-64bf93977993` — C07, `SYNTHETIC_DEMO`, COMPLETED / **FAIL**                                                                                                 |
| First genuine regression         | `8df09d4b-3eef-462c-b197-919d70305ef9` → run `b39777e3-b25b-4f01-8108-6e5a2a08862a`, COMPLETED / **UNKNOWN**, regression **ERROR**                                                   |
| Second genuine regression        | `f0c8d0b2-fddd-4c46-8661-b2d9074e3bec` → run `853762e4-3e1f-498f-978b-1baf1ad49ae1`, COMPLETED / **PASS**, regression **RESOLVED**                                                   |
| Genuine payment                  | internal `fe5db6ed-35f7-4cfc-84b7-7dc013bdba65`, provider `pay_TWUv0gxuH4cXPu`, status **captured**, `captured_at` 2026-08-31T19:48:11.989Z, `checkout_signature_verified` **false** |
| Genuine webhook                  | `90368b0a-d18f-413f-b341-968bdcc6ba09`, provider event `TWUv8e5VCDnqPa`, `payment.captured`, `REAL_RAZORPAY_WEBHOOK`, signature verified **true**, **PROCESSED**                     |
| New invariants (run `853762e4…`) | INV-002/v1 **PASS**, INV-004/v1 **PASS**, INV-011/v1 **PASS**                                                                                                                        |
| Final Finding status             | **RESOLVED**, `resolved_at` **2026-08-31T19:52:59.764+00:00**                                                                                                                        |

`checkout_signature_verified = false` is **correct** for C07 and is not a webhook signature failure: the scenario deliberately suppresses the browser confirmation, so no successful Checkout signature is ever produced. The merchant nevertheless converged to `PAID`/`FULFILLED` with exactly one fulfilment, purely through verified webhook processing — which is precisely what C07 exists to prove.

The first genuine attempt returned `UNKNOWN` truthfully: the Production build that processed those webhooks predated the Phase 3E snapshot instrumentation, so `state_before`/`state_after` were NULL. That inconclusive history is **preserved**, not backfilled. The production source was never defective.

---

## 23. Manual Verification — Final C11-A (genuine Razorpay Test Mode, INV-011/v2)

Provenance note: the **original** C11 Finding is likewise a controlled test-owned `SYNTHETIC_DEMO` fixture, created because no real failed-C11 Finding existed to initiate a regression from. It is **not** real merchant performance.

| Item                      | Value                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| Finding                   | `9eb88ed6-eb48-45a6-b993-d6287178f765` — _INV-003 — Failed Payment Never Marks Order Paid_ |
| Original invariant result | `266c89c3-dd2d-4314-9648-3847fb55dc16` — INV-003/v1 **FAIL**                               |
| Original synthetic run    | `8a30bd7f-bdd3-432b-8c05-526d980cd6a6` — C11, `SYNTHETIC_DEMO`, COMPLETED / **FAIL**       |
| Fresh order               | `6d5d052a-915e-48a3-8358-af1568568e3b`                                                     |
| Payment attempt           | `953f77b8-4fcc-4016-86b1-d5df138ee136`                                                     |
| Razorpay order            | `order_TWbYfLJEncceHp`                                                                     |
| Provider payment          | `pay_TWd3NrG8Eh6ZWT`                                                                       |
| Internal payment          | `b2bb66e1-a6aa-4426-a623-cf7595fa7a86`                                                     |
| Genuine webhook row       | `b708d866-d1ac-4672-a75a-2c958de410ef`                                                     |
| Razorpay event id         | `TWd3UKMEc5YzQf`                                                                           |
| New regression            | `022213ad-9550-4fe2-8fba-116d5cca76a5`                                                     |
| New chaos run             | `d97e3fc6-e0f1-48f5-a613-95f87989101c` — `RECORDED_TEST_EVIDENCE`                          |

**Provider / payment facts:** provider status **failed**, `failed_at` **2026-09-01T03:45:41.214433+00:00**, `captured_at` **null**, `checkout_signature_verified` **false**. Safe error fields: `BAD_REQUEST_ERROR` / source `bank` / step `payment_authorization` / reason `payment_failed`.

**Genuine webhook:** `payment.failed`, `source_kind` **REAL_RAZORPAY_WEBHOOK**, `signature_verified` **true**, `processing_status` **PROCESSED**, `duplicate_delivery_count` **1**, received 03:45:35.308Z — after the run was armed at 03:42:56.437Z.

**Processing attempts:** exactly one authoritative non-duplicate **SUCCEEDED** (`2d41d3af-6d00-45f1-a465-9262d6828da2`) and one **SKIPPED_DUPLICATE** (`25442b30-b8eb-4482-ba7f-ddae25418e44`). Razorpay delivered twice; the duplicate was correctly deduplicated and created no second payment, no fulfilment, no order mutation and no business effect.

**Real Phase 3E snapshots on the authoritative attempt:**

```text
BEFORE  order UNPAID / OPEN / 0 fulfilments
        attempt CHECKOUT_IN_PROGRESS · payment failedAt null, capturedAt null
AFTER   order FAILED_OBSERVED / OPEN / 0 fulfilments
        attempt FAILED_OBSERVED · payment failed, failedAt set, capturedAt null
```

**Final merchant state:** `payment_status` **FAILED_OBSERVED**, `business_status` **OPEN**, fulfilments **0**.

**New invariant results (run `d97e3fc6…`):**

| Invariant | Version | Result             | Row id                                 |
| --------- | ------- | ------------------ | -------------------------------------- |
| INV-003   | `"1"`   | **PASS**           | `9e56a634-4f00-4077-883f-7aab8cd3887c` |
| INV-004   | —       | **NOT_APPLICABLE** | **no persisted row, no placeholder**   |
| INV-011   | `"2"`   | **PASS**           | `6a3d6355-dd2a-48d4-a66b-eaf567e0a4df` |

INV-011/v2 observed: _"legal transitions observed = 2; no-op status pairs = 1; illegal = 0; authoritative capture = NONE_OBSERVED"_. `illegal = 0` is the direct consequence of the v2 correction.

**New chaos run:** COMPLETED / **PASS**. **New regression:** **RESOLVED** (started 03:42:54.829Z, completed 03:50:07.362Z). **Finding:** **RESOLVED**, `resolved_at` **2026-09-01T03:50:08.428+00:00**. **No new Finding was created** — total Findings remained 2.

The reconcile route returned an interim `COMPLETED / UNKNOWN` before deterministic invariant evaluation; the run's final outcome is **PASS**. `UNKNOWN` was never treated as `PASS`.

---

## 24. Historical Evidence Preservation — the audit chain

All of the following remain exactly as originally written, verified read-only after the final resolution:

| Evidence                               | State                                                            |
| -------------------------------------- | ---------------------------------------------------------------- |
| `266c89c3-dd2d-4314-9648-3847fb55dc16` | INV-003/v1 **FAIL** (synthetic original)                         |
| `8a30bd7f-bdd3-432b-8c05-526d980cd6a6` | C11 `SYNTHETIC_DEMO`, COMPLETED / **FAIL**                       |
| `a64c606a-6736-4865-9c56-56f42ad198ba` | previous genuine C11 run, COMPLETED / **FAIL**                   |
| `4adae27e-d164-487d-b65e-eab56e78dd51` | INV-003/v1 **PASS** on that run                                  |
| `a629348f-e7cd-43c7-b529-fce4d2942f73` | INV-011/**v1** **FAIL**, `evaluated_at` 2026-08-31T20:17:06.028Z |
| `83aaa8ca-7b1a-482a-ab19-1537f8eccd29` | previous genuine regression, **STILL_FAILING**                   |
| `e6979f8c-2ea4-4dee-a9ef-9c43dcea8737` | C07 synthetic original INV-011/v1 **FAIL**                       |
| `8df09d4b-3eef-462c-b197-919d70305ef9` | C07 first genuine regression, **ERROR**                          |

The chain the product is meant to demonstrate, now provable from persisted rows:

```text
historical SYNTHETIC_DEMO FAIL
  -> Finding
    -> first GENUINE retest -> STILL_FAILING      (truthful failure, preserved)
      -> invariant-contract correction (INV-011 v1 -> v2)
        -> second GENUINE retest -> PASS
          -> SAME Finding RESOLVED
```

The v1 FAIL and the v2 PASS sit side by side, distinguishable by their stored `invariant_version`. Nothing was rewritten or deleted to obtain the resolution.

---

## 25. Provenance Vocabulary

| Classification           | Meaning in this phase                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REAL_RAZORPAY_WEBHOOK`  | A genuine, HMAC-verified Razorpay Test Mode delivery. The only `webhook_events.source_kind` that exists.                                                                      |
| `RECORDED_TEST_EVIDENCE` | A chaos run grounded in genuine provider evidence — the C07 and C11-A regression runs.                                                                                        |
| `SYNTHETIC_DEMO`         | A controlled PayChaos simulation or a test-owned historical fixture. Includes both original Findings and every C03 run (C03 fabricates its own invalid signature internally). |
| `PAYCHAOS_REPLAY`        | An `event_processing_attempts.source_kind` for controlled replay of an already-received genuine event. Not used by C07 or C11-A.                                              |

A replay is never described as a Razorpay delivery. A synthetic original Finding is never described as real merchant performance. **No Razorpay certification and no official Go-Live approval is claimed anywhere.**

---

## 26. P4 Acceptance Audit

| ID           | Criterion                                                                | State                    | Evidence                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P4-AC-01     | Every P0 failed invariant can produce an evidence pack                   | Satisfied by Phase 4A    | `DiagnosisEvidencePackV1`                                                                                                                                |
| P4-AC-02     | Supported failures map to deterministic root-cause categories            | Satisfied by Phase 4C    | RC-001…RC-016                                                                                                                                            |
| P4-AC-03     | Diagnosis references supporting evidence                                 | Satisfied by Phase 4C    | evidence-linked classification                                                                                                                           |
| P4-AC-04     | Insufficient evidence is reported rather than hallucinated               | Satisfied by Phase 4C/4B | `UNKNOWN`/insufficient-evidence handling                                                                                                                 |
| P4-AC-05     | Recommendation from approved deterministic mapping                       | Satisfied by Phase 4D    | `RECOMMENDATION-CATALOGUE-V1`                                                                                                                            |
| **P4-AC-06** | A user can start a regression for an existing finding                    | **PASS (4E)**            | `POST /api/findings/{findingId}/regressions`; exercised on Production for C07 and C11-A                                                                  |
| **P4-AC-07** | Regression reruns the original supported scenario                        | **PASS (4E)**            | Scenario re-derived from persisted evidence; a NEW chaos run created through the existing safety-gated runner; suites 072/073/074                        |
| **P4-AC-08** | Original failure history remains preserved                               | **PASS (4E)**            | Section 24; immutable `invariant_results`, `ON DELETE RESTRICT`, suite 074 byte-for-byte assertion                                                       |
| **P4-AC-09** | Finding becomes RESOLVED only when the relevant approved criteria pass   | **PASS (4E)**            | C07 and final C11-A resolved on deterministic new evidence; the earlier C11 regression correctly stayed **STILL_FAILING** when criteria failed           |
| P4-AC-10     | Reliability score is deterministic                                       | **NOT COMPLETE**         | Phase 4F                                                                                                                                                 |
| P4-AC-11     | Score breakdown is visible and explainable                               | **NOT COMPLETE**         | Phase 4F / score presentation                                                                                                                            |
| P4-AC-12     | UNKNOWN is not counted as a normal PASS                                  | **Partially supported**  | Deterministic semantics already enforce it (`deriveAggregateOutcome`, regression `ERROR`); the final Phase 4 criterion must be closed with scoring in 4F |
| P4-AC-13     | Go-Live Readiness derived from frozen deterministic rules                | **NOT COMPLETE**         | Phase 4G                                                                                                                                                 |
| P4-AC-14     | UI states readiness is a PayChaos assessment, not Razorpay certification | **NOT COMPLETE**         | Phase 4G / UI                                                                                                                                            |
| P4-AC-15     | P0 operates with no paid LLM API                                         | **SATISFIED**            | Phase 4E uses no AI, ML or LLM at runtime; ₹0 runtime cost                                                                                               |

**FULL PHASE 4 = NOT COMPLETE.**

---

## 27. Architectural Decisions

1. **A regression always creates a NEW chaos run.** The original run is read for its shape and never re-executed.
2. **No second chaos runner.** Every effect comes from a frozen Phase 3 service.
3. **No local scenario→invariant map** in `lib/regression/`; the registry is the single authority.
4. **Eligibility ignores prose.** Generated text is never load-bearing for execution.
5. **All three Finding statuses are eligible in principle** (architect decision D-2).
6. **Terminalize the regression before the Finding write** — recoverable and honest in that order, dishonest in the other.
7. **The Finding follows the newest CONCLUSIVE attempt**, protected at three boundaries: convergence before a new start, a newest-conclusive check, and compare-and-set on `updated_at`.
8. **`SUPERSEDED` is service-level only**; no such database status exists.
9. **Multi-step scenarios are honest.** C07 and C11-A return `AWAITING_EXTERNAL_ACTION` and wait for genuine external action.
10. **Persisted chaos state is authoritative** over any execution service's returned kind.
11. **The two API routes are adapters only**; every consequential decision stays in the service.
12. **Invariant versioning over silent reinterpretation** — the INV-011 v2 decision (Section 15).
13. **Stored verdict over re-derivation** for terminal regressions — the convergence decision (Section 16).

---

## 28. Known Issues / Non-Blockers

### A. Demo Merchant does not auto-refresh

The Demo Merchant page is server-rendered and does not poll or subscribe, so an already-open tab keeps showing a stale render after asynchronous webhook processing. A manual refresh shows the persisted truth. This was observed during both C07 and C11-A verification; the refresh is **not** payment confirmation, created no second payment, and does not invalidate either scenario. **Polling / realtime polish is deferred to Phase 5 UX**, not a Phase 4E correctness blocker.

### B. Windows/OneDrive Vitest worker-start faults

Intermittent `Failed to start forks worker` / worker-response timeouts. Such runs are **rejected environment runs, not passes**, and are re-run until clean.

### C. Windows/OneDrive `.next` EPERM during build

Approved recovery: delete **only** `.next`, retry the build **once**.

### D. Existing lint warning

`tests/integration/supabase/051-chaos-safety-gate.integration.test.ts` — unused `eslint-disable` directive. **0 lint errors.** Pre-existing and untouched by Phase 4E.

### E. Final C11 duplicate-attempt timestamp anomaly — KNOWN NON-BLOCKING AUDIT-TIMESTAMP ANOMALY

Duplicate processing attempt `25442b30-b8eb-4482-ba7f-ddae25418e44` records:

```text
started_at  = 2026-09-01T03:45:50.293847+00:00
finished_at = 2026-09-01T03:45:50.181+00:00
```

`finished_at` is approximately **113 ms earlier** than `started_at`.

It did **not** affect webhook signature verification, duplicate classification, the `SKIPPED_DUPLICATE` status, payment truth, the fulfilment count, any money invariant result, or regression finalization. The evidence has deliberately **not** been silently corrected.

**Recommendation:** re-check and fix before the final Phase 5 demo **if** processing duration or ordering is presented to judges.

### F. INV-003 result summary nuance

The persisted INV-003 result for the final C11-A run reports:

```text
observed_summary = "orders.payment_status = UNPAID; authoritative capture = NONE_OBSERVED"
```

while the final merchant state after the genuine `payment.failed` processing is `FAILED_OBSERVED`.

Stated plainly rather than hidden: **both `UNPAID` and `FAILED_OBSERVED` are non-`PAID` states and both satisfy INV-003's money-safety condition** — _a failed payment must never move an order into a paid state_. INV-003 asks only that question. **Transition legality is INV-011's rule**, and INV-011/v2 evaluated the `UNPAID → FAILED_OBSERVED` transition explicitly and passed it. The historical and current invariant results have **not** been rewritten to make the summary read more neatly.

---

## 29. Security / Authority

- **Razorpay Test Mode only.** No production or live payment system was touched at any point.
- **No arbitrary external target.** No URL, host, IP or endpoint is accepted by any Phase 4E surface.
- **No LLM is authoritative over money state.** Phase 4E contains no AI, ML or LLM at runtime; P0 needs no paid LLM API.
- **No card numbers, CVV, API secrets or webhook secrets** are stored, logged or printed. No raw webhook body, signature value or `raw_body_sha256` appears in any Phase 4E output.
- **Webhook signature verification remains authoritative** and was not altered.
- **A regression cannot manufacture provider evidence.** C07 and C11-A wait for genuine external action; nothing fabricates a Checkout, payment, failure or webhook.
- **Original invariant evidence is immutable** — no UPDATE grant to any role, `Update: never` in the generated types.
- **Finding lifecycle writes** go through one narrow server-side repository with compare-and-set; there is no second lifecycle writer.
- **RLS remains enabled** on `regression_runs` with zero policies and no `anon`/`authenticated` privileges. **No new permissive browser write path** was introduced.
- Both new routes reuse the existing access gate and fail closed when it is misconfigured; **no new authentication mechanism** was added.

---

## 30. Deferred Work

- Reliability Score (Phase 4F) and Go-Live Readiness (Phase 4G).
- Phase 4 UI surfaces for regression history and score breakdown.
- P1 AI differentiators (Phase 4H) — only after all P0 Phase 4 acceptance criteria pass.
- Demo Merchant realtime/polling refresh (Phase 5 UX).
- The duplicate-attempt timestamp anomaly (Section 28E), if timing is surfaced in the demo.
- C01 and C11-B regression paths are implemented and unit-tested but have not been exercised through a manual Production regression; C03 is covered automatically by suites 072/073/074.

---

## 31. Phase 4F Starting Contract

**Phase 4F is the Reliability Score. Do not implement it from this handoff.** Phase 4F must begin with a **READ-ONLY architect audit**, as 4E did.

Phase 4F may depend on these frozen Phase 4E semantics:

- the `regression_runs` schema and its seven columns;
- the status vocabulary `PENDING / RUNNING / RESOLVED / STILL_FAILING / ERROR`;
- the new-chaos-run-per-regression model;
- the Finding `RESOLVED` / `STILL_FAILING` lifecycle and `resolved_at` semantics;
- historical evidence immutability and invariant versioning;
- `UNKNOWN` ≠ `PASS`;
- existing deterministic invariant authority;
- existing diagnosis/recommendation authority boundaries (advisory only).

Phase 4F **must not** casually change: regression semantics, the Finding lifecycle, INV-011/v2, the scenario→invariant mapping, invariant PASS/FAIL/UNKNOWN authority, historical results, or provenance classification.

Phase 4F must implement only the frozen deterministic score contract from the source-of-truth documents. **No fake metrics. No AI-generated score.**

---

## 32. Do Not Break

Contracts the next phase must preserve:

- `regression_runs` has **no `updated_at`** column.
- `regression_runs.chaos_run_id` is UNIQUE; `finding_id` is not.
- `regression_runs_active_finding_uniq` is a concurrency boundary, not a one-regression-ever rule.
- `SUPERSEDED` is never a database status.
- Regression terminalization happens **before** the Finding lifecycle write.
- `generateFindingsForChaosRun` is never called automatically for a regression.
- INV-011 is version `"2"` with `evaluatorKey` `INV-011/v2` and an eight-member legal set; every other P0 invariant remains version `"1"`.
- Pre-start convergence must never re-evaluate a historical chaos run.
- The two regression routes remain adapters with no database, chaos or Razorpay reach.

---

## 33. Final Git / Deployment State

```text
branch                          = phase-4-diagnosis-scoring
HEAD                            = e06c527f78f847c722f59e38aba3a09f8afccd0c
origin/phase-4-diagnosis-scoring = e06c527f78f847c722f59e38aba3a09f8afccd0c
origin/main                      = 5007a6588f936651f51e01bfaf32c57dd59c0679
migrations                       = 13
staged                           = 0
```

**Production** runs branch `phase-4-diagnosis-scoring`, source commit `e06c527f78f847c722f59e38aba3a09f8afccd0c`, at `paychaos-ai.vercel.app`, status **Ready**.

Production carrying this commit is **not** full Phase 4 production completion: 4F and 4G remain.

`origin/main` is untouched by Phase 4E; nothing has been merged.

---

## 34. Phase State

```text
IMPLEMENTED             = YES
TESTED                  = YES
MANUALLY VERIFIED       = YES
DOCUMENTED              = YES
APPROVED                = YES
ARCHITECT APPROVAL      = YES
```

Architect review passed for Phase 4E only. Full Phase 4 remains incomplete: the
Reliability Score (4F) and Go-Live Readiness (4G) are unimplemented.
