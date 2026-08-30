# PayChaos AI — Phase 4A Handoff

Internal sub-phase handoff for **Phase 4A — Evidence Packs**.

This is not the Phase 4 handoff. `handoffs/PHASE-4-HANDOFF.md` belongs to the end of the whole phase, once 4A–4G P0 work is complete, and is deliberately not created here.

```text
IMPLEMENTED             = YES
TESTED                  = YES
MANUALLY VERIFIED       = YES
DOCUMENTED              = YES
ARCHITECT APPROVAL      = PENDING FINAL REVIEW
```

---

## 1. Phase 4A Objective

Phase 4A builds the structured, deterministic, read-only input that later diagnosis phases consume:

```text
Finding
  -> the persisted FAIL invariant result it reports
    -> safe deterministic evidence from the frozen Phase 3 assembler
      -> DiagnosisEvidencePackV1
```

It **stops there**, deliberately and completely. Phase 4A contains no deterministic signal extraction, no root-cause classification, no evidence-strength judgement, no recommendation, no regression logic, no Reliability Score and no Go-Live Readiness rule. Those belong to 4B and later (`docs/AI_DESIGN.md` Sections 9–14; `docs/PHASE_PLAN.md` Section 8.7).

The pack is a **derived, in-memory** structure. It is never persisted.

---

## 2. Completion State

| Round | Content                                                | State                             |
| ----- | ------------------------------------------------------ | --------------------------------- |
| R1    | Evidence Pack domain contract + pure builder           | completed, committed at `146c216` |
| R2    | Server-only orchestration + real-Supabase verification | completed, currently uncommitted  |

```text
IMPLEMENTED        = YES
TESTED             = YES
MANUALLY VERIFIED  = YES
DOCUMENTED         = YES
APPROVED           = PENDING ARCHITECT REVIEW
```

---

## 3. R1 — Pure Evidence Pack

**File:** `lib/diagnosis/evidence-pack.ts`

Exports `DiagnosisEvidencePackV1`, the frozen version constant `DIAGNOSIS_EVIDENCE_PACK_VERSION = 1`, a typed error model, a typed gap vocabulary and the pure builder `buildDiagnosisEvidencePack(input)`.

### Entry gate and integrity

- A Finding **and** the exact persisted invariant-result facts (`id` + `result`) are both required. `FindingDetail` deliberately does not carry `result`, and was not widened; supplying it separately lets the builder verify the gate itself rather than trusting its caller.
- `PASS` is rejected. `UNKNOWN` is rejected. Only a persisted `FAIL` can become a diagnosis input (`docs/MONEY_INVARIANTS.md` Section 50; `docs/AI_DESIGN.md` Section 10).
- Finding/invariant identity is validated: the supplied result id must equal `finding.invariantResultId`.
- Chaos-run compatibility is validated: a supplied bundle must belong to the Finding's correlated run. Evidence from two different runs is never combined.

### Evidence and gaps

- Persisted evidence references are preserved **verbatim** in the persisted vocabulary. They are never renamed, rewritten or dropped, resolved or not.
- Resolution is **kind-aware**: each reference is checked against its own entity kind, using seven separate id sets rather than one merged set.
- **A correlation pointer is not evidence.** Neither `finding.correlations.*` nor the chaos run's own correlation columns count as proof that a record was observed. Merchant entities are admitted only from a `CAPTURED` snapshot; webhook events only from a real safe webhook projection; processing attempts only from real attempt ids.
- An unresolved reference becomes a typed `EVIDENCE_REF_UNRESOLVED` gap and is still preserved.
- Missing optional evidence becomes `null` plus a typed gap — never a fabricated `0`, `[]`, `{}` or invented correlation. The `null`-versus-empty distinction is preserved throughout.

### Determinism and purity

