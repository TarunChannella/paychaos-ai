# Phase 3F-B — Pure Deterministic INV-001…INV-012 Evaluators

```text
IMPLEMENTED             = YES
OFFLINE TESTED          = YES
REAL SUPABASE VERIFIED  = NO
MANUALLY VERIFIED       = NO
DOCUMENTED              = YES
ARCHITECT APPROVED      = YES
```

**ARCHITECT FINAL REVIEW: APPROVED.** The pure deterministic evaluator boundary is frozen. This is **not** the completion of Phase 3F — 3F-C (orchestration + append-only persistence + real verification) has not started, and official Phase 3F remains INCOMPLETE.

Two lifecycle states are deliberately `NO` and do **not** block freezing this boundary:

- **REAL SUPABASE VERIFIED = NO** — the pure evaluator → real frozen evidence → persistence integration belongs to Phase 3F-C. Nothing in 3F-B touches a database, so there is no evaluator/persistence path to verify against the real project yet.
- **MANUALLY VERIFIED = NO** — Phase 3F-B intentionally has no independent manual payment or database step. Final Phase 3F manual verification belongs to 3F-C/3H.

### Accepted final gates

```text
Focused (tests/unit/invariants)                  5 files /  295 tests /  295 passed / 0 failed
Frozen regressions (evidence + chaos + supabase) 34 files / 1179 tests / 1179 passed / 0 failed
Full offline (npx vitest run)                   82 files / 2234 tests / 2234 passed / 0 failed
Environmental retries                            0
Typecheck                                        PASS
Lint                                             0 errors, 1 pre-existing unrelated warning
Build                                            PASS on the first attempt in the final authority round
Prettier                                         PASS
git diff --check                                 PASS
```

Parent commit: `91feb29669ef8d5d3769dec63b94feaba5e01bea` (the frozen Phase 3F-A invariant foundation).

**This is evaluator logic only.** Phase 3F-B persists nothing. There is no `invariant_results` repository, no INSERT/UPDATE/UPSERT, no `evaluateChaosRun` orchestration, no evidence loading from Supabase, no chaos-run outcome derivation, no findings, no diagnosis, no recommendations, no reliability score, no UI, and no Phase 3G/3H work. No new migration was created.

---

## 1. All twelve evaluators implemented

Applicability preconditions transcribed from `docs/MONEY_INVARIANTS.md` §7 of each invariant, corrected in the architect semantic round:

| ID      | Name                                                    | Documented precondition (§7)                                                                                 | Behaviour when it does not hold                                                                                |
| ------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| INV-001 | Unique Webhook Protected Logic Once                     | event identity known, signature **verified** for real Razorpay evidence, sufficient merchant correlation     | `UNKNOWN` (evidence question, not inapplicability)                                                             |
| INV-002 | One Captured Payment, At Most One Fulfilment            | a specific Razorpay Payment is **correlated to an internal payment attempt/order**                           | no payment at all → `NOT_APPLICABLE`; payment present but chain unresolved → `UNKNOWN`                         |
| INV-003 | Failed Payment Never Marks Order Paid                   | the payment has **verified provider** failure evidence                                                       | `NOT_APPLICABLE`                                                                                               |
| INV-004 | Fulfilment Requires Verified Successful Payment         | one or more fulfilment records exist                                                                         | `NOT_APPLICABLE`                                                                                               |
| INV-005 | Invalid Webhook Signature Causes Zero Mutation          | an intentionally invalid signature test was performed (C03)                                                  | `NOT_APPLICABLE`                                                                                               |
| INV-006 | Processed Event Replay Preserves Final Business State   | source previously **verified**, event **already successfully processed**, known final state                  | no replay attempt → `NOT_APPLICABLE`; replay present but source unverified or no prior `SUCCEEDED` → `UNKNOWN` |
| INV-007 | Duplicate Delivery Creates No Duplicate Business Record | the same logical action was **triggered more than once**                                                     | `NOT_APPLICABLE`                                                                                               |
| INV-008 | Amount and Currency Consistency                         | a **captured payment** (authoritative capture `EXACTLY_ONE`) correlated to an internal payment attempt/order | complete search proving no capture -> `NOT_APPLICABLE`; capture unestablished, or path unresolved -> `UNKNOWN` |
| INV-009 | Failed Processing Is Atomic or Safely Retryable         | a processing attempt ended `FAILED`                                                                          | `NOT_APPLICABLE`                                                                                               |
| INV-010 | Fulfilment Has Exactly One Valid Payment Path           | a fulfilment exists                                                                                          | `NOT_APPLICABLE`                                                                                               |
| INV-011 | Payment State Is Legal, Monotonic and Convergent        | enough evidence to determine at least one transition or final state                                          | `UNKNOWN`                                                                                                      |
| INV-012 | Unsupported Event Causes No Business Effect             | the event type is **not** one of the three supported P0 events                                               | supported event → `NOT_APPLICABLE`; unresolved event → `UNKNOWN`                                               |

