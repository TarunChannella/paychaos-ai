# PayChaos AI — Phase 4B Handoff

Internal sub-phase handoff for **Phase 4B — Deterministic Signal Extraction** (`docs/PHASE_PLAN.md` Section 8.7).

This is not the Phase 4 handoff. `handoffs/PHASE-4-HANDOFF.md` belongs to the end of the whole phase, once 4A–4G P0 work is complete, and is deliberately not created here.

```text
IMPLEMENTED             = YES
TESTED                  = YES
MANUALLY VERIFIED       = YES
DOCUMENTED              = YES
ARCHITECT APPROVAL      = PENDING FINAL REVIEW
```

Phase 4 as a whole is **not** complete. Root-cause classification, recommendations, regression, Reliability Score and Go-Live Readiness all remain unimplemented and belong to 4C and later.

---

## 1. Phase 4B Objective

Phase 4B converts the approved Phase 4A Evidence Pack into deterministic, versioned, advisory **technical signals**:

```text
Finding
  -> DiagnosisEvidencePackV1        (Phase 4A, frozen)
    -> extractDiagnosticSignals()   (Phase 4B-R1, pure)
      -> DiagnosticSignalSetV1
```

It **stops there**, deliberately and completely. Phase 4B contains no root-cause classification, no `RC-` code, no evidence-strength judgement, no recommendation, no regression logic, no score and no readiness rule (`docs/AI_DESIGN.md` Sections 14–40).

Properties of the whole sub-phase:

- **No LLM.** No prompt, no model, no provider client.
- **No ML.** No training, no inference, no scikit-learn.
- **No runtime AI of any kind.** P0 works with zero AI services available.
- **Deterministic.** The same pack always yields a deep-equal signal set. No clock, no randomness, no identifier generation.
- **Read-only.** Zero INSERT / UPDATE / UPSERT / DELETE and zero mutating RPC.
- **The invariant result remains authoritative.** Signals are advisory observations about evidence; they cannot change a PASS/FAIL verdict, and nothing in 4B writes a diagnosis field.

The signal set is a **derived, in-memory** structure. It is never persisted.

---

## 2. Completion State

```text
IMPLEMENTED             = YES
TESTED                  = YES
MANUALLY VERIFIED       = YES
DOCUMENTED              = YES
ARCHITECT APPROVAL      = PENDING FINAL REVIEW
```

Not approved. Final architect documentation review, the R2 commit and the branch push are all still outstanding.

---

## 3. Phase 4B Internal Structure

Phase 4B used **two implementation rounds**, mirroring the 4A pattern.

### 4B-R1 — Pure deterministic signal extraction

`lib/diagnosis/diagnostic-signals.ts`. Zero runtime imports (every import is `import type`), so the module is pure and can never reach a database, network, clock or AI provider. It also carries the fulfilment idempotency-key **evidence compatibility** work described in Section 7.

Committed as `07bb45a884ca3f0a59d962ae766ca625f56824ea`.

### 4B-R2 — Server-side orchestration

`lib/diagnosis/diagnostic-signals-service.ts`. Server-only composition of the approved Phase 4A evidence service and the frozen R1 extractor, plus real-Supabase verification (`068-phase4b-diagnostic-signals.integration.test.ts`).

Currently uncommitted.

---

## 4. Frozen Signal Contract

```text
DIAGNOSTIC_SIGNAL_VERSION = 1
```

Exactly three states, deliberately not a boolean:

| State     | Meaning                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| `PRESENT` | Structured evidence deterministically **proves** the pattern.                                               |
| `ABSENT`  | Evidence was **sufficient** AND proves the pattern is not there.                                            |
| `UNKNOWN` | Required evidence is missing, incomplete, historically unavailable, or too contradictory to resolve safely. |

**Missing evidence MUST NOT become `ABSENT`.**

