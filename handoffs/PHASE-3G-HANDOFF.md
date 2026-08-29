# Phase 3G — Finding Generation (verified, ready to freeze)

```text
IMPLEMENTED             = YES
OFFLINE TESTED          = YES
REAL SUPABASE VERIFIED  = YES
MANUALLY VERIFIED       = YES
DOCUMENTED              = YES
ARCHITECT APPROVED      = YES
```

Frozen parent: `1aa9f50c675459f067597552f50e9c0209c1250b` — the Phase 3F freeze.

**The migration HAS been applied** to the real Supabase project by the developer. `065` and the full real-Supabase suite both pass, and the developer has completed read-only manual verification of a temporary `SYNTHETIC_DEMO` Finding chain, which has since been cleaned up. The `findings` table is empty.

---

## 1. What Phase 3G is

`docs/PHASE_PLAN.md` Section 3G: "Create findings from failed invariants." Task items 16–18: generate findings only from `FAIL` results, attach structured evidence references, deduplicate where appropriate.

A Finding **reports** an already-persisted deterministic failure. It never decides that anything failed.

```text
persisted invariant_results.result = 'FAIL'   ->  a Finding may exist
PASS                                          ->  no Finding, ever
UNKNOWN                                       ->  no Finding, ever
```

Nothing else may bring a Finding into existence — not `chaos_runs.outcome`, not a scenario ID, not a severity, not caller-supplied data, and not an LLM.

`UNKNOWN` deserves its own sentence: it means the rule applied but the evidence was insufficient. Converting that into a Finding would manufacture a reliability issue out of missing evidence, which is exactly the confusion the frozen Phase 3F-B evaluators exist to prevent.

---

## 2. Architect rulings implemented

### `resolved_at` consistency

`docs/DATABASE.md` Section 17 required a "consistency CHECK" without stating the expression. The ruling: **`resolved_at` is non-null if and only if `status = 'RESOLVED'`.**

```sql
constraint findings_resolved_at_consistent check (
  (status = 'RESOLVED' and resolved_at is not null)
  or (status <> 'RESOLVED' and resolved_at is null)
)
```

So `OPEN` and `STILL_FAILING` both require `resolved_at` NULL — a resolution timestamp cannot survive a reopening — and `RESOLVED` cannot lack the time it was resolved.

### `service_role` UPDATE

The migration grants `service_role` `SELECT, INSERT, UPDATE, DELETE`; `anon` and `authenticated` get nothing; RLS enabled; zero policies.

UPDATE exists at the **database capability** level because Phase 4 will populate diagnosis, recommendation and the STILL_FAILING/RESOLVED lifecycle, and granting it now avoids a privilege migration against a frozen table.

**Capability is not permission.** Phase 3G production performs no UPDATE and no DELETE on `findings`. There is no `updateFinding`, `resolveFinding`, `markStillFailing`, `setDiagnosis` or `setRecommendation`. `tests/unit/findings/phase3g-static-guard.test.ts` fails the build if `.update(` or `.upsert(` ever appears against `findings` in Phase 3G production source.

This is a deliberate contrast with `invariant_results`, which grants **no** UPDATE to any role: an invariant result is immutable evidence, a finding is a mutable lifecycle object.

---

## 3. Schema — the complete final table, created once

`supabase/migrations/20260903000000_phase3g_findings.sql` creates exactly `public.findings` and alters nothing.

All thirteen documented columns exist now, including the seven Phase 4 ones, because `docs/DATABASE.md` Section 17 presents one table definition — not a Phase 3 subset plus a Phase 4 extension — and its phase-ownership matrix puts **CREATE** in the Phase 3 column with Phase 4 only "adding/using" diagnosis. Phase 4 therefore ships pure application code.

