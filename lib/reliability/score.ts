/**
 * Phase 4F-R1 — the PURE `RELIABILITY-V1` engine.
 *
 * ```text
 * candidate chaos runs + their persisted invariant results
 *   -> scenario-aware eligibility filter
 *     -> LATEST_SELECTION_V1  (created_at DESC, id DESC)
 *       -> approved persisted-state mapping
 *         -> frozen deduction table
 *           -> score = max(0, 100 - sum of four deductions)
 * ```
 *
 * PURE. No I/O, no database, no network, no environment, no filesystem, no
 * clock, no randomness, no `server-only` marker — because there is nothing
 * server-only about arithmetic. Given the same input this returns a
 * deep-equal result every time, which is exactly what P4-AC-10 asks for.
 *
 * READ-ONLY OVER ITS INPUT. Both input arrays are copied before sorting, so a
 * caller's array is never reordered or mutated. Nothing here writes anywhere.
 *
 * NO AI, AND NO DIAGNOSIS. This module imports nothing from `lib/findings/`,
 * `lib/regression/`, `lib/diagnosis/` or any provider. `findings.status`,
 * `findings.resolved_at`, `regression_runs.status`, every diagnosis and
 * recommendation column, and any ML/LLM output are all deliberately absent:
 * they are explanatory display data, never score arithmetic
 * (docs/AI_DESIGN.md → "Finding / Regression Boundary"). Unresolved-Finding
 * gates belong to Phase 4G readiness, not here.
 *
 * FAILS CLOSED. An internally inconsistent selection — a FAIL run with no
 * failed invariant row, an unrecognised severity, an unapproved
 * status/outcome pair — becomes `ERROR` with a deduction of 15. It is never
 * coerced into `PASS`, and never silently scored as zero.
 *
 * NO REGRESSION LOOKUP. `regression_runs` is not read here at all. A
 * regression influences the score only because it created a newer eligible
 * chaos run that can win `LATEST_SELECTION_V1`; the older failing run stays
 * in the input, unselected and unmodified.
 */

import {
  LATEST_SELECTION_VERSION,
  RELIABILITY_ALGORITHM_VERSION,
  RELIABILITY_FAIL_DEDUCTION,
  RELIABILITY_MANDATORY_SCENARIOS,
  RELIABILITY_PROVENANCE_LABEL,
  RELIABILITY_REQUIRED_CLASSIFICATION,
  RELIABILITY_SEVERITY_ORDER,
  RELIABILITY_STARTING_SCORE,
  RELIABILITY_STATE_DEDUCTION,
  RELIABILITY_TERMINAL_STATUSES,
} from "./types";

import type {
  ReliabilityCandidateInvariantResult,
  ReliabilityCandidateRun,
  ReliabilityScenarioBreakdown,
  ReliabilityScenarioId,
  ReliabilityScoreInput,
  ReliabilityScoreV1,
} from "./types";
import type { InvariantResultSeverity } from "@/lib/supabase/types";

// ============================================================================
// ELIGIBILITY
// ============================================================================

/**
 * Is this run a legitimate score candidate for this scenario?
 *
 * Every condition is applied BEFORE latest selection, so an ineligible newer
 * run can never displace an eligible older one. In particular a newer
 * `SYNTHETIC_DEMO` run for C01/C07/C11 is removed here, which is the
 * anti-contamination rule the frozen spec requires.
 */
function isEligible(
  run: ReliabilityCandidateRun,
  scenarioId: ReliabilityScenarioId,
): boolean {
  if (run.scenarioId !== scenarioId) return false;
  // EXACT match, in both directions: a C03 run labelled
  // RECORDED_TEST_EVIDENCE is just as ineligible as a synthetic C07 run.
  if (
    run.dataClassification !== RELIABILITY_REQUIRED_CLASSIFICATION[scenarioId]
  )
    return false;
  if (
    !(RELIABILITY_TERMINAL_STATUSES as readonly string[]).includes(run.status)
  )
    return false;
  // Finality. An unfinished row gets no invented arithmetic.
  if (run.outcome === null) return false;
  if (run.completedAt === null) return false;
  return true;
}

