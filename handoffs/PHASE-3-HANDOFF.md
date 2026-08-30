# Phase 3 — Chaos Engine + Money Invariant Engine (final handoff)

```text
IMPLEMENTED             = YES
TESTED                  = YES
MANUALLY VERIFIED       = YES
DOCUMENTED              = YES
APPROVED                = YES  (final certification passed and architect review
                                approved; this commit is the Phase 3 freeze)
```

Phase 3 delivers the chaos runner, controlled fixture replay, controlled failure injection, the four mandatory P0 scenarios, the deterministic Money Invariant engine, invariant results, Findings, evidence capture, and the operator UI that makes all of it inspectable in a browser.

This document is the official Phase 3 handoff required by `docs/PHASE_PLAN.md` task 27. Sub-phase detail lives in the individual handoffs; this one records the phase-level contract and the acceptance evidence.

---

## 1. Sub-phase checkpoints

| Sub-phase  | Content                                        | Frozen commit                              |
| ---------- | ---------------------------------------------- | ------------------------------------------ |
| 3A         | Static scenario registry and safety prechecks  | see `PHASE-3A-HANDOFF.md`                  |
| 3B         | `chaos_runs` schema and run lifecycle          | see `PHASE-3B-HANDOFF.md`                  |
| 3C         | Controlled replay and replay provenance        | see `PHASE-3C-HANDOFF.md`                  |
| 3D         | Execution safety, C03 / C07 / C11 mechanisms   | see `PHASE-3D-*-HANDOFF.md`                |
| 3E         | Evidence snapshots and chaos evidence assembly | see `PHASE-3E-A/B-HANDOFF.md`              |
| 3F         | Money Invariant engine INV-001…INV-012         | `1aa9f50c675459f067597552f50e9c0209c1250b` |
| 3G         | Finding generation                             | `efff27bca7314037be032e4d549116da8b0eaf5c` |
| 3H Round 1 | Server foundation and read models              | `88e5054842d9a21a358837f38aa1710d322fdc87` |
| 3H Round 2 | Chaos + Finding UI, browser verification       | `9d6603de791070d07de821ef6a724f1608b5a1df` |

Phase 3H's internal rounds are working divisions inside one official phase, not extra project phases.

---

## 2. Official P3 acceptance matrix

Evidence is labelled **AUTOMATED**, **REAL DATABASE**, **MANUAL BROWSER**, or a combination. Every row is `PASS`.

