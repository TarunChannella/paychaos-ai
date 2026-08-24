# Phase 1 Handoff

## 1. Phase identity

- Phase 1 — Foundation + Demo Merchant
- Branch: `phase-1-foundation`
- Final Phase 1 HEAD before this handoff commit: `91eb4cfc296eb5127dd93a9e9e9f7c9275611940` ("feat: establish Phase 1E Demo Merchant workflow")
- Date: 2026-08-24
- Status: **APPROVED — architect review completed 2026-08-24**

---

## 2. Objective achieved

A stable, single Next.js/TypeScript application connected to a real Supabase PostgreSQL project, with a small Demo Merchant domain model, a working internal order-creation flow, an established server/client trust boundary, and a full Vitest/Playwright test foundation — all without any Razorpay payment processing, which remains out of scope until Phase 2.

---

## 3. Completed features

**Phase 1A — Repository & Tooling Foundation**
Next.js 16 (App Router, Turbopack) + React 19 + TypeScript (strict) + Tailwind v4 + shadcn/ui; ESLint + Prettier; Vitest; Playwright; baseline application shell.

**Phase 1B — Environment & Security Foundation**
Typed environment configuration (`lib/config/client-env.ts`, `lib/config/server-env.ts`, `lib/config/env-validation.ts`) with structural server/client separation; `instrumentation.ts` startup validation; secret-redacting structured logger (`lib/security/logger.ts`); `.env.example`.

**Phase 1C — Supabase Foundation**
`lib/supabase/server.ts` (lazy singleton, `import "server-only"`), `lib/supabase/types.ts` (typed `Database` scoped to `orders`/`payment_attempts`/`fulfilments`); the approved Phase 1 migration; full real-Supabase integration test suite (connectivity, CRUD, constraints, anon/RLS denial, cleanup).

**Phase 1D — Demo Merchant Domain**
Pure, I/O-free domain layer (`lib/demo-merchant/{types,order,transitions,projection}.ts`): status enums, the frozen legal payment-status transition table, `ORD-001`/`PAYATT-001`/`PAYATT-002` amount/currency-immutability rules, and the conceptual-state projection that rejects impossible state combinations.

**Phase 1E — Demo Merchant UI + Internal Order Creation**
Fixed server-owned product (`lib/demo-merchant/product.ts`); server-only repository/service (`lib/demo-merchant/repository.ts`, `service.ts`); safe view-model mapping (`view-model.ts`); the Demo Merchant screen (`app/demo-merchant/page.tsx`) and zero-argument Server Action (`app/demo-merchant/actions.ts`, `create-order-button.tsx`); a real-DB integration test for the new service path; a Playwright flow with exact-ID, self-verifying cleanup; a custom Vitest sequencer guaranteeing deterministic integration-file ordering.

**Phase 1F — Foundation Testing (this phase)**
Full re-verification of build, type-checking, environment handling, domain logic, Supabase integration, Demo Merchant rendering, and security boundaries, described in Sections 11–13 below.

---

## 4. Important Git checkpoints

From `git log --oneline` on `phase-1-foundation`:

```
91eb4cf feat: establish Phase 1E Demo Merchant workflow
8f839d0 feat: establish Phase 1D Demo Merchant domain
5bf72cd feat: establish Phase 1C Supabase foundation
556c7ad feat: establish Phase 1B environment security foundation
970093e feat: establish Phase 1A application foundation
ac8206d docs: resolve Phase 1 fulfilment schema dependency
44702ae chore: freeze PayChaos architecture and Claude agent team
```

---

## 5. Files added/modified/removed

By module (no `node_modules`/generated files):