| Property                                                                               | Value                                                                                     |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `id`                                                                                   | `uuid` PK, `default gen_random_uuid()`                                                    |
| `invariant_result_id`                                                                  | `uuid NOT NULL`, FK → `invariant_results(id)` **ON DELETE RESTRICT**, UNIQUE              |
| `status`                                                                               | `text NOT NULL DEFAULT 'OPEN'`, CHECK `OPEN`/`STILL_FAILING`/`RESOLVED`                   |
| `title`                                                                                | `text NOT NULL`                                                                           |
| `diagnosis_code` / `diagnosis_summary` / `recommendation_code` / `recommendation_text` | nullable text, Phase 4                                                                    |
| `diagnosis_strength`                                                                   | nullable text, CHECK NULL or `STRONG_EVIDENCE`/`PARTIAL_EVIDENCE`/`INSUFFICIENT_EVIDENCE` |
| `diagnosed_at` / `resolved_at`                                                         | nullable timestamptz, Phase 4                                                             |
| `created_at` / `updated_at`                                                            | `timestamptz NOT NULL DEFAULT now()`                                                      |

### Uniqueness is a named UNIQUE CONSTRAINT (architect blocker 3G-OFF-01)

`docs/DATABASE.md` Section 17 declares `invariant_result_id` as "FK + UNIQUE" and lists `UNIQUE(invariant_result_id)` under Constraints. An earlier draft enforced that with a standalone `CREATE UNIQUE INDEX`, which is behaviourally equivalent but does not match the documented contract and does not appear in `information_schema.table_constraints`. It is now a genuine table constraint:

```sql
constraint findings_invariant_result_id_uniq unique (invariant_result_id)
```

PostgreSQL creates the backing unique index automatically, under the same name, so Section 17's required **unique `invariant_result_id` index** is satisfied by that one declaration. The index is deliberately NOT re-created explicitly — a second identical index would be redundant storage maintained on every write.

The three remaining explicit `CREATE INDEX` statements are exactly `findings_status_idx`, `findings_diagnosis_code_idx` and `findings_created_at_idx`. No speculative extras.

`migration.test.ts` proves both halves: a real named UNIQUE constraint exists, `CREATE UNIQUE INDEX` appears nowhere, and the explicit index list is exactly those three. The real `065` duplicate-insert test is unchanged and HAS now proven the constraint against actual PostgreSQL: a second finding for the same invariant result was rejected by the live database.

The correction was made in place rather than by adding a second migration, because at that point the migration had not yet been applied anywhere. It has since been applied in exactly this corrected form.

`ON DELETE RESTRICT` follows `docs/DATABASE.md` Section 41 and is corroborated by the Demo Reset order, which deletes `findings` at step 2 and `invariant_results` at step 3 — an ordering only meaningful under RESTRICT.

**The P0 schema is now nine tables.** `regression_runs` is the tenth and belongs to Phase 4. No `finding_evidence`, `evidence` or `evidence_items` table exists or is needed.

### A Phase 3G finding is created as

`status = 'OPEN'`, a deterministic `title`, its `invariant_result_id`, and default timestamps. All seven diagnosis/recommendation/resolution columns stay NULL.

---

## 4. Title

`"<INV-ID> — <frozen invariant name>"`, e.g. `INV-005 — Invalid Webhook Signature Causes Zero Mutation`.

Server-generated, registry-derived, deterministic, stable, factual. No caller input, no AI, no timestamp, no UUID, no counter, no run-specific text, no PII, no payload. All twelve titles are distinct.

**Version-gated.** A persisted result records the `invariant_version` in force when the verdict was reached. If the registry has since moved, titling the finding with today's name would silently re-describe a historical evaluation using semantics it was never evaluated under — so that is `FINDING_INVARIANT_VERSION_MISMATCH`, not a rename. An uncatalogued invariant ID is `FINDING_INVARIANT_UNKNOWN`.

---

## 5. Idempotency and Phase 4 forward compatibility

The immutable creation consistency check is **only** `invariant_result_id` + deterministic title.

That narrowness is the point. `status`, every diagnosis/recommendation field, `resolved_at` and `updated_at` are all legitimately Phase 4's to change, so a regeneration that demanded `status === 'OPEN'` would raise a false conflict the moment a regression run legitimately resolved the issue.

