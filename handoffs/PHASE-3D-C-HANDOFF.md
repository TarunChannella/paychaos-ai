# Phase 3D-C — C11 Captured Sanitized `payment.failed` Test Fixture Handoff

**Project:** PayChaos AI — Autonomous Payment Reliability Engineer
**Branch:** `phase-3-chaos-engine`
**Frozen Phase 3D-B commit:** `82e730772b32879ca6e3ee5885ea7a7f373ee031`
**Sub-phase:** Phase 3D-C — C11 (Failed Payment Must Never Mark Order Paid, `docs/CHAOS_SCENARIOS.md` Section 23) — captured sanitized `payment.failed` TEST_FIXTURE source resolution ONLY. Not C11-A manual observation, not C11-B runtime replay (Phase 3D-D).

---

## 1. Status

```text
IMPLEMENTED                     = YES
TESTED                          = YES
REAL SUPABASE MECHANICS VERIFIED = YES
AUTHENTIC SOURCE VERIFIED       = YES
DOCUMENTED                      = YES

APPROVED                        = YES
```

**Final approval:** Phase 3D-C is architect-approved after authentic Test Mode source verification, fixture sanitization/provenance review, the `SYNTHETIC_DEMO` + `PAYCHAOS_REPLAY` execution-provenance correction, the all-six-resource post-test cleanup proof, and full regression verification. Approval covers only C11 captured sanitized `payment.failed` TEST_FIXTURE resolution — Phase 3D-D (C11-B runtime replay/execution) is a separate, not-yet-approved sub-phase.

## 2. Objective

Produce a source-controlled, sanitized `payment.failed` fixture derived from one genuine Razorpay Test Mode failed payment, prove it is safe (no secrets/signatures/customer data), prove it exercises the frozen production normalizer and merchant-processing transaction deterministically, and do all of this WITHOUT enabling any runtime `TEST_FIXTURE` chaos path, WITHOUT a migration, and WITHOUT modifying any frozen production file. The approved architecture (Option A) is: source-controlled fixture file + dedicated deterministic test infrastructure + no runtime `TEST_FIXTURE` chaos-run path + no migration.

---

## 3. Authentic Source Evidence

The fixture was derived from ONE genuine Razorpay Test Mode failure (Netbanking failure path), captured and independently verified in the prior Phase 3D-C read-only rounds before any file was created:

```text
webhook_event_id      = e0df759e-bbde-45c3-aa80-a5a2d6b61be9
event_type            = payment.failed
source_kind           = REAL_RAZORPAY_WEBHOOK
signature_verified    = true
processing_status     = PROCESSED
duplicate_delivery_count = 0
payment_attempt_id    = 1f83af21-3e9c-4e72-ad9d-db3a7c26eadc
payment_id            = f7198ed0-59a9-4899-aa1e-5162001b94be
razorpay_order_id     = order_TUu1sBTobquvVB
razorpay_payment_id   = pay_TUu26Ptu3IZvXB
correlated internal order = 0ab36811-f32b-461c-a89f-98dfc62afe37
```

Observed real merchant safety result at capture time (independently re-verified, read-only, before this implementation round):

```text
order.payment_status   = FAILED_OBSERVED (never PAID)
order.business_status  = OPEN (never FULFILLED)
fulfilment count        = 0
payment_attempts.status = FAILED_OBSERVED
payments.razorpay_payment_status = failed
payments.captured_at    = null
payments.failed_at      = set
```

This real row was NEVER MUTATED by this implementation round — no `UPDATE`/`INSERT`/`DELETE` in this round ever targeted it. It MAY be, and was, read-only rechecked: `057`'s final describe block performs an optional `SELECT` against it (asserting its identity fields if present, never failing the suite merely because it is absent from a future Supabase environment). The fixture's actual content was derived entirely from facts already captured in the prior read-only rounds and recorded in the architect's own message for this task, not from any query this round issued.

---

## 4. Why The Fixture Is Authentic-But-Sanitized