No INV-013, no INV-014, no P1 evaluator. The frozen scenario→invariant mapping in `lib/chaos/registry.ts` was **not** touched.

---

## 2. Production files

**New (3):**

- `lib/invariants/evaluator-utils.ts` — the state-legality matrix, integer money comparison, snapshot access, fulfilment counting, the protected business-state tuple, the C03 mutation comparison, deterministic evidence-ref dedupe/sort, and result construction.
- `lib/invariants/evaluators.ts` — the twelve evaluators plus the frozen `INVARIANT_EVALUATORS` table.
- `lib/invariants/evaluate.ts` — the pure dispatcher (`evaluateInvariant`, `evaluateAllInvariants`).

**Modified:** none. `lib/invariants/types.ts`, `lib/invariants/registry.ts`, every `lib/evidence/*` module, `lib/chaos/types.ts`, `lib/chaos/registry.ts`, `lib/supabase/types.ts` and every migration are byte-unchanged. No frozen contract was insufficient, so no STOP was raised.

---

## 3. Test files

**New (4):**

- `tests/unit/invariants/fixtures.ts` — synthetic fixture builders with fixed UUIDs
- `tests/unit/invariants/evaluators.test.ts` — behavioural PASS/FAIL/UNKNOWN/NOT_APPLICABLE matrix
- `tests/unit/invariants/determinism.test.ts` — repeatability and order-independence
- `tests/unit/invariants/evaluator-static-guard.test.ts` — 20 comment-stripped static safety assertions

Fixtures are **synthetic test fixtures**. They are never inserted into Supabase, never claimed as `RECORDED_TEST_EVIDENCE` or genuine `REAL_RAZORPAY_WEBHOOK` traffic, and never presented as merchant performance.

---

## 4. Result semantics

```text
PASS            the applicable condition is PROVEN satisfied
FAIL            the applicable violation is PROVEN
UNKNOWN         the rule applies but required evidence is missing,
                invalid, incomplete or ambiguous
NOT_APPLICABLE  the rule's precondition does not hold
ERROR           the evaluator system itself failed
```

Missing evidence never becomes `PASS`. `NOT_APPLICABLE` is never laundered into `UNKNOWN` and vice versa. `ERROR` is never converted to `UNKNOWN` or `FAIL`. A scenario ID alone never produces `FAIL`. `UNKNOWN` is authoritative and must never be scored or displayed as `PASS`.

`NOT_APPLICABLE` and `ERROR` envelopes are structurally **non-persistable**: they carry no `severity`, `expectedSummary` or `observedSummary`, so they cannot be passed where a persistable evaluation is expected. The compiler rejects the mistake before the database CHECK has to.

### The reading rule — "proven over captured snapshots"

A chaos run may carry several processing attempts, each with its own before/after snapshot. The evaluators deliberately do **not** pick a single "final" snapshot by timestamp — "latest wins" is exactly what the source of truth forbids as financial truth. Instead a violation is `FAIL` when **any** captured snapshot proves it; `PASS` requires the needed evidence to be present and no captured snapshot to show a violation. That reading is order-independent, clock-free and monotone, which is why shuffling the attempt arrays cannot change any result.

### Gaps are not a blanket UNKNOWN

`bundle.gaps` is never consulted as `gaps.length > 0 -> UNKNOWN` — the static guard asserts neither `gaps.length` nor `bundle.gaps` appears in the production surface. Each evaluator checks only the evidence its own rule requires, so a missing historical `state_before` can force INV-006 or INV-011 to `UNKNOWN` without poisoning a relational rule that remains fully provable from complete independent evidence.

---

## 5. Historical UNKNOWN behaviour

A `NOT_CAPTURED` snapshot is factual evidence **absence**. No evaluator reconstructs it from present-day rows, fabricates a webhook or processing attempt, or reinterprets a historical `NULL`.

- Historical pre-Phase-3E runs whose rules need snapshots correctly evaluate `UNKNOWN`.
- The legacy C03 run has no `mutationEvidence`, so INV-005 is `UNKNOWN` **permanently** and INV-004 is `NOT_APPLICABLE` (it has no fulfilment). Never backfilled.
- The fresh compatibility C03 run `c406dafd-d48f-4e1e-b092-030acbb5e32b` carries complete `mutationEvidence` and is therefore capable of a deterministic INV-005 result once 3F-C feeds it through the evaluator. **It was not executed in this sub-phase.**

