# PayChaos AI — Phase 4D Handoff

Internal sub-phase handoff for **Phase 4D — Recommended Fixes** (`docs/PHASE_PLAN.md` Section 8.7).

This is not the Phase 4 handoff. `handoffs/PHASE-4-HANDOFF.md` belongs to the end of the whole phase, once 4A–4G P0 work is complete, and is deliberately not created here.

```text
IMPLEMENTED             = YES
TESTED                  = YES
MANUALLY VERIFIED       = YES
DOCUMENTED              = YES
ARCHITECT APPROVAL      = PENDING FINAL REVIEW
```

Phase 4 as a whole is **not** complete. The regression engine, the Finding lifecycle transitions, the Reliability Score, Go-Live Readiness and the Phase 4 UI all remain unimplemented and belong to 4E and later.

---

## 1. Phase 4D Objective

Phase 4D turns a trusted Phase 4C diagnosis into a deterministic, advisory, **persisted** recommendation:

```text
Finding
  -> trusted Phase 4C deterministic diagnosis   (RootCauseClassificationV1)
    -> DiagnosisEvidencePackV1                   (Phase 4A, read-only)
      -> deterministic recommendation catalogue  (frozen code + template)
        -> safe deterministic explanation        (evidence / inference split)
          -> advisory regression recommendation  (recommend only, never run)
            -> guarded Finding recommendation persistence
```

It **stops there**.

Phase 4D does **not**:

- execute a regression;
- change Finding lifecycle status;
- set `resolved_at`;
- calculate the Reliability Score;
- calculate Go-Live Readiness;
- use AI, ML or an LLM in any form;
- modify payment, order or invariant truth.

Properties: deterministic apart from one server timestamp; no runtime AI of any kind; advisory only — the deterministic invariant `FAIL` stays authoritative.

---

## 2. Internal Round Structure

### 4D-R1 — pure deterministic recommendation catalogue

Checkpoint commit: `83c6b94a04af842debcf2f9a3145e98618e08cf2`
Parent: `1be3097628e9993ea1156c8778499c2a4d3c1edc`
Subject: `feat: add phase 4d deterministic recommendations`

R1 owns:

- the recommendation code vocabulary;
- root-cause → recommendation selection;
- deterministic templates;
- evidence / inference separation;
- advisory regression guidance;
- recommendation input-integrity checks.

R1 is pure: it performs no I/O, reads no environment, and holds no clock.

### 4D-R2 — server orchestration + guarded persistence

R2 owns:

- the server-only trusted orchestration entrypoint;
- guarded recommendation persistence on the existing Finding row;
- `TEMPLATE-V1` explanation provenance;
- best-effort supplemental audit logging;
- real-Supabase verification and human-readable manual verification.

**R2 remains uncommitted at documentation time.** The working tree holds the R2 changes plus this handoff.

---

## 3. Version / Provenance Contract

```text
RECOMMENDATION_OUTPUT_VERSION     = 1
RECOMMENDATION_CATALOGUE_VERSION  = RECOMMENDATION-CATALOGUE-V1
RECOMMENDATION_TEMPLATE_VERSION   = TEMPLATE-V1
RECOMMENDATION_OUTPUT_SOURCE      = DETERMINISTIC_CATALOGUE
```

The embedded Phase 4C diagnosis provenance is unchanged and travels with the recommendation:

```text
DIAGNOSIS_RULE_VERSION            = DIAG-RULES-V1
DIAGNOSIS_OUTPUT_SOURCE           = DETERMINISTIC_RULES
```

**These are two intentionally separate provenance layers.**

`DETERMINISTIC_RULES` says _how the root cause was decided_. `DETERMINISTIC_CATALOGUE` says _how the recommendation was chosen for that root cause_. A reviewer can therefore challenge the diagnosis and the remediation independently, and a future change to one layer does not silently relabel the other. `TEMPLATE-V1` is a third, narrower fact: the wording generation used for the explanation.

There is no model name, no prompt version, no probability confidence, and no runtime LLM anywhere in this phase. Evidence strength is a category (`STRONG_EVIDENCE` / `PARTIAL_EVIDENCE` / `INSUFFICIENT_EVIDENCE`), never a number.

---

## 4. Full Recommendation-Code Vocabulary

The frozen vocabulary is exactly **14** codes:

| #   | Code                             |
| --- | -------------------------------- |
| 1   | `FIX-IDEMPOTENCY`                |
| 2   | `FIX-BUSINESS-IDEMPOTENCY`       |
| 3   | `FIX-WEBHOOK-AUTH`               |
| 4   | `FIX-STATE-MACHINE`              |
| 5   | `FIX-WEBHOOK-TIMEOUT`            |
| 6   | `FIX-RETRY-HANDLING`             |
| 7   | `FIX-TRANSACTION-ATOMICITY`      |
| 8   | `FIX-CLIENT-INDEPENDENCE`        |
| 9   | `FIX-RECONCILIATION`             |
| 10  | `FIX-PROVENANCE`                 |
| 11  | `FIX-UNSUPPORTED-EVENT-GUARD`    |
| 12  | `FIX-PAYMENT-FAILURE-GUARD`      |
| 13  | `FIX-AMOUNT-CURRENCY-VALIDATION` |
| 14  | `INVESTIGATE-EVIDENCE-GAP`       |

