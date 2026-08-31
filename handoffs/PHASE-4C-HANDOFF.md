# PayChaos AI — Phase 4C Handoff

Internal sub-phase handoff for **Phase 4C — Root-Cause Classification** (`docs/PHASE_PLAN.md` Section 8.7).

This is not the Phase 4 handoff. `handoffs/PHASE-4-HANDOFF.md` belongs to the end of the whole phase, once 4A–4G P0 work is complete, and is deliberately not created here.

```text
IMPLEMENTED             = YES
TESTED                  = YES
MANUALLY VERIFIED       = YES
DOCUMENTED              = YES
ARCHITECT APPROVAL      = PENDING FINAL REVIEW
```

Phase 4 as a whole is **not** complete. Recommendations, the regression engine, the Reliability Score, Go-Live Readiness and the Phase 4 UI all remain unimplemented and belong to 4D and later.

---

## 1. Phase 4C Objective

Phase 4C turns the frozen Phase 4A evidence and Phase 4B signals into a deterministic, advisory, **persisted** root cause:

```text
Finding
  -> DiagnosisEvidencePackV1        (Phase 4A, frozen)
    -> DiagnosticSignalSetV1        (Phase 4B, frozen)
      -> deterministic candidate rules
        -> deterministic ranking
          -> selected root cause + evidence strength
            -> guarded Finding diagnosis persistence
```

It **stops there**. Phase 4C contains no recommendation catalogue, no recommendation text, no regression logic, no score and no readiness rule. It also deliberately leaves `findings.diagnosis_summary` unpopulated (Section 12).

Properties: deterministic apart from one server timestamp; no LLM, no ML, no runtime AI of any kind; advisory only — the deterministic invariant `FAIL` stays authoritative.

---

## 2. Internal Round Structure

### 4C-R1 — pure deterministic classifier

`lib/diagnosis/root-cause-classifier.ts`. No I/O, no clock, no randomness; imports only the two frozen pure diagnosis modules plus one type-only schema-vocabulary line.

```text
commit  = a752f9b136efd937bbcaff931048f1ba794260ab
parent  = 5afd70b9a8b916dfc2f1f51ab3c58542fb439667
subject = feat: add phase 4c deterministic root cause classifier
```

### 4C-R2 — server orchestration + guarded persistence

`lib/diagnosis/root-cause-service.ts` and `lib/diagnosis/root-cause-repository.ts`, plus the real-Supabase proof and manual verification.

**R2 remains uncommitted at documentation time.** The remote phase branch is still at the Phase 4B freeze, `5afd70b9…`.

---

## 3. Frozen Classification Contract

```text
ROOT_CAUSE_CLASSIFICATION_VERSION = 1
DIAGNOSIS_RULE_VERSION            = DIAG-RULES-V1
DIAGNOSIS_OUTPUT_SOURCE           = DETERMINISTIC_RULES
```

Evidence strengths, exactly three:

```text
STRONG_EVIDENCE
PARTIAL_EVIDENCE
INSUFFICIENT_EVIDENCE
```

Match tiers, exactly five, in the frozen specificity order of `docs/AI_DESIGN.md` Section 34:

```text
DIRECT_EVIDENCE  >  SCENARIO_INVARIANT_SIGNAL  >  INVARIANT_SIGNAL  >  PARTIAL_MATCH  >  INSUFFICIENT
```

**No probabilities. No percentage confidence. No HIGH/MEDIUM/LOW scale.** The tier ordinal exists only to sort and is never emitted (`docs/AI_DESIGN.md` Section 41).

`DIAGNOSIS_OUTPUT_SOURCE` is deliberately a provenance label, not a model name: no AI participates at any point.

---

## 4. Root-Cause Taxonomy

The frozen P0 taxonomy (`docs/AI_DESIGN.md` Section 16). **Taxonomy count = 16.**