- **Config/tooling**: `package.json`, `tsconfig.json`, `eslint.config.mjs`, `.prettierrc`-equivalent config, `vitest.config.ts`, `vitest.integration.config.ts`, `playwright.config.ts`, `next.config.ts`, `instrumentation.ts`, `.env.example`
- **Environment/security**: `lib/config/client-env.ts`, `lib/config/server-env.ts`, `lib/config/env-validation.ts`, `lib/security/logger.ts`
- **Supabase**: `lib/supabase/server.ts`, `lib/supabase/types.ts`, `supabase/migrations/20260823000000_phase1_foundation_schema.sql`
- **Demo Merchant domain (frozen)**: `lib/demo-merchant/types.ts`, `order.ts`, `transitions.ts`, `projection.ts`
- **Demo Merchant application (Phase 1E)**: `lib/demo-merchant/product.ts`, `repository.ts`, `service.ts`, `view-model.ts`
- **UI**: `app/page.tsx`, `app/demo-merchant/page.tsx`, `app/demo-merchant/actions.ts`, `app/demo-merchant/create-order-button.tsx`
- **Tests**: `tests/unit/**` (18 test files, 201 tests); `tests/integration/supabase/**` — 6 Supabase integration test files (`01-connectivity`, `02-service-role-crud`, `03-constraints`, `04-anon-rls`, `045-demo-merchant-service`, `05-final-state`, each `*.integration.test.ts`), 38 integration tests total, plus supporting integration infrastructure (`helpers.ts`, `setup-env.ts`, `sequencer.ts` — none of these three are test files themselves); `tests/e2e/**` — 2 Playwright spec files (`app-shell.spec.ts`, `demo-merchant.spec.ts`), plus supporting e2e infrastructure (`support/service-role-client.ts`, not a spec file)
- **Removed**: none

No files were added, modified, or removed during Phase 1F itself beyond this handoff document (see Section 12).

---

## 6. Architecture

Frozen Phase 1 boundaries, per `docs/ARCHITECTURE.md`:

- **Modular monolith**: one Next.js/TypeScript application, no microservices.
- **Dependency direction**: UI → Server Action → Application Service → Domain → Repository/Supabase. Verified directly: `app/demo-merchant/page.tsx` / `create-order-button.tsx` → `app/demo-merchant/actions.ts` (`"use server"`) → `lib/demo-merchant/service.ts` → `lib/demo-merchant/order.ts` (domain) + `lib/demo-merchant/repository.ts` (Supabase).
- **Supabase PostgreSQL** is the durable system record.
- **Server/client trust boundary**: `server-only` import in every I/O-touching module (`lib/supabase/server.ts`, `lib/config/server-env.ts`, `lib/demo-merchant/repository.ts`, `lib/demo-merchant/service.ts`).
- **Browser is non-authoritative**: the only mutation path is the zero-argument `createDemoMerchantOrderAction`; no browser-controllable field reaches `insertOrder`.
- **No Razorpay payment processing in Phase 1** — confirmed absent from `package.json` and from all application code (only doc-comment/UI-label mentions of "Razorpay Test Mode" exist).

---

## 7. Environment/configuration

Variable names only (no values):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

`.env.local` is git-ignored (`.gitignore:38: .env* → .env.local` per `git check-ignore -v`) and not tracked (`git ls-files .env.local` returns nothing). `.env.example` is tracked and contains variable names only, no real values.

---

## 8. Database

Approved Phase 1 tables (migration `supabase/migrations/20260823000000_phase1_foundation_schema.sql`, unchanged since Phase 1C approval):

- `orders`
- `payment_attempts`
- `fulfilments`

All three have RLS enabled with zero `CREATE POLICY` statements and explicit `REVOKE ALL ... FROM anon, authenticated` plus explicit `GRANT ... TO service_role`. `fulfilments` is created **without** `payment_id`/`trigger_processing_attempt_id` (Phase 2-additive per `docs/DATABASE.md`); Phase 1 never inserts a `fulfilments` row — verified by `05-final-state.integration.test.ts` proving `fulfilments` count is always 0. **No new Phase 1F schema change was made**; the migration file is byte-identical to its Phase 1C-approved state (`git diff -- supabase/` is empty).

