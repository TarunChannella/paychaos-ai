# Phase 3B — Chaos Run Model / Persistence Handoff

**Project:** PayChaos AI — Autonomous Payment Reliability Engineer
**Branch:** `phase-3-chaos-engine`
**Frozen Phase 3A baseline commit:** `491e583279d3849d86707c880d8aa657baf85fad`
**Sub-phase:** Phase 3B — Chaos Run Model (`docs/PHASE_PLAN.md` Section 7.7)

---

## 1. Phase Identity

Phase 3B is the second Phase 3 sub-phase: **Chaos Run Model / durable persistence**. It sits between the frozen, approved Phase 3A Scenario Registry + Safety Gate and the not-yet-implemented Phase 3C Controlled Replay. Phase 3B owns exactly one new table (`chaos_runs`), the read/write repository over it, and the orchestration service that decides what to persist from a Phase 3A precheck result. It owns nothing else.

---

## 2. Status

```text
IMPLEMENTED                       = YES
TESTED                            = YES
REMOTE MIGRATION APPLIED          = YES
REAL SUPABASE INTEGRATION VERIFIED = YES
MANUALLY VERIFIED                 = YES
DOCUMENTED                        = YES

APPROVED                          = NO
```

**Phase 3B is not yet approved.** Only the architect may grant final approval after reviewing this handoff. No commit or push has been performed for any Phase 3B work.

---

## 3. Objective

Per `docs/PHASE_PLAN.md` Section 7.7 ("Phase 3B — Chaos Run Model"): implement unique chaos-run identity, run lifecycle, source payment/event linkage, scenario configuration, and result state — durably, before any later phase is permitted to execute a chaos mechanism. Phase 3B is the audit foundation Phase 3C/3D will build on; it performs zero execution itself.

---

## 4. Completed Features

- `public.chaos_runs` — the first Phase 3 database table, migrated and applied to the real Supabase project.
- Durable run/audit persistence via `lib/chaos/run-repository.ts`.
- `PENDING` run persistence whenever the frozen Phase 3A `runChaosPrecheck` returns `PRECHECK_PASSED`.
- Eligible `BLOCKED` run persistence for a defined, narrow subset of Phase 3A precheck failures (`PRECHECK-07/08/09/10` only).
- Fail-closed behavior when the audit database write itself fails — no fabricated `chaos_run_id`, no claimed persistence, safe structured logging only.
- Read-only chaos run lookup (`getChaosRunById`).
- Explicit, always server-derived `data_classification` — never caller/browser-controlled, and (after the final pre-migration correction) **not defaultable** at the database level.
- Nullable evidence/entity links (`order_id`, `payment_attempt_id`, `payment_id`, `source_webhook_event_id`) wherever the frozen Phase 3A contract genuinely does not guarantee one exists — never fabricated to satisfy a column.
- C11's `fault_type` is `NULL` for both of its mechanisms — no invented fourth "no fault" primitive.
- `failed_precheck_id` — a new, architect-approved column recording exactly which of the ten official `PRECHECK-xx` IDs blocked a persisted run.
- Two database-level consistency constraints (`chaos_runs_blocked_state_consistent`, `chaos_runs_pending_state_consistent`) enforcing the two lifecycle shapes Phase 3B produces, independent of application code.
- RLS enabled with zero policies; only `service_role` has any privilege on `chaos_runs`.
- Zero chaos execution — no replay, no fault injection, no Razorpay API call, no order/payment/fulfilment mutation anywhere in Phase 3B code.

---

## 5. Files Added

```text
supabase/migrations/20260829000000_phase3b_chaos_runs.sql
lib/chaos/run-repository.ts
lib/chaos/run-service.ts
tests/unit/chaos/run-repository.test.ts
tests/unit/chaos/run-service.test.ts
tests/integration/supabase/052-chaos-run-persistence.integration.test.ts
handoffs/PHASE-3B-HANDOFF.md   (this document)
```

## 6. Files Modified

```text
lib/supabase/types.ts            — added chaos_runs Row/Insert/Update/Relationships + supporting unions;
                                    Insert.data_classification is REQUIRED (no DB default to fall back on)
docs/DATABASE.md                 — chaos_runs section corrected: nullable order_id/payment_attempt_id/
                                    fault_type, added failed_precheck_id, added Consistency Constraints
                                    subsection, corrected data_classification to NOT NULL/NO DEFAULT
tests/unit/supabase/migration.test.ts  — Phase 3B static structural coverage added (see Section 14)
tests/unit/supabase/server.test.ts     — table-count assertion extended from 6 to 7 approved tables
```