| #        | Criterion                                                                                       | Status | Evidence kind                              | Evidence                                                                                                                                                                                                                                                                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------- | ------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3-AC-01 | User can select a predefined P0 chaos scenario                                                  | PASS   | MANUAL BROWSER + AUTOMATED                 | Developer opened `/chaos` and saw exactly C01, C03, C07, C11, projected from the frozen registry. Reinforced by scenario-DTO unit tests and E2E-3H-02.                                                                                                                                                                                             |
| P3-AC-02 | Unknown scenarios are rejected                                                                  | PASS   | AUTOMATED                                  | `isRegisteredScenarioId` in the frozen registry; create-route behavioural tests reject `C02`, `C04`, `C99`, `c03`, empty and malformed ids with 400; no P1 identifier is reachable.                                                                                                                                                                |
| P3-AC-03 | Chaos cannot target arbitrary external systems                                                  | PASS   | AUTOMATED + MANUAL BROWSER                 | Frozen safety gate and the closed `ChaosPrecheckInput` union carry no URL/host/endpoint field; static UI and route guards ban them; E2E-3H-03 asserts zero text inputs; the developer confirmed no such control exists.                                                                                                                            |
| P3-AC-04 | Every chaos run has a stable run ID                                                             | PASS   | MANUAL BROWSER + REAL DATABASE             | Fresh manual C03 `bc3e2ad7-a51d-4656-a801-ce36e0c1ae49` survived create → execute → evaluate and page refresh, and reads back identically from the database.                                                                                                                                                                                       |
| P3-AC-05 | Replay references previously verified source evidence                                           | PASS   | REAL DATABASE + MANUAL BROWSER             | C01 run `40a08f61-11dd-48c1-9460-238166150283` replays source webhook `b44d7767-a635-4b24-a43a-19e64976f172`, `signature_verified = true`, `REAL_RAZORPAY_WEBHOOK`.                                                                                                                                                                                |
| P3-AC-06 | Replay is labelled `PAYCHAOS_REPLAY`                                                            | PASS   | REAL DATABASE + MANUAL BROWSER             | Two persisted replay attempts `2eedbad2-…` and `f2449505-…`, both `PAYCHAOS_REPLAY` / `SUCCEEDED`, rendered in the browser as PayChaos Controlled Replay.                                                                                                                                                                                          |
| P3-AC-07 | At least one scenario demonstrates a meaningful reliability failure **or validates resilience** | PASS   | MANUAL BROWSER + REAL DATABASE             | The fresh C03 run persisted `INV-005 = PASS`: both intentionally invalid signatures were rejected with zero trusted mutation. This is the **validated resilience** branch. The temporary synthetic FAIL is explicitly **not** used for this criterion.                                                                                             |
| P3-AC-08 | Every implemented P0 invariant is deterministic                                                 | PASS   | AUTOMATED                                  | Frozen Phase 3F-B evaluator suites plus dedicated determinism tests over INV-001…INV-012; evaluation is pure over an assembled evidence bundle and reads no clock for correctness.                                                                                                                                                                 |
| P3-AC-09 | Invariants return PASS/FAIL/UNKNOWN correctly                                                   | PASS   | AUTOMATED + REAL DATABASE + MANUAL BROWSER | Fresh C03 `PASS`; ten historical `UNKNOWN`; permanent evaluator and orchestration suites; the run page renders the persisted value without recomputing it.                                                                                                                                                                                         |
| P3-AC-10 | Missing evidence results in UNKNOWN rather than false PASS                                      | PASS   | AUTOMATED + REAL DATABASE + MANUAL BROWSER | The ten historical `UNKNOWN` results exist precisely because their processing attempts pre-date snapshot capture; evaluator tests pin the rule; the UI keeps UNKNOWN visually and textually distinct from PASS.                                                                                                                                    |
| P3-AC-11 | Invariant FAIL generates a structured finding                                                   | PASS   | AUTOMATED + MANUAL BROWSER                 | Frozen Phase 3G Finding service and its real integration suite. Additionally proven end-to-end in a browser using a **clearly-labelled TEMPORARY SYNTHETIC UI-verification FAIL chain**, generated through the real production service. **That fixture was deleted afterwards and is not merchant reliability evidence.**                          |
| P3-AC-12 | Finding links to relevant evidence                                                              | PASS   | MANUAL BROWSER + AUTOMATED                 | The Finding detail screen showed the `CHAOS_RUN` evidence reference and the `View run evidence timeline` link, reading expected/observed/reason through the immutable invariant result rather than a copy.                                                                                                                                         |
| P3-AC-13 | User can inspect the relevant event/payment timeline                                            | PASS   | MANUAL BROWSER                             | Developer inspected the C01 real/replay evidence timeline — source webhook, original attempt, two replay attempts, factual `NOT_CAPTURED` gaps — and the fresh C03 timeline.                                                                                                                                                                       |
| P3-AC-14 | Real and simulated/replayed evidence is visibly distinguishable                                 | PASS   | MANUAL BROWSER + AUTOMATED                 | Four distinct labels render from persisted values: Razorpay Test Mode real webhook, PayChaos Controlled Replay, Recorded Test Mode Evidence, and Demo/Synthetic Data. Provenance-label tests pin the mapping and reject unknown values.                                                                                                            |
| P3-AC-15 | Automated tests pass                                                                            | PASS   | AUTOMATED + REAL DATABASE                  | **Final certification round, all green:** full offline 101 files / 2657 tests; cumulative unit 59 / 1907; focused Phase 3H 9 / 195; full Playwright 14; Phase 3H Playwright 12; real 066 1 file / 24 tests; full real Supabase 27 files / 370 tests. Zero failures, zero skips, zero test retries. Typecheck, lint, build and Prettier also green. |

---

## 3. Database state at the end of Phase 3

```text
chaos_runs                 10
invariant_results          12
findings                    0
webhook_events             16
event_processing_attempts  20
orders                     11
payment_attempts           11
payments                   10
fulfilments                 7
PENDING runs                0
RUNNING runs                0
active C07 faults           0
active C11-A observations   0
```

**Approved historical Phase 3F baseline — unchanged throughout Phase 3H:**

```text
historical chaos runs        5
historical invariant results 11
PASS                          1
UNKNOWN                      10
FAIL                          0
Findings for those results    0
```

**Phase 3H verification evidence, counted separately:**

```text
fresh manual C03 run   bc3e2ad7-a51d-4656-a801-ce36e0c1ae49
                       C03 / COMPLETED / PASS / SYNTHETIC_DEMO
                       one persisted result INV-005 = PASS, zero Findings
```

The `findings` table is empty. **The real persisted FAIL count across the whole project is zero**, and no synthetic row is included in any reliability statistic.

---

## 4. Frozen Contracts Phase 4 Must Not Break