`ABSENT` is a positive claim about sufficiency, not a default. Anything weaker is `UNKNOWN` (`docs/MONEY_INVARIANTS.md` Principle 3 — Fail Safely; Rule MI-SAFE-009 — UNKNOWN Over Guessing). `UNKNOWN` is not a verdict and not a failure; it is the honest answer.

Each observation carries `code`, `state`, and `blockingGapCodes` — narrow deterministic metadata naming only the Phase 4A pack gaps that are both present and relevant to that signal, reported only when the state is `UNKNOWN`. Never free text, never a probability, never a diagnosis.

---

## 5. Frozen Signal Vocabulary

Exactly thirteen codes, always emitted in this order:

```text
 1. DUPLICATE_EVENT_ATTEMPTS
 2. DUPLICATE_FULFILMENTS
 3. DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS
 4. SAME_LOGICAL_PAYMENT
 5. INVALID_SIGNATURE_MUTATED_STATE
 6. CLIENT_CONFIRMATION_MISSING
 7. PAYMENT_CAPTURED_VIA_WEBHOOK
 8. CAPTURE_EXISTS_ORDER_NOT_PAID
 9. FAILURE_EVENT_MARKED_PAID
10. OUT_OF_ORDER_STATE_REGRESSION
11. REPLAY_CHANGED_FINAL_STATE
12. AMOUNT_MISMATCH
13. CURRENCY_MISMATCH
```

Phase 4B **production executable logic** does not implement, emit or persist any root-cause code. Root-cause classification belongs to Phase 4C (`docs/AI_DESIGN.md` Section 16). Static-guard and test source may mention RC vocabulary **only as forbidden tokens**, used to assert that production code does not contain it — that is how the boundary is protected, not a violation of it.

---

## 6. Evidence Authority Rules

These rules were established across successive architect review rounds. Each closes a case where the implementation could claim more than the supplied evidence supported. They are frozen.

- **Prose is never evidence.** Scenario id, invariant id, Finding title, and evaluator `expectedSummary` / `observedSummary` / `reason` can never make a signal `PRESENT`. `scenarioId` and `invariantId` may gate whether a scenario-specific signal is _applicable_, but neither proves presence.
- **Incomplete correlation is not authoritative merchant capture.** `INCOMPLETE_INTERNAL_CORRELATION` cannot explain a merchant order's state.
- **Provider-event existence and merchant-state capture authority are distinct questions**, answered by two separate helpers. A capture whose internal correlation is incomplete still proves the provider webhook existed.
- **A null correlation is not a wildcard.** A missing Finding correlation is evidence _absence_; it narrows what may be claimed and must never be read as "matches anything". Signals asserting a fact about a specific merchant order require `correlations.orderId`.
- **No "last snapshot wins".** Final merchant state uses after-states only, filtered to the correlated order, with no timestamp or array-position authority.
- **Conflicting or incomplete evidence becomes `UNKNOWN`**, never an arbitrary pick.
- **Money consistency requires a complete correlated path** — order **and** payment attempt **and** payment inside one snapshot, relationally joined and matching every non-null correlation. Two observations of the same order are not a comparison.
- **Replay compares the full protected business-state tuple** (order payment/business status, amount, currency; payment `capturedAt`, `failedAt`, Razorpay status, amount, currency; payment-attempt status; fulfilment count **and** sorted distinct ids) — not merely one status.
- **Duplicate-effect `ABSENT` requires after-state completeness.** A duplicate is directly observable from either side, but "at most one effect remains" is a claim about a resulting state, so every relevant processing attempt needs a usable `stateAfter`.
- **All duplicate observations are evaluated**, never the first convenient one. Assembly order must not decide a signal.
- **Transition `ABSENT` requires sufficient transition evidence across every relevant processing attempt.** An attempt whose transition was never observed cannot be silently dropped so a neighbour's clean pair can produce `ABSENT`.
- **A proven violation dominates unrelated incompleteness.** The reverse never holds.
- **Missing evidence cannot prove absence.**

