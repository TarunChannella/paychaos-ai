# PHASE 3E-A HANDOFF — Deterministic Evidence Snapshot Foundation

**Branch:** `phase-3-chaos-engine`
**Frozen Phase 3D baseline HEAD (start of this phase):** `bab9b799d791f6b28b2a1ec5723c3607ace6c7a9`
**This handoff describes uncommitted working-tree changes** — nothing in this
substep has been committed or pushed.

---

## 1. Objective

Establish durable, deterministic
`event_processing_attempts.state_before` / `state_after` evidence snapshots
for FUTURE genuine webhook and `PAYCHAOS_REPLAY` processing attempts, so
Phase 3F can later evaluate immutable historical evidence instead of
reconstructing the past from whatever the current, mutable `orders` row
happens to contain.

**This substep is Phase 3E-A only.** It does NOT implement Phase 3E-B's
per-chaos-run evidence assembly across C01/C03/C07/C11, and it implements no
Money Invariant evaluator, no PASS/FAIL/UNKNOWN decision, no
`invariant_results`, no findings, no evidence/timeline UI, no diagnosis, no
recommendations and no reliability score.

---

## 2. Frozen Phase 3D Baseline

Phase 3A / 3B / 3C / 3D-0 / 3D-A / 3D-B / 3D-C / 3D-D / 3D-E remain
**FROZEN**. No scenario mechanism was modified:

- `C01_REPLAY_ATTEMPT_COUNT` is still `2`; `C11_REPLAY_ATTEMPT_COUNT` is
  still `1` (asserted by `tests/unit/evidence/phase3e-a-static-guard.test.ts`
  test 23).
- No chaos execution service imports the evidence surface — snapshots are
  inherited purely through the single central processor (static guard test 25).
- C03 remains processor-independent: no processing attempt, no webhook row,
  no snapshot (static guard test 24). Its deterministic evidence envelope is
  explicitly deferred to Phase 3E-B.
- C11 `TEST_FIXTURE` runtime remains `PRECHECK-07` BLOCKED. The new migration
  does not touch `event_processing_attempts_source_kind_valid`, so
  `TEST_FIXTURE` / `PAYCHAOS_SIMULATION` are still not persistable
  (migration test 10).
- All successful controlled executions still complete `COMPLETED`/`UNKNOWN`.
  Nothing in this substep assigns PASS or FAIL.

---

## 3. Actual Schema BEFORE Phase 3E-A (inspected, not assumed)

Established by reading `supabase/migrations/*.sql` and `lib/supabase/types.ts`
before any edit:

