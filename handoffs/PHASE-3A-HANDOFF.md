# Phase 3A — Scenario Registry + Chaos Safety Gate Handoff

**Project:** PayChaos AI — Autonomous Payment Reliability Engineer
**Branch:** `phase-3-chaos-engine`
**Frozen Phase 2 baseline commit:** `2c5c13fbd888eb566f442a680cff5d629bfc1cd5`
**Sub-phase:** Phase 3A — Scenario Registry and Safety Gate (`docs/PHASE_PLAN.md` Section 7.7)

---

## 1. Status

```text
IMPLEMENTED       = YES
TESTED            = YES
MANUALLY VERIFIED = YES
DOCUMENTED        = YES
APPROVED          = NO
```

**Phase 3A is NOT yet approved and has NOT been committed/pushed.** All Phase 3A work remains in the working tree on `phase-3-chaos-engine`, uncommitted, pending architect final review and approval.

---

## 2. Scope Implemented

Per `docs/PHASE_PLAN.md` Section 7.7 ("Phase 3A — Scenario Registry and Safety Gate": *"static approved scenario definitions; scenario IDs; prerequisites; invariant mappings; safety checks"*), Phase 3A implements:

- A static, **server-authoritative** P0 Scenario Registry (`import "server-only"`) — application code, not a database table (`docs/DATABASE.md` Section 15: *"There is no separate `chaos_scenarios` database table"*).
- Exactly the four frozen P0 scenarios: **C01, C03, C07, C11** — no P1 scenario (C02, C04–C06, C08–C10, C12–C15) is registered or executable.
- The frozen **12-field** registry contract (`docs/CHAOS_SCENARIOS.md` Section 30 "Chaos Scenario Registry Contract"): `scenario_id, name, priority, enabled, allowed_mechanisms, required_source_event_types, allowed_fault_types, required_invariants, default_failure_severity, requires_real_payment, requires_verified_webhook, requires_reset`.
- Approved primary mechanism vocabulary **A / B / C only** — no fourth mechanism category exists in the type system.
- **C07 represented as the fixed A + C combination** (`ChaosMechanismCombination = readonly ["A", "C"]`), not an invented `"A_C"` mechanism — corrected after architect review (see Section 12).
- The three allowed P0 fault primitives only: `REPLAY_EVENT`, `INVALID_SIGNATURE_TEST`, `DROP_CLIENT_CONFIRMATION`.
- **C11 has no unsafe fault primitive** (`allowedFaultTypes: []`) — it relies on genuine verified failure evidence, never a PayChaos-controlled fault.
- A deterministic, **read-only** Chaos Precheck / Safety Gate (`runChaosPrecheck`), covering **PRECHECK-01 through PRECHECK-10**.
- **First-failure deterministic `BLOCKED` result** — the first failing check in the fixed evaluation order wins and short-circuits every later check.
- **`PRECHECK_PASSED` is prerequisite-success only, NOT execution readiness** — it explicitly does not mean "chaos may now inject a fault."
- **Fixed Demo Merchant boundary** — no field anywhere in the precheck input contract can carry a merchant identifier; there is structurally only one possible target.
- **Arbitrary URL/host/IP/endpoint input is rejected** — both at the TypeScript type level (no such field exists in any input variant) and at runtime (`PRECHECK-10`'s exact-key structural validator).
- **Test Mode / test-key enforcement** — reuses the existing Phase 2A `getRazorpayEnv()` validator; no competing environment-validation logic.
- A read-only DB reachability/evidence/baseline **repository** module, reusing existing approved Phase 1/2 reads wherever possible.
- **C01** requires genuine source evidence (a signature-verified `payment.captured`/`order.paid` webhook correlated to a PAID/exactly-one-fulfilment baseline).
- **C03** requires no pre-existing real webhook — it always passes its evidence check (Mechanism C targets PayChaos's own fixed internal verification path).
- **C07** requires a known fresh baseline (`UNPAID`/`OPEN`/0 fulfilments) for any supplied candidate order; absence of a supplied order is itself a `BLOCKED`/`PRECHECK-08` result (corrected — see Section 12).
- **C11 Mechanism A** requires the same fresh-baseline rule as C07.
- **C11 Mechanism B** requires authentic failure evidence (`REAL_WEBHOOK_EVENT` or `TEST_FIXTURE` reference kind); it is never fabricated.
- **Zero execution/mutation/replay/injection in Phase 3A** — verified structurally (no `insert`/`update`/`delete`/`upsert`-shaped export anywhere in `lib/chaos/*`) and by test.

---

## 3. Files Added

```text
lib/chaos/types.ts                                                     (216 lines)
lib/chaos/registry.ts                                                  (178 lines)
lib/chaos/safety-gate.ts                                               (535 lines)
lib/chaos/repository.ts                                                (227 lines)
tests/unit/chaos/registry.test.ts                                      (199 lines)
tests/unit/chaos/repository.test.ts                                    (362 lines)
tests/unit/chaos/safety-gate.test.ts                                   (654 lines)
tests/integration/supabase/051-chaos-safety-gate.integration.test.ts   (543 lines)
```

All eight paths are currently **untracked** in the working tree (confirmed via `git status --short` — see Section D of the verification below). No route, no UI, no migration, and no `handoffs/PHASE-3-HANDOFF.md`-style Phase-3-overall file were added.

`lib/chaos/safety-gate.ts` exports exactly one public function: `runChaosPrecheck(rawInput: unknown): Promise<ChaosPrecheckResult>`. Every other helper (`checkRazorpayTestModeConfig`, `hasExactKeys`, `isValidMechanismShape`, `mechanismsEqual`, `validateExactShape`, `evaluateEvidenceAndBaseline`, `blocked`) is module-internal.

---

## 4. Existing Test Files Corrected

Two **pre-existing, unrelated** test files were found stale during the Phase 3A full-regression gate and corrected as **test-only** fixes, separate from Phase 3A's own runtime implementation. Neither correction touched Phase 2 production code.

### `tests/unit/api/webhooks-razorpay-route.test.ts`

**Confirmed: STALE/NON-PORTABLE TEST, not a production bug.**

- The test's timing-ordering assertion searched the route source for a hardcoded multi-line literal containing LF (`\n`) line endings.
- This Windows checkout has `core.autocrlf=true` (confirmed via `git config --get core.autocrlf`) and no `.gitattributes`, so `app/api/webhooks/razorpay/route.ts` is materialized on disk with CRLF (`\r\n`).
- Production webhook ordering was independently confirmed correct: `const result = await ingestRazorpayWebhook(...)` (`route.ts` line 78) unconditionally precedes the success-path `logEvent("webhook_request_completed", { http_status: 200, latency_ms: Date.now() - startedAt, ... })` call, with no intervening branch.
- The correction normalizes the read source (`routeSource.replace(/\r\n/g, "\n")`) immediately before the multi-line structural match, scoped to that one test only — it does not weaken the ordering assertion; it still proves `ingestRazorpayWebhook`'s call site precedes the success-path `latency_ms` log, not merely that both strings exist.
- **No Phase 2 production behavior changed.**

### `tests/integration/supabase/05-final-state.integration.test.ts`

**Confirmed: STALE Phase 2B-era assumption, not a production bug.**

- The test previously asserted a **global** `fulfilments` count of exactly 0, per a Phase 1/2B-era comment: *"No Phase 1/2B code path ever inserts a fulfilments row, real or test."*
- That assumption stopped being true the moment Phase 2F shipped `process_webhook_payment_event` — the RPC whose entire purpose is to insert exactly one fulfilment on a genuinely successful capture.
- The current architect-approved Phase 2G system legitimately and permanently persists one real fulfilment row (`handoffs/PHASE-2-HANDOFF.md` Section 3411: *"Exactly one `fulfilments` row exists... This is direct, real-world proof that two genuine webhook deliveries for the same order... did NOT double-fulfil"*).
- The corrected invariant traces `fulfilments.payment_id → payments.payment_attempt_id → payment_attempts.razorpay_receipt` and asserts zero fulfilments correlate to an attempt carrying the suite's existing `TEST_DATA_RECEIPT_PREFIX` test-ownership marker — the same marker the file already used for its `orders`/`payment_attempts` leak checks.
- Genuine merchant fulfilments (present now, or any that may exist later) remain explicitly allowed and untouched.
- **No production data was deleted or modified** by this correction; the fix is a read-only assertion rewrite.

---

## 5. Database Changes

**NO DATABASE MIGRATION IN PHASE 3A.**

**NO `chaos_runs` table yet** (`docs/DATABASE.md` Section 15 documents `chaos_runs` as a planned future table; it does not exist in the current schema).

**NO `invariant_results`/`findings` persistence yet.**

Phase 3A performs **read-only** database access only (`lib/chaos/repository.ts` exports zero mutation-shaped functions — verified by direct source grep and by a dedicated unit test asserting no export name matches `/^(insert|update|delete|upsert|remove|write|create)/i`).

Synthetic integration fixture rows created by `051-chaos-safety-gate.integration.test.ts` (orders, payment_attempts, payments, fulfilments) are cleaned by exact test ownership: every ID this file creates is pushed to a local ledger, deleted in `afterAll` in reverse dependency order, and independently re-verified via a real `SELECT` count against those exact IDs.

**Canonical genuine webhook evidence is never synthesized to satisfy a real-evidence requirement.** `webhook_events` is schema-fixed to `source_kind = 'REAL_RAZORPAY_WEBHOOK'` and documented as *"the canonical representation of a genuine, signature-verified Razorpay Test Mode webhook event"* (`docs/DATABASE.md` Section 13) — the integration test file never inserts into this table to satisfy an authentic-provider evidence prerequisite (see Section 8).

---

## 6. Scenario Registry

Current registry contents, read directly from `lib/chaos/registry.ts`:

| Field | C01 | C03 | C07 | C11 |
|---|---|---|---|---|
| `scenario_id` | `C01` | `C03` | `C07` | `C11` |
| `name` | Duplicate Webhook Delivery | Invalid Webhook Signature | Payment Succeeds but Client Confirmation Is Lost | Failed Payment Must Never Mark Order Paid |
| `priority` | P0 | P0 | P0 | P0 |
| `enabled` | true | true | true | true |
| `allowed_mechanisms` | `["B"]` | `["C"]` | `[["A","C"]]` | `["A","B"]` |
| `required_source_event_types` | `payment.captured`, `order.paid` | *(none)* | `payment.captured`, `order.paid` | `payment.failed` |
| `allowed_fault_types` | `REPLAY_EVENT` | `INVALID_SIGNATURE_TEST` | `DROP_CLIENT_CONFIRMATION` | *(none)* |
| `required_invariants` | INV-001, INV-002, INV-006, INV-007 | INV-004, INV-005 | INV-002, INV-004, INV-011 | INV-003, INV-004, INV-011 |
| `default_failure_severity` | Critical | Critical | High | Critical |
| `requires_real_payment` | true | false | true | true |
| `requires_verified_webhook` | true | false | true | true |
| `requires_reset` | true | false | true | false |

Invariant mappings independently cross-checked against `docs/MONEY_INVARIANTS.md` Section 54 "Authoritative Scenario-to-Invariant Matrix":

```text
C01: INV-001, INV-002, INV-006, INV-007
C03: INV-004, INV-005
C07: INV-002, INV-004, INV-011
C11: INV-003, INV-004, INV-011
```

**No invariant evaluators are implemented in Phase 3A.** The registry only *names* which invariant IDs each scenario declares as required, for Phase 3B/3F's Money Invariant Engine to consume later. `docs/MONEY_INVARIANTS.md` alone remains authoritative for what each invariant ID means and how it is evaluated.

---

## 7. Precheck Contract

`lib/chaos/safety-gate.ts`'s `runChaosPrecheck()` implements all ten official precheck IDs (`docs/CHAOS_SCENARIOS.md` Section 11):

| ID | Purpose |
|---|---|
| PRECHECK-01 | Environment Is TEST |
| PRECHECK-02 | Test Razorpay Key |
| PRECHECK-03 | No Production Credentials |
| PRECHECK-04 | Registered Demo Merchant Target |
| PRECHECK-05 | Scenario Is Registered |
| PRECHECK-06 | Database Reachable |
| PRECHECK-07 | Required Evidence Exists |
| PRECHECK-08 | Known Demo State |
| PRECHECK-09 | Fault Is Allowed |
| PRECHECK-10 | No Arbitrary External Target |

**Current deterministic evaluation order** (official IDs unchanged; sequence re-ordered so DB reachability is established before any DB-backed check runs):

```text
1. PRECHECK-01/02/03 — Razorpay Test Mode config (via existing getRazorpayEnv())
2. PRECHECK-05       — Scenario Is Registered + Enabled
3. PRECHECK-09       — Fault Is Allowed (mechanism + fault primitive)
4. PRECHECK-04       — Registered Demo Merchant Target (structurally satisfied no-op)
5. PRECHECK-10       — No Arbitrary External Target (exact-key/type shape validation)
6. PRECHECK-06       — Database Reachable
7. PRECHECK-07/08    — Required Evidence Exists / Known Demo State
```

**Mandatory failure → BLOCKED → zero replay/injection/payment mutation/external chaos call.** Any failing check returns `{status: "BLOCKED", failedPrecheckId, reasonCode, reason}` immediately; no later check runs, and no repository/mutation/network call beyond the read-only checks already performed occurs under any outcome.

### Phase 3A / Phase 3B security boundary

**Phase 3A does NOT claim complete execution-time PRE-SEC readiness.** `docs/SECURITY.md`'s "Security Pre-Flight Check" defines twelve PRE-SEC items (PRE-SEC-001 through PRE-SEC-012). Phase 3A's Chaos Prechecks overlap with the execution security preflight, but are not a full 1:1 mapping: direct corresponding security checks include PRE-SEC-001–006, 008, 009, and 012. PRECHECK-08 (Known Demo State) is a chaos-scenario state prerequisite rather than a direct PRE-SEC item. Before a chaos run becomes executable, **Phase 3B's execution boundary must add/verify at least:**

```text
PRE-SEC-007 — Required mechanism-specific server secrets exist
PRE-SEC-010 — Operator/session is authorized when access gate is enabled
PRE-SEC-011 — Audit/evidence recording path is available
```

`PRECHECK_PASSED` from Phase 3A never implies these three are satisfied.

---

## 8. Evidence / Provenance Rules

`REAL_RAZORPAY_WEBHOOK` is the genuine canonical provider-evidence marker (`docs/DATABASE.md` Section 13 — `webhook_events.source_kind` is schema-fixed to this single value; `docs/ARCHITECTURE.md` Section 14 "Controlled Event Replay Architecture": *"PayChaos never forges a webhook and then labels it `REAL_RAZORPAY_WEBHOOK`"*).

**C01's positive integration test was proven using genuine Phase 2G evidence, resolved entirely read-only:**

```text
known Razorpay payment: pay_TU0xvTbsJiOqPI
  → payment_attempt_id (read-only lookup on `payments`)
  → canonical signature-verified webhook_events row (read-only lookup, event_type in {payment.captured, order.paid})
```

Preferred event type is queried first; `order.paid` is only consulted as a fallback if no `payment.captured` row correlates. In the verified run, the **preferred event selected was `payment.captured`**. No raw payload or secret value is included anywhere in this handoff or in the test's own console output — only the event type label was logged.

State:

- **No synthetic canonical signature-verified webhook was created to pass C01.** The integration test file's only `.from("webhook_events").insert(...)` call anywhere is a schema-constraint proof that always fails (asserting `signature_verified = false` is rejected by the database) — self-verified by a dedicated regression-guard test counting exactly one such call in the file.
- **C11 genuine `payment.failed` evidence has not yet been manually established and approved for use by Phase 3A/Phase 3B.** Phase 3A did not rely on or claim a genuine `payment.failed` provider event for C11. Mechanism B's positive real-evidence path remains to be manually verified later in Razorpay Test Mode.
- The `TEST_FIXTURE` path exists **structurally** in the type system (`ChaosFailureEvidenceRef`'s `{kind: "TEST_FIXTURE", fixtureId}` variant) but **Phase 3A has no fixture store** — `loadC11TestFixtureFailureEvidence()` always returns `null` by design.
- **C11 `TEST_FIXTURE` therefore currently blocks at `PRECHECK-07`** (`C11_FAILURE_EVIDENCE_UNAVAILABLE`) in every case — never a fabricated pass.

---

## 9. Automated Test Evidence

All counts below were independently re-run and verified during this session (not assumed):

```text
Phase 3A registry:              39/39  PASS
Phase 3A safety gate:           47/47  PASS
Phase 3A repository:            24/24  PASS
Focused Phase 3A combined unit: 110/110 PASS

Phase 3A real Supabase integration (051-...): 20/20 PASS

Full unit regression:     763/763 PASS  (39/39 files)
Full Supabase regression: 145/145 PASS  (12/12 files)

Build:      PASS
E2E:        2/2 PASS
Typecheck:  PASS
Lint:       PASS
Prettier:   PASS (scoped to changed/new Phase 3A + corrected files)
git diff --check: PASS
```

**Known Windows/OneDrive environmental behaviors observed during this work (factual, not assertion failures):**

- Occasional Vitest worker/test timeout under resource pressure (`[vitest-pool-runner]: Timeout waiting for worker to respond`, or `Test timed out in 5000ms` on an unrelated file) during heavy back-to-back full-suite runs — in every occurrence, the specific failing file was independently re-run in isolation and passed cleanly, confirming the failure was resource contention, not a genuine regression. This was never used to wave away a real assertion failure without that isolated re-confirmation.
- Stale `.next` build-cache `EPERM: operation not permitted, unlink` error, which cleared after deleting `.next/` and retrying once.
- Next.js 16.3.2 `middleware` file convention deprecation warning (`Please use "proxy" instead`) — cosmetic, non-blocking, deferred to Phase 5.
- One isolated Playwright dev-server startup timeout (`Timed out waiting 180000ms from config.webServer`) during a period of heavy concurrent test/build activity — resolved on a clean full e2e re-run (2/2 passed) with zero code changes in between.

No genuine assertion failure was classified as environmental. The two genuine, pre-existing stale-test issues (Section 4) were root-caused with concrete evidence and corrected as test-only fixes, not dismissed as environmental.

---

## 10. Manual Verification Evidence

The following checkpoints were manually reviewed and confirmed by the developer/architect during this Phase 3A round:

```text
Registry:                 39/39 PASS
Safety Gate:               47/47 PASS
Real Supabase integration: 20/20 PASS
Repository:                24/24 PASS
Final: git diff --check    PASS
```

What these checkpoints proved:

- **Registry (39/39):** the four P0 scenarios' static metadata (mechanisms, invariant mappings, fault primitives, severity, boolean flags) exactly match the frozen contract, no P1 scenario/fault is reachable, and the registry module is genuinely server-only.
- **Safety Gate (47/47):** the ten-precheck evaluation order is deterministic and correct end-to-end for every scenario/mechanism combination, including the corrected PRECHECK-08 "no order supplied → BLOCKED" behavior for C07/C11-A, the corrected A+C mechanism model, no secret/raw-error leakage in any `BLOCKED` reason, and zero mutation-capable code path.
- **Real Supabase integration (20/20):** the safety gate's DB-backed checks (reachability, baseline reads, evidence correlation) behave correctly against the real project, the genuine C01 `payment.captured` evidence resolves and reaches `PRECHECK_PASSED` without any synthetic canonical webhook ever being created, and the two known historical real Phase 2 rows remain provably unmutated.
- **Repository (24/24):** every read function (`checkChaosDatabaseReachable`, `getWebhookEventById`, `getOrderBaseline`, `isFreshBaseline`, `loadC01SourceEvidence`, `loadC11RealWebhookFailureEvidence`, `loadC11TestFixtureFailureEvidence`) behaves correctly against both mocked and real boundaries, and exposes no mutation capability.
- **`git diff --check` (final):** no whitespace/formatting corruption was introduced anywhere in the diff.

No screenshots, UI walkthroughs, or manual steps beyond the above were performed or are claimed — Phase 3A has no UI and no route.

---

## 11. Security Decisions

- Razorpay **Test Mode only** — reuses the existing Phase 2A `getRazorpayEnv()` validator; no competing config path.
- A **live-shaped key is blocked** (`RAZORPAY_KEY_ID` not `rzp_test_`-prefixed surfaces as `PRECHECK-02`).
- **No arbitrary external targets** — enforced both at the TypeScript type level (`ChaosPrecheckInput`'s five closed variants contain no URL/host/IP-capable field) and at runtime (`PRECHECK-10`'s exact-key structural validator, `hasExactKeys`/`isValidMechanismShape`).
- The **scenario registry is server-authoritative** (`import "server-only"` in `lib/chaos/registry.ts`) — a client-bundle import fails at build time.
- **No client authority over chaos definitions** — a future UI may only receive a safe server-generated projection, never this module.
- **No secrets returned in `BLOCKED` messages** — every config-failure path returns a stable safe reason string, never the raw `EnvValidationError` message or a credential value (verified by dedicated tests).
- **No mutation capability in Phase 3A repository/safety gate** — zero `insert`/`update`/`delete`/`upsert`-shaped export exists anywhere in `lib/chaos/*` (verified by source grep and by dedicated regression-guard tests in both the unit and integration suites).
- **No replay/injection/external chaos execution** exists in Phase 3A — `runChaosPrecheck` performs prerequisite checks only.
- **Genuine provider evidence is kept distinct from synthetic/test fixtures** — the integration test file never inserts a synthetic row into the canonical `webhook_events` table to satisfy an authentic-evidence prerequisite (Section 8).
- **LLM has no authority over payment truth** — Phase 3A contains no AI/LLM call of any kind; all evaluation is deterministic TypeScript.

---

## 12. Architectural Decisions

- **TypeScript registry, not a DB table** — consistent with `docs/DATABASE.md` Section 15 ("There is no separate `chaos_scenarios` database table") and `docs/ARCHITECTURE.md` Section 15.10.
- **No new dependency** — no Zod, no validation framework, no new npm package; `package.json`/lockfile unchanged throughout Phase 3A.
- **Exact 4 P0 scenarios only** — C01/C03/C07/C11; no P1 scenario wrapper is registered.
- **Mechanisms vocabulary remains A/B/C** — an architect review (Finding 2) rejected an initially-implemented invented `"A_C"` fourth mechanism category; corrected to a fixed `["A","C"]` combination of the three authoritative primary mechanisms.
- **C07 modeled as a combination of A + C**, not a new enum member, preserving the exact three-value mechanism vocabulary while still representing the scenario's single combined flow.
- **`PRECHECK_PASSED` does not mean executable** — it is explicitly scoped to Phase 3A's ten deterministic checks only; PRE-SEC-007/010/011 remain Phase 3B's responsibility (Section 7).
- **Phase 3A remains read-only** — a second architect review (Finding 3) found that C07 and C11 Mechanism A could reach `PRECHECK_PASSED` without ever verifying a baseline when no order was supplied; corrected so PRECHECK-08 always requires and verifies a known fresh baseline, while Phase 3A still never creates an order itself.
- **Phase 3B owns chaos-run persistence and execution-boundary security checks** — Phase 3A intentionally implements none of `chaos_runs`, PRE-SEC-007/010/011, or any execution logic.
- A third architect review (Finding 1) found the original integration test synthesized canonical `webhook_events` rows to simulate authentic evidence; corrected to resolve genuine Phase 2G evidence read-only via trusted database relationships, with the positive test now failing hard (rather than tolerating `BLOCKED` or logging a warning) if genuine evidence cannot be resolved.

---

## 13. Known Issues

- Next.js `middleware` file-naming convention is deprecated (Next.js 16.3.2 recommends `proxy.ts`) — deferred to Phase 5, non-blocking.
- Windows/OneDrive Vitest resource-timeout behavior under heavy concurrent load (worker-startup timeouts, occasional 5000ms test timeouts) — environmental, each occurrence independently re-confirmed passing in isolation before being treated as such.
- Windows/OneDrive stale `.next` `EPERM` build behavior — clears after deleting `.next/` and retrying once.
- **C11 genuine failed-payment evidence has not yet been manually established and approved for use by Phase 3A/Phase 3B.** Phase 3A did not rely on or claim a genuine `payment.failed` provider event for C11. Mechanism B's positive real-evidence path remains to be manually verified later in Razorpay Test Mode; its success path is currently proven only at the unit level against mocked evidence.
- **Provider-side redelivery (G13) was not manually performed in Phase 2** and must never be claimed as completed — carried forward unchanged from the Phase 2G handoff's own explicit disposition (G13 explicitly NOT PERFORMED — NON-BLOCKING).

The two test-only corrections documented in Section 4 are resolved, not open issues, and are not listed again here.

---

## 14. Deferred Work

Phase 3A explicitly did **NOT** implement:

- `chaos_runs` persistence
- execution runner
- webhook replay
- invalid-signature execution
- client-confirmation drop execution
- failure injection
- before/after evidence snapshots
- invariant evaluators
- `invariant_results`
- findings
- diagnosis
- recommendations
- regression runs
- reliability score
- Phase 3 UI

---

## 15. Phase 3B Dependencies / Frozen Contracts

Phase 3B may rely on the following from Phase 3A as stable:

- registry API/types (`lib/chaos/types.ts`, `lib/chaos/registry.ts` — `getScenarioDefinition`, `listScenarioDefinitions`, `isRegisteredScenarioId`, `P0_SCENARIO_IDS`)
- safety-gate input/result contract (`ChaosPrecheckInput`, `ChaosPrecheckResult`, `runChaosPrecheck`)
- `PRECHECK_PASSED`/`BLOCKED` semantics, including the fixed `failedPrecheckId`/`reasonCode`/`reason` shape
- the read-only evidence repository (`lib/chaos/repository.ts`)
- P0 scenario metadata (Section 6 table)
- provenance rules (`REAL_RAZORPAY_WEBHOOK` is the only genuine canonical marker; Section 8)
- arbitrary-target rejection (type-level + `PRECHECK-10` structural validation)
- fresh-baseline rules (`isFreshBaseline`, the C07/C11-A `freshOrderId` requirement)

**Phase 3B must NOT bypass the safety gate.** Every chaos execution path must call `runChaosPrecheck` and honor a `BLOCKED` result.

**Phase 3B must persist a chaos run before execution** and implement the remaining execution-boundary security requirements (PRE-SEC-007, PRE-SEC-010, PRE-SEC-011 — Section 7) before any fault mechanism becomes executable.

---

## 16. Final Approval Gate

```text
IMPLEMENTED       = YES
TESTED            = YES
MANUALLY VERIFIED = YES
DOCUMENTED        = YES
APPROVED          = NO

READY FOR ARCHITECT FINAL PHASE 3A REVIEW = YES
```

Commit/push must wait for architect approval. No commit or push has been performed as part of this or any prior Phase 3A round.