---

## 7. Fulfilment Idempotency-Key Compatibility

```text
Database migration required = NO
```

The database column `fulfilments.idempotency_key` **already existed** (Phase 1 foundation schema, `NOT NULL`, `UNIQUE`). Phase 4B-R1 added it to the **safe read projection** in `lib/evidence/evidence-repository.ts` and to the snapshot model in `lib/evidence/merchant-state-snapshot.ts`. No schema change of any kind.

- **Newly captured snapshots** expose the actual persisted idempotency key.
- **Historical snapshots** captured before the projection existed remain valid — they are never re-parsed as `INVALID` merely because the property is absent.
- A missing historical property normalizes to `null` / unavailable, meaning **"not captured in this historical snapshot"** — explicitly _not_ "the database value was NULL". The column is `NOT NULL`, so the latter reading would be a false statement about persisted data.
- **The key is NEVER reconstructed from `orderId`**, never defaulted, never inferred. When it is unavailable, `DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS` reports `UNKNOWN` rather than guessing.

The field is declared **optional** rather than required on `MerchantStateSnapshotFulfilmentV1`. That was deliberate: making it required would have forced edits to `lib/chaos/c03-mutation-snapshot.ts` and `lib/chaos/c03-mutation-snapshot-repository.ts`, which construct the same shape and were outside the authorized Phase 4B scope. Tightening it remains available if the architect wants it.

---

## 8. R2 Server Orchestration

The exact production flow:

```text
assembleDiagnosticSignalsForFinding(findingId)
  -> assembleDiagnosisEvidencePackForFinding(findingId)   (Phase 4A-R2)
    -> extractDiagnosticSignals(pack)                     (Phase 4B-R1, pure)
      -> DiagnosticSignalSetV1
```

The whole module is one read and one pure derivation:

```ts
export async function assembleDiagnosticSignalsForFinding(
  findingId: string,
): Promise<DiagnosticSignalSetV1> {
  const pack = await assembleDiagnosisEvidencePackForFinding(findingId);
  return extractDiagnosticSignals(pack);
}
```

Guarantees:

- **Server-only.** `import "server-only"` is the first statement.
- **Read-only.** No mutating call, no write-capable function named, no diagnosis column touched.
- **No direct database reads in the new signal service.** It never queries `orders`, `payment_attempts`, `payments`, `fulfilments`, `webhook_events`, `event_processing_attempts`, `chaos_runs`, `invariant_results` or `findings`.
- **No second evidence model.** The Phase 4A service is the single evidence surface; a second reader would be a second version of the truth.
- **No signal rule is reimplemented.** The static guard forbids any of the thirteen codes or three states appearing in the service.
- **Phase 4A errors propagate unchanged** — the identical error instance, not wrapped and not re-coded: `EVIDENCE_PACK_FINDING_ID_INVALID`, `EVIDENCE_PACK_FINDING_NOT_FOUND`, `EVIDENCE_PACK_INVARIANT_RESULT_NOT_FOUND`, `EVIDENCE_PACK_INTEGRITY_CONFLICT`, `EVIDENCE_PACK_READ_FAILED`. No new error vocabulary was invented, because none was needed.
- **Read failures are never converted to `UNKNOWN` signals.** There is no `catch` and no substituted empty result. Rewriting an infrastructure failure as thirteen `UNKNOWN` states would present a failed read as an honest, evidence-based observation.

The Finding remains the entry boundary (`docs/AI_DESIGN.md` Section 10): signals cannot be requested for an arbitrary payment or order identifier.

---

## 9. Files Changed

### Phase 4B-R1 — committed

Commit `07bb45a884ca3f0a59d962ae766ca625f56824ea` — `feat: add phase 4b deterministic diagnostic signals` (8 files, +3881 / −12):

