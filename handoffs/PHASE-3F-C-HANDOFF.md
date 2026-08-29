# Phase 3F-C — Evaluation Orchestration + Append-Only Invariant Result Persistence

```text
IMPLEMENTED             = YES
OFFLINE TESTED          = YES
REAL SUPABASE VERIFIED  = YES
MANUALLY VERIFIED       = YES
DOCUMENTED              = YES
ARCHITECT APPROVED      = YES
```

Frozen parent: `491f9545a1fc68469e5abe23919b03d5872e245e` — the corrected Phase 3F-B freeze.

**No migration.** **No findings.** **No diagnosis, recommendation or reliability score.** Phase 3G owns turning a `FAIL` invariant result into a Finding; nothing here creates one.

---

## 1. Blocker 3F-C-01 — history

Phase 3F-C integration discovered a confirmed correctness bug in the then-frozen `evaluateInv004`: it tested snapshot availability _before_ structural applicability, so a C03 run — which has no order, no payment attempt, no payment and zero processing attempts by construction — returned `UNKNOWN` instead of `NOT_APPLICABLE`.

Implementation stopped before any database write and escalated. The architect ruled to reopen Phase 3F-B narrowly rather than amend the documented expectations. The corrected evaluator was frozen at `491f9545…`, superseding `e4e4b569…`. This sub-phase's WIP was stashed intact across that correction and restored afterwards.

**The service applies no C03 special case and never converts one disposition into another.** The frozen evaluators now produce the documented dispositions naturally — confirmed against the real database in §9.

---

## 2. Production files

**New (2), no others:**

- `lib/invariants/result-repository.ts` — the append-only `invariant_results` repository plus the guarded `chaos_runs.outcome` finalization.
- `lib/invariants/service.ts` — `evaluateChaosRun(chaosRunId)` orchestration.

Both are `server-only`. Every frozen surface — `lib/invariants/{types,registry,evaluate,evaluator-utils,evaluators}.ts`, `lib/evidence/*`, `lib/chaos/*`, `lib/supabase/*`, `supabase/*`, `docs/*` — is byte-unchanged.

---

## 3. Orchestration

`evaluateChaosRun(chaosRunId)`, in strict order:

```text
1. assembleChaosRunEvidence(chaosRunId)      <- the ONLY evidence input
2. require run.status === "COMPLETED"
3. reject outcome BLOCKED   (never executed)
4. reject outcome ERROR     (technical failure, not a money basis)
5. required invariant IDs from bundle.requiredInvariantIds
6. evaluate ALL of them IN MEMORY first
7. if ANY disposition is ERROR -> persist nothing, derive nothing, throw
8. NOT_APPLICABLE is retained in the returned report
9. persist ONLY PASS / FAIL / UNKNOWN
10. only after every persistable row succeeds -> derive aggregate
11. finalize chaos_runs.outcome
12. return a structured result
```

Step 6 before step 9 matters: a run must never end up half-persisted and _then_ discover an `ERROR`.

The service never reads `orders`, `payment_attempts`, `payments`, `fulfilments`, `webhook_events` or `event_processing_attempts` itself — the static guard asserts it contains no `.from(` at all. Historical `state_before`/`state_after` of `NULL` means `NOT_CAPTURED` and is never reconstructed.

An ineligible run is a typed service error, never a merchant `FAIL`.

---

## 4. Append-only persistence

```text
1. canonicalize the candidate's evidence references
2. read the existing row for this exact (chaos_run_id, invariant_id)
3. equivalent      -> return it unchanged, write nothing
4. different       -> INVARIANT_RESULT_INTEGRITY_CONFLICT, write nothing
5. absent          -> INSERT
6. INSERT rejected -> re-read (a concurrent writer may have won the partial
                      unique index race) and re-apply steps 3/4 to that row
7. no row after a failed insert -> INVARIANT_RESULT_INSERT_FAILED
```