- Deterministic ordering: gaps by frozen code order then subject (nulls first), deduplicated; processing attempts by role, then start time, then attempt id.
- Caller-owned input is never mutated and never sorted in place; every returned array is a fresh copy.
- No database, no network, no environment read, no filesystem, no clock, no randomness, no AI provider.
- **Zero runtime imports** — every import is `import type` and is erased at compile time. This matters concretely: `lib/evidence/merchant-state-snapshot.ts` carries `import "server-only"`, which a value import would have pulled in.
- No Phase 4B+ logic of any kind.

### Architect-found R1 defect, and its correction

The first R1 implementation contained a real bug, found by the architect during review and recorded here rather than hidden.

`collectKnownIds` merged every id into one undifferentiated `Set<string>` and seeded it with `finding.invariantResultId`, all four `finding.correlations.*` values, and the chaos run's `order_id`, `payment_attempt_id`, `payment_id` and `source_webhook_event_id`. The effect was that an `ORDER` reference resolved merely because the Finding _pointed at_ that order — with no order evidence present anywhere in the supplied bundle. That would have told Phase 4B a record was observed when nothing about it had been loaded, which is precisely the fabrication `docs/MONEY_INVARIANTS.md` forbids.

It escaped the original tests because they probed with a synthetic id that was never a correlation, so the defective path was never exercised.

The correction, applied and verified **before** R1 was approved and committed, replaced it with `collectEvidenceIdsByKind` (seven per-entity sets populated only from actual supplied projections) plus a kind-aware `isEvidenceRefResolved`. `invariantResultId` was removed from resolution entirely: `INVARIANT_RESULT` is not an approved persisted evidence kind, and the pack already carries that id as a first-class field. Eleven dedicated regression tests (`R1`–`R11`) now pin the rule in both directions.

### Type-contract decision

`evidenceRefs[].kind` intentionally stays `string`, matching the database-facing `InvariantResultEvidenceRef` it originates from, rather than being narrowed to the domain `InvariantEvidenceKind`. Narrowing would require runtime validation, and both available routes cost more than they buy: importing the frozen `INVARIANT_EVIDENCE_KINDS` value would give the module its first runtime dependency and end the zero-runtime-import property that makes its purity mechanically checkable, while a local copy of the seven kinds would be a duplicated vocabulary free to drift.

Nothing is lost. The persisted vocabulary is already enforced on write by the frozen `canonicalizeEvidenceRefs`, resolution is kind-aware regardless, the seven approved kinds are pinned by test, and staying wide is what keeps "preserve verbatim" absolute — no validation step can reject or rewrite a genuinely persisted reference.

---

## 4. R2 — Server-Side Orchestration

**File:** `lib/diagnosis/evidence-pack-service.ts` (declares `import "server-only"`)

**Public function:** `assembleDiagnosisEvidencePackForFinding(findingId: string): Promise<DiagnosisEvidencePackV1>`

```text
persisted Finding                 findFindingById
  -> persisted invariant result   findInvariantResultById   (supplies `result`)
    -> Finding detail read        getFindingDetailByInvariantResultId
      -> chaos evidence           assembleChaosRunEvidence  (only when chaosRunId != null)
        -> buildDiagnosisEvidencePack
          -> DiagnosisEvidencePackV1
```

**The Finding is the only entry boundary.** The service accepts no payment, order, payment-attempt or webhook identifier, and offers no such entry point; a static guard pins that. It never scans arbitrary records looking for something that might be wrong — a diagnosis may begin only from a deterministic failure that already exists.

All four reads are existing frozen paths; no new repository was needed. The R1 builder remains authoritative for every judgement (the FAIL gate, identity, chaos compatibility, gaps, projection, ordering), and its errors propagate unchanged so they stay fail-closed. The service adds an integrity assertion that the Finding resolved through the invariant result is the Finding requested.

A baseline Finding (`chaosRunId === null`) skips chaos assembly entirely and receives an honest partial pack with gaps — no scenario, provenance or processing context is invented for it.

---

## 5. Read Failure vs Evidence Absence

These are separate concepts and are kept separate in code.