---

## 6. Key rule decisions

**INV-001** — processing attempts are not effects. Two attempts, a replay attempt, or a retry after failure do not by themselves fail the rule. It counts persisted `fulfilments` whose `triggerProcessingAttemptId` names one of the canonical event's attempts; a fulfilment with no trigger correlation is `UNKNOWN`, never attributed by guesswork. **Preconditions are now enforced**: an unverified signature or a non-provider source is `UNKNOWN`, never an authoritative `PASS`, and an event with no internal payment/attempt correlation is `UNKNOWN`. A canonical row count **greater than one** is `FAIL`, not `UNKNOWN`: the count is a trusted persisted fact, so it directly proves the documented "must map to one canonical webhook record" clause is broken. A count that is `null` or `< 1` is unestablished or self-contradictory evidence, so it stays `UNKNOWN`.

**INV-003** — `payment.failed` is a failure _observation_, not permanent terminal truth. A capture resolution of `EXACTLY_ONE` **or** `INCOMPLETE_INTERNAL_CORRELATION` means the failure-only premise is false, so no violation is concluded. `SEARCH_INCOMPLETE`/`NO_SUBJECT`/`AMBIGUOUS_SUBJECT` are `UNKNOWN` — never `FAIL`, because reporting "no capture exists" from a search that could not have seen one is a false payment finding.

**INV-004** — implements the **complete five-condition rule** of §19 §8. The helpers are now split so each rule owns exactly its own clause:

| Condition                                                             | Helper                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1, 2 — linked payment exists; belongs to the order via its attempt    | `validateFulfilmentRelation` (shared with INV-010)            |
| 5a — order == attempt == payment money                                | `validateMerchantMoneyConsistency` (shared with INV-008)      |
| 5b — **relevant trusted webhook money matches the canonical payment** | `validateTrustedWebhookMoneyForPayment` (shared with INV-008) |
| 3, 4 — authoritative capture exists and is verified server-side       | the bundle's capture resolution + a trust re-confirmation     |

Condition 5b closes a real hole: order/attempt/payment could all read 50000 INR while the verified `payment.captured` webhook said 49999, and INV-004 previously passed. That is now `FAIL`. A relevant trusted webhook missing either money component is `UNKNOWN`.

**Every observed fulfilment is validated independently.** §19 §8 says "for EVERY P0 fulfilment row". The evaluator previously iterated merchant _paths_ and validated only the fulfilments those paths happened to carry, so a fulfilment observed in a snapshot whose payment/attempt evidence was missing could be silently skipped while a different, complete path produced an authoritative `PASS`. Each distinct observed `FULFIL_ORDER` row now resolves its own chain and is judged on that chain alone:

```text
directly observed wrong payment / attempt / order   -> FAIL
its relational path was not captured completely     -> UNKNOWN (never skipped)
more than one distinct chain resolves               -> UNKNOWN (no single path to validate)
exactly one chain                                   -> conditions 3, 4, 5 judged on THAT path
```

One globally valid path never authorises another fulfilment, and an unrelated path's money mismatch never poisons a different fulfilment.

A path counts as evidence about a fulfilment only when that fulfilment appears in the path's own captured collection. `path.fulfilments` is the set observed alongside that path's order/attempt/payment, so a disagreement inside it is a directly observed wrong relation and proves `INVALID`; a path for some other payment is simply not evidence about this fulfilment and must not manufacture a `FAIL` from unrelated data.

### Authoritative capture authority

**Capture authority is bound to the LINKED PAYMENT, not to the run.** A run-level `authoritativeCapture.kind === "EXACTLY_ONE"` is necessary but is **never blindly trusted**: the resolved capture must actually be about the payment the fulfilment's chain points at. The shared pure helper `validateAuthoritativeCaptureForPayment(bundle, payment)` requires **all** of the following before granting authority:

```text
authoritativeCapture.kind === "EXACTLY_ONE"
the resolution's own webhook exists
authoritativeCaptureWebhook exists
capture.webhook.id === authoritativeCaptureWebhook.id   (same persisted row)
sourceKind === REAL_RAZORPAY_WEBHOOK                    (never PAYCHAOS_REPLAY)
signatureVerified === true
eventType === "payment.captured"
INTERNAL identity: paymentId !== null
                   AND paymentId === payment.id
PROVIDER identity: razorpayPaymentId !== null
                   AND razorpayPaymentId === payment.razorpayPaymentId
```

