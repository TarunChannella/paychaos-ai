# Phase 3H — Chaos + Finding UI and Final Phase 3 Manual Verification

```text
IMPLEMENTED             = YES
TESTED                  = YES
MANUALLY VERIFIED       = YES
DOCUMENTED              = YES
APPROVED                = YES  (final certification passed and architect review
                                approved; this commit is the Phase 3 freeze)
```

Frozen parent (Phase 3G): `efff27bca7314037be032e4d549116da8b0eaf5c`

Phase 3H was delivered in **two internal implementation rounds**. These are working divisions inside one official phase — they are **not** additional project phases, and `docs/PHASE_PLAN.md` still lists a single Phase 3H.

| Internal round | Content                                                       | Frozen checkpoint                          | Commit message                         |
| -------------- | ------------------------------------------------------------- | ------------------------------------------ | -------------------------------------- |
| Round 1        | Server foundation and read models                             | `88e5054842d9a21a358837f38aa1710d322fdc87` | `feat: add phase 3h server foundation` |
| Round 2        | UI, automated browser verification, final manual verification | `9d6603de791070d07de821ef6a724f1608b5a1df` | `feat: complete phase 3h chaos ui`     |

Final documentation freeze commit: **this commit** (`docs: finalize phase 3 handoff`), whose parent is the Round 2 checkpoint above.

---

## 1. What Phase 3H delivers

`docs/PHASE_PLAN.md` Section 3H: "Chaos and Finding UI" — choose a scenario, choose eligible payment/event where required, run it, view run status, view invariant results, open finding and evidence. Task items 19–22 add the chaos-run screen, the invariant results view, a basic evidence timeline and the finding detail view.

Phase 3H is also the **final Phase 3 gate**: several P3 acceptance criteria can only be evidenced through a browser, so this phase carries the manual verification that closes Phase 3.

### Delivered

- `/chaos` landing with **exactly four** P0 scenarios — C01, C03, C07, C11 — projected from the frozen registry, plus a recent-runs list
- Scenario detail with **server-derived eligibility** per scenario and mechanism
- **No arbitrary target**: no URL, host, IP, endpoint, script or fault-JSON input exists anywhere in the chaos UI
- Chaos-run creation through the additive `POST /api/chaos/runs`
- Run execution controls for **C01** (replay), **C03** (invalid-signature test), **C07** (arm / reconcile / cancel), **C11-A** (start / reconcile / cancel) and **C11-B** (controlled replay)
- Invariant evaluation through the existing deterministic engine, via `POST /api/chaos/runs/[runId]/evaluate`
- Stable run-detail screen keyed by `chaos_run.id`, durable across refresh
- Truthful `PASS` / `FAIL` / `UNKNOWN` rendering, with **UNKNOWN visually and textually distinct from PASS**
- `BLOCKED` semantics — a blocked run is shown as a safety outcome, never as a payment failure or invariant `FAIL`
- Finding summary and `Inspect Finding` navigation on a `FAIL`
- Finding detail screen consuming the frozen Phase 3G read model
- Persisted evidence references rendered as `{kind, id}` — never copied evidence
- Evidence timeline built only from persisted rows
- Truthful `NOT_CAPTURED` gaps where snapshots were never taken
- Provenance labels distinguishing `REAL_RAZORPAY_WEBHOOK`, `PAYCHAOS_REPLAY`, `RECORDED_TEST_EVIDENCE` and `SYNTHETIC_DEMO`
- `/chaos` and `/chaos/**` protected by the established access-gate middleware contract
- All chaos mutation routes retain their **own in-route authorization**
- Playwright coverage for the deterministic browser behaviour

### Deliberately absent — Phase 4 owns these

No diagnosis, diagnosis strength, root-cause classification, recommendation, regression workflow, Reliability Score, Go-Live Readiness or AI analysis appears anywhere in the Phase 3H UI. Not as content, and not as an empty placeholder card: rendering a blank "Likely root cause" panel would imply an opinion the product has not formed.

