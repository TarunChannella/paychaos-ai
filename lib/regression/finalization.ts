/**
 * Phase 4E-R1 — the PURE deterministic regression verdict.
 *
 * Given the authoritative output of one completed `evaluateChaosRun`, decide
 * what the regression's terminal status is and what — if anything — should
 * happen to the original Finding.
 *
 * PURE. No I/O, no database, no network, no environment, no filesystem, no
 * clock, no randomness. No AI, no ML, no LLM, no probability. No scenario
 * registry lookup, no Finding repository, no classification and no
 * recommendation: a regression verdict is decided by invariant dispositions
 * alone, never by anything a diagnosis said about the failure.
 *
 * The only imports are TYPE-ONLY plus the frozen disposition vocabulary, so
 * this module pulls no runtime dependency into a caller.
 *
 * ============================================================================
 * THE FROZEN RULES  (Phase 4E architect decisions D-5 and D-6)
 * ============================================================================
 *
 *   aggregate PASS + the original invariant present and PASS
 *       -> RESOLVED            / RESOLVE
 *
 *   aggregate PASS but the original invariant missing, UNKNOWN,
 *   NOT_APPLICABLE or anything other than PASS
 *       -> ERROR               / NO_CHANGE   (fails closed)
 *
 *   aggregate FAIL
 *       -> STILL_FAILING       / MARK_STILL_FAILING
 *
 *   aggregate UNKNOWN
 *       -> ERROR               / NO_CHANGE
 *
 * WHY THE SET, NOT ONE INVARIANT (D-5). The regression re-runs the whole
 * approved scenario, and `evaluateChaosRun` evaluates that scenario's entire
 * relevant invariant set (docs/AI_DESIGN.md Section 49; PHASE_PLAN P4-AC-09
 * "the relevant approved criteria"). Resolving because one invariant passed
 * while ignoring another required invariant's FAIL would be cherry-picking
 * evidence. So `aggregateOutcome === "FAIL"` yields STILL_FAILING even when
 * the Finding's own invariant passed — the scenario's criteria did not.
 *
 * WHY UNKNOWN IS NEVER A VERDICT (D-6). `UNKNOWN` means the evidence did not
 * establish the property either way. Mapping it to RESOLVED would invent a
 * fix; mapping it to STILL_FAILING would assert a failure that was never
 * proven. Both are dishonest, so an inconclusive regression terminalizes as
 * `ERROR` and the Finding is left exactly as it was.
 *
 * `ERROR` HERE MEANS "PROVED NOTHING", NOT "THE PAYMENT FAILED". BLOCKED runs
 * and technical execution failures never reach this function at all — they
 * never produce an evaluation — and R2 terminalizes them as regression
 * `ERROR` with the same `NO_CHANGE` Finding action.
 */
import type { EvaluateChaosRunResult } from "@/lib/invariants/service";
import type { RegressionFinalizationDecision } from "@/lib/regression/types";

/**
 * The narrow slice of a completed evaluation this decision needs.
 *
 * Structurally compatible with `EvaluateChaosRunResult`, so a caller can pass
 * that value straight through — but stated as its own minimal contract so the
 * pure decision never reaches for a chaos run id, a persisted row or a
 * scenario id it has no business consulting.
 */
export interface RegressionEvaluationInput {
  readonly aggregateOutcome: EvaluateChaosRunResult["aggregateOutcome"];
  readonly evaluations: EvaluateChaosRunResult["evaluations"];
}

/**
 * Decides one regression's terminal status and Finding action.
 *
 * Deterministic: identical input always yields a deep-equal decision. The
 * `originalInvariantId` is compared by exact string identity against the
 * evaluation reports — never matched by prefix, name or description.
 */
export function decideRegressionOutcome(
  evaluation: RegressionEvaluationInput,
  originalInvariantId: string,
): RegressionFinalizationDecision {
  // --- FAIL: the scenario's approved criteria did not pass. -----------------
  // Checked before PASS so the ordering of the union can never matter, and
  // deliberately independent of the original invariant's own disposition.
  if (evaluation.aggregateOutcome === "FAIL") {
    return {
      regressionStatus: "STILL_FAILING",
      findingAction: "MARK_STILL_FAILING",
      reason: "SCENARIO_CRITERIA_FAILED",
    };
  }

  // --- UNKNOWN: nothing was established. Never a verdict. -------------------
  if (evaluation.aggregateOutcome === "UNKNOWN") {
    return {
      regressionStatus: "ERROR",
      findingAction: "NO_CHANGE",
      reason: "INCONCLUSIVE_UNKNOWN",
    };
  }

  // --- PASS: the scenario passed. The Finding's own invariant must also -----
  // --- be present and PASS before anything is called fixed. ----------------
  const original = evaluation.evaluations.find(
    (report) => report.invariantId === originalInvariantId,
  );

  if (original === undefined || original.disposition !== "PASS") {
    // Missing, UNKNOWN, NOT_APPLICABLE, or any other disposition. The
    // scenario looks healthy, but the specific property this Finding reports
    // was not proven to hold, so resolving it would overstate the evidence.
    return {
      regressionStatus: "ERROR",
      findingAction: "NO_CHANGE",
      reason: "ORIGINAL_INVARIANT_NOT_PROVEN_PASS",
    };
  }

  return {
    regressionStatus: "RESOLVED",
    findingAction: "RESOLVE",
    reason: "SCENARIO_CRITERIA_PASSED",
  };
}