```text
lib/diagnosis/diagnostic-signals.ts
lib/evidence/chaos-run-evidence.ts
lib/evidence/evidence-repository.ts
lib/evidence/merchant-state-snapshot.ts
tests/unit/diagnosis/diagnostic-signals.test.ts
tests/unit/diagnosis/phase4a-static-guard.test.ts
tests/unit/diagnosis/phase4b-r1-static-guard.test.ts
tests/unit/evidence/merchant-state-snapshot.test.ts
```

### Phase 4B-R2 — currently uncommitted (9 paths)

```text
lib/diagnosis/diagnostic-signals-service.ts                              (new, production)
tests/integration/supabase/068-phase4b-diagnostic-signals.integration.test.ts  (new)
tests/unit/diagnosis/diagnostic-signals-service.test.ts                  (new)
tests/unit/diagnosis/phase4b-r2-static-guard.test.ts                     (new)
tests/unit/diagnosis/phase4a-static-guard.test.ts                        (modified — directory whitelist)
tests/unit/diagnosis/phase4b-r1-static-guard.test.ts                     (modified — directory whitelist)
tests/unit/supabase/061-phase3e-chaos-evidence-provenance-guard.test.ts   (modified — 068 pinned, tripwire -> 069)
tests/unit/supabase/065-phase3g-findings-provenance-guard.test.ts         (modified — 068 pinned, tripwire -> 069)
tests/unit/supabase/066-phase3h-read-models-provenance-guard.test.ts      (modified — 068 pinned, tripwire -> 069)
```

The guard modifications are minimal and additive: each adds the exact approved filename and preserves every existing security assertion. No whitelist was loosened to accept arbitrary files, no tripwire was deleted, and no Phase 1–3 production file was touched.

`handoffs/PHASE-4B-HANDOFF.md` is the **documentation-only tenth path** being added now.

---

## 10. Database Changes

```text
Migration          = NO
New table          = NO
New column         = NO
Constraint change  = NO
Index change       = NO
```

Twelve migrations, unchanged, latest still `20260903000000_phase3g_findings.sql`.

The only database-facing change in the whole of Phase 4B is an approved **safe SELECT/projection expansion**: `fulfilments.idempotency_key` was added to the existing read projection. The schema itself is untouched.

---

## 11. Automated Verification

### Phase 4B-R1 final (at commit `07bb45a`)

```text
focused diagnostic signals         = 107 / 107
all diagnosis                      = 232 / 232   (6 files)
regression group                   = 1762 / 1762 (52 files)
complete offline                   = 2889 / 2889 (107 files), exit 0
typecheck                          = PASS
lint                               = PASS, 0 errors, 1 known pre-existing warning
build                              = PASS after approved .next-only OneDrive EPERM recovery
Prettier                           = PASS
git diff --check                   = PASS
```

### Phase 4B-R2 final

```text
focused R2 service + static guard  = 35 / 35     (2 files)
all diagnosis                      = 267 / 267   (8 files)
regression group                   = 1797 / 1797 (54 files)
focused real Supabase 068          = 15 / 15     (1 file)
full permanent real Supabase       = 400 / 400   (29 files)
complete offline (accepted run)    = 2924 / 2924 (109 files), exit 0
typecheck                          = PASS
lint                               = PASS, 0 errors, 1 known pre-existing warning
build                              = PASS
Prettier                           = PASS
git diff --check                   = PASS
```

**Runs that did not exit 0 were not counted as passing gates.** During R2 verification, two full-offline invocations failed for environmental reasons and were explicitly rejected rather than reported as green:

1. One run aborted with 21 worker-spawn timeouts (88 files started, 2511 passed) under severe memory pressure.
2. One run had a single timeout failure in `tests/unit/api/access-login-route.test.ts` — a file untouched by Phase 4B, which passes 10/10 in isolation.

