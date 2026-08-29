# Phase 3F Evidence-Compatibility Correction — Handoff

**Status:** IMPLEMENTED · TESTED · REAL-SUPABASE VERIFIED · MANUALLY VERIFIED · DOCUMENTED · **APPROVED**

```text
IMPLEMENTED             = YES
TESTED                  = YES
REAL SUPABASE VERIFIED  = YES
MANUALLY VERIFIED       = YES
DOCUMENTED              = YES
APPROVED                = YES
```

This is **not** the Phase 3F Money Invariant Engine. No `invariant_results` table, no invariant registry, no evaluator, no `PASS`/`FAIL`/`UNKNOWN` assignment, no findings, no diagnosis, no recommendations, no score, no regression workflow, no Phase 3G/3H work exists in this change.

Parent commit: `6829161dae96939bc058cf7a4bb3aac2d0ce9a32`.

---

## 1. Why this correction was necessary

Phase 3F preparation established that the frozen Phase 3D/3E evidence surface could not supply three inputs the approved invariant contracts require. Each was verified against source, not assumed.

### 1.1 C03 could never prove INV-005

`docs/MONEY_INVARIANTS.md` INV-005 states its rule as three deltas (`trusted canonical webhook rows created = 0`, `payment/business state delta = 0`, `fulfilment delta = 0`) and §6 requires before/after snapshots of `orders`, `payment_attempts`, `payments`, `fulfilments` and `webhook_events`.

C03 is verification-only by design: `lib/chaos/c03-execution-service.ts` imports only `verifyWebhookSignature` and the run-lifecycle repository, and correctly creates **no** `event_processing_attempts` row. But `state_before`/`state_after` live _on_ a processing attempt. C03 therefore had no before/after evidence anywhere in the durable record, and INV-005 — the core safety invariant of the only executable invalid-signature scenario — could only ever have evaluated `UNKNOWN`.

Reconstructing it at read time was not an option: `lib/evidence/chaos-evidence-repository.ts` is structurally forbidden from reading `orders`/`payment_attempts`/`payments`/`fulfilments` (enforced by `phase3e-b-static-guard.test.ts` assertion 14), and those tables are mutable, so a "before" read taken after the fact would be a false claim about the past (§43 Evidence Snapshot Rule).

### 1.2 INV-008's webhook money clause was unevaluable

`WEBHOOK_EVENT_COLUMNS` did not select `amount_subunits` or `currency`, so `SafeWebhookEvidence` could not carry them and INV-008 §8's clause _"If trusted normalized webhook evidence contains amount/currency, it must match the canonical payment values as well"_ had no input.

### 1.3 No authoritative captured-payment basis existed

`loadChaosRunEvidenceSource` read `webhook_events` only by the run's own `source_webhook_event_id`. No other webhook row could enter the bundle. But per `lib/chaos/registry.ts`, C11's source is `payment.failed` by definition, and C01/C07 may be sourced from `order.paid` — which §5 explicitly downgrades to corroborating evidence. So INV-003's "capture-event search result", INV-004 §8 condition 3 and INV-010's "authoritative successful payment evidence" all had no input.

`payments.captured_at` cannot substitute: it is written by `process_webhook_payment_event`'s own `payment.captured` branch (`captured_at = coalesce(captured_at, v_now)`), i.e. by the merchant-processing transaction those invariants audit. Accepting it would let the code under test certify itself.

---

## 2. What was implemented

### 2.1 C03 mutation evidence

Captured at **execution time**, inside the same C03 run, persisted on the existing `chaos_runs.fault_state`:

```text
fault_state = {
  checks: [
    { case: "WRONG_SIGNATURE",   classification: "REJECTED" | "UNEXPECTED_ACCEPTANCE" },
    { case: "MISSING_SIGNATURE", classification: "REJECTED" | "UNEXPECTED_ACCEPTANCE" }
  ],
  mutationEvidence: { version: 1, before: <snapshot> | null, after: <snapshot> | null }
}
```

Frozen execution order: **capture BEFORE → WRONG_SIGNATURE → MISSING_SIGNATURE → capture AFTER → persist → complete via the existing lifecycle.**

- **Scope:** the whole controlled Demo Merchant across five tables. There is no `merchant_id`/tenant column anywhere in this schema (verified against the applied migrations) and none was invented.
- **State, not counts:** the four business collections carry full row-state projections reusing the frozen `MerchantStateSnapshot*V1` field vocabulary. An order can move `UNPAID → PAID` while the row count is unchanged. `trustedWebhookEvents` carries internal UUIDs plus an exact count, because INV-005's webhook clause is an insertion test.
- **Deterministic:** every collection sorted by internal UUID; never by a timestamp used as identity.
- **Truthful incompleteness:** `null` collection = read failed; `complete: false` = truncated at the 200-row cap. Never defaulted to `[]`, `0` or a fabricated object.
- **Never gates the scenario:** a capture failure leaves that side `null`, the two signature checks still execute, and the run still completes.