The vocabulary is smaller than the 16-code taxonomy because several root causes legitimately share remediation — RC-004/RC-010 share `FIX-STATE-MACHINE`, RC-007/RC-008 share `FIX-TRANSACTION-ATOMICITY`, RC-010/RC-015 share `FIX-RECONCILIATION`, RC-001/RC-011 share idempotency remediation.

---

## 5. Executable Root-Cause Outcomes

Phase 4D currently generates an executable deterministic recommendation for exactly **8** root causes:

```text
RC-001  RC-002  RC-003  RC-009  RC-010  RC-013  RC-014  RC-016
```

The remaining **8** frozen taxonomy categories:

```text
RC-004  RC-005  RC-006  RC-007  RC-008  RC-011  RC-012  RC-015
```

These are **not removed**. They remain part of the frozen 16-code diagnosis taxonomy. They have no executable Phase 4D-R1 selection rule because Phase 4C cannot currently select them, and inventing remediation for a diagnosis the classifier cannot reach would be inventing semantics.

Passing an inactive RC into the recommendation layer **fails closed** with `RECOMMENDATION_ROOT_CAUSE_UNSUPPORTED`. It never falls back to a nearby `FIX-*` code and never degrades to `INVESTIGATE-EVIDENCE-GAP`.

---

## 6. Frozen Recommendation Mapping

| Root cause                                                                   | Recommendation                             |
| ---------------------------------------------------------------------------- | ------------------------------------------ |
| RC-001                                                                       | `FIX-IDEMPOTENCY`                          |
| RC-002                                                                       | `FIX-BUSINESS-IDEMPOTENCY`                 |
| RC-003                                                                       | `FIX-WEBHOOK-AUTH`                         |
| RC-009                                                                       | `FIX-CLIENT-INDEPENDENCE`                  |
| RC-010 with `OUT_OF_ORDER_STATE_REGRESSION`                                  | `FIX-STATE-MACHINE`                        |
| RC-010 with `PAYMENT_CAPTURED_VIA_WEBHOOK` + `CAPTURE_EXISTS_ORDER_NOT_PAID` | `FIX-RECONCILIATION`                       |
| RC-010 `PARTIAL_EVIDENCE`, capture established, stale state not established  | `FIX-RECONCILIATION` with cautious wording |
| RC-013                                                                       | `FIX-PAYMENT-FAILURE-GUARD`                |
| RC-014                                                                       | `FIX-AMOUNT-CURRENCY-VALIDATION`           |
| RC-016                                                                       | `INVESTIGATE-EVIDENCE-GAP`                 |

**RC-010 precedence.** When both strong RC-010 patterns are present, the state regression wins and the recommendation is `FIX-STATE-MACHINE`. A system that moves protected state backwards needs its transition rules fixed before any reconciliation path is worth adding. The choice comes from the **selected candidate's own supporting signals**, never from the scenario and never from a default. If no frozen pattern matches, the layer fails closed with `RECOMMENDATION_RC010_PATTERN_UNSUPPORTED` rather than arbitrarily picking one of the two families.

No other mapping exists.

---

## 7. RC-016 Abstention Contract

**`RC-016` is not an infrastructure error.** It is a deterministic, honest answer about real evidence.

For a valid failed invariant where a specific technical root cause cannot safely be proven:

```text
diagnosis       = RC-016 / INSUFFICIENT_EVIDENCE
recommendation  = INVESTIGATE-EVIDENCE-GAP
```

The recommendation must communicate:

- the invariant failure is proven and authoritative;
- the specific technical root cause is **not** proven;
- the missing structured evidence and blocking gaps should be inspected;
- evidence should be collected or repaired **before** invasive payment-code changes;
- the original approved scenario context should be rerun where one is available.

It must **not** recommend a speculative `FIX-*` category.

Infrastructure and input errors remain errors. A missing Finding, an invalid identifier, a failed read or a failed write raises its own typed error and is **never** rewritten as `RC-016` or `INVESTIGATE-EVIDENCE-GAP`.

---

## 8. Evidence / Inference Separation

`observedEvidence` contains only statements corresponding to the selected candidate's **supporting `PRESENT` signals**.

- `UNKNOWN` never becomes a fact.
- `ABSENT` never becomes a fact.
- The Finding `title`, `expected_summary`, `observed_summary` and `reason` are deterministic evaluator prose and are **never parsed** to manufacture technical evidence.

The explanation exposes four separate fields so a reader can see where fact ends and inference begins:

| Field              | Meaning                                                  |
| ------------------ | -------------------------------------------------------- |
| `diagnosisSummary` | the short human sentence for the Finding row             |
| `observedEvidence` | FACT — only established supporting signals               |
| `inference`        | INFERENCE — what those facts are taken to mean           |
| `uncertainty`      | what is explicitly not proven, or `null` when nothing is |

A PayChaos replay is described as a PayChaos replay. A controlled invalid-signature test is never blamed on Razorpay.

---

## 9. Recommendation Input-Integrity Model

The recommendation layer validates its inputs before any catalogue lookup. **9** error codes:

```text
RECOMMENDATION_INPUT_IDENTITY_MISMATCH
RECOMMENDATION_INPUT_NOT_FAIL
RECOMMENDATION_CLASSIFICATION_VERSION_UNSUPPORTED
RECOMMENDATION_RULE_VERSION_UNSUPPORTED
RECOMMENDATION_CLASSIFICATION_SOURCE_UNSUPPORTED
RECOMMENDATION_EVIDENCE_REF_MISMATCH
RECOMMENDATION_CLASSIFICATION_SELECTION_INVALID
RECOMMENDATION_ROOT_CAUSE_UNSUPPORTED
RECOMMENDATION_RC010_PATTERN_UNSUPPORTED
```

The final R1 integrity correction added `RECOMMENDATION_CLASSIFICATION_SELECTION_INVALID`, which enforces that the supplied object is a coherent frozen Phase 4C result:

- `rankedCandidates` is non-empty;
- `selected` deep-equals `rankedCandidates[0]`;
- the selected code and name match the frozen `ROOT_CAUSE_TAXONOMY`;
- an `RC-016` selection preserves the frozen abstention semantic shape.

Consequences: substituting an **active** selected code is rejected; promoting a **lower-ranked** candidate is rejected. This closes the trust hole where a tampered classification could have produced a confident remediation for a cause that did not actually win. That code is deliberately distinct from `RECOMMENDATION_ROOT_CAUSE_UNSUPPORTED` — the problem is not that a valid category lacks a rule, but that the object is not a genuine classifier output at all.

The recommendation layer does **not** rerun `classifyRootCause` and does **not** rerun `extractDiagnosticSignals`. It consumes Phase 4C output.

---

## 10. Regression Recommendation Boundary

Phase 4D only **recommends** a regression. It never executes one.

`RegressionRecommendationV1`:

```text
scenarioId
failedInvariantId
action
hasApprovedScenario
```

The `action` preserves three things:

1. rerun the **same original approved scenario**;
2. re-evaluate **that scenario's approved relevant invariant set**;
3. the invariant that created this Finding **must pass**.

**`hasApprovedScenario` is NOT execution readiness.** It states one narrow fact: whether this Finding carries an approved original P0 scenario that a regression could target. It does not claim the regression engine exists, that a rerun is currently possible, that a user can start one, or that any safety precondition passes.

There is no `canAutoRerun`, no `executionReady` and no `regressionRunId` field anywhere in Phase 4D.

**No local duplicate `C01`/`C03`/`C07`/`C11` → invariant-set mapping exists in `lib/diagnosis/recommendations.ts`** (verified: zero literal scenario identifiers in that file). Exact scenario invariant-set resolution belongs to Phase 4E, using the authoritative scenario registry.

---

## 11. R2 Trust Boundary

The public Phase 4D server entrypoint is:

```ts
recommendFinding(findingId: string): Promise<RecommendFindingResult>;
```

**The input is a Finding ID and nothing else.** A caller cannot supply an Evidence Pack, a classification, a recommendation, a diagnosis code, a recommendation code or text, a diagnosis summary, or a timestamp. Everything else is derived server-side.

Exact trusted flow:

```text
recommendFinding(findingId)
  -> diagnoseFinding(findingId)                          [Phase 4C, trusted]
  -> assembleDiagnosisEvidencePackForFinding(findingId)   [Phase 4A, read-only]
  -> buildRecommendation(pack, diagnosis.classification)  [Phase 4D-R1, pure]
  -> persistFindingRecommendation(...)                    [Phase 4D-R2, guarded]
  -> emitRecommendationAuditLog(...)                      [supplemental, best-effort]
  -> { diagnosis, recommendation, persistence }
```

Phase 4D-R2 does **not** call `classifyRootCause`, `extractDiagnosticSignals` or `persistFindingDiagnosis`. **Phase 4C remains the single trusted diagnosis authority.** The service holds no second opinion about root cause: the exact classification object returned by `diagnoseFinding` is the object handed to `buildRecommendation`, proven by reference identity in the service tests and structurally by the R2 static guard.

---

## 12. Intentional Second Evidence-Pack Assembly

One `recommendFinding` operation performs the trusted Phase 4C diagnosis operation **plus** one additional read-only Evidence Pack assembly for recommendation generation.

