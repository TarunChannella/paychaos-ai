# PayChaos AI — Phase 4F Handoff

Internal sub-phase handoff for **Phase 4F — Reliability Score** (`docs/PHASE_PLAN.md` Section 8.7).

**This is NOT the full Phase 4 handoff.** `handoffs/PHASE-4-HANDOFF.md` belongs to the end of the whole phase, once 4A–4G P0 work is complete, and is deliberately not created here.

```text
IMPLEMENTED             = YES
TESTED                  = YES
MANUALLY VERIFIED       = YES
DOCUMENTED              = YES
ARCHITECT APPROVAL      = YES
```

**Phase 4 as a whole is NOT COMPLETE.** Go-Live Readiness (4G) is unimplemented, and P4-AC-13 and P4-AC-14 remain open.

---

## 1. Objective

Deterministic `RELIABILITY-V1` scoring and an explainable operator-facing Reliability Score surface:

```text
persisted chaos evidence
  -> scenario-aware eligibility filter
    -> LATEST_SELECTION_V1  (created_at DESC, id DESC)
      -> approved persisted-state mapping
        -> frozen deduction table
          -> score = max(0, 100 - sum of four deductions)
            -> GET /api/reliability  +  server-rendered /reliability
```

The score is **derived on demand** and never stored. It uses no AI, ML or LLM at any point: two deployments of this project must compute the same score whether or not either has a model available.

---

## 2. Frozen Architecture

```text
algorithmVersion = RELIABILITY-V1
selectionVersion = LATEST_SELECTION_V1
```

Mandatory scenarios, in stable display order:

```text
C01
C03
C07
C11
```

### Scenario-aware classification eligibility

| Scenario | Required `chaos_runs.data_classification` |
| -------- | ----------------------------------------- |
| C01      | `RECORDED_TEST_EVIDENCE`                  |
| C03      | `SYNTHETIC_DEMO`                          |
| C07      | `RECORDED_TEST_EVIDENCE`                  |
| C11      | `RECORDED_TEST_EVIDENCE`                  |

The requirement is **exact in both directions**: a C03 run labelled `RECORDED_TEST_EVIDENCE` is just as ineligible as a synthetic C07 run. That second half is the anti-relabelling guard — it exists so a future low score can never be "fixed" by calling a controlled simulation genuine provider evidence.

**C03 must always be presented as:**

```text
Controlled PayChaos security simulation
```

and classified `SYNTHETIC_DEMO`. It is never described as a Real Razorpay Event, a real webhook delivery, or recorded provider evidence — in the breakdown, the API response, the UI or the demo.

### Deductions

| State           | Deduction |
| --------------- | --------: |
| PASS            |         0 |
| FAIL — CRITICAL |        25 |
| FAIL — HIGH     |        20 |
| FAIL — MEDIUM   |        15 |
| FAIL — LOW      |        10 |
| UNKNOWN         |        15 |
| BLOCKED         |        15 |
| ERROR           |        15 |
| NOT_RUN         |        15 |

Fails closed: a FAIL run with no failed invariant row, an unrecognised severity, and any status/outcome pair outside the approved shapes all become `ERROR` / 15 — never `PASS`, never a silent zero.

---

## 3. 4F-C0 — Contract Correction

Commit: `d5e7f82c094ff5bae421960ac622fd6d8f8d78d4` — `docs: freeze reliability v1 eligibility`

The original specification required `RECORDED_TEST_EVIDENCE` for every mandatory scenario, which **C03 can never satisfy**: it builds its own invalid-signature request internally, creates zero `webhook_events` and zero `event_processing_attempts` rows, and makes no Razorpay call. Under the blanket rule a mandatory P0 security test that runs correctly was permanently `NOT_RUN` and permanently cost 15 points.

The fix was scenario-aware eligibility, **not** looser provenance. The audit also froze the previously ambiguous terminal-candidate contract and `LATEST_SELECTION_V1`, and drew the Finding/regression boundary. `docs/AI_DESIGN.md`, `docs/TESTING.md` and `docs/CHAOS_SCENARIOS.md` were updated; `SCORE-FIX-11` through `SCORE-FIX-17` were added.

---

## 4. R1 — Pure Score Engine

Commit: `527fd2ee1c72aa6dddf50629f71c9e4b2bc6478e` — `feat: add phase 4f reliability engine`