Step 6 is why the **database index** is the real protection: two evaluators can both see "no row" at step 2, exactly one INSERT survives, and the loser reconciles instead of retrying blindly. It never rewrites the winner's row.

**There is no `UPDATE`, `UPSERT` or replacement `DELETE` on `invariant_results` anywhere.** The Phase 3F-A migration also grants no `UPDATE` to any role, so a rewrite is impossible at the database as well as absent in code.

### Deterministic equality

Compared: `invariant_id`, `invariant_version`, `order_id`, `payment_attempt_id`, `payment_id`, `chaos_run_id`, `result`, `severity`, `expected_summary`, `observed_summary`, `reason`, canonical `evidence_refs`.

**Excluded: `id` and `evaluated_at`** — both are persistence metadata generated on first insert. Including them would make every repeat evaluation look like a conflict. A repeated evaluation returns the ORIGINAL `id` and `evaluated_at`, proven against the real database in §9.

### Evidence references

Only the evaluator's own selected refs are persisted — never the whole bundle. At the persistence boundary they are defensively validated (approved kind, real internal UUID), deduped and deterministically sorted. The two-field `{kind, id}` shape leaves nowhere for a payload, signature, secret or PII to travel.

---

## 5. Aggregate chaos-run outcome

Derived ONLY from this run's required invariant dispositions, never from the scenario ID:

```text
any FAIL                                          -> FAIL
else any UNKNOWN                                  -> UNKNOWN
else at least one PASS, rest PASS/NOT_APPLICABLE  -> PASS
else every invariant NOT_APPLICABLE               -> UNKNOWN
ERROR                                             -> service error, never aggregated
```

`NOT_APPLICABLE` never becomes `PASS`: a run where nothing applied has proven nothing. `UNKNOWN` never becomes `PASS`.

---

## 6. `chaos_runs.outcome` — the only mutable field

The finalizing UPDATE sets **`outcome` and nothing else — not even `updated_at`.** Because no timestamp is written, the repository reads no clock at all. `status`, `fault_type`, `fault_state`, `data_classification`, `source_webhook_event_id`, every correlation FK, `started_at`, `completed_at` and every error field are untouched.

```text
guarded UPDATE scope: id AND status = 'COMPLETED' AND outcome = 'UNKNOWN'

outcome already equals derived (and still COMPLETED) -> ALREADY_FINAL, no write
status no longer COMPLETED                           -> integrity conflict
BLOCKED / ERROR                                      -> never overwritten
contradicting PASS/FAIL                              -> integrity conflict
guarded update matched nothing                       -> re-read, then reconcile
```

The status check precedes the equality check deliberately: an "equal" outcome on a run that is no longer `COMPLETED` is contradictory evidence about a run that changed underneath us, not a safe idempotent success.

---

## 7. Error behaviour

| Code                                    | Meaning                                                           |
| --------------------------------------- | ----------------------------------------------------------------- |
| `INVARIANT_RESULT_LOOKUP_FAILED`        | reading an existing result failed                                 |
| `INVARIANT_RESULT_INSERT_FAILED`        | insert failed and no row exists afterwards                        |
| `INVARIANT_RESULT_INTEGRITY_CONFLICT`   | a different result is already persisted                           |
| `INVARIANT_RESULT_EVIDENCE_REF_INVALID` | a malformed evidence reference, rejected before any I/O           |
| `INVARIANT_RESULT_INVARIANT_ID_INVALID` | an ID outside the frozen P0 catalogue                             |
| `CHAOS_RUN_NOT_EVALUABLE`               | missing run, or not a `COMPLETED` non-`BLOCKED`/`ERROR` execution |
| `CHAOS_RUN_OUTCOME_LOOKUP_FAILED`       | reading the run's current outcome failed                          |
| `CHAOS_RUN_OUTCOME_FINALIZE_FAILED`     | the guarded update itself failed                                  |
| `CHAOS_RUN_OUTCOME_INTEGRITY_CONFLICT`  | the run's state contradicts the derived aggregate                 |
| `INVARIANT_EVIDENCE_LOAD_FAILED`        | evidence assembly failed                                          |
| `INVARIANT_EVALUATION_ERROR`            | an evaluator returned `ERROR`, or a required ID is uncatalogued   |

