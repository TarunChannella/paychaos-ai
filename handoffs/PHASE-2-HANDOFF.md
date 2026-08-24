# Phase 2 Handoff

**This is the living Phase 2 handoff.** It will be extended in place by Phase 2B through Phase 2G as they are implemented — it is not replaced per checkpoint.

- **Phase:** Phase 2 — Razorpay Test Mode + Payments + Webhooks
- **Current branch:** `phase-2-razorpay`
- **Phase 2 starting HEAD:** `47cb275cd2d200b879f80a331ca4848ee2b709b3`
- **Overall Phase 2 status: IN PROGRESS — NOT APPROVED**
- **Completed checkpoints documented in this file: Phase 2A — Razorpay Test Configuration; Phase 2B — Razorpay Order Creation**
- **Phase 2C through Phase 2G: NOT IMPLEMENTED**

Phase 2 as a whole is not implemented, not tested, not manually verified, not documented, and not approved. Only the Phase 2A and Phase 2B slices described below have any of those properties, and only for their own narrow scope.

**Phase 2B correction applied, then re-verified against the real provider:** the first real Razorpay Test Mode manual verification (performed by the developer) found a confirmed implementation defect (over-length receipt) — see "PHASE 2B CORRECTION" below. The defect was fixed and unit-tested against a mocked provider. Two confirmed test-harness defects (not product defects) were then found and corrected during test-gate verification — see "Phase 2B Test-Gate Correction #2" (Section 48). **The developer has since completed a successful real Razorpay Test Mode re-test — see Section 59.** Phase 2B is now IMPLEMENTED, TESTED, MANUALLY VERIFIED, and DOCUMENTED; it awaits architect review before APPROVED.

---

## 1. Phase identity and current status

| Sub-phase                                        | Status                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Phase 2A — Razorpay Test Configuration           | IMPLEMENTED, TESTED, MANUALLY VERIFIED (see Section 19)                                                 |
| Phase 2B — Razorpay Order Creation               | IMPLEMENTED, TESTED, MANUALLY VERIFIED, DOCUMENTED — APPROVED PENDING ARCHITECT REVIEW (see Section 62) |
| Phase 2C — Checkout Integration                  | NOT IMPLEMENTED                                                                                         |
| Phase 2D — Webhook Ingestion                     | NOT IMPLEMENTED                                                                                         |
| Phase 2E — Event Deduplication and Normalization | NOT IMPLEMENTED                                                                                         |
| Phase 2F — Merchant Processing and Idempotency   | NOT IMPLEMENTED                                                                                         |
| Phase 2G — Real Test Mode Verification           | NOT IMPLEMENTED                                                                                         |

**Update (Section 59):** one real Razorpay Test Mode Order (`order_TTYzkTb1oMiRwP`) has since been created by PayChaos and confirmed in the Razorpay Test Mode Dashboard — this superseded the sentence below, which described the state as of the original Phase 2B implementation round. No real Razorpay **payment** has been made (the Dashboard confirms 0 attempts, no payments). No webhook has been received. Phase 2C–2G remain not implemented.

<details><summary>Original Phase 2B-round statement (preserved for history)</summary>

No real Razorpay Order has been created by PayChaos. No real Razorpay payment has been made. No webhook has been received. Nothing in this document should be read as claiming otherwise.

</details>

---

## 2. Phase 2A objective

Build the smallest secure server-side Razorpay configuration layer required by later Phase 2 work, per `docs/PHASE_PLAN.md` Section 6.7 ("Phase 2A — Razorpay Test Configuration: server-only Razorpay configuration; Test Mode key validation; Live Mode rejection"):

- server-only Razorpay configuration, reusing the exact Phase 1B config architecture;
- Test Mode validation (`RAZORPAY_MODE` must equal `"test"`);
- Live Mode rejection (`RAZORPAY_KEY_ID` must use the `rzp_test_` prefix, which structurally rejects `rzp_live_`).

---

## 3. Completed Phase 2A functionality

A new `getRazorpayEnv()` accessor validates three environment variables at first access, and eagerly at server startup via `instrumentation.ts`:

- `RAZORPAY_MODE` must equal `"test"` exactly;
- `RAZORPAY_KEY_ID` must start with `rzp_test_` (a `rzp_live_` value is therefore rejected fail-closed);
- `RAZORPAY_KEY_SECRET` must be present and non-empty.

No Razorpay API/SDK code exists. No network call is made. No Orders/Checkout/webhook logic exists yet.

---

## 4. Files added

- `lib/config/razorpay-env.ts` — server-only Razorpay Test Mode config loader/accessor (`import "server-only"` first line, same structural pattern as `lib/config/server-env.ts`).
- `tests/unit/config/razorpay-env.test.ts` — focused unit tests for the new module.

---

## 5. Files modified

- `.env.example` — added `RAZORPAY_MODE=test`, `RAZORPAY_KEY_ID=rzp_test_your-razorpay-test-key-id`, `RAZORPAY_KEY_SECRET=your-razorpay-test-key-secret` (names + safe placeholders only); updated the now-stale Phase 1B "Razorpay variables aren't listed yet" comment.
- `instrumentation.ts` — startup validation now also calls `getRazorpayEnv()` (fail-closed at server boot), same guarded/dynamic-import pattern as the existing Supabase calls.
- `lib/config/env-validation.ts` — added two new shared, value-free validators (`requireExactValue`, `requirePrefixedString`), following the exact style of the existing `requireHttpUrl`.
- `tests/unit/config/env-files.test.ts` — updated the pre-existing Phase 1B assertion that `RAZORPAY_KEY_SECRET=` must not yet appear in `.env.example` (that premise is now legitimately false under approved Phase 2A scope); added assertions for the three Phase 2A names, the `rzp_test_` placeholder prefix, and the absence of `NEXT_PUBLIC_RAZORPAY_KEY_SECRET`.
- `tests/unit/config/env-validation.test.ts` — added tests for the two new validators.
- `tests/unit/instrumentation.test.ts` — renamed the tracked-env-key list to cover Razorpay vars too, added a `setFakeValidRazorpayEnv()` helper, updated existing cases A–D to include fake valid Razorpay env, added new cases E–H for Razorpay-specific fail-closed/leak-safety behavior.

---

## 6. Files removed

None.

---

## 7. Database/schema changes

**None.** No migration file was created or edited. No RLS policy was added, removed, or changed. `git diff -- supabase/` is empty. Phase 2A's own scope (`docs/PHASE_PLAN.md` Section 6.7) does not include any database work — `payments`, `webhook_events`, and `event_processing_attempts` remain Phase 2B+ scope per `docs/DATABASE.md`.

---

## 8. Environment/config variable names

Names only — never values:

- `RAZORPAY_MODE`
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`

`.env.local` was not read, printed, or modified at any point during Phase 2A implementation or this documentation checkpoint. It remains git-ignored (`.gitignore:38: .env* → .env.local`) and untracked (no git history, no `git status` entry).

---

## 9. Razorpay configuration changes

- The developer confirmed the Razorpay Dashboard is in **Test mode**.
- Test API credentials (Key ID, Key Secret) were generated manually by the developer and stored privately in `.env.local` — never shared with, read by, or printed by this session.
- `RAZORPAY_MODE=test` is configured locally.
- The Test Key ID contract requires the `rzp_test_` prefix; a `rzp_live_`-shaped key fails closed at both validation time and server startup.
- No Razorpay webhook has been configured yet (no webhook URL, no webhook secret) — that is Phase 2D scope.
- No live/production Razorpay credentials have been used at any point.

---

## 10. Automated test evidence

| Command                                                                                                                                                                 | Result                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run tests/unit/config/razorpay-env.test.ts tests/unit/config/env-validation.test.ts tests/unit/config/env-files.test.ts tests/unit/instrumentation.test.ts` | **4/4 files, 60/60 tests, exit 0**                                                                                                                                  |
| `npm run test`                                                                                                                                                          | **19/19 files, 234/234 tests, exit 0**                                                                                                                              |
| `npm run test:integration:supabase`                                                                                                                                     | **6/6 files, 38/38 tests, exit 0** — proves Phase 1's real Supabase state (schema, RLS, cleanup) remains intact with the new Razorpay startup config present        |
| `npm run e2e`                                                                                                                                                           | **2/2 tests passed, exit 0** — confirms the existing Demo Merchant flow still works with `instrumentation.ts` now also validating Razorpay config at server startup |
| `npm run typecheck`                                                                                                                                                     | exit 0                                                                                                                                                              |
| `npm run lint`                                                                                                                                                          | exit 0, 0 warnings/errors                                                                                                                                           |
| `npm run build`                                                                                                                                                         | exit 0, `/demo-merchant` still listed `ƒ (Dynamic)`                                                                                                                 |

All of the above are clean results as of the Phase 2A correction pass. No test assertion failed at any point in that pass. `npm run e2e` passed 2/2 on the first attempt, with no retry required.

---

## 11. Formatting/tooling issue

All 8 Phase 2A files were brought into full Prettier-compliant form: `npx prettier --check` passes individually on every one of `.env.example`, `instrumentation.ts`, `lib/config/env-validation.ts`, `lib/config/razorpay-env.ts`, `tests/unit/config/env-files.test.ts`, `tests/unit/config/env-validation.test.ts`, `tests/unit/config/razorpay-env.test.ts`, `tests/unit/instrumentation.test.ts`.