---

## 2. Round 1 — server foundation (`88e5054`)

**16 files: 14 new, 2 modified.** Zero migrations. Zero Phase 3A–3G production modifications.

New (14):

```text
app/api/chaos/runs/route.ts
app/api/chaos/runs/[runId]/evaluate/route.ts
lib/chaos/scenario-dto.ts
lib/chaos/eligibility-service.ts
lib/chaos/run-read-model.ts
lib/findings/run-findings-read.ts
lib/evidence/timeline-model.ts
tests/unit/chaos/phase3h-scenario-dto.test.ts
tests/unit/chaos/phase3h-eligibility-service.test.ts
tests/unit/chaos/phase3h-run-read-model.test.ts
tests/unit/chaos/phase3h-route-static-guard.test.ts
tests/unit/evidence/phase3h-timeline-model.test.ts
tests/integration/supabase/066-phase3h-read-models.integration.test.ts
tests/unit/supabase/066-phase3h-read-models-provenance-guard.test.ts
```

Modified (2) — cumulative forward-guards advanced, never weakened:

```text
tests/unit/supabase/061-phase3e-chaos-evidence-provenance-guard.test.ts
tests/unit/supabase/065-phase3g-findings-provenance-guard.test.ts
```

### The gap Round 1 closed

Repository inspection found that `createChaosRun`, `evaluateChaosRun` and `generateFindingsForChaosRun` had **zero callers** anywhere in `app/` or `lib/`. Every chaos route was `[runId]`-scoped and presupposed a run only an integration test could create. Round 1 added two **additive** routes above the frozen services — run creation, and evaluation-then-Finding-generation — without editing a single frozen file.

### Correctness decisions

- **Exact-key request validation.** Each of the five accepted request shapes must carry exactly its allowed keys. An extra `url`, `faultType`, `replayCount`, `host` or `dataClassification` is a 400, not an ignored field — on an endpoint that starts a chaos run, an ignored field is a field somebody believes is doing something.
- **A read failure is never an empty result.** `ChaosEligibilityServiceError` / `ELIGIBILITY_READ_FAILED`, `ChaosRunReadModelError` / `CHAOS_RUN_LIST_READ_FAILED` and `FindingSummaryReadError` / `FINDING_SUMMARY_READ_FAILED` exist so that "no eligible evidence", "no runs" and "no Finding" can never be said because a `SELECT` failed. A successful query returning zero rows still returns empty.
- **A blocked run never claims it started.** The timeline labels a run with a null `started_at` as a record that was never executed, and substitutes no timestamp.

---

## 3. Round 2 — UI and browser verification (`9d6603d`)

**15 files: 12 added, 3 modified.** Zero migrations. Zero Round 1 modifications. Zero frozen Phase 3A–3G semantic modifications. Zero Phase 4 files.

Added (12):

```text
app/chaos/page.tsx
app/chaos/scenarios/[scenarioId]/page.tsx
app/chaos/scenarios/[scenarioId]/run-scenario-form.tsx
app/chaos/runs/[runId]/page.tsx
app/chaos/runs/[runId]/run-actions.tsx
app/chaos/findings/invariant-results/[invariantResultId]/page.tsx
components/chaos/provenance-badge.tsx
lib/evidence/provenance-label.ts
tests/unit/chaos/phase3h-ui-static-guard.test.ts
tests/unit/chaos/phase3h-run-actions.test.ts
tests/unit/evidence/phase3h-provenance-label.test.ts
tests/e2e/phase3h-chaos-ui.spec.ts
```

Modified (3):

```text
app/page.tsx            (one navigation link to /chaos)
middleware.ts           (/chaos added to the protected prefixes and matcher)
tests/unit/middleware.test.ts  (coverage extended to /chaos)
```

---

## 4. Database changes