/**
 * `LATEST_SELECTION_V1` — `created_at DESC, id DESC`.
 *
 * `completed_at` is required for finality but is deliberately NOT the
 * ordering key: it is caller-supplied and is not guaranteed to order
 * consistently with `created_at` (the live project holds runs where it
 * precedes it). `created_at` is database-assigned, and `id` makes the
 * ordering total, so the result cannot depend on input order.
 *
 * Sorts a COPY — the caller's array is never reordered.
 */
function selectLatest(
  eligible: readonly ReliabilityCandidateRun[],
): ReliabilityCandidateRun | null {
  if (eligible.length === 0) return null;
  const ordered = [...eligible].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    if (a.id !== b.id) return a.id < b.id ? 1 : -1;
    return 0;
  });
  return ordered[0] ?? null;
}

// ============================================================================
// SEVERITY
// ============================================================================

function severityRank(severity: string): number {
  return (RELIABILITY_SEVERITY_ORDER as readonly string[]).indexOf(severity);
}

function isSupportedSeverity(
  severity: string,
): severity is InvariantResultSeverity {
  return severityRank(severity) !== -1;
}

/**
 * The failed invariant result that justifies a FAIL deduction.
 *
 * Highest severity wins. Where several failures share that severity the
 * deduction is identical, but the BREAKDOWN must still name one row
 * deterministically, so ties resolve by `invariantId` ASC then result `id`
 * ASC. That is an explanation-only tie-break: it never changes arithmetic.
 *
 * Returns `null` when there is no failed row at all — the caller turns that
 * into `ERROR`, never into `PASS`.
 */
function selectSupportingFailure(
  failures: readonly ReliabilityCandidateInvariantResult[],
): ReliabilityCandidateInvariantResult | null {
  if (failures.length === 0) return null;
  const ordered = [...failures].sort((a, b) => {
    const rankDelta = severityRank(a.severity) - severityRank(b.severity);
    if (rankDelta !== 0) return rankDelta;
    if (a.invariantId !== b.invariantId)
      return a.invariantId < b.invariantId ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
  });
  return ordered[0] ?? null;
}

// ============================================================================
// ONE SCENARIO
// ============================================================================

/** A breakdown row for a scenario with no eligible candidate. */
function notRunBreakdown(
  scenarioId: ReliabilityScenarioId,
): ReliabilityScenarioBreakdown {
  return {
    scenarioId,
    state: "NOT_RUN",
    deduction: RELIABILITY_STATE_DEDUCTION.NOT_RUN,
    requiredDataClassification: RELIABILITY_REQUIRED_CLASSIFICATION[scenarioId],
    eligibleCandidateCount: 0,
    selectedRunId: null,
    selectedDataClassification: null,
    selectedRunStatus: null,
    selectedRunOutcome: null,
    selectedRunCreatedAt: null,
    selectedRunCompletedAt: null,
    supportingFailedInvariantResultId: null,
    supportingInvariantId: null,
    supportingSeverity: null,
    provenanceLabel: null,
  };
}

/** The shared shape of every breakdown row that DID select a run. */
function selectedBase(
  scenarioId: ReliabilityScenarioId,
  run: ReliabilityCandidateRun,
  eligibleCandidateCount: number,
) {
  return {
    scenarioId,
    requiredDataClassification: RELIABILITY_REQUIRED_CLASSIFICATION[scenarioId],
    eligibleCandidateCount,
    selectedRunId: run.id,
    selectedDataClassification: run.dataClassification,
    selectedRunStatus: run.status,
    selectedRunOutcome: run.outcome,
    selectedRunCreatedAt: run.createdAt,
    selectedRunCompletedAt: run.completedAt,
    // Truthful provenance, driven by the run's own classification. A C03
    // selection therefore always reads as a controlled simulation.
    provenanceLabel:
      RELIABILITY_PROVENANCE_LABEL[run.dataClassification] ?? null,
  } as const;
}