No frozen Phase 3A file (`lib/chaos/types.ts`, `registry.ts`, `safety-gate.ts`, `repository.ts`, or their four test files) was ever touched across any Phase 3B round.

---

## 7. Database Changes

**Migration:** `supabase/migrations/20260829000000_phase3b_chaos_runs.sql` — additive only, creates `public.chaos_runs`. **Applied to the real Supabase project** (SQL Editor result: `Success. No rows returned`).

**Not touched by this migration:** `event_processing_attempts` (no `chaos_run_id` column added, no `source_kind` CHECK widening), and no `invariant_results`/`findings`/`regression_runs` table was created. All deferred to Phase 3C, matching the same "don't add unused surface early" reasoning the Phase 2E migration itself already applied to this exact deferral.

### Exact `chaos_runs` schema summary

| Column                      | Type        | Nullable | Default                                                                       |
| --------------------------- | ----------- | -------- | ----------------------------------------------------------------------------- |
| `id`                        | uuid        | No       | `gen_random_uuid()`                                                           |
| `scenario_id`               | text        | No       | — (CHECK: `C01`/`C03`/`C07`/`C11` only)                                       |
| `order_id`                  | uuid        | **Yes**  | — (FK → `orders.id`, `on delete restrict`)                                    |
| `payment_attempt_id`        | uuid        | **Yes**  | — (FK → `payment_attempts.id`, `on delete restrict`)                          |
| `payment_id`                | uuid        | Yes      | — (FK → `payments.id`, `on delete restrict`)                                  |
| `source_webhook_event_id`   | uuid        | Yes      | — (FK → `webhook_events.id`, `on delete restrict`)                            |
| `status`                    | text        | No       | `'PENDING'` (CHECK: PENDING/RUNNING/COMPLETED/FAILED)                         |
| `outcome`                   | text        | Yes      | — (CHECK: PASS/FAIL/UNKNOWN/BLOCKED/ERROR)                                    |
| `fault_type`                | text        | **Yes**  | — (CHECK: `REPLAY_EVENT`/`INVALID_SIGNATURE_TEST`/`DROP_CLIENT_CONFIRMATION`) |
| `failed_precheck_id`        | text        | **Yes**  | — (CHECK: `PRECHECK-01`..`PRECHECK-10`)                                       |
| `fault_config`              | jsonb       | No       | `{}` (CHECK: must be a JSON object)                                           |
| `fault_state`               | jsonb       | No       | `{}` (CHECK: must be a JSON object)                                           |
| `data_classification`       | text        | **No**   | **NONE** (CHECK: `RECORDED_TEST_EVIDENCE`/`SYNTHETIC_DEMO`)                   |
| `error_message_redacted`    | text        | Yes      | —                                                                             |
| `started_at`                | timestamptz | Yes      | —                                                                             |
| `completed_at`              | timestamptz | Yes      | —                                                                             |
| `created_at` / `updated_at` | timestamptz | No       | `now()`                                                                       |

Indexes: `scenario_id`, `order_id`, `payment_attempt_id`, `payment_id`, `source_webhook_event_id`, `(status, created_at)`, `(data_classification, completed_at)`.

Consistency constraints: `chaos_runs_blocked_state_consistent`, `chaos_runs_pending_state_consistent` (see Section 9).

**`data_classification` — architect-approved fail-closed correction:** `text NOT NULL` with **no default**. `RECORDED_TEST_EVIDENCE` is authoritative genuine-evidence provenance metadata — a server bug or future writer must never be able to omit this column and silently receive the strongest classification by default. A `SYNTHETIC_DEMO` default was considered and rejected too, since that could just as easily silently misclassify a genuine run in the other direction. Every writer must supply it explicitly; an INSERT that omits it is rejected by the database itself, not merely by application discipline.

**C11:** `fault_type` is always `NULL` for both mechanisms — never a fabricated `NONE`/`NO_FAULT`/fourth primitive.

**C03:** `order_id`/`payment_attempt_id`/`payment_id`/`source_webhook_event_id` may all be `NULL` — Mechanism C has no merchant order target at all.