**Phase 3H schema migrations: NONE. Phase 3H permanent schema changes: NONE.**

Verification created one durable run and one durable invariant result, retained deliberately as Phase 3H evidence:

```text
fresh manual C03 run   bc3e2ad7-a51d-4656-a801-ce36e0c1ae49
scenario               C03
status                 COMPLETED
outcome                PASS
classification         SYNTHETIC_DEMO
fault type             INVALID_SIGNATURE_TEST
persisted result       INV-005 / PASS / CRITICAL
Findings               0
```

**Why there is no INV-004 row.** The C03 registry entry declares INV-004 and INV-005 as required, and INV-004 was evaluated. Its frozen precondition requires at least one fulfilment record; a subject-free C03 run touches no order, payment attempt or payment, so no fulfilment exists and the disposition is `NOT_APPLICABLE`. `NOT_APPLICABLE` has no database representation — the Phase 3F-A migration's CHECK accepts only `PASS`/`FAIL`/`UNKNOWN` — so no row was created. No row was manufactured merely because the registry lists the invariant.

**This run is not genuine Razorpay evidence.** It is classified `SYNTHETIC_DEMO` and verifies PayChaos's own internal signature-rejection path.

---

## 5. Historical Phase 3F baseline — unchanged

```text
approved historical chaos runs      5
historical invariant results       11
PASS                                1
UNKNOWN                            10
FAIL                                0
Findings for those results          0
```

The fresh Phase 3H C03 run is **not** part of this count and must never be merged into it.

---

## 6. Manual verification — fresh C03

The **developer**, not Claude and not Playwright, performed every browser action.

```text
/chaos
  -> C01, C03, C07, C11 visible
  -> open C03
       Internal Verification Only
       no merchant subject required
       INV-004 / INV-005 declared
       no arbitrary target input
  -> Start chaos run   (once)
       stable run id  bc3e2ad7-a51d-4656-a801-ce36e0c1ae49
       PENDING, never executed, no invariant result
  -> Run Invalid Signature Test
       COMPLETED, outcome UNKNOWN before evaluation
       started_at and completed_at persisted
  -> Evaluate Money Invariants
       COMPLETED, outcome PASS
       INV-005 PASS / CRITICAL
       expected / observed / reason visible
       evidence timeline visible
```

No Razorpay payment was required, no Razorpay call occurred, and no provider webhook was created. The persisted verdict was read after the fact — no outcome was assumed in advance.

---

## 7. Manual verification — real versus replay provenance

Existing evidence was used; nothing was replayed or paid for.

```text
chaos run              40a08f61-11dd-48c1-9460-238166150283   (C01)
status                 COMPLETED
classification         RECORDED_TEST_EVIDENCE

source webhook         b44d7767-a635-4b24-a43a-19e64976f172
event type             payment.captured
source kind            REAL_RAZORPAY_WEBHOOK
signature_verified     true

original real attempt  1780186f-b414-4f16-a04a-6e14182f51b3

replay attempt 1       2eedbad2-3385-41b3-a386-075080091046   PAYCHAOS_REPLAY / SUCCEEDED
replay attempt 2       f2449505-6805-483a-beb9-96b1696999a2   PAYCHAOS_REPLAY / SUCCEEDED
```

The developer opened the real run page and observed a genuine Razorpay Test Mode source event with its signature verified, the original processing attempt, two PayChaos controlled replay entries, the recorded Test Mode evidence classification, and factual `NOT_CAPTURED` evidence gaps.

**No new replay and no payment was performed for this verification.**

---

## 8. Manual verification — Finding UI

### TEMPORARY SYNTHETIC UI-VERIFICATION FIXTURE — DELETED

This chain existed only to exercise the Finding screens. It was **not** a merchant reliability result, **not** Razorpay evidence, and **not** evaluator-produced.