| Existing finding                        | Behaviour                                |
| --------------------------------------- | ---------------------------------------- |
| Equivalent, `OPEN`                      | returned unchanged                       |
| Equivalent, `STILL_FAILING`             | returned unchanged                       |
| Equivalent, `RESOLVED`                  | returned unchanged — **never reopened**  |
| Equivalent, Phase 4 diagnosis populated | returned unchanged — **never cleared**   |
| Contradictory title                     | `FINDING_INTEGRITY_CONFLICT`, no rewrite |

Regeneration never resets status, never clears a diagnosis or recommendation, never clears `resolved_at`, and never touches `updated_at`.

### Algorithm

1. validate the internal UUID
2. load the persisted invariant result by exact ID
3. missing → `FINDING_INVARIANT_RESULT_NOT_FOUND`
4. `PASS`/`UNKNOWN` → `NO_FINDING_REQUIRED` (a normal disposition, not an error)
5. `FAIL` → validate invariant ID and version against the frozen registry
6. derive the deterministic title
7. read the existing finding by `invariant_result_id`
8. exists + consistent → return unchanged
9. exists + inconsistent → `FINDING_INTEGRITY_CONFLICT`
10. absent → INSERT the OPEN finding
11. insert failure → re-read by `invariant_result_id`
12. concurrent equivalent winner → return it
13. concurrent contradictory winner → integrity conflict
14. no row after insert failure → `FINDING_INSERT_FAILED`

No UPSERT. No UPDATE. No DELETE-then-INSERT. No retry loop. No raw Supabase error text is ever exposed.

---

## 6. Evidence traceability

Nothing is copied. `findings` deliberately carries no `severity`, `expected_summary`, `observed_summary`, `reason`, `evidence_refs`, `chaos_run_id`, `order_id`, `payment_attempt_id` or `payment_id` — a copy could only ever drift from, or contradict, the authoritative record.

```text
finding -> invariant_result -> evidence_refs -> records that already exist
```

The **Finding Detail read model** (`getFindingDetailByInvariantResultId`) returns the finding's identity, status, title and timestamps alongside the linked result's `invariantId`, `invariantVersion`, `severity`, `expectedSummary`, `observedSummary`, `reason`, `evaluatedAt`, `evidenceRefs` and all four correlations — one object, normalized persistence.

It is implemented in Phase 3G rather than deferred to 3H because proving evidence traceability requires it, and 3H consumes it unchanged. **It is a server contract only — no UI.**

Diagnosis and recommendation are deliberately absent from the read model: they are Phase 4 surface and are NULL after Phase 3G creation, so exposing them would invite a caller to depend on a field this phase never populates.

---

## 7. Run-level generation

`generateFindingsForChaosRun(chaosRunId)` consumes persisted `invariant_results` only. It never re-runs an evaluator, never reassembles evidence, never executes chaos, never calls Razorpay, and never writes to `chaos_runs` or `invariant_results`.

It reads results for the exact run in deterministic `invariant_id` order, generates or reuses a finding for each `FAIL`, skips `PASS`/`UNKNOWN`, and returns `{ chaosRunId, evaluatedResultCount, failedResultCount, findings[], skipped[] }`.

A run with no persisted results returns zeros rather than an error. Distinguishing "unknown run" from "run with no results" is Phase 3H's job, and reaching for `chaos_runs` here would add a dependency this phase does not need.

Both entry points are public: `createFindingFromInvariantResult(id)` is the primitive (single UUID input), `generateFindingsForChaosRun(id)` is the orchestration.

---

## 8. Phase 3F remains frozen

No Phase 3F file was modified. `evaluateChaosRun()` does **not** invoke Finding generation — Phase 3G is a separate boundary built on top of Phase 3F's persisted output, which is the smallest safe compatibility design and required no reopening of a frozen phase.

`phase3g-static-guard.test.ts` test 19 re-proves that no frozen Phase 3F module even knows the Finding engine exists.

---

## 9. Security