Every message is fixed text. No raw Supabase error, secret, payload, signature or customer data is ever included — asserted by test.

### Partial persistence

Rows are inserted sequentially. If a later insert fails, the earlier immutable rows **remain** — never deleted, never rewritten — the aggregate outcome is **not** finalized, and the error surfaces. Re-running is safe: each already-written row is recognised as equivalent and reused, so a retry converges rather than duplicating. This is the accepted P0 append-only recovery model and is deliberate, not an oversight.

---

## 8. Real integration test — 064

`tests/integration/supabase/064-phase3f-invariant-evaluation.integration.test.ts` — **1 file / 18 tests / 18 passed**.

It calls the real `evaluateChaosRun(...)` against the live project, not an INSERT fixture. It creates only `SYNTHETIC_DEMO` `chaos_runs` rows of its own and the `invariant_results` the orchestration derives; it creates no order, payment, webhook, processing-attempt or fulfilment row, executes no chaos, and touches no Razorpay surface. Cleanup is exact-ID, children before parents, with independent zero-row re-verification.

Proven: PASS persists · UNKNOWN persists · `NOT_APPLICABLE` creates no row · repeat evaluation returns the same `id` and the same `evaluated_at` with no second row · a contradictory candidate raises `INVARIANT_RESULT_INTEGRITY_CONFLICT` and does not overwrite · aggregate PASS · aggregate UNKNOWN · **finalization changed only `outcome`, every other `chaos_runs` column compared field-by-field before/after** · C03's `NULL`/`NULL`/`NULL` + non-`NULL` chaos run shape · ineligible runs rejected · anon denied · `service_role` SELECT works · no role can UPDATE a persisted result · **every persisted `evidence_refs` entry resolves to a row that actually exists in its own table** · **named non-mutation proof for `updated_at`, `fault_config` and `error_message_redacted`**.

---

### Required database-property integration audit

`MONEY_INVARIANTS.md` §59 requires integration tests to use **actual database relationships** for the rules below. Audited against the whole cumulative integration suite, separating two different questions: is the database property itself proven against real Postgres, and does a **Phase 3F evaluator** actually consume evidence produced by it.

| §59 property                                                         | Test that proves the DB property                                                                                                            | Real Postgres relationship                                    | Consumed through `evaluateChaosRun`                                                | Verdict                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Webhook uniqueness / canonical event identity (INV-001)              | `048-webhook-events` — "duplicate `razorpay_event_id` is rejected by the database (23505)"; `049-event-processing-attempts` dedup rows      | **YES** — real `UNIQUE` constraint, real 23505                | Not via a wrapper — INV-001 is C01-only                                            | **DB PROPERTY VERIFIED** · wrapper coverage NOT REQUIRED for Phase 3F |
| Fulfilment counts / duplicate-business protection (INV-002, INV-007) | `050-merchant-processing` tests 55-56, 57 (concurrent), 58 (two attempts, one order)                                                        | **YES** — real `fulfilments` rows, real FKs, real concurrency | Reached on the real C07 run; `UNKNOWN` because that run pre-dates snapshot capture | **DB PROPERTY VERIFIED** · wrapper coverage NOT REQUIRED for Phase 3F |
| Payment → attempt → order relationships (INV-004, INV-010)           | `050-merchant-processing` tests 77-78 ("wrong payment/order relationship rejects processing with no fulfilment") and its FK-rejection tests | **YES** — real FKs, real 23503                                | Reached on the real C07/C11 runs; `UNKNOWN` from the same pre-capture history      | **DB PROPERTY VERIFIED** · wrapper coverage NOT REQUIRED for Phase 3F |
| Amount / currency persisted relationships (INV-008)                  | `050-merchant-processing` tests 74-75 (amount mismatch), 76 (currency mismatch)                                                             | **YES** — real integer subunit columns                        | Not via a wrapper — INV-008 is in no P0 wrapper mapping                            | **DB PROPERTY VERIFIED** · wrapper coverage NOT REQUIRED for Phase 3F |
| Transaction rollback / retry-safe failed processing (INV-009)        | `050-merchant-processing` tests 74-75, 79, "a rejected transaction leaves no impossible partial state", and the PROCESSING-recovery test    | **YES** — real transactional RPC, real rollback               | Not via a wrapper — INV-009 is in no P0 wrapper mapping                            | **DB PROPERTY VERIFIED** · wrapper coverage NOT REQUIRED for Phase 3F |
| Evidence references against real persisted IDs                       | `064` test 3b — every `evidence_refs` entry is looked up by primary key in its own table                                                    | **YES** — live primary-key lookups                            | **YES** — through the real orchestration                                           | **DB PROPERTY VERIFIED** · also verified end-to-end                   |