The root cause was resource contention: a concurrent `vitest run` and `next start` from an unrelated project on the same machine drove free memory to ~75 MB of 7877 MB. Those processes were **not** killed. Once they exited on their own, the suite ran clean on the first attempt. The **final accepted offline invocation exited 0** with 109 files / 2924 tests and zero errors.

---

## 12. Real Supabase Evidence

`tests/integration/supabase/068-phase4b-diagnostic-signals.integration.test.ts` — 15 tests, all passing against the live project.

```text
scenario                        = C03
data_classification             = SYNTHETIC_DEMO
invariant                       = INV-005, result FAIL
order/payment correlations      = null (orderId, paymentAttemptId, paymentId)
provider webhook row fabricated = NO
Razorpay contacted              = NO
signal count                    = 13
```

C03 is chosen precisely because it is subject-free: its three merchant correlations are truthfully `NULL` and it needs no `REAL_RAZORPAY_WEBHOOK` row to exist. The fixture creates only a test-owned chaos run, invariant result, and the Finding derived through the frozen Phase 3G service — no `orders`, `payment_attempts`, `payments`, `fulfilments`, `webhook_events` or `event_processing_attempts` row.

Proven:

- Missing structured C03 evidence remained **`UNKNOWN`**. No verification fact was fabricated to force a dramatic `PRESENT`.
- Operation-before census **equalled** operation-after census across all nine authoritative tables.
- Finding, invariant-result and chaos-run rows stayed **unchanged**, compared field by field.
- Finding advisory fields stayed **NULL**: `diagnosis_code`, `diagnosis_strength`, `diagnosis_summary`, `recommendation_code`, `recommendation_text`, `diagnosed_at`; `status` still `OPEN`.
- The service result equalled the direct approved composition, and a repeated call was deep-equal.
- Error paths verified live: absent Finding → `EVIDENCE_PACK_FINDING_NOT_FOUND`; invalid id → `EVIDENCE_PACK_FINDING_ID_INVALID`; each with an unchanged census.

Cleanup deletes exact UUIDs only, children before parents, and the final census is compared against the baseline taken before any fixture existed.

---

## 13. Real Idempotency-Key Proof

R1's unit tests proved historical compatibility. R2 adds the other half: a **real Supabase read proof** that a genuinely persisted key is projected exactly.

**Option B (read-only against existing certified rows) was used.** The straightforward self-contained Option A fixture path was rejected because constructing the required snapshot-readable processing chain without reusing existing certified provider evidence would require fabricating or misrepresenting provider-webhook provenance. The already-authorized Option B — a read-only proof against existing certified fulfilment evidence — was therefore the safer and narrower verification.

The relevant schema constraints, checked directly rather than assumed:

- `event_processing_attempts.source_kind` permits only `REAL_RAZORPAY_WEBHOOK` and `PAYCHAOS_REPLAY`;
- **both** constraints (`event_processing_attempts_real_webhook_requires_event`, `event_processing_attempts_replay_provenance_valid`) require a non-null `webhook_event_id`;
- `webhook_events.source_kind` is CHECK-fixed to `REAL_RAZORPAY_WEBHOOK`.

So a self-contained fixture chain built from scratch would have had to introduce a `webhook_events` row of its own, which is exactly the provider-provenance fabrication that is forbidden. This documents why that particular path was rejected; it is not a claim that no other fixture construction could ever be devised.

Instead, test 15 reads existing certified fulfilment rows, calls the real approved path `captureMerchantStateSnapshotForProcessingAttempt(...)`, and asserts the safe projected `idempotencyKey` equals the persisted `fulfilments.idempotency_key` **exactly**, together with a matching `orderId`. Nothing is reconstructed and nothing is inferred from `orderId`.

The test **intentionally fails rather than silently passing** if no certified suitable row exists — a projection that cannot be proven must not be reported as proven. This is a known **test-environment coupling**: it depends on at least one certified fulfilment row with a trigger processing attempt remaining in the project (7 such rows exist today).

---

## 14. Manual Verification