`lib/reliability/types.ts` and `lib/reliability/score.ts`. Types, frozen constants and one exported function, `calculateReliabilityScoreV1`.

**Pure by construction.** No database, network, filesystem, environment, clock or randomness — and no `server-only` marker, because there is nothing server-only about arithmetic. Both input arrays are copied before sorting, so a caller's array is never reordered. Given the same input it returns a deep-equal result every time, which is what P4-AC-10 actually asks for.

All 17 documented score fixtures have executable coverage, alongside determinism, input-order independence, input immutability, the score floor and both fail-closed paths. A static guard proves the purity structurally and parses the frozen constants back out of source, so the scenario set, classification matrix, deduction table and ordering key cannot drift silently.

---

## 5. R2 — SELECT-Only Repository and Service

Commit: `6305f81f5d7deb336cb9a55825035a2686e18444` — `feat: add phase 4f reliability read service`

`lib/reliability/repository.ts` and `lib/reliability/service.ts`.

The repository is `server-only` and reads **exactly two tables** through narrow explicit projections:

```text
chaos_runs         id, scenario_id, status, outcome,
                   data_classification, created_at, completed_at
                   (filtered to C01/C03/C07/C11 in the query)

invariant_results  id, chaos_run_id, invariant_id, result, severity
                   (for the loaded run ids only)
```

`fault_config`, `fault_state`, the entity foreign keys, and every prose column — `expected_summary`, `observed_summary`, `reason`, `evidence_refs` — are **not requested at all**, so a score cannot be derived from narrative. No ordering is issued: `LATEST_SELECTION_V1` belongs to the engine. `findings` and `regression_runs` are never queried.

### READ FAILURE IS NOT ABSENCE

A failed read raises a typed `ReliabilityRepositoryError` — `CHAOS_RUN_READ_FAILED` or `INVARIANT_RESULT_READ_FAILED` — and **never returns an empty array**. An outage that quietly became "no candidates" would produce a confident score of 40 assembled from four fictitious `NOT_RUN` scenarios: a number that looks like a measurement but is really a database timeout. No PostgREST message, detail, hint or code escapes.

The service splits composition from I/O. `composeReliabilityScoreReadModel` takes an already-loaded snapshot and performs only the frozen engine call plus counting; `getCurrentReliabilityScore` is the sole I/O entry point. That boundary exists so the acceptance proof can feed the **exact same two arrays** to both the engine and the composition — asserting agreement rather than asserting that the database sits still between two SELECT cycles.

### Explanation-only diagnostics

Per scenario: `totalCandidateCount`, `eligibleCandidateCount` (copied from the pure breakdown, never recomputed), `ineligibleCandidateCount`, and a reason of `LATEST_ELIGIBLE_RUN`, `NO_CANDIDATES` or `NO_ELIGIBLE_CANDIDATES`. They distinguish "never run" from "ran, but every run excluded" — and change nothing about score, state, deduction, selected run or provenance.

**No score persistence.** P0 derives the score on demand (`docs/DATABASE.md` Section 19 — `reliability_score_snapshots` is P1 only).

---

## 6. R3 — API, UI and Browser Proof

Commit: `238a6b4e5043d3b73af70e2fb7732516d024029e` — `feat: add phase 4f reliability api and ui`

- `GET /api/reliability` — GET only, no path parameter, query or body, so a caller cannot select a scenario, algorithm, threshold or target. Reuses the existing operator gate verbatim and returns the trusted read model as-is; there is deliberately no second DTO.
- `app/reliability/page.tsx` — a server component calling the service **directly** rather than fetching its own HTTP API, so the browser never reaches Supabase and no second auth hop exists. `force-dynamic`, because a cached score is a stale verdict.
- `components/reliability/reliability-overview.tsx` — presentation only.
- `middleware.ts` gates `/reliability` with the same operator gate as `/demo-merchant` and `/chaos`. The public webhook route is untouched.

Each breakdown row shows the state, deduction, required and selected classification, provenance label, selected run linked to its existing `/chaos/runs/{id}` page, run status and outcome, the supporting failed invariant and severity when relevant, and the candidate diagnostics.

**Safe failure state.** If the evidence cannot be read the page renders "Reliability data unavailable… This is a read failure, not an absence of evidence." Neither the API nor the page ever renders 0, 40, or four `NOT_RUN` rows from an outage.