#### Architect ruling on §59 — satisfied cumulatively

An earlier draft of this handoff read the "not consumed through `evaluateChaosRun`" column as an open Phase 3F blocker. **That reading was wrong and the architect has corrected it.** §59 requires integration tests to use _actual database relationships_ for those rules. It does **not** require every one of those database properties to also be consumed end-to-end through `evaluateChaosRun()` inside the same integration test.

§59 is satisfied cumulatively by three layers, all of which are green:

1. **Real Postgres integration tests prove the actual database property** — the middle column above: real `UNIQUE` violations (23505), real FK rejections (23503), real `fulfilments` rows under real concurrency, real integer-subunit amount/currency behaviour, real transactional rollback.
2. **The frozen Phase 3F-B evaluator suite proves the deterministic invariant semantics** — 295 evaluator tests plus determinism and static guards, over in-memory bundles, for all of `INV-001`…`INV-012`.
3. **Phase 3F-C proves orchestration against real Supabase** — real `evaluateChaosRun(...)`, append-only persistence, `NOT_APPLICABLE` filtering, evidence refs resolved against live persisted IDs, aggregate outcome derivation and `chaos_runs.outcome` finalization.

Explicitly, for the record:

- **No fake provider evidence was used anywhere in this phase.**
- **No fake `REAL_RAZORPAY_WEBHOOK` row is required** — and none was created. `webhook_events` is CHECK-constrained to `source_kind = 'REAL_RAZORPAY_WEBHOOK'` **and** `signature_verified = true`, so every row in it asserts a genuine HMAC-authenticated delivery; manufacturing one would have violated `CLAUDE.md` §24.
- **No extra Razorpay Test Mode payment is required to approve Phase 3F.**
- **No new chaos run is required to approve Phase 3F.**
- **No P1 scenario wrapper may be added merely to exercise `INV-008`/`INV-009`/`INV-010`/`INV-012` through `evaluateChaosRun`.** Wrapper delivery scope and invariant-engine scope are different concepts.
- **Full `INV-001`…`INV-012` evaluator implementation remains P0** and is implemented and frozen.
- **The P0 wrapper mapping remains unchanged: `C01`, `C03`, `C07`, `C11`.**

#### Truthful limitation that remains recorded

This is a factual note about the evidence that exists, not an open blocker. The 20 existing `event_processing_attempts` rows are genuine Phase 2/3D evidence but pre-date Phase 3E-A snapshot capture, so all 20 carry `NULL` snapshots — correctly read as `NOT_CAPTURED` and never backfilled. That is why INV-002/003/004/011 returned `UNKNOWN` on the four historical runs: the evaluators behaved correctly on the evidence that exists. Snapshot capture is implemented (`lib/events/processor.ts`), so future real runs will carry snapshots and those evaluations will resolve on their own, with no evaluator change.