**This duplicated read is intentional.** The alternative — having Phase 4C return its internal pack, or forking its orchestration — would either widen a frozen contract or create a second copy of Phase 4C's logic that could drift. Re-reading is cheap, side-effect-free, and keeps the frozen phase untouched.

The pure recommendation builder **fails closed** if the second pack is not compatible with the trusted classification: identity mismatch, a non-`FAIL` invariant, an unsupported version or source, or mismatched evidence references each raise a typed error rather than producing a recommendation over inconsistent inputs.

---

## 13. Finding Write Ownership

| Phase  | Owns                                                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------- |
| 4C     | `diagnosis_code`, `diagnosis_strength`, `diagnosed_at`, and `updated_at` during diagnosis                             |
| **4D** | `diagnosis_summary`, `recommendation_code`, `recommendation_text`, and `updated_at` during recommendation persistence |
| 4E     | `status`, `resolved_at`                                                                                               |

The Phase 4D repository writes **exactly four columns**:

```text
diagnosis_summary
recommendation_code
recommendation_text
updated_at
```

and never writes:

```text
diagnosis_code
diagnosis_strength
diagnosed_at
status
resolved_at
```

The three Phase 4C diagnosis columns travel as **preconditions, never as payload**. Phase 4D can therefore refuse to write onto a diagnosis it does not recognise, but can never rewrite one.

---

## 14. Recommendation Persistence State Machine

### FRESH

The diagnosis triplet matches the trusted Phase 4C result, and `diagnosis_summary`, `recommendation_code` and `recommendation_text` are all `NULL`. One conditional update runs.

→ `RECOMMENDED`

### EQUIVALENT

All three recommendation fields already hold exactly the deterministic output, and the diagnosis still matches. **No write occurs.** The existing `updated_at` is preserved and returned.

→ `ALREADY_RECOMMENDED`

### PARTIAL

Any partially populated recommendation state is an **integrity conflict**. Phase 4D never fills in around a partial row.

→ `RECOMMENDATION_PERSIST_INTEGRITY_CONFLICT`

### CONTRADICTORY

All three fields are populated but at least one differs from the deterministic output. **Integrity conflict. Never overwritten.**

→ `RECOMMENDATION_PERSIST_INTEGRITY_CONFLICT`

### Concurrent equivalent winner

The conditional update matches no row because a concurrent caller won. The repository re-reads **once**. If the winner's state is equivalent:

→ `ALREADY_RECOMMENDED` (no retry)

### Concurrent contradictory winner

The winner's state differs:

→ `RECOMMENDATION_PERSIST_INTEGRITY_CONFLICT` (no retry loop)

---

## 15. Conditional Update Guards

The single guarded statement matches on:

```text
id                      = findingId
invariant_result_id     = trusted invariantResultId
diagnosis_code          = trusted Phase 4C diagnosis code
diagnosis_strength      = trusted Phase 4C diagnosis strength
diagnosed_at            = trusted Phase 4C diagnosed_at
diagnosis_summary       IS NULL
recommendation_code     IS NULL
recommendation_text     IS NULL
```

**`status` is deliberately NOT a recommendation persistence precondition.** Status belongs to Phase 4E. Phase 4D neither reads it as a guard nor writes it, so a future lifecycle transition cannot accidentally block or be blocked by recommendation persistence.

---

## 16. Repository Error Model

```text
RECOMMENDATION_PERSIST_FINDING_ID_INVALID
RECOMMENDATION_PERSIST_FINDING_NOT_FOUND
RECOMMENDATION_PERSIST_READ_FAILED
RECOMMENDATION_PERSIST_UPDATE_FAILED
RECOMMENDATION_PERSIST_INTEGRITY_CONFLICT
```

Raw Supabase error details, hints and query text are never propagated to the caller. Infrastructure errors never become `RC-016` or `INVESTIGATE-EVIDENCE-GAP`.

---

## 17. Two-Stage Durability

Diagnosis persistence and recommendation persistence are **two separate durable stages**, deliberately not wrapped in one database transaction or RPC.

If Phase 4C diagnosis succeeds but Phase 4D recommendation persistence fails:

- `recommendFinding` rejects with the recommendation error;
- the valid diagnosis **remains persisted**;
- it is **not** rolled back and **not** cleared;
- a later retry observes `ALREADY_DIAGNOSED` and then completes recommendation persistence.

The partial state is visible and honest — a diagnosed Finding with `NULL` recommendation fields — and it is recoverable by simply calling the entrypoint again. No artificial cross-stage transaction or stored procedure was introduced to hide it.

---

## 18. Safe Audit Logging

Audit event: `diagnosis.recommendation.persisted`.

It logs only safe structured identifiers, frozen vocabulary, counts and timestamps: finding id, invariant result id, invariant id, diagnosis code and strength, recommendation code, the three provenance versions, the output source, supporting-signal and blocking-gap counts, the persistence kind and `updated_at`.