Performed with a temporary real-Supabase runner (`tests/integration/supabase/phase4b-manual.tmp.integration.test.ts`), deleted immediately afterwards. Same fixture shape as 068: C03, `SYNTHETIC_DEMO`, INV-005 FAIL, Finding created through the frozen production path.

```text
MANUAL_PHASE4B_DIAGNOSTIC_SIGNALS
  scenarioId          = C03
  dataClassification  = SYNTHETIC_DEMO
  invariantId         = INV-005
  invariantResult     = FAIL
  signalVersion       = 1
  signalCount         = 13

  DUPLICATE_EVENT_ATTEMPTS              = ABSENT
  DUPLICATE_FULFILMENTS                 = UNKNOWN
  DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS = UNKNOWN
  SAME_LOGICAL_PAYMENT                  = UNKNOWN
  INVALID_SIGNATURE_MUTATED_STATE       = UNKNOWN
  CLIENT_CONFIRMATION_MISSING           = UNKNOWN
  PAYMENT_CAPTURED_VIA_WEBHOOK          = UNKNOWN
  CAPTURE_EXISTS_ORDER_NOT_PAID         = UNKNOWN
  FAILURE_EVENT_MARKED_PAID             = UNKNOWN
  OUT_OF_ORDER_STATE_REGRESSION         = UNKNOWN
  REPLAY_CHANGED_FINAL_STATE            = UNKNOWN
  AMOUNT_MISMATCH                       = UNKNOWN
  CURRENCY_MISMATCH                     = UNKNOWN

  repeatedCallIdentical             = true
  directCompositionIdentical        = true
  findingStillOpen                  = true
  diagnosisFieldsStillNull          = true
  recommendationFieldsStillNull     = true
  reliabilityScorePresent           = false
  readinessPresent                  = false
  secretOrRawEvidenceDetected       = false
  operationDatabaseMutationDetected = false
```

```text
Manual verification          = PASS
Temporary runner deleted     = YES
Cleanup successful           = YES
Final census matches baseline = YES
```

Twelve `UNKNOWN` states is the correct outcome, not a weakness: a minimal C03 fixture genuinely cannot establish those patterns, and the system said so rather than manufacturing a finding. The single `ABSENT` is a real positive claim — the pack's attempt counts establish that no repeated processing occurred.

**The first temporary invocation failed.** Its _temporary verifier_ incorrectly banned the generic substring `"regression"`, which legitimately occurs inside the frozen signal code `OUT_OF_ORDER_STATE_REGRESSION`.

**This was a verifier assertion defect, not a production-signal defect.** The temporary assertion was corrected to ban the actual Phase 4E regression-engine field names (`regression_runs`, `regressionRun`, `regressionRunId`, `regressionTest`, `retest`) instead of the bare word; production output was not touched and the underlying requirement was not weakened. The rerun passed, and the temporary file was deleted.

---

## 15. Final Certified Database Census

Observed dynamically after cleanup, and matching the pre-fixture baseline exactly:

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

These are **row counts of test-owned certified fixture data**, captured for cleanup verification. They are **not merchant performance metrics** and must never be presented as such. No baseline value was hardcoded as a prerequisite; the authoritative check is `final census == baseline captured before the fixture`.

---

## 16. Security / Authority