`webhook_events.raw_payload_redacted` for the source event above is itself already an allowlist-sanitized projection — `lib/webhooks/redaction.ts`'s `buildRedactedWebhookEvidence` never copies email/contact/phone/VPA/card/bank/notes/tokens/method/signature fields, by construction (none of those field names exist in its allowlist). The original unredacted raw webhook body was never persisted anywhere in this application (only its SHA-256 integrity hash) and therefore cannot be, and is not, reproduced in the fixture. The fixture's `payload` object is the same allowlisted shape (`event`, `entity`, `created_at`, `payment.{id, order_id, amount, currency, status, error_code, error_source, error_step, error_reason}`), with only structural envelope keys — no invented business/error facts.

---

## 5. Fixture Transformations (Sanitization Applied)

- **Provider IDs replaced**: `payment.id` → `pay_fixture_c11_failed_001`, `payment.order_id` → `order_fixture_c11_failed_001`, and a `fixtureRazorpayEventId` of `evt_fixture_c11_failed_001` — never the merchant's real captured Test Mode IDs.
- **All business/error semantics preserved unchanged** from the authentic redacted source: `status=failed`, `currency=INR`, `amount=50000`, `error_code=BAD_REQUEST_ERROR`, `error_source=bank`, `error_step=payment_authorization`, `error_reason=payment_failed`.
- **Provenance metadata added** (`metadata` object) — classification, provenance, source event type, sanitization flags, source canonical webhook event ID (for audit only), and an explicit statement that runtime `source_kind` must never be `REAL_RAZORPAY_WEBHOOK` for this fixture.
- **No secret/signature/card/customer field was ever present to remove** — confirmed by the redaction allowlist's own source code and independently re-proven by this round's recursive forbidden-key unit test.

---

## 6. Fixture Classification / Provenance

```text
metadata.classification = TEST_FIXTURE
metadata.provenance     = CAPTURED_RAZORPAY_TEST_MODE_FIXTURE
metadata.sourceEventType = payment.failed
metadata.sanitized      = true
```

---

## 7. Files Changed

**New (only):**

```text
tests/fixtures/razorpay/payment-failed-test-mode.fixture.json
tests/unit/fixtures/c11-payment-failed-fixture.test.ts
tests/unit/supabase/057-chaos-c11-fixture-provenance-guard.test.ts
tests/integration/supabase/057-chaos-c11-payment-failed-fixture.integration.test.ts
handoffs/PHASE-3D-C-HANDOFF.md   (this document)
```

**Modified: NONE.** No production file was touched. `lib/chaos/repository.ts`, `lib/chaos/safety-gate.ts`, `lib/chaos/run-service.ts`, `lib/chaos/types.ts`, `lib/chaos/registry.ts`, `lib/events/normalization.ts`, `lib/events/processor.ts`, `lib/webhooks/redaction.ts`, `lib/webhooks/repository.ts`, `lib/webhooks/event-processing-repository.ts`, `lib/supabase/types.ts`, the webhook route, and every migration remain byte-for-byte unchanged.

---

## 8. Database Changes

**NONE.** No migration. `event_processing_attempts.source_kind`/`webhook_events.source_kind` CHECK constraints were not modified — `TEST_FIXTURE` remains a documented future value (`docs/DATABASE.md` "Column/Value Phasing Note"), not currently accepted by either table.

---

## 9. Runtime TEST_FIXTURE Support — Intentionally NOT Implemented

`lib/chaos/repository.ts`'s `loadC11TestFixtureFailureEvidence` continues to always return `null`. `failureEvidence.kind = TEST_FIXTURE` cannot reach `PRECHECK_PASSED` at runtime. Confirmed unchanged by the frozen regression test (`tests/unit/chaos/safety-gate.test.ts`, "Mechanism B (TEST_FIXTURE) always blocks with PRECHECK-07"), which still passes verbatim. No `chaos_runs`, `event_processing_attempts`, or `webhook_events` row created anywhere in this round ever claims `TEST_FIXTURE` provenance.

---

## 10. Tests

### A. Fixture provenance/security + normalization unit test

`tests/unit/fixtures/c11-payment-failed-fixture.test.ts` (offline, no I/O):

