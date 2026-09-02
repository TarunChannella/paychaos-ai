# PayChaos AI — Phase 5A–5D Interim Handoff

## Scope

Phase 5A — P0 freeze + final bug list
Phase 5B — implementation
Phase 5C — testing / stabilization
Phase 5D — security review

Explicitly:

Phase 4H NOT STARTED
Phase 5E NOT STARTED
Phase 5F NOT STARTED
Phase 5G NOT STARTED
Phase 5H NOT STARTED

---

## Completed Work

### P0 freeze / audit (5A)

Read-only audit against the repository, not against handoffs. Two P0
blockers confirmed by direct inspection:

- **P0-1** — Phases 4A–4E persisted diagnosis, recommendation and regression
  evidence, but no screen read any of it. A grep for
  `diagnosis|rootCause|recommendation|regression` across every `page.tsx` and
  `components/` returned zero files. The required demo story was impossible
  in the UI.
- **P0-2** — the documented deterministic Demo Reset did not exist. No route,
  no service, no code match, despite being required by CLAUDE.md Section 7,
  `docs/DEMO_PLAN.md` Section 73, `docs/TESTING.md` T25 and
  `docs/DATABASE.md` Section 39.

Architecture drift: PASS — no confirmed drift.

### Application shell

Persistent top bar with an always-visible `RAZORPAY TEST MODE` badge, and a
left navigation rail ordered as the product loop: Overview, Demo Merchant,
Chaos Runs, Findings, Reliability, Settings. Every destination is real. No
Evidence or Regression nav module was created, because evidence belongs to
the run and finding screens that give it context, and a placeholder module
would be a fake product surface. No invented "system status" pill and no
"last updated" clock — neither is backed by a real measurement.

The login screen renders without chrome.

### Overview

Answers readiness, score, which required scenario is unhealthy, and what to
investigate first. Every value is derived from the frozen
`RELIABILITY-V1` / `GO-LIVE-READINESS-V1` read model on each request. Nothing
is hard-coded. No uptime, trend or success-rate figure exists.

### Findings

New severity-ordered index over persisted findings, with scenario, invariant,
status and regression columns. Counts are computed from the rows actually
rendered, so they cannot disagree with the table.

### Finding diagnosis

New READ-ONLY casefile model exposes the persisted `diagnosis_code`,
`diagnosis_strength` and `diagnosis_summary`. An undiagnosed finding renders
"Not yet diagnosed" — never an empty root-cause card. The determinism
boundary is always visible: "Payment truth and invariant results are
deterministic. AI explains verified evidence."

### Recommendation

Persisted `recommendation_code` and `recommendation_text` are rendered, with
an explicit statement that PayChaos does not modify the merchant's code.

### Regression action (P4-AC-06)

`Run Regression Test` on the Finding detail page, placed directly under
Recommended Fix. It is an ADAPTER to the frozen Phase 4E lifecycle:

- posts to `POST /api/findings/[findingId]/regressions`
- when a `PENDING`/`RUNNING` regression already exists it offers
  `POST /api/regressions/[regressionRunId]/advance` instead, so a second
  regression is never created
- sends only the internal finding id — the server derives the scenario, so no
  eligibility or chaos safety gate can be bypassed from the browser
- disables on submit and holds an in-flight guard against double submit
- re-reads the server-derived casefile rather than patching state locally
- renders `COMPLETED`, `AWAITING_EXTERNAL_ACTION`, `IN_PROGRESS`,
  `SUPERSEDED`, `ERRORED`, `NOT_STARTED` and `ORPHAN_START` honestly

`AWAITING_EXTERNAL_ACTION` states plainly that the regression is waiting for
the required Razorpay Test Mode action and is NOT complete. No Checkout,
payment, webhook or provider state is ever fabricated.

### Regression before/after

The original failing evaluation is shown beside the regression's own
evidence. History is never rewritten. "Fix verified" appears only for a
persisted `RESOLVED` status; `STILL_FAILING` stays failing, `ERROR` stays
error, and `PENDING`/`RUNNING` never look completed.

### Reliability / Readiness presentation

Unchanged. The frozen Phase 4F/4G modules were not modified.

### Demo Reset