---

## 9. Demo Merchant behavior

Fixed product (`lib/demo-merchant/product.ts`):

```
name = "PayChaos Test Product"
amount_subunits = 50000   (₹500.00)
currency = "INR"
```

Every order `createDemoMerchantOrder()` creates begins as:

```
payment_status = UNPAID
business_status = OPEN
fulfilment count = 0
conceptual state = "Created"
```

The browser supplies no order field (amount, currency, id, status, timestamps) — `createDemoMerchantOrderAction` is zero-argument, and `InsertOrderInput` contains only `amountSubunits`/`currency`, both sourced from the fixed server-owned product.

---

## 10. Security boundaries

- **Application runtime**: `SUPABASE_SERVICE_ROLE_KEY` is obtained only through `lib/config/server-env.ts` (`import "server-only"` guarded) and used only by `lib/supabase/server.ts`; it is never available to browser/client code, and `lib/demo-merchant/repository.ts`/`service.ts` remain server-only (`import "server-only"` guarded) consumers of that client.
- **Test runtime**: `tests/e2e/support/service-role-client.ts` separately loads the same credential in the Node Playwright process, for trusted exact-ID cleanup only. It is test-only infrastructure — it does not import `lib/supabase/server.ts` (that module's `server-only` guard throws outside a bundler's react-server condition) and instead builds an equivalent client directly from `@supabase/supabase-js`. It is not imported by `app/`, `components/`, or any production `lib/` path (confirmed by Grep), and the credential it loads is absent from the built client bundle (`.next/static`, confirmed by Grep — see Section 11).
- RLS denies `anon` on `SELECT`/`INSERT`/`UPDATE`/`DELETE` for all three tables — proven by `04-anon-rls.integration.test.ts` (12 tests, all passing) both in Phase 1C and again independently in Phase 1F.
- No browser-controllable path can set `payment_status = PAID`, mutate `business_status`, or insert into `payment_attempts`/`fulfilments` — `insertOrder`'s `InsertOrderInput` type has no such fields.
- `SUPABASE_SERVICE_ROLE_KEY` / `supabaseServiceRoleKey` identifiers are absent from `.next/static` after a fresh production build (Grep scan, Phase 1F).
- `tests/e2e/support/service-role-client.ts` (the only place a privileged Supabase client exists outside `lib/supabase/server.ts`) is not imported by `app/`, `components/`, or `lib/` — confirmed by Grep in Phase 1F.
- "Razorpay Test Mode" badge is visibly rendered on `/demo-merchant`.

---

## 11. Automated tests

Evidence fields required by `docs/TESTING.md` Section 29.

### Tests Added

Cumulative across Phase 1, by sub-phase (from `git log --diff-filter=A --name-only -- tests/`; Phase 1F added no new test files — it is a testing/verification-only phase):

- **Phase 1A**: `tests/e2e/app-shell.spec.ts`; `tests/unit/utils.test.ts`
- **Phase 1B**: `tests/unit/config/{client-env,env-files,env-validation,server-env}.test.ts`; `tests/unit/instrumentation.test.ts`; `tests/unit/security/logger.test.ts`
- **Phase 1C**: `tests/integration/supabase/{01-connectivity,02-service-role-crud,03-constraints,04-anon-rls,05-final-state}.integration.test.ts` (+ infrastructure `helpers.ts`, `setup-env.ts`); `tests/unit/supabase/{migration,server}.test.ts`
- **Phase 1D**: `tests/unit/demo-merchant/{order,projection,transitions}.test.ts`
- **Phase 1E**: `tests/e2e/demo-merchant.spec.ts` (+ infrastructure `tests/e2e/support/service-role-client.ts`); `tests/integration/supabase/045-demo-merchant-service.integration.test.ts` (+ infrastructure `sequencer.ts`); `tests/unit/demo-merchant/{actions,product,repository,security,service,view-model}.test.ts`
- **Phase 1F**: none (testing/verification only)