It does **not** log `diagnosis_summary`, `recommendation_text`, observed-evidence prose, raw evidence, webhook bodies, signatures, `fault_config`, `fault_state` or any secret.

**Logging is supplemental.** It runs last, inside a narrow `try`/`catch`. If the logger throws after `RECOMMENDED` or `ALREADY_RECOMMENDED`, the service still resolves successfully. Logging never retries persistence, reruns diagnosis, rebuilds the recommendation, clears state, or converts a committed success into a failure. PostgreSQL remains authoritative.

---

## 19. Database Changes

```text
Phase 4D migration        = NO
New table                 = NO
New column                = NO
New index                 = NO
New CHECK                 = NO
RLS change                = NO
```

Migration count remains **12**. Latest migration remains `20260903000000_phase3g_findings.sql`.

Phase 4D reuses the existing Phase 3G Finding columns. There is no generic recommendation table and no template-version database column — catalogue and template provenance remain application-level, so a wording revision never requires a migration.

**This is not an omission.** Phase 4D genuinely needs no schema change. The next sub-phase does:

```text
Phase 4D migration        = NO
Phase 4E expected migration = YES — the required `regression_runs` table
```

`regression_runs` is the 10th and last table of the frozen final P0 schema (`docs/DATABASE.md` Section 3), and the Phase-to-Table matrix (`docs/DATABASE.md` Section 50) assigns its **CREATE** to Phase 4. It is currently absent from all 12 migrations — the eight migrations that mention it do so only in comments recording that they deliberately do not create it. Section 31 states the consequence.

---

## 20. R1 Automated Evidence

Final accepted Phase 4D-R1 evidence:

| Gate               | Result                                          |
| ------------------ | ----------------------------------------------- |
| focused Phase 4D   | 115 / 115                                       |
| all diagnosis      | 560 / 560                                       |
| regression group   | 2090 / 2090                                     |
| complete offline   | 3217 / 3217                                     |
| typecheck          | PASS                                            |
| lint               | PASS — 0 errors, one known pre-existing warning |
| build              | PASS                                            |
| Prettier           | PASS                                            |
| `git diff --check` | PASS                                            |

No real-Supabase R1 test was required, because R1 is pure and performs no I/O.

**Mutation proof.** Bypassing the `selected` vs `rankedCandidates[0]` integrity check caused **six** integrity tests to fail. The production source was then restored byte-identically (SHA-256 verified) and the scratch files deleted.

---

## 21. R2 Automated Evidence

| Gate                      | Result                                          |
| ------------------------- | ----------------------------------------------- |
| recommendation repository | 29 / 29                                         |
| recommendation service    | 22 / 22                                         |
| R2 static/security guard  | 26 / 26                                         |
| all diagnosis             | 638 / 638                                       |
| focused integration 070   | 11 / 11                                         |
| full real Supabase        | 422 / 422 (31 files, exit 0)                    |
| final complete offline    | 3295 / 3295 across 119 files, exit 0            |
| typecheck                 | PASS                                            |
| lint                      | PASS — 0 errors, one known pre-existing warning |
| production build          | PASS on first attempt (no `.next` EPERM)        |
| Prettier                  | PASS                                            |
| `git diff --check`        | PASS                                            |

---

## 22. Rejected Automated Run Disclosure

The **first** complete offline R2 attempt reported:

```text
117 test files passed
3198 tests passed
2 unhandled errors — Vitest worker startup timed out
exit 1
```

Two test files never started at all: `tests/unit/demo-merchant/repository.test.ts` and `tests/unit/evidence/phase3e-b-static-guard.test.ts`.

**That run was NOT accepted as a PASS.** Nothing substantive was changed to make it pass — no test was weakened, skipped or deleted, and no timeout was raised. The suite was simply rerun on a quiet machine.

Final accepted run: **119 files, 3295 tests, exit 0.**

This environmental rejection is recorded rather than hidden.

---

## 23. Real Supabase 070 Proof

`tests/integration/supabase/070-phase4d-recommendation-persistence.integration.test.ts` — 11 cases against the live Supabase project.

**Fixture:**

```text
scenario                        = C03
data classification             = SYNTHETIC_DEMO
invariant                       = INV-005 FAIL
merchant correlations           = NULL (order, payment attempt, payment)
real Razorpay webhook           = NO
Razorpay contacted              = NO
fabricated signature evidence   = NO
fabricated mutation evidence    = NO
```

Because no verification fact and no mutation fact exists for this fixture, the honest diagnosis is `RC-016` / `INSUFFICIENT_EVIDENCE` and the honest recommendation is `INVESTIGATE-EVIDENCE-GAP`. That is the asserted expected outcome — the test proves the abstention is durable rather than dressing it up.

**Proved:**

