# Phase 3F-A — Invariant Result Schema + Domain Contracts + Full P0 Registry

```text
IMPLEMENTED             = YES
OFFLINE TESTED          = YES
REAL SUPABASE VERIFIED  = YES
MANUALLY VERIFIED       = YES
DOCUMENTED              = YES
APPROVED                = YES
```

**ARCHITECT FINAL REVIEW: APPROVED.** Phase 3F-A is frozen. This is **not** the completion of Phase 3F — 3F-B (deterministic evaluators) and 3F-C (orchestration + persistence) have not started.

### Accepted evidence summary

```text
Manual migration          20260902000000_phase3f_invariant_results.sql
Application               Supabase Dashboard -> SQL Editor -> Run
Application result        Success. No rows returned
Reapplied by tooling      NO
Isolated 063               1 file  /   36 tests /   36 passed / 0 failed
Full real-Supabase        24 files /  306 tests /  306 passed / 0 failed
Full offline              79 files / 1978 tests / 1978 passed / 0 failed
Focused correction        18 files /  646 tests /  646 passed / 0 failed
Typecheck                 PASS
Lint                      0 errors, 1 pre-existing unrelated warning
Build                     PASS
Prettier                  PASS on parseable Phase 3F-A paths
git diff --check          PASS
Historical non-mutation   PASS (chaos_runs and event_processing_attempts)
Cleanup                   PASS (independent zero-row proof)
Authenticated denial      STRUCTURAL ONLY — accepted for P0
Processing census         20 total / 0 non-null state_before / 0 non-null state_after
invariant_results left    0
Fresh C03 evidence        c406dafd-d48f-4e1e-b092-030acbb5e32b retained
Scope                     15 paths (3 production, 1 migration, 8 tests, 2 docs, 1 handoff)
lib/chaos, lib/evidence   untouched
```

Parent commit: `9585fa5315c88b196c8c301425b1c04cc8e27285` (the frozen Phase 3F evidence-compatibility correction).

**This is NOT the Money Invariant Engine.** Phase 3F-A ships **zero evaluators**. Nothing in this change decides `PASS`/`FAIL`/`UNKNOWN` for any evidence, and there is deliberately no placeholder evaluator anywhere — a stub returning `PASS` would be a fabricated money verdict. There is no `evaluateChaosRun()`, no invariant repository or service, no orchestration, no findings, no diagnosis, no recommendations, no reliability score, no regression workflow, and no Phase 3G/3H work.

---

## 1. Completed features

**A. The first `invariant_results` migration** — `supabase/migrations/20260902000000_phase3f_invariant_results.sql`. Schema only: it creates one table, writes no row, alters no existing table, and creates no function, trigger or view.

**B. Phase 3F-owned TypeScript contracts** — `lib/invariants/types.ts`. The twelve-member `MoneyInvariantId`, the persisted/in-memory result split, severity, evidence-reference and correlation shapes, and the evaluation envelope as a discriminated union.

**C. The full P0 invariant registry** — `lib/invariants/registry.ts`. Exactly INV-001…INV-012, every field transcribed from `docs/MONEY_INVARIANTS.md`. Metadata only; no executable rule.

**D. Structural and unit tests** — registry content/immutability, domain-vocabulary runtime guards, migration structure, and a static provenance guard.

**E. A real-Supabase integration test candidate** — `063`, committed in advance and not yet runnable.

**F. Narrow documentation correction** — `docs/DATABASE.md` §16 reconciled to the as-implemented schema; `docs/ARCHITECTURE.md` gains ADR-A18.

---

## 2. Binding architect corrections implemented

### Nullable correlations (the C03 shape)

The planning schema declared `order_id` and `payment_attempt_id` **NOT NULL**. That is wrong for C03, which has no merchant order, no payment attempt and no payment at all — its Mechanism C targets PayChaos's own fixed internal webhook-verification path. Every approved C03 chaos run already carries all four correlation FKs as `NULL`.

All four correlations are now **individually nullable**, each with an `ON DELETE RESTRICT` foreign key that still applies whenever a value is non-null. No `CASCADE`, no `SET NULL`, no fabricated FK. **A `NULL` link is preferred over a false one.**