```text
RC-001 MISSING_EVENT_IDEMPOTENCY
RC-002 MISSING_BUSINESS_IDEMPOTENCY
RC-003 INVALID_SIGNATURE_HANDLING
RC-004 EVENT_ORDERING_ASSUMPTION
RC-005 WEBHOOK_PROCESSING_DEADLINE_RISK
RC-006 RETRY_STATE_MANAGEMENT_FAILURE
RC-007 NON_ATOMIC_PROCESSING
RC-008 DATABASE_PARTIAL_FAILURE
RC-009 CLIENT_CONFIRMATION_DEPENDENCY
RC-010 STALE_PAYMENT_STATE
RC-011 UNSAFE_REPLAY_HANDLING
RC-012 UNSUPPORTED_EVENT_FALLTHROUGH
RC-013 PAYMENT_FAILURE_STATE_MAPPING
RC-014 AMOUNT_CURRENCY_MISMATCH
RC-015 MISSING_RECONCILIATION
RC-016 INSUFFICIENT_EVIDENCE
```

---

## 5. Active P0 R1 Categories

```text
active specific = RC-001, RC-002, RC-003, RC-009, RC-010, RC-013, RC-014
fallback        = RC-016
inactive        = RC-004, RC-005, RC-006, RC-007, RC-008, RC-011, RC-012, RC-015
```

**Inactive does NOT mean removed.** All sixteen codes remain in the frozen taxonomy and in the exported type. The eight inactive ones simply have no selection rule in R1, because the frozen Phase 4B 13-signal contract does not yet carry a distinct evidence combination that would let the engine choose them without guessing — or they belong to deferred P1 scenario wrappers.

This is a statement about **what the current evidence can support**, not a claim that those failure modes do not exist. Activating one requires architect-approved evidence support, never a looser rule over the signals that already exist. A unit test sweeps every scenario × invariant × signal-state combination the engine knows and asserts none of the eight is ever selected.

---

## 6. Deterministic Ranking and Precedence

Ranking order:

```text
1. match specificity (tier)
2. evidence strength
3. frozen deterministic rule precedence
4. the code itself (total-order guarantee)
```

No random ordering; reordering semantically identical inputs cannot change the outcome.

Accepted overlaps:

| Scenario | Precedence          | Condition                                                                      |
| -------- | ------------------- | ------------------------------------------------------------------------------ |
| C01      | **RC-002 > RC-001** | direct same-logical-payment duplicate business-effect evidence supports RC-002 |
| C07      | **RC-009 > RC-010** | the full client-confirmation-dependency pattern exists                         |
| C11      | **RC-013 > RC-010** | failure-event-to-PAID mapping evidence exists                                  |

RC-009 and RC-013 outrank RC-010 because they name _why_ the state went stale — expressed through the frozen precedence list, never by understating RC-010's evidence tier (Section 7).

---

## 7. Important Semantic Corrections

Three corrections from architect review, all frozen.

### RC-016 gap relevance

`RC-016` reports blocking gaps **only** from UNKNOWN signals belonging to an active root-cause rule that is _applicable_ to the current scenario/invariant. It never aggregates every UNKNOWN signal in the pack.

A C03 signature diagnosis therefore does not report a money gap merely because money evidence is unavailable — an unestablished money projection is not why a signature diagnosis could not be reached. This preserves the narrow per-signal gap discipline Phase 4B established. When no active rule applies at all, the gap list is legitimately empty rather than padded with unrelated codes.

### RC-002 optional idempotency-key evidence

The defining strong pattern is:

```text
DUPLICATE_FULFILMENTS = PRESENT  +  SAME_LOGICAL_PAYMENT = PRESENT
```

`DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS` is **optional strengthening**:

- `PRESENT` → added to supporting signals;
- `ABSENT` → neutral, **not** a contradiction;
- `UNKNOWN` → does not downgrade an otherwise fully proven RC-002, and does not become a blocking gap.

It can never substitute for proof that the duplicate effects belong to the same logical payment. When `SAME_LOGICAL_PAYMENT` is UNKNOWN, that — not the key evidence — is what holds RC-002 at `PARTIAL_EVIDENCE`.

### RC-010 direct evidence

Both defining strong patterns are `STRONG_EVIDENCE` + `DIRECT_EVIDENCE`:

```text
OUT_OF_ORDER_STATE_REGRESSION = PRESENT
```

or

```text
PAYMENT_CAPTURED_VIA_WEBHOOK = PRESENT  +  CAPTURE_EXISTS_ORDER_NOT_PAID = PRESENT
```

