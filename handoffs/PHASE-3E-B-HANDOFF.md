# PHASE 3E-B HANDOFF — Deterministic Per-Chaos-Run Evidence Assembly

**Branch:** `phase-3-chaos-engine`
**Frozen Phase 3E-A baseline HEAD (start of this substep):** `17bb72d9cdfe560e68b91a13824ef89765749093`
**This handoff describes uncommitted working-tree changes** — nothing in this
substep has been committed or pushed.

---

## 1. Objective

Assemble, deterministically and READ-ONLY, the authoritative persisted facts
that the future Phase 3F Money Invariant Engine needs for the four frozen P0
scenarios C01, C03, C07 and C11.

**Phase 3E-B evaluates no money correctness.** It implements no invariant
evaluator, no `PASS`/`FAIL`/`UNKNOWN`/`NOT_APPLICABLE`/`ERROR` result, no
`invariant_results` persistence, no findings, no diagnosis, no
recommendations, no regression workflow, no reliability score, no evidence or
timeline UI, no new chaos execution and no new payment behavior.

Phase 3E-B provides deterministic evidence INPUTS. Phase 3F decides what they
mean.

---

## 2. Frozen Phase 3E-A Baseline (unchanged)

Phase 3A / 3B / 3C / 3D-0 / 3D-A / 3D-B / 3D-C / 3D-D / 3D-E / 3E-A remain
**FROZEN**. Nothing in this substep modified a scenario mechanism, the
merchant processor, the webhook endpoint, a migration, or the Demo Merchant.

- `C01_REPLAY_ATTEMPT_COUNT` is still `2`; `C11_REPLAY_ATTEMPT_COUNT` is still
  `1` (static guard test 25).
- C03 remains processor-independent, with its frozen two checks in the frozen
  order `WRONG_SIGNATURE` then `MISSING_SIGNATURE` (static guard test 26).
- The Phase 3E-A snapshot surface is untouched, and still owns the only two
  snapshot writes in the codebase (static guard test 27).
- No chaos execution service, and not `lib/events/processor.ts`, imports the
  new Phase 3E-B surface (static guard test 28).
- C11 `TEST_FIXTURE` runtime remains `PRECHECK-07` BLOCKED; no runtime support
  was added.
- Every successful controlled execution still completes `COMPLETED`/`UNKNOWN`.
  Nothing in this substep assigns `PASS` or `FAIL`.

---

## 3. Source-of-Truth Documents Read

`docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md` (§5.13/§5.15/§19/§25),
`docs/PHASE_PLAN.md` (Phase 3E/3F), `docs/DATABASE.md` (§14/§15, the
`invariant_results` + Evidence References sections, the Phase 3E-A "No generic
evidence table" note), `docs/CHAOS_SCENARIOS.md` (§6/§7/§13/§15/§19/§23,
including each scenario's "Evidence Required"), `docs/MONEY_INVARIANTS.md`
(§3 Principles 1-8, §4/§5/§6, §14 P0 set and the scenario→invariant mapping),
`docs/SECURITY.md`, `docs/TESTING.md`, `CLAUDE.md`, plus the Phase 3D, 3D-A,
3D-B, 3D-D, 3D-E and 3E-A handoffs.

Existing source inspected before any edit: `lib/evidence/merchant-state-snapshot.ts`,
`lib/evidence/evidence-repository.ts`, `lib/events/processor.ts`,
`lib/chaos/registry.ts`, `lib/chaos/types.ts`, `lib/chaos/run-repository.ts`,
`lib/chaos/run-service.ts`, `lib/chaos/replay-repository.ts`,
`lib/chaos/replay-service.ts`, `lib/chaos/c03-execution-service.ts`,
`lib/chaos/c07-repository.ts`, `lib/chaos/c11-execution-service.ts`,
`lib/chaos/c11-observation-repository.ts`, `lib/supabase/types.ts`, all ten
migrations, and the 053/057/058/059/060 integration + provenance-guard
templates.

**No documentation conflict was found that required a STOP.** `docs/CHAOS_SCENARIOS.md`
§15 lists "state before/after" among C03's Evidence Required; C03's frozen
architecture produces none. That is handled exactly as the task requires — the
bundle reports the absence honestly (see §11) rather than fabricating it.

---

## 4. Architecture

Three files, each with one responsibility:

| File                                        | Responsibility                                                                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/evidence/chaos-run-evidence.ts`        | PURE domain: types, the V1 snapshot runtime parser, the C03/C07 `fault_state` validators, stable sorting, ref/gap dedupe, the bundle builder. No I/O. |
| `lib/evidence/chaos-evidence-repository.ts` | Server-only, strictly READ-ONLY Supabase reads with explicit column allowlists.                                                                       |
| `lib/evidence/chaos-evidence-service.ts`    | Server-only orchestration exposing `assembleChaosRunEvidence(chaosRunId)`.                                                                            |

Public entry point:

```ts
assembleChaosRunEvidence(chaosRunId: string): Promise<ChaosRunEvidenceBundleV1 | null>
```

`null` means "no chaos run with that id exists" — a genuinely absent record,
never conflated with a database read failure.

---

## 5. Files Changed

### New

- `lib/evidence/chaos-run-evidence.ts`
- `lib/evidence/chaos-evidence-repository.ts`
- `lib/evidence/chaos-evidence-service.ts`
- `tests/unit/evidence/chaos-run-evidence.test.ts` (85 tests)
- `tests/unit/evidence/chaos-evidence-repository.test.ts` (19 tests)
- `tests/unit/evidence/phase3e-b-static-guard.test.ts` (36 tests)
- `tests/unit/supabase/061-phase3e-chaos-evidence-provenance-guard.test.ts` (15 tests)
- `tests/integration/supabase/061-phase3e-chaos-evidence-assembly.integration.test.ts` (16 tests)
- `handoffs/PHASE-3E-B-HANDOFF.md` (this file)

### Modified

- `docs/ARCHITECTURE.md` — one new subsection, "Per-Chaos-Run Evidence
  Assembly (Phase 3E-B)", appended inside §19 Evidence Collection
  Architecture. No other section was touched.

### Deliberately NOT modified

No migration, no `lib/supabase/types.ts` change, no merchant processor change,
no chaos execution service change, no webhook behavior change, no Demo
Merchant browser code, no `docs/MONEY_INVARIANTS.md`, no existing test
assertion.

---

## 6. No-Migration Decision

**Phase 3E-B required and created NO migration.** The ten existing migration
files are byte-for-byte untouched, and static guard test 29 asserts the exact
migration list plus the continued absence of any
`evidence_snapshots`/`chaos_evidence`/`evidence_records`/`evidence_packs`/
`scenario_evidence`/`generic_evidence`/`invariant_results` table.

Every fact the assembler needs already exists on approved columns:

| Need                                               | Existing source                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| run identity, scenario, lifecycle, correlation FKs | `chaos_runs`                                                          |
| C03 verification checks, C07 armed/consumed        | `chaos_runs.fault_state`                                              |
| source provenance, authenticity, delivery counts   | `webhook_events`                                                      |
| processing provenance and correlation              | `event_processing_attempts`                                           |
| historical before/after merchant state             | `event_processing_attempts.state_before` / `state_after` (Phase 3E-A) |

No column was added, and `fault_action` remains the only deferred column.

---

## 7. Evidence Bundle V1 Contract

`ChaosRunEvidenceBundleV1` — versioned (`CHAOS_RUN_EVIDENCE_BUNDLE_VERSION = 1`),
in-memory only, never persisted:

```text
version                     1
run                         SafeChaosRunEvidence (explicit allowlist)
requiredInvariantIds        the scenario's frozen required invariant IDs
sourceWebhook               SafeWebhookEvidence | null
originalProcessingAttempts  ProcessingAttemptEvidence[]  (REAL, chaos_run_id NULL)
chaosProcessingAttempts     ProcessingAttemptEvidence[]  (chaos_run_id = this run)
canonicalSourceEventCount   number | null
scenarioEvidence            C01Evidence | C03Evidence | C07Evidence | C11Evidence
evidenceRefs                EvidenceRef[]  (deduplicated, sorted)
gaps                        EvidenceGap[]  (deduplicated, sorted)
```

**There is no verdict field of any kind**, and no `assembledAt`, no generated
id, no randomness. Only timestamps already persisted on the source rows appear
(unit test 22 enumerates every timestamp in a bundle and requires each to be
one of the persisted values).

### Allowlisted projections

`SafeChaosRunEvidence` — `id`, `scenarioId`, `status`, `outcome`, `faultType`,
`dataClassification`, `orderId`, `paymentAttemptId`, `paymentId`,
`sourceWebhookEventId`, `failedPrecheckId`, `executionBlockCode`, `startedAt`,
`completedAt`. **No generic `fault_state`/`fault_config` blob** — only the
narrow, validated, scenario-specific facts under `scenarioEvidence`. No
`error_message_redacted` (operator prose, not an evaluation input).

`SafeWebhookEvidence` — `id`, `razorpayEventId`, `eventType`, `sourceKind`,
`signatureVerified`, `processingStatus`, `duplicateDeliveryCount`,
`receivedAt`, `paymentAttemptId`, `paymentId`. No raw body, no
`raw_payload_redacted`, no `raw_body_sha256`, no signature, no header, no
customer field.

`ProcessingAttemptEvidence` — `id`, `webhookEventId`, `chaosRunId`,
`sourceKind`, `status`, `isDuplicateDelivery`, `paymentAttemptId`,
`paymentId`, `errorCode`, `startedAt`, `finishedAt`, plus the runtime-parsed
`stateBefore` / `stateAfter`.

### No raw `normalized_event` copy

The full `normalized_event` blob is never selected and never copied. Every
fact Phase 3F needs from it — provenance, event type, correlation, processing
status — is already a trusted column on `webhook_events` or on the attempt.
**No specific normalized-event field was found to be required and unavailable
elsewhere**, so no STOP was raised.

---

## 8. Evidence Reference Contract

```ts
type EvidenceRefKind =
  | "CHAOS_RUN"
  | "FULFILMENT"
  | "ORDER"
  | "PAYMENT"
  | "PAYMENT_ATTEMPT"
  | "PROCESSING_ATTEMPT"
  | "WEBHOOK_EVENT";

interface EvidenceRef {
  kind: EvidenceRefKind;
  id: string;
}
```

Kind + internal UUID and nothing else (asserted per-ref by
`Object.keys(ref).sort()` in both the unit and the real-Supabase test).
Deduplicated on the exact `(kind, id)` pair, then sorted by `kind` ascending
then `id` ascending — a strict total order, so identical DB facts always
produce identical ordered refs.

Sources: the run's own persisted FK columns; the resolved source webhook's own
id and its correlation FKs; each processing attempt's id and correlation FKs;
and entity ids from a **validated** `MerchantStateSnapshotV1` only. An
`INVALID` or `NOT_CAPTURED` snapshot contributes no reference, so a reference
is never created from unvalidated JSON or a guessed correlation.

---

## 8a. Architect Evidence-Integrity Correction Round

Four defects were reported and all four are accepted as genuine. Nothing in
the accepted architecture was redesigned.

### Blocker 1 — snapshot order/fulfilment completeness

`parseMerchantStateSnapshotV1` validated `order` and `fulfilments`
independently, so it accepted logically inconsistent shapes — most importantly
`order = non-null` with `fulfilments = null`. That blurred the frozen Phase
3E-A distinction the whole fulfilment-count invariant family depends on.

Fixed with cross-field validation applied after per-field parsing:

```text
order !== null  =>  fulfilments MUST be an array
order === null  =>  fulfilments MUST be null
```

Neither side is fabricated or transformed to make a shape pass: a `null` is
never replaced with `[]`, and an `[]` is never replaced with `null`.

### Blocker 2 — authoritative original processing attempt (a real logic bug)

`collectOriginalAttemptGaps` treated `originalProcessingAttempts.length` as the
authoritative-source test. That is wrong in **both** directions:

- a canonical event may legitimately carry several `REAL_RAZORPAY_WEBHOOK`
  attempts over time (attempt 1 `FAILED`, attempt 2 `SUCCEEDED`) — ordinary
  retry history, wrongly reported as ambiguous;
- a lone attempt whose `status` is `FAILED` was wrongly accepted as a valid
  authoritative original merely because `length === 1`.

Fixed with a pure, order-independent resolver,
`resolveAuthoritativeOriginalProcessingAttempt(...)`, returning
`NONE` / `EXACTLY_ONE` / `AMBIGUOUS`. Candidate rule, applied per attempt:

```text
sourceKind === "REAL_RAZORPAY_WEBHOOK"
chaosRunId === null
status === "SUCCEEDED"
isDuplicateDelivery === false
```

Only the number of CANDIDATES decides the outcome. Array position, insertion
order, sorting, `startedAt`/`finishedAt` "latest wins" and any provenance
inference are all unused — and the static guard now scopes those prohibitions
to the resolver's own function body so they cannot creep back.

The repository read stays deliberately BROAD (provenance filters only, never
`status` or `is_duplicate_delivery`), so failed/retry history is never hidden
or deleted — the assembler simply declines to call it authoritative.

### Correction 3 — canonical source processing status

The bundle exposed `sourceWebhook.processingStatus` but never flagged an
unprocessed source. Added `SOURCE_PROCESSING_NOT_PROCESSED` when
`processingStatus !== "PROCESSED"`, using the exact frozen vocabulary of
`webhook_events_processing_status_valid`
(`'RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED'` —
`supabase/migrations/20260826000000_phase2d_webhook_events.sql`, read before
implementing rather than invented).

### Correction 4 — C03 data classification

Added `UNEXPECTED_DATA_CLASSIFICATION` for a C03 run whose
`data_classification` is not `SYNTHETIC_DEMO`. C03 execution is unchanged, no
provider evidence is created, and the gap is never a FAIL.

### Bundle representation of the authoritative original

ONE design was chosen, not two: `authoritativeOriginalProcessingAttemptId:
string | null` inside `C01Evidence` / `C07Evidence` / `C11Evidence`. It is an
**id**, so the full projection is never duplicated — it already lives once in
`ChaosRunEvidenceBundleV1.originalProcessingAttempts`. When resolution is
`NONE` or `AMBIGUOUS` the field is `null`; one is never arbitrarily selected.

---

## 9. Snapshot Runtime Validation

`parseMerchantStateSnapshotV1(value)` — never a blind cast, never throws:

```text
null / undefined            -> { kind: "NOT_CAPTURED" }
non-object / array / scalar -> { kind: "INVALID" }
version !== 1               -> { kind: "INVALID" }
missing required top key    -> { kind: "INVALID" }
malformed nested field      -> { kind: "INVALID" }
non-integer money amount    -> { kind: "INVALID" }
otherwise                   -> { kind: "CAPTURED", snapshot }
```

- Cross-field completeness is enforced (see §8a Blocker 1): a resolved order
  requires a fulfilments array, and an unresolved order requires `null`.
- Every returned field is copied by explicit name, so unknown fields in the
  persisted JSON cannot leak into the bundle (unit test 9 injects a fake
  signature, a fake card number and a fake email into a snapshot and proves
  none reach the output).
- Money must be an integer count of smallest currency subunits
  (`Number.isInteger`) — `docs/MONEY_INVARIANTS.md` Principle 7.
- Nullable entities stay nullable, and `fulfilments: null` ("the order was not
  resolved") stays distinct from `[]` ("resolved, genuinely none").
- Fulfilments are re-sorted by `id` ascending on read, so ordering is
  deterministic even for a row written before the ordering rule existed.
- An invalid snapshot becomes an `INVALID_STATE_BEFORE`/`INVALID_STATE_AFTER`
  gap. It is never silently accepted, never repaired, and never crashes the
  application.

---

## 10. Historical Truth Rule (structural, not a promise)

`lib/evidence/chaos-evidence-repository.ts` reads exactly three tables:
`chaos_runs`, `webhook_events`, `event_processing_attempts`. It **never reads
`orders`, `payment_attempts`, `payments` or `fulfilments` at all** — so a
missing or invalid snapshot cannot be substituted with today's mutable
merchant state, because that state is not reachable from this code path.
Static guard test 14 pins the exact `.from(...)` target set; repository unit
test 9 proves it against a recording mock; the 061 integration test proves it
against real Postgres by leaving an order at `PAID`/`FULFILLED` while the
cleared `state_before` stays `NOT_CAPTURED`.

The 20 pre-Phase-3E processing attempts correctly retain
`state_before = NULL` / `state_after = NULL`. Assembling one of those
historical runs returns the durable IDs, provenance and run facts **plus**
`MISSING_STATE_BEFORE` / `MISSING_STATE_AFTER` gaps. That is EXPECTED and
correct. No backfill, no synthesis, no mutation. Those runs are neither
`PASS` nor `FAIL` here — Phase 3E-B assigns no verdict at all.

**No situation was found where current mutable merchant rows were required**,
so no STOP was raised.

---

## 11. Scenario Evidence

### C01 — Duplicate Webhook Delivery

Mechanism B, `REPLAY_EVENT`, frozen replay count **2**. Assembles: the exact
chaos run; the exact canonical source webhook and its provenance/signature/
event-type facts; the ONE original `REAL_RAZORPAY_WEBHOOK` attempt with
`chaos_run_id IS NULL`; the `PAYCHAOS_REPLAY` attempts linked to this exact
run; the parsed snapshots on each; the canonical `webhook_events` row count for
the source `razorpay_event_id` (proving a replay never became a new canonical
event); and all safe refs. Nothing is replayed during assembly.
INV-001/002/006/007 are named, never evaluated.

### C03 — Invalid Webhook Signature (the special case)

C03's frozen architecture is `SYNTHETIC_DEMO` + `INVALID_SIGNATURE_TEST`, it
calls the real signature-verification primitive directly, creates **no**
canonical webhook row, **no** processing attempt and **no** merchant
mutation, and all its merchant/provider FKs are NULL.

The envelope is built ONLY from those existing durable synthetic facts:

```text
verificationChecks              [WRONG_SIGNATURE, MISSING_SIGNATURE] in the frozen order, or null
sourceWebhookLinked             false
orderLinked                     false
paymentAttemptLinked            false
paymentLinked                   false
chaosLinkedProcessingAttemptCount 0
```

**No fake webhook. No fake processing attempt. No fake merchant before/after
snapshot. No global merchant-state read presented as a C03 before/after. No
migration. C03 is not re-run during assembly.** C03 deliberately emits no
source-webhook and no original-attempt gaps — it legitimately has neither, and
reporting them as "missing" would misrepresent its frozen architecture. Where
Phase 3F wants evidence C03 genuinely does not have, the envelope reports the
absence honestly and Phase 3F decides `UNKNOWN`/`NOT_APPLICABLE`.

An `UNEXPECTED_ACCEPTANCE` classification is recorded as a **fact**, not a gap
and not an automatic failure — a gap means "the input could not be
established", and here it was established perfectly well. INV-004/INV-005 are
named, never evaluated.

### C07 — Payment Succeeds but Client Confirmation Is Lost

`DROP_CLIENT_CONFIRMATION`, a server-owned `{armed, consumed}` fault state,
genuine `REAL_RAZORPAY_WEBHOOK` convergence, and **zero** `PAYCHAOS_REPLAY`
execution. Assembles the run, the exact armed/consumed projection (validated
against the same exactness rule as `parseExactC07FaultState` — extra key,
non-boolean `consumed` or `armed !== true` all fail closed to `null` + a
`MISSING_C07_FAULT_STATE` gap), the source webhook and its provenance and
signature facts, the original REAL attempt and its parsed snapshots, and safe
refs. Any chaos-run-linked attempt is an integrity gap. Checkout is not run,
no confirmation is suppressed, no replay is created, the run is not
reconciled, and present-day order state never replaces a missing snapshot.
INV-002/004/011 are named, never evaluated.

### C11 — Failed Payment Must Never Mark Order Paid

Deterministic factual classification of the OBSERVED shape (never a money
verdict, never a claim about operator intent):

```text
A_OBSERVATION           completed, non-BLOCKED, source webhook resolved, 0 chaos-linked attempts
B_REPLAY                completed, non-BLOCKED, source webhook resolved, exactly 1 PAYCHAOS_REPLAY
AMBIGUOUS_OR_INCOMPLETE anything else
```

C11-A expected chaos-linked replay count **0**; C11-B expected **1**; more
than one is `AMBIGUOUS_OR_INCOMPLETE` plus an
`UNEXPECTED_CHAOS_PROCESSING_ATTEMPT_COUNT` gap. Extracts the `payment.failed`
event type, `REAL_RAZORPAY_WEBHOOK` provenance, `signature_verified`,
`processing_status`, the original REAL attempt, and the parsed snapshots
wherever genuinely present. INV-003/004/011 are named, never evaluated.

### TEST_FIXTURE boundary

Unchanged and still closed. `TEST_FIXTURE` runtime remains `PRECHECK-07`
BLOCKED; the literal appears nowhere in the Phase 3E-B functional code (static
guard test 20). A BLOCKED C11 row can never be classified `A_OBSERVATION` or
`B_REPLAY` — a positive classification requires a completed, non-BLOCKED run
with a resolved source webhook — so no provider evidence is ever fabricated
for it. Proven by unit test 59 and asserted statically.

---

## 12. Evidence Gap Model

Gaps are FACTS about missing/invalid inputs, never verdicts:

```text
RUN_NOT_COMPLETED                          RUN_BLOCKED_BEFORE_EXECUTION
MISSING_SOURCE_WEBHOOK_LINK                SOURCE_WEBHOOK_NOT_FOUND
SOURCE_PROVENANCE_MISMATCH                 SOURCE_SIGNATURE_NOT_VERIFIED
SOURCE_EVENT_TYPE_UNEXPECTED               SOURCE_PROCESSING_NOT_PROCESSED
MISSING_CANONICAL_SOURCE_EVENT_COUNT       UNEXPECTED_CANONICAL_SOURCE_EVENT_COUNT
MISSING_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT
AMBIGUOUS_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT
PROCESSING_PROVENANCE_MISMATCH             UNEXPECTED_CHAOS_PROCESSING_ATTEMPT_COUNT
MISSING_STATE_BEFORE                       MISSING_STATE_AFTER
INVALID_STATE_BEFORE                       INVALID_STATE_AFTER
MISSING_ORDER_REFERENCE                    MISSING_PAYMENT_ATTEMPT_REFERENCE
MISSING_PAYMENT_REFERENCE                  UNEXPECTED_FAULT_TYPE
UNEXPECTED_DATA_CLASSIFICATION             MISSING_C03_VERIFICATION_CHECKS
UNEXPECTED_C03_PROVIDER_LINK               MISSING_C07_FAULT_STATE
C07_FAULT_NOT_CONSUMED                     AMBIGUOUS_C11_EVIDENCE_SHAPE
```

Each gap is `{ code, subjectId }` where `subjectId` is the internal UUID the
gap is about, or `null` for a run-level gap. Never free text, never a raw
database error. Deduplicated on the exact `(code, subjectId)` pair and sorted
by `code` ascending then `subjectId` ascending (run-level `null` first).

---

## 13. Deterministic Ordering

| Array                | Order                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| processing attempts  | `startedAt` ascending, then `id` ascending (a strict total order — two C01 replays can share a timestamp) |
| evidence refs        | `kind` ascending, then `id` ascending                                                                     |
| gaps                 | `code` ascending, then `subjectId` ascending (`null` first)                                               |
| snapshot fulfilments | `id` ascending, re-applied on read                                                                        |
| C03 checks           | the FROZEN order `WRONG_SIGNATURE` then `MISSING_SIGNATURE`, never sorted                                 |

No Postgres row ordering is relied upon anywhere. Unit tests 19/20/21 prove
deep-equal output across repeats and across shuffled input, including for
attempts sharing a `started_at`.

---

## 14. Repository Error Boundary

`ChaosEvidenceRepositoryError` carries a fixed safe `.code` and a fixed safe
`.message` — a raw Supabase/Postgres error never escapes, and the repository
never reads `error.message`/`error.details` (static guard test 4).

```text
CHAOS_EVIDENCE_RUN_LOOKUP_FAILED
CHAOS_EVIDENCE_WEBHOOK_LOOKUP_FAILED
CHAOS_EVIDENCE_CANONICAL_COUNT_FAILED
CHAOS_EVIDENCE_ORIGINAL_ATTEMPT_LOOKUP_FAILED
CHAOS_EVIDENCE_CHAOS_ATTEMPT_LOOKUP_FAILED
```

A genuinely ABSENT record becomes `null` (the chaos run) or a deterministic
evidence gap (everything else) so the bundle can still be assembled
truthfully. A genuine database I/O failure throws. The two are never conflated.

---

## 15. Security / Provenance Rules

- **Read-only is structural.** Zero `.insert(`/`.update(`/`.delete(`/
  `.upsert(`/`.rpc(` anywhere in the surface (static guard test 13), proven
  against real Postgres by a before/after byte-identical row comparison plus a
  row-count census (061).
- **Only an internal `chaos_runs.id` UUID is accepted.** No URL, host,
  hostname, IP, `webhook_url`, `callback_url`, `target_endpoint`, table name,
  column name, order state, payment state, snapshot JSON or provider status
  from any untrusted source (static guard tests 2/19).
- **No network.** No `fetch`, no `axios`, no `http(s).request`, no
  `new Razorpay(...)`, no `@/lib/razorpay/*` import (static guard test 8).
- **No LLM.** No OpenAI/Anthropic/Ollama/LangChain/Gemini reference (static
  guard test 18). Money correctness stays deterministic.
- **Explicit SELECT allowlists only** — never `select("*")` in the production
  repository (static guard test 16, repository unit test 8).
- **No secret, raw payload, hash, signature or PII** is ever selected or
  reaches the bundle (static guard test 23, domain unit test 23).
- **Provenance is never relabelled.** `sourceKind` is copied verbatim from the
  persisted column; a hardcoded provenance value in a projection is
  statically forbidden (static guard test 24). A `PAYCHAOS_REPLAY` attempt is
  never called a provider delivery; a `REAL_RAZORPAY_WEBHOOK` attempt is never
  called a replay. Classification uses `source_kind` and `chaos_run_id` only —
  never names, timestamps or ordering.
- **No verdict vocabulary** — `"PASS"`, `"FAIL"`, `"NOT_APPLICABLE"`,
  `invariant_results`, `findings`, `regression_runs`, `reliability_score`,
  `evaluateInvariant` and `createFinding` are all statically forbidden in the
  functional code (static guard test 17).

---

## 16. Unit Tests

| File                                                                      | Tests | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/evidence/chaos-run-evidence.test.ts`                          | 85    | Snapshot runtime validation (null/valid/wrong version/scalar/array/missing key/malformed nested/non-integer money/nullable/`null` vs `[]`/unknown-field non-leak/ordering/never-throws); C03 and C07 `fault_state` validators; ref and gap dedupe + total ordering; bundle determinism across repeats and shuffles; no clock, no random id, no verdict field, no secret/PII; C01 healthy + 11 gap cases; C03 valid + 7 cases including no-fabrication; C07 valid + 5 gap cases; C11-A/C11-B/ambiguous/TEST_FIXTURE-BLOCKED/historical-NULL cases; PLUS the correction round: order/fulfilments cross-field completeness (A-E), the authoritative-original resolver and its bundle behavior (A-F) for C01/C07/C11 including retry history, source processing-status across every frozen non-PROCESSED literal, and C03 data classification |
| `tests/unit/evidence/chaos-evidence-repository.test.ts`                   | 19    | Read shape and exact-UUID correlation; original-vs-chaos classification from persisted facts; exact head count; zero writes, zero RPC, no `select *`, no merchant-table read, no forbidden column; typed safe error per failure point with no raw error leak; absent-vs-failure distinction; `assembleChaosRunEvidence` determinism and `null` for an unknown id                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `tests/unit/evidence/phase3e-b-static-guard.test.ts`                      | 36    | Required elements present; every forbidden write/execution/network/AI/verdict/backfill construct absent from comment-stripped functional source; frozen constants and C03 frozen order in lockstep; no new migration; no evidence table; `fault_action` still absent; PLUS function-body-scoped prohibitions so the authoritative-original rule can never regress to array-length-only, latest-attempt-wins or timestamp authority, and the repository's originals read can never be narrowed to hide failed/retry history                                                                                                                                                                                                                                                                                                                |
| `tests/unit/supabase/061-phase3e-chaos-evidence-provenance-guard.test.ts` | 15    | 061 classifies every `chaos_runs` row `SYNTHETIC_DEMO`, never invokes a production creation/precheck/execution path or route, documents its provenance layers, cleans up child-before-parent with exact ids, proves zero remaining rows, asserts no verdict, and introduces no migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

The correction round added 31 offline tests: the Blocker 1 cross-field
completeness cases (A–E), the Blocker 2 authoritative-original resolver and
bundle cases (A–F for C01, plus C07 and C11), the source processing-status
cases across every frozen non-`PROCESSED` literal, the C03
classification cases, and six new static-guard prohibitions scoped to the
resolver's own function body.

**Total new offline tests: 155.**

---

## 17. Real Supabase — 061

`tests/integration/supabase/061-phase3e-chaos-evidence-assembly.integration.test.ts`
— **16 tests, all passing on the first invocation** (13 originally, plus 3
added by the evidence-integrity correction round). 061 was verified unused
before creation; 062 does not exist.

Runnable immediately: Phase 3E-B adds no schema, so the already-applied Phase
3E-A migration is sufficient.

### Provenance classification

**SYNTHETIC REAL-DATABASE MECHANICS VERIFICATION.** Every row it creates is a
test-owned synthetic fixture. It is **not** genuine Razorpay provider evidence
and must never be described as such. Every `chaos_runs` row it writes is
`SYNTHETIC_DEMO`; it never calls `createChaosRun`, `runChaosPrecheck`, any
positive-path chaos execution service, or any chaos HTTP route.

### What 061 proved against the live database

- **C01 mechanics:** one source webhook; one original REAL-compatible attempt
  with `chaos_run_id IS NULL`; exactly two `PAYCHAOS_REPLAY` attempts linked to
  the run; genuinely persisted V1 snapshots on all three; canonical source
  event count exactly 1; the expected scenario facts; **zero gaps**.
- **Genuine snapshot content:** `before.order = UNPAID`/`OPEN` with
  `fulfilments = []` vs `after.order = PAID`/`FULFILLED` with one fulfilment,
  integer `amountSubunits` and `currency = INR`.
- **Evidence refs:** deduplicated, deterministically sorted, each carrying
  exactly `{kind, id}`, including the expected CHAOS_RUN/WEBHOOK_EVENT/ORDER/
  PAYMENT/PAYMENT_ATTEMPT/PROCESSING_ATTEMPT/FULFILMENT entries.
- **Determinism:** two assemblies of unchanged data are deep-equal and
  JSON-identical.
- **Zero production writes:** global row counts for `chaos_runs`,
  `event_processing_attempts`, `webhook_events` and `fulfilments` unchanged,
  and every owned row byte-identical, across both
  `assembleChaosRunEvidence` and `loadChaosRunEvidenceSource`.
- **Unknown run id** returns `null` without inventing a bundle.
- **C03:** `SYNTHETIC_DEMO` run; persisted fixed checks in the frozen order; no
  source webhook; zero processing attempts; every merchant/provider FK NULL;
  zero gaps; the only ref is the chaos run itself; no `stateBefore`/
  `stateAfter` key exists anywhere in the bundle. A malformed `fault_state`
  becomes `MISSING_C03_VERIFICATION_CHECKS` with `verificationChecks: null`.
- **C07:** armed+consumed fault state; genuine source; original attempt with
  both V1 snapshots; zero replays; zero gaps. Armed-but-unconsumed becomes
  `C07_FAULT_NOT_CONSUMED`.
- **C11-A:** `payment.failed` source; original REAL-compatible attempt; zero
  replays; classified `A_OBSERVATION`; zero gaps.
- **C11-B:** same evidence relationship shape plus exactly one
  `PAYCHAOS_REPLAY`; classified `B_REPLAY`; zero gaps.
- **Gap cases:** a NULL `state_before` becomes `MISSING_STATE_BEFORE`, a
  malformed `state_after` becomes `INVALID_STATE_AFTER`, and — with the live
  order sitting at `PAID`/`FULFILLED` — the missing snapshot stays
  `NOT_CAPTURED` and the database NULL stays NULL. No repair, no substitution.
- **Canonical source completeness (correction 3):** the real
  merchant-processing transaction drives the canonical event to `PROCESSED`
  and no gap is emitted; driving that TEST-OWNED row to each remaining frozen
  literal (`RECEIVED`, `PROCESSING`, `FAILED`) produces
  `SOURCE_PROCESSING_NOT_PROCESSED` and the persisted status is reported
  exactly as stored, never normalised or repaired.
- **Authoritative original with retry history (Blocker 2):** a second REAL
  provider attempt that ended `FAILED` is added alongside the `SUCCEEDED`
  one. BOTH remain visible in `originalProcessingAttempts`, the `SUCCEEDED`
  non-duplicate attempt is resolved as authoritative, and NO ambiguity gap is
  emitted. The `FAILED` attempt's absent snapshots remain a factual
  `MISSING_STATE_BEFORE` gap.
- **Genuine ambiguity:** two `SUCCEEDED` non-duplicate REAL originals produce
  `AMBIGUOUS_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT` and a `null`
  authoritative id — one is never arbitrarily selected.
- **Cleanup:** exact-ID, child-before-parent, with an independent post-cleanup
  zero-row proof for all seven owned tables, plus a byte-identical re-check of
  every pre-existing `event_processing_attempts` row's `state_before`/
  `state_after` (historical Phase 3D evidence untouched).

### Historical Phase 3D compatibility under the corrections

The approved historical C07 / C11-A / C11-B source evidence already satisfies
both new completeness rules: its canonical source webhooks carry
`processing_status = PROCESSED`, and its originals carry `status = SUCCEEDED`,
`is_duplicate_delivery = false`, `chaos_run_id = NULL` — so each resolves as
`EXACTLY_ONE` authoritative original and emits neither
`SOURCE_PROCESSING_NOT_PROCESSED` nor a missing/ambiguous authoritative gap.
Their durable source relationships therefore continue to assemble.

Their `state_before`/`state_after` remain `NULL` because they predate Phase
3E-A, so `MISSING_STATE_BEFORE`/`MISSING_STATE_AFTER` remain factual gaps for
them. No backfill, no mutation, no further payment and no further chaos
execution was performed in this correction round.

### Historical read-only regression

Covered without hardcoding any manual ID into the permanent suite: 061's
`beforeAll` census records every pre-existing processing attempt's snapshot
values (which includes the historical Phase 3D C03/C07/C11-A/C11-B evidence),
and its `afterAll` proves them byte-identical afterwards. The assembler's
inability to mutate anything is additionally proven structurally (static guard
test 13) and behaviourally (the zero-writes test). No temporary helper was
created and none was committed.

---

## 18. Full Test Results (observed, not estimated)

| Gate                                | Command                                                                                                                                                                                | Result                                                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Focused Phase 3E + chaos regression | `npx vitest run tests/unit/evidence tests/unit/supabase/060-... tests/unit/supabase/061-... tests/unit/chaos tests/unit/fixtures/c11-payment-failed-fixture.test.ts tests/unit/events` | **28 files / 874 tests / 874 passed / 0 failed**                                                                                         |
| Full offline suite                  | `npx vitest run`                                                                                                                                                                       | **73 files / 1797 tests / 1797 passed / 0 failed — exit 0**, clean on the FIRST invocation this round                                    |
| Isolated 061                        | `npx vitest run --config vitest.integration.config.ts tests/integration/supabase/061-...`                                                                                              | **1 file / 16 tests / 16 passed / 0 failed**                                                                                             |
| Full real Supabase                  | `npx vitest run --config vitest.integration.config.ts`                                                                                                                                 | **22 files / 250 tests / 250 passed / 0 failed**                                                                                         |
| Typecheck                           | `npm run typecheck`                                                                                                                                                                    | **exit 0**, no diagnostics                                                                                                               |
| Lint                                | `npm run lint`                                                                                                                                                                         | **exit 0 — 0 errors, 1 warning** (pre-existing, in the untouched `tests/integration/supabase/051-chaos-safety-gate.integration.test.ts`) |
| Build                               | `npm run build`                                                                                                                                                                        | **exit 0** — compiled, TypeScript step passed, 16 routes emitted                                                                         |
| Prettier                            | `npx prettier --check <all changed files>`                                                                                                                                             | **exit 0 — all matched files use Prettier code style**                                                                                   |
| Diff check                          | `git diff --check`                                                                                                                                                                     | **exit 0**, no whitespace errors                                                                                                         |

Offline baseline was 69 files / 1642 tests; the delta is exactly +4 files /
+155 tests. Real-Supabase baseline was 21 files / 234 tests; the delta is
exactly +1 file / +16 tests.

All figures above are from the FINAL, post-correction runs. The pre-correction
round measured 1766 offline and 247 real-Supabase tests; the correction round
added 31 offline and 3 real-Supabase tests.

### Environmental issues (not defects)

This machine ran the suite with roughly **0.28-0.56 GB of 7.69 GB physical
memory free** (VS Code plus an active OneDrive sync). That produced the
documented Windows/OneDrive flakes, all of which were resolved by re-running or
by lowering worker concurrency — never by weakening a test, a timeout or a
config:

- Several `[vitest-pool]: Failed to start forks worker` /
  `Timeout waiting for worker to respond` aborts, each collecting **zero**
  tests and producing **zero** assertion failures (the first isolated run of
  `chaos-run-evidence.test.ts`; a later focused evidence run; two isolated
  attempts at `chaos-c11-a-routes.test.ts`; one full-suite attempt). Every
  affected file was re-run and passed.
- Several full-suite attempts under the default fork pool reported
  `Test timed out in 5000ms/20000ms` failures (38, then 3, then 1, then 3,
  then 4) — **every one of them in a pre-existing, untouched file**:
  `c07-repository`, `chaos-replay-route`,
  `webhooks-razorpay-route-signature-rejection`, `c11-observation-repository`,
  `chaos-c11-a-routes`, `env-files`, `razorpay/adapter`. Each was isolated and
  passed standalone (`c07-repository` **32/32**, `chaos-c11-a-routes`
  **55/55**). **No failure was ever an assertion failure, and none was in a
  file this phase created or modified.**
- During the FIRST (pre-correction) round, one plain `npx vitest run` was
  completely clean at 73 files / 1766 tests, and — after a whitespace-only
  Prettier reformat degraded the host further — the post-reformat suite was
  verified once with `--maxWorkers=2` at the same 73 files / 1766 tests.
- During the CORRECTION round the host had recovered, and **both required
  gates were clean on their FIRST invocation with the plain gate commands**:
  `npx vitest run` at **73 files / 1797 tests**, and
  `npx vitest run --config vitest.integration.config.ts` at **22 files / 250
  tests**. No reduced-concurrency invocation and no retry was needed for
  either.
- `npm run build` failed with the documented `.next` `EPERM: unlink` in both
  rounds. `.next` was removed and the build retried once, succeeding each
  time.

No test config, timeout or assertion was changed at any point.

---

## 19. Known Issues / Open Items

- The pre-existing, unrelated `no-console` eslint-disable warning in
  `tests/integration/supabase/051-chaos-safety-gate.integration.test.ts`
  remains; that file was never touched by this phase.
- Historical pre-Phase-3E processing attempts retain `NULL` snapshots by
  design and surface as `MISSING_STATE_BEFORE`/`MISSING_STATE_AFTER` gaps.
  This is correct behavior, not a gap in the implementation, and must never be
  "fixed" by a backfill.
- The offline suite is memory-sensitive on this machine (see §18). This is an
  environment characteristic, not a code defect.

---

## 20. Deferred Phase 3F Work

Phase 3F still owns, and Phase 3E-B deliberately did not implement:

- the deterministic INV-001…INV-012 evaluators;
- evidence-requirement checks and the `PASS`/`FAIL`/`UNKNOWN` decision, plus
  `NOT_APPLICABLE`/`ERROR` as evaluation dispositions;
- the mapping from each Phase 3E-B evidence gap to `UNKNOWN` (or to
  `NOT_APPLICABLE`) per the invariant spec;
- the `invariant_results` table, its migration, invariant versioning, and
  append-only result persistence;
- `evidence_refs` persistence (the Phase 3E-B `EvidenceRef` shape is ready to
  be written into that JSONB column unchanged);
- findings generated only from `invariant_results.result = FAIL`;
- diagnosis, recommendations, regression lifecycle, reliability score,
  go-live readiness, and all evidence/timeline UI.

---

## 21. Manual Verification

**PENDING.** The automated gates above are complete and green, including real
Supabase. A human has not yet manually exercised an assembled bundle through
the UI or an operator flow — there is no Phase 3E-B UI, by scope.

---

## 22. Do Not Break

- `assembleChaosRunEvidence(chaosRunId)`'s single-parameter signature and its
  `ChaosRunEvidenceBundleV1 | null` return.
- The read-only property of the assembly surface — never add a write, an RPC,
  a network call, or a merchant-table read to it.
- The three-table read set (`chaos_runs`, `webhook_events`,
  `event_processing_attempts`) and the explicit column allowlists.
- The absence of a verdict field in the bundle and the absence of any generic
  evidence table.
- Deterministic ordering and ref/gap deduplication.
- C03's processor-independent envelope, and the rule that no webhook,
  processing attempt or merchant snapshot is ever fabricated for it.
- `C01_EXPECTED_REPLAY_ATTEMPT_COUNT = 2`, `C11B_EXPECTED_REPLAY_ATTEMPT_COUNT = 1`,
  `C11A_EXPECTED_REPLAY_ATTEMPT_COUNT = 0`, kept in lockstep with the frozen
  execution constants by the static guard.
- The blocked `TEST_FIXTURE` runtime.

---

## 23. Git Status

```text
Baseline HEAD   17bb72d9cdfe560e68b91a13824ef89765749093
Current HEAD    17bb72d9cdfe560e68b91a13824ef89765749093 (unchanged)
Committed       NO
Pushed          NO
```

That state describes the implementation/correction rounds. After the
historical read-only manual verification (Section 24) and architect approval,
these ten paths were committed and pushed as the frozen Phase 3E-B commit.

---

## 24. Historical Read-Only Manual Verification

**Result: PASS.**

A temporary, strictly read-only integration verifier called
`assembleChaosRunEvidence(...)` against the four already-approved historical
Phase 3D manual runs. It performed SELECTs only — no insert/update/delete/
upsert/RPC, no chaos execution service, no merchant processor, no replay, no
Razorpay client, no fetch. **No payment, webhook, replay or chaos execution
of any kind was performed during this verification.** The verifier and its
sanitized JSON report were deleted immediately afterwards and were never
committed.

Historical runs verified:

```text
C03    a0c5a66a-e70f-4e47-b9eb-0b3482c789d4
C07    68878716-ed49-40ec-85de-f962a4f6b21c
C11-B  5090e423-daa5-4122-99de-4c27d728957c
C11-A  b49d344a-f5cf-42ae-a078-819b26bfbffe
```

All four bundles assembled successfully:

| Scenario | Source           | Authoritative original | Chaos replays         | Snapshots      | Gaps                                                |
| -------- | ---------------- | ---------------------- | --------------------- | -------------- | --------------------------------------------------- |
| C03      | none by design   | none by design         | 0                     | none by design | **none**                                            |
| C07      | REAL / PROCESSED | resolved (`3f6be711…`) | 0                     | NOT_CAPTURED   | `MISSING_STATE_BEFORE`, `MISSING_STATE_AFTER`       |
| C11-B    | REAL / PROCESSED | resolved (`d756d2ab…`) | 1 × `PAYCHAOS_REPLAY` | NOT_CAPTURED   | `MISSING_STATE_BEFORE` ×2, `MISSING_STATE_AFTER` ×2 |
| C11-A    | REAL / PROCESSED | resolved (`9a0b293f…`) | 0                     | NOT_CAPTURED   | `MISSING_STATE_BEFORE`, `MISSING_STATE_AFTER`       |

Specific confirmations:

- **C03** — `SYNTHETIC_DEMO`, `INVALID_SIGNATURE_TEST`, both frozen checks
  `REJECTED` in the frozen `WRONG_SIGNATURE` → `MISSING_SIGNATURE` order, no
  source webhook, 0 original attempts, 0 chaos attempts, order/payment/
  payment-attempt links all absent, `canonicalSourceEventCount = null`, and
  **zero gaps**. C03 legitimately has no provider source evidence, and the
  assembler correctly emits no source-webhook gap against its
  processor-independent architecture. No provider or merchant evidence was
  fabricated.
- **C07** — `DROP_CLIENT_CONFIRMATION`, `armed = true`, `consumed = true`,
  source `REAL_RAZORPAY_WEBHOOK` / `signature_verified = true` /
  `processing_status = PROCESSED`, authoritative original resolved
  (`SUCCEEDED`, non-duplicate, `chaos_run_id = null`), 0 replay attempts.
- **C11-B** — `B_REPLAY`, `payment.failed`, `REAL_RAZORPAY_WEBHOOK`,
  verified, `PROCESSED`, authoritative original resolved, exactly one
  `PAYCHAOS_REPLAY` (never relabelled as a provider delivery).
- **C11-A** — `A_OBSERVATION`, `payment.failed`, `REAL_RAZORPAY_WEBHOOK`,
  verified, `PROCESSED`, authoritative original resolved, 0 replay attempts.

Mutation verification (read-only fingerprint captured before and after all
four assembly calls, compared byte-for-byte):

```text
chaos_runs                 unchanged
webhook_events             unchanged
event_processing_attempts  unchanged
state_before backfilled    NO
state_after  backfilled    NO
```

Snapshot census after assembly:

```text
total event_processing_attempts   20
non-null state_before              0
non-null state_after               0
```

Identical to the previously verified baseline. The historical `NULL`
snapshots on these pre-Phase-3E rows remain factual `NOT_CAPTURED` evidence,
correctly surfaced as `MISSING_STATE_BEFORE`/`MISSING_STATE_AFTER` gaps
rather than being reconstructed. These gaps are evidence-integrity facts,
never verdicts — Phase 3F alone decides what they mean.

---

## 25. Phase State

```text
IMPLEMENTED             = YES
TESTED                  = YES (73 files / 1797 tests offline, 0 failed;
                               typecheck, lint, build, prettier and diff
                               check all green)
REAL SUPABASE VERIFIED  = YES (061 16/16 isolated; full suite 22 files / 250
                               tests, clean on the first invocation)
MANUALLY VERIFIED       = YES (Section 24 — all four historical Phase 3D runs
                               assembled read-only with zero mutation and
                               zero snapshot backfill)
DOCUMENTED              = YES
APPROVED                = YES
```

### Independent offline environmental retry (reported honestly)

An independent coordinator re-run of the full offline suite initially showed
**two failures — both `Test timed out in 5000ms`, both in pre-existing files
untouched by this phase** (`tests/unit/demo-merchant/actions.test.ts`,
`tests/unit/razorpay/adapter.test.ts`), with **zero assertion failures**.
Isolated standalone, those two files passed **2 files / 40 tests**. The
subsequent full offline rerun was clean at **73 files / 1797 tests / 1797
passed / 0 failed**. No assertion regression occurred and no test, timeout or
configuration was weakened. This is the documented Windows/OneDrive worker
starvation characteristic of this development machine.

### Final architect approval

Phase 3E-B is architect-approved following the implementation review, the
evidence-integrity correction round (snapshot order/fulfilments cross-field
completeness, authoritative-original resolution from SUCCEEDED +
non-duplicate candidates rather than array length, source
`processing_status` completeness, and C03 `SYNTHETIC_DEMO` classification),
the real-Supabase verification, and the historical read-only manual
verification in Section 24.

Phase 3E-B assigns **no** invariant verdict. Evidence gaps are factual
missing/invalid inputs, not `PASS`/`FAIL`/`UNKNOWN`/`NOT_APPLICABLE`/`ERROR`.
Phase 3F — the deterministic Money Invariant Engine — remains the only layer
permitted to interpret this evidence.