- exact required metadata fields present (classification/provenance/sourceEventType/sanitized/sourceSignatureVerifiedAtCapture/runtimeSourceKindMustNeverBe/sourceCanonicalWebhookEventId);
- `payload` contains no secret/signature/customer/card credential keys recursively (structural key-name scan, not a serialized-text search) — covering `email`, `contact`, `phone`, `vpa`, `upi`, `card`/`card_number`, `pan`, `cvv`, `otp`, `token`, `signature`/`razorpay_signature`, `authorization`, `bank_account`, `customer`, `key_secret`, `webhook_secret`, `service_role`, `password`;
- `metadata` contains ONLY the exact allowlisted provenance keys (a closed-set assertion, not merely "no forbidden key") — so a future unreviewed metadata field cannot be silently added;
- payment status/currency/error fields match the authentic captured semantics;
- provider IDs are deterministic fixture-only values;
- the frozen, unmodified `normalizeRazorpayEvent` accepts the fixture and produces the exact expected `NormalizedPaymentFailedEvent` shape. Its `sourceKind` field reads `REAL_RAZORPAY_WEBHOOK` in the output — this is a structural artifact of the pure normalizer's fixed output shape (it stamps this literal on every call regardless of input origin), documented explicitly in the test as NOT a provenance claim.

### B. Frozen C11 TEST_FIXTURE PRECHECK-07 BLOCKED regression

`tests/unit/chaos/safety-gate.test.ts` + `tests/unit/chaos/repository.test.ts` — unchanged, still pass verbatim.

### C. Real-Supabase processor mechanics test

`tests/integration/supabase/057-chaos-c11-payment-failed-fixture.integration.test.ts` — see Section 11 below.

---

## 11. Processor Mechanics Test (057)

**Correction round:** the first implementation of this file used the live-ingestion `insertEventProcessingAttempt` with no `chaos_run` at all, causing the processing attempt to durably carry `source_kind = REAL_RAZORPAY_WEBHOOK` — indistinguishable from a genuine fresh provider delivery. This was a BLOCKING finding and has been corrected to exactly the approved Option A / `053`-established pattern below.

**Classification:** MECHANICS ONLY — never a genuine provider-delivery claim. This file imports nothing from a C11 execution service (none exists yet — Phase 3D-D), creates no `RECORDED_TEST_EVIDENCE` row, and calls neither `runChaosPrecheck` nor `createChaosRun`. A static regression guard (`tests/unit/supabase/057-chaos-c11-fixture-provenance-guard.test.ts`) enforces this so it cannot silently regress again.

**Exact mechanics pattern used, mirroring `053-chaos-replay-execution.integration.test.ts` precisely:**

