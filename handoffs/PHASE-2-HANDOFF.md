# Phase 2 Handoff

**This is the living Phase 2 handoff.** It will be extended in place by Phase 2B through Phase 2G as they are implemented — it is not replaced per checkpoint.

- **Phase:** Phase 2 — Razorpay Test Mode + Payments + Webhooks
- **Current branch:** `phase-2-razorpay`
- **Phase 2 starting HEAD:** `47cb275cd2d200b879f80a331ca4848ee2b709b3`
- **Overall Phase 2 status: IN PROGRESS — NOT APPROVED**
- **Completed checkpoint documented in this file: Phase 2A — Razorpay Test Configuration**
- **Phase 2B through Phase 2G: NOT IMPLEMENTED**

Phase 2 as a whole is not implemented, not tested, not manually verified, not documented, and not approved. Only the Phase 2A slice described below has any of those properties, and only for its own narrow scope.

---

## 1. Phase identity and current status

| Sub-phase | Status |
|---|---|
| Phase 2A — Razorpay Test Configuration | IMPLEMENTED, TESTED, MANUALLY VERIFIED (see Section 19) |
| Phase 2B — Razorpay Order Creation | NOT IMPLEMENTED |
| Phase 2C — Checkout Integration | NOT IMPLEMENTED |
| Phase 2D — Webhook Ingestion | NOT IMPLEMENTED |
| Phase 2E — Event Deduplication and Normalization | NOT IMPLEMENTED |
| Phase 2F — Merchant Processing and Idempotency | NOT IMPLEMENTED |
| Phase 2G — Real Test Mode Verification | NOT IMPLEMENTED |

No real Razorpay Order has been created by PayChaos. No real Razorpay payment has been made. No webhook has been received. Nothing in this document should be read as claiming otherwise.

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

| Command | Result |
|---|---|
| `npx vitest run tests/unit/config/razorpay-env.test.ts tests/unit/config/env-validation.test.ts tests/unit/config/env-files.test.ts tests/unit/instrumentation.test.ts` | **4/4 files, 60/60 tests, exit 0** |
| `npm run test` | **19/19 files, 234/234 tests, exit 0** |
| `npm run test:integration:supabase` | **6/6 files, 38/38 tests, exit 0** — proves Phase 1's real Supabase state (schema, RLS, cleanup) remains intact with the new Razorpay startup config present |
| `npm run e2e` | **2/2 tests passed, exit 0** — confirms the existing Demo Merchant flow still works with `instrumentation.ts` now also validating Razorpay config at server startup |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0, 0 warnings/errors |
| `npm run build` | exit 0, `/demo-merchant` still listed `ƒ (Dynamic)` |

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

| ID | Result | Evidence |
|---|---|---|
| 2A-AC-01 | PASS | Reuses `env-validation.ts`/`instrumentation.ts` pattern exactly; no parallel config system (Section 3–5). |
| 2A-AC-02 | PASS | `razorpay-env.test.ts` "parses successfully using fake Test Mode values"; developer manual check A. |
| 2A-AC-03 | PASS | `RAZORPAY_MODE` missing/`"live"`/empty all rejected (automated); developer manual check B confirms the live path fails closed for the adjacent Key ID contract too. |
| 2A-AC-04 | PASS | Fake `rzp_test_...` Key ID accepted (automated); developer manual check A confirms with a real Test Key ID. |
| 2A-AC-05 | PASS | Fake `rzp_live_...` Key ID rejected (automated, 3 test files); developer manual check B reproduces this live with a real running server. |
| 2A-AC-06 | PASS | Missing/empty Key ID/Key Secret/Mode all rejected (automated). |
| 2A-AC-07 | PASS | `import "server-only"` confirmed; no client import; no `NEXT_PUBLIC_` export (Section 12). |
| 2A-AC-08 | PASS | Dedicated leak-safety tests; developer manual check B's observed error contains no credential value. |
| 2A-AC-09 | PASS | No migration/schema touched (Section 7). |
| 2A-AC-10 | PASS | No Phase 2B–2G code exists (Section 1, 17). |
| 2A-AC-11 | PASS | 4/4 files, 60/60 tests, exit 0 (Section 10). |
| 2A-AC-12 | PASS, WITH A NOTED KNOWN TOOLING ISSUE | `lint`, `typecheck`, `test` (19/19/234/234), `test:integration:supabase` (6/6/38/38), `build`, and `e2e` (2/2) all pass cleanly, exit 0. `format:check` passes for every individual Phase 2A file. The repo-wide `npm run format:check` command itself still exits 1, but only due to 58 pre-existing, out-of-Phase-2A-scope files (Section 11) — this is recorded as a known tooling issue (Section 16), not represented as a passing command it is not. |
| 2A-AC-13 | PASS | Section 12. |
| 2A-AC-14 | PASS | No commit created; `HEAD` unchanged at `47cb275cd2d200b879f80a331ca4848ee2b709b3` throughout. |

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

**Phase 2 overall:**
```
IN PROGRESS
NOT APPROVED
```