```text
temporary run               76c02d83-7747-444c-a12e-6c78938f77d4
temporary invariant result  8c475a83-a9bd-45d7-91d6-6d023d782caf   INV-005 / FAIL / CRITICAL
temporary Finding           bd3295cf-d9ed-4caa-8c16-25aba4355e36
```

The Finding was generated through the real frozen production service `createFindingFromInvariantResult(...)` — never inserted directly. First call `CREATED`, second call `ALREADY_PRESENT`, Finding count 1, and all seven Phase 4 columns NULL.

The synthetic rows carried their own disclaimer in `observed_summary` and `reason`, so a reader of the database could not mistake them for real evidence.

**Developer browser proof.** The run page showed `FAIL`, `CRITICAL`, the explicitly synthetic expected/observed/reason text, an `OPEN` Finding, the `Inspect Finding` link, and the Finding entry in the timeline. The Finding detail screen showed `OPEN`, `CRITICAL`, `INV-005`, the deterministic title, expected, observed, reason, timestamps, evidence references, the chaos-run correlation, absent order/payment correlations, and `View run evidence timeline`. **No Phase 4 diagnosis or recommendation content appeared.**

---

## 9. Fixture cleanup

Deleted by **exact ID only**, children before parents, each affecting exactly one row:

```text
1. findings           bd3295cf-d9ed-4caa-8c16-25aba4355e36   1 row
2. invariant_results  8c475a83-a9bd-45d7-91d6-6d023d782caf   1 row
3. chaos_runs         76c02d83-7747-444c-a12e-6c78938f77d4   1 row
```

No scenario, classification, date, status, result or bulk predicate was used. All three IDs were then confirmed absent by individual per-ID queries, not inferred from totals.

Database restored to the post-C03 certified baseline:

```text
chaos_runs 10 · invariant_results 12 · findings 0
webhook_events 16 · event_processing_attempts 20
orders 11 · payment_attempts 11 · payments 10 · fulfilments 7
PENDING 0 · RUNNING 0 · active C07 0 · active C11-A 0
```

Protected historical evidence, the fresh C03 run and the C01 provenance evidence all remained intact.

---

## 10. Automated test evidence (final certification round)

Every figure below was produced by the final certification round, not carried over.

```text
Focused Phase 3H         9 files /  195 tests /  195 passed / 0 failed / 0 retries
Cumulative unit         59 files / 1907 tests / 1907 passed / 0 failed / 0 retries
Full offline           101 files / 2657 tests / 2657 passed / 0 failed / 0 retries
Phase 3H Playwright               12 passed / 0 failed / 0 skipped / 0 retries
Full Playwright                   14 passed / 0 failed / 0 skipped / 0 retries
```

The focused set needed one retry of the **runner**, not of any test: the first
invocation lost two forked workers to a spawn timeout while the local dev server
was still holding memory. Stopping that dev server and re-running produced
9/9 files and 195/195 tests green. No test, source file or configuration was
changed to obtain that result.

### How to read the Playwright evidence

The spec has two clearly separated halves, and they are **not** interchangeable:

- **Real app pages** — E2E-3H-01, -02, -03, -04, -13 load genuinely server-rendered pages. E2E-3H-05 loads the real scenario page and stubs only the internal create API to assert the navigation contract.
- **UI-contract fixtures** — E2E-3H-06/10, -07, -08, -09, -11, -12 intercept PayChaos's own page route and return fixed HTML. They prove browser-facing contract only. **They are not evidence of real Server Component rendering, of database content, or of Razorpay behaviour.**

Real database, provider and browser evidence was proven separately by the real Supabase suites and by the manual verification recorded above. Those categories are kept apart deliberately.

---

## 11. Real Supabase evidence (final certification round)

```text
Real 066              1 file  /  24 tests /  24 passed / 0 failed / 0 retries
Full real Supabase   27 files / 370 tests / 370 passed / 0 failed / 0 retries
```

These are final-certification numbers, run against the real Supabase project after the documentation was drafted. No Razorpay call was made, no payment was created and no event was replayed.