| Column         | State before Phase 3E-A                                                                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chaos_run_id` | **IMPLEMENTED** — added by `20260830000000_phase3c_controlled_replay.sql` (nullable FK → `chaos_runs(id)` `ON DELETE RESTRICT`) plus `event_processing_attempts_chaos_run_id_idx`; present in `lib/supabase/types.ts`. |
| `fault_action` | **NOT IMPLEMENTED** — documented target column only (`docs/DATABASE.md` §14), never added by any migration.                                                                                                            |
| `state_before` | **NOT IMPLEMENTED** — no migration adds it; `lib/supabase/types.ts` explicitly documented it as deferred.                                                                                                              |
| `state_after`  | **NOT IMPLEMENTED** — same.                                                                                                                                                                                            |

This matched the task's stated expectation, so no STOP condition was
triggered.

### `fault_action` scope decision

`fault_action` was **NOT** added. Nothing in the frozen repository makes it a
dependency of snapshot correctness: the run-level fault primitive
`chaos_runs.fault_type` is already authoritative and already linked to the
processing attempt via `chaos_run_id`. Adding an unused column would be
unused schema surface. `docs/DATABASE.md` §14 now records it as the only
remaining deferred column.

---

## 4. Files Changed

### New

- `supabase/migrations/20260901000000_phase3e_evidence_snapshots.sql`
- `lib/evidence/merchant-state-snapshot.ts` — pure, versioned snapshot contract.
- `lib/evidence/evidence-repository.ts` — server-only capture + set-once persistence.
- `tests/unit/evidence/merchant-state-snapshot.test.ts` (24 tests)
- `tests/unit/evidence/evidence-repository.test.ts` (26 tests)
- `tests/unit/evidence/phase3e-a-static-guard.test.ts` (25 tests)
- `tests/unit/events/processor-evidence-instrumentation.test.ts` (19 tests)
- `tests/unit/supabase/060-phase3e-evidence-snapshot-provenance-guard.test.ts` (11 tests)
- `tests/integration/supabase/060-phase3e-evidence-snapshot.integration.test.ts` (**NOT RUN** — see §12)
- `handoffs/PHASE-3E-A-HANDOFF.md` (this file)

### Modified (additive / narrow only)

- `lib/events/processor.ts` — three new imports, one new private
  `captureProcessingSnapshot` helper, and three call sites inside
  `processMerchantWebhookEvent`. The exported signature, the
  `processWebhookPaymentEvent` call and its single argument, every
  `ProcessorFailureCode`, every `SAFE_MESSAGES` string, `MerchantProcessingError`
  and `MerchantProcessingResult` are unchanged.
- `lib/supabase/types.ts` — `state_before`/`state_after` added to
  `event_processing_attempts` `Row`/`Insert`/`Update`; doc comment updated.
  No other table or type was touched.
- `docs/DATABASE.md` — §14 phasing note, §14 Evidence Snapshot Rule, §14 Phase
  Ownership, and §44 Migration Ownership (see §5 below).
- `tests/unit/supabase/migration.test.ts` — new `Phase 3E-A migration` describe
  block (15 tests) appended. No existing assertion changed.
- `tests/unit/supabase/server.test.ts` — one existing test's forbidden list
  narrowed from `fault_action`/`state_before`/`state_after` to `fault_action`
  alone (the other two are now legitimately implemented), plus a NEW positive
  test asserting both columns are declared as nullable JSON objects on `Row`,
  `Insert` and `Update`. Net: the type contract is asserted more strictly than
  before, not less.
- `tests/unit/events/processor.test.ts` — a `vi.mock` for the new evidence
  module added so this file stays isolated to the frozen Phase 2F contract.
  **All eleven existing assertions are unchanged**; nothing was removed,
  relaxed or skipped.

---

## 5. Migration

**File:** `supabase/migrations/20260901000000_phase3e_evidence_snapshots.sql`

Adds, all additively, to `public.event_processing_attempts`:

- `state_before jsonb` — **nullable, no default**;
- `state_after jsonb` — **nullable, no default**;
- `event_processing_attempts_state_before_is_object`
  (`state_before IS NULL OR jsonb_typeof(state_before) = 'object'`);
- `event_processing_attempts_state_after_is_object`
  (`state_after IS NULL OR jsonb_typeof(state_after) = 'object'`);
- a `comment on column` for each.

It creates **no table** (and specifically no generic evidence table), adds no
index, changes no `GRANT`/`REVOKE`/RLS surface, adds no
invariant/finding/regression schema, performs **no backfill**, drops nothing,
does not add `fault_action`, and does not widen `source_kind`. Every
historical migration file is byte-for-byte untouched.

### Migration application status

**IMPLEMENTED IN REPOSITORY / MANUALLY APPLIED / REAL SUPABASE VERIFIED.**

## Manual Migration Application

```text
Migration          20260901000000_phase3e_evidence_snapshots.sql
Applied            YES
Applied by         the developer, manually
Application method Supabase Dashboard -> PayChaos project -> SQL Editor -> Run
Result             Success. No rows returned
Claude reapplied   NO
```

The developer applied the reviewed SQL exactly once, by hand, after architect
review of the SQL, the snapshot contract, the processor instrumentation and
the tests. No tooling re-ran it afterwards: no `supabase db push`, no
`supabase migration up`, no `psql`, no second SQL Editor execution, and no
manual `ALTER TABLE`. The migration file itself has not been edited since
review.

---

## 6. Snapshot JSON Contract

Module: `lib/evidence/merchant-state-snapshot.ts` (pure — no Supabase client,
no clock, no randomness, no network; static guard test 16).

Version: **1** (`MERCHANT_STATE_SNAPSHOT_VERSION`, persisted in every snapshot).

```jsonc
{
  "version": 1,
  "order": {
    "id", "paymentStatus", "businessStatus", "amountSubunits", "currency"
  } | null,
  "paymentAttempt": {
    "id", "orderId", "status", "amountSubunits", "currency",
    "razorpayOrderId", "razorpayOrderStatus"
  } | null,
  "payment": {
    "id", "paymentAttemptId", "razorpayPaymentId", "razorpayPaymentStatus",
    "amountSubunits", "currency", "checkoutSignatureVerified",
    "capturedAt", "failedAt"
  } | null,
  "fulfilments": [
    { "id", "orderId", "paymentId", "triggerProcessingAttemptId",
      "effectType", "appliedAt" }
  ] | null
}
```

- Money is always the integer `amount_subunits` plus the exact `currency`
  string — no floats, no major-unit conversion.
- **Deterministic ordering:** fulfilments are sorted by `id` ascending (a UUID
  primary key, so a strict total order). Any input permutation of the same
  rows produces an identical output (snapshot tests 9/10/16/17).
- **Explicit allowlist projection**, field by field — there is no object
  spread of a source row anywhere, so a column added by a future migration
  cannot leak into evidence (snapshot test 21 proves polluted source rows
  produce a clean snapshot).
- **`fulfilments: null` vs `[]`** is a deliberate distinction: `null` means
  the owning order was not resolved, so no claim about fulfilments is made;
  `[]` means the order WAS resolved and genuinely had none.

### Security / redaction rules

Never present in a snapshot, and never an input to any function here: the raw
Razorpay webhook body, `raw_payload_redacted`, any webhook or Checkout
signature, the Razorpay Key Secret, the webhook secret, the Supabase
service-role key, any session/access token, PAN/card number, CVV, OTP, email,
phone, customer name, LLM text, diagnosis, recommendation or confidence score
(snapshot tests 21–24; static guard tests 8–13, 18–20).

Instrumentation logging carries only a fixed, non-sensitive field set —
internal attempt id, phase, and an error **name** — through the existing
redacting `logEvent` (instrumentation test 10 asserts the raw error message
never appears).

---

## 6a. Architect Correction — No Historical Backfill (BLOCKING defect, fixed)

**The defect.** The first candidate ran
`before snapshot -> processWebhookPaymentEvent -> after snapshot` on EVERY
call, including re-entry of an already-terminal historical attempt. The frozen
processor is idempotent on re-entry (`outcome = "already_processed"`), and the
migration deliberately leaves every pre-Phase-3E row `NULL`. Those two facts
conflicted: calling `processMerchantWebhookEvent(oldAttemptId)` on a row that
succeeded earlier would have captured **today's** merchant state and persisted
it into the still-`NULL` `state_before`, presenting it as evidence about the
original processing.

**Why set-once did not cover it.** Set-once prevents an _overwrite_ of a
non-null value. It does nothing about a **late first write** into a column that
is still `NULL` — which is exactly the state of every historical row, and also
the state left behind whenever an original capture failed while processing
succeeded.

**The fix — processing-lifecycle eligibility.** A snapshot may now be created
only when the current invocation is legitimately participating in that
attempt's processing lifecycle:

- new `getProcessingSnapshotEligibility(processingAttemptId)` reads the trusted
  persisted row and returns `ELIGIBLE_PENDING` / `NOT_ELIGIBLE_TERMINAL` /
  `ATTEMPT_NOT_FOUND` / `READ_FAILED`. It never throws and never leaks a raw
  Supabase error.
- `PENDING` is the ONLY eligible status. `PROCESSING` is deliberately excluded
  even though the frozen RPC admits it (`status not in ('PENDING',
'PROCESSING')` raises `PROCESSING_ATTEMPT_NOT_READY`): it means an earlier
  invocation already began the lifecycle, so a later arrival is a recovery
  re-entry, not the fresh execution a "before" state describes. `HELD`,
  `SUCCEEDED`, `FAILED`, `SKIPPED_DUPLICATE` are terminal/non-runnable. These
  are the exact six literals of `event_processing_attempts_status_valid`.
- `lib/events/processor.ts` resolves eligibility ONCE, BEFORE calling the
  processor, and that single boolean governs BOTH phases.
- `already_processed` never produces a `state_after`; a
  `PROCESSING_ATTEMPT_NOT_READY` failure never produces a late `state_after`
  (the raw repository code is read before it is mapped to
  `MerchantProcessingError`, so the decision is deterministic and the error
  returned to callers is unchanged).
- An eligibility READ failure means no snapshots at all, merchant processing
  entirely unchanged. `NULL` is safer than invention.

**Net effect:** historical pre-Phase-3E attempts are never reconstructed or
backfilled; a terminal idempotent re-entry never fills in missing snapshots;
`NULL` remains authoritative evidence of "not captured"; set-once prevents
overwrite; lifecycle eligibility prevents late first-write fabrication. The
migration's no-backfill promise is now actually enforced by production code,
and a static guard test ties the two together so neither can drift.

---

## 7. Set-Once Behavior

`lib/evidence/evidence-repository.ts` writes each column through **one atomic
conditional UPDATE**. `state_before` carries BOTH the lifecycle guard and the
set-once guard in the same statement:

```
.update({ state_before: value })
  .eq("id", processingAttemptId)
  .eq("status", "PENDING")      // lifecycle guard: no late first write
  .is("state_before", null)     // set-once guard: no overwrite