- `server-only` on both I/O modules
- RLS enabled, **zero policies**; `anon` and `authenticated` explicitly revoked
- no `fetch`, XHR, axios or `node:http(s)`
- no Razorpay client, endpoint or credential
- no OpenAI, Anthropic, Ollama or any LLM/ML
- no raw payload, `raw_body_sha256`, signature, `state_before`/`state_after`, card, CVV, OTP or customer PII
- no `console.*` logging
- every read is an explicit column allowlist — never `select("*")`
- every error is a stable typed code with a fixed message; raw Supabase text, details and hints never propagate
- the only table Phase 3G mutates is `findings`, and the only verb is `insert`

---

## 10. Offline gates

```text
Findings unit (tests/unit/findings)               4 files /   85 tests /   85 passed / 0 failed
Invariant regression (tests/unit/invariants)     10 files /  401 tests /  401 passed / 0 failed
Evidence + chaos + supabase regression           35 files / 1209 tests / 1209 passed / 0 failed
Full offline (npx vitest run)                    92 files / 2455 tests / 2455 passed / 0 failed
Environmental retries                             0
Typecheck                                         PASS
Lint                                              0 errors, 1 pre-existing unrelated warning
                                                  (051-chaos-safety-gate.integration.test.ts:354)
Build                                             PASS on retry (attempt 1 hit the known .next EPERM;
                                                  cleared ONLY .next; attempt 2 passed)
Prettier                                          PASS
git diff --check                                  PASS
```

### Real Supabase gates

```text
Real 065 (isolated)                               1 file  /   22 tests /   22 passed / 0 failed
Full real-Supabase suite                         26 files /  346 tests /  346 passed / 0 failed
Environmental retries                             0
```

The full real suite grew from 25 files / 324 tests to 26 files / 346 tests — exactly the 22 tests `065` adds. No pre-existing integration suite changed.

---

## 11. Files

**Migration (1 new):** `supabase/migrations/20260903000000_phase3g_findings.sql`
**Production (3 new):** `lib/findings/types.ts`, `lib/findings/repository.ts`, `lib/findings/service.ts`
**Unit tests (4 new):** `repository.test.ts` (pure title/equality/UUID), `repository-io.test.ts` (INSERT-only I/O against a programmable fake client), `service.test.ts` (authority, idempotency, run-level, **and the Finding Detail read model**), `phase3g-static-guard.test.ts`
**Integration (1 new):** `tests/integration/supabase/065-phase3g-findings.integration.test.ts` — **NOT RUN**
**Provenance guard (1 new):** `tests/unit/supabase/065-phase3g-findings-provenance-guard.test.ts`
**Handoff (1 new):** this file

**Modified (6):**