A full census taken immediately after the real suite restored **every** count exactly: chaos_runs 10, invariant_results 12, findings 0, webhook_events 16, event_processing_attempts 20, orders 11, payment_attempts 11, payments 10, fulfilments 7, with PENDING, RUNNING, active C07 and active C11-A all 0. The fresh C03 run, the historical five-run baseline and the C01 real/replay evidence were all unchanged, and no temporary fixture was retained. Every permanent integration fixture cleaned itself through its existing contract.

---

## 12. Quality evidence (final certification round)

```text
Typecheck        PASS
Lint             0 errors, 1 pre-existing unrelated warning
                 (tests/integration/supabase/051-chaos-safety-gate.integration.test.ts)
Build attempt 1  FAIL — known Windows/OneDrive .next EPERM
                 (unlink .next/server/app/api/chaos/runs/route)
Build retry      PASS — cleared ONLY .next, retried exactly once,
                 compiled and generated all 22 routes
Prettier         PASS across the whole Phase 3H scope and both handoffs
git diff --check PASS (0 modified tracked files)
Doc whitespace   PASS — 0 trailing-whitespace lines, 0 tabs, 0 CR bytes,
                 single trailing newline in both handoffs
```

Typecheck was run twice for a factual reason. The first run failed with three
`TS1434`/`TS1128` errors in `.next/dev/types/routes.d.ts` — a torn write in a
generated, untracked build artifact left behind when the local dev server was
stopped, not a source defect. The `.next` clear performed for the build
regenerated that file, and typecheck then passed cleanly. No source file was
modified to obtain either result.

---

## 13. Security evidence

- Razorpay **Test Mode only**; no Live Mode configured or used
- No arbitrary external chaos target anywhere
- No browser Supabase service-role access
- No Razorpay key secret, webhook secret, access token or session secret in any browser surface
- No raw webhook body and no signature value exposed
- No `fault_config` or `fault_state` exposed
- `/chaos` and `/chaos/**` protected by the established access-gate middleware contract
- All 11 chaos mutation routes retain their own in-route authorization; middleware alone is never treated as authorization for a mutation
- The access gate was **disabled only for trusted local manual development**, which is the documented default. A public deployment must enable it with real credentials.

No secret value appears in this handoff.

---

## 14. Phase 3H internal acceptance