---

## 8. Lifecycle Implemented in Phase 3B

Phase 3B creates only two row shapes, each independently enforced at the database level:

**PENDING** (on `PRECHECK_PASSED`):

```text
outcome = NULL
failed_precheck_id = NULL
started_at = NULL
completed_at = NULL
```

**COMPLETED / BLOCKED** (on a persistable `BLOCKED` result):

```text
status = COMPLETED
outcome = BLOCKED
failed_precheck_id = PRECHECK-07 | 08 | 09 | 10
started_at = NULL
completed_at != NULL
error_message_redacted != NULL   (safe text only)
fault_config = {}
fault_state = {}
```

**Phase 3B implements NO** `RUNNING` transition, no `PASS`/`FAIL`/`UNKNOWN`/`ERROR` completion, and no `FAILED`-status transition. Those are explicitly later-phase (3C/3D) responsibilities. The repository surface reflects this: exactly `createPendingChaosRun`, `createBlockedChaosRun`, `getChaosRunById` — no `startRun`/`transitionRun`/`completeRun`/`failRun`/`updateFaultState`.

---

## 9. P0 Scenario → Run Persistence Matrix

|                                 | C01                                     | C03                      | C07                                        | C11-A                     | C11-B (REAL_WEBHOOK_EVENT)                    | C11-B (TEST_FIXTURE)  |
| ------------------------------- | --------------------------------------- | ------------------------ | ------------------------------------------ | ------------------------- | --------------------------------------------- | --------------------- |
| `fault_type`                    | `REPLAY_EVENT`                          | `INVALID_SIGNATURE_TEST` | `DROP_CLIENT_CONFIRMATION`                 | `NULL`                    | `NULL`                                        | `NULL`                |
| `data_classification` (PENDING) | `RECORDED_TEST_EVIDENCE`                | `SYNTHETIC_DEMO`         | `RECORDED_TEST_EVIDENCE`                   | `RECORDED_TEST_EVIDENCE`  | `RECORDED_TEST_EVIDENCE`                      | never reaches PENDING |
| `order_id`                      | required, resolved via genuine evidence | `NULL`                   | required (`freshOrderId`)                  | required (`freshOrderId`) | required, resolved via evidence               | —                     |
| `payment_attempt_id`            | required, resolved                      | `NULL`                   | may be `NULL` at creation (no attempt yet) | may be `NULL` at creation | required if evidence correlation produced one | —                     |
| `source_webhook_event_id`       | required, resolved                      | `NULL`                   | `NULL` at creation                         | `NULL`                    | required, resolved                            | —                     |

**C11 Mechanism B TEST_FIXTURE currently can never reach `PRECHECK_PASSED`** — the frozen Phase 3A gate has no fixture store and always returns `BLOCKED/PRECHECK-07` for this path. See Section 10 for its BLOCKED shape.

---

## 10. BLOCKED Persistence Matrix

| Precheck ID       | Persisted? | Reason                                                                          |
| ----------------- | ---------- | ------------------------------------------------------------------------------- |
| PRECHECK-01/02/03 | **No**     | Global server/config failure, before any trusted scenario decision              |
| PRECHECK-04       | N/A        | Structurally cannot currently fail in the frozen implementation                 |
| PRECHECK-05       | **No**     | Scenario unregistered/disabled/malformed — never becomes a trusted audit record |
| PRECHECK-06       | **No**     | Audit database itself unreachable — persistence cannot be guaranteed            |
| PRECHECK-07       | **Yes**    | Registered scenario, evidence/entity resolution failed                          |
| PRECHECK-08       | **Yes**    | Registered scenario, baseline/state check failed                                |
| PRECHECK-09       | **Yes**    | Registered scenario, mechanism/fault not allowed                                |
| PRECHECK-10       | **Yes**    | Registered scenario, request shape rejected                                     |

**For PRECHECK-09/10:** only an independently re-confirmed, registered `scenarioId` is trusted from the raw request — `data_classification` is unconditionally `SYNTHETIC_DEMO` regardless of `scenarioId` (the row is an audit of a rejected request shape/mechanism, never evidence-backed execution), `fault_type` is always `NULL`, and every entity/evidence FK is `NULL`. No raw rejected field (URL, host, arbitrary fault string, unverified ID) is ever persisted.