The invariant gates applicability; the signals do the proving. The RC-009 / RC-013 overlap precedence still wins where applicable.

---

## 8. Input Integrity

The classifier fails closed when its two frozen inputs do not belong together:

```text
DIAGNOSIS_INPUT_IDENTITY_MISMATCH
DIAGNOSIS_INPUT_NOT_FAIL
DIAGNOSIS_SIGNAL_VERSION_UNSUPPORTED
DIAGNOSIS_SIGNAL_SET_INVALID
```

The signal set must be exactly the frozen thirteen codes in the frozen order — missing, duplicate, extra and reordered are all rejected.

**None of these is `RC-016`.** `RC-016` means valid input plus insufficient root-cause evidence. A broken input contract or an infrastructure failure is a different condition and must surface as an error.

---

## 9. Prose Is Never Evidence

Root-cause selection never derives a technical fact from `finding.title`, `expectedSummary`, `observedSummary` or `reason`. `scenarioId` and `invariantId` may gate whether a rule is _applicable_; neither can prove the technical behaviour occurred.

A regression test rewrites all four prose fields dramatically — including text naming a different RC code — and asserts the classification is deep-equal.

Concretely: C01 plus a raised attempt count never manufactures RC-001 (C01 _causes_ replay by design); C03 alone never produces RC-003; C11 alone never produces RC-013; INV-008 alone never produces RC-014.

---

## 10. R2 Orchestration

```text
diagnoseFinding(findingId)
  -> assembleDiagnosisEvidencePackForFinding(findingId)   ← exactly ONE assembly
    -> extractDiagnosticSignals(pack)                     (frozen pure)
      -> classifyRootCause(pack, signals)                 (frozen pure)
        -> persistFindingDiagnosis(...)                   (guarded write)
          -> { classification, persistence }
```

**`assembleDiagnosticSignalsForFinding(findingId)` is deliberately NOT called from the R2 diagnosis service.** That Phase 4B server service would assemble a _second_ Evidence Pack for the same operation — two reads of the same evidence, with a window in which they could disagree. Instead the single pack is handed to the frozen pure extractor directly.

```text
Evidence Pack assemblies per diagnosis = 1
persistence attempts per diagnosis     = MAX 1
```

The service performs no database access of its own. Both facts are asserted by a static guard that counts the single call site in source, and by unit tests.

---

## 11. Finding Persistence Scope

A first successful diagnosis writes **exactly four columns on exactly one Finding**:

```text
diagnosis_code
diagnosis_strength
diagnosed_at
updated_at
```

Phase 4C does **not** write `status`, `title`, `diagnosis_summary`, `recommendation_code`, `recommendation_text`, `resolved_at`, `invariant_result_id` or `created_at`.

It does not update `orders`, `payment_attempts`, `payments`, `fulfilments`, `webhook_events`, `event_processing_attempts`, `chaos_runs` or `invariant_results`.

Diagnosis is advisory. Invariant truth remains authoritative.

The timestamp is generated server-side, once, after a classification exists — never accepted from a caller and never supplied by the browser. There is no `updated_at` trigger on `findings`, so the application sets it explicitly.

---

## 12. `diagnosis_summary` and the 4D Boundary

`findings.diagnosis_summary` is intentionally **not** populated by Phase 4C, and neither are `recommendation_code` and `recommendation_text`.

Phase 4C owns root-cause classification and evidence strength. The fuller explanation/template layer and the recommendation catalogue are later Phase 4 work, and mixing them into this persistence step would blur an implementation-order boundary. This is a sequencing decision, not a claim that `diagnosis_summary` is unused in the final Phase 4.

---

## 13. Persistence State Machine

### FRESH

All advisory diagnosis/recommendation fields NULL → one conditional first write → **`DIAGNOSED`**.

### EQUIVALENT

Existing `diagnosis_code` matches, `diagnosis_strength` matches, `diagnosed_at` non-null → **no write** → **`ALREADY_DIAGNOSED`**, returning the existing `diagnosed_at` and `updated_at`.

Later-phase `diagnosis_summary` / recommendation fields may already exist; 4C neither compares nor clears them, since they are not this phase's to own.