1. isolated synthetic order/payment_attempt/payment (unresolved);
2. one **SYNTHETIC CANONICAL COMPATIBILITY** `webhook_events` row (`source_kind = REAL_RAZORPAY_WEBHOOK`, `signature_verified = true`) — required only because the frozen schema currently accepts no other literal for that column; fresh, per-run-unique tagged provider identifiers; carries the fixture's authentic business/error semantics unchanged; exists only in isolated test setup, never seen by any UI/demo/reliability path, never evidence for `PRECHECK_PASSED`;
3. one mechanics `chaos_runs` row — `scenario_id = C11`, `fault_type = null`, `data_classification = SYNTHETIC_DEMO` (asserted directly, never `RECORDED_TEST_EVIDENCE`);
4. the real, unmodified `normalizeRazorpayEvent`, proving deterministic normalization of the fixture-derived evidence (its output's `sourceKind` reads `REAL_RAZORPAY_WEBHOOK` — this describes the captured evidence's origin, a fact about layer 2 below, not this test's own execution provenance);
5. **exactly ONE** `insertReplayProcessingAttempt(...)` call (never `insertEventProcessingAttempt`), durably persisting `source_kind = PAYCHAOS_REPLAY`, `chaos_run_id = <the SYNTHETIC_DEMO run>`, `is_duplicate_delivery = false` — all independently re-asserted from the database after the call, not merely assumed from the insert's return value;
6. the real, unmodified `processMerchantWebhookEvent`.

Three distinct provenance layers, documented in the file's own module doc comment and enforced by the guard: (1) `event_processing_attempts.source_kind = PAYCHAOS_REPLAY` — this test's own execution provenance; (2) `normalized_event.sourceKind = REAL_RAZORPAY_WEBHOOK` — provenance of the underlying captured evidence the fixture was derived from; (3) the synthetic `webhook_events.source_kind = REAL_RAZORPAY_WEBHOOK` — a schema-compatibility artifact only.

**Cleanup:** Unconditional, exact-ID-scoped, child-before-parent (`event_processing_attempts` → `chaos_runs` → `webhook_events` → `payments` → `payment_attempts` → `orders`). After deletion, `afterAll` independently re-`SELECT`s (exact-ID, `count: "exact"`) and asserts zero remaining rows for ALL SIX owned resource sets — not merely a subset — matching the established suite convention.

**Proven:**

```text
payment.razorpay_payment_status = failed
payment.failed_at               != null
payment.captured_at             = null
payment_attempt.status          = FAILED_OBSERVED
order.payment_status            = FAILED_OBSERVED
order.business_status           = OPEN
fulfilment count                 = 0
result.fulfilmentId             = null
event_processing_attempts.source_kind        = PAYCHAOS_REPLAY
event_processing_attempts.chaos_run_id       = the SYNTHETIC_DEMO mechanics run
event_processing_attempts.is_duplicate_delivery = false
exactly ONE processing attempt for this mechanics chaos_run
chaos_runs.data_classification   = SYNTHETIC_DEMO
canonical webhook_events row count for this synthetic event = 1
duplicate_delivery_count         = 0
```

A second describe block OPTIONALLY, read-only re-confirms that the genuine source row `e0df759e-bbde-45c3-aa80-a5a2d6b61be9` is unmutated — it never fails this suite merely because that historical row is absent from a future Supabase project.

**Tests:** 2 passed
**Result:** PASS (verified against real Supabase)

No `PROCESSOR_FIXTURE_PROVENANCE_BLOCKER` was hit — the established C01 `053` mechanics pattern transferred cleanly to C11's `payment.failed` branch once actually followed exactly.

### D. Static provenance regression guard

`tests/unit/supabase/057-chaos-c11-fixture-provenance-guard.test.ts` — a plain static text check (no Supabase connection, offline suite) mirroring `053-chaos-replay-provenance-guard.test.ts` exactly: requires `057`'s functional source to contain `insertReplayProcessingAttempt`, `SYNTHETIC_DEMO`, and `processMerchantWebhookEvent`; requires it to NOT contain `insertEventProcessingAttempt`, `RECORDED_TEST_EVIDENCE`, `runChaosPrecheck`, `createChaosRun`, or any C11 positive-path execution-service reference; requires the module doc comment to document the three-layer provenance distinction.

---

## 12. Test Results (final, provenance-correction round)

```text
Fixture unit tests (tests/unit/fixtures/c11-payment-failed-fixture.test.ts):
  Test Files = 1 passed
  Tests      = 6 passed
  (up from 5 — added the exact metadata-key allowlist assertion, Section 9
  of the correction)

Static provenance regression guard
  (tests/unit/supabase/057-chaos-c11-fixture-provenance-guard.test.ts):
  Test Files = 1 passed
  Tests      = 7 passed
  (new this round)

Frozen C11 PRECHECK-07 regression (safety-gate.test.ts + repository.test.ts):
  Test Files = 2 passed
  Tests      = 71 passed
  (unchanged)

Corrected 057 real-Supabase mechanics test:
  Test Files = 1 passed
  Tests      = 2 passed
  (same count as before the correction; the EXECUTION PROVENANCE inside it
  is what changed — see Section 11)

Full real-Supabase integration suite:
  Test Files = 18 passed
  Tests      = 209 passed
  (unchanged from the pre-correction round — 057's test count did not
  change, only its provenance)

Full offline unit suite — final clean invocation:
  Test Files = 56 passed
  Tests      = 1206 passed
  (up from 55/1198 — the new provenance-guard file's 7 tests + 1 new fixture
  metadata-allowlist test)
  One intermediate full-suite invocation this round showed 9 test-level
  timeouts, all in unrelated frozen API-route/middleware files entirely
  untouched by this round (tests/unit/api/access-logout-route.test.ts,
  tests/unit/middleware.test.ts, tests/unit/api/chaos-c03-route.test.ts,
  tests/unit/api/chaos-replay-route.test.ts,
  tests/unit/api/webhooks-razorpay-route-signature-rejection.test.ts,
  tests/unit/api/webhooks-razorpay-route-modified-body.test.ts,
  tests/unit/api/chaos-c07-routes.test.ts) — all 7 files passed cleanly in
  isolation (91/91), confirming environmental Windows/OneDrive contention
  (unusually slow module transform/import this run), not a regression. The
  second full-suite invocation was clean end to end.

npm run typecheck: PASS (0 errors) — the earlier round's one real cast fix
  (insertEventProcessingAttempt -> now insertReplayProcessingAttempt, same
  `as unknown as Record<string, unknown>` cast retained) remains correct.

npm run lint: 0 errors, 1 pre-existing unrelated warning
  (tests/integration/supabase/051-chaos-safety-gate.integration.test.ts:354)

npm run build: <see Section 13>

git diff --check: <see Section 13>
```

---

## 13. Build / Diff-Check

```text
npm run build: PASS (exit 0)
  Compiled successfully in 90s; TypeScript finished in 34.2s; 8/8 static
  pages generated. No route changed — this round added no application/API
  route. No retry needed.

git diff --check: exit 0, no warnings

git status --short (final):
  ?? handoffs/PHASE-3D-C-HANDOFF.md
  ?? tests/fixtures/
  ?? tests/integration/supabase/057-chaos-c11-payment-failed-fixture.integration.test.ts
  ?? tests/unit/fixtures/
  ?? tests/unit/supabase/057-chaos-c11-fixture-provenance-guard.test.ts

Zero modified files — confirms no production code was touched anywhere in
this round.

Prettier --check on all 5 Phase 3D-C files: PASS, no reformatting needed.
```

---

## 14. Known Issues

- The Vite integration config's existing future-native-loader warning remains (pre-existing, unrelated).
- The pre-existing lint warning in `051-chaos-safety-gate.integration.test.ts` remains (pre-existing, untouched file).
- This machine showed heavier-than-usual transient Vitest worker-spawn/timeout noise during this round's full-suite runs; every affected file was individually confirmed clean, and a final full run was clean end to end.
- No C11 fixture-readiness or mechanics blocker is currently known.

---

## 15. Deferred Work (Phase 3D-D and later)

```text
C11-B runtime TEST_FIXTURE replay (resolveAuthoritativeC11ReplaySource,
  C11_REPLAY_ATTEMPT_COUNT, replay route/service/run lifecycle) — Phase 3D-D,
  not started
C11-A manual real-failure observation verification                — Phase 3D-D/E
event_processing_attempts.source_kind CHECK widening for TEST_FIXTURE
  (already pre-approved in docs/DATABASE.md, not yet enabled)      — Phase 3D-D, if needed
Money invariant PASS/FAIL evaluation (INV-003/004/011)              — Phase 3F
Evidence snapshot system                                            — Phase 3E
Findings                                                             — Phase 3G
UI polish                                                            — Phase 3H/5
```

---

## 16. Next Dependency

Architect review of this fixture-resolution round. Phase 3D-D (C11-B runtime replay using this fixture, requiring its own migration for `event_processing_attempts.source_kind` and its own execution-service/route work) begins only after this round is approved.

---

## 17. Phase Completion Checklist

```text
IMPLEMENTED                      [x]
TESTED                           [x]
REAL SUPABASE MECHANICS VERIFIED [x]
AUTHENTIC SOURCE VERIFIED        [x]
DOCUMENTED                       [x]
APPROVED                         [x]
```