| #        | Criterion                                                     | Status | Evidence                                                            |
| -------- | ------------------------------------------------------------- | ------ | ------------------------------------------------------------------- |
| AC-3H-01 | Exactly four P0 scenarios                                     | PASS   | Registry projection; unit + E2E-3H-02; manual `/chaos`              |
| AC-3H-02 | No arbitrary target input                                     | PASS   | Static UI guard; E2E-3H-03; manual inspection                       |
| AC-3H-03 | Trusted server eligibility                                    | PASS   | `listEligibleSources` + `revalidateEligibility` before creation     |
| AC-3H-04 | UI run start                                                  | PASS   | Manual C03 create                                                   |
| AC-3H-05 | Stable run ID                                                 | PASS   | `bc3e2ad7-…` survived create → execute → evaluate → refresh         |
| AC-3H-06 | Truthful status/outcome/classification                        | PASS   | Manual C03; run read-model tests                                    |
| AC-3H-07 | Persisted invariant rendering only                            | PASS   | Static guard forbids evaluation in the UI                           |
| AC-3H-08 | UNKNOWN distinct from PASS                                    | PASS   | Read-model tests; E2E-3H-06/10; historical UNKNOWN runs             |
| AC-3H-09 | FAIL links Finding                                            | PASS   | Manual Finding fixture; E2E-3H-07                                   |
| AC-3H-10 | Frozen Phase 3G Finding read model                            | PASS   | Page consumes `getFindingDetailByInvariantResultId`; no second join |
| AC-3H-11 | Persisted-only timeline, NOT_CAPTURED gaps                    | PASS   | Timeline unit tests; manual C01 gaps                                |
| AC-3H-12 | Provenance distinctions                                       | PASS   | Manual C01 real vs replay vs recorded; label tests                  |
| AC-3H-13 | BLOCKED semantics                                             | PASS   | Run page blocked notice; E2E-3H-11; action set empty when blocked   |
| AC-3H-14 | No Phase 4 UI                                                 | PASS   | Static guards; manual Finding screen                                |
| AC-3H-15 | Server-only database access                                   | PASS   | No Supabase client in any browser surface                           |
| AC-3H-16 | Mutation authorization                                        | PASS   | 11/11 routes retain in-route gate; middleware covers `/chaos`       |
| AC-3H-17 | No secret / raw evidence / PII leak                           | PASS   | Static scans; safe DTOs only                                        |
| AC-3H-18 | Responsive technical behaviour                                | PASS   | Final read-only browser certification — Section 19                  |
| AC-3H-19 | No critical console/network error                             | PASS   | E2E-3H-13; manual session                                           |
| AC-3H-20 | Playwright P0 coverage                                        | PASS   | 12 Phase 3H cases                                                   |
| AC-3H-21 | Offline / real / build / typecheck / lint                     | PASS   | Section 10–12                                                       |
| AC-3H-22 | Final manual browser verification                             | PASS   | Sections 6–8                                                        |
| AC-3H-23 | Final handoff maps P3-AC-01…15                                | PASS   | `handoffs/PHASE-3-HANDOFF.md`                                       |
| AC-3H-24 | No frozen Phase 3A–3G semantic changes                        | PASS   | Both commit diffs show zero frozen production files                 |
| AC-3H-25 | No Phase 4 scope                                              | PASS   | Static guards over the whole Phase 3H surface                       |
| AC-3H-26 | Creation / evaluation / Finding reachable via additive routes | PASS   | `POST /api/chaos/runs`, `POST /api/chaos/runs/[runId]/evaluate`     |
| AC-3H-27 | No false `PAYCHAOS_SIMULATION` state                          | PASS   | Unmapped to `UNRECOGNISED`; never rendered                          |

---

## 15. Architectural decisions

- The modular Next.js monolith is retained; no new service or infrastructure
- Deterministic database and evaluator truth remains authoritative
- The browser **never** computes a money or invariant verdict
- Read models are server-rendered and explicitly allowlisted
- Run creation and evaluation are **additive routes above** the frozen backend, so Phase 3F/3G stayed byte-for-byte frozen
- Finding detail reuses the frozen Phase 3G read model rather than re-implementing the join
- The Finding route is keyed by `invariantResultId` because that is the frozen read key — a parameter named `findingId` holding an invariant result id would be a small lie in the address bar
- The timeline uses persisted evidence only; missing data renders as `NOT_CAPTURED`
- **C11-A requires the complete persisted A-shape** — no source webhook **and** an order correlation. Mechanism A is never inferred from "not B", because the frozen repository itself requires both conditions
- **C11-B is identified by its persisted source-webhook correlation**, the same discriminator `startPendingC11BRunAtomically` uses
- A read failure is never converted into "Finding not found"; only the frozen `FINDING_NOT_FOUND` becomes a 404
- Synthetic evidence stays visibly synthetic, in the UI and in its own persisted text
- No migration was introduced in Phase 3H
- No new Razorpay payment was required for the final manual C03
- **No real failure was intentionally forced**; the merchant pipeline was never corrupted to manufacture a FAIL
- Global Demo Reset is deferred to Phase 5

---

## 16. Known issues — none blocking P0