```

`state_after` keeps the set-once guard (`.is("state_after", null)`); a status
predicate is impossible there because the row is already `SUCCEEDED`/`FAILED`
by that point, so its lifecycle condition is enforced at the single call site
in `lib/events/processor.ts` (see §6a).

On a zero-row match the read-back distinguishes `ALREADY_CAPTURED` /
`NOT_ELIGIBLE` / `ATTEMPT_NOT_FOUND`, and a still-`PENDING`, still-`NULL` row
that nonetheless matched nothing raises
`EVIDENCE_STATE_BEFORE_UPDATE_INCONSISTENT` rather than fabricating a
`CAPTURED`. `NOT_ELIGIBLE` deliberately does NOT go through
`verifyPersistedSnapshot`: a `NULL` on a terminal row is valid history, not
corruption.

- Zero matched rows is NOT a failure. A follow-up read distinguishes
  `ALREADY_CAPTURED` (a snapshot already exists — the pre-existing historical
  value is returned unchanged) from `ATTEMPT_NOT_FOUND` (no such attempt —
  nothing written, nothing claimed).
- **Historical overwrite is not possible**: the `IS NULL` predicate is
  evaluated by Postgres as part of the UPDATE, so a retry, a duplicate
  delivery or a replay can never rewrite evidence, and two concurrent writers
  cannot both win.
- "Verified persisted state is authoritative": a write is reported `CAPTURED`
  only when the row the database actually returned carries a JSON **object**
  in the target column. A missing/null/scalar/array value raises
  `EVIDENCE_STATE_*_NOT_VERIFIED` rather than a false success
  (repository tests 18/24).
- **Merchant tables written: none.** The repository issues exactly two
  mutating calls in total, both `UPDATE` on `event_processing_attempts`, both
  touching only their one snapshot column (repository tests 13/20/25/26;
  static guard tests 14/15).
- All reads are explicit column allowlists — never `select *` (repository test
  2; static guard test 17).

---

## 8. Processor Instrumentation

Central function: `processMerchantWebhookEvent(processingAttemptId)` in
`lib/events/processor.ts` — unchanged signature, still exactly one parameter.

1. resolve processing-lifecycle eligibility ONCE (see §6a) — never throws;
2. if eligible: capture + persist `state_before` (best effort);
3. call the EXISTING `processWebhookPaymentEvent(processingAttemptId)` — once,
   same single argument, regardless of eligibility;
4. if eligible AND the result is not `already_processed` AND the failure is not
   `PROCESSING_ATTEMPT_NOT_READY`: capture + persist `state_after` (best
   effort);
5. return the processor's own result unchanged.

Note that step 4's condition is **eligibility of the invocation**, never
"`state_before` persisted successfully" — so a failed BEFORE capture does not
suppress a valid AFTER snapshot from the same genuine processing invocation.

### Processing-success semantics

Unchanged. The returned `MerchantProcessingResult` is the processor's own
result, field for field; the snapshot contributes nothing to it
(instrumentation tests 1/2/19).

### Processing-failure semantics

Unchanged. The same `MerchantProcessingError` with the same deterministic
`.code` and the same fixed safe `.message` is thrown; unknown throws still map
to `PROCESSING_TRANSACTION_FAILED` and never leak raw text (instrumentation
tests 6/8/14). An `state_after` capture is still ATTEMPTED around the failure,
because a failed attempt's resulting state is itself factual evidence a later
INV-009 evaluation needs — and attempting it changes nothing about the error
rethrown.

### Snapshot-failure semantics

`captureProcessingSnapshot` returns `Promise<void>`, swallows every error
internally, and is additionally called with a defensive `.catch(() => {})` at
each call site. A capture or persistence failure therefore:

- cannot change a processing outcome, cannot mark an order PAID or
  FAILED_OBSERVED, cannot create or suppress a fulfilment, cannot convert a
  processing error into a success (instrumentation tests 9/11/12/14);
- leaves the column NULL and never claims a snapshot that does not exist
  (instrumentation tests 5/10/13).

The frozen `process_webhook_payment_event` SQL body was **not** modified. No
second payment processor exists. No merchant state transition logic is
duplicated in TypeScript.

---

## 9. Provenance Rules

A snapshot never reads or writes `source_kind` (static guard test 20), so it
cannot change provenance. A `REAL_RAZORPAY_WEBHOOK` attempt stays real; a
`PAYCHAOS_REPLAY` attempt stays a replay. Because C01 and C11-B replays and
every genuine webhook delivery already funnel through the single central
processor, they inherit snapshots automatically — with no extra replay
attempt, no changed replay count, no chaos link added to a genuine REAL
attempt, and no canonical `webhook_events` row touched.

---

## 10. C03 Exclusion Rationale

C03 deliberately performs a synthetic invalid-signature boundary check and
never calls the merchant processor, persists no canonical webhook row and
creates no processing attempt. Phase 3E-A therefore produces **no** snapshot
for C03, and deliberately does **not** fabricate a processing attempt or a
webhook row to manufacture one. Phase 3E-B will define C03's deterministic
evidence envelope separately, from its existing `SYNTHETIC_DEMO` chaos-run
verification facts plus permitted read-only evidence.

---

## 11. TEST_FIXTURE Runtime Boundary

Unchanged and still closed. The migration does not widen
`event_processing_attempts_source_kind_valid`, `lib/supabase/types.ts` still
excludes `TEST_FIXTURE`/`PAYCHAOS_SIMULATION`, and the evidence surface never
references either literal (migration test 10; static guard test 19). The C11
fixture remains test infrastructure only, `PRECHECK-07` BLOCKED at runtime.

---

## 12. Tests and Exact Results

All commands were run on this machine; the numbers below are observed, not
estimated.

| Gate                    | Command                                | Result                                                                                                                                   |
| ----------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Full offline unit suite | `npm run test`                         | **69 files passed, 1642 tests passed, 0 failed, 0 skipped — exit 0**                                                                     |
| Typecheck               | `npm run typecheck`                    | **exit 0**, no diagnostics                                                                                                               |
| Lint                    | `npm run lint`                         | **exit 0 — 0 errors, 1 warning** (pre-existing, in the untouched `tests/integration/supabase/051-chaos-safety-gate.integration.test.ts`) |
| Build                   | `npm run build`                        | **exit 0** — compiled, TypeScript step passed, 16 routes emitted                                                                         |
| Prettier                | `npx prettier --check <changed files>` | **exit 0 — all matched files use Prettier code style**                                                                                   |
| Diff check              | `git diff --check`                     | **exit 0**, no whitespace errors                                                                                                         |
| Real Supabase 060       | isolated integration run               | **1 file / 15 tests / 15 passed / 0 failed** — see Section 12a                                                                           |
| Full real Supabase      | `npm run test:integration:supabase`    | **21 files / 234 tests / 234 passed / 0 failed** — see Section 12a                                                                       |

The 1642-test offline figure is the final count after the architect
historical-snapshot correction round (+40 correction tests over the
pre-correction 1602).

New/changed test counts: snapshot domain 24, snapshot persistence 40, processor
instrumentation 34, static safety guard 35, migration structural (Phase 3E-A
block) 15, 060 provenance guard 12.

Regression, all passing inside the full suite: C01 (`replay-service`,
`053` guard), C03 (`c03-execution-service`, `c03-static-guard`), C07
(`c07-execution-service`, `c07-repository`, `c07-static-guard`), C11-B
(`c11-execution-service`, `c11-runtime-static-guard`, `058` guard), C11-A
(`c11-observation-repository`, `c11-a-static-guard`, `059` guard), TEST_FIXTURE
(`c11-payment-failed-fixture`, `057` guard), plus `tests/unit/webhooks`,
`tests/unit/api` and `tests/unit/events`.

### Known environmental issue (not a defect)

Two focused Vitest invocations aborted with
`[vitest-pool]: Failed to start forks worker` / `Timeout waiting for worker to
respond`, collecting **zero** tests and producing **zero** assertion failures —
the documented Windows/OneDrive worker-spawn flake. A standalone re-run of the
same file passed 24/24, and the subsequent full-suite run was clean. No test
config was weakened.

---

## 12a. Real Supabase Verification

Executed only AFTER the developer's manual migration application.

```text
060 isolated
  Files              1
  Tests             15
  Passed            15
  Failed             0