- first operation → `DIAGNOSED` + `RECOMMENDED`;
- second operation → `ALREADY_DIAGNOSED` + `ALREADY_RECOMMENDED`;
- exactly seven Phase 4 advisory fields changed from the fresh Finding: `diagnosis_code`, `diagnosis_strength`, `diagnosis_summary`, `recommendation_code`, `recommendation_text`, `diagnosed_at`, `updated_at`;
- unchanged: `id`, `invariant_result_id`, `status`, `title`, `resolved_at`, `created_at`;
- `status` remained `OPEN` and `resolved_at` remained `NULL`;
- the invariant result and chaos run remained field-for-field identical;
- all nine authoritative table counts were unchanged by the operation;
- a direct anonymous update of `recommendation_code` was denied / matched no row, and the anonymous client could not read the row at all;
- an absent Finding and an invalid identifier each raised their own upstream error with no `RC-016` fallback and no write;
- cleanup by exact UUID restored the baseline census.

---

## 24. Manual Verification

Temporary runner: `tests/integration/supabase/phase4d-manual.tmp.integration.test.ts` (no numbered prefix, never a permanent suite).

```text
temporary runner deleted = YES
manual test              = 9 / 9 PASS
```

The runner was executed **twice**:

1. first execution — 9/9 PASS, but the default reporter suppressed `console.log`, so it produced no human-inspectable output;
2. second execution — 9/9 PASS with verbose console output for human inspection.

Both executions created their own test-owned fixture, cleaned it up by exact UUID, and independently confirmed the final census equalled their own dynamic baseline. This is a reporter-configuration matter, not a failure, and is recorded transparently.

---

## 25. Manual Safe Block

```text
MANUAL_PHASE4D_RECOMMENDATION
scenarioId = C03
dataClassification = SYNTHETIC_DEMO
invariantId = INV-005
invariantResult = FAIL
diagnosisCode = RC-016
diagnosisStrength = INSUFFICIENT_EVIDENCE
diagnosisOutputSource = DETERMINISTIC_RULES
diagnosisRuleVersion = DIAG-RULES-V1
recommendationCode = INVESTIGATE-EVIDENCE-GAP
recommendationOutputSource = DETERMINISTIC_CATALOGUE
recommendationCatalogueVersion = RECOMMENDATION-CATALOGUE-V1
templateVersion = TEMPLATE-V1
firstDiagnosisPersistence = DIAGNOSED
firstRecommendationPersistence = RECOMMENDED
secondDiagnosisPersistence = ALREADY_DIAGNOSED
secondRecommendationPersistence = ALREADY_RECOMMENDED
recommendationIdenticalOnSecondCall = true
diagnosedAtPreserved = true
recommendationUpdatedAtPreserved = true
findingIdenticalAfterSecondCall = true
findingStillOpen = true
resolvedAtStillNull = true
invariantResultUnchanged = true
chaosRunUnchanged = true
rowCountsChangedByOperation = false
authoritativeMerchantPaymentStateChanged = false
anonymousRecommendationMutationSucceeded = false
invalidIdError = EVIDENCE_PACK_FINDING_ID_INVALID
missingFindingError = EVIDENCE_PACK_FINDING_NOT_FOUND
secretOrRawEvidenceDetected = false
```

**Human-inspected advice — what the generated text actually said:**

- the diagnosis summary correctly states that **INV-005 failed**;
- the failure is described as **authoritative**;
- the specific technical cause is explicitly **not proven**;
- the recommendation says to **collect or repair the missing evidence before making invasive changes to payment code**;
- the regression action points to **C03**;
- it requires re-evaluating that scenario's **approved relevant invariant set**;
- it states that **INV-005 must pass**.

```text
unsupported technical cause invented              = NO
recommendation technically appropriate for RC-016 = YES
```

---

## 26. Manual Cleanup

```text
exactIdsDeleted            = true
finalCensusMatchesBaseline = true
pendingChaosRuns           = 0
runningChaosRuns           = 0
```

Deletion was by **exact UUID only**, children before parents: Finding → invariant result → chaos run. No broad cleanup predicate was used — never by scenario, status, classification, date or `recommendation_code`. Each set was re-queried and confirmed at count 0.

---

## 27. Manual Human-Facing Cosmetic Observations

Both **NON-BLOCKING**. No production code was changed for either.

### Cosmetic 1 — repetitive RC-016 summary wording

The RC-016 diagnosis summary currently reads, in part:

```text
PayChaos selected RC-016 INSUFFICIENT_EVIDENCE with INSUFFICIENT_EVIDENCE
```

This happens because the frozen taxonomy **name** for RC-016 is literally `INSUFFICIENT_EVIDENCE`, and so is the evidence **strength**, so the `{code} {name} with {strength}` template renders the same phrase twice. The statement is truthful; it simply reads awkwardly.

Presentation cleanup is deferred to Phase 5 UI/presentation work, unless a later architect-approved compatibility change becomes genuinely necessary.

### Cosmetic 2 — empty `observedEvidence` for an honest RC-016

`observedEvidence` can be an empty array for an honest RC-016 result when no supporting `PRESENT` signal exists. **This is truthful and expected** — there is genuinely nothing established to list.