### 2.2 Trusted webhook money projection

`amount_subunits → amountSubunits`, `currency → currency`, `razorpay_payment_id → razorpayPaymentId`. `NULL` preserved exactly. `razorpay_order_id` deliberately **not** exposed — the correlation contract does not use it. No `normalized_event`, no raw payload, no signature, no headers.

### 2.3 Authoritative capture search

One shared bundle-level mechanism serving INV-003, INV-004 and INV-010.

```text
event_type = payment.captured AND source_kind = REAL_RAZORPAY_WEBHOOK AND signature_verified = true
```

correlated by **exact equality** on the trusted `razorpay_payment_id`, unioned with exact equality on the internal `payment_id`. Two separate parameterized `.eq()` queries — never a `.or()` filter string, never `like`/`ilike`/substring/fuzzy matching, never a timestamp preference, never `limit(1)`.

`processing_status` is deliberately **not** filtered: a signature-verified provider capture delivery is authentic capture evidence whether or not PayChaos finished processing it.

**The false-negative rule (the critical correction).** The entire search is gated on having an exact trusted **provider** identity. Without one, the resolver returns `SEARCH_INCOMPLETE` regardless of any other result, because an internal-FK-only search cannot see a genuine capture whose internal correlation is missing. Reporting "no capture exists" from such a search would produce a false INV-003/INV-004/INV-010 finding, and **a false payment finding is not a safe outcome.**