`POST /api/demo/reset` — server-side, operator-gated, cross-origin rejected,
POST-only. Clears the ten documented runtime tables child-before-parent. It
is not a generic delete endpoint: the table list and order live in the
service, the route reads no body, query or path parameter, and
`runDemoReset()` takes no arguments, so no caller can widen the scope. The UI
requires the operator to type `RESET` and blocks double submit. A partial
reset reports the failed table instead of success.

Preserved: schema, migration history, RLS, environment values, Razorpay
configuration, source-controlled fixtures.

### Operator Access UX fix

Classified as a UX/navigation defect, not an authentication bypass, and the
repository confirms that: the session cookie is set server-side by
`POST /api/access/login` before any navigation. The defect was that the
success path never cleared its submitting state, so the button kept claiming
to be verifying an operator who was already authenticated. It now
distinguishes "Verifying…" from "Signing in…", uses `router.replace`, adds an
`aria-live` status, an explicit error state, retry, a real label and focus
rings, and keeps double submit impossible. Authentication semantics unchanged.

### Loading / error / empty states

Added `app/loading.tsx`, `app/error.tsx` and `app/not-found.tsx` — none
existed before. Skeletons assert nothing: they never render a zero, a score,
a verdict or an empty list. Honest empty states exist for findings and chaos
runs, and every surface distinguishes "no data" from "could not read".

### Security review (5D)

Recorded below.

---

## Frozen Contracts Preserved

RELIABILITY-V1
LATEST_SELECTION_V1
GO-LIVE-READINESS-V1
Money Invariant authority
regression semantics
Finding history
evidence provenance
AI advisory boundary
Razorpay Test Mode only
UNKNOWN != PASS

Verified by direct file check — the following remain UNMODIFIED across this
phase:

```text
lib/reliability/types.ts
lib/reliability/score.ts
lib/reliability/repository.ts
lib/reliability/service.ts
lib/readiness/readiness.ts
lib/readiness/types.ts
lib/invariants/registry.ts
lib/findings/service.ts
lib/regression/service.ts
app/api/webhooks/razorpay/route.ts
app/api/reliability/route.ts
```

---

## Files Changed

Created:

```text
lib/demo-reset/service.ts
lib/findings/casefile-read.ts
lib/findings/list-read.ts
app/api/demo/reset/route.ts
app/findings/page.tsx
app/settings/page.tsx
app/loading.tsx
app/error.tsx
app/not-found.tsx
components/shell/app-shell.tsx
components/shell/app-nav.tsx
components/findings/finding-casefile.tsx
components/findings/regression-action.tsx
components/demo/demo-reset-panel.tsx
tests/unit/demo-reset/service.test.ts
tests/unit/api/demo-reset-route.test.ts
tests/unit/findings/casefile-read.test.ts
tests/unit/findings/list-read.test.ts
tests/unit/findings/regression-action.test.tsx
tests/e2e/phase5-console.spec.ts
handoffs/PHASE-5A-5D-HANDOFF.md
```

Modified:

```text
app/page.tsx
app/layout.tsx
app/access/page.tsx
app/chaos/findings/invariant-results/[invariantResultId]/page.tsx
middleware.ts
.gitignore
tests/e2e/phase3h-chaos-ui.spec.ts
tests/unit/chaos/phase3h-run-actions.test.ts
tests/unit/middleware.test.ts
```

Two guards were ADVANCED, not loosened: the middleware matcher now pins five
operator surfaces by exact equality, and the Phase 3H finding-page guard now
proves the Phase 4 surface is DELEGATED to the frozen services rather than
absent. `E2E-3H-01`'s locator moved because the console brand "PayChaos AI"
contains "Chaos", which made `/chaos/i` ambiguous; it now targets the
navigation control, which is stricter than the previous loose match.

---

## Database

migrations added = 0
migration count = 13

No schema change. No readiness or score persistence. Demo Reset issues
`DELETE` only — no `DROP`, `TRUNCATE`, `ALTER` or RPC.

---

## Tests

### Previously accepted Phase 5 evidence (unchanged, not replaced)

```text
full unit:              149 files / 3995 tests / PASS
full real Supabase:      38 files /  523 tests / PASS
full Playwright:         34 passed / 0 failed / PASS
typecheck:               PASS
lint:                    0 errors / 1 pre-existing unrelated warning
build:                   PASS
Prettier:                PASS
git diff --check:        PASS
```

### New correction-round evidence (recorded separately)