### CONFLICT

Partial diagnosis state, a contradictory diagnosis, or an orphaned summary/recommendation state → **typed integrity conflict**. Never overwritten.

### Concurrent equivalent winner

The conditional update matches no row → re-read **once** → equivalent winner → **`ALREADY_DIAGNOSED`**. No write retry.

### Concurrent contradictory winner

Integrity conflict. **No retry loop** anywhere in the repository.

---

## 14. Strict Freshness Decision

A fresh Finding requires **all six** of these to be NULL, both in the read-side classification and as `.is(…, null)` guards on the conditional update:

```text
diagnosis_code
diagnosis_strength
diagnosed_at
diagnosis_summary
recommendation_code
recommendation_text
```

This is stricter than the minimum three. The reason: if a later advisory field somehow exists before any diagnosis, that state is already inconsistent, and writing a diagnosis underneath it would paper over the inconsistency instead of surfacing it. An intentional safety decision, recorded here because it means such a Finding raises a conflict rather than being diagnosed.

The update is additionally pinned by `id` and `invariant_result_id`. No broad status, scenario or date predicate is ever used.

---

## 15. Persistence Error Model

```text
DIAGNOSIS_PERSIST_FINDING_ID_INVALID
DIAGNOSIS_PERSIST_FINDING_NOT_FOUND
DIAGNOSIS_PERSIST_READ_FAILED
DIAGNOSIS_PERSIST_UPDATE_FAILED
DIAGNOSIS_PERSIST_INTEGRITY_CONFLICT
```

Raw Supabase errors, their details, hints and any query text are never propagated — a unit test asserts no raw message, detail or code escapes. Read and infrastructure failures are **never** converted to `RC-016`.

Phase 4A evidence errors, the R1 classification errors and these persistence errors all propagate through `diagnoseFinding` unchanged.

---

## 16. RC-016 Durability

**`RC-016` is a successful classification result, not an error.**

For valid failed-invariant evidence where no specific cause can safely be proven:

```text
diagnosis_code     = RC-016
diagnosis_strength = INSUFFICIENT_EVIDENCE
diagnosed_at       = persisted, non-null server timestamp
```

This makes insufficient evidence **explicit and durable**, instead of hallucinating a specific cause or leaving the diagnosis fields NULL and indistinguishable from "not yet diagnosed". The invariant failure is proven; only the root cause is not.

---

## 17. Best-Effort Structured Logging

Sequence:

```text
persist diagnosis successfully  ->  attempt safe structured audit log  ->  return success
```

Structured logging is **supplemental**. If `logEvent` throws after persistence, `diagnoseFinding` still returns the successful classification and persistence result.

A logger failure does **not**: roll back, retry persistence, re-read, reclassify, convert to `RC-016`, or turn a committed diagnosis into an apparent failed operation. The original ordering made exactly that possible — a caller seeing failure while the database had already committed — which is an ambiguous partial success and the worst available answer.

The catch is scoped **only** around `logEvent`. Evidence assembly, signal extraction, classification and persistence sit outside it and continue to propagate unchanged. The swallowed error is not re-logged: the logger is what just failed, and its message is uncontrolled text.

Safe event: `diagnosis.root_cause.persisted`. Fields are identifiers, approved vocabulary values and counts only — every value a primitive. No evidence body, webhook body, signature or secret.

**Consequence, stated plainly:** loss of a supplemental audit line can be silent by design. PostgreSQL remains authoritative, and the service response still carries `findingId`, `invariantResultId`, `outputSource`, `ruleVersion`, `evidenceRefs` and `diagnosedAt`, so the operation stays audit-capable from the caller's side.

---

## 18. Files

### R1 — committed

Commit `a752f9b136efd937bbcaff931048f1ba794260ab` (5 files, +2731 / −8):

```text
lib/diagnosis/root-cause-classifier.ts
tests/unit/diagnosis/root-cause-classifier.test.ts
tests/unit/diagnosis/phase4c-r1-static-guard.test.ts
tests/unit/diagnosis/phase4a-static-guard.test.ts
tests/unit/diagnosis/phase4b-r1-static-guard.test.ts
```