**For C07/C11-A PRECHECK-08:** `order_id` is linked **only if** the frozen, read-only `getOrderBaseline(freshOrderId)` independently re-confirms the order genuinely exists — the baseline may be non-fresh (that's expected; freshness is not required for this audit link, and the order is never mutated). If `getOrderBaseline` returns `null` (a nonexistent supplied UUID), the BLOCKED audit row still persists successfully with `order_id = NULL` — it does **not** become an FK constraint violation or an audit-write failure. This was an architect-identified and corrected defect in an earlier Phase 3B candidate.

The C11 TEST_FIXTURE BLOCKED model persists exactly:

```text
scenario_id = C11, status = COMPLETED, outcome = BLOCKED
fault_type = NULL, all entity/evidence FKs = NULL
failed_precheck_id = PRECHECK-07, data_classification = SYNTHETIC_DEMO
started_at = NULL, completed_at = <finalization time>
```

— proving only that the requested TEST_FIXTURE path was blocked, never claiming fixture/provider evidence exists.

---

## 11. Security Decisions

- **PRE-SEC-011** (audit/evidence recording path available) is implemented through durable `chaos_runs` persistence itself — a future run must never be treated as executable unless its `PENDING` row already exists, read back from the database, not merely returned in-memory from the creation call.
- **PRE-SEC-007** (required mechanism-specific server secrets) is deliberately deferred to immediately before a later phase transitions a persisted run to `RUNNING`/executes its mechanism. Phase 3B's `createPendingChaosRun`/`createBlockedChaosRun` perform no Razorpay secret check — unnecessary for persisting PENDING/BLOCKED metadata.
- **PRE-SEC-010** (operator/session authorization) is deferred to Phase 3C's first untrusted route/execution boundary — Phase 3B exposes no route, UI, or externally callable endpoint. Phase 3C must reuse the existing session verifier (`lib/access/session.ts`'s `verifySessionToken`/`getAccessGateEnv`) and must never accept a caller-supplied `authorized: true` boolean.
- **No arbitrary external targets** — Phase 3B never reads or persists a URL/host/IP/endpoint value; PRECHECK-09/10 BLOCKED persistence trusts nothing from raw input except the independently-verified `scenarioId`.
- **No secrets are persisted or logged** — `error_message_redacted` only ever carries the stable, safe Phase 3A reason string; audit-write failures log only a safe category/scenario/error-name via `lib/security/logger.ts`, never a raw Supabase error.
- **No Razorpay API execution exists in Phase 3B** — confirmed by source-scan tests (no `fetch(`, no `razorpay/adapter` import, no direct `orders`/`payments`/`payment_attempts`/`fulfilments` mutation anywhere in `lib/chaos/run-repository.ts` or `lib/chaos/run-service.ts`).

---

## 12. Provenance / `data_classification` Rules