Phase 5 UI should render this as a friendly state such as _"No supporting structured signal was established"_ rather than a visually blank section. **Do not fabricate evidence to fill it.**

Neither issue blocks Phase 4D.

---

## 28. Security / Authority

- Razorpay **Test Mode** context only; no real money; no arbitrary external target.
- **Phase 4D makes no Razorpay call at all** and creates no provider event.
- No fake provider webhook and no `REAL_RAZORPAY_WEBHOOK` row is ever created by Phase 4D or its tests.
- No secret, raw payload, webhook body, signature, `raw_body_sha256`, `fault_config` or `fault_state` appears in any output, log or error. Asserted directly in both the integration suite and the manual runner.
- `lib/diagnosis/recommendation-repository.ts` and `lib/diagnosis/recommendation-service.ts` are `import "server-only"`; neither is reachable from a client component.
- **An anonymous client cannot write a recommendation.** Proven from the untrusted browser position against the live database.
- The recommendation is **advisory**. The diagnosis is **advisory**. The deterministic invariant result stays authoritative, and payment/order state stays authoritative.
- A recommendation **cannot modify code** and **cannot execute a regression**.
- No AI, ML or LLM. No paid runtime API. No browser-supplied timestamp and no browser-supplied classification — the only timestamp Phase 4D creates is one server `new Date().toISOString()` for the write.

---

## 29. Known Limitations / Non-Blockers

All **non-blocking for Phase 4D**:

1. Concurrency race behaviour is unit-tested with a fake client but has not been deliberately raced against live Supabase.
2. Diagnosis and recommendation persistence are intentionally two durable stages, not one database transaction (Section 17).
3. Catalogue and template versions are not stored as database columns.
4. `diagnosis_code` still carries the Phase 4C known database-vocabulary CHECK limitation.
5. Supplemental audit-log loss can be silent after a successful persistence, by design (Section 18).
6. One pre-existing lint warning remains in `tests/integration/supabase/051-chaos-safety-gate.integration.test.ts` (an unused `eslint-disable` directive). That file is **unchanged from HEAD** — verified with `git diff --quiet HEAD` — so the warning predates Phase 4D.
7. The Vite native-config forward-compatibility warning remains on the integration config.
8. The Windows/OneDrive `.next` EPERM recovery rule remains: clear **only** `.next`, retry once.
9. Resource contention can cause Vitest worker-start timeouts; such runs are rejected and never counted as PASS (Section 22).
10. The RC-016 diagnosis-summary wording has one cosmetic repetition (Section 27).
11. RC-016 `observedEvidence` may be empty and should receive friendly Phase 5 UI treatment (Section 27).
12. No recommendation API route or UI exists yet.
13. No regression execution exists yet.

---

## 30. Deferred Work

**Phase 4E** — the required `regression_runs` migration; the regression engine; starting a regression from an existing Finding; rerunning the original scenario; re-evaluating the authoritative relevant invariant set; preserving original failure history; the Finding status lifecycle (`RESOLVED`, `STILL_FAILING`); `resolved_at`.

**Phase 4F** — Reliability Score.

**Phase 4G** — Go-Live Readiness.

**Phase 4H** — optional P1 AI/ML differentiators, only if P0 is stable.

**Phase 5** — UI presentation and polish; friendly presentation of empty observed evidence; avoiding the repetitive raw RC-016 summary as primary copy where the separate structured fields communicate it more clearly.

---

## 31. Phase 4E Starting Contract

Phase 4E is the **Regression Engine**. It **must start with a READ-ONLY architect audit**, as 4A, 4B, 4C and 4D did.

```text
PHASE_4E_MIGRATION_REQUIRED = YES
```

`regression_runs` is required by the frozen final P0 database shape and is currently absent from all 12 migrations. Phase 4E must create it through a repository-managed Phase 4 migration.

**Starting authoritative input:** an existing Finding with persisted `diagnosis_code`, `diagnosis_strength`, `diagnosis_summary`, `recommendation_code` and `recommendation_text`.

**A regression must target** the original approved chaos scenario **and** that scenario's authoritative relevant invariant set. **Do not duplicate the scenario → invariant-set mapping** — use the authoritative scenario/invariant registry. Phase 4D deliberately contains no such mapping.

**A regression must preserve original failure history.** It must **NEVER** overwrite or delete the original failed invariant result, the original Finding evidence, the original diagnosis, or the original recommendation.

**Phase 4E owns:**

- **creation of the required P0 `regression_runs` table through a repository-managed Phase 4 migration**, according to the frozen `docs/DATABASE.md` contract;
- regression execution;
- the `RESOLVED` / `STILL_FAILING` lifecycle;
- `resolved_at`.

**Phase 4E does not decide _whether_ `regression_runs` exists.** That is already frozen: `docs/DATABASE.md` names it as the 10th table of the complete approved P0 table set, assigns its **CREATE** to Phase 4 in the Phase-to-Table matrix, and fixes the regression storage shape as