Focused unit tests added for the regression control — 15 tests covering:
the control exists and is startable; it uses the existing Phase 4E routes
only; double submit is prevented; an API error renders as error; an active
regression offers advance rather than a second start; `PENDING`, `RUNNING`,
`STILL_FAILING` and `ERROR` never render "Fix verified"; `RESOLVED` alone
does; the original FAIL stays visible; the new PASS is separate;
external-action state never becomes completion; and the component performs no
payment, invariant, reliability or readiness calculation.

```text
focused tests/unit/findings:   7 files / 123 tests / PASS
typecheck:                     PASS
lint:                          0 errors / 1 pre-existing unrelated warning
build:                         PASS (after one documented .next EPERM retry)
Prettier (changed paths):      PASS
git diff --check:              PASS
final full Playwright:         see FINAL PLAYWRIGHT below
```

The full 3995-test unit suite and the 523-test real-Supabase suite were NOT
re-run in this correction round: no shared server or domain module changed —
the correction adds a client adapter component, its tests and this handoff.

### Known environment flakes (evidence-backed, never assertions weakened)

- Vitest fork-worker startup/import timing under low memory
- Playwright cold-start compile timing
- `.next` EPERM under OneDrive file locking — one occurrence this round,
  resolved by deleting only `.next` and retrying the build once
- No product test failure was ever reclassified as a flake

---

## Security Review

Verified in this phase:

- Razorpay Test Mode enforcement intact; no Live Mode capability exposed
- no `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
  `SUPABASE_SERVICE_ROLE_KEY`, `PAYCHAOS_ACCESS_TOKEN` or
  `PAYCHAOS_SESSION_SECRET` reachable in any client component or rendered HTML
- raw-body webhook signature verification unchanged (route untouched)
- operator access gate intact; `/findings` and `/settings` added to it
- Demo Reset is access-gated, POST-only, cross-origin rejected, and reads no
  caller input — it cannot be turned into a generic deletion endpoint
- chaos target remains static and internal; no arbitrary URL, host or IP
- regression initiation sends only the internal finding id, so scenario
  selection, eligibility and chaos safety gates stay server-authoritative
- no direct database write from client code
- no AI authority escalation; the diagnosis surface is read-only display
- C03 remains a controlled PayChaos security simulation; provenance unchanged
- read failures cannot render PASS, READY, "no findings" or a healthy
  dashboard — asserted by test on every new read model
- regression cannot fake FIX VERIFIED: it is rendered only from a persisted
  `RESOLVED` status
- Reliability and Readiness cannot be altered from the UI

No confirmed P0 security issue.

---

## Manual Verification

PENDING ARCHITECT/DEVELOPER MANUAL VERIFICATION

No manual verification is claimed. Automated tests do not substitute for it.

The developer should verify in a browser:

1. `/` — score, readiness verdict, four scenarios, "investigate first" list
2. `/findings` — severity ordering; open a finding
3. Finding detail — Evidence-Based Diagnosis, Recommended Fix, and the
   **Run Regression Test** control; confirm the resulting lifecycle state is
   reported honestly and that nothing claims a fix that did not happen
4. `/settings` — Test Mode status; type `RESET` and confirm the button arms
   (running it clears demo data)
5. `/access` — log in and confirm it reads "Signing in…" and redirects
   promptly rather than sitting on "Verifying…"

---

## Known Issues / Deferred

- Findings filters (severity / status / scenario) — P1. The list is
  severity-ordered instead.
- Standalone Evidence and Regression nav pages are not required: both are
  complete as contextual surfaces on the run and finding screens.
- Regression initiation is NOT deferred. It is implemented and tested.

---

## Git State

```text
branch:        phase-5-finalization
HEAD:          (this correction commit)
parent:        f51004976eae5adeb3ac747f70c59ed1aee9bf6f
phase base:    441cbc003728dfa7c15b78854327fd1599d49c16 (Phase 4G)
working tree:  clean
push state:    NOT PUSHED
```

`origin/main` and `origin/phase-4-diagnosis-scoring` are untouched. Nothing
was merged and no history was rewritten.

---

## Next Phase Boundary

Phase 5A–5D cannot be APPROVED until the developer performs the required
browser/manual verification and architect review accepts it.

After approval:

return to Phase 4 ChatGPT
→ complete Phase 4H
→ return to Phase 5 before 5E.