The repo-wide `npm run format:check` command **still exits 1**, because 58 other, pre-existing files are checked out with CRLF line endings under this Windows machine's `core.autocrlf=true` setting (Prettier defaults to `endOfLine: "lf"`, and `.prettierrc.json` has no override). This was diagnosed precisely: verified on `package.json` (a file no Phase 2A work has ever touched) — 100% CRLF, proving the condition predates and is unrelated to Phase 2A. No repo-wide mass formatting was performed to "fix" this, per explicit instruction to keep this documentation/correction task minimal and in-scope.

This is **not** a Phase 2A product or security defect. It is a known, pre-existing Windows checkout/tooling issue, tracked separately (Section 16) for a future dedicated remediation task (line-ending normalization or a `.gitattributes` policy decision), outside Phase 2A's scope.

---

## 12. Security verification

- `lib/config/razorpay-env.ts` begins with `import "server-only"` as its first import — a structural, build-time-enforced guarantee, not merely a naming convention.
- `RAZORPAY_KEY_SECRET` is never exposed through a `NEXT_PUBLIC_` prefix — no such name exists anywhere in the codebase (confirmed by Grep; the only match for `NEXT_PUBLIC_RAZORPAY` is inside a negative-assertion test proving its absence).
- Client production-bundle scan (`.next/static/**/*.js`, after a fresh clean build) for the following identifiers:
  ```
  RAZORPAY_KEY_SECRET_FOUND=False
  SUPABASE_SERVICE_ROLE_KEY_FOUND=False
  RAZORPAY_WEBHOOK_SECRET_FOUND=False
  PAYCHAOS_ACCESS_TOKEN_FOUND=False
  PAYCHAOS_SESSION_SECRET_FOUND=False
  ```
- No real credential appears anywhere in the Phase 2A Git diff — every test/example value is an obviously-fake placeholder (e.g. `fake-razorpay-key-secret-not-real`, `rzp_test_fake_key_id_not_real`, `your-razorpay-test-key-secret`).
- `.env.local` remains git-ignored and untracked (Section 8).
- A `rzp_live_`-shaped Key ID is rejected fail-closed, both at the validator level and at server startup (`instrumentation.ts`).
- Every configuration failure's error message names only the offending variable — never the rejected value, and never the Key Secret regardless of which other field failed (proven by dedicated leak-safety tests in `razorpay-env.test.ts` and `instrumentation.test.ts`).

---

## 13. DEVELOPER MANUAL VERIFICATION EVIDENCE

**The following was reported by the developer as their own manual testing, performed on their machine using their own private local Razorpay Test Mode credentials. It was not generated, observed, or executed by Claude, and is recorded here as developer-attested evidence, distinct from the automated evidence in Section 10. This manual test did not contact the Razorpay API — it exercises only PayChaos's own local server-startup configuration validation.**

### A. Positive Test Mode check

- The developer started `npm run dev` using the real, private, local Razorpay Test configuration already present in `.env.local`.
- Next.js reached "Ready".
- The application loaded successfully.
- The application UI showed "Razorpay Test Mode".
- No Razorpay configuration error occurred.

### B. Live-shaped fail-closed check

The developer temporarily ran:

```
$env:RAZORPAY_KEY_ID="rzp_live_fake_manual_verification"
npm run dev
```

Observed result:

```
Environment variable RAZORPAY_KEY_ID must start with "rzp_test_"
```

- Startup instrumentation rejected the fake Live-shaped key.
- The error identified only the variable name and the required prefix contract — no credential value.
- No Key Secret was exposed in this error.

### C. Cleanup

The developer ran:

```
Remove-Item Env:RAZORPAY_KEY_ID
```

then restarted normally with `npm run dev`.

Observed:

- Normal Test configuration worked again.
- No Razorpay configuration error occurred.

---

## 14. Phase 2A acceptance criteria

| ID       | Result                                 | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2A-AC-01 | PASS                                   | Reuses `env-validation.ts`/`instrumentation.ts` pattern exactly; no parallel config system (Section 3–5).                                                                                                                                                                                                                                                                                                                                                 |
| 2A-AC-02 | PASS                                   | `razorpay-env.test.ts` "parses successfully using fake Test Mode values"; developer manual check A.                                                                                                                                                                                                                                                                                                                                                       |
| 2A-AC-03 | PASS                                   | `RAZORPAY_MODE` missing/`"live"`/empty all rejected (automated); developer manual check B confirms the live path fails closed for the adjacent Key ID contract too.                                                                                                                                                                                                                                                                                       |
| 2A-AC-04 | PASS                                   | Fake `rzp_test_...` Key ID accepted (automated); developer manual check A confirms with a real Test Key ID.                                                                                                                                                                                                                                                                                                                                               |
| 2A-AC-05 | PASS                                   | Fake `rzp_live_...` Key ID rejected (automated, 3 test files); developer manual check B reproduces this live with a real running server.                                                                                                                                                                                                                                                                                                                  |
| 2A-AC-06 | PASS                                   | Missing/empty Key ID/Key Secret/Mode all rejected (automated).                                                                                                                                                                                                                                                                                                                                                                                            |
| 2A-AC-07 | PASS                                   | `import "server-only"` confirmed; no client import; no `NEXT_PUBLIC_` export (Section 12).                                                                                                                                                                                                                                                                                                                                                                |
| 2A-AC-08 | PASS                                   | Dedicated leak-safety tests; developer manual check B's observed error contains no credential value.                                                                                                                                                                                                                                                                                                                                                      |
| 2A-AC-09 | PASS                                   | No migration/schema touched (Section 7).                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2A-AC-10 | PASS                                   | No Phase 2B–2G code exists (Section 1, 17).                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2A-AC-11 | PASS                                   | 4/4 files, 60/60 tests, exit 0 (Section 10).                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2A-AC-12 | PASS, WITH A NOTED KNOWN TOOLING ISSUE | `lint`, `typecheck`, `test` (19/19/234/234), `test:integration:supabase` (6/6/38/38), `build`, and `e2e` (2/2) all pass cleanly, exit 0. `format:check` passes for every individual Phase 2A file. The repo-wide `npm run format:check` command itself still exits 1, but only due to 58 pre-existing, out-of-Phase-2A-scope files (Section 11) — this is recorded as a known tooling issue (Section 16), not represented as a passing command it is not. |
| 2A-AC-13 | PASS                                   | Section 12.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2A-AC-14 | PASS                                   | No commit created; `HEAD` unchanged at `47cb275cd2d200b879f80a331ca4848ee2b709b3` throughout.                                                                                                                                                                                                                                                                                                                                                             |

---

## 15. Architectural decisions

- Reuse the exact Phase 1 environment-configuration architecture (`lib/config/{client-env,server-env,env-validation}.ts` pattern) rather than introducing a parallel system.
- A dedicated server-only Razorpay configuration module (`lib/config/razorpay-env.ts`), mirroring `server-env.ts` structurally.
- Fail closed on anything except explicit `RAZORPAY_MODE=test` — no silent pass-through for an unset or unrecognized mode.
- Key ID prefix enforcement (`rzp_test_` required) as the mechanism that also rejects `rzp_live_`, rather than a separate live-key blocklist.
- Startup validation wired through the existing `instrumentation.ts` hook (same fail-closed-at-boot pattern established in Phase 1B for Supabase config), rather than a new validation entry point.
- No Razorpay SDK or API client added in Phase 2A — this module only validates and exposes configuration values; it performs no network I/O.

---

## 16. Known issues

1. **Windows `core.autocrlf` / repo-wide Prettier CRLF issue** — Severity: LOW, tooling, non-blocking, pre-existing (not introduced by Phase 2A). `npm run format:check` exits 1 on 58 files outside Phase 2A's scope; all 8 Phase 2A files are individually clean. See Section 11 for full diagnosis. Recommended remediation (a separate, dedicated task, not this one): either a reviewed repo-wide line-ending normalization, or a `.gitattributes` LF-enforcement policy — both require architect sign-off before touching unrelated files.
2. **Windows/OneDrive Vitest `forks`-pool worker-startup timeout** — Severity: LOW, non-blocking, previously documented across Phase 1 and observed again once during Phase 2A's initial implementation round; resolved by a no-config-change retry each time it occurred. Did not recur in the final Phase 2A correction-pass test runs.
3. **Inherited environment note from Phase 1**: a cold-Turbopack first-navigation timeout was previously observed during Phase 1 verification (`handoffs/PHASE-1-HANDOFF.md` Section 15, items 3 and 5 — a cold-Turbopack `toHaveURL` timeout and a stray manually-started `next dev` process, both specific to Phase 1F). Neither was observed during any Phase 2A `npm run e2e` execution — the Phase 2A correction pass's Playwright run passed 2/2 on the first attempt with no retry. This item is retained only as historical environment context, not as Phase 2A evidence.

No current Phase 2A P0 blocker exists.

---

## 17. Explicitly deferred work

**Phase 2B — Razorpay Order Creation** (not implemented): Razorpay adapter/API client; internal payment-attempt creation; server-created Razorpay Order; persisting the Razorpay order ID.

**Phase 2C — Checkout Integration** (not implemented): Razorpay Checkout; Checkout result handling; Checkout signature verification.

