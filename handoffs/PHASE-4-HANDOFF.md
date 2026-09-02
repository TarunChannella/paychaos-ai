# PayChaos AI — Phase 4 Handoff

**Status: APPROVED AND FROZEN.** All sub-phases 4A–4H are complete, tested,
manually verified, documented and approved.

The whole-phase handoff the 4A–4G sub-handoffs deliberately deferred.

## Objective

Turn a verified money-invariant failure into an explainable, actionable and
provable engineering outcome:

```text
Finding
  → Evidence Pack
  → Deterministic Signals
  → Root Cause
  → Recommendation
  → Regression
  → Reliability Score
  → Go-Live Readiness
```

## Completion State

```text
IMPLEMENTED        = YES
TESTED             = YES
MANUALLY VERIFIED  = YES
DOCUMENTED         = YES
ARCHITECT APPROVAL = YES

PHASE 4            = APPROVED, FROZEN
```

---

## Sub-phase summary

| Sub-phase | Delivered                                                                        | Status   |
| --------- | -------------------------------------------------------------------------------- | -------- |
| **4A**    | Evidence packs assembled from persisted records                                  | Approved |
| **4B**    | Deterministic diagnostic signal extraction                                       | Approved |
| **4C**    | Root-cause taxonomy + deterministic classification, evidence-strength labels     | Approved |
| **4D**    | Recommendation catalogue, associated to findings                                 | Approved |
| **4E**    | Regression engine, finding resolution lifecycle, historical failure preservation | Approved |
| **4F**    | `RELIABILITY-V1` score, `LATEST_SELECTION_V1`, score breakdown                   | Approved |
| **4G**    | `GO-LIVE-READINESS-V1`, gate checklist, honest UNKNOWN                           | Approved |
| **4H**    | P0 diagnosis trigger repair + deterministic P1 differentiators; ML/Ollama NO-GO  | Approved |

---

## P0 deterministic intelligence

This is the authority layer, and it is entirely deterministic.

- **Payment truth** — verified Razorpay Test Mode state and server-side
  verification.
- **Money Invariants** — INV-001 … INV-012 decide PASS / FAIL / UNKNOWN. No
  model, no heuristic, no ranking participates.
- **Root cause** — `classifyRootCause` over an evidence pack. Rules, not
  inference. `INSUFFICIENT_EVIDENCE` is a real answer.
- **Recommendation** — a frozen catalogue keyed by the classification.
- **Regression** — the Phase 4E lifecycle re-runs the original scenario through
  the existing Chaos Runner. The historical failure is never rewritten.
- **Reliability Score** — `RELIABILITY-V1`, recalculated from persisted
  evidence on every read. Never stored.
- **Go-Live Readiness** — `GO-LIVE-READINESS-V1`. Gates that cannot be
  authoritatively established report `UNKNOWN`, which never blocks but always
  prevents `READY`.

**No AI component can mutate payment state, invariant results, finding
lifecycle, the score or readiness.** Diagnosis and recommendation are advisory
columns downstream of a verdict that was already decided.

## P1 deterministic judge-facing differentiators (4H)

Delivered without any model:

- **Explanation templates** — impact, evidence strength and limitations,
  composed only from persisted fields.
- **Regression assistance** — what a passing regression would prove, which
  invariant must pass, which behaviour must disappear. Text only.
- **Finding correlation** — exact-match grouping by diagnosis code, invariant
  or scenario, rendered on the Findings page, with an honest insufficient-data
  state below three rows. It reuses rows the page already loads.

## ML / Ollama — NO-GO

Recorded in `docs/AI_DESIGN.md` Section 138A.

- **ML classifier:** 2 findings and **0** labelled diagnosis examples at audit
  time. No defensible training, calibration or held-out set exists, and Section
  79 forbids presenting an invented threshold as validated. A data decision.
- **Ollama:** Vercel + Supabase deployment; Section 91 forbids assuming a local
  Ollama runtime or redesigning P0 hosting for it.

Consequence: the diagnosis is presented as **Evidence-Based Diagnosis**, never
labelled as model output, and a guard test enforces that. The permanent
authority statement is separate and concerns authority, not implementation:
"Payment truth and invariant results are deterministic. AI explains verified
evidence. Diagnosis never determines payment state."

---

## Database

```text
Phase 4 migrations   = 1  (20260904000000_phase4e_regression_runs.sql)
Phase 4H migrations  = 0
Total migration count = 13
AI/model-output table = NONE
Score/readiness persistence = NONE (both derived on demand)
```

Diagnosis and recommendation reuse the advisory columns Phase 3G created on
`findings`. `docs/PHASE_PLAN.md` Section 8.11 prefers derived calculation over
persistence, and both the score and readiness follow that.

## Runtime cost

```text
external AI API = none      Python runtime = none      Ollama = none
runtime cost    = ₹0
```

## Acceptance criteria

| Criterion                                              | Status                        |
| ------------------------------------------------------ | ----------------------------- |
| P4-AC-06 — a user can start a regression for a finding | PASS (Phase 5 correction)     |
| Diagnosis readable from a finding                      | PASS (4H-0 made it reachable) |
| Recommendation readable from a finding                 | PASS (4H-0)                   |
| Regression result inspectable, before/after preserved  | PASS                          |
| Reliability Score readable and explainable             | PASS                          |
| Go-Live Readiness readable and explainable             | PASS                          |
| No AI mutation of payment/invariant state              | PASS (guarded by test)        |

## Manual verification — PASSED

4A–4G were verified in their own rounds. Phase 4H was verified against the
running application and real persisted evidence; the full eighteen-point record
is in `handoffs/PHASE-4H-HANDOFF.md`.

The result that matters most: on a real Finding (INV-003 — Failed Payment Never
Marks Order Paid) the engine returned **RC-016 / INSUFFICIENT_EVIDENCE** and
recommended **INVESTIGATE-EVIDENCE-GAP** rather than selecting a
plausible-sounding cause. Running the diagnosis twice produced the identical
result, created no duplicate record, left the Finding lifecycle untouched, and
moved neither the Reliability Score (85 / 100) nor Go-Live Readiness (NEEDS
ATTENTION) — which is the practical proof that the intelligence layer is
advisory and strictly downstream of deterministic authority.

## Do not break

- `RELIABILITY-V1`, `LATEST_SELECTION_V1`, `GO-LIVE-READINESS-V1` arithmetic
- Money Invariant authority and the PASS / FAIL / UNKNOWN vocabulary
- Finding and regression lifecycles; historical failure preservation
- Evidence provenance, including C03 as a controlled PayChaos simulation
- Razorpay Test Mode-only boundary
- The rule that a read failure never renders as a healthy state

## Next phase

Phase 5E and onward. Phase 4 is frozen; nothing in it may be modified without a
confirmed bug, a security issue or an approved requirement change.