### Authorized frozen-phase correction

R3 also fixed a **confirmed pre-existing bug** in the frozen Phase 3H E2E spec. `E2E-3H-02` uppercased the whole `/chaos` page body and asserted no `C02`…`C12` substring appeared. The page legitimately renders chaos-run UUIDs, and the historical run `8a30bd7f-bdd3-432b-8c05-526d980cd6a6` contains `8c05`, which uppercased to `8C05` and failed the `C05` check. The evidence was correct; the assertion was not.

It now reads the scenario-offering elements the page actually renders — card testids and scenario hrefs, independently — and requires the offered set to be **exactly** `C01, C03, C07, C11`. That is stronger than what it replaced: the old scan could not detect a _missing_ P0 scenario, and could be fooled by any identifier appearing elsewhere on the page. **No historical run was deleted or altered**, and `app/chaos/` and `lib/chaos/` have zero diff.

---

## 7. Current Verified Deployed Output

```text
Reliability Score:  85 / 100
Total deduction:    15
```

| Scenario | Selected run                           | State       | Deduction | Classification           |
| -------- | -------------------------------------- | ----------- | --------: | ------------------------ |
| C01      | `40a08f61-11dd-48c1-9460-238166150283` | **UNKNOWN** |        15 | `RECORDED_TEST_EVIDENCE` |
| C03      | `839984d8-f421-4b13-9f08-917bb417df43` | **PASS**    |         0 | `SYNTHETIC_DEMO`         |
| C07      | `853762e4-3e1f-498f-978b-1baf1ad49ae1` | **PASS**    |         0 | `RECORDED_TEST_EVIDENCE` |
| C11      | `d97e3fc6-e0f1-48f5-a613-95f87989101c` | **PASS**    |         0 | `RECORDED_TEST_EVIDENCE` |

C01 displays _"Inconclusive evidence — not counted as PASS."_
C03 displays _"Controlled PayChaos security simulation."_

Selection diagnostics: C01 1 total / 1 eligible; C03 9 / 9; C07 4 / 3 (one synthetic fixture correctly excluded); C11 5 / 4 (likewise). All four report `LATEST_ELIGIBLE_RUN`.

> **85 is the verified current database result, not a hard-coded metric.**
>
> It is recalculated from persisted evidence on every request and is stored nowhere. It will legitimately change the moment new chaos evidence lands — for example, a successful C01 regression would move that scenario from `UNKNOWN` to `PASS` and raise the score to 100. No permanent test asserts `85`; every automated assertion is a deterministic property that holds whatever evidence exists. The exact-number visual contract is proven separately against a fixed fixture in `tests/unit/reliability/reliability-overview.test.tsx`.

---

## 8. Manual Verification

Performed against the deployed Vercel Preview for commit `238a6b4e5043d3b73af70e2fb7732516d024029e`:

- Vercel Preview opened successfully.
- The home page displayed **Open Reliability Score**.
- `/reliability` loaded successfully.
- The score and the four-scenario breakdown were visible.
- **C01 `UNKNOWN` was visibly not treated as PASS** — the 15-point deduction and the "not counted as PASS" wording both displayed.
- C03 showed the correct synthetic provenance and `SYNTHETIC_DEMO` classification.
- The selected C01 run link opened the existing chaos-run detail page successfully.
- A hard refresh reconstructed `/reliability` successfully — the score is recalculated per request, not cached.
- **No Go-Live Readiness verdict was displayed**; 4G has not leaked early.

---

## 9. Test Evidence

| Gate                            | Result                                     |
| ------------------------------- | ------------------------------------------ |
| focused unit                    | **9 files / 186 tests / PASS**             |
| `076` real Supabase (read-only) | **10/10 PASS**                             |
| Phase 3H Playwright             | **12/12 PASS**                             |
| R3 Playwright                   | **7/7 PASS**                               |
| full Playwright                 | **21/21 PASS**                             |
| full offline                    | **139 files / 3815 tests / PASS**          |
| full real Supabase              | **37 files / 505 tests / PASS**            |
| `npx tsc --noEmit`              | **PASS**                                   |
| `npx eslint .`                  | **0 errors**, 1 known pre-existing warning |
| `npm run build`                 | **PASS**                                   |
| Prettier                        | **PASS**                                   |
| `git diff --check`              | **PASS**                                   |