1. **Eligibility reads can be slow.** C01/C07/C11 candidate validation performs one Supabase round-trip per candidate so that the frozen validator remains the authority. Correct but chatty; batching is a later optimisation.
2. **One pre-existing lint warning** remains in `tests/integration/supabase/051-chaos-safety-gate.integration.test.ts`. Unrelated to Phase 3H.
3. **Next.js emits a middleware→proxy deprecation warning.** Not redesigned in Phase 3.
4. **Windows/OneDrive can cause a transient `.next` EPERM during build.** Accepted recovery: clear only `.next` and retry once.
5. **The C01 provenance run has no persisted invariant results.** It is used only as provenance and timeline evidence, never as invariant-result evidence.
6. **The trusted-local access gate is disabled locally.** A public deployment must enable it.

---

## 17. Deferred work

**Phase 4** — deterministic evidence-based diagnosis, diagnosis strength, root-cause classification, recommendations, regression and re-test, Reliability Score, Go-Live Readiness, and AI differentiators only once P0 is stable.

**Phase 5** — the global deterministic Demo Reset, final deployment hardening, polished final demo, full deployment and manual QA, and the final rehearsal.

None of it is implemented here, and none is claimed complete.

---

## 18. Final certification — completed and passed

The post-documentation certification round has now run in full and every gate passed:

```text
Focused Phase 3H       PASS    9 files /  195 tests
Cumulative unit        PASS   59 files / 1907 tests
Full offline           PASS  101 files / 2657 tests
Real 066               PASS    1 file  /   24 tests
Full real Supabase     PASS   27 files /  370 tests
Phase 3H Playwright    PASS   12 passed / 0 failed / 0 skipped
Full Playwright        PASS   14 passed / 0 failed / 0 skipped
Responsive browser     PASS    4 URLs x 2 viewports, 8/8
Typecheck              PASS
Lint                   PASS   0 errors, 1 pre-existing unrelated warning
Build                  PASS   on the single authorised .next retry
Prettier               PASS
git diff --check       PASS
Doc whitespace         PASS
Database baseline      PASS   restored exactly, before and after
No active fault        PASS   PENDING/RUNNING/C07/C11-A all 0
Security check         PASS
Frozen-scope check     PASS   HEAD unchanged, 0 modified tracked files
```

**The architect reviewed this certification and approved it.** Phase 3H is
APPROVED, and this documentation commit is the Phase 3 freeze checkpoint.

Approval covers Phase 3 only. **Phase 4 is not implemented** — no diagnosis,
diagnosis strength, root-cause classification, recommendation, regression or
re-test workflow, Reliability Score, Go-Live Readiness or AI differentiator
exists in this codebase. The global deterministic Demo Reset remains Phase 5
work and is likewise not implemented. Sections 16 and 17 below still stand.

---

## 19. Final responsive browser certification

Read-only. Pages were navigated and measured only — nothing was clicked, and no
Run, Replay, Execute, Evaluate, Re-evaluate, Cancel or Reconcile action was
dispatched. Chromium via Playwright, driven by a script held outside the
repository.

| URL                                                | 1440x900 | 390x844 |
| -------------------------------------------------- | -------- | ------- |
| `/chaos`                                           | PASS     | PASS    |
| `/chaos/scenarios/C03`                             | PASS     | PASS    |
| `/chaos/runs/bc3e2ad7-a51d-4656-a801-ce36e0c1ae49` | PASS     | PASS    |
| `/chaos/runs/40a08f61-11dd-48c1-9460-238166150283` | PASS     | PASS    |

All eight combinations returned HTTP 200 with `documentElement.scrollWidth`
exactly equal to the viewport width — 1440 and 390 respectively — so there was
**no horizontal document overflow at either size**. Across all eight: zero
elements extending past the document box, zero zero-sized or overflowing links
and buttons, a visible `h1` on every page, zero critical browser console errors,
zero uncaught page errors, zero HTTP 5xx responses and zero failed requests.
Expected content was present at both widths, including all four scenario
identifiers on `/chaos`, and both `INV-005` and the full run id on the fresh C03
run page.

This replaces the earlier, weaker claim that responsiveness rested on fluid
markup plus desktop-only manual inspection.