- **Razorpay Test Mode context only.** No live-mode path exists.
- **No real money.** No payment was created, captured, refunded or modified.
- **No arbitrary external target.** The service expresses no URL, host or endpoint.
- **No new Razorpay call in 4B.** Phase 4B contacts no Razorpay surface at all.
- **No fake provider webhook.** No `REAL_RAZORPAY_WEBHOOK` row was created, and the C03 fixture is designed so none is needed.
- **No secret or raw payload output.** No key, webhook secret, service-role credential, raw body, `raw_body_sha256`, signature value, header name, `fault_config`, `fault_state`, card data or customer PII reaches the signal set. Verified by explicit token bans plus opaque hex/base64 blob regexes in unit, integration and manual checks.
- **The browser cannot mutate authoritative state.** No API route or UI surface was added; the signal service is unreachable from a client bundle.
- **The signal service is server-only** (`import "server-only"`), and the R1 extractor is pure with zero runtime imports.
- **No runtime AI/LLM.** P0 signal extraction works with zero AI services available.
- **Signals are advisory.** The deterministic invariant result stays authoritative.
- **Phase 4B never writes diagnosis fields.** `diagnosis_code`, `diagnosis_strength`, `diagnosis_summary`, `recommendation_code`, `recommendation_text` and `diagnosed_at` are untouched and remain 4C/4D territory.

---

## 17. Architect Decisions

1. **Tri-state signals instead of booleans.** A boolean cannot distinguish "proved absent" from "could not tell", which is exactly the distinction that prevents false findings.
2. **One Evidence Pack surface.** All persisted facts reach the rules through Phase 4A.
3. **No second database reader.** The R2 service performs zero queries of its own.
4. **No migration.** Phase 4B changes no schema.
5. **Historical idempotency compatibility preserved.** Old snapshots stay valid; a missing key is unavailable, never reconstructed.
6. **Scenario metadata may gate applicability but cannot prove a technical signal.** `scenarioId` / `invariantId` decide whether a scenario-specific rule applies; only structured evidence can make it `PRESENT`.
7. **No last-state-wins.** Array position and timestamps carry no authority.
8. **Missing evidence never becomes `ABSENT`.**
9. **A proven pattern dominates unrelated incompleteness; the reverse never holds.**
10. **All qualifying observations are evaluated**, so assembly order cannot decide a result.
11. **4C owns root-cause classification.** Phase 4B ends at `DiagnosticSignalSetV1`.
12. **No AI required for P0.**

---

## 18. Known Issues / Non-Blockers

All of the following are **non-blocking for Phase 4B**.

1. **Pre-existing lint warning** — `tests/integration/supabase/051-chaos-safety-gate.integration.test.ts:354`, unused eslint-disable directive. Predates Phase 4 and is unrelated.
2. **Vite native-config forward-compat warning** during real-Supabase runs (`import "./tests/integration/supabase/sequencer" without a file extension`). Cosmetic.
3. **Windows/OneDrive `.next` EPERM build issue.** Approved recovery: clear **only** `.next` and retry the build once. Encountered and recovered during R1; did not occur in the final R2 build.
4. **Machine memory/resource contention.** The full offline suite should be run as the sole heavy workload (7877 MB total, ~200 MB free when idle). Worker-timeout and resource-contention runs are **never** counted as PASS; see Section 11.
5. **Real idempotency projection test coupling.** Test 15 in 068 depends on at least one suitable certified fulfilment row remaining in the test database. It fails loudly rather than silently passing if none exists.
6. **Fulfilment `idempotencyKey` is optional, not required**, on the snapshot model — see Section 7 for why, and what tightening it would cost.

---

## 19. Deferred Work

Explicitly deferred and **not implemented**:

| Phase  | Deferred work                                                                    |
| ------ | -------------------------------------------------------------------------------- |
| **4C** | Deterministic root-cause classification; `RC-001` … `RC-016`; diagnosis strength |
| **4D** | Recommendations                                                                  |
| **4E** | Regression engine                                                                |
| **4F** | Reliability Score                                                                |
| **4G** | Go-Live Readiness                                                                |
| **4H** | Optional P1 AI differentiators                                                   |

No deferred Phase 4C+ vocabulary is **implemented in Phase 4B production executable logic**. Static guards may intentionally contain those strings as forbidden-token assertions, which is precisely how the boundary is enforced.

---

## 20. Phase 4C Starting Contract

**Input:**

```text
DiagnosisEvidencePackV1   (Phase 4A, frozen)
+
DiagnosticSignalSetV1     (Phase 4B, frozen — version 1, 13 codes, tri-state)
```