| Situation                                                              | Result                                           |
| ---------------------------------------------------------------------- | ------------------------------------------------ |
| **Factual absence** — a record genuinely does not exist                | a valid pack carrying `null` plus a typed gap    |
| **Read failure / integrity failure** — a fact could not be established | fails closed with a typed service error, no pack |

Only an explicit `null` from a _successful_ read is treated as absence. Any thrown read failure — including an unrecognised one — becomes a read-failure error rather than being optimistically downgraded. A database error can never surface as "no finding" or "no evidence".

Service error vocabulary:

```text
EVIDENCE_PACK_FINDING_ID_INVALID
EVIDENCE_PACK_FINDING_NOT_FOUND
EVIDENCE_PACK_INVARIANT_RESULT_NOT_FOUND
EVIDENCE_PACK_INTEGRITY_CONFLICT
EVIDENCE_PACK_READ_FAILED
```

Every message is a fixed safe literal. Only the stable `code` of an underlying failure is inspected; the underlying message is never read, re-thrown or copied, so no raw database text, SQL or connection detail can escape. Gaps are the builder's to emit — the service never authors one.

---

## 6. Evidence / Provenance Rules

Phase 4A preserves three provenance axes **separately** and never flattens them:

| Axis                                                         | Values carried                               |
| ------------------------------------------------------------ | -------------------------------------------- |
| Source event (`webhook_events.source_kind`)                  | `REAL_RAZORPAY_WEBHOOK`                      |
| Processing attempt (`event_processing_attempts.source_kind`) | `REAL_RAZORPAY_WEBHOOK` or `PAYCHAOS_REPLAY` |
| Run classification (`chaos_runs.data_classification`)        | `RECORDED_TEST_EVIDENCE` or `SYNTHETIC_DEMO` |

Values are copied verbatim from persisted rows.

- A `PAYCHAOS_REPLAY` attempt must **never** be described or rendered as a new provider delivery (`docs/RAZORPAY_GUIDE.md` Safety Rule 11; `docs/DEMO_PLAN.md` Section 51 requires a Source label _and_ a Processing label).
- A `SYNTHETIC_DEMO` run must **never** be presented as real merchant or Razorpay performance.
- `PAYCHAOS_SIMULATION`, `TEST_FIXTURE` and `VERIFIED_CHECKOUT_RESULT` are not persisted anywhere in the current schema and are never invented as stored values.

**C03 subject-free evidence is supported honestly.** A C03 run legitimately has no order, payment attempt, payment or source webhook; the pack reports those as `null` with typed gaps rather than fabricating correlations, and C03's safe validated scenario evidence (verification checks and before/after merchant facts) is projected from the frozen assembler's already-validated envelope.

---

## 7. Security / Authority

The Evidence Pack is **advisory input only**. It cannot:

- alter payment state, order state or fulfilment state;
- change invariant results;
- create or modify a diagnosis;
- create a recommendation;
- calculate a Reliability Score;
- decide readiness.

R1 is pure and structurally incapable of any of the above. R2 is server-only, performs zero `INSERT`/`UPDATE`/`UPSERT`/`DELETE`/mutating `RPC`, names no write-capable function, and reaches no browser secret, Razorpay client, runtime AI provider or paid AI API. No migration exists in Phase 4A.

### Fields outside the narrow 4A allowlist

These persisted columns are **not** projected into the Evidence Pack:

```text
fault_config
fault_state
raw_payload_redacted
raw_body_sha256
normalized_event
error_message_redacted
```

To be precise about why: these are **not** universally forbidden database fields. Several are legitimate, deliberately persisted evidence — `docs/RAZORPAY_GUIDE.md` Sections 28 and 32 explicitly permit storing `raw_body_sha256` and `raw_payload_redacted`, and `docs/CHAOS_SCENARIOS.md` Section 36 requires chaos runs to preserve `fault_config` and `fault_state`. They are simply unnecessary for this narrow diagnosis pack, and the frozen Phase 3E safe projections already exclude them. Phase 4A does not widen those projections, and later phases should not widen them without a documented reason.