| Resolution                        | Meaning                                                                                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NO_SUBJECT`                      | No trustworthy payment identity. Normal for C03. Never proof that no capture exists.                                                                |
| `AMBIGUOUS_SUBJECT`               | Trusted rows disagree about which payment. Fails closed.                                                                                            |
| `SEARCH_INCOMPLETE`               | Subject exists but no trusted provider identity to search by. Must be `UNKNOWN`, never `FAIL`.                                                      |
| `NONE_OBSERVED`                   | **Complete** negative: exact provider identity, query succeeded, zero rows. A valid factual result and **not** an evidence gap.                     |
| `EXACTLY_ONE`                     | One verified capture, internally correlated to the subject.                                                                                         |
| `INCOMPLETE_INTERNAL_CORRELATION` | One verified capture matched by provider identity; internal correlation absent/mismatched. **Stays visible; never collapsed into `NONE_OBSERVED`.** |
| `AMBIGUOUS`                       | More than one candidate, or a conflicting provider identity. Never latest-wins; all candidates referenced.                                          |

`sourceWebhook` semantics are unchanged: a C11 run still reports `sourceWebhook.eventType === "payment.failed"`.

---

## 3. Files changed

**Modified frozen production (3):**

- `lib/chaos/c03-execution-service.ts`
- `lib/evidence/chaos-evidence-repository.ts`
- `lib/evidence/chaos-run-evidence.ts`

**New production (2):**

- `lib/chaos/c03-mutation-snapshot.ts` — pure; no I/O, no clock, no randomness, no verdicts. Type-only import of the frozen merchant-state field vocabulary.
- `lib/chaos/c03-mutation-snapshot-repository.ts` — server-only, strictly read-only; takes **no parameters**, so there is no caller-controlled entity selector.

Both new modules live under `lib/chaos/` rather than `lib/evidence/` specifically so that `phase3e-a-static-guard.test.ts` assertions **24** and **25b** (a chaos execution service must not import the evidence surface) pass **byte-unchanged**.

**Migration: NONE.** `chaos_runs.fault_state` is already `jsonb NOT NULL DEFAULT '{}'` with only a `jsonb_typeof(...) = 'object'` CHECK; `webhook_events.amount_subunits`/`currency` already existed since Phase 2D.

**Untouched:** `lib/chaos/types.ts`, `registry.ts`, `safety-gate.ts`, `run-service.ts`, `run-repository.ts`, `replay-*`, `c07-*`, `c11-*`, `lib/events/processor.ts`, `lib/evidence/merchant-state-snapshot.ts`, `lib/evidence/evidence-repository.ts`, `lib/evidence/chaos-evidence-service.ts`, all webhook/Razorpay modules, the database RPC, every existing migration, and every chaos/webhook HTTP route.

---

## 4. Historical compatibility

The C03 `fault_state` reader accepts **exactly two** key sets and nothing else:

```text
LEGACY   { checks }                      -> mutationEvidence: null + MISSING_C03_MUTATION_EVIDENCE gap
CURRENT  { checks, mutationEvidence }    -> validated evidence
```

An arbitrary extra key is rejected outright — deliberately not relaxed into a generic pass-through.

| Historical run | Disposition                                 | Change             |
| -------------- | ------------------------------------------- | ------------------ |
| C03            | INV-004 `NOT_APPLICABLE`, INV-005 `UNKNOWN` | none — no backfill |
| C07            | 3 × `UNKNOWN`                               | none               |
| C11-B          | 3 × `UNKNOWN`                               | none               |
| C11-A          | 3 × `UNKNOWN`                               | none               |

**Approved arithmetic: `UNKNOWN` = 10, `NOT_APPLICABLE` = 1, total mapped dispositions = 11.** No other aggregate may be reported unless an exact named run is included. Per ARCH-3F-015, no historical C01 run is searched for, created, or depended upon.

Non-mutation is **proven, not assumed**: `062-phase3f-evidence-compatibility.integration.test.ts` records every pre-existing `chaos_runs.fault_state` and every `event_processing_attempts` `state_before`/`state_after` in `beforeAll` and re-asserts them byte-identical in `afterAll`.

---

## 5. Binding rulings recorded

- **ARCH-3F-013** — For Phase 3F, an `UNEXPECTED_ACCEPTANCE` on either C03 case makes INV-005 **FAIL**, regardless of a zero delta: an intentionally invalid signature being accepted is itself a breach of the trusted authentication boundary. **Not implemented here** — the evidence layer records the classification as a fact only. Documented in `docs/MONEY_INVARIANTS.md` INV-005 §10.
- **ARCH-3F-014** — C03 must run in the controlled Demo Merchant sandbox with **no concurrent payment flow**. An operator rule, not a lock; no Redis, advisory lock, queue, worker, extra table, extra precheck or migration was added. A concurrent payment landing between the two captures would change the snapshot, and this evidence cannot distinguish that from a mutation C03 caused — stated plainly rather than hidden.
- **ARCH-3F-015** — historical arithmetic frozen at 10/1/11 for C03/C07/C11-B/C11-A only.
- **ADR-A17** (`docs/ARCHITECTURE.md`) — records when a narrow, additive later-phase compatibility correction to a frozen phase is permitted, and the alternatives rejected (including the explicitly rejected claim that a false payment finding is a "safe" direction).

---

## 6. Phase 3F must still do

1. Create the `invariant_results` migration (the only migration Phase 3F should introduce).
2. Implement the deterministic INV-001…INV-012 evaluators, which alone assign `PASS`/`FAIL`/`UNKNOWN`.
3. Apply ARCH-3F-013's `UNEXPECTED_ACCEPTANCE → FAIL` rule.
4. Apply the INV-005 semantics documented in `docs/MONEY_INVARIANTS.md` §10 (complete + unchanged + both REJECTED → eligible to PASS; complete + factual mutation → FAIL; incomplete → UNKNOWN).
5. Treat `NO_SUBJECT`/`AMBIGUOUS_SUBJECT`/`SEARCH_INCOMPLETE` as `UNKNOWN` — **never** as evidence that no capture exists.
6. Treat `INCOMPLETE_INTERNAL_CORRELATION` as real capture evidence that blocks a "failure-only evidence" conclusion, while remaining insufficient for a relational INV-004/INV-010 `PASS`.

## 7. Do not break

- C03 stays verification-only: `SYNTHETIC_DEMO`, `INVALID_SIGNATURE_TEST`, both frozen cases, fixed internal verifier, zero `webhook_events`, zero `event_processing_attempts`, all four FKs `NULL`, no Razorpay network, no arbitrary target.
- The evidence layer assigns no verdict and persists none.
- Historical evidence is never backfilled; a `FAIL` is never rewritten to `PASS`.
- Money stays integer smallest-currency subunits with currency compared alongside; `NULL` is never defaulted.
- The capture search never reports a negative result it was not capable of establishing.

## 8. Fresh C03 manual verification — PASS (accepted)

The approval precondition recorded in the pre-approval draft of this section was a **fresh C03 manual execution** against the controlled Demo Merchant sandbox, with no concurrent payment flow, observing `mutationEvidence` populated on a genuinely executed run. That verification has been performed and **architect-accepted**.

**Fresh verification run: `c406dafd-d48f-4e1e-b092-030acbb5e32b`**

Created through the trusted production `createChaosRun({ scenarioId: "C03", mechanism: "C", faultType: "INVALID_SIGNATURE_TEST" })` path and executed exactly once through `executeC03InvalidSignatureTest(...)`. No hand-written `INSERT`, no fabricated state, no edited row.

| Field                 | Observed                 |
| --------------------- | ------------------------ |
| `scenario`            | `C03`                    |
| `status`              | `COMPLETED`              |
| `outcome`             | `UNKNOWN`                |
| `data_classification` | `SYNTHETIC_DEMO`         |
| `fault_type`          | `INVALID_SIGNATURE_TEST` |

**Signature cases** — `WRONG_SIGNATURE = REJECTED`, `MISSING_SIGNATURE = REJECTED`. Unexpected acceptance: **NONE**.

**Correlations** — all four merchant/provider FKs (`order_id`, `payment_attempt_id`, `payment_id`, `source_webhook_event_id`) `NULL`, as C03's verification-only mechanism requires.

**Mutation evidence** — persisted, `version = 1`; `fault_state` keys exactly `["checks", "mutationEvidence"]`.

| Collection             | BEFORE present / count / complete | AFTER present / count / complete | Unchanged |
| ---------------------- | --------------------------------- | -------------------------------- | --------- |
| `orders`               | YES / 11 / `true`                 | YES / 11 / `true`                | YES       |
| `paymentAttempts`      | YES / 11 / `true`                 | YES / 11 / `true`                | YES       |
| `payments`             | YES / 10 / `true`                 | YES / 10 / `true`                | YES       |
| `fulfilments`          | YES / 7 / `true`                  | YES / 7 / `true`                 | YES       |
| `trustedWebhookEvents` | YES / 16 / `true`                 | YES / 16 / `true`                | YES       |

All five BEFORE collections complete; all five AFTER collections complete. Comparison was performed over the **full approved safe projections** (deep equality of every projected field), not row counts alone. **Mutation detected: NO.**

**Side effects** — new `webhook_events` = **0** (16 → 16); new `event_processing_attempts` = **0** (20 → 20); Razorpay network = **NO**; merchant processor = **NO**; replay = **NO**.

**Assembled evidence** — `mutationEvidence` present with both snapshots valid and complete; `MISSING_C03_MUTATION_EVIDENCE` **ABSENT**; `UNEXPECTED_C03_PROVIDER_LINK` **ABSENT** (gap list empty); `sourceWebhook` `NULL`; original processing attempts **0**; chaos processing attempts **0**; authoritative capture factual state **`NO_SUBJECT`** with `authoritativeCaptureWebhook = null`. The serialized bundle contains **no** invariant verdict — no `PASS`/`FAIL`, finding, diagnosis, recommendation or score token. `NO_SUBJECT` is a factual search state, never a money verdict.

**Historical C03 (`a0c5a66a-e70f-4e47-b9eb-0b3482c789d4`)** — legacy `fault_state` keys still exactly `["checks"]`; assembled `mutationEvidence` `null`; `MISSING_C03_MUTATION_EVIDENCE` **PRESENT**; **not backfilled**.

**Historical processing-snapshot census** — total `event_processing_attempts` = **20**, non-null `state_before` = **0**, non-null `state_after` = **0** — unchanged from the established baseline. The fresh C03 execution created no processing attempt at all, so no snapshot could be written.

**Artifacts** — the fresh C03 run is **retained** as manual verification evidence. The temporary `991-temp-c03-manual-verification.integration.test.ts` verifier and its `991-c03-manual-report.json` output were **deleted**; no permanent implementation file was modified during verification.

**Verification-process note, recorded for honesty:** the first probe read a non-existent bundle key (`authoritativeCaptureResolution`) and therefore returned `null`. The implemented field is `authoritativeCapture`. The recheck was performed **read-only against the same run** — no second chaos run was created — and returned `NO_SUBJECT`. The `null` was a probe defect, not an implementation gap.

Remaining unrelated future work (unchanged, not an approval blocker for this correction): fresh C01/C07/C11 runs are still needed to demonstrate snapshot-dependent results, since the four historical runs predate the Phase 3E-A snapshot instrumentation.

---

## 9. Approved gate evidence

| Gate                     | Result                                         |
| ------------------------ | ---------------------------------------------- |
| Focused suite            | 10 files / 325 tests / **325 passed**          |
| Full offline suite       | 76 files / 1900 tests / **1900 passed**        |
| `062` real Supabase      | **20 / 20 passed**                             |
| Full real-Supabase suite | 23 files / 270 tests / **270 passed**          |
| Typecheck                | **PASS**                                       |
| Lint                     | **0 errors**, 1 pre-existing unrelated warning |
| Build                    | **PASS**                                       |
| Prettier                 | **PASS**                                       |
| `git diff --check`       | **PASS**                                       |
| Migration                | **NONE**                                       |

Fresh C03 manual verification: **PASS**.