**Phase 4C may:**

- apply deterministic, ordered diagnosis rules over those two inputs;
- rank candidate root causes by an approved deterministic precedence;
- reference the supporting evidence and signals behind each candidate.

**Phase 4C may NOT:**

- change invariant truth — the deterministic result stays authoritative;
- invent missing evidence, or treat `UNKNOWN` as a convenient PASS or FAIL;
- use the scenario alone as a root cause;
- use an LLM as authority.

**Phase 4C must use** the frozen taxonomy `RC-001` … `RC-016` from `docs/AI_DESIGN.md` Section 16 — including `RC-016 INSUFFICIENT_EVIDENCE`, which is the correct answer when the signals cannot support any other classification.

**Phase 4C must begin with a READ-ONLY architect audit before implementation**, as 4A and 4B did.

Contracts 4C must not break: `DIAGNOSTIC_SIGNAL_VERSION = 1`; the thirteen codes and their fixed emission order; the three states and their meanings; the purity of `lib/diagnosis/diagnostic-signals.ts`; the single evidence surface; and the read-only, no-migration posture.

---

## 21. Phase 4B Acceptance Summary

Mapping completed Phase 4B work to the Phase 4 acceptance criteria it supports (`docs/PHASE_PLAN.md` Section 8.16). **Full Phase 4 acceptance is NOT complete.**

| Criterion    | Status for Phase 4B                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P4-AC-01** | **Supported.** Evidence exists from 4A and is consumed safely by 4B through the single approved surface, verified against the live database.                              |
| **P4-AC-02** | **NOT yet complete.** Root-cause classification belongs to 4C. Phase 4B produces technical signals only, and no `RC-` code.                                               |
| **P4-AC-03** | **NOT yet complete.** Diagnosis does not exist yet. 4B does carry `blockingGapCodes`, which 4C can cite as supporting evidence.                                           |
| **P4-AC-04** | **Supported.** The `UNKNOWN` / insufficient-evidence discipline is enforced throughout: missing evidence is reported, never hallucinated and never converted to `ABSENT`. |
| **P4-AC-15** | **Satisfied for 4B.** No paid LLM API, no ML, no runtime AI of any kind.                                                                                                  |

All other criteria (P4-AC-05 through P4-AC-14) remain outstanding and belong to 4D–4G.

---

## Appendix — Where to Look

| Concern                     | File                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| Signal rules (pure)         | `lib/diagnosis/diagnostic-signals.ts`                                                     |
| Server orchestration        | `lib/diagnosis/diagnostic-signals-service.ts`                                             |
| Evidence pack (Phase 4A)    | `lib/diagnosis/evidence-pack.ts`, `lib/diagnosis/evidence-pack-service.ts`                |
| Snapshot projection         | `lib/evidence/merchant-state-snapshot.ts`, `lib/evidence/evidence-repository.ts`          |
| Historical snapshot parsing | `lib/evidence/chaos-run-evidence.ts`                                                      |
| Signal semantics tests      | `tests/unit/diagnosis/diagnostic-signals.test.ts` (107)                                   |
| Orchestration tests         | `tests/unit/diagnosis/diagnostic-signals-service.test.ts` (14 Vitest tests)               |
| Purity / scope guards       | `tests/unit/diagnosis/phase4b-r1-static-guard.test.ts`, `phase4b-r2-static-guard.test.ts` |
| Real Supabase proof         | `tests/integration/supabase/068-phase4b-diagnostic-signals.integration.test.ts` (15)      |
| Prior sub-phase             | `handoffs/PHASE-4A-HANDOFF.md`                                                            |

14 orchestration tests + 21 R2 static-guard tests = the 35 focused R2 tests recorded in Section 11. The orchestration file's case labels run to 16 because one label (`6-10`) covers five logical error-propagation cases inside a single Vitest test.