Genuinely forbidden anywhere in the pack, and asserted absent: Razorpay Key Secret, webhook secret, Supabase service-role key, PAN, CVV, OTP, card/banking credentials, full unredacted webhook payloads, raw webhook or Checkout signature values, customer PII, arbitrary URLs or targets.

---

## 8. Files

### R1 — committed

Commit `146c216e2e6ece5f128d8fe3fe3cc88808e7a184` — `feat: add phase 4a diagnosis evidence pack`, parent `5007a6588f936651f51e01bfaf32c57dd59c0679` (the Phase 3 freeze). Three files, all additions:

```text
lib/diagnosis/evidence-pack.ts
tests/unit/diagnosis/phase4a-evidence-pack.test.ts
tests/unit/diagnosis/phase4a-static-guard.test.ts
```

### R2 — currently uncommitted

New:

```text
lib/diagnosis/evidence-pack-service.ts
tests/unit/diagnosis/evidence-pack-service.test.ts
tests/unit/diagnosis/phase4a-r2-static-guard.test.ts
tests/integration/supabase/067-phase4a-evidence-pack.integration.test.ts
```

Modified, minimally and with architect authorisation:

```text
tests/unit/diagnosis/phase4a-static-guard.test.ts
tests/unit/supabase/061-phase3e-chaos-evidence-provenance-guard.test.ts
tests/unit/supabase/065-phase3g-findings-provenance-guard.test.ts
tests/unit/supabase/066-phase3h-read-models-provenance-guard.test.ts
```

`phase4a-static-guard.test.ts` had one assertion that `lib/diagnosis/` contains exactly one file; it was widened to the approved Phase 4A set so an unapproved production capability appearing there still fails. Every security guarantee over the pure builder is unchanged.

The three `061`/`065`/`066` changes are the deliberate Phase 3 integration-sequence tripwires being advanced one slot, exactly as `062` through `066` were each absorbed before. Each now pins `067-phase4a-evidence-pack.integration.test.ts` by exact filename and asserts no `068-` suite exists yet. The assertion was not deleted, not loosened to a regex, not made to accept arbitrary filenames, and no test was skipped. **No Phase 3 production behaviour changed.**

---

## 9. Database Changes

```text
PHASE_4A_MIGRATION_REQUIRED = NO
```

No new table. No schema change. No column added, removed or altered. No migration file exists for Phase 4A, and both static guards assert the migration list is still the twelve Phase 1–3 files.

Evidence Packs are derived and read-only, and are not persisted as a separate table — consistent with `docs/DATABASE.md`, which states in three places that there is no generic evidence table and whose phase/table matrix gives Phase 4 no evidence table to create.

The advisory `findings` columns (`diagnosis_code`, `diagnosis_strength`, `diagnosis_summary`, `recommendation_code`, `recommendation_text`, `diagnosed_at`) already exist from Phase 3G and **remain unused and NULL** after Phase 4A. They are Phase 4C/4D territory.

---

## 10. Automated Test Evidence

| Gate                                                                          | Result                                                                                                                                |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| R1 focused, after the resolver correction                                     | **70 / 70**                                                                                                                           |
| R2 diagnosis suite (all four diagnosis files)                                 | **109 / 109**                                                                                                                         |
| Final regression group (evidence + invariants + findings + chaos + diagnosis) | **1639 / 1639** across 50 files                                                                                                       |
| Focused real-Supabase `067`                                                   | **15 / 15**                                                                                                                           |
| Full permanent real-Supabase suite                                            | **28 files / 385 tests**                                                                                                              |
| Final complete offline suite, after guard advancement                         | **105 files / 2766 tests**                                                                                                            |
| Typecheck                                                                     | **PASS**                                                                                                                              |
| Lint                                                                          | **PASS** — 0 errors, 1 known unrelated pre-existing warning in `tests/integration/supabase/051-chaos-safety-gate.integration.test.ts` |
| Build                                                                         | **PASS** after the approved `.next`-only recovery for the known Windows/OneDrive EPERM                                                |
| Prettier                                                                      | **PASS**                                                                                                                              |
| `git diff --check`                                                            | **PASS**                                                                                                                              |