- Phase 3A–3H semantics are frozen as of this commit.
- The P0 scenario set remains **C01, C03, C07, C11** unless an explicit approved architecture change says otherwise.
- Chaos remains **Razorpay Test Mode only**, against the controlled Demo Merchant only.
- **No arbitrary targets.** No URL, host, IP, endpoint or script may ever become an accepted input.
- Verified source provenance remains authoritative.
- `REAL_RAZORPAY_WEBHOOK` must **never** be confused with `PAYCHAOS_REPLAY`.
- `RECORDED_TEST_EVIDENCE` and `SYNTHETIC_DEMO` remain explicitly distinguishable in storage and on screen.
- Synthetic evidence must be excluded from real merchant reliability claims.
- `invariant_results` are **immutable historical evidence** — the table grants no `UPDATE` to any role, and a re-evaluation reuses an equivalent row or raises an integrity conflict.
- Deterministic `PASS`/`FAIL`/`UNKNOWN` remain authoritative.
- **AI cannot alter an invariant verdict.** AI output is advisory only.
- `UNKNOWN` must never become `PASS` merely because evidence is missing.
- FAIL-to-Finding traceability must remain intact: only a persisted `FAIL` may create a Finding, and at most one Finding per invariant result.
- A Finding's expected, observed, reason and evidence references come from the immutable invariant result through the foreign key — **never** from duplicated columns on the Finding.
- Phase 4 may populate the diagnosis and recommendation fields and move `status` through `STILL_FAILING`/`RESOLVED`, but must **not** rewrite original invariant evidence.
- Original failures must remain preserved during regression; a re-test creates new evidence rather than editing old evidence.
- Payment, order and provider truth remains authoritative in the server, the database and Razorpay Test Mode — never in the browser.
- No service-role credential and no payment secret may reach the browser.
- The general operator Demo Reset remains **Phase 5** work and must not be claimed complete before then.

---

## 5. Deferred work

**Phase 4** — deterministic evidence-based diagnosis, diagnosis strength, root-cause classification, recommendations, regression and re-test workflow, Reliability Score, Go-Live Readiness, and AI differentiators only once P0 is stable.

**Phase 5** — the global deterministic Demo Reset (a P0 requirement before the final recorded demo), final deployment hardening, polished final demo, full deployment and manual QA, and the final rehearsal.

---

## 6. Known issues carried into Phase 4

None is a P0 blocker.

1. Eligibility candidate validation performs one Supabase round-trip per candidate, so the C01/C07/C11 scenario pages are slower than they need to be. Correct, but worth batching later.
2. One pre-existing unrelated lint warning in `tests/integration/supabase/051-chaos-safety-gate.integration.test.ts`.
3. Next.js emits a middleware→proxy deprecation warning; not redesigned in Phase 3.
4. Windows/OneDrive can cause a transient `.next` EPERM during build; the accepted recovery is to clear only `.next` and retry once.
5. The C01 provenance run has no persisted invariant results and is used only as provenance and timeline evidence.
6. The access gate is disabled for trusted local development; a public deployment must enable it with real credentials.

---

## 7. Final certification — completed and passed

The final certification round has run in full. Every required gate passed:

```text
focused Phase 3H tests         PASS    9 files /  195 tests
cumulative unit tests          PASS   59 files / 1907 tests
full offline suite             PASS  101 files / 2657 tests
real 066                       PASS    1 file  /   24 tests
full real Supabase suite       PASS   27 files /  370 tests
Phase 3H Playwright            PASS   12 passed / 0 failed / 0 skipped
full Playwright                PASS   14 passed / 0 failed / 0 skipped
responsive browser check       PASS    4 URLs x 2 viewports, 8/8
typecheck                      PASS
lint                           PASS   0 errors
build                          PASS   on the single authorised .next retry
Prettier                       PASS
git diff --check               PASS
final database baseline        PASS   restored exactly
no active controlled fault     PASS   PENDING/RUNNING/C07/C11-A all 0
security and frozen-scope      PASS   HEAD unchanged, 0 tracked files modified
```

Read-only browser certification at 1440x900 and 390x844 covered `/chaos`, the C03 scenario page, the fresh C03 run and the C01 provenance run. No horizontal document overflow, no critical console error, no uncaught page error and no unexpected 5xx at either viewport. No mutation action was dispatched.

The database was censused before the test round and again immediately after the real Supabase suite; every count and every piece of protected evidence was identical.

The architect reviewed this certification and approved it. **Phase 3 is APPROVED**, and this documentation commit is the final Phase 3 freeze checkpoint. Final documentation freeze commit: **this commit** (`docs: finalize phase 3 handoff`), whose parent is `9d6603de791070d07de821ef6a724f1608b5a1df`.

Approval is scoped to Phase 3. **Phase 4 has not started and is not implemented**, and the global deterministic Demo Reset remains Phase 5 work — see Section 5.

---

## 8. What Phase 3 proves end to end

```text
Demo Merchant
  -> Razorpay Test Mode payment/webhook evidence
    -> controlled chaos scenario (C01 / C03 / C07 / C11)
      -> deterministic Money Invariant evaluation
        -> persisted PASS / FAIL / UNKNOWN
          -> Finding on FAIL, with evidence traceability
            -> inspectable evidence timeline with truthful provenance
```

Diagnosis, recommendation, regression and scoring extend this chain in Phase 4. Phase 3 stops where deterministic truth stops.