### Subject anchor — `invariant_results_subject_present` (architect blocker 3F-A-01)

Individually nullable is **not** permission for all four to be `NULL` at once. A row with every correlation `NULL` would be an orphan authoritative money verdict about no durable subject. The migration therefore requires at least one anchor:

```sql
constraint invariant_results_subject_present check (
  order_id is not null
  or payment_attempt_id is not null
  or payment_id is not null
  or chaos_run_id is not null
)
```

No individual column became `NOT NULL`.

| Shape                    | `order_id`   | `payment_attempt_id` | `payment_id` | `chaos_run_id` | Accepted?    |
| ------------------------ | ------------ | -------------------- | ------------ | -------------- | ------------ |
| **C03**                  | `NULL`       | `NULL`               | `NULL`       | **NON-NULL**   | Yes          |
| Baseline order           | **NON-NULL** | `NULL`               | `NULL`       | `NULL`         | Yes          |
| Baseline attempt/payment | any          | **NON-NULL** or      | **NON-NULL** | `NULL`         | Yes          |
| Orphan                   | `NULL`       | `NULL`               | `NULL`       | `NULL`         | **REJECTED** |

`chaos_run_id` is nullable **only** because baseline evaluation is supported, and a baseline evaluation still carries a real merchant/payment subject. Conversely `chaos_run_id` is **required for C03** — it is the sole correlation a C03 result can truthfully carry, and the anchor its evaluation uses together with the factual mutation evidence on that run's `fault_state`.

### `PASS`/`FAIL`/`UNKNOWN` only

`NOT_APPLICABLE` and `ERROR` are in-memory dispositions with **no schema representation**. Three independent layers enforce this:

| Layer      | Mechanism                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Compiler   | `NonPersistableInvariantEvaluation` has no `severity`/`expectedSummary`/`observedSummary`, so it cannot be passed where a persistable evaluation is expected |
| TypeScript | `lib/supabase/types.ts` `InvariantResultValue` is exactly the three values                                                                                   |
| Database   | `invariant_results_result_valid` CHECK                                                                                                                       |

`UNKNOWN` is authoritative — the rule applied but evidence was insufficient. It must never be read or scored as `PASS`.

### Append-only by privilege

The migration grants `SELECT, INSERT, DELETE` to `service_role` and **no `UPDATE` to any role at all** — a deliberate narrowing versus every other table in this project, all of which carry full CRUD. A service-layer bug attempting to rewrite a `FAIL` into a `PASS` fails at the database. `lib/supabase/types.ts` reinforces this by typing the table's `Update` member as `never`.

`DELETE` is retained because `docs/DATABASE.md` §39 "Reset Order" lists `invariant_results` as step 3 of the intentional administrative Demo Reset. That is a controlled documented operation, not normal application behavior.

---

## 3. Schema as implemented

```text
Table         public.invariant_results
Columns       id, invariant_id, invariant_version,
              order_id, payment_attempt_id, payment_id, chaos_run_id,
              result, severity,
              expected_summary, observed_summary, reason,
              evidence_refs, evaluated_at
```

No invented column: no `deterministic_reason`, no `scenario_run_id`, no diagnosis/recommendation/score/finding/AI field.

| Constraint                                 | Effect                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `invariant_results_invariant_id_valid`     | `INV-001`…`INV-012` only — `INV-013`/`INV-014` rejected                                                        |
| `invariant_results_result_valid`           | `PASS`/`FAIL`/`UNKNOWN` only                                                                                   |
| `invariant_results_severity_valid`         | `LOW`/`MEDIUM`/`HIGH`/`CRITICAL` only — no INFO/WARNING                                                        |
| `invariant_results_evidence_refs_is_array` | `jsonb_typeof(evidence_refs) = 'array'`                                                                        |
| `invariant_results_subject_present`        | at least one of `order_id`/`payment_attempt_id`/`payment_id`/`chaos_run_id` non-null — no column is `NOT NULL` |

`invariant_version` is `text NOT NULL DEFAULT '1'`; `evidence_refs` is `jsonb NOT NULL DEFAULT '[]'`; `evaluated_at` is `timestamptz NOT NULL DEFAULT now()`.