The offline total reconciles exactly against the frozen baseline: 101 Phase 1–3 files + 4 Phase 4A files = 105; 2657 frozen tests + 109 Phase 4A tests = 2766.

---

## 11. Real Supabase Zero-Mutation Proof

`067-phase4a-evidence-pack.integration.test.ts` captures a full census immediately **before** and immediately **after** the Evidence Pack operation and asserts equality across every authoritative table:

```text
orders
payment_attempts
payments
fulfilments
webhook_events
event_processing_attempts
chaos_runs
invariant_results
findings
```

It further re-reads the exact fixture rows and proves the **Finding row unchanged** (including every Phase 4 advisory column still NULL and status still `OPEN`), the **invariant result unchanged**, and the **chaos run unchanged**. Repeat calls and both error paths were also censused and mutated nothing.

Fixture setup and teardown legitimately write — that is separate from, and bracketed around, the operation under test, as `docs/TESTING.md` Section 22 permits. Every test-owned row is deleted by exact UUID, children before parents, and the final census is compared against the baseline taken before any fixture existed.

Final database census, restored:

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

PENDING                     0
RUNNING                     0
active C07                  0
active C11-A                0
```

These are the **certified current Phase 3 baseline counts** of test-mode records in the development project. They are not merchant performance metrics and must never be presented as such.

---

## 12. Manual Verification

The manual proof called the real `assembleDiagnosisEvidencePackForFinding(findingId)` — nothing was reconstructed by hand — against a test-owned `SYNTHETIC_DEMO` C03 fixture with no order, payment attempt, payment or webhook, and a Finding created through the frozen Phase 3G production service.

```text
invariantId          = INV-005
invariantResult      = FAIL
scenarioId           = C03
dataClassification   = SYNTHETIC_DEMO

orderId              = null
paymentAttemptId     = null
paymentId            = null
provenance           = null

diagnosisPresent          = false
recommendationPresent     = false
reliabilityScorePresent   = false
readinessPresent          = false

secretOrRawEvidenceDetected      = false
repeatedCallIdentical            = true
operationDatabaseMutationDetected = false