**Both identities are required — `AND`, never `OR`.** The previous rule accepted either one, so a capture whose provider id matched while its internal id named a _different_ payment (or the reverse) could grant authority. That contradictory shape is exactly what the frozen contract classifies as `INCOMPLETE_INTERNAL_CORRELATION`, and an `EXACTLY_ONE` code path must not quietly recreate that weaker state as authority. The merchant-processing success contract likewise requires every payment relationship to agree before fulfilment.

The resolution and the projection must also identify the **same persisted webhook row**; a disagreement is inconsistent evidence and choosing one would be arbitrary. No timestamp, no "latest", no array position.

`capturedAt` and `checkoutSignatureVerified` are merchant-side facts and are **never** provider capture authority.

**Disposition.** `INVALID` is reserved for the one case the evidence PROVES: a completed search established that no capture exists. Every malformed or internally inconsistent authority case — missing projection, row-id disagreement, wrong source kind, unverified signature, wrong event type, NULL or contradicting internal id, NULL or contradicting provider id — is `INDETERMINATE`, so the consuming invariant reports `UNKNOWN` unless an independent deterministic rule has already proven a `FAIL`. Inconsistent evidence never fabricates a `FAIL` in the pure evaluator layer. Phase 3F-C may later surface an impossible persistence-level contradiction as a typed integrity `ERROR` at its orchestration boundary; **3F-B implements no persistence errors.**

The same helper serves INV-004 conditions 3/4, INV-010's authoritative-success clause, and INV-011's `OPEN → FULFILLED` authority. INV-003's capture-search semantics are deliberately untouched.

`payments.captured_at` alone is never provider authority (the merchant RPC sets it, so it is circular), and `checkoutSignatureVerified` alone never satisfies condition 3.

**INV-010 is a NARROW RELATIONAL/CAPTURE RULE and carries no money clause at all.** §25 §8 contains no amount/currency condition; money consistency is INV-008's rule, and failing INV-010 for a money mismatch would double-report one defect under two invariants. A test asserts the separation directly: identical evidence yields INV-010 `PASS` and INV-008 `FAIL`.

INV-010 also now genuinely enforces "joined valid path count = 1". For each fulfilment it derives **distinct** relational chains keyed by `(payment, attempt, order)` identity, so repeated before/after observations of the same chain count once. Exactly one → eligible `PASS`; more than one → `FAIL` as ambiguous; zero with a proven invalid chain → `FAIL`; zero because no chain was captured → `UNKNOWN`.

Its authoritative-success clause is bound **per resolved payment** through the same capture helper, not to the run: `NONE_OBSERVED` for the linked payment is `FAIL`; a missing, unverified, wrong-typed or different-payment capture is `UNKNOWN`, never `PASS`. Money remains entirely outside this rule.

**INV-007** — applicability is **repeated triggering**, not "an order is correlated". Established only from approved facts: `is_duplicate_delivery`, chaos replay attempts, the canonical event's duplicate delivery count, or more than one processing attempt. A normal one-shot order is `NOT_APPLICABLE` and never receives a persisted PASS for a duplicate-delivery invariant whose precondition never occurred. A scenario ID never establishes applicability.

**INV-005** — ARCH-3F-013 is implemented: an `UNEXPECTED_ACCEPTANCE` on either frozen case is `FAIL` regardless of a zero delta, because C03's verification-only mechanism means an acceptance _cannot_ produce a mutation and reading deltas alone would report "unchanged" for a merchant whose webhook authentication is broken. A truncated collection (`complete: false`) is `INCOMPLETE` → `UNKNOWN`: two truncated prefixes are never compared and called unchanged.

**INV-008** — exact integer smallest-subunit equality with currency compared alongside. `NULL` is never defaulted to `0` or `"INR"`; a missing required value is `UNKNOWN`. No `parseFloat`, no `toFixed`, no epsilon, no rounding — the static guard asserts all four are absent.

The trusted-webhook money clause no longer runs only when both components are non-null. A webhook that is trusted AND relevant to the evaluated payment but carries a `NULL` amount or a `NULL` currency is _missing required evidence_ → `UNKNOWN`, never a silently skipped comparison. **Both** safe trusted surfaces are consulted — `sourceWebhook` and `authoritativeCaptureWebhook` — deduped by id, and relevance is exact identity only (internal `paymentId`, or trusted `razorpayPaymentId`), so an unrelated or untrusted webhook can never become money authority.

**Applicability is established BEFORE any money comparison.** The evaluator previously compared money first and only then checked capture, which let the rule's own result establish its own applicability — a payment that is definitively NOT captured could be reported `FAIL` for a money mismatch under a rule whose precondition it never satisfied. The order is now strictly:

```text
1. establish the payment -> payment_attempt -> order relational subject
     not established                      -> UNKNOWN, stop
2. establish the CAPTURED-payment precondition
     NONE_OBSERVED                        -> NOT_APPLICABLE, stop (no money compared)
     any other non-EXACTLY_ONE resolution -> UNKNOWN, stop (no money FAIL)
     EXACTLY_ONE + trusted exact capture  -> continue
3. only now, the deterministic integer money rule
     mismatch                             -> FAIL
     required value missing               -> UNKNOWN
     all equal                            -> PASS
```

A violation may dominate incomplete _money_ evidence only after the invariant has been proven applicable.

§23 §7 says "a **captured** payment has been correlated to an internal payment attempt/order". Resolving the relational chain is only half of that. The capture half is judged by the shared helper above:

```text
EXACTLY_ONE + verified capture webhook   -> precondition satisfied
NONE_OBSERVED (complete search)          -> NOT_APPLICABLE (precondition proven false)
SEARCH_INCOMPLETE / NO_SUBJECT /
AMBIGUOUS_SUBJECT / AMBIGUOUS /
INCOMPLETE_INTERNAL_CORRELATION          -> UNKNOWN
```

`NOT_APPLICABLE` for `NONE_OBSERVED` follows §32: a proven-false precondition means the rule does not logically apply. §16's "missing amount evidence → UNKNOWN" governs an unestablished _amount_, which is a different question and is handled separately. A merchant `capturedAt`, or a verified Checkout signature, never substitutes for provider capture. A proven money mismatch always dominates an indeterminate value.

**INV-009** — a processor may fail safely; "a processor error occurred" is never itself a violation. All **four** conditions of §24 §8 are now checked, not just the tuple comparison:

1. no protected fulfilment is durably attributed to the failed attempt (`triggerProcessingAttemptId`) → otherwise `FAIL`;
2. no partial business/payment mutation owned by it survives → otherwise `FAIL`;
3. the canonical event is not left `PROCESSED` with no independent `SUCCEEDED` attempt → otherwise `FAIL`;
4. retry remains possible unless an earlier independent successful attempt already completed the same logical effect.

**Retryability is proven from the architecture, not inferred from a negative fact.** "Not `PROCESSED`" does not by itself prove a retry can succeed. What the current frozen architecture does prove is narrower and specific: `supabase/migrations/20260828000000_phase2f_merchant_processing.sql` (lines ~655–662) writes `webhook_events.processing_status = 'PROCESSED'` **only** inside the same transaction that marks the attempt `SUCCEEDED` and commits the merchant mutation, and **no migration or application module ever writes `'PROCESSING'` or `'FAILED'`** to that column. So:

```text
RECEIVED    + no partial mutation + no attributed fulfilment  -> PASS
            (the transaction demonstrably rolled back, and the ordinary retry
             path — a fresh PENDING attempt on a later delivery — remains open)
PROCESSED   + no independent SUCCEEDED attempt                -> FAIL
PROCESSED   + independent SUCCEEDED attempt                   -> PASS
PROCESSING  -> UNKNOWN     (a state this architecture never writes)
FAILED      -> UNKNOWN     (a state this architecture never writes)
source unresolvable                                           -> UNKNOWN
```

**INV-011** — transitions come from each attempt's own before/after pair (a genuine observed transition), never from event arrival order or "latest timestamp wins". An **unrecognised** status value is `UNRECOGNISED` → `UNKNOWN`, deliberately distinct from `ILLEGAL`, so an unfamiliar string can never manufacture a false `FAIL`.

**Corrected — the legal set was widened and is now exact.** The first implementation additionally accepted `UNPAID → UNPAID`, `PENDING → PENDING` and `FAILED_OBSERVED → FAILED_OBSERVED` as members of the frozen set. They are not in `docs/MONEY_INVARIANTS.md` §26 §8 Rule A. The helper now returns a fourth verdict, `NO_TRANSITION`, for any self-transition other than `PAID → PAID`: the status did not move, so there is no transition for Rule A to judge. `NO_TRANSITION` is never reported as `LEGAL`, and a test enumerates all 16 status pairs to assert exactly **seven** legal members. `PAID → PAID` remains explicitly legal.

**Corrected — "successful processing" was too broad, then too permissive.** Rule C originally treated `status !== FAILED` as success, so an in-flight or skipped attempt produced a false convergence `FAIL`. The first correction swung to reporting all four as `PASS`, which is equally wrong: `PENDING`/`HELD`/`PROCESSING` prove processing has _not_ completed, and `SKIPPED_DUPLICATE` did no work. Rule C's precondition is then simply unmet, so convergence is **UNPROVEN**:

```text
capture + capture-event SUCCEEDED + PAID          -> PASS
capture + capture-event SUCCEEDED + non-PAID      -> FAIL
capture + PENDING / PROCESSING / HELD             -> UNKNOWN
capture + SKIPPED_DUPLICATE alone                 -> UNKNOWN
capture + no attempt correlated to the capture    -> UNKNOWN
capture + SUCCEEDED but after-state order absent  -> UNKNOWN
```

**Corrected — convergence is bound to the CAPTURE EVENT.** Rule C previously looked at every `SUCCEEDED` attempt. A `SUCCEEDED` attempt that processed `payment.failed` and left the order `FAILED_OBSERVED` is not the capture processor, and judging it as one produced a false `FAIL` for the entirely legitimate failure-then-later-capture sequence. Convergence-processing evidence is now correlated by exact identity — `attempt.webhookEventId === authoritativeCaptureWebhook.id` — with no timestamp ordering anywhere.

---

**INV-012** — disposition priority is now strict: a proven protected mutation **anywhere** is `FAIL`; otherwise **any** relevant attempt missing a complete before/after pair is `UNKNOWN` (a complete pair elsewhere never excuses an incomplete one); otherwise complete zero mutation from **verified provider** evidence is `PASS`. Untrusted evidence can never manufacture an authoritative `PASS`.

**INV-003** — verified failure authority is a trusted provider `payment.failed` event. A merchant-side `payments.failed_at` alone is bookkeeping written by our own processor, so it is supporting evidence only and can never by itself establish the precondition — exactly as `captured_at` can never establish provider success.

**INV-011 — `OPEN → FULFILLED` is conditional, not legal.** `docs/MONEY_INVARIANTS.md` §12 lists it among the **invalid** transitions "unless the order has authoritative successful payment evidence and a valid fulfilment row is being committed". The helper previously returned a bare `LEGAL` from the two status strings alone. It now returns a distinct `REQUIRES_FULFILMENT_AUTHORITY` verdict, and INV-011 checks both conditions against the frozen evidence via a small `fulfilmentAuthority` helper that reuses the same capture resolution and relational helper — deliberately not a second copy of the INV-004 evaluator:

Condition 2 is about **this transition**, not merely about the after-state. A fulfilment that already existed BEFORE the transition was committed by something else and cannot authorise this one. "Newly committed by this attempt" is proven from persisted IDs only — the row appears in `after.fulfilments` and not in `before.fulfilments`, and its `triggerProcessingAttemptId` equals THIS pair's `attemptId`. No `appliedAt` timestamp is read and no ordering is inferred.

```text
new row committed by THIS attempt + valid relation + exact capture  -> legal, eligible PASS
the fulfilment row already existed before the transition            -> FAIL
the new row was committed by ANOTHER processing attempt             -> FAIL
proven absent capture for the linked payment                        -> FAIL
a new row carries no trigger attribution                            -> UNKNOWN
before/after fulfilment collection uncaptured                       -> UNKNOWN
capture incomplete / unverified / wrong type / wrong payment        -> UNKNOWN
FULFILLED -> OPEN                                                   -> always ILLEGAL
```

---

## 6b. Nested snapshot completeness

`{ kind: "CAPTURED" }` only means the JSON parsed. `MerchantStateSnapshotV1` legitimately permits `order`, `paymentAttempt`, `payment` and `fulfilments` to be `null`, so **two absent nested values comparing equal is not proof of "unchanged"**. The first implementation used exactly that equality as positive evidence.

A minimal helper — not a new evidence framework — derives what each rule needs from the run's own truthful correlations (`requiredEntitiesFromRun`) and reports what a snapshot failed to resolve (`missingRequiredEntities`). The ordering rule everywhere is:

```text
1. a PROVEN violation dominates                       -> FAIL
2. else any required evidence missing                 -> UNKNOWN
3. else complete evidence + safe value                -> PASS
```

Applied to INV-001, INV-006, INV-007, INV-009 and INV-012. Unrelated gaps still cannot poison an invariant: only the entities a rule actually requires are checked, and a run with no correlated payment does not require a payment snapshot.

---

## 7. State legality helper

`lib/invariants/evaluator-utils.ts` encodes the frozen matrix exactly. It is a small pure lookup, not a workflow framework.

```text
LEGAL                          UNPAID -> PENDING            UNPAID -> PAID
                               PENDING -> FAILED_OBSERVED   PENDING -> PAID
                               FAILED_OBSERVED -> PENDING   FAILED_OBSERVED -> PAID
                               PAID -> PAID

ILLEGAL                        PAID -> PENDING              PAID -> FAILED_OBSERVED
                               PAID -> UNPAID               FULFILLED -> OPEN
                               CAPTURED attempt -> anything weaker (Rule E)

NO_TRANSITION                  every other self-transition (status did not move)

REQUIRES_FULFILMENT_AUTHORITY  OPEN -> FULFILLED (conditional, see above)
```