### R2 — currently uncommitted (12 paths)

```text
lib/diagnosis/root-cause-repository.ts                                          (new, production)
lib/diagnosis/root-cause-service.ts                                             (new, production)
tests/integration/supabase/069-phase4c-root-cause-persistence.integration.test.ts (new)
tests/unit/diagnosis/root-cause-repository.test.ts                              (new)
tests/unit/diagnosis/root-cause-service.test.ts                                 (new)
tests/unit/diagnosis/phase4c-r2-static-guard.test.ts                            (new)
tests/unit/diagnosis/phase4a-static-guard.test.ts                               (modified — directory whitelist)
tests/unit/diagnosis/phase4b-r1-static-guard.test.ts                            (modified — directory whitelist)
tests/unit/diagnosis/phase4c-r1-static-guard.test.ts                            (modified — directory whitelist)
tests/unit/supabase/061-phase3e-chaos-evidence-provenance-guard.test.ts          (modified — 069 pinned, tripwire -> 070)
tests/unit/supabase/065-phase3g-findings-provenance-guard.test.ts                (modified — 069 pinned, tripwire -> 070)
tests/unit/supabase/066-phase3h-read-models-provenance-guard.test.ts             (modified — 069 pinned, tripwire -> 070)
```

Guard modifications are minimal and additive: each adds the exact approved filename and preserves every existing security assertion. No whitelist was loosened and no tripwire deleted.

`handoffs/PHASE-4C-HANDOFF.md` is the **documentation-only 13th current path** being added now.

---

## 19. Database Changes

```text
Migration       = NO
New table       = NO
New column      = NO
New index       = NO
New constraint  = NO
Migration count = 12
Latest          = 20260903000000_phase3g_findings.sql
```

The existing Phase 3G Finding columns were reused exactly as that migration intended — it created the Phase 4 columns specifically so Phase 4 would need no schema change.

**Known schema limitation:** `diagnosis_strength` carries an approved database CHECK restricting it to the three evidence-strength labels. `diagnosis_code` has **no** RC-vocabulary CHECK. The application only ever writes the frozen `RootCauseCode` type, but a future privileged writer could in principle store another string. Non-blocking for 4C, and deliberately **not** a trigger for an unapproved migration now.

---

## 20. R1 Automated Evidence

```text
focused Phase 4C   = 102 / 102
all diagnosis      = 369 / 369
regression group   = 1899 / 1899
complete offline   = 3026 / 3026
typecheck          = PASS
lint               = PASS, 0 errors, 1 known pre-existing warning
build              = PASS
Prettier           = PASS
git diff --check   = PASS
```

No real-Supabase test was required for R1: the classifier is pure and performs no I/O.

---

## 21. R2 Automated Evidence

Results for the persistence implementation, before the logging correction:

```text
focused R2 (repository + service + guard) = 70 / 70
all diagnosis                             = 439 / 439
unit Supabase guards                      = 361 / 361
regression group                          = 1969 / 1969
focused real Supabase 069                 = 11 / 11
full real Supabase                        = 411 / 411
complete offline                          = 3096 / 3096
typecheck                                 = PASS
lint                                      = PASS, 0 errors, 1 known pre-existing warning
build                                     = PASS
Prettier                                  = PASS
git diff --check                          = PASS
```

---

## 22. Logging-Correction Evidence

Final accepted results after the best-effort logging correction:

```text
focused service + R2 guard = 48 / 48
all diagnosis              = 445 / 445
complete offline           = 3102 / 3102
typecheck                  = PASS
lint                       = PASS, 0 errors, 1 known pre-existing warning
Prettier                   = PASS
git diff --check           = PASS
```

The persistence implementation, the 069 suite and the build were unchanged by that correction, so these previously accepted gates were not unnecessarily re-run:

```text
real 069            = 11 / 11
full real Supabase  = 411 / 411
build               = PASS
```

**Mutation proof.** Reverting the best-effort catch to the old rethrow behaviour caused **five of the six** dedicated logging tests to fail (`L-A`, `L-A2`, `L-B`, `L-C`, `L-E`). The corrected source was then restored **byte-identically** (SHA-256 verified) and the scratch backup deleted.

---