/** Everything that is not a proven FAIL carries no supporting failure. */
function withoutSupport() {
  return {
    supportingFailedInvariantResultId: null,
    supportingInvariantId: null,
    supportingSeverity: null,
  } as const;
}

function scoreOneScenario(
  scenarioId: ReliabilityScenarioId,
  input: ReliabilityScoreInput,
): ReliabilityScenarioBreakdown {
  const eligible = input.candidateRuns.filter((run) =>
    isEligible(run, scenarioId),
  );
  const selected = selectLatest(eligible);
  if (selected === null) return notRunBreakdown(scenarioId);

  const base = selectedBase(scenarioId, selected, eligible.length);
  const errored = {
    ...base,
    ...withoutSupport(),
    state: "ERROR",
    deduction: RELIABILITY_STATE_DEDUCTION.ERROR,
  } as const;

  // --- The approved persisted-state mapping. ------------------------------
  if (selected.status === "COMPLETED") {
    switch (selected.outcome) {
      case "PASS":
        return {
          ...base,
          ...withoutSupport(),
          state: "PASS",
          deduction: RELIABILITY_STATE_DEDUCTION.PASS,
        };
      case "UNKNOWN":
        return {
          ...base,
          ...withoutSupport(),
          state: "UNKNOWN",
          deduction: RELIABILITY_STATE_DEDUCTION.UNKNOWN,
        };
      case "BLOCKED":
        return {
          ...base,
          ...withoutSupport(),
          state: "BLOCKED",
          deduction: RELIABILITY_STATE_DEDUCTION.BLOCKED,
        };
      case "ERROR":
        return errored;
      case "FAIL": {
        const failures = input.invariantResults.filter(
          (row) => row.chaosRunId === selected.id && row.result === "FAIL",
        );
        const support = selectSupportingFailure(failures);
        // A run claiming FAIL with no failed invariant row is an internally
        // inconsistent contract, not a passing scenario.
        if (support === null) return errored;
        // An unrecognised severity cannot be priced, so it fails closed
        // rather than silently deducting zero.
        if (!isSupportedSeverity(support.severity)) return errored;
        return {
          ...base,
          state: "FAIL",
          deduction: RELIABILITY_FAIL_DEDUCTION[support.severity],
          supportingFailedInvariantResultId: support.id,
          supportingInvariantId: support.invariantId,
          supportingSeverity: support.severity,
        };
      }
      default:
        // A COMPLETED run whose outcome is outside the approved set.
        return errored;
    }
  }

  // `FAILED` is a technical execution failure. `FAILED + ERROR` is the one
  // approved shape; any other outcome on a FAILED run is inconsistent, and
  // both land on ERROR/15 either way.
  return errored;
}

// ============================================================================
// PUBLIC ENTRY POINT
// ============================================================================

/**
 * Calculates `RELIABILITY-V1` over already-loaded evidence.
 *
 * Always returns exactly four breakdown rows, in
 * `RELIABILITY_MANDATORY_SCENARIOS` order, whatever the input contains — a
 * scenario with no evidence is reported as `NOT_RUN`, never omitted.
 *
 * The score is clamped at zero: four Critical failures already reach 100
 * points of deduction, and a negative score would be meaningless.
 */
export function calculateReliabilityScoreV1(
  input: ReliabilityScoreInput,
): ReliabilityScoreV1 {
  const scenarioBreakdown = RELIABILITY_MANDATORY_SCENARIOS.map((scenarioId) =>
    scoreOneScenario(scenarioId, input),
  );

  const totalDeduction = scenarioBreakdown.reduce(
    (sum, entry) => sum + entry.deduction,
    0,
  );

  return {
    algorithmVersion: RELIABILITY_ALGORITHM_VERSION,
    selectionVersion: LATEST_SELECTION_VERSION,
    score: Math.max(0, RELIABILITY_STARTING_SCORE - totalDeduction),
    totalDeduction,
    scenarioBreakdown,
  };
}