Both real-Supabase suites (`075`, `076`) are **read-only**: zero inserts, zero updates, zero deletes, no fixture and no cleanup.

Windows/OneDrive Vitest worker-start faults, 5-second import timeouts and Playwright parallel-contention failures were encountered during the phase. Every such run was **rejected and re-run**; none is counted as a pass, no timeout was raised to hide one, and no assertion was weakened. The known `.next` EPERM build recovery (delete only `.next`, retry once) was applied where needed and reported.

---

## 10. Database

```text
Migration count       = 13
Phase 4F migrations   = 0
Score persistence     = NO
```

No `reliability_scores` table and no `reliability_score_snapshots` table. `reliability_score_snapshots` remains **P1 only**. The P0 score is derived on demand.

---

## 11. Security

- **Razorpay Test Mode only.** No production or live payment system is touched.
- No Supabase service-role key and no Razorpay secret ever reaches the browser.
- The API reuses the existing operator gate and fails closed when misconfigured; `/reliability` is gated by the same middleware gate. The public webhook route is unaffected.
- **No database write** from any Reliability surface — repository, service, route and UI are all read-only.
- No score mutation, no payment/order/webhook mutation, no Finding or regression mutation, no invariant re-evaluation.
- **No AI, ML or LLM arithmetic** anywhere in the score path; P0 needs no paid API.
- No arbitrary target, no external HTTP, no raw repository error or secret shown to a caller.

---

## 12. Acceptance Criteria

| ID       | Criterion                                                                | State    |
| -------- | ------------------------------------------------------------------------ | -------- |
| P4-AC-10 | Reliability score is deterministic                                       | **PASS** |
| P4-AC-11 | Score breakdown is visible and explainable                               | **PASS** |
| P4-AC-12 | UNKNOWN is not counted as a normal PASS                                  | **PASS** |
| P4-AC-13 | Go-Live Readiness from frozen deterministic rules                        | Phase 4G |
| P4-AC-14 | UI states readiness is a PayChaos assessment, not Razorpay certification | Phase 4G |

**FULL PHASE 4 = NOT COMPLETE.**

---

## 13. Frozen Boundary for Phase 4G

Phase 4G may **consume** the frozen `ReliabilityScoreReadModel` — the score, the four-row breakdown and the selection diagnostics give it everything it needs without recalculating anything.

Phase 4G **must not change**:

- `RELIABILITY-V1` arithmetic;
- `LATEST_SELECTION_V1`;
- scenario eligibility, including the C03 exception in either direction;
- the deduction table;
- R1/R2/R3 evidence semantics, including READ FAILURE ≠ ABSENCE and the provenance labels.

Phase 4G **owns**:

- `NOT READY`, `NEEDS ATTENTION`, `READY`;
- unresolved-Finding readiness gates;
- baseline and security gates;
- the readiness explanation;
- the mandatory disclaimer.

Exact disclaimer:

> "PayChaos Go-Live Readiness is an engineering assessment from the implemented PayChaos test suite. It is not Razorpay certification."

Note the deliberate separation: unresolved-Finding gates belong to 4G readiness, **not** to 4F score arithmetic. Applying them in both places would double-count the same fact.

---

## 14. Do Not Break

- `RELIABILITY-V1` and `LATEST_SELECTION_V1` are version strings; changing the deterministic meaning of either requires a new version, never a silent edit.
- `completed_at` is required for finality but is **never** the ordering key.
- `SYNTHETIC_DEMO` is score-eligible **only** for C03; a C03 run labelled `RECORDED_TEST_EVIDENCE` is ineligible.
- A read failure must never become a score.
- The score is never persisted; `lib/reliability/` performs no write of any kind.
- `score.ts` remains the sole arithmetic authority — no deduction table, eligibility matrix, ordering or severity rank may be duplicated in the repository, service, route or UI.

---

## 15. Phase State

```text
IMPLEMENTED             = YES
TESTED                  = YES
MANUALLY VERIFIED       = YES
DOCUMENTED              = YES
APPROVED                = YES
ARCHITECT APPROVAL      = YES
```

Architect review passed for Phase 4F only. Full Phase 4 remains incomplete: Go-Live Readiness (4G) is unimplemented.