### Tests Modified

None. `git log --diff-filter=M --name-only -- tests/` returns no results across the entire Phase 1 history — every test file was added exactly once and never subsequently modified.

### Tests Removed

None. `git log --diff-filter=D --name-only -- tests/` returns no results.

### Exact Commands Executed

All commands below were run independently during Phase 1F, in order, against `HEAD = 91eb4cf`:

1. `npm run format:check`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run test`
5. `npm run test:integration:supabase`
6. `npx vitest run --config vitest.integration.config.ts --reporter=verbose`
7. `npm run build`
8. Grep scan of `.next/static` for `SUPABASE_SERVICE_ROLE_KEY` / `supabaseServiceRoleKey`
9. `npm run e2e` (3 attempts — see Playwright Result below)
10. `npm run test:integration:supabase` (post-e2e)

### Exit Codes

`format:check`=0, `lint`=0, `typecheck`=0, `test`=0, `test:integration:supabase`=0 (both runs), verbose integration run=0, `build`=0, `e2e` attempt 1=1, attempt 2=1, attempt 3=0.

### Passed Count

Unit: 201/201. Integration: 38/38 (both the plain run and the verbose proof run; 38/38 again post-e2e). Playwright: 2/2 (on the resolved attempt).

### Failed Count

Zero test **assertion** failures at any point in Phase 1F. Two Playwright **process-level** failures occurred (attempts 1 and 2) — these were not test assertion failures:
- Attempt 1: Playwright's webServer failed to start because a stray, manually-started `next dev` process on port 3000 held Next.js's dev-server lock. Environment/process-state issue; the developer identified and stopped that process. No test ran to an assertion in this attempt.
- Attempt 2: `demo-merchant.spec.ts` failed on `expect(page).toHaveURL(...)` at a 5000ms timeout, before any order was created — the previously-documented cold-Turbopack-compile pattern (`app-shell.spec.ts` passed in this same attempt). Retried once per the approved protocol, zero source/config change.
- Attempt 3: 2/2 passed cleanly.

### Skipped Count

No skipped tests were reported in the final summaries of any Vitest or Playwright run in Phase 1F.

### Build Result

`npm run build` — clean on the first attempt, exit 0. `/demo-merchant` listed `ƒ (Dynamic)` (server-rendered on demand).

### Typecheck Result

`npm run typecheck` — clean, exit 0.

### Lint Result

`npm run lint` — clean, 0 warnings/errors, exit 0.

### Playwright Result

2/2 tests passed on the resolved (3rd) attempt (`app-shell.spec.ts` 15.3s, `demo-merchant.spec.ts` 15.9s), exit 0. See Failed Count above for the two earlier environmental (non-assertion) failures.

### Manual Verification

Performed and reported by the developer — see Section 12 (labeled DEVELOPER MANUAL VERIFICATION EVIDENCE there).

### Screenshots / Safe Evidence

No screenshots were required or captured for this Phase 1 handoff. Safe evidence consists of the command output recorded above/in the Phase 1F verification report, plus the developer's manual verification notes (Section 12).

### Known Test Gaps

Phase-1-relevant gaps only:
- No automated test exercises Supabase becoming unreachable mid-request (e.g. a network failure between a validated-config app and the database); existing tests cover missing/invalid configuration (`env-validation.test.ts`) but not a runtime connectivity failure during an active request.
- No automated test asserts the "Back to home" link's navigation behavior on `/demo-merchant` directly (covered only implicitly by the Demo Merchant Playwright flow, which navigates via the app-shell link rather than this one).

### Accepted Exclusions

Razorpay/payment/webhook/chaos/invariant/diagnosis/regression/reliability-score testing is excluded from Phase 1 per `docs/PHASE_PLAN.md`'s phase boundaries — this is Phase 2/3/4 scope, not missing Phase 1 coverage.

### Regression Tests Added

Phase 1 test suites now protect the following regression boundaries:
- **Money representation**: `tests/unit/demo-merchant/order.test.ts` (amount/currency validation, integer smallest-currency-unit subunits, `ORD-001`/`PAYATT-001`/`PAYATT-002`).
- **Order state**: `tests/unit/demo-merchant/transitions.test.ts` (the frozen legal payment-status transition table) and `projection.test.ts` (impossible-state rejection in the conceptual-state projection).
- **Server/client secret boundary**: `tests/unit/config/{client-env,server-env}.test.ts`, `tests/unit/demo-merchant/security.test.ts` (structural `server-only` checks), `tests/unit/instrumentation.test.ts` (startup validation wiring).
- **RLS**: `tests/integration/supabase/04-anon-rls.integration.test.ts` (12 anon-denial tests across `orders`/`payment_attempts`/`fulfilments`, plus 1 sanity test).
- **Fulfilment business-effect representation**: `tests/unit/demo-merchant/repository.test.ts` (structural check that `InsertOrderInput` contains only `amountSubunits`/`currency`), `tests/integration/supabase/03-constraints.integration.test.ts` (fulfilments orphan-`order_id` rejection), and `tests/integration/supabase/05-final-state.integration.test.ts` (`fulfilments` count is exactly 0 after every integration run).

---

## 12. Manual verification

**DEVELOPER MANUAL VERIFICATION EVIDENCE** — the following was reported by the developer as their own manual testing, not generated or observed directly by Claude, and is recorded here as developer-attested evidence rather than automated proof:

1. Started the local application successfully.
2. Opened the home page.
3. Opened Demo Merchant successfully.
4. Saw: PayChaos Test Product; ₹500.00; INR; Test Mode messaging.
5. Clicked "Create Internal Test Order" exactly once.
6. New order displayed: internal UUID/order ID; Amount ₹500.00; Currency INR; Payment State UNPAID; Business State OPEN; Fulfilment 0 effects; State Created.
7. Confirmed there was no Pay Now, Razorpay Checkout, Mark Paid, Simulate Payment, or Fulfil Order control.
8. Refreshed the page.
9. Confirmed the same order ID and same state remained after refresh.
10. Opened Supabase Table Editor.
11. Confirmed the same `orders` row contained: `amount_subunits = 50000`; `currency = INR`; `payment_status = UNPAID`; `business_status = OPEN`; matching ID; `created_at` timestamp.
12. Confirmed `payment_attempts` had 0 rows for that order.
13. Confirmed `fulfilments` had 0 rows for that order.
14. Browser DevTools search for the literal string `SUPABASE_SERVICE_ROLE_KEY` returned no matches.
15. After manual verification, the developer deleted only that exact manual order row.
16. The developer refreshed Supabase and confirmed `orders = 0`.

This is developer-reported manual evidence, distinct from and in addition to the automated evidence in Section 11. No screenshots were fabricated or claimed.

---

## 13. Acceptance criteria

| ID | Criterion | Result | Evidence |
|---|---|---|---|
| P1-AC-01 | Application starts successfully in local development | **PASS** | Developer manual verification (Section 12, item 1); `npm run dev` used as Playwright's own webServer, which started and served the app successfully in the passing e2e run. |
| P1-AC-02 | Production Next.js build succeeds | **PASS** | `npm run build` exit 0 on first attempt, `/demo-merchant` listed `ƒ (Dynamic)` (Section 11). |
| P1-AC-03 | Supabase connectivity works | **PASS** | `01-connectivity.integration.test.ts` (3/3 tests) passing against the real project (Section 11). |
| P1-AC-04 | Approved Phase 1 migration is correctly applied/represented and current schema tests pass | **PASS** | Migration file unchanged since Phase 1C (`git diff -- supabase/` empty); already applied to the real project during Phase 1C; `03-constraints.integration.test.ts` (12/12) and `04-anon-rls.integration.test.ts` (12/12) pass against the live schema. Migration was **not** reapplied in Phase 1F, per instruction. |
| P1-AC-05 | Demo Merchant can create/display merchant order with expected amount, currency, business state | **PASS** | `045-demo-merchant-service.integration.test.ts` (real DB) and Playwright e2e both confirm ₹500.00/INR/UNPAID/OPEN display; developer manual verification (Section 12, items 4–6). |
| P1-AC-06 | Payment and fulfilment/business state represented separately for later reliability testing | **PASS** | `orders.payment_status` and `orders.business_status` are distinct columns; `fulfilments` is a separate table with a real (always-0-in-Phase-1) count query (`countFulfilmentsForOrderIds`), not a hardcoded value. |
| P1-AC-07 | No Razorpay or Supabase secret appears in client-side code or Git | **PASS** | `.env.local` git-ignored/untracked; `SUPABASE_SERVICE_ROLE_KEY`/`supabaseServiceRoleKey` absent from `.next/static` (Grep scan, Section 10); no `razorpay` package dependency exists. |
| P1-AC-08 | Vitest runs successfully | **PASS** | 18/18 unit files (201/201 tests) and 6/6 integration files (38/38 tests), both exit 0 (Section 11). |
| P1-AC-09 | Playwright runs successfully for the Phase 1 flow | **PASS** | 2/2 tests passed on the resolved attempt, covering the full Demo Merchant flow including persistence-after-refresh and absence of any Checkout UI (Section 11). |
| P1-AC-10 | No Phase 2–4 functionality unnecessarily implemented | **PASS** | Grep across `lib/` and `app/` for `razorpay|chaos|invariant|diagnosis|reliability.?score` returns only doc-comment/UI-label prose (e.g. "Razorpay Test Mode" badge text, a comment citing `docs/MONEY_INVARIANTS.md`) — no implementation code. No `razorpay` package dependency. |

All ten Phase 1 acceptance criteria have direct evidence and PASS.

---

## 14. Architectural decisions

No new architectural decisions were made in Phase 1F. Phase 1E's already-approved decisions remain in force:

- `tests/integration/supabase/sequencer.ts` — a custom Vitest `TestSequencer` (extending `BaseSequencer` from `vitest/node`) forces `05-final-state.integration.test.ts` to run last, since Vitest 4 does not guarantee filename-lexicographic file ordering by default (approved in the "PHASE 1E INTEGRATION ORDERING CORRECTION" round).
- The Playwright e2e cleanup path uses a Node-process-only service-role client (`tests/e2e/support/service-role-client.ts`) that does not import `lib/supabase/server.ts` directly (since that module's `import "server-only"` guard throws outside a bundler's react-server condition); it independently constructs an equivalent client from `@supabase/supabase-js` using the same credential names.

---

## 15. Known issues

1. **Windows/OneDrive Vitest `forks`-pool worker-startup timeout** — Severity: LOW, non-blocking. Occasionally, `npm run test` reports "Timeout waiting for worker to respond" for several files on the first attempt while still passing the files that did start; a retry with zero config/source change has reliably produced a clean pass every time this was observed. This was observed during earlier Phase 1 work (including a Phase 1E-correction verification round earlier in this same engagement), but was **not** observed during the final Phase 1F unit test run — that run was clean on the first attempt (18/18 files, 201/201 tests, exit 0; see Section 11). Retained here as a known LOW non-blocking Windows/OneDrive issue because it was genuinely observed on this machine, not because it recurred in Phase 1F. Root-caused as Windows/OneDrive filesystem/process contention, not a code defect.
2. **Stale `.next/server/edge` EPERM on build** — Severity: LOW, non-blocking. A Windows/OneDrive file-lock artifact that can appear on `npm run build`; fixed by deleting the gitignored `.next/` directory and rebuilding once, with no source change. Did not occur during the final Phase 1F build (clean on first attempt).
3. **Cold-Turbopack Playwright navigation timeout** — Severity: LOW, non-blocking. On the first `npm run e2e` invocation after code/dependency changes, `demo-merchant.spec.ts` can time out on `toHaveURL` (5000ms) before any order is created, because the `/demo-merchant` route's first-ever Turbopack compile takes longer than the assertion timeout. No real database write is attempted before this point. A single retry with zero config/source change has reliably passed, including in Phase 1F (attempt 2 of 3 failed this way; attempt 3 passed 2/2).
4. **Vitest/Vite extensionless custom-sequencer config-loader warning** — Severity: LOW, cosmetic, non-blocking. `vitest.integration.config.ts` imports `./tests/integration/supabase/sequencer` without a file extension; Vite's experimental `configLoader: 'native'` warns about this, while TypeScript's `tsc --noEmit` rejects a `.ts`-suffixed import (`TS5097`) — the two constraints are mutually exclusive under the current toolchain versions. The extensionless form was kept because it satisfies `typecheck`; the warning does not affect exit codes, test execution, or file ordering in any observed run.
5. **A stray manually-started `next dev` process (port 3000) blocked the Phase 1F Playwright run once** — Severity: LOW, non-blocking, environmental. Not a recurring/documented class prior to Phase 1F; the developer identified and stopped the process, after which the e2e gate proceeded normally (subject to known issue 3 above on the very next attempt).

None of the above are product/security defects; each was independently reproduced, understood, and resolved without any change to application, domain, or test logic.

---

## 16. Deferred work

Explicitly deferred to their approved later phases — none of the following exist in Phase 1:

- Razorpay Test Mode Orders (Phase 2)
- Razorpay Checkout (Phase 2)
- Checkout signature verification (Phase 2)
- real Razorpay webhooks / webhook signature verification (Phase 2)
- payment processing / payment-state updates from real Razorpay evidence (Phase 2)
- chaos runner / chaos scenarios (Phase 3)
- Money Invariant Engine (Phase 3)
- findings (Phase 3)
- root-cause diagnosis (Phase 4)
- regression engine (Phase 4)
- reliability score / Go-Live Readiness (Phase 4)

---

## 17. Phase 2 dependencies now stable

Per `docs/PHASE_PLAN.md` Section 5.20, Phase 2 may depend on:

- stable Next.js application;
- environment utilities (`lib/config/*`);
- Supabase access layer (`lib/supabase/*`);
- merchant order domain (`lib/demo-merchant/{types,order,transitions,projection}.ts`);
- internal identifiers (`orders.id`, database-assigned UUIDs);
- Demo Merchant UI (`app/demo-merchant/*`);
- test infrastructure (Vitest unit + integration configs, Playwright config, the custom sequencer);
- the approved Phase 1 migration (`supabase/migrations/20260823000000_phase1_foundation_schema.sql`).

---

## 18. Frozen after Phase 1 approval

Per `docs/PHASE_PLAN.md` Section 5.21, without a confirmed reason Phase 2+ must not replace:

- the modular-monolith architecture;
- Supabase as the primary database;
- Demo Merchant order identity (`orders.id`, UUID, database-assigned);
- amount/currency semantics (integer smallest-currency-unit subunits, uppercase 3-letter currency code, `ORD-001`/`PAYATT-001`/`PAYATT-002`);
- the server/client secret boundary (`server-only` guard pattern);
- the foundational test setup (Vitest offline + integration configs, Playwright config, the deterministic integration sequencer);
- the core Demo Merchant business-effect representation (`payment_status`/`business_status` as separate columns, `fulfilments` as a separate always-Phase-1-empty table with a real count query).

---

## 19. Approval state

```
IMPLEMENTED          PASS
TESTED               PASS
MANUALLY VERIFIED    PASS
DOCUMENTED           PASS
APPROVED             PASS
```
