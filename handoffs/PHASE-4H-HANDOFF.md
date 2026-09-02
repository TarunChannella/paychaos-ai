# PayChaos AI — Phase 4H Handoff

**Status: APPROVED AND FROZEN.** Manual verification passed on the deployed
application against real persisted evidence.

## Objective

Complete the optional P1 AI differentiators for Phase 4 — and, before them,
repair a P0 workflow gap that Phase 4H's own precondition exposed.

## Completion State

```text
IMPLEMENTED        = YES
TESTED             = YES
MANUALLY VERIFIED  = YES
DOCUMENTED         = YES
ARCHITECT APPROVAL = YES

PHASE 4H           = APPROVED, FROZEN
```

---

## The P0 gap Phase 4H uncovered

Phase 4H may begin only "if all P0 Phase 4 acceptance criteria already pass"
(`docs/PHASE_PLAN.md`). Checking that precondition revealed that one did not.

Phases 4C and 4D built deterministic diagnosis and recommendation, proved them
against real Supabase (integration suites 069 and 070), and persisted the
columns for them. **But nothing in the running product ever invoked them.**
`diagnoseFinding` and `recommendFinding` were referenced only by their own
modules, their unit tests and those integration suites. There was no API route,
no UI action and no pipeline step that called either one.

Audited live state at the time of discovery:

```text
findings                = 2
findings_with_diagnosis = 0
```

Every Finding screen therefore read "Not yet diagnosed" permanently, and the
mandated demo story — Finding → Diagnosis → Recommended Fix → Regression —
could not be shown at all.

This is recorded here rather than quietly fixed because it is the kind of gap
that only appears when a phase gate is actually checked instead of assumed.

---

## 4H-0 — P0 repair (prerequisite)

`POST /api/findings/[findingId]/diagnose`

An **adapter**, not an engine. It validates the finding id, enforces the
existing operator access gate, and makes exactly one call to the frozen
`recommendFinding()` — which already invokes `diagnoseFinding()` internally, so
calling both would run the diagnosis twice.

- The caller chooses nothing beyond which Finding to diagnose. No body and no
  query string is read, so no request can influence a classification.
- **Idempotent by construction.** Both services perform guarded writes and
  return the original `diagnosedAt` on a repeated call, so the route needs no
  lock, no upsert and no "already diagnosed" branch.
- **It mutates nothing else.** Never finding STATUS, never resolve or reopen,
  never a regression, never an invariant, never chaos, never payment, order,
  webhook or fulfilment state. Asserted by a source guard.
- Domain refusals return their stable code (409) so the operator learns _why_;
  anything unrecognised is a generic 500. No raw PostgREST text escapes.

UI: a **Diagnose finding** control on the Finding Detail screen, disabled
while in flight with an in-flight guard against double submit, which re-reads
the server-derived page rather than patching local state.

---

## 4H-1 — Deterministic explanation templates

`lib/diagnosis/explanation-templates.ts` — pure, no I/O, no clock, no
randomness, no model.

Produces three statements from the persisted diagnosis code, strength label,
invariant id and scenario id: what the failure means for the merchant, how much
weight the evidence supports, and what remains unproven.

- Strength is an evidence **label**, never a percentage — `docs/DATABASE.md`
  Section 17 forbids invented confidence figures.
- `INSUFFICIENT_EVIDENCE` is stated plainly as a gap rather than softened into
  a weak conclusion.
- An unmapped invariant produces a factual sentence naming the invariant, never
  an invented impact claim.

---

## 4H-3 — Deterministic regression assistance

Same module. Produces developer-facing guidance: what a passing regression
would prove, which invariant must pass, which unsafe behaviour must no longer
occur, and what final persisted state must hold.

**Text only.** It generates no executable code, triggers nothing, and the
frozen Phase 4E engine remains the only thing that can re-run a scenario or
decide a verdict. Asserted by a source guard.

---

## 4H-2 — Deterministic finding correlation

`lib/findings/grouping.ts` (pure) + `components/findings/finding-correlation.tsx`
(presentation), rendered on the **Findings page**.

Pure counting, not clustering. Findings group by exact equality on
`diagnosisCode`, `invariantId` or `scenarioId`. No distance metric, no model,
no threshold, no inference from timestamps or prose.

It reuses the rows the Findings page had already loaded — no extra query, no
new API and no migration. The only backend change was adding the
already-persisted `diagnosis_code` column to that existing SELECT, since
root-cause grouping needs the code and nothing else.

With the current dataset it renders exactly:

> Not enough diagnosed finding history for meaningful correlation.

- Below three rows it returns an explicit **insufficient** result rather than
  a trend drawn from noise.
- Undiagnosed findings are never grouped together: "not yet diagnosed" is an
  absent fact, not a shared root cause.
- Groups of one are not reported — that is a finding, not a correlation.
- Counts only. No percentages over a handful of rows.

---

## 4H-4 — ML and Ollama NO-GO

Recorded in `docs/AI_DESIGN.md` Section 138A as an evidence-based engineering
decision.