## 23. Resource-Contention History

Recorded truthfully rather than omitted.

One focused logging-gate attempt exited 1 with a **worker-spawn failure** before the static-guard file started; the service tests themselves passed 23/23. It was **not** counted as a passing gate. The clean re-run gave **48 / 48**.

Earlier Phase 4C regression and full-suite attempts that did not exit 0 for the same environmental worker-startup reason were likewise never counted as PASS. In every case the cause was resource contention on this machine — at times an unrelated project running its own test suite concurrently — never an assertion failure. Those processes were not killed; the runs were repeated once the machine was free.

**Every final accepted run exited 0.**

---

## 24. Real Supabase 069

```text
scenario                          = C03
data classification               = SYNTHETIC_DEMO
invariant                         = INV-005, result FAIL
merchant correlations             = NULL (order, payment attempt, payment)
fake provider webhook             = NO
Razorpay contacted                = NO
fabricated C03 signature/mutation = NO
```

C03 is subject-free, so it needs no `REAL_RAZORPAY_WEBHOOK` row and its correlations are truthfully NULL. Nothing was fabricated, so the honest classification is `RC-016` / `INSUFFICIENT_EVIDENCE` — which is the point of the proof, not a weakness of it.

Proven: first call `DIAGNOSED`, second call `ALREADY_DIAGNOSED`; the allowed Finding delta is exactly `diagnosis_code`, `diagnosis_strength`, `diagnosed_at`, `updated_at`; the invariant result and chaos run remained field-for-field unchanged; row counts across all nine authoritative tables unchanged; an anon client could neither mutate nor read the Finding under existing RLS; cleanup restored the baseline.

---

## 25. Manual Verification

Complete safe block as printed by the temporary runner (deleted immediately afterwards):

```text
MANUAL_PHASE4C_ROOT_CAUSE
  scenarioId = C03
  dataClassification = SYNTHETIC_DEMO
  invariantId = INV-005
  invariantResult = FAIL
  findingUndiagnosedBefore = true
  diagnosisCode = RC-016
  diagnosisStrength = INSUFFICIENT_EVIDENCE
  outputSource = DETERMINISTIC_RULES
  ruleVersion = DIAG-RULES-V1
  firstPersistenceKind = DIAGNOSED
  secondPersistenceKind = ALREADY_DIAGNOSED
  firstAndSecondClassificationIdentical = true
  originalDiagnosedAtPreserved = true
  originalUpdatedAtPreserved = true
  findingRowIdenticalAfterSecondCall = true
  findingStillOpen = true
  diagnosisSummaryStillNull = true
  recommendationFieldsStillNull = true
  resolvedAtStillNull = true
  nonDiagnosisFieldsUnchanged = true
  invariantResultUnchanged = true
  chaosRunUnchanged = true
  rowCountsChangedByDiagnosis = false
  authoritativeMerchantPaymentStateChanged = false
  invalidIdentifierErrorCode = EVIDENCE_PACK_FINDING_ID_INVALID
  nonexistentFindingErrorCode = EVIDENCE_PACK_FINDING_NOT_FOUND
  secretOrRawEvidenceDetected = false
```

```text
manual verification           = PASS
temporary runner deleted      = YES
cleanup successful            = YES
final census matches baseline = YES
first persistence             = DIAGNOSED
second persistence            = ALREADY_DIAGNOSED
```

---

## 26. Certified Final Census

Observed after cleanup:

```text
orders                    = 11
payment_attempts          = 11
payments                  = 10
fulfilments               = 7
webhook_events            = 16
event_processing_attempts = 20
chaos_runs                = 10
invariant_results         = 12
findings                  = 0

PENDING chaos runs = 0
RUNNING chaos runs = 0
```

These are **cleanup/certification row counts** of test-owned certified fixture data. They are **not merchant-performance metrics** and must never be presented as such. They matched the dynamically captured pre-fixture baseline; no baseline value was hardcoded as a prerequisite.

---

## 27. Security / Authority