Plus Rule C (verified capture must converge to `PAID` after successful processing) and Rule D (`FULFILLED` implies `PAID`). Every transition above has its own test.

---

## 8. Determinism proof

`tests/unit/invariants/determinism.test.ts` asserts two independent properties across **eight** representative bundles (healthy, relational violation, replay, failure-only, complete C03, legacy C03, no-snapshot historical, unsupported event), covering all twelve invariants in each:

1. **Repeatability** — ten evaluations of the identical bundle serialize byte-identically.
2. **Order independence** — reversing every order-irrelevant array (both attempt arrays and the fulfilment list inside every snapshot) produces byte-identical output, asserted separately for `evidenceRefs`, `reason`, `disposition` and both summaries.

Additionally, `Date.now` and `Math.random` are spied on and asserted **never called** during a full twelve-invariant evaluation.

Evidence references are deduped, sorted by frozen kind order then UUID, and contain only `{kind, id}` internal UUIDs — asserted by test, including that no ref carries a third field.

**Corrected — references are now per-invariant.** The first implementation attached the run's order/attempt/payment correlations to every result whether or not the rule read them. Each evaluator now names only the records it actually used. The chaos run remains on every result: it is the record the evaluation is about, and for INV-005 it is the record the mutation evidence physically lives on. Two tests assert this directly — a `NOT_APPLICABLE` INV-002 and a passing INV-005 each reference `CHAOS_RUN` and nothing else.

---

## 9. No persistence, no I/O

`tests/unit/invariants/evaluator-static-guard.test.ts` runs 20 assertions over **comment-stripped** source of all three production files. Assertion 2 proves the guard really is comment-blind: `evaluators.ts` legitimately names `invariant_results` in prose, and the stripped source must not contain it.

Forbidden and asserted absent: `@/lib/supabase`, `createClient`, `.from(`, `.rpc(`, `invariant_results`, `.insert(`, `.update(`, `.upsert(`, `.delete(`, `INSERT`, `UPSERT`, `fetch(`, `axios`, `node:https?`, Razorpay imports/URLs, `process.env`, `node:fs`, `Date.now(`, `new Date(`, `Math.random(`, `randomUUID`, `performance.now`, `openai`/`anthropic`/`ollama`/`llm`/`gpt-`, `diagnosis`/`rootcause`/`recommendation`/`reliability_score`/`createfinding`/`regression_run`, `parseFloat`/`toFixed`/`Math.round`/`epsilon`, every secret name, `normalized_event`/`raw_payload_redacted`/`raw_body_sha256`/signature/PII fields, `console.*`, `gaps.length`/`bundle.gaps`, and `@/lib/chaos/registry`.

Assertion 17 additionally proves every import from `@/lib/evidence/*` is **type-only**, so no evidence model is rebuilt and no repository is reachable. Assertion 20 re-verifies the frozen Phase 3F-A contracts are intact.

---

## 10. ERROR boundary (Phase 3F-B scope)

Individual evaluators are pure and have no fallible external dependency, so they never need `ERROR`. Expected missing or ambiguous factual evidence is `UNKNOWN`, and malformed-but-recognisable evidence follows the documented evidence semantics — normally `UNKNOWN`. No evaluator throws to represent payment truth.

The **one** place `ERROR` is genuinely reachable is the dispatcher, when the frozen catalogue and the frozen evaluator table disagree about an ID — an impossible internal contract state, not a fact about payment truth. It is returned as the structurally non-persistable disposition, so it can never reach `invariant_results` as a verdict.

**Repository/database-dependent ERROR behaviour is out of scope here and belongs to Phase 3F-C**, where a failed evidence load or a failed persistence call must be represented truthfully.

---

## 11. Gates

```text
Focused (tests/unit/invariants)                  5 files /  295 tests /  295 passed / 0 failed
Frozen regressions (evidence + chaos + supabase) 34 files / 1179 tests / 1179 passed / 0 failed
Full offline (npx vitest run)                   82 files / 2234 tests / 2234 passed / 0 failed
Typecheck                                       PASS
Lint                                            0 errors, 1 pre-existing unrelated warning
Build                                           PASS (after one documented .next EPERM cleanup retry)
Prettier                                        PASS
git diff --check                                PASS
Environmental retries                           0 for tests
```