**Indexes** — the partial unique `invariant_results_chaos_run_invariant_uniq (chaos_run_id, invariant_id) WHERE chaos_run_id IS NOT NULL`, plus `payment_attempt_id`, `payment_id`, `result`, `severity`, `evaluated_at`. Uniqueness is deliberately **not** on `invariant_id` alone: different chaos runs are different historical evaluations and all must be retained. Baseline rows (`chaos_run_id IS NULL`) are not blocked, which is why the index is partial. There is no `UPSERT` path and no `FAIL → PASS` update path.

**RLS/privileges** — RLS enabled with zero policies; `REVOKE ALL` from `anon`/`authenticated`; `GRANT SELECT, INSERT, DELETE` to `service_role`.

**Note for the architect:** the `invariant_results_invariant_id_valid` CHECK is an addition beyond the literal §16 planning table, which listed no constraint on `invariant_id`. It follows the existing `chaos_runs_scenario_id_valid` precedent and prevents an unapproved or P1 invariant ID being persisted as a P0 result. It is easy to drop if the architect prefers the column unconstrained.

---

## 4. Domain contracts

| Type                       | Members                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `MoneyInvariantId`         | `INV-001`…`INV-012` (twelve; no P1)                                                                           |
| `PersistedInvariantResult` | `PASS` \| `FAIL` \| `UNKNOWN`                                                                                 |
| `EvaluationDisposition`    | the three above, plus `NOT_APPLICABLE` \| `ERROR`                                                             |
| `InvariantSeverity`        | `LOW` \| `MEDIUM` \| `HIGH` \| `CRITICAL`                                                                     |
| `InvariantPriority`        | `P0` \| `P1` \| `P2` (every catalogue entry is `P0`)                                                          |
| `InvariantEvidenceKind`    | `ORDER`, `PAYMENT_ATTEMPT`, `PAYMENT`, `FULFILMENT`, `WEBHOOK_EVENT`, `EVENT_PROCESSING_ATTEMPT`, `CHAOS_RUN` |

The evaluation envelope is a **discriminated union** on `disposition`: `PersistableInvariantEvaluation` (carries severity and expected/observed summaries) versus `NonPersistableInvariantEvaluation` (carries neither). It deliberately excludes AI explanation, confidence, diagnosis, root cause, recommendation and score, and reads no clock — `evaluatedAt` is supplied by the Phase 3F-C persistence layer or defaulted by the column.

`InvariantSeverity` is deliberately **not** the frozen `lib/chaos/types.ts` `FailureSeverity`, which is title-case and includes `Info`. Reusing that type would let `"Info"` — a value the database CHECK rejects — pass type-checking.

An evidence-kind naming divergence was reconciled: `docs/DATABASE.md` §16 previously abbreviated `EVENT_PROCESSING_ATTEMPT` to `PROCESSING_ATTEMPT`, while `docs/MONEY_INVARIANTS.md` §42 used the longer spelling matching the real table. Both lists were illustrative ("such as"); the longer spelling was adopted and §16 updated. Easily reversed if the architect prefers the short form.

---

## 5. The registry

Twelve entries, `INV-001`…`INV-012`. Every `version` is `"1"`; every `priority` is `P0`; every `defaultSeverity` is `CRITICAL` except **INV-012, which is `HIGH`** (`docs/MONEY_INVARIANTS.md` §27 §11). Each entry carries `name`, `description`, `requiredEvidence` and `remediationCategories`, all transcribed from the source document, plus a stable `evaluatorKey` metadata string.

There is **no `evaluate` function field** — Phase 3F-B attaches its deterministic evaluators by looking entries up via `evaluatorKey`, which is an identifier, not executable code.

`lib/invariants/registry.ts` is `server-only`, performs no I/O (no Supabase, no table name, no Razorpay, no network, no LLM, no filesystem), reads no clock and no randomness, and contains no `PASS`/`FAIL`/`UNKNOWN` literal at all.

### The frozen chaos registry is unchanged

`lib/chaos/registry.ts` and `lib/chaos/types.ts` were **not modified**. The frozen `InvariantId` union still declares exactly its eight scenario-referenced IDs; widening it would misrepresent it as the invariant catalogue, which its own doc comment forbids. `tests/unit/invariants/registry.test.ts` proves the subset relationship both ways — every ID the chaos registry references is catalogued (8 of 12), and `INV-008`/`009`/`010`/`012` are catalogued despite no P0 scenario mapping to them. The frozen mapping is re-asserted verbatim:

```text
C01 -> INV-001, INV-002, INV-006, INV-007
C03 -> INV-004, INV-005
C07 -> INV-002, INV-004, INV-011
C11 -> INV-003, INV-004, INV-011
```

---

## 6. Files changed

**Migration (1)** — `supabase/migrations/20260902000000_phase3f_invariant_results.sql`

**New production (2)** — `lib/invariants/types.ts`, `lib/invariants/registry.ts`

**Modified production (1)** — `lib/supabase/types.ts` (adds the `invariant_results` table surface and its column vocabularies; `Update: never`)

**Tests — 8 paths total (4 new, 4 modified)**

New:

1. `tests/unit/invariants/types.test.ts`
2. `tests/unit/invariants/registry.test.ts`
3. `tests/unit/supabase/063-phase3f-invariant-results-provenance-guard.test.ts`
4. `tests/integration/supabase/063-phase3f-invariant-results.integration.test.ts`

Modified:

5. `tests/unit/supabase/migration.test.ts`
6. `tests/unit/supabase/server.test.ts`
7. `tests/unit/evidence/phase3e-b-static-guard.test.ts`
8. `tests/unit/supabase/061-phase3e-chaos-evidence-provenance-guard.test.ts`

**Overall scope: 15 paths** — 1 migration + 2 new production + 1 modified production + 8 tests + 2 docs + 1 handoff.

**Docs (2)** — `docs/DATABASE.md`, `docs/ARCHITECTURE.md`

**Handoff (1)** — this file.

**No frozen compatibility file was touched:** `lib/chaos/c03-execution-service.ts`, `lib/chaos/c03-mutation-snapshot.ts`, `lib/chaos/c03-mutation-snapshot-repository.ts`, `lib/evidence/chaos-evidence-repository.ts` and `lib/evidence/chaos-run-evidence.ts` are all byte-unchanged, as are `lib/chaos/types.ts`, `lib/chaos/registry.ts` and every other Phase 1–3E module.

### Why the four existing test files changed

Each carried a frozen forward-guard that assumed `invariant_results` must not exist. Every one was **advanced, never weakened** — the positive assertion replaces the negative one, and each still forbids `findings`, `regression_runs`, `reliability_score_snapshots` and `merchants`:

| File                             | Change                                                                                                                                                                                                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migration.test.ts`              | Cumulative table set 7 → 8; grant/UUID/RLS counts 7 → 8; the `service_role` CRUD assertion was **split** so the seven mutable tables must still each carry full CRUD while `invariant_results` must carry `SELECT/INSERT/DELETE` and never `UPDATE`; a 17-assertion Phase 3F-A block was added |
| `server.test.ts`                 | Type-surface keys 7 → 8; `invariant_results` removed from the forbidden list and asserted positively                                                                                                                                                                                           |
| `phase3e-b-static-guard.test.ts` | The migration ledger pins the new filename; `invariant_results` stays forbidden in the Phase 3E-B evidence sources (those modules must still never name it) but leaves the forbidden-CREATE-TABLE list                                                                                         |
| `061-…-provenance-guard.test.ts` | `063-` pinned by exact name, matching how `062-` was already handled; `064-` now asserted absent                                                                                                                                                                                               |

---

## 7. Tests

```text
Focused (invariants + supabase + evidence)           18 files /  646 tests /  646 passed / 0 failed
Full offline (npx vitest run)                        79 files / 1978 tests / 1978 passed / 0 failed
063 isolated (real Supabase)                          1 file  /   36 tests /   36 passed / 0 failed
Full real-Supabase suite                             24 files /  306 tests /  306 passed / 0 failed
```

Environmental retries: **0** on every invocation above.

---

## 8. Real Supabase — MANUALLY APPLIED and VERIFIED

```text
Migration            20260902000000_phase3f_invariant_results.sql
Manual application   YES
Applied by           the developer, manually
Application method   Supabase Dashboard -> PayChaos AI project -> SQL Editor -> Run
Application result   Success. No rows returned
Reapplied by tooling NO (never re-run, never `supabase db push`, never psql)
Real Supabase        VERIFIED
Verification test    tests/integration/supabase/063-phase3f-invariant-results.integration.test.ts
063 result           1 file / 36 tests / 36 passed / 0 failed
Full Supabase suite  24 files / 306 tests / 306 passed / 0 failed
Environmental retry  none required
```

### What real PostgreSQL proved (063)

Executed against the live project AFTER the manual application, `063` confirmed all of the following as real database behavior — not as a repository-only claim:

**Subject anchor.** All four correlations `NULL` → **rejected**. The exact C03 shape (`order_id`/`payment_attempt_id`/`payment_id` `NULL`, `chaos_run_id` NON-NULL) → **accepted**. The baseline order shape (real `order_id`, `chaos_run_id` `NULL`) → **accepted**. Each anchor kind is independently sufficient; no individual column behaves as `NOT NULL`.

**Foreign keys.** A non-existent `order_id`, `payment_attempt_id`, `payment_id` or `chaos_run_id` is rejected by a real FK. `ON DELETE RESTRICT` was proven twice — a referenced chaos run and a referenced order each refused deletion and remained present.

**Result vocabulary.** `PASS`, `FAIL`, `UNKNOWN` accepted. `NOT_APPLICABLE` **rejected**. `ERROR` **rejected**. `pass`, `Pass`, `PASSED`, `OK`, `BLOCKED` and the empty string all rejected.

**Severity.** `LOW`/`MEDIUM`/`HIGH`/`CRITICAL` accepted; `INFO`, `WARNING`, title-case `Critical`/`High`, empty and `None` rejected.

**Invariant IDs.** All twelve of `INV-001`…`INV-012` accepted; `INV-013`, `INV-014`, `INV-000`, `inv-001` and `X` rejected.

**Evidence refs.** Defaults to `[]`; an array of `{kind, id}` round-trips exactly; a JSON object is rejected by the array CHECK.

**Partial unique.** Same invariant + same chaos run rejected; different invariant on the same run allowed; same invariant on a different run allowed; three baseline (`chaos_run_id` `NULL`) rows carrying the same invariant all allowed.

**Append-only.** A `service_role` `UPDATE` attempting to rewrite a persisted `FAIL` into a `PASS` was **rejected by the database**, and an independent re-read confirmed the stored value is still `FAIL`.

**RLS/privileges.** Anon read denied; anon insert denied; `service_role` select works.

### Post-suite read-only census

Taken after the complete real-Supabase suite:

```text
event_processing_attempts total        20
rows with non-null state_before         0
rows with non-null state_after          0
invariant_results rows remaining         0
chaos_runs total                         9
orders total                            11
```

`20 / 0 / 0` is unchanged from the Phase 3E-A baseline — **this verification caused no historical backfill**. `invariant_results` is empty, confirming `063` left none of its own rows behind. All four approved historical runs were present before the test and remain present afterwards, and the fresh C03 manual-evidence run `c406dafd-d48f-4e1e-b092-030acbb5e32b` (`C03` / `COMPLETED` / `UNKNOWN` / `SYNTHETIC_DEMO`) is retained untouched.

`063` proves schema only — table existence; the subject-anchor rule (all-four-`NULL` **rejected**, the exact C03 shape accepted when anchored by its chaos run, a baseline order shape accepted with `chaos_run_id` `NULL`); real FK enforcement; `ON DELETE RESTRICT` on both a chaos run and an order; the `result`/`severity`/`invariant_id` CHECKs; `evidence_refs` default and array shape; the partial unique index (including that baseline `NULL` rows are not blocked); the absence of any `UPDATE` privilege; and anon denial.

It creates no payment, fulfilment, webhook or processing-attempt row. Its only non-`invariant_results` writes are two throwaway `SYNTHETIC_DEMO` chaos runs and **one** test-owned `orders` row, built with the suite's existing `testOrderInsert` helper and tracked via `trackOrder` exactly as every other file in this suite does, so the non-chaos baseline anchor is proven against a real foreign key rather than only statically. Cleanup is exact-ID, children before parents (`invariant_results` → `chaos_runs` → `orders`), with independent zero-row re-verification for all three.

### Historical non-mutation is proven by value, not by shape (architect blocker 3F-A-02)

`beforeAll`, before any owned row exists, captures an explicit column allowlist for **every** pre-existing `chaos_runs` row (`id`, `scenario_id`, `status`, `outcome`, `fault_type`, `data_classification`, the four correlation FKs, `fault_state`, `execution_block_code`, `failed_precheck_id`, `started_at`, `completed_at`, `created_at`) and for every `event_processing_attempts` row (`id`, `state_before`, `state_after`). No secret, no payload, no signature; held in test memory only, never written to a file.

`afterAll`, once every owned row is deleted, re-reads the identical projections, sorts by `id`, and requires **deep equality** with the before-snapshot. That is what proves no historical C03 / C07 / C11-B / C11-A run — nor any other pre-existing chaos run — had any allowlisted column changed, `fault_state` included. The superseded assertion merely checked that `fault_state` was still an object; the provenance guard now asserts that weaker check cannot return.

`updated_at` is deliberately excluded from the projection: nothing here touches a historical run, so including it would risk a failure unrelated to the evidence content this guard protects, while its presence could equally let a comparison pass for the wrong reason.

The four known approved historical run IDs (C03 `a0c5a66a-…`, C07 `68878716-…`, C11-B `5090e423-…`, C11-A `b49d344a-…`) are additionally asserted still present — but **only if they existed in the `beforeAll` snapshot**, so the test never fails merely because an ID is absent from a given environment.

### `authenticated` denial is structurally verified, not session-proven

The migration `REVOKE ALL … FROM anon, authenticated` and creates zero policies; `migration.test.ts` asserts both statically. The real anon denial is proven against the live database. This suite has **no authenticated session helper**, and creating a user account or altering auth configuration purely to exercise that role would be real infrastructure added for a test. It is therefore reported as **structurally verified**, not as a separately authenticated-session integration proof.

---

## 9. Known issues

None outstanding. Two judgement calls are flagged above for the architect to reverse if desired: the `invariant_id` CHECK (an addition beyond the literal planning table) and the `EVENT_PROCESSING_ATTEMPT` evidence-kind spelling.

---

## 10. Deferred to 3F-B and 3F-C

**3F-B** — the pure deterministic INV-001…INV-012 evaluators. These alone assign `PASS`/`FAIL`/`UNKNOWN`. They must apply ARCH-3F-013 (`UNEXPECTED_ACCEPTANCE` on either C03 case makes INV-005 **FAIL**, regardless of a zero delta) and the INV-005 semantics in `docs/MONEY_INVARIANTS.md` §10: complete + unchanged + both `REJECTED` → eligible to `PASS`; complete + factual mutation → `FAIL`; incomplete → `UNKNOWN`.

**3F-C** — evaluation orchestration, the append-only persistence repository, application-level duplicate-evaluation idempotency, real verification and the Phase 3F final freeze.

**Phase 4 and beyond** — findings, diagnosis, recommendations, reliability scoring, regression.

---

## 11. Do not break

- `invariant_results` persists only `PASS`/`FAIL`/`UNKNOWN`. `NOT_APPLICABLE` and `ERROR` never reach the database.
- The table is append-only. No `UPDATE` privilege exists; a re-evaluation appends. A `FAIL` is never rewritten to `PASS`.
- Correlations may be `NULL`. Never fabricate one to satisfy a column.
- The frozen chaos registry, its `InvariantId` union, and the frozen evidence-compatibility modules stay unchanged.
- No evaluator, verdict literal or placeholder belongs in `lib/invariants/types.ts` or `lib/invariants/registry.ts`.
- `NO_SUBJECT`/`AMBIGUOUS_SUBJECT`/`SEARCH_INCOMPLETE` are factual search states, not verdicts. 3F-B must treat them as `UNKNOWN`, never as evidence that no capture exists.
- AI/LLM output never writes to or overrides this table. It is deterministic payment truth; AI is advisory only.

---

## 12. Next dependency

The migration is applied and the schema is verified against the real database. Remaining: **architect final review and freeze of Phase 3F-A**, then Phase 3F-B. Phase 3F-B has not started and must not begin before that review.