- Razorpay **Test Mode** context only; **no real money**.
- **No arbitrary external target** — the classifier and service express no URL, host or endpoint.
- **No Razorpay call in 4C** at all; **no fake provider webhook** created.
- **No secret or raw payload output** — no key, webhook secret, service-role credential, raw body, `raw_body_sha256`, signature value, `fault_config`, `fault_state`, card data or customer PII reaches any 4C output or log line.
- The root-cause **service and repository are `server-only`**; the classifier is pure.
- **Anon cannot write a diagnosis** — proven against the live database under existing RLS; anon could not even read the Finding row.
- **Root-cause classification is advisory**, as are ranking and evidence strength.
- **The invariant result remains authoritative**; payment and order state remain authoritative.
- **`RC-016` does not alter the authoritative invariant `FAIL`.**
- **No AI/ML/LLM** in P0 Phase 4C; **no paid runtime API**.
- **No browser-supplied `diagnosed_at`** — the timestamp is server-generated, once.
- **No automatic payment-code modification** of any kind.

---

## 28. Architectural Decisions

1. Full 16-code frozen taxonomy, with a narrower active R1 subset.
2. Unsupported categories stay inactive rather than being guessed.
3. `RC-016` is a valid fallback result, not an error.
4. Errors are never converted to `RC-016`.
5. Evidence strength, never a confidence percentage.
6. Prose is never evidence.
7. Deterministic candidate ranking with a total order.
8. Relevant-gap discipline for the `RC-016` fallback.
9. Optional RC-002 idempotency-key semantics.
10. RC-010 direct-evidence correction.
11. One Evidence Pack assembly per diagnosis.
12. The frozen pure signal and classifier layers are reused, never re-implemented.
13. The first write touches four Finding columns only.
14. Strict fresh advisory-state guard (all six fields NULL).
15. An equivalent re-diagnosis performs zero mutation.
16. A concurrent loser re-reads once; there is no retry loop.
17. `diagnosis_summary` intentionally deferred.
18. Recommendation fields intentionally deferred.
19. Best-effort audit logging cannot poison a committed persistence result.
20. PostgreSQL and the deterministic invariants remain authoritative.

---

## 29. Known Limitations / Non-Blockers

All **non-blocking for Phase 4C**.

1. **Concurrency race semantics are unit-tested only** — cases D and E use the fake client; the live database was not deliberately raced, since manufacturing a real conflict would mean corrupting it.
2. **A contradictory persisted diagnosis is terminal in 4C.** There is no repair path: it raises and stops. Re-diagnosis after a rule-version migration would need explicit future architectural handling.
3. **No `diagnosis_code` vocabulary CHECK** in the database (Section 19).
4. **Best-effort log loss can be silent** after a successful authoritative write (Section 17).
5. **Pre-existing lint warning** — `tests/integration/supabase/051-chaos-safety-gate.integration.test.ts:354`, unrelated to Phase 4.
6. **Vite native-config forward-compat warning** during integration runs. Cosmetic.
7. **Windows/OneDrive `.next` EPERM** — approved recovery: clear **only** `.next`, retry the build once.
8. **Machine memory/resource contention** — the final heavy suite should run as the sole workload (Section 23).
9. **Phase 4B 068 certified-row coupling** remains a broader Phase 4 test-environment consideration.

---

## 30. Deferred Work

| Phase  | Deferred work                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **4D** | Deterministic recommended fixes; recommendation catalogue; recommendation persistence; approved template remediation/explanation work |
| **4E** | Regression engine; `RESOLVED` / `STILL_FAILING` lifecycle                                                                             |
| **4F** | Reliability Score                                                                                                                     |
| **4G** | Go-Live Readiness                                                                                                                     |
| **4H** | Optional P1 AI/ML differentiators                                                                                                     |

`findings.diagnosis_summary` also remains intentionally unpopulated by Phase 4C.

None of the above is implemented.

---

## 31. Phase 4D Starting Contract

Phase 4D is **Recommended Fixes** — mapping diagnosis categories to deterministic engineering recommendations (`docs/PHASE_PLAN.md` Section 8.7).

**Authoritative inputs:**

```text
the persisted Finding diagnosis (diagnosis_code, diagnosis_strength, diagnosed_at)
+ the selected deterministic root-cause code
+ the evidence strength
+ RootCauseClassificationV1 and its evidence references, where explanation needs evidence grounding
```