The first-round suite (2135 tests) is **not** evidence of semantic correctness for the corrected rules: several of its fixtures encoded the same incorrect interpretation the architect review found. Every correction therefore carries a targeted regression test whose fixture would have produced the WRONG disposition under the old implementation — marked `ARCHITECT REGRESSION` in `evaluators.test.ts`.

**No real-Supabase test was run**, by design (task §45). The applied Phase 3F-A schema was not touched, `063` was not executed, and no migration was created or re-applied.

---

## 12. Known issues

**Open — architect judgement recorded, not settled by me.** INV-001 reports a canonical row count `> 1` as `FAIL` rather than `UNKNOWN`. My reading is that the count is a trusted persisted fact and the rule's own wording ("must map to one canonical webhook record") makes `> 1` a proven breach. An architect who reads that clause as a precondition rather than a checked condition would prefer `UNKNOWN`. The decision point is flagged here so it can be reversed cheaply — it is a single branch in `evaluateInv001`.

**Open — INV-009 condition 4 rests on an architectural fact, not a stored one.** `RECEIVED` is read as "the transaction rolled back and retry remains open" because the Phase 2F migration writes `PROCESSED` only in the successful branch and nothing ever writes `PROCESSING`/`FAILED`. That inference is sound for the CURRENT architecture and is cited in §6. If a later phase starts writing those statuses, this branch must be revisited: the evaluator would then be reading a status whose meaning has changed. `PROCESSING`/`FAILED` already return `UNKNOWN` rather than guessing.

**Open — INV-008 returns `NOT_APPLICABLE` for `NONE_OBSERVED`.** §32 supports it (a proven-false precondition is inapplicability), and §16's UNKNOWN rule governs unestablished _amounts_ rather than a proven-absent capture. An architect who reads the two sections the other way would prefer `UNKNOWN`. It is a single branch and is flagged for reversal rather than buried.

**Open — INV-004 reports `UNKNOWN` when a fulfilment resolves more than one distinct chain.** §19 §8 has no ambiguity clause of its own (that is INV-010's "path count = 1"), so this evaluator declines to pick a path rather than validating an arbitrary one. An architect who wants INV-004 to inherit INV-010's ambiguity `FAIL` would change one branch.

**Open — INV-011 Rule C needs the capture event's own processing attempt.** Where genuine capture evidence exists but no attempt is correlated to that webhook id, the result is `UNKNOWN`. That is truthful, but it means a run whose capture was processed before snapshot instrumentation existed will report `UNKNOWN` rather than `PASS`. That is the intended historical behaviour, not a defect — it is recorded here so it is not mistaken for one later.

One scope limitation to state plainly: the relational invariants (INV-002/004/007/008/010) are proven here only against **synthetic in-memory fixtures**. Real database integration proof for those rules is not deleted — it is deferred to 3F-C, where real frozen Phase 3E evidence flows through these evaluators into append-only persistence and the whole path is verified together. Nothing in this sub-phase should be read as a claim that database-dependent invariant properties were integration verified.

---

## 13. Deferred to Phase 3F-C

1. `evaluateChaosRun` orchestration: load a real bundle → evaluate → persist.
2. The append-only `invariant_results` repository (INSERT only; the table grants no UPDATE to any role).
3. Application-level duplicate-evaluation idempotency against the partial unique index `(chaos_run_id, invariant_id) WHERE chaos_run_id IS NOT NULL`.
4. Repository/database `ERROR` behaviour.
5. Deciding which envelopes are persisted — `NOT_APPLICABLE` and `ERROR` must be filtered out, never coerced.
6. Real-Supabase verification of the evaluator→persistence path, including feeding the fresh C03 run `c406dafd-…` through INV-005.
7. Chaos-run outcome derivation, findings, diagnosis, recommendations and reliability scoring remain Phase 4+.

---

## 14. Do not break

- Evaluators stay pure: no I/O, no clock, no randomness, no AI, no persistence.
- `NOT_APPLICABLE` and `ERROR` never reach `invariant_results`.
- Missing evidence is `UNKNOWN`, never `PASS`.
- `NO_SUBJECT`/`AMBIGUOUS_SUBJECT`/`SEARCH_INCOMPLETE` are factual search states, never evidence that no capture exists.
- `captured_at` alone and a Checkout signature alone are never fulfilment authority.
- Money stays integer smallest-subunit with currency compared alongside; `NULL` is never defaulted.
- The frozen Phase 3F-A types/registry, the frozen evidence contract, and the frozen chaos registry stay unchanged.
- Historical evidence is never backfilled or reconstructed.

---

## 15. Next dependency

Architect review of this sub-phase, then Phase 3F-C: orchestration plus append-only persistence, verified together against the real database.