**Phase 2D — Webhook Ingestion** (not implemented): public webhook endpoint; raw-body signature verification; `RAZORPAY_WEBHOOK_SECRET` handling.

**Phase 2E — Event Deduplication and Normalization** (not implemented): database-enforced event uniqueness; normalized internal event representation.

**Phase 2F — Merchant Processing and Idempotency** (not implemented): verified event processing; merchant state transitions; fulfilment/business-effect idempotency.

**Phase 2G — Real Test Mode Verification** (not implemented): an actual Razorpay Test Mode payment; an actual webhook receipt; database/UI evidence inspection.

Explicitly:

- **No real Razorpay payment has been made yet.**
- **No real Razorpay Order has been created by PayChaos yet.**
- **No webhook has been received yet.**
- No payment evidence in this document or elsewhere in the repository at this checkpoint should be described as real Razorpay payment evidence — none exists yet.

---

## 18. Dependencies for Phase 2B

Only what Phase 2A genuinely establishes:

- the approved Phase 1 foundation (`handoffs/PHASE-1-HANDOFF.md`, APPROVED);
- Test Mode credentials configured privately in the developer's own `.env.local`;
- `RAZORPAY_MODE=test` validated at both first-access and server-startup time;
- a server-only, validated Razorpay configuration accessor (`getRazorpayEnv()`);
- Live Mode rejection (fail-closed on any non-`rzp_test_` Key ID);
- the existing Demo Merchant/order foundation (`lib/demo-merchant/*`, unchanged by Phase 2A).

Phase 2B is not implemented by this checkpoint and must not be started without separate, explicit authorization.

---

## 19. Current lifecycle state

**Phase 2A:**

```
IMPLEMENTED          PASS
TESTED               PASS
MANUALLY VERIFIED    PASS
DOCUMENTED           CANDIDATE — pending architect review
APPROVED             PENDING ARCHITECT REVIEW
```

**Phase 2 overall (before Phase 2B):**

```
IN PROGRESS
NOT APPROVED
```

---

# PHASE 2B — RAZORPAY ORDER CREATION

**Status: IMPLEMENTED, TESTED (mocked provider) — MANUALLY VERIFIED PENDING — DOCUMENTED CANDIDATE — APPROVED PENDING ARCHITECT REVIEW.** See Section 33.

## 20. Phase 2B objective

Implement exactly the flow `docs/PHASE_PLAN.md` Section 6.7 defines for Phase 2B:

```
Demo Merchant order
→ internal payment attempt
→ server Razorpay Order creation
→ store razorpay_order_id
```

No Checkout, no payment execution, no webhooks — those remain Phase 2C/2D+.

---

## 21. Completed Phase 2B functionality

- A server-only Razorpay Orders API adapter (`lib/razorpay/adapter.ts`) that creates one Razorpay Test Mode Order per call, using the caller's already-validated amount/currency/receipt.
- An additive migration adding `payment_attempts.razorpay_order_id` / `razorpay_order_status` (nullable, with a partial unique index on the non-null `razorpay_order_id`).
- A `createRazorpayOrderForMerchantOrder(orderId)` orchestration function (`lib/demo-merchant/service.ts`) that: loads the trusted order by ID; reuses an existing unresolved (`CREATED`/`FAILED_OBSERVED`) payment attempt or creates a new one with a stable receipt; calls the adapter; on success persists the Razorpay correlation and transitions the attempt to `ORDER_CREATED`; on a definite rejection marks `FAILED_OBSERVED`; on an ambiguous outcome (network failure/timeout/5xx) leaves the attempt completely untouched.
- A new Server Action (`createRazorpayOrderAction(orderId)`) and a Demo Merchant UI button/evidence panel so the developer can trigger and observe this flow manually after review.

---

## 22. Razorpay adapter design