Full real Supabase suite
  Files             21   (up from 20 — the newly-enabled 060)
  Tests            234   (up from 219 — exactly +15)
  Passed           234
  Failed             0

Environmental retry   none required (both clean on the first invocation)
```

### What 060 proved against the live database

- `state_before` exists; `state_after` exists;
- both accept JSON **objects**;
- a **scalar** snapshot value is rejected by the CHECK constraint;
- an **array** snapshot value is rejected by the CHECK constraint;
- a fresh, eligible `PENDING` processing attempt persists a real
  `state_before`;
- the same processing persists a real `state_after`, with factually different
  pre/post content (e.g. `before.order.paymentStatus = UNPAID` vs
  `after = PAID`; `before.fulfilments = []` vs `after` length 1);
- `state_before` is **set-once**; `state_after` is **set-once**;
- the `state_before` first write requires `PENDING` lifecycle eligibility —
  `persistProcessingStateBefore` returns `NOT_ELIGIBLE` against real Postgres
  for a terminal row;
- a terminal `SUCCEEDED` attempt with `NULL` snapshots is **not**
  retroactively backfilled;
- an idempotent `already_processed` re-entry does **not** create a late
  `state_after`;
- a terminal `FAILED`/non-runnable attempt is **not** backfilled, and still
  raises `PROCESSING_ATTEMPT_NOT_READY`;
- the existing merchant-processing result is **unchanged**;
- snapshot capture never alters `source_kind`;
- cleanup succeeded — all synthetic test-owned rows removed
  child-before-parent, with an independent zero-row proof.

### Provenance classification

`060` is **SYNTHETIC REAL-DATABASE MECHANICS VERIFICATION**. Every row it
creates is a test-owned synthetic fixture. It is **not** genuine Razorpay
provider evidence and must never be described as such.

---

## 12b. Historical Phase 3D Evidence Audit

Read-only re-check after the full real-Supabase suite:

```text
C07    durable manual evidence   intact
C11-B  durable manual evidence   intact
C11-A  durable manual evidence   intact
```

Independent read-only census of the live database:

```text
event_processing_attempts total        20
rows with non-null state_before         0
rows with non-null state_after          0
```

**Conclusion: NO historical snapshot backfill occurred.**

This is the **desired** result. Every pre-Phase-3E processing attempt —
including the three genuine `REAL_RAZORPAY_WEBHOOK` originals behind the
approved C07 / C11-B / C11-A manual evidence and C11-B's `PAYCHAOS_REPLAY`
attempt — correctly still carries `state_before = NULL` /
`state_after = NULL`. Applying the migration deliberately performs no
backfill, and the lifecycle eligibility gate additionally prevents any later
idempotent re-entry from writing a late first snapshot into a historical row.
A snapshot generated today would be a false claim about a processing attempt
that ran in the past; `NULL` is authoritative evidence of "not captured", and
is strictly preferable.

The correlated merchant state for all three runs was also confirmed
unchanged (C07: `PAID`/`FULFILLED`, 1 fulfilment; C11-B and C11-A:
`FAILED_OBSERVED`/`OPEN`, 0 fulfilments). No raw webhook payload, signature,
secret, or customer data was read or recorded during this audit.

---

## 13. Known Issues / Open Items

- The migration is **applied and verified** (Sections 5, 12a) — the earlier
  "not applied" caveat is resolved and no longer an open item.
- This project has no generated Supabase `Json` union type; the new columns
  use `Record<string, unknown> | null`, matching this file's existing
  convention for every other JSONB column. The database CHECK constraints
  restrict them to object-or-NULL, so the object-shaped type is accurate.
  This deviation was explicitly accepted by the architect.
- Historical pre-Phase-3E processing attempts retain `NULL` snapshots by
  design (Section 12b). This is correct behavior, not a gap, and must never
  be "fixed" by a backfill.
- The pre-existing, unrelated `no-console` eslint-disable warning in
  `tests/integration/supabase/051-chaos-safety-gate.integration.test.ts`
  remains; that file was never touched by this phase.

---

## 14. Manual Supabase Application — COMPLETE

All three required steps are done:

1. ✅ The developer manually applied
   `supabase/migrations/20260901000000_phase3e_evidence_snapshots.sql` via the
   Supabase Dashboard SQL Editor — result `Success. No rows returned`
   (Section 5).
2. ✅ `060-phase3e-evidence-snapshot.integration.test.ts` was executed against
   real Supabase and passed 15/15, including its independent proof that no
   pre-existing processing attempt's evidence was mutated; the full
   real-Supabase suite then passed 21 files / 234 tests (Section 12a), and an
   independent read-only census confirmed zero historical backfill
   (Section 12b).
3. ✅ `docs/DATABASE.md` §44 now records the Phase 3E migration as
   **IMPLEMENTED IN REPOSITORY / MANUALLY APPLIED / REAL SUPABASE VERIFIED**,
   with the real evidence, alongside the corresponding §14 and
   `event_processing_attempts` status updates.

---

## 15. Phase 3E-B Dependency

Phase 3E-B can rely on:

- `MerchantStateSnapshotV1` (`version: 1`) as the persisted, versioned shape of
  `event_processing_attempts.state_before` / `state_after`;
- `captureMerchantStateSnapshotForProcessingAttempt(processingAttemptId)`,
  `persistProcessingStateBefore(...)`, `persistProcessingStateAfter(...)` and
  `EvidenceRepositoryError` as the complete Phase 3E-A public surface;
- snapshots being present automatically on every future genuine
  `REAL_RAZORPAY_WEBHOOK` and `PAYCHAOS_REPLAY` processing attempt, with no
  per-scenario wiring;
- a NULL snapshot being a valid, truthful "not captured" state that Phase 3F
  must map to `UNKNOWN`, never to a fabricated `PASS`.

Phase 3E-B still owns: the per-chaos-run evidence assembly across
C01/C03/C07/C11, and specifically C03's processor-independent evidence
envelope.

---

## 16. Do Not Break

- `processMerchantWebhookEvent`'s single-parameter signature and its
  unchanged result/error semantics.
- The set-once conditional UPDATE — never replace it with a read-then-write,
  and never allow a snapshot to be overwritten.
- Snapshot capture staying strictly best-effort and structurally unable to
  affect merchant processing.
- The absence of any generic evidence table.
- `C01_REPLAY_ATTEMPT_COUNT = 2`, `C11_REPLAY_ATTEMPT_COUNT = 1`, C03's
  processor independence, and the blocked TEST_FIXTURE runtime.

---

## 17. Phase State

```text
IMPLEMENTED             = YES
TESTED                  = YES (69 files / 1642 tests offline, all gates green)
REAL SUPABASE VERIFIED  = YES (060 15/15; full suite 21 files / 234 tests)
MANUALLY VERIFIED       = YES (developer manually applied the reviewed
                               migration; real Supabase then verified the
                               applied schema and mechanics)