```text
Finding -> regression_runs -> new chaos_runs row -> new invariant_results
```

with previous invariant and failure history preserved.

**What the Phase 4E read-only audit determines** — before any implementation:

- the exact `regression_runs` DDL from `docs/DATABASE.md`;
- the exact status vocabulary;
- foreign keys and delete behaviour;
- uniqueness / idempotency rules;
- server-write and RLS policy;
- the relationship to the original Finding;
- the relationship to the newly created chaos run;
- how the authoritative scenario → invariant-set mapping is reused;
- the resolution criteria;
- concurrency and idempotency behaviour;
- the tests and acceptance evidence required.

It will **not** reconsider whether the `regression_runs` table itself is required, and this handoff deliberately does **not** design the migration or invent any column beyond what `docs/DATABASE.md` already defines.

**Phase 4E may NOT:**

- rewrite `diagnosis_code` or `diagnosis_strength`;
- rewrite the recommendation;
- change authoritative payment truth;
- treat `UNKNOWN` as `PASS`;
- invent a new scenario;
- run arbitrary external targets;
- calculate the Reliability Score;
- calculate Go-Live Readiness.

**Contracts Phase 4E must not break:** `RECOMMENDATION_OUTPUT_VERSION = 1`; `RECOMMENDATION-CATALOGUE-V1`; `TEMPLATE-V1`; `DETERMINISTIC_CATALOGUE`; `DIAG-RULES-V1`; `DETERMINISTIC_RULES`; the 14-code vocabulary; the 8 executable / 8 inactive root-cause split; the four-column Phase 4D write scope; the `.is(…, null)` freshness guards; the absence of any `status` predicate in the Phase 4D update; and `assertClassificationSelection` as the trust boundary.

---

## 32. Phase 4 Acceptance Summary

Mapping against `docs/PHASE_PLAN.md` Section 8.16. **Full Phase 4 acceptance is NOT complete.**

| Criterion               | Status                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| **P4-AC-01**            | Already supported by Phase 4A.                                                                                  |
| **P4-AC-02**            | Supported by Phase 4C for active deterministic diagnosis mappings.                                              |
| **P4-AC-03**            | Supported by Phase 4C evidence-linked diagnosis.                                                                |
| **P4-AC-04**            | Supported by RC-016 insufficient-evidence handling.                                                             |
| **P4-AC-05**            | **SATISFIED by Phase 4D** — a recommendation is generated from an approved deterministic mapping and persisted. |
| **P4-AC-06**            | **NOT complete** — Phase 4E.                                                                                    |
| **P4-AC-07**            | **NOT complete** — Phase 4E.                                                                                    |
| **P4-AC-08**            | **NOT complete** — Phase 4E.                                                                                    |
| **P4-AC-09**            | **NOT complete** — Phase 4E.                                                                                    |
| **P4-AC-10 … P4-AC-14** | **NOT complete** — 4F / 4G / UI as appropriate.                                                                 |
| **P4-AC-15**            | **Satisfied for 4D.** No paid LLM API and no runtime AI required.                                               |

---

## Appendix — Where to Look

| Concern                       | File                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| Pure recommendation catalogue | `lib/diagnosis/recommendations.ts`                                                                 |
| Recommendation repository     | `lib/diagnosis/recommendation-repository.ts`                                                       |
| Recommendation service        | `lib/diagnosis/recommendation-service.ts`                                                          |
| Evidence Pack (Phase 4A)      | `lib/diagnosis/evidence-pack.ts`, `lib/diagnosis/evidence-pack-service.ts`                         |
| Root-cause service (Phase 4C) | `lib/diagnosis/root-cause-classifier.ts`, `lib/diagnosis/root-cause-service.ts`                    |
| Phase 4D pure tests           | `tests/unit/diagnosis/recommendations.test.ts` (85 cases)                                          |
| Repository tests              | `tests/unit/diagnosis/recommendation-repository.test.ts` (29 cases)                                |
| Service tests                 | `tests/unit/diagnosis/recommendation-service.test.ts` (22 cases)                                   |
| R1 static guard               | `tests/unit/diagnosis/phase4d-r1-static-guard.test.ts` (31 cases)                                  |
| R2 static guard               | `tests/unit/diagnosis/phase4d-r2-static-guard.test.ts` (26 cases)                                  |
| Real Supabase proof           | `tests/integration/supabase/070-phase4d-recommendation-persistence.integration.test.ts` (11 cases) |
| Prior sub-phases              | `handoffs/PHASE-4A-HANDOFF.md`, `handoffs/PHASE-4B-HANDOFF.md`, `handoffs/PHASE-4C-HANDOFF.md`     |

Case counts are `it(...)` blocks counted directly from the current files; some blocks assert several logical cases, so these are not the same as the Vitest run totals reported elsewhere in this document.