| Path                                                   | Why                                                                                                                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/supabase/types.ts`                                | adds the `findings` table contract; corrects two objectively stale comments (findings mislabelled Phase 4; the 3F-A and 3E-A migrations described as "NOT YET APPLIED") |
| `tests/unit/supabase/061-…-provenance-guard.test.ts`   | forward-guard: `065-` now pinned by exact name, `066-` asserted absent                                                                                                  |
| `tests/unit/supabase/migration.test.ts`                | new table, ninth grant, ninth RLS entry, plus a full Phase 3G contract block                                                                                            |
| `tests/unit/invariants/phase3f-c-static-guard.test.ts` | migration count 11 → 12; "3F-A sorts last" replaced with exact-name proof that Phase 3F still owns exactly one migration                                                |
| `tests/unit/supabase/server.test.ts`                   | `findings` moved from the forbidden list to a positive assertion                                                                                                        |
| `tests/unit/evidence/phase3e-b-static-guard.test.ts`   | migration list gains the 3G file; adds a NEW assertion that no Phase 3E-B evidence module references `findings`                                                         |

**Total 17 paths (11 new, 6 modified).**

### Scope — 17 paths, architect-accepted

The originally-proposed scope named four modified paths. Two more were objectively required: `server.test.ts` asserted `findings` was absent from `lib/supabase/types.ts`, and `phase3e-b-static-guard.test.ts` pins the exact migration filename list. Both fail the moment the approved table exists, and neither could be left red or weakened.

**The architect reviewed and explicitly accepted the final 17-path candidate**, on the grounds that the two extra paths were objectively stale cumulative guards rather than implementation-scope expansion. They are the same class as the three pre-approved guard updates — cumulative facts that legitimately moved — and both were **advanced, not loosened**: each gained a stronger positive assertion (`findings` must now be declared; no Phase 3E-B module may reference it; `findings` must be created exactly once).

---

## 12. Guard advancement policy

Every stale guard was advanced by exact name, never by relaxing a count into a range:

- `migration.test.ts` pins `findings` as the eighth mutable grant **by name** and asserts it carries full CRUD, while `invariant_results` must still carry no UPDATE.
- The "Phase 3F-A sorts last" assertion became "Phase 3G sorts last **and** Phase 3F-A sits exactly one place ahead" — still exact-position.
- The Phase 3F-A migration must still create no `findings` table; only the _cumulative_ absence check was narrowed to genuine Phase 4 tables.
- The 3F-C guard now proves Phase 3F introduced exactly one migration by name, which is the property it always meant to protect.

---

## 13. Real verification — PASSED

`065` creates one `SYNTHETIC_DEMO` chaos run and three test-owned `invariant_results` (one FAIL, one PASS, one UNKNOWN), shaped as C03/INV-005 where the three merchant correlations are **truthfully** NULL, then calls the real service.

**No fabricated provider evidence.** No `webhook_events` row and no `event_processing_attempts` row is created — `webhook_events` is CHECK-constrained so every row asserts a genuine HMAC-authenticated Razorpay delivery. No Razorpay call, no payment, no chaos execution. Every `evidence_refs` entry points at the file's own chaos run.

Direct insertion of `invariant_results` is legitimate here because the unit under test is the Finding engine, not the evaluator — the evaluator-to-result path is already proven end-to-end by `064`, and no `FAIL` result exists in the project to reuse.

It proves: FAIL → one OPEN finding · exact FK · deterministic title · repeat returns the same `id`, `created_at` **and** `updated_at` · a third pass creates no duplicate · the live UNIQUE constraint rejects a second finding · the FK rejects an orphan · PASS and UNKNOWN create none · all seven Phase 4 columns NULL · run-level generation and rerun · empty run → zeros · the read model matches the persisted result field-for-field · every evidence ref resolves to a live row · `findings` carries no duplicated invariant column · anon denied read and insert · service_role works · **the eleven authoritative Phase 3F results still have no finding**.

### The authoritative baseline is pinned by run ID (architect blocker 3G-OFF-02)

An earlier draft identified the Phase 3F baseline negatively — "every invariant result that is not one of this test's rows, expect 11". That is true only of today's database. It would turn green into red the first time a Phase 4 regression, a manual verification chain or another suite legitimately persisted an invariant result anywhere else in the project.

The five approved Phase 3F chaos runs are now pinned by exact ID in a frozen constant:

```text
APPROVED_PHASE_3F_RUN_IDS
  c406dafd-d48f-4e1e-b092-030acbb5e32b   fresh C03
  a0c5a66a-e70f-4e47-b9eb-0b3482c789d4   historical C03
  68878716-ed49-40ec-85de-f962a4f6b21c   historical C07
  5090e423-daa5-4122-99de-4c27d728957c   historical C11-B
  b49d344a-f5cf-42ae-a078-819b26bfbffe   historical C11-A