---

## 9. Real five-run verification

Read-only census first: **0** existing `invariant_results` for the five approved runs, 0 in the table overall; all five `COMPLETED`/`UNKNOWN`.

| Run                           | Dispositions                                | Aggregate | Rows |
| ----------------------------- | ------------------------------------------- | --------- | ---- |
| Fresh C03 `c406dafd-…`        | INV-004 `NOT_APPLICABLE`, INV-005 `PASS`    | **PASS**  | 1    |
| Historical C03 `a0c5a66a-…`   | INV-004 `NOT_APPLICABLE`, INV-005 `UNKNOWN` | UNKNOWN   | 1    |
| Historical C07 `68878716-…`   | INV-002/004/011 all `UNKNOWN`               | UNKNOWN   | 3    |
| Historical C11-B `5090e423-…` | INV-003/004/011 all `UNKNOWN`               | UNKNOWN   | 3    |
| Historical C11-A `b49d344a-…` | INV-003/004/011 all `UNKNOWN`               | UNKNOWN   | 3    |

```text
PASS rows                 1
FAIL rows                 0
UNKNOWN rows             10
TOTAL persisted rows     11
NOT_APPLICABLE            2   (both C03 INV-004)
NOT_APPLICABLE rows       0
```

Exactly the documented expectations. Only the fresh C03 needed an outcome write (`UNKNOWN → PASS`); the four historical runs already carried `UNKNOWN` and took the idempotent no-write path.

**Second evaluation of all five:** 0 new rows, identical `id`s, identical `evaluated_at`, identical aggregates, every row reported `alreadyPersisted`, every finalization `ALREADY_FINAL`. No write-based repair.

### Direct five-run idempotency evidence

The original five-run report recorded row IDs but did not directly record `evaluated_at` before and after. That was re-verified directly — read-only and idempotent: the 11 authoritative rows were read in full (all 14 persisted columns, sorted by `chaos_run_id` then `invariant_id`), the same five runs were evaluated once more, and the same rows were read again.

```text
before rows                 11
after rows                  11
ids equal                   YES
evaluated_at equal          YES
full deterministic content  EQUAL  (all 14 columns, byte-for-byte)
new rows                     0
changed rows                 0
outcome writes               0     (all five ALREADY_FINAL)
alreadyPersisted             true for all 11 persisted evaluations
result tally                PASS 1 / FAIL 0 / UNKNOWN 10
```

Per-run outcomes after re-evaluation, unchanged: fresh C03 `PASS`; historical C03, C07, C11-B and C11-A all `UNKNOWN`. The two `NOT_APPLICABLE` dispositions still produced no row. Nothing was deleted, rewritten or repaired.

---

## 10. Historical non-mutation

Deterministic before/after snapshots, compared field-by-field:

| Table                       | Rows | Identical |
| --------------------------- | ---- | --------- |
| `orders`                    | 11   | YES       |
| `payment_attempts`          | 11   | YES       |
| `payments`                  | 10   | YES       |
| `webhook_events`            | 16   | YES       |
| `event_processing_attempts` | 20   | YES       |
| `fulfilments`               | 7    | YES       |

Processing census unchanged at **20 total / 0 non-null `state_before` / 0 non-null `state_after`**. Historical `NULL` remains `NULL`; no backfill, no reconstruction.

`chaos_runs`: 9 rows before and after. **One** field changed across the entire table — `outcome` on `c406dafd-…`, `UNKNOWN → PASS`. **Zero** non-outcome changes.

### Full `chaos_run` column non-mutation

The earlier projection omitted three columns. The comparison now covers **every** `chaos_runs` column, in `064` and in the direct five-run re-verification alike:

`id`, `scenario_id`, `order_id`, `payment_attempt_id`, `payment_id`, `source_webhook_event_id`, `status`, `outcome`, `fault_type`, `failed_precheck_id`, `execution_block_code`, `fault_config`, `fault_state`, `data_classification`, `error_message_redacted`, `started_at`, `completed_at`, `created_at`, `updated_at`.

`064` additionally asserts that the compared projection **is** that exact set, so the proof cannot silently weaken by dropping a column.

```text
updated_at               UNCHANGED
fault_config             UNCHANGED
error_message_redacted   UNCHANGED
fault_state              UNCHANGED
status / scenario_id / data_classification / all correlations / all timestamps   UNCHANGED
outcome                  the ONLY field Phase 3F-C ever writes
```

`updated_at` is the strongest of these. There is **no `updated_at` trigger anywhere in the schema** — no migration creates a single trigger — so the column moves only when a writer sets it explicitly. Phase 3F-C writes `{ outcome }` alone, so an unchanged `updated_at` is real database-level evidence rather than a restatement of a source-code assertion. Across the five-run re-verification, zero `chaos_runs` fields changed at all.

---

## 11. Gates

```text
Focused (tests/unit/invariants)                  10 files /  401 tests /  401 passed / 0 failed
Frozen regressions (evidence + chaos + supabase) 34 files / 1179 tests / 1179 passed / 0 failed
Real 064 (isolated)                               1 file  /   18 tests /   18 passed / 0 failed
Full real-Supabase suite                         25 files /  324 tests /  324 passed / 0 failed
Full offline (npx vitest run)                    87 files / 2340 tests / 2340 passed / 0 failed
Environmental retries                             0
Typecheck                                         PASS
Lint                                              0 errors, 1 pre-existing unrelated warning
Build                                             PASS on attempt 1 in this round (the earlier round hit
                                                  the known .next EPERM and passed after clearing ONLY
                                                  .next; no EPERM recurred here)
Prettier                                          PASS
git diff --check                                  PASS
```

---

## 12. Files changed

**Production (2 new):** `lib/invariants/result-repository.ts`, `lib/invariants/service.ts`
**Unit tests (5 new):** `result-repository.test.ts` (pure canonicalization + equality), `result-repository-io.test.ts` (append-only I/O against a programmable fake client), `service.test.ts` (orchestration; evaluators deliberately NOT mocked), `service-error-boundary.test.ts` (the ONLY file that mocks `evaluateInvariant`, solely to reach the ERROR branch), `phase3f-c-static-guard.test.ts`
**Integration (1 new):** `064-phase3f-invariant-evaluation.integration.test.ts`
**Handoff (1 new):** this file

**Modified (1):** `tests/unit/supabase/061-phase3e-chaos-evidence-provenance-guard.test.ts` — its forward-guard asserted `064-` was absent. Advanced, not weakened: `064-` is now pinned by exact name exactly as `062-` and `063-` already were, and `065-` is asserted absent.

**Total 10 paths.** No migration. No docs change. No frozen production file modified.

Two temporary harnesses drove the controlled real verification and were each deleted immediately afterwards; neither is part of the scope: `991-temp-3fc-five-run-verification.integration.test.ts` (the original five-run evaluation) and `991-temp-3fc-idempotency.integration.test.ts` (the direct before/re-evaluate/after idempotency proof above).

The static guard distinguishes tables rather than banning `.update(` globally: it parses each mutating call's target table, asserts `invariant_results` only ever sees `insert`, and asserts the single `chaos_runs` update sets exactly `{ outcome }`.

---

## 13. Known issues

**Open — partial persistence leaves committed rows behind by design.** If insert 2 of 3 fails, insert 1's row remains and the aggregate is not finalized. This is correct for an append-only table with no `UPDATE` privilege, and a retry converges. It does mean a failed evaluation can leave a run with some results persisted and no aggregate — visible as `outcome = UNKNOWN` with a partial result set. Documented rather than hidden.