`lib/razorpay/adapter.ts` calls `https://api.razorpay.com/v1/orders` directly via the built-in `fetch` (no Razorpay Node SDK dependency added — Order creation is one authenticated JSON POST, and a fetch-based adapter is the smallest reliable implementation per CLAUDE.md's "do not add unnecessary frameworks" rule). It authenticates with HTTP Basic Auth built from `getRazorpayEnv()`'s validated `keyId`/`keySecret` (Phase 2A) — it never reads `process.env` directly and never accepts a caller-supplied credential. `fetchImpl` is injectable (defaults to global `fetch`) purely so tests never perform a real network call. Only Order creation is implemented — no `payments.fetch`, captures, refunds, webhook API, or Checkout.

Outcomes are classified into three cases the caller can act on safely:

- **Success** (2xx with `id`/`status` fields) → `{ razorpayOrderId, razorpayOrderStatus }`.
- **`RazorpayOrderRejectedError`** — a definite provider rejection (4xx). Carries `httpStatus` and a safe `error.code`-only `safeErrorCode` (never the full response body).
- **`RazorpayOrderAmbiguousError`** — network failure, timeout, unparseable response, or 5xx. The outcome is genuinely unknown; the caller must not retry with a new receipt.

---

## 23. Internal payment-attempt flow

`createRazorpayOrderForMerchantOrder(orderId)` is the only entry point, and it accepts **only** the order ID:

1. Reject a malformed (non-UUID-shaped) `orderId` before any database query.
2. Load the order by ID (`getOrderById`); if none exists, throw `DemoMerchantOrderNotFoundError`.
3. Load the order's latest payment attempt (`getLatestPaymentAttemptForOrder`).
4. If that attempt exists and is still unresolved (`status` is `CREATED` or `FAILED_OBSERVED`), **reuse it** — same `id`, same stable `razorpay_receipt` (PAYATT-003/PAYATT-004: never generate a new receipt merely to retry).
5. Otherwise, insert a new attempt: `attempt_no` = previous + 1, `amount_subunits`/`currency` copied directly from the trusted order row (PAYATT-001), a freshly generated receipt (`pc_<orderId>_<attemptNo>_<randomUUID>`).
6. Call the adapter with exactly that attempt's persisted `amount_subunits`/`currency`/`razorpay_receipt`.
7. Persist the result per Section 24/25.

The browser can supply an order ID it can already see (the Demo Merchant page lists all orders, matching Phase 1's existing single-workspace trust model — no new authorization boundary is introduced or removed here); it cannot supply, and no code path derives from the browser, any amount, currency, receipt, or Razorpay identifier.

---

## 24. Razorpay Order request contract

The adapter request always uses:

```
amount   = payment_attempts.amount_subunits   (already smallest-currency subunits — never multiplied again)
currency = payment_attempts.currency
receipt  = payment_attempts.razorpay_receipt  (caller-controlled, never generated inside the adapter)
```

For the fixed Demo Merchant product this is `50000` / `"INR"` (₹500.00), read from the real persisted order row, never hard-coded in the request path.

---

## 25. Failure/ambiguous-outcome behavior

| Outcome                                           | Attempt mutation                                                                 | Result                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Success                                           | `status → ORDER_CREATED`, `razorpay_order_id`/`razorpay_order_status` persisted  | Returned to caller; no order/payment/fulfilment state touched                            |
| Definite rejection (`RazorpayOrderRejectedError`) | `status → FAILED_OBSERVED` only; `razorpay_order_id`/`status` remain `NULL`      | Error rethrown to the action, which returns one generic safe message                     |
| Ambiguous (`RazorpayOrderAmbiguousError`)         | **No mutation at all** — attempt stays `CREATED`/`FAILED_OBSERVED`, same receipt | Error rethrown; a later retry safely reuses the same attempt/receipt (Section 23 step 4) |

No reconciliation engine, no "query by receipt" API call, and no automatic retry loop were implemented — deliberately out of Phase 2B's minimal scope per the task's own instruction.

---

## 26. Files added

- `lib/razorpay/adapter.ts` — server-only Razorpay Orders API adapter.
- `supabase/migrations/20260824000000_phase2b_payment_attempts_razorpay_correlation.sql` — additive migration (Section 28).
- `app/demo-merchant/create-razorpay-order-button.tsx` — Client Component triggering `createRazorpayOrderAction`; no Checkout UI, no checkout.js, no card/payment form.
- `tests/unit/razorpay/adapter.test.ts` — focused adapter tests.
- `tests/integration/supabase/046-payment-attempt-razorpay-correlation.integration.test.ts` — real-DB tests for the new columns/constraint/repository functions (Section 30).

## 27. Files modified

- `lib/supabase/types.ts` — added `razorpay_order_id`/`razorpay_order_status` to the `payment_attempts` Row/Insert/Update types.
- `lib/demo-merchant/repository.ts` — added `getOrderById`, `getLatestPaymentAttemptForOrder`, `listLatestPaymentAttemptsForOrderIds`, `insertPaymentAttempt`, `markPaymentAttemptOrderCreated`, `markPaymentAttemptFailedObserved`.
- `lib/demo-merchant/service.ts` — added `createRazorpayOrderForMerchantOrder`; `listDemoMerchantOrders` now also resolves each order's latest payment attempt.
- `lib/demo-merchant/view-model.ts` — added `PaymentAttemptViewModel`/`toPaymentAttemptViewModel`; `DemoMerchantOrderViewModel` gained a `latestPaymentAttempt` field.
- `app/demo-merchant/actions.ts` — added `createRazorpayOrderAction(orderId)`.
- `app/demo-merchant/page.tsx` — renders the new button and, when present, safe payment-attempt evidence (attempt #, status, receipt, Razorpay Order ID/status) per order.
- `tests/unit/demo-merchant/{repository,service,view-model,actions}.test.ts` — extended with the corresponding new-function/new-flow coverage.

## 28. Migration added

`supabase/migrations/20260824000000_phase2b_payment_attempts_razorpay_correlation.sql` — purely additive:

- `alter table payment_attempts add column razorpay_order_id text` (nullable)
- `alter table payment_attempts add column razorpay_order_status text` (nullable)
- `create unique index ... on payment_attempts (razorpay_order_id) where razorpay_order_id is not null`

Does **not** edit, rewrite, or squash the approved Phase 1 migration. Does **not** create `payments`, `webhook_events`, or `event_processing_attempts` — those remain later Phase 2 work. No RLS/GRANT/REVOKE statement was added — RLS was already enabled with zero policies and anon/authenticated already explicitly revoked by the Phase 1 migration, and adding columns to an existing table does not reset either. **Matching the established Phase 1C-A → Phase 1C-B protocol, this migration is prepared but has NOT been applied to the real Supabase project as part of this task** — see Section 30/33.

## 29. Database changes

Summarized: two new nullable `text` columns on the existing `payment_attempts` table, plus one partial unique index. No new table. No RLS change. No credential of any kind appears in the migration file (confirmed by Grep).

---

## 30. Tests added

- `tests/unit/razorpay/adapter.test.ts` (10 tests) — success mapping, exact trusted amount/currency/receipt forwarded, HTTP Basic Auth built from validated config, no amount transformation, `RazorpayOrderRejectedError` on 4xx (Key Secret never in the message), `RazorpayOrderAmbiguousError` on 5xx/network failure/malformed 2xx body, receipt never generated by the adapter itself, Live-Mode-key fail-closed before any network call, structural `server-only` check.
- `tests/unit/demo-merchant/repository.test.ts` (+16 tests) — `getOrderById`, `getLatestPaymentAttemptForOrder`, `listLatestPaymentAttemptsForOrderIds`, `insertPaymentAttempt` (exact insert payload, no `status`/Razorpay fields), `markPaymentAttemptOrderCreated`, `markPaymentAttemptFailedObserved`, plus a structural `InsertPaymentAttemptInput` shape check.
- `tests/unit/demo-merchant/service.test.ts` (+13 tests) — order-not-found, malformed-ID short-circuit, amount/currency always derived from the stored order, attempt_no sequencing, receipt reuse for `CREATED`/`FAILED_OBSERVED`, no reuse of an already-`ORDER_CREATED` attempt, success path (`ORDER_CREATED` + correlation persisted), rejection path (`FAILED_OBSERVED`, rethrow), ambiguous path (no mutation, rethrow), no order-PAID/fulfilment call exists in this module's dependency set.
- `tests/unit/demo-merchant/view-model.test.ts` (+3 tests) — `toPaymentAttemptViewModel` full mapping and null-correlation mapping; `toDemoMerchantOrderViewModel` now asserts `latestPaymentAttempt`.
- `tests/unit/demo-merchant/actions.test.ts` (+6 tests) — single-parameter action, empty/whitespace `orderId` rejected pre-service-call, success returns exactly the safe evidence fields, failure returns the one generic message and logs only a safe error name, revalidates on both success and failure.
- `tests/integration/supabase/046-payment-attempt-razorpay-correlation.integration.test.ts` (5 tests, real DB, no Razorpay API/network call) — `insertPaymentAttempt` leaves both Razorpay columns `NULL`; `markPaymentAttemptOrderCreated` persists correlation and transitions status; `markPaymentAttemptFailedObserved` never fabricates an order ID; multiple rows may share `razorpay_order_id = NULL`; a duplicate non-null `razorpay_order_id` is rejected with Postgres `23505` and mutates nothing. **These 5 tests currently fail against the real project because the Section 28 migration has not been applied yet** — see Section 33.

No automated test performs a real network call or depends on real Razorpay credentials — all Razorpay HTTP interaction is exercised through the adapter's injectable `fetchImpl`.

---

## 31. Automated results

| Command                                                                              | Result                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run lint`                                                                       | exit 0                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `npm run typecheck`                                                                  | exit 0                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Focused Phase 2B tests (`adapter`, `repository`, `service`, `view-model`, `actions`) | Attempt 1: 0 ran, Vitest `forks`-pool worker-startup timeout (previously-documented Windows/OneDrive flake). Attempt 2 (retry, no config change): **5/5 files, 67/67 tests, exit 0**.                                                                                                                                                                                                                                    |
| `npm run test` (full unit suite)                                                     | **20/20 files, 277/277 tests, exit 0**, clean on the first attempt                                                                                                                                                                                                                                                                                                                                                       |
| `npm run test:integration:supabase`                                                  | **6/7 files pass — 38/38 pre-existing tests, zero regression.** The new `046-...` file's 5/5 tests fail: the columns/index from Section 28's migration do not exist on the real project yet. This is an expected, deterministic failure with a known cause (migration not applied), not an environmental flake and not a code defect — the same repository functions are proven correct by the passing unit tests above. |
| `npm run build`                                                                      | Attempt 1: stale `.next/server/edge` EPERM (previously-documented Windows/OneDrive artifact). Deleted the gitignored `.next/` directory, rebuilt once, no source change → **exit 0**, `/demo-merchant` still `ƒ (Dynamic)`.                                                                                                                                                                                              |
| `npm run e2e`                                                                        | Attempt 1: `demo-merchant.spec.ts` failed on `toHaveURL` at 5000ms, before any order was created (previously-documented cold-Turbopack pattern; `app-shell.spec.ts` passed). Retried once, zero config/source change → **2/2 passed, exit 0.**                                                                                                                                                                           |

---

## 32. Architectural decisions

- Fetch-based Razorpay adapter, not the official Razorpay Node SDK — smallest reliable implementation for one API call, no new production dependency.
- Adapter classifies outcomes into exactly three cases (success / definite rejection / ambiguous) rather than a generic try/catch — this is what makes the PAYATT-003/004 "never fabricate, never regenerate a receipt on ambiguity" contract enforceable by the caller.
- Attempt reuse keyed on status (`CREATED`/`FAILED_OBSERVED` = reusable, everything else = create new) rather than a separate reconciliation table or a "pending retry" queue — the smallest mechanism that satisfies the receipt-stability requirement without a reconciliation engine.
- `lib/razorpay/` established as its own module directory (per `docs/ARCHITECTURE.md` Section 36's module boundary list), separate from `lib/demo-merchant/`, since the Razorpay adapter is a provider integration, not Demo Merchant domain logic.
- No new database table — the two columns were added to the existing `payment_attempts` table exactly as `docs/DATABASE.md` Section 10 already specified as the complete, final schema.
- No new authorization boundary introduced for `orderId` — matches Phase 1's existing single-workspace, no-auth-yet trust model (the Demo Merchant page already publicly lists every order); `docs/ARCHITECTURE.md` ADR-A16's operator gate remains explicitly deferred to a public payment-enabled deployment, not required for this local-dev slice.

---

## 33. Security checks

1. `.env.local` was not modified — no git history, no `git status` entry.
2. `.env.local` was not printed at any point.
3. No real Razorpay credential appears in the Git diff — every value used is an obviously-fake placeholder (`fake-razorpay-key-secret-not-real`, `rzp_test_fake_key_id_not_real`, etc.) or a synthetic tagged string in the integration test.
4. `RAZORPAY_KEY_SECRET` remains server-only — read only via `getRazorpayEnv()` inside `lib/razorpay/adapter.ts` (`import "server-only"` first line); never returned, logged, or forwarded by the adapter, service, action, or UI.
5. Client bundle scan (`.next/static/**/*.js`, fresh build) for `RAZORPAY_KEY_SECRET` / `SUPABASE_SERVICE_ROLE_KEY` / `supabaseServiceRoleKey`: no matches.
6. No Live Mode support was introduced — the adapter always goes through `getRazorpayEnv()`, which still fails closed on any non-`rzp_test_` Key ID.
7. No Checkout/webhook functionality was introduced (Section 20; confirmed no `checkout.js`, no webhook route, no `RAZORPAY_WEBHOOK_SECRET` handling anywhere in the diff).
8. The browser cannot choose the authoritative amount/currency — `createRazorpayOrderAction`/`createRazorpayOrderForMerchantOrder` accept only an order ID; every money term is loaded server-side from the trusted `orders` row.
9. No credential is stored in the database — the migration adds only `razorpay_order_id`/`razorpay_order_status`, both non-secret correlation identifiers per `docs/RAZORPAY_GUIDE.md` Section 50.
10. No fulfilment or `orders.payment_status = PAID` mutation was added anywhere in this slice.

---

## 34. Known issues

1. **Phase 2B migration not yet applied to the real Supabase project.** Severity: expected/blocking for full integration-test greenness, not a defect. The 5 new `046-...` tests fail deterministically until the developer applies `20260824000000_phase2b_payment_attempts_razorpay_correlation.sql`, matching the established Phase 1C-A → 1C-B protocol (Claude prepares migrations; the developer applies them). Repository-function correctness is independently proven by the passing mocked unit tests (Section 30).
2. Windows `core.autocrlf` / repo-wide Prettier CRLF issue — unchanged from Phase 2A (Section 11/16); every file touched by Phase 2B is individually Prettier-clean.
3. Windows/OneDrive Vitest `forks`-pool worker-startup timeout — recurred once during the focused Phase 2B test run; resolved by a no-config-change retry, as previously documented.
4. Stale `.next/server/edge` EPERM on build — recurred once; resolved by deleting the gitignored `.next/` directory and rebuilding, as previously documented.
5. Cold-Turbopack Playwright first-navigation timeout — recurred once on `npm run e2e`; resolved by a single retry, as previously documented.

No current Phase 2B P0 code blocker exists — every non-database-dependent gate (lint, typecheck, full unit suite, build, e2e) is fully green.

---

## 35. Explicitly deferred work (Phase 2C–2G)

Unchanged from Section 17, still fully deferred:

- **Phase 2C** — Checkout, Checkout result handling, Checkout signature verification.
- **Phase 2D** — public webhook endpoint, raw-body signature verification, `RAZORPAY_WEBHOOK_SECRET` handling.
- **Phase 2E** — event deduplication, normalization.
- **Phase 2F** — merchant PAID processing, fulfilment, business-effect idempotency.
- **Phase 2G** — a real Razorpay Test Mode payment, a real webhook, database/UI evidence of either.

No real Razorpay Order has been created by PayChaos yet (Phase 2B's adapter has been exercised only against a mocked provider in automated tests). No real Razorpay payment has been made. No webhook has been received.

---

## 36. Manual verification still required

None of the following has been performed by Claude, and none should be treated as having occurred:

1. Apply the Section 28 migration to the real Supabase project (developer action), then re-run `npm run test:integration:supabase` to confirm the 5 currently-failing `046-...` tests pass and the pre-existing 38 remain green.
2. With the migration applied and real `.env.local` Razorpay Test credentials present, start the app and use the Demo Merchant UI's new "Create Razorpay Test Order" button against a real order.
3. Confirm a real Razorpay Test Mode Order ID and status are returned and displayed in the UI evidence panel.
4. Confirm the same correlation (`razorpay_order_id`, `razorpay_order_status`) appears in the `payment_attempts` row in Supabase.
5. Confirm the Razorpay Dashboard (Test mode) shows the same Order.
6. Optionally, deliberately trigger a rejection (e.g. a temporarily invalid Key Secret) and confirm the attempt is marked `FAILED_OBSERVED` with no fabricated Order ID, mirroring the Phase 2A Section 13-style manual check.

This will be performed by the developer separately, after architect review of this implementation — not by Claude.

---

## 37. Phase 2 overall lifecycle state (after Phase 2B)

```
IN PROGRESS
NOT APPROVED
```

Phase 2A: DOCUMENTED CANDIDATE, APPROVED PENDING ARCHITECT REVIEW (Section 19).
Phase 2B: IMPLEMENTED, TESTED (mocked provider only), MANUALLY VERIFIED PENDING, DOCUMENTED CANDIDATE, APPROVED PENDING ARCHITECT REVIEW.
Phase 2C–2G: NOT IMPLEMENTED.

---

# PHASE 2B CORRECTION — Razorpay receipt exceeded provider limit

**Status: correction IMPLEMENTED and unit-TESTED (mocked provider) — real-provider re-test PENDING — Phase 2B remains MANUALLY VERIFIED PENDING and NOT APPROVED.**

## 38. First real manual Razorpay Order attempt

The developer performed the first real Razorpay Test Mode manual verification against the deployed Phase 2B code. Result:

- an existing Demo Merchant order's Attempt #1 was created and a real request was sent to Razorpay;
- **the attempt ended in `FAILED_OBSERVED`;**
- **no Razorpay Order ID was ever created or persisted** (`razorpay_order_id` / `razorpay_order_status` both remained `NULL`).

## 39. Root cause

The original `generateRazorpayReceipt(orderId, attemptNo)` produced a receipt of the shape `pc_<full order UUID>_<attemptNo>_<full random UUID>` — roughly 78 characters. Razorpay's Create Order API rejects any `receipt` longer than **40 characters** with HTTP 400. The first real request was therefore rejected by Razorpay before any Order could be created — a confirmed implementation defect, not a transient/environmental failure.

A second, related defect was found on inspection: `REUSABLE_ATTEMPT_STATUSES` incorrectly included `FAILED_OBSERVED` alongside `CREATED`. Since a `FAILED_OBSERVED` attempt is a **resolved** outcome (Razorpay definitely rejected the request), reusing it would have caused every subsequent retry to resend the exact same (invalid, over-length) receipt — masking the real bug and never converging on a fix without also correcting this reuse rule.

## 40. Correction implemented

1. **New receipt format** (`lib/demo-merchant/service.ts`, `generateRazorpayReceipt()`): `pc_` + a UUID with hyphens stripped = 35 characters total, well under Razorpay's 40-character limit. Deliberately excludes the order ID and attempt number — concatenating those is exactly what caused the original overflow. Uniqueness comes entirely from the UUID. Generated server-side only, persisted once per attempt, never supplied by the browser (unchanged from Phase 2B — the receipt was never a function parameter reachable from outside the server).
2. **Provider-contract guard** (`lib/razorpay/adapter.ts`): a new `assertValidReceipt()` check runs synchronously, before any network call, rejecting an empty or `> 40`-character receipt with a new `RazorpayReceiptInvalidError`. `RAZORPAY_RECEIPT_MAX_LENGTH = 40` is exported so this limit is asserted in one place. This is defense-in-depth — with the corrected generator it should never fire in practice, but it guarantees an over-length receipt can never reach Razorpay again even from a future code change.
3. **Corrected reuse semantics** (`lib/demo-merchant/service.ts`, `REUSABLE_ATTEMPT_STATUSES`): now contains only `"CREATED"`. `FAILED_OBSERVED` is excluded — a definite rejection is treated as PAYATT-003's "resolved outcome," so a later retry creates attempt #2 (next `attempt_no`, a fresh receipt) rather than resending attempt #1's rejected request. Ambiguous outcomes (network failure/timeout/5xx) still leave a `CREATED` attempt fully untouched and reused on retry — that part of the original design was correct and is unchanged.

The original `FAILED_OBSERVED` Attempt #1 was **not** modified, mutated, or deleted by this correction — it remains exactly as Razorpay left it, as immutable evidence of the real rejection.

## 41. Database

No migration change. The existing `UNIQUE(razorpay_receipt)` constraint and the Section 28 partial-unique `razorpay_order_id` constraint are unmodified and sufficient — this correction is entirely an application-layer fix (receipt shape + reuse logic), exactly as the source-of-truth instructed.

## 42. Tests added/changed

- `tests/unit/razorpay/adapter.test.ts` (+3 tests): rejects a receipt over 40 characters before any network call; accepts exactly 40 characters; rejects an empty receipt before any network call.
- `tests/unit/demo-merchant/service.test.ts`: replaced the (now-incorrect) "reuses FAILED_OBSERVED" test with 6 new tests proving — a FAILED_OBSERVED attempt is never reused and a new attempt #2 with a fresh receipt is created instead; the original FAILED_OBSERVED attempt's id is never passed to either mutation function; an ambiguous (network/5xx) outcome does not create a replacement attempt; a later call after an ambiguous outcome reuses the same still-CREATED attempt and receipt; a successful new attempt after a prior rejection still persists the Razorpay Order ID/status and becomes `ORDER_CREATED`; the generated receipt is non-empty, `pc_`-plus-32-hex-shaped, at most 40 characters, and never identical across two separate generations.

All 15 required correction behaviors are covered: receipt ≤40 chars; receipt uniqueness; browser cannot supply a receipt (structural — the function accepts only `orderId`); adapter/service refuse an over-length receipt pre-flight; ambiguous `CREATED` attempts retain their exact receipt; ambiguous outcomes never spawn a replacement attempt; `FAILED_OBSERVED` is never blindly reused; a retry after definite rejection creates `attempt_no + 1`; the new attempt gets a new valid receipt; the original `FAILED_OBSERVED` attempt is left unchanged; the merchant order stays `UNPAID`/`OPEN`/0-fulfilment (structural — no such repository call exists in this module's dependency set); a successful new attempt still persists Order ID/status and reaches `ORDER_CREATED`; all pre-existing Phase 2A/2B regression tests remain green.

## 43. Automated results

| Command                                                                                    | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                                                                             | exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run typecheck`                                                                        | exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Focused correction tests (`adapter`, `service`, `repository`, `actions`, run individually) | Two full-batch attempts failed with 0 tests run (Vitest `forks`-pool worker-startup timeout). Root-caused directly: this machine had only ~0.3 GB of ~7.7 GB RAM free at the time, confirmed by `Get-CimInstance Win32_OperatingSystem`. Also found and stopped 4 leftover `next dev`/Turbopack processes from an earlier step in this same task (developer-approved before stopping). Running each file individually (lower peak memory) succeeded: **adapter 13/13, service 23/23 (one genuine test-construction bug of mine found and fixed along the way — an assertion compared the wrong mock value; not a product defect), repository 20/20, actions 10/10 — 66/66 total, exit 0.**                                                                                 |
| `npm run test` (full suite)                                                                | **20/20 files, 287/287 tests, exit 0**, clean on the next attempt (memory pressure had eased).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `npm run test:integration:supabase`                                                        | 6/7 files pass in full, including **all 5 `046-...` tests now passing** (confirms the Phase 2B migration has since been applied). `05-final-state.integration.test.ts` fails on exactly 2 assertions — "orders/payment_attempts table is fully empty" — because the real Attempt #1 order from Section 38 now permanently exists in the project. This is expected given the explicit instruction to retain that row as evidence; it is not a regression from this correction, and this task did not modify `05-final-state.integration.test.ts` or touch the real row.                                                                                                                                                                                                     |
| `npm run build`                                                                            | Attempt 1: stale `.next/server/edge` EPERM (previously-documented artifact). Deleted the gitignored `.next/`, rebuilt once → **exit 0.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `npm run e2e`                                                                              | Attempt 1: `demo-merchant.spec.ts` failed on `toHaveURL` before order creation (previously-documented cold-Turbopack pattern; `app-shell.spec.ts` passed). Attempt 2: a **new, distinct, reproducible** failure — `getByText("₹500.00")` now matches two elements (the fixed product card AND the real Attempt #1 order's amount, both ₹500.00, now both rendered in "Recent Internal Orders"). This is a genuine Playwright locator-strict-mode ambiguity exposed by the real order's presence, not a flake and not caused by this correction's code changes — it was not retried a third time because it is deterministic, not transient. It is recorded as a new known issue (Section 44) requiring an explicit fix to the e2e locator, out of this correction's scope. |

## 44. Security check

- `.env.local` not modified, not printed (no git history/status entry).
- No real credential in the diff (only fake/placeholder values, unchanged from Section 33's already-verified state).
- Client bundle scan (`.next/static/**/*.js`, fresh build): `RAZORPAY_KEY_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `supabaseServiceRoleKey` — no matches.
- The new `RazorpayReceiptInvalidError` message includes only the variable name and lengths (never the receipt content, which is not secret, and never any credential).

## 45. Scope check

No Checkout/webhook/Phase 2C+ functionality was introduced. No schema/migration change. No RLS change. The only code touched: `lib/demo-merchant/service.ts` (receipt generator + reuse-status set + doc comments), `lib/razorpay/adapter.ts` (pre-flight receipt guard), and the corresponding unit tests. `app/demo-merchant/actions.ts`, `app/demo-merchant/page.tsx`, `lib/demo-merchant/repository.ts`, `lib/demo-merchant/view-model.ts`, `lib/supabase/types.ts` are unchanged from the prior Phase 2B round (still showing as modified in `git status` only relative to the Phase 2A baseline, not touched again in this correction).

## 46. New known issues from this correction round

1. **e2e locator ambiguity on `/demo-merchant`** — Severity: MEDIUM (blocks the automated e2e gate deterministically, not a product/security defect). `tests/e2e/demo-merchant.spec.ts`'s `getByText("₹500.00")` assertion now matches both the fixed product card and any real order of the same amount that appears in "Recent Internal Orders" — which now includes the real Attempt #1 order from Section 38. Requires a locator fix (e.g. scope to the product-card section, or use `.first()`) — deliberately not made in this correction, since it is unrelated to the receipt-length defect and outside this task's authorized scope.
2. **`05-final-state.integration.test.ts` "table fully empty" assertions** — Severity: LOW/expected, not a regression. These 2 assertions now fail because the real Attempt #1 order/attempt permanently exist (by explicit instruction) in the same project the integration suite reads from. The other 5 assertions in that file (which check only this _run's own tracked_ rows) still pass. Not fixed in this correction, per instruction to preserve the real row.
3. Previously-documented Windows/OneDrive Vitest worker-startup timeout, stale `.next` EPERM, and cold-Turbopack Playwright timeout all recurred once each during this round and were each resolved per the established protocol (memory-pressure root-caused explicitly this time for the first one).

## 47. Manual verification still pending

Unchanged in substance from Section 36, now specifically re-scoped to verify the fix:

1. Click "Create Razorpay Test Order" again on the same existing merchant order.
2. Confirm this creates **Attempt #2** (not a mutation of Attempt #1).
3. Confirm Attempt #2's receipt is ≤ 40 characters.
4. Confirm the real Razorpay Test Order succeeds this time.
5. Confirm Attempt #2 becomes `ORDER_CREATED` with a real Razorpay Order ID and status.
6. Confirm Attempt #1 is still shown as `FAILED_OBSERVED` with no Order ID (unchanged).
7. Confirm the merchant order is still `UNPAID`/`OPEN` and fulfilment is still 0.

This will be performed by the developer, not by Claude.

---

## 48. Phase 2B Test-Gate Correction #2 (this round)

Scope: fix exactly the two confirmed **test-harness** defects recorded in Section 46 (items 1 and 2) so the automated gate can run cleanly against a project that now permanently contains one real manual-verification order/Attempt #1 (Section 38). No product/application code was touched except one additive `data-testid` (Section 50). No Phase 2C+ functionality was introduced. The real order (`eabed2c4-5d48-4f20-8cc9-67248564648a`, Attempt #1, `FAILED_OBSERVED`, no Razorpay Order ID) was not read, deleted, mutated, or otherwise touched by anything in this round.

## 49. Root cause — Defect 1 (`05-final-state.integration.test.ts`)

The file's two "table is fully empty" assertions (`orders`, `payment_attempts`) were correct only for a project with zero manual data. They became stale, not wrong-by-design, the moment the real Attempt #1 order began to permanently exist. The other 5 assertions in the same file (which check only this run's own tracked IDs, plus the `fulfilments` global-zero invariant) were never affected.

## 50. Correction — Defect 1

1. `tests/integration/supabase/helpers.ts`: added `TEST_DATA_RECEIPT_PREFIX = "integration-test-"`, a stable prefix shared by every `taggedValue()` this suite has ever produced, across every run — not per-process like `TEST_RUN_TAG` (which is this same prefix plus a per-run UUID). Deliberately disjoint from the real application's own receipt format (`lib/demo-merchant/service.ts`'s `generateRazorpayReceipt()` always produces `pc_...`), so it can never false-positive against real data.
2. `tests/integration/supabase/05-final-state.integration.test.ts`: rewritten (7 tests → 5 tests). Removed: the two global-emptiness assertions. Kept unchanged: the ledger-based checks that none of `allCreatedOrderIds`/`allCreatedAttemptIds` (this run's own append-only ID lists) remain, and the `fulfilments` global-zero check (still a true invariant — no Phase 1/2B code path ever inserts a fulfilment row). Added: a stronger `payment_attempts` leak check — no row anywhere carries the `TEST_DATA_RECEIPT_PREFIX` prefix, catching a leak from _any_ past run, not just this one. `orders` has no tag column of its own, so the ledger check remains the achievable precision there — no schema change was made or needed.

Legitimate non-test application data (the real order/attempt) is never read, deleted, updated, or required-absent by this file.

## 51. Root cause — Defect 2 and two additional environment-exposed defects found during verification

1. **Price locator ambiguity (the originally confirmed defect):** `getByText("₹500.00")` in `tests/e2e/demo-merchant.spec.ts` matched both the fixed product card and the real order's identical amount once that order appeared in "Recent Internal Orders."
2. **Cold-compile navigation timeout (found while re-verifying the fix):** `expect(page).toHaveURL(/\/demo-merchant$/)` used Playwright's default 5000ms timeout. This machine's memory pressure during this task (as low as ~0.28 GB free of ~7.7 GB, confirmed via `Get-CimInstance Win32_OperatingSystem`) made the first-ever Next.js dev-mode compile of `/demo-merchant` in a fresh `webServer` process exceed that default — a timing assumption, not a locator defect, but it reproduced deterministically (3 consecutive attempts) until corrected.
3. **Post-creation stale-read race (found while re-verifying the fix):** immediately after clicking "Create Internal Test Order," the test trusted `getByTestId("order-id").first()` as "the order I just created." Once "Recent Internal Orders" is routinely non-empty (now the normal long-term state, not a corner case), that locator can still show the _previous_ first order for a moment before the server action's revalidation lands — especially under this machine's current load. This was confirmed empirically with direct, read-only Supabase queries during investigation: two consecutive runs each captured the _previous_ run's leftover order as `createdOrderId`, so cleanup deleted the wrong (older) row each time, leaving a one-run-behind orphan trail. No double order-creation and no missing pending-guard was found — `app/demo-merchant/create-order-button.tsx` already correctly disables the button via `useTransition`'s `isPending`; this was purely a test-side race, not a product defect.

## 52. Correction — Defect 2 and the two additional issues

All changes are confined to `tests/e2e/demo-merchant.spec.ts` (test-only) plus one additive `data-testid` in `app/demo-merchant/page.tsx`:

1. `app/demo-merchant/page.tsx`: added `data-testid="fixed-product-price"` to the fixed product card's price paragraph — the only product-code change in this round, purely additive (a new test hook, no behavior change).
2. `tests/e2e/demo-merchant.spec.ts`: the price assertion now targets `page.getByTestId("fixed-product-price")` instead of a page-wide text search.
3. `tests/e2e/demo-merchant.spec.ts`: the initial navigation assertion now uses an explicit `{ timeout: 20_000 }` (was the 5000ms default), scoped to that one line only — no change to `playwright.config.ts`.
4. `tests/e2e/demo-merchant.spec.ts`: the order-creation step now captures whichever order is first _before_ clicking, then waits for the first order-id to actually change (`not.toHaveText(previousFirstOrderId)`, or simply become visible if the list was empty) before trusting it as `createdOrderId` — closing the stale-read race directly rather than retrying around it.
5. `tests/e2e/demo-merchant.spec.ts`: added a per-test `test.setTimeout(60_000)` (Playwright's per-test override, not a `playwright.config.ts` change) so this one real-navigation, real-DB test has enough budget under this machine's current load; the order-creation wait's own timeout was raised to 40,000ms within that budget.

All other e2e selectors were inspected for the same class of hidden assumption (Section 46/the original task's instruction). Every per-order assertion already used `.first()` targeting the newest order regardless of historical count; `045-demo-merchant-service.integration.test.ts` already used `.find()`, not a length assumption. No further changes were made — the UI itself was not redesigned.

## 53. Files changed this round

- `tests/integration/supabase/helpers.ts` — added `TEST_DATA_RECEIPT_PREFIX`.
- `tests/integration/supabase/05-final-state.integration.test.ts` — rewritten per Section 50.
- `app/demo-merchant/page.tsx` — added one `data-testid`.
- `tests/e2e/demo-merchant.spec.ts` — locator fix, two timeout adjustments, stale-read race fix, per-test timeout override.

No other file was modified in this round. `handoffs/PHASE-2-HANDOFF.md` (this file) was updated as the last step.

## 54. Automated results (this round)

| Command                                                                          | Result                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/integration/supabase/05-final-state.integration.test.ts` (individually)   | 5/5 passed                                                                                                                                                                                                                                                                                                                                                                                    |
| `npm run test:integration:supabase` (full)                                       | 7/7 files, 41/41 tests, exit 0                                                                                                                                                                                                                                                                                                                                                                |
| `tests/e2e/demo-merchant.spec.ts` (individually, within full `npm run e2e` runs) | Failed 4 times while diagnosing/fixing the three issues in Section 51 (evidence and reasoning for each recorded in-session); passed cleanly on the 2 runs after all three fixes landed                                                                                                                                                                                                        |
| `npm run e2e` (full, post-fix, run twice for stability)                          | 2/2 tests, exit 0 — twice in a row (38.9s then 16.9s)                                                                                                                                                                                                                                                                                                                                         |
| `npm run test` (full unit suite)                                                 | First attempt: 9/9 files that started passed (136/136 tests), but 11 files failed to start a Vitest `forks` worker (previously-documented memory-pressure pattern, confirmed again via `Get-CimInstance Win32_OperatingSystem`: ~0.39 GB free). Ran the 11 affected files individually, no config change: all 11 passed (151/151 tests). **Combined: 20/20 files, 287/287 tests, all green.** |
| `npm run lint`                                                                   | exit 0                                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run typecheck`                                                              | exit 0                                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run build`                                                                  | Attempt 1: stale `.next/server/edge` EPERM (previously-documented artifact). Deleted the gitignored `.next/`, rebuilt once → exit 0                                                                                                                                                                                                                                                           |
| `npx prettier --check` on all 4 changed files                                    | All 4 pass                                                                                                                                                                                                                                                                                                                                                                                    |

## 55. Data-safety audit

- The real order `eabed2c4-5d48-4f20-8cc9-67248564648a` / Attempt #1 (`FAILED_OBSERVED`, no Razorpay Order ID) was verified present and unmodified via direct read-only Supabase queries at multiple points during this round, and is **not** touched by any assertion, delete, or update in either corrected test file.
- No broad `DELETE` was added or executed anywhere. All e2e cleanup remains exact-ID-scoped, unchanged in shape from the existing `tests/e2e/demo-merchant.spec.ts` `finally` block.
- **New finding, disclosed rather than silently fixed:** while diagnosing the stale-read race (Section 51 item 3), this investigation's own repeated e2e runs left one orphaned test-created order in the real Supabase project: `aef02f24-7ee8-471e-88a0-6f3523aab038` (₹500.00, UNPAID/OPEN, created 2026-08-24T09:01:52Z during this session's own diagnostic runs). It is not the real manual order and not touched by any repository code path differently than any other order. An attempt to delete it by its exact ID, via a one-off read-only-then-exact-ID-delete Node script mirroring the existing `tests/e2e/support/service-role-client.ts` pattern, was **blocked by this session's permission classifier** (destructive DB action outside the reviewed test code paths); per the instruction not to work around a denial, it was left in place rather than forced through. **This orphan still exists in the database and requires the developer's own decision to remove it.** The temporary diagnostic script itself was deleted from the repository (`inspect-orders.mjs`, never committed, confirmed absent from `git status`).
- No secret was printed, logged, or committed. `.env.local` was read only by the existing, already-reviewed `tests/e2e/support/service-role-client.ts` loader pattern (and its one-off diagnostic mirror, now deleted).

## 56. Scope audit

No Phase 2C+ functionality (Checkout, webhook, signature verification) was introduced. No schema/migration change. No RLS change. No `playwright.config.ts` or `vitest.config*.ts` change — all timeout adjustments are local, per-assertion or per-test overrides. The only non-test file touched was `app/demo-merchant/page.tsx`, and only to add one `data-testid` attribute (no rendering/behavior change). `git rev-parse HEAD` remained `d99e30ceafcc4b97d9255bdae0a48d0875a0e63b` throughout — nothing was committed.

## 57. TG-01 through TG-15 acceptance criteria

| #     | Criterion                                                                          | Result                                                                                                                                     |
| ----- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| TG-01 | Developer's real order/Attempt #1 preserved                                        | PASS — verified present/unmodified via direct read-only query                                                                              |
| TG-02 | No automated test globally requires empty tables merely because manual data exists | PASS — both global-emptiness assertions removed from `05-final-state.integration.test.ts`                                                  |
| TG-03 | Final-state checks still prove no test-owned rows leak                             | PASS — ledger-based `orders` check + stable-prefix `payment_attempts` check (any-run) + `fulfilments` global-zero check, all still present |
| TG-04 | All Phase 2B correlation integration tests remain green                            | PASS — `046-payment-attempt-razorpay-correlation.integration.test.ts` included in the 41/41 full-suite pass                                |
| TG-05 | Full Supabase integration suite passes                                             | PASS — 7/7 files, 41/41 tests                                                                                                              |
| TG-06 | Playwright price assertion unambiguous with historical orders present              | PASS — scoped to `data-testid="fixed-product-price"`                                                                                       |
| TG-07 | Playwright doesn't assume Recent Internal Orders is empty                          | PASS — order-creation step now waits for a real change in the first order-id rather than assuming an empty or single-row list              |
| TG-08 | Full Playwright suite passes                                                       | PASS — 2/2 tests, exit 0, confirmed twice in a row                                                                                         |
| TG-09 | Full unit suite passes                                                             | PASS — 20/20 files, 287/287 tests                                                                                                          |
| TG-10 | Lint passes                                                                        | PASS                                                                                                                                       |
| TG-11 | Typecheck passes                                                                   | PASS                                                                                                                                       |
| TG-12 | Build passes                                                                       | PASS (after the previously-documented stale-`.next` EPERM workaround)                                                                      |
| TG-13 | No Phase 2C+ implementation introduced                                             | PASS                                                                                                                                       |
| TG-14 | No secrets exposed                                                                 | PASS                                                                                                                                       |
| TG-15 | HEAD remains exactly `d99e30ceafcc4b97d9255bdae0a48d0875a0e63b`                    | PASS                                                                                                                                       |

## 58. Status

Both confirmed test-harness defects are corrected and verified with evidence. The full required gate (both integration suites, both e2e tests, full unit suite, lint, typecheck, build, formatting) is green. **A successful real Razorpay Test Mode re-test (Section 47) is still pending** — that is manual work for the developer, not performed by this round. Phase 2B is **not** marked MANUALLY VERIFIED and **not** marked APPROVED. One data-safety item requires developer attention: the orphaned test order `aef02f24-7ee8-471e-88a0-6f3523aab038` (Section 55) — this session could not remove it itself.

---

# PHASE 2B — FINAL REAL RAZORPAY TEST MODE VERIFICATION

## 59. Real Razorpay Test Mode manual verification evidence

The developer has completed the real Razorpay Test Mode manual verification that Section 47 (and Section 36 before it) left pending. The following was reported by the developer as their own manual testing against their real, private local Razorpay Test Mode credentials. **Claude did not open the Razorpay Dashboard and cannot independently verify it** — that part is developer-attested, exactly as Section 13's convention already established for Phase 2A. Everything on the Supabase side, however, was independently re-verified by Claude via direct, read-only, exact-ID/exact-order-scoped Supabase queries (service-role client, no mutation) run after the developer's report — the results below are Claude's own confirmed observations, not a transcription of the developer's claim alone.

### A. First provider attempt — preserved evidence (independently confirmed)

Merchant order `eabed2c4-5d48-4f20-8cc9-67248564648a` still exists. Its Attempt #1 row, queried directly:

```json
{
  "attempt_no": 1,
  "status": "FAILED_OBSERVED",
  "razorpay_receipt": "pc_eabed2c4-5d48-4f20-8cc9-67248564648a_1_08af81f9-18b6-4c5a-ac5e-fd72cdfde9a1",
  "razorpay_order_id": null,
  "razorpay_order_status": null
}
```

This is the original over-length receipt (Section 38/39), preserved byte-for-byte, unresolved (`razorpay_order_id`/`razorpay_order_status` still `NULL`). Not deleted, not rewritten, not reused.

### B. Corrected second attempt (independently confirmed)

The same query returned a second row for the same order:

```json
{
  "attempt_no": 2,
  "status": "ORDER_CREATED",
  "razorpay_receipt": "pc_d9af9a8b7d524c7facef2fc74e9b6be5",
  "razorpay_order_id": "order_TTYzkTb1oMiRwP",
  "razorpay_order_status": "created"
}
```

Receipt format matches the corrected `pc_<32 hex chars>` shape (Section 40 item 1), 35 characters total, well under the 40-character provider limit (Section 40 item 2). Matches the developer's report exactly.

### C. Razorpay Dashboard verification (developer-attested, not independently verified by Claude)

The developer reports opening the matching Order in the Razorpay Test Mode Dashboard and observing: Test Mode enabled; Order ID `order_TTYzkTb1oMiRwP`; Amount ₹500.00; Currency INR; Status Created; Attempts 0; Payments: No Payments. This is recorded as developer-attested evidence, distinct from Claude's own Supabase-side confirmation in B/D/E/F, following the same convention as Section 13.

### D. Supabase `payment_attempts` verification (independently confirmed)

Both rows above (A and B) were retrieved in a single query scoped to `order_id = eabed2c4-5d48-4f20-8cc9-67248564648a`, ordered by `attempt_no` — exactly 2 rows, no others. A separate query across the whole `payment_attempts` table for any row with a non-`NULL` `razorpay_order_id` returned exactly one match: this same Attempt #2 row. No other attempt, in this run or any other test, carries a Razorpay Order ID — the partial unique index (Section 28) has never been challenged by a duplicate.

### E. Merchant-state verification (independently confirmed)

Direct query of `orders` for `eabed2c4-5d48-4f20-8cc9-67248564648a`:

```json
{
  "amount_subunits": 50000,
  "currency": "INR",
  "payment_status": "UNPAID",
  "business_status": "OPEN"
}
```

Unchanged from before the real Order was created. Razorpay Order creation did not mark the merchant order paid.

### F. Fulfilment verification (independently confirmed)

Direct `count`-only query of `fulfilments` scoped to `order_id = eabed2c4-5d48-4f20-8cc9-67248564648a`: **0 rows.** Phase 2B introduced no fulfilment side effect.

### G. Additional observation (out of scope, disclosed for transparency)

The same sweep also found one unrelated, inert order — `b927b620-4314-4d6a-8bad-b95cf701a5c8` (₹500.00, UNPAID/OPEN, created 2026-08-24T09:08:44Z, zero `payment_attempts` rows). It is not part of the verification flow described above and was not created by any automated test in this session (both e2e runs after the test-gate fixes completed their own cleanup successfully — Section 54). It is most likely from the developer's own separate manual UI exploration. Not investigated further and not modified — flagged here only for an accurate record, not evaluated as a defect.

## 60. Preserved Phase 2B history (all rounds)

For continuity, the full debugging history remains intact across this document and is not rewritten:

1. Initial real Razorpay Order creation failed (Section 38).
2. Root cause: receipt length exceeded Razorpay's 40-character maximum (Section 39).
3. Attempt #1 correctly preserved as `FAILED_OBSERVED` evidence, never deleted or reused (Section 39/59-A).
4. Receipt generation corrected to the 35-character `pc_<32 hex>` format (Section 40).
5. `FAILED_OBSERVED` retry semantics corrected — a resolved rejection is never reused (Section 40).
6. Adapter gained a provider-contract receipt-length guard, `RazorpayReceiptInvalidError` (Section 40).
7. `05-final-state.integration.test.ts` corrected to require only test-owned-data cleanliness, not global table emptiness, once legitimate manual data existed (Sections 49–50).
8. Playwright selectors/waits corrected (price-locator scoping, cold-compile timeout, stale-read race) so real historical orders and this machine's resource pressure do not break the Demo Merchant e2e test (Sections 51–52).
9. The diagnostic e2e orphan order (`aef02f24-7ee8-471e-88a0-6f3523aab038`, flagged in Section 55 as needing developer action) was manually deleted by the developer using an exact-ID-guarded statement — independently confirmed gone in Section 59.
10. The successful real Razorpay Test Mode re-test then produced Attempt #2 / `ORDER_CREATED` (Section 59-B).

This history — a real provider rejection correctly surfaced, correctly preserved as evidence, and correctly recovered from without masking or fabricating state — is itself evidence that PayChaos handles failure safely, consistent with the project's Evidence-First Diagnosis principle.

## 61. Final automated test summary (carried forward from Section 54, not re-run this round)

| Command                             | Result                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:integration:supabase` | 7/7 files, 41/41 tests, exit 0                                                                                                                                                              |
| `npm run e2e`                       | 2/2 tests, exit 0 — confirmed on two consecutive clean runs after the test-harness fixes                                                                                                    |
| `npm run test` (full unit suite)    | 20/20 files, 287/287 tests, exit 0 (some files required sequential execution due to Windows memory pressure causing Vitest fork-worker startup failures; no test configuration was changed) |
| `npm run lint`                      | exit 0                                                                                                                                                                                      |
| `npm run typecheck`                 | exit 0                                                                                                                                                                                      |
| `npm run build`                     | exit 0 (after the documented stale `.next` EPERM cleanup/retry)                                                                                                                             |
| Formatting                          | All Phase 2B-round changed files Prettier-clean                                                                                                                                             |

This round (documentation-only) did not modify any application code or test file, so these results are not stale — nothing has changed since they were produced.

## 62. Phase 2B lifecycle state (final)

```
IMPLEMENTED          PASS
TESTED               PASS
MANUALLY VERIFIED    PASS
DOCUMENTED           PASS
APPROVED             PENDING ARCHITECT REVIEW
```

Phase 2 overall remains:

```
IN PROGRESS
NOT APPROVED
```

Phase 2A: APPROVED PENDING ARCHITECT REVIEW (Section 19, unchanged). Phase 2B: as above. Phase 2C–2G: NOT IMPLEMENTED.

## 63. Phase 2B acceptance criteria (final)

| Criterion                                              | Result                                  | Evidence                                                                                             |
| ------------------------------------------------------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Test Mode configuration reused                         | PASS                                    | Section 3/9 (Phase 2A); real Order succeeded only because a real `rzp_test_` credential was in use   |
| server-only Razorpay adapter                           | PASS                                    | Section 22/33 item 4                                                                                 |
| Trusted order amount/currency (never browser-supplied) | PASS                                    | Section 23/24; Section 59-E confirms merchant order amount/currency unchanged                        |
| Stable, valid receipt                                  | PASS                                    | Section 59-B: `pc_d9af9a8b7d524c7facef2fc74e9b6be5`                                                  |
| ≤40-character provider contract                        | PASS                                    | 35 characters observed; pre-flight guard in Section 40 item 2                                        |
| Real Razorpay Test Order created                       | PASS                                    | Section 59-B/C: `order_TTYzkTb1oMiRwP`                                                               |
| Trusted Razorpay Order ID persisted                    | PASS                                    | Section 59-B/D                                                                                       |
| Razorpay status persisted                              | PASS                                    | Section 59-B: `razorpay_order_status = "created"`                                                    |
| Internal status `ORDER_CREATED`                        | PASS                                    | Section 59-B                                                                                         |
| Failed Attempt #1 preserved                            | PASS                                    | Section 59-A                                                                                         |
| Corrected Attempt #2 created                           | PASS                                    | Section 59-B                                                                                         |
| Merchant remains UNPAID                                | PASS                                    | Section 59-E                                                                                         |
| Merchant remains OPEN                                  | PASS                                    | Section 59-E                                                                                         |
| Fulfilment remains zero                                | PASS                                    | Section 59-F                                                                                         |
| Database uniqueness verified                           | PASS                                    | Section 59-D — exactly one `payment_attempts` row across the whole table carries a Razorpay Order ID |
| No Checkout                                            | PASS                                    | Section 33 item 7, unchanged this round                                                              |
| No webhook                                             | PASS                                    | Section 33 item 7, unchanged this round                                                              |
| No payment                                             | PASS                                    | Section 59-C: Dashboard shows 0 attempts, no payments (developer-attested)                           |
| No Phase 2C+                                           | PASS                                    | Section 56, unchanged this round                                                                     |
| No secrets exposed                                     | PASS                                    | Section 33/44/55, unchanged this round; no credential printed or logged in this round                |
| All required automated gates passed                    | PASS                                    | Section 61                                                                                           |
| Real Razorpay TEST dashboard verification completed    | PASS (developer-attested)               | Section 59-C                                                                                         |
| Real Supabase correlation verification completed       | PASS (independently verified by Claude) | Section 59-B/D                                                                                       |

## 64. Status

Phase 2B is now IMPLEMENTED, TESTED, MANUALLY VERIFIED, and DOCUMENTED, with real Razorpay Test Mode provider evidence independently cross-checked against Supabase. It is **not self-approved** — APPROVED remains PENDING ARCHITECT REVIEW, per this project's standing rule that only architect/project review grants final approval. Phase 2 overall remains IN PROGRESS / NOT APPROVED; Phase 2C–2G remain fully deferred and unimplemented.