```

The check now selects `invariant_results` **where `chaos_run_id` IN those five IDs**, asserts exactly 11 rows with a tally of `PASS 1 / UNKNOWN 10 / FAIL 0`, collects only those 11 result IDs, and asserts zero findings reference them. It additionally asserts that none of the 11 result IDs and none of the five run IDs is test-owned — so cleanup can never reach them.

`065`'s provenance guard pins all five UUIDs, requires the positive `.in("chaos_run_id", APPROVED_PHASE_3F_RUN_IDS)` form, and forbids the negative `.not("id", "in", …)` scope from returning.

The test is now future-safe: legitimate new invariant results elsewhere in the project cannot break it.

Cleanup is exact-ID, children before parents (`findings` → `invariant_results` → `chaos_runs`), with independent zero-row proof for all three.

### Real results

The developer manually applied `supabase/migrations/20260903000000_phase3g_findings.sql` in the Supabase SQL Editor. Result: **`Success. No rows returned.`** The migration was not re-applied and its SQL was not re-run.

`065` then passed against the live project — **1 file / 22 tests / 22 passed / 0 failed** — exercising the real service, not a hand-rolled insert path:

| Property               | Real result                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| FAIL → Finding         | one, `status = OPEN`                                                                                       |
| PASS → Finding         | none                                                                                                       |
| UNKNOWN → Finding      | none                                                                                                       |
| Duplicate generation   | same `id`, same `created_at`, same `updated_at`                                                            |
| Live UNIQUE constraint | rejected the second finding for the same result                                                            |
| FK                     | rejected an orphan `invariant_result_id`                                                                   |
| Phase 4 columns        | all seven NULL                                                                                             |
| Evidence trace         | read model matched the persisted result field-for-field; every `evidence_refs` UUID resolved to a live row |
| anon SELECT / INSERT   | both denied                                                                                                |
| service_role           | full access as granted                                                                                     |

**Cleanup verified by an independent read-only census after the suite:**

```text
findings total                        0
invariant_results total              11   (exactly the approved set)
chaos_runs total                      9   (unchanged from the pre-3G baseline)
non-approved invariant_results        0   (no test-owned row survived)
```

**Approved Phase 3F baseline, re-read after the isolated 065 run AND again after the full real suite — byte-identical both times:**

```text
approved chaos runs present           5
invariant results for those runs     11
PASS                                  1
UNKNOWN                              10
FAIL                                  0
findings linked to those 11           0
fresh C03 outcome                  PASS
four historical outcomes        UNKNOWN
```

No historical row was mutated. No result was converted to FAIL to manufacture a finding. The five approved runs still carry their exact frozen outcomes.

**Retained Finding: NONE.** `065` cleans up completely, so the findings table is empty. Manual developer verification has NOT been done.

### Manual verification — PASSED

`065` cleans up completely, so nothing survives it to inspect. With explicit architect authorisation, **one** temporary `SYNTHETIC_DEMO` verification chain was therefore created — chaos run → FAIL invariant result → Finding — generated through the **real production service** (`createFindingFromInvariantResult`), never by a direct INSERT. It was deliberately retained for inspection and then removed.

**Temporary fixture IDs (no longer present):**

```text
chaos_run          433e3532-19ec-4521-be9f-d9a315aa764b
invariant_result   d8553e2f-cae2-4c20-a473-35225ad94650
finding            497dca2c-68b3-443b-9dc7-e68e5c4fd4c4
```

**The developer inspected it with a read-only Supabase join and observed exactly one row:**

| Field                                                                                                                                          | Observed                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `finding_status`                                                                                                                               | `OPEN`                                                     |
| `finding_title`                                                                                                                                | `INV-005 — Invalid Webhook Signature Causes Zero Mutation` |
| `invariant_id`                                                                                                                                 | `INV-005`                                                  |
| `invariant_result`                                                                                                                             | `FAIL`                                                     |
| `severity`                                                                                                                                     | `CRITICAL`                                                 |
| `scenario_id`                                                                                                                                  | `C03`                                                      |
| `chaos_run_status`                                                                                                                             | `COMPLETED`                                                |
| `chaos_run_outcome`                                                                                                                            | `UNKNOWN`                                                  |
| `data_classification`                                                                                                                          | `SYNTHETIC_DEMO`                                           |
| `diagnosis_code` / `diagnosis_strength` / `diagnosis_summary` / `recommendation_code` / `recommendation_text` / `diagnosed_at` / `resolved_at` | all **NULL**                                               |

`expected_summary`, `observed_summary` and `reason` were all visible **through the linked invariant result**, not from a copy on the finding — which is exactly the traceability property Phase 3G is built around. `evidence_refs` contained exactly one `CHAOS_RUN` reference, to `433e3532-…`, the fixture's own run.

**Truthful classification.** The persisted `observed_summary` and `reason` state in the rows themselves that this was a Phase 3G manual-verification SYNTHETIC fixture — not a real Razorpay or merchant-state observation, and not an evaluator-derived reliability verdict. A reader of the database cannot mistake it for real merchant performance.

**The developer performed READ-ONLY SQL. No mutation was made by the developer.**

### Manual fixture cleanup — PASSED

The three rows were deleted by **exact ID only**, children before parents (`findings` → `invariant_results` → `chaos_runs`). No broad delete, no `neq`/`gte`, no date range, no scenario-wide or classification-wide delete, no reset function, no truncate.

```text
                     before   after