**Closed — the earlier §59 "five gaps" entry was a misreading and has been withdrawn.** `MONEY_INVARIANTS` §59 is satisfied cumulatively (real database-property tests + frozen evaluator semantics + real 3F-C orchestration); see the architect ruling in §8. No fake provider evidence, no extra Razorpay payment and no extra chaos run are required for Phase 3F approval.

**Note — historical runs carry `NULL` snapshots by design.** The four historical runs evaluate to `UNKNOWN` because their processing attempts pre-date Phase 3E-A capture. That is the correct, truthful result on the evidence that exists — not a defect, and never to be "fixed" by backfilling.

**Note — the five approved runs now carry authoritative results.** That was the explicitly authorised mutation set. Re-running the orchestration on them is idempotent.

---

## 14. Deferred to Phase 3G and beyond

Findings (a `FAIL` invariant result becoming a Finding), diagnosis, root-cause classification, recommendations, `regression_runs`, the Reliability Score, Go-Live Readiness and all UI. None of it exists in this sub-phase.

---

## 15. Manual verification

Developer manually queried the real Supabase project. **No manual database mutation was performed** — both queries were read-only.

Result totals across `invariant_results`:

```text
PASS     =  1
UNKNOWN  = 10
FAIL     =  0
TOTAL    = 11
```

The developer then manually queried the two approved C03 chaos run IDs for `invariant_id = 'INV-004'`:

```text
Result: 0 rows
```

Interpretation:

- the authoritative persisted arithmetic matches the automated evidence exactly (§9);
- both C03 `INV-004` dispositions remain `NOT_APPLICABLE`;
- `NOT_APPLICABLE` created **no** `invariant_results` row — the filtering is proven in the real project, not merely in tests;
- no manual database mutation was performed.

```text
IMPLEMENTED             = YES
OFFLINE TESTED          = YES
REAL SUPABASE VERIFIED  = YES
MANUALLY VERIFIED       = YES
DOCUMENTED              = YES
ARCHITECT APPROVED      = YES
```

Official Phase 3F becomes **FROZEN** only when this exact freeze commit is successfully pushed to `origin/phase-3-chaos-engine`.

---

## 16. Final Phase 3F architecture status

| Sub-phase                                                                | State                                                                                                       | Commit                                     |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Phase 3F-A — schema + domain contracts + registry                        | APPROVED + FROZEN                                                                                           | `91feb29669ef8d5d3769dec63b94feaba5e01bea` |
| Phase 3F-B — twelve pure deterministic evaluators                        | APPROVED + FROZEN                                                                                           | `491f9545a1fc68469e5abe23919b03d5872e245e` |
| Phase 3F-C — orchestration + append-only persistence + aggregate outcome | IMPLEMENTED · OFFLINE TESTED · REAL SUPABASE VERIFIED · MANUALLY VERIFIED · DOCUMENTED · ARCHITECT APPROVED | this freeze commit                         |

**Official Phase 3F: APPROVED**, ready to freeze with this commit.

**Phase 3G: NOT STARTED.** No Finding exists yet. Phase 3F owns no Finding creation; turning a `FAIL` invariant result into a Finding belongs entirely to Phase 3G, which begins only on explicit architect authorization.

---

## 17. Do not break

- `invariant_results` is append-only: no `UPDATE`, no `UPSERT`, no replacement `DELETE`, ever.
- `NOT_APPLICABLE` and `ERROR` never reach the database.
- `ERROR` never becomes `UNKNOWN`, `PASS` or `FAIL`, and never lets a run claim an outcome.
- Only `chaos_runs.outcome` is mutable from this phase — never `updated_at` or any other column.
- Evidence comes only from `assembleChaosRunEvidence`; historical `NULL` snapshots are never reconstructed.
- Only the scenario's `requiredInvariantIds` are evaluated.
- The orchestration never special-cases a scenario and never overrides a disposition.
- Correlations are persisted as the evaluator reported them; a C03 result legitimately carries three `NULL` FKs.