- `RECORDED_TEST_EVIDENCE` — the run is grounded in genuine Razorpay Test Mode evidence (a real payment/webhook, even if the run itself hasn't executed yet). Applies to C01, C07, C11 Mechanism A, C11 Mechanism B (REAL_WEBHOOK_EVENT), for both PENDING and their evidence-aware PRECHECK-07/08 BLOCKED persistence.
- `SYNTHETIC_DEMO` — the run has no genuine provider evidence lineage. Applies to C03 (always — Mechanism C never touches a real webhook), C11 Mechanism B TEST_FIXTURE (always), and **every** PRECHECK-09/10 BLOCKED row regardless of scenario (mechanism/evidence lineage cannot be trusted before shape validation succeeds).
- **Never caller/browser controlled.** `data_classification` is always computed by `lib/chaos/run-service.ts` from the scenario/mechanism/evidence-kind being persisted — never read from a raw request field.
- **NOT NULL, NO DEFAULT** at the database level (Section 7) — this is deliberate fail-closed handling, not an oversight; every insert must decide and state the classification explicitly or be rejected.

---

## 13. Tests Performed

**Unit (mocked, no network):**

```text
npx vitest run tests/unit/chaos/run-repository.test.ts tests/unit/chaos/run-service.test.ts
→ 52/52 passed

npx vitest run tests/unit/supabase/migration.test.ts tests/unit/supabase/server.test.ts
→ 140/140 passed

npx vitest run tests/unit/chaos/ tests/unit/supabase/
→ 302/302 passed

npm run test (full unit suite, final pre-migration correction round)
→ Test Files 41 passed (41), Tests 854 passed (854)
```

**Real Supabase integration (post-migration):**

```text
npx vitest run --config vitest.integration.config.ts tests/integration/supabase/052-chaos-run-persistence.integration.test.ts
→ Test Files 1 passed (1), Tests 21 passed (21)

npx vitest run --config vitest.integration.config.ts
→ Test Files 13 passed (13), Tests 166 passed (166)
```

**Other gates (final pre-migration correction round):**

```text
npm run typecheck  → PASS (clean)
npm run lint       → PASS (0 errors; 1 pre-existing warning in a frozen Phase 3A
                     integration test file — unused no-console eslint-disable —
                     never touched by any Phase 3B change)
npm run build      → PASS (only the pre-existing Next.js middleware→proxy
                     deprecation warning)
Prettier           → PASS (clean on all changed files)
git diff --check   → PASS (clean; only informational CRLF line-ending notices)
```

## 14. Exact Test Results (static migration coverage)

`tests/unit/supabase/migration.test.ts`'s Phase 3B describe block statically verifies, against the actual migration file text: table creation exactly once; every nullability requirement (`order_id`/`payment_attempt_id`/`payment_id`/`source_webhook_event_id`/`fault_type`/`failed_precheck_id` nullable, `data_classification` `NOT NULL` with no `default`); all 10 named CHECK constraints by name and by exact allowed-value list; `ON DELETE RESTRICT` on all 4 FK columns; all 7 required indexes; RLS enabled + zero `CREATE POLICY` + explicit revoke from `anon`/`authenticated` + explicit grant to `service_role`; and scope confirmation that `event_processing_attempts` is untouched, `source_kind` is not widened, and no `invariant_results`/`findings`/`regression_runs` table exists.

---

## 15. Manual Verification Performed

- Migration `supabase/migrations/20260829000000_phase3b_chaos_runs.sql` manually applied via the Supabase SQL Editor — result: `Success. No rows returned`.
- Real-Supabase integration test suite run post-migration (Section 13) — 21/21 new Phase 3B tests passed, 166/166 full Supabase integration suite passed (including the two known historical genuine Phase 2/2G rows, re-confirmed read-only and unmutated).
- Supabase Table Editor manually opened on `public.chaos_runs` → Rows/Data view → **0 rows** — manually confirming every synthetic integration-test `chaos_runs` record was exact-ID cleaned up after the test run, with no leaked audit rows left in the real project.

---

## 16. Architectural Decisions

- `chaos_runs.order_id`/`payment_attempt_id`/`payment_id`/`source_webhook_event_id`/`fault_type` were corrected from an originally-planned `NOT NULL` shape to nullable — the frozen Phase 3A registry structurally makes a stricter shape impossible to satisfy for real P0 scenarios (C03 has no order target at all; C07/C11-A's fresh order is not guaranteed to have a payment attempt yet).
- `failed_precheck_id` was added (not originally planned) so a BLOCKED audit row records which specific precheck failed, per the architect's explicit requirement that persistence itself remain evidence-first.
- `data_classification` was corrected twice: first established as `NOT NULL DEFAULT 'RECORDED_TEST_EVIDENCE'`, then corrected to `NOT NULL` with **no default** — a defaulted authoritative-evidence column is a silent-misclassification risk in either direction; every writer must decide explicitly.
- The Phase 3B repository API narrows the frozen `ChaosPrecheckId` (`PRECHECK-01`..`10`) to its own `PersistableChaosRunFailedPrecheckId` (`07`..`10` only) via a real TypeScript type guard — stricter than, and independent of, the database CHECK constraint (which intentionally stays future-capable for all 10 values).
- PRECHECK-08's order-linking logic independently re-verifies FK existence via `getOrderBaseline` rather than trusting the mere presence of a caller-supplied `freshOrderId` — an architect-identified defect in an earlier candidate that would have converted a legitimate BLOCKED persistence attempt into a spurious FK-violation-driven audit-write failure.
- No new dependency was introduced anywhere in Phase 3B.

---

## 17. Known Issues

- Next.js `middleware` file-naming convention deprecation warning (recommends `proxy.ts`) — pre-existing, deferred to Phase 5.
- One pre-existing, frozen Phase 3A integration test file (`051-chaos-safety-gate.integration.test.ts`) carries an unused `no-console` eslint-disable directive warning — never touched by any Phase 3B change, out of scope to fix here.
- This session's Windows/OneDrive Vitest resource-pressure history (documented across earlier Phase 3B rounds: worker-startup timeouts and 5000ms test timeouts, always resolved on isolated retry, never a genuine assertion mismatch) — the final full unit run nevertheless completed cleanly at 854/854.
- Vite's `configLoader: 'native'` warning about the extensionless `./tests/integration/supabase/sequencer` import — non-blocking, pre-existing tooling housekeeping, not a Phase 3B concern.
- C11's genuine real failed-payment manual execution remains a later Phase 3 scenario/manual-verification requirement — Phase 3B only persists its run model (including the correctly-BLOCKED TEST_FIXTURE case) and did not execute any failure chaos.

---

## 18. Deferred Work

Explicitly not implemented in Phase 3B, deferred to Phase 3C onward:

```text
webhook replay
invalid-signature execution
client-confirmation-drop execution
Razorpay Checkout execution
payment failure execution
fault injection
event_processing_attempt creation
event_processing_attempts.chaos_run_id column
event_processing_attempts.source_kind widening
before/after evidence snapshots
invariant evaluation
invariant_results
findings
diagnosis
regression
Reliability Score
Phase 3 UI
API routes
PENDING → RUNNING transition
PASS/FAIL/UNKNOWN/ERROR completion
FAILED-status transition
PRE-SEC-007 mechanism-secret check (owed immediately before RUNNING)
PRE-SEC-010 operator/session authorization (owed at the first untrusted route)
```

---

## 19. Dependencies / Frozen Contracts for Phase 3C

Phase 3C may treat the following as stable and depend on them directly — **do not redesign this schema casually**:

```text
chaos_runs.id
chaos_runs.scenario_id
chaos_runs.status
chaos_runs.outcome
chaos_runs.fault_type
chaos_runs.failed_precheck_id
chaos_runs.data_classification
chaos_runs.order_id / payment_attempt_id / payment_id / source_webhook_event_id
chaos_runs.fault_config / fault_state
chaos_runs.started_at / completed_at / created_at / updated_at
lib/chaos/run-repository.ts: createPendingChaosRun / createBlockedChaosRun / getChaosRunById
lib/chaos/run-service.ts: createChaosRun(rawInput)
The frozen Phase 3A safety gate — runChaosPrecheck must never be bypassed
```

Any genuine schema change (a confirmed bug, a new Phase 3C requirement discovered through real implementation) requires the same architect-review process this phase itself went through — not a silent redesign.

---

## 20. Explicit Phase 3C Warnings

Phase 3C must still implement, when actually required by its own scope — none of this exists yet:

- `event_processing_attempts.chaos_run_id` (additive column).
- `event_processing_attempts.source_kind` CHECK widening to allow `PAYCHAOS_REPLAY`/`PAYCHAOS_SIMULATION`/`TEST_FIXTURE`, for controlled PayChaos replay/simulation provenance.
- PRE-SEC-010 route/session authorization at Phase 3C's first untrusted execution boundary — reusing the existing verifier, never accepting a caller-supplied `authorized: true`.
- PRE-SEC-007 as a mandatory check immediately before transitioning any run to `RUNNING`/executing a mechanism.
- The `PENDING → RUNNING` lifecycle transition, and actual controlled replay/fault execution.

**Before implementing any lifecycle transition beyond what Phase 3B already defines, Phase 3C must explicitly resolve and document the distinction between `status = FAILED` and `status = COMPLETED` with `outcome = ERROR`.** This was identified as an open question during Phase 3B and deliberately left unresolved (Phase 3B produces neither) — Phase 3C must not silently choose one interpretation without documenting the decision.

---

## 21. Phase Completion Checklist

```text
IMPLEMENTED                        [x]
TESTED                             [x]
REMOTE MIGRATION APPLIED           [x]
REAL SUPABASE INTEGRATION VERIFIED [x]
MANUALLY VERIFIED                  [x]
DOCUMENTED                         [x]
APPROVED                           [ ]  — architect review required
```

Commit and push must wait for explicit architect approval of this handoff. Phase 3C must not begin until that approval is granted.