**ML classifier — NO-GO.** At audit time the database held 2 findings and
**0** labelled diagnosis examples. Section 79 requires the abstention threshold
to be calibrated from held-out evaluation data; with no evaluation set any
threshold would be invented and any accuracy fabricated. This is a data
decision, not a schedule one — more time would not change it.

**Ollama — NO-GO.** Section 91: a local Ollama process must not be assumed to
exist on Vercel, and P0 hosting must not be redesigned for it. Shipping an LLM
path that only works on one machine would make judge-facing behaviour depend on
where the product runs.

Consequence: no surface labels the current deterministic rules as a model. The
heading stays **Evidence-Based Diagnosis** and a unit guard fails the build if
`AI Diagnosis`, `AI Reasoning`, `Agent Reasoning`, `AI Root Cause` or `LLM`
reappears on a finding surface.

The permanent authority statement is separate from that, and is about
authority rather than implementation:

> Payment truth and invariant results are deterministic. AI explains verified
> evidence. Diagnosis never determines payment state.

It holds whether the explanation comes from today's deterministic rules or
from a later model: the intelligence layer explains, it never decides.

---

## Frozen contracts

Unchanged and verified by direct file check:

```text
RELIABILITY-V1              lib/reliability/score.ts, service.ts
LATEST_SELECTION_V1         lib/reliability/*
GO-LIVE-READINESS-V1        lib/readiness/readiness.ts, types.ts
Money Invariant authority   lib/invariants/registry.ts
Finding lifecycle           lib/findings/service.ts
Regression lifecycle        lib/regression/service.ts
Razorpay Test Mode boundary app/api/webhooks/razorpay/route.ts
```

Phase 4H changed no arithmetic, no invariant, no lifecycle rule and no
provenance semantics.

## Database

```text
migrations added      = 0
migration count       = 13
AI/model-output table = NONE
```

Diagnosis and recommendation write only the advisory columns Phase 3G already
created on `findings`.

## Runtime cost

```text
external AI API   = none
Python runtime    = none
Ollama            = none
added dependency  = none
runtime cost      = ₹0
```

## Files

Created:

```text
app/api/findings/[findingId]/diagnose/route.ts
components/findings/diagnose-action.tsx
components/findings/finding-correlation.tsx
lib/diagnosis/explanation-templates.ts
lib/findings/grouping.ts
tests/unit/api/finding-diagnose-route.test.ts
tests/unit/diagnosis/phase4h-determinism.test.ts
tests/unit/findings/finding-correlation.test.tsx
handoffs/PHASE-4H-HANDOFF.md
```

Modified:

```text
components/findings/finding-casefile.tsx
app/chaos/findings/invariant-results/[invariantResultId]/page.tsx
app/findings/page.tsx
lib/findings/list-read.ts
tests/unit/findings/regression-action.test.tsx
docs/AI_DESIGN.md
```

## Manual verification — PASSED

Performed by the architect/developer against the running application and real
persisted evidence.

**Correlation, low-data state**

1. The Findings page displayed exactly: _"Not enough diagnosed finding history
   for meaningful correlation."_

**Diagnosis on a real Finding**

2. Opened a real persisted Finding: **INV-003 — Failed Payment Never Marks
   Order Paid**.
3. **Diagnose finding** was invoked successfully.
4. The persisted diagnosis displayed **RC-016 / INSUFFICIENT_EVIDENCE**.
5. **PayChaos explicitly refused to guess a technical cause when the evidence
   was insufficient.**
6. Recommended Fix displayed **INVESTIGATE-EVIDENCE-GAP**.
7. The exact authority wording was visible: _"Payment truth and invariant
   results are deterministic. AI explains verified evidence. Diagnosis never
   determines payment state."_
8. Regression guidance was visible.

This is the single most important result in Phase 4H. Faced with a real
finding whose evidence could not support a specific root cause, the system
returned `INSUFFICIENT_EVIDENCE` and recommended investigating the gap —
rather than selecting a plausible-sounding cause. A diagnosis engine that
cannot say "I do not know" is not trustworthy on the occasions it does answer.

**Idempotency and non-mutation**

9. **Re-run diagnosis** was invoked.
10. The repeated diagnosis remained stable: **RC-016 / INSUFFICIENT_EVIDENCE /
    INVESTIGATE-EVIDENCE-GAP**.
11. No duplicate Finding was created.
12. The Finding lifecycle/status remained unchanged.
13. The historical failed invariant remained preserved.

**Score and readiness unaffected**

14. Reliability Score remained **85 / 100**.
15. Go-Live Readiness remained **NEEDS ATTENTION**.
16. Diagnosis did not alter the score or readiness.
17. A browser hard refresh reconstructed **85 / 100** and **NEEDS ATTENTION**
    from persisted/derived state.
18. The Razorpay Test Mode badge remained visible throughout.

Items 14–17 are the proof that the intelligence layer is genuinely downstream:
running a diagnosis twice moved neither the deterministic score nor the
readiness verdict.

## Known issues / deferred

- Correlation currently reports **insufficient data** on the Findings page —
  the live database holds fewer than three findings. That is the designed
  honest behaviour, not a defect, and it will populate as findings accumulate.
- ML classifier and Ollama deferred as recorded above.