DOCUMENTED              = YES
APPROVED                = YES
```

The migration was applied exactly once, manually, by the developer — never
re-applied by tooling.

---

## 18. Final Architect Approval

**Phase 3E-A — Evidence Snapshot Foundation is APPROVED.**

Approval followed review of, in order:

- the final clean offline suite — **69 files / 1642 tests / 1642 passed / 0
  failed** — plus typecheck, lint (0 errors, 1 pre-existing unrelated
  warning), build, Prettier and `git diff --check`, all green;
- the isolated real-Supabase verification **060: 1 file / 15 tests / 15
  passed / 0 failed**;
- the full real-Supabase suite — **21 files / 234 tests / 234 passed / 0
  failed**, no environmental retry;
- the developer's manual application of
  `20260901000000_phase3e_evidence_snapshots.sql` via the Supabase SQL Editor
  (`Success. No rows returned`), never re-applied by tooling;
- real-database **set-once** verification for both `state_before` and
  `state_after`;
- the **`PENDING` lifecycle first-write guard**, proven against real Postgres
  (`persistProcessingStateBefore` returns `NOT_ELIGIBLE` for a terminal row);
- **terminal `SUCCEEDED` no-backfill**;
- **`already_processed` no-after-backfill**;
- **terminal `FAILED`/non-runnable no-backfill**;
- the independent historical census — **20 processing attempts, 0 non-null
  `state_before`, 0 non-null `state_after`** — confirming zero retroactive
  reconstruction;
- the durability audit of the approved C07 / C11-B / C11-A Phase 3D manual
  evidence, all intact and unmutated;
- the documentation reconciliation across `docs/DATABASE.md` and this handoff.

The historical-snapshot correction round (lifecycle eligibility gate +
race-safe guarded UPDATE) is accepted as the fix for the late-first-write
defect that set-once alone did not cover.

Phase 3E-A assigns **no** invariant PASS/FAIL. A `NULL` snapshot remains
authoritative evidence of "not captured" — never empty state, failure, PASS
or FAIL — and a later evaluator that needs a snapshot it does not have must
return `UNKNOWN`. Deterministic money-invariant evaluation remains Phase 3F's
responsibility.

Future changes to Phase 3E-A require (1) a confirmed bug, (2) a confirmed
security issue, or (3) a genuine later-phase compatibility requirement.