**Phase 4D must begin with a READ-ONLY architect audit**, as 4A, 4B and 4C did.

**4D may:**

- map an approved RC category to an approved deterministic recommendation;
- define a typed recommendation catalogue;
- generate deterministic P0 recommendation output;
- persist only the already-approved Finding recommendation fields, **if** architect review approves the exact persistence rules;
- later produce template explanation consistent with the evidence.

**4D may NOT:**

- change `diagnosis_code`, `diagnosis_strength` or `diagnosed_at`;
- change the invariant result;
- change payment or order state;
- mark a Finding `RESOLVED`;
- start regression;
- calculate score or readiness;
- use an LLM as recommendation authority.

Recommendation output must remain **advisory**, and no paid runtime LLM API is required.

Contracts 4D must not break: `ROOT_CAUSE_CLASSIFICATION_VERSION = 1`; `DIAG-RULES-V1`; `DETERMINISTIC_RULES`; the 16-code taxonomy and the active/inactive split; the three strengths and five tiers; the four-column write scope; the strict freshness guard; and the purity of the classifier.

---

## 32. Phase 4 Acceptance Summary

Mapping Phase 4C to the Phase 4 acceptance criteria (`docs/PHASE_PLAN.md` Section 8.16). **Full Phase 4 acceptance is NOT complete.**

| Criterion               | Status                                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P4-AC-01**            | Already supported by Phase 4A; Phase 4C consumes that evidence through the single approved surface.                                                                                            |
| **P4-AC-02**            | **Supported** for failures with an approved _active_ deterministic evidence mapping. Unsupported taxonomy categories are **not** classified — they fall to `RC-016` rather than being guessed. |
| **P4-AC-03**            | **Supported.** The classification carries the persisted Evidence Pack references verbatim, plus explicit supporting, contradictory and blocking-gap signal metadata.                           |
| **P4-AC-04**            | **Supported.** `RC-016` / `INSUFFICIENT_EVIDENCE` is explicit and persisted, and errors are never converted to it.                                                                             |
| **P4-AC-05**            | **NOT complete** — belongs to Phase 4D.                                                                                                                                                        |
| **P4-AC-06 … P4-AC-14** | **NOT complete** — 4D–4G as appropriate.                                                                                                                                                       |
| **P4-AC-15**            | **Satisfied for 4C.** No paid LLM API and no runtime AI required.                                                                                                                              |

---

## Appendix — Where to Look

| Concern                          | File                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| Pure root-cause classifier       | `lib/diagnosis/root-cause-classifier.ts`                                                       |
| Diagnosis persistence repository | `lib/diagnosis/root-cause-repository.ts`                                                       |
| Diagnosis orchestration service  | `lib/diagnosis/root-cause-service.ts`                                                          |
| Evidence Pack (Phase 4A)         | `lib/diagnosis/evidence-pack.ts`, `lib/diagnosis/evidence-pack-service.ts`                     |
| Signal extractor (Phase 4B)      | `lib/diagnosis/diagnostic-signals.ts`, `lib/diagnosis/diagnostic-signals-service.ts`           |
| R1 classifier tests              | `tests/unit/diagnosis/root-cause-classifier.test.ts` (76 cases)                                |
| R2 repository tests              | `tests/unit/diagnosis/root-cause-repository.test.ts` (28 cases)                                |
| R2 service tests                 | `tests/unit/diagnosis/root-cause-service.test.ts` (23 cases)                                   |
| R1 static guard                  | `tests/unit/diagnosis/phase4c-r1-static-guard.test.ts` (26 cases)                              |
| R2 static guard                  | `tests/unit/diagnosis/phase4c-r2-static-guard.test.ts` (25 cases)                              |
| Real Supabase proof              | `tests/integration/supabase/069-phase4c-root-cause-persistence.integration.test.ts` (11 cases) |
| Prior sub-phases                 | `handoffs/PHASE-4A-HANDOFF.md`, `handoffs/PHASE-4B-HANDOFF.md`                                 |

Case counts are `it(...)` blocks counted directly from the current files; some blocks assert several logical cases, so these are not the same as Vitest run totals reported elsewhere in this document.