chaos_runs              10       9
invariant_results       12      11
findings                 1       0

exact-ID rows remaining: finding 0, invariant_result 0, chaos_run 0
```

```text
final findings table                      empty
final invariant_results                      11  (exactly the approved set)
non-approved invariant results                0
approved Phase 3F runs present                5
approved tally             PASS 1 / UNKNOWN 10 / FAIL 0
findings linked to those 11                   0
approved outcomes    C03:PASS, C03:UNKNOWN, C07:UNKNOWN, C11:UNKNOWN, C11:UNKNOWN
```

**Final retained synthetic Finding: NONE.** Approved historical Phase 3F evidence: **unchanged**.

---

## 14. Known issues

**Closed — the migration is applied.** The developer applied it manually (`Success. No rows returned.`), and both `065` and the full real-Supabase suite pass against the live project. `REAL SUPABASE VERIFIED = YES`.

**Closed — `MANUALLY VERIFIED = YES`.** The developer completed a read-only join over a temporary architect-authorised `SYNTHETIC_DEMO` chain, which was then removed by exact ID. See §13.

**Note — no authoritative result can produce a finding today.** The project holds PASS 1 / UNKNOWN 10 / FAIL 0, so every real Finding proof to date comes from test-owned `SYNTHETIC_DEMO` evidence. That is correct and intended: the eleven authoritative rows must never be altered to manufacture a FAIL. A genuine Finding will appear the first time a real chaos run produces a real `FAIL`.

**Note — the `resolved_at` expression was ruled, not documented.** `docs/DATABASE.md` Section 17 still says only "consistency CHECK". The migration records the ruling in a comment; if the doc is ever updated, it should adopt this expression.

---

## 15. Freeze status

Phase 3G is **ready to freeze** at the commit that carries these 17 paths.

**Official Phase 3 overall is NOT approved or frozen.** Phase 3H — the chaos and finding UI — remains outstanding, and Phase 3 cannot be called complete until it lands and is approved. Nothing in this handoff claims otherwise.

---

## 16. Deferred

**Phase 3H:** chaos/finding UI, run inspection, evidence timeline, finding detail view. The read model exists; no component, route or rendering does.

**Phase 4:** diagnosis, root-cause classification, evidence-strength labelling, recommendations, `regression_runs`, the STILL_FAILING/RESOLVED lifecycle, the Reliability Score and Go-Live Readiness. None of it exists here.

---

## 17. Do not break

- A Finding may be created ONLY from a persisted `invariant_results.result = 'FAIL'`.
- `PASS` and `UNKNOWN` create zero findings. `UNKNOWN` is never upgraded because evidence was insufficient.
- At most one finding per `invariant_result_id`, enforced by the database.
- Phase 3G production is INSERT-only on `findings` — no UPDATE, no UPSERT, no DELETE — regardless of what the migration grants.
- Regeneration never reopens a RESOLVED finding, never clears a diagnosis, and never rewrites `updated_at`.
- Severity, expected/observed state, reason and evidence refs are read through `invariant_result_id`, never copied.
- Phase 3F stays byte-for-byte frozen; `evaluateChaosRun()` never invokes Finding generation.
- The P0 schema stays at ten tables; `regression_runs` is Phase 4's and there is no generic evidence table.