cleanupSuccessful                = true
finalCensusMatchesBaseline       = true
```

The expected missing-evidence gaps were present — source webhook unavailable, C03 verification checks unavailable, C03 mutation facts unavailable, money context unavailable. That is the correct outcome for a deliberately minimal fixture that never executed the full C03 verification sequence: the pack reports the absence explicitly rather than inventing checks, snapshots, provenance or money values.

The fixture UUIDs are deliberately **not** recorded here as reusable project evidence. They were test-owned, existed only for the duration of the check, and were deleted by exact id. The temporary manual verification file was deleted, and the repository returned to its expected path set. No Razorpay call was made, no chaos scenario was run, and no certified Phase 3 row was touched.

---

## 13. Architectural Decisions

1. **Evidence Packs are derived, not persisted.** No table, no row, no copy of evidence.
2. **No Phase 4A migration.** The existing schema already carries everything needed.
3. **The Finding is the diagnosis entry boundary.** No arbitrary subject may start a diagnosis.
4. **Only a deterministic persisted `FAIL` feeds normal diagnosis.** `PASS` and `UNKNOWN` are rejected structurally.
5. **Missing evidence creates typed gaps**, never fabricated zeros, empty collections or invented correlations.
6. **Read errors never masquerade as missing evidence.** Absence and inability-to-establish are separate vocabularies.
7. **R1 remains pure; R2 owns server orchestration.** The purity boundary is enforced by a static guard, not convention.
8. **The existing Phase 3 evidence assembler is reused** rather than reimplemented.
9. **No second invariant engine.** Phase 3F remains the sole authority on money verdicts.
10. **No second chaos engine.** Phase 3 remains the sole execution surface.
11. **Evidence references remain immutable historical linkage** — preserved verbatim whether resolved or not.
12. **Provenance axes remain separate** — source event, processing attempt and run classification are never flattened into one value.

---

## 14. Known Issues / Non-Blockers

None of these is a Phase 4A failure.

1. One pre-existing unrelated lint warning in `tests/integration/supabase/051-chaos-safety-gate.integration.test.ts` (unused eslint-disable directive). Present before Phase 4 began.
2. The known Windows/OneDrive `.next` EPERM during `npm run build`; the approved recovery is to clear **only** `.next` and retry once, which succeeded each time it occurred.
3. Vite emits a forward-looking `configLoader: 'native'` warning about the integration config's extensionless sequencer import. Non-blocking and pre-existing.
4. No diagnosis UI exists in Phase 4A — by design.
5. No API route exists in Phase 4A — by design.
6. Under memory pressure this machine intermittently produced Vitest worker-spawn timeouts. These are environmental, never assertion failures, and every final required invocation completed cleanly.

---

## 15. Deferred Work

Explicitly deferred, and not started:

```text
4B  deterministic signal extraction
4C  root-cause classification + evidence strength
4D  recommendations
4E  regression engine
4F  Reliability Score
4G  Go-Live Readiness
4H  optional P1 AI differentiators
```

### Known 4B dependency — fulfilment idempotency key

`MerchantStateSnapshotFulfilmentV1` currently excludes `fulfilments.idempotency_key`. The database column already exists (`NOT NULL`, `UNIQUE`, derived deterministically as `FULFIL_ORDER:<order_id>`), so **no migration is expected merely to expose that field safely**.

Its absence is a considered Phase 3 decision, not an oversight — the frozen module documents it as "a uniqueness token whose protection belongs in the database's own UNIQUE constraint". However, `docs/MONEY_INVARIANTS.md` lists fulfilment idempotency keys under _Evidence to Capture_ for INV-001, INV-002 and INV-007, and `docs/AI_DESIGN.md` Section 38's `STRONG_EVIDENCE` exemplar depends on comparing them. Phase 4B's `DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS` signal is what separates RC-001 from RC-002.

This was **not** implemented during Phase 4A and no Phase 3 projection was modified.

---

## 16. Phase 4B Starting Contract

Phase 4B must consume **`DiagnosisEvidencePackV1`**.

It must **not** independently rescan arbitrary database or payment state to build a second, parallel evidence model. One evidence surface is the point of Phase 4A.

It may derive deterministic signals only from approved evidence already present in the pack, honouring the pack's gaps: a signal must never be computed from a fact the pack reports as absent, and an absent fact must not be silently treated as a zero.

Phase 4B must **not** classify root cause. Root-cause classification belongs to 4C; recommended fixes belong to 4D.

Before 4B implementation begins, an architect read-only audit should confirm:

- the exact deterministic signal vocabulary 4B will produce;
- how the fulfilment idempotency-key projection dependency will be satisfied, and by which phase.

---

## 17. Phase 4A Acceptance Summary

| Criterion                                    | Result   |
| -------------------------------------------- | -------- |
| Evidence Pack for a deterministic FAIL       | **PASS** |
| Evidence linkage preserved and traceable     | **PASS** |
| Insufficient evidence represented explicitly | **PASS** |
| Read-only authority                          | **PASS** |
| Zero-mutation proof against real Supabase    | **PASS** |
| Synthetic provenance labelling               | **PASS** |
| No paid or runtime AI                        | **PASS** |
| Automated tests                              | **PASS** |
| Manual verification                          | **PASS** |

This covers the **Phase 4A portion only**. The Phase 4 acceptance criteria `P4-AC-01` … `P4-AC-15` are not complete: Phase 4A establishes the foundation for `P4-AC-01` (every P0 failed invariant can produce an evidence pack), `P4-AC-03` (diagnosis references supporting evidence) and `P4-AC-04` (insufficient evidence is reported rather than hallucinated), but the criteria themselves close only once the later sub-phases exist.

Phase 4A is **not approved** by this document. Architect review is pending, and the R2 work remains uncommitted for that review.
