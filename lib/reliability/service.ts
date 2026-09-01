import "server-only";

import {
  loadReliabilityCandidateRuns,
  loadReliabilityInvariantResults,
} from "./repository";
import { calculateReliabilityScoreV1 } from "./score";
import { RELIABILITY_MANDATORY_SCENARIOS } from "./types";

import type {
  ReliabilityCandidateInvariantResult,
  ReliabilityCandidateRun,
  ReliabilityScenarioId,
  ReliabilityScoreV1,
} from "./types";

/**
 * Phase 4F-R2 — the deterministic composition of the Reliability Score.
 *
 * ```text
 * SELECT-only repository
 *   -> the frozen R1 input contract
 *     -> calculateReliabilityScoreV1(...)      <- sole arithmetic authority
 *       -> explanation-only selection diagnostics
 * ```
 *
 * NO SECOND ENGINE. This module contains no deduction table, no eligibility
 * matrix, no latest-selection implementation and no severity ordering. Every
 * one of those lives in `score.ts`, and a copy here could only ever drift
 * from it. The returned `score` is the engine's own object, returned
 * unmodified.
 *
 * READ-ONLY AND NON-PERSISTING. It reads two tables and writes nothing. The
 * P0 score is derived on demand and is never stored, cached or snapshotted.
 *
 * READ FAILURE PROPAGATES. If either read fails, the repository raises a
 * typed `ReliabilityRepositoryError` and this module lets it through
 * untouched. It deliberately does NOT catch the failure and score empty
 * arrays: that would turn a database outage into a confident score of 40
 * built from four fictitious NOT_RUN scenarios.
 *
 * NO FINDING, REGRESSION OR AI INPUT. Nothing here reads `findings` or
 * `regression_runs`. A regression moves the score only because it created a
 * newer eligible row in `chaos_runs`, which the repository already loads.
 * Unresolved-Finding gates belong to Phase 4G readiness, not to this score.
 */

// ============================================================================
// EXPLANATION-ONLY DIAGNOSTICS
// ============================================================================

export const RELIABILITY_SELECTION_REASONS = Object.freeze([
  /** An eligible candidate existed and won `LATEST_SELECTION_V1`. */
  "LATEST_ELIGIBLE_RUN",
  /** No run of this scenario is persisted at all. */
  "NO_CANDIDATES",
  /** Runs exist, but every one failed eligibility. */
  "NO_ELIGIBLE_CANDIDATES",
] as const);

export type ReliabilitySelectionReason =
  (typeof RELIABILITY_SELECTION_REASONS)[number];

/**
 * Why a scenario ended up in the state it did.
 *
 * STRICTLY EXPLANATORY. Nothing here changes the state, the deduction, the
 * selected run, the score or the provenance label — those are already decided
 * by the pure engine before any of this is computed.
 *
 * WHY IT EXISTS. `eligibleCandidateCount = 0` alone cannot distinguish "no
 * run of this scenario exists" from "runs exist but none qualified". Those
 * are very different facts to show an operator: the first means a test was
 * never run, the second means it ran but its evidence was excluded — which is
 * exactly C03's situation before the scenario-aware eligibility correction.
 * P4-AC-11 asks for an explainable breakdown, and that distinction is the
 * difference between explaining a result and merely reporting it.
 */
export interface ReliabilitySelectionDiagnostics {
  readonly scenarioId: ReliabilityScenarioId;
  /** Every loaded run of this scenario, before eligibility filtering. */
  readonly totalCandidateCount: number;
  /** Taken from the pure breakdown; never recomputed here. */
  readonly eligibleCandidateCount: number;
  readonly ineligibleCandidateCount: number;
  readonly selectionReason: ReliabilitySelectionReason;
}

/** The read model. `score` is the engine's object, verbatim. */
export interface ReliabilityScoreReadModel {
  readonly score: ReliabilityScoreV1;
  /** Exactly four entries, in `RELIABILITY_MANDATORY_SCENARIOS` order. */
  readonly selectionDiagnostics: readonly ReliabilitySelectionDiagnostics[];
}

// ============================================================================
// COMPOSITION
// ============================================================================

/**
 * Builds the read model from an ALREADY-LOADED snapshot.
 *
 * PURE. No database, no network, no clock, no randomness. Given the same two
 * arrays it returns a deep-equal model every time, and it mutates neither
 * input.
 *
 * WHY IT IS SEPARATE FROM THE I/O. Proving "the service agrees with the pure
 * engine" is only meaningful over ONE snapshot. If the proof loads evidence
 * once for the engine and lets the service load it again, a legitimate
 * concurrent chaos run between the two SELECT cycles would make the two
 * disagree for an entirely correct reason — a race in the test, not a defect
 * in the code. Exposing this boundary lets that equality be asserted against
 * the exact same values, with no assumption that the database sits still.
 *
 * It performs no eligibility and no latest selection of its own: both already
 * happened inside `calculateReliabilityScoreV1`, and a second implementation
 * here could only ever drift from it.
 */
export function composeReliabilityScoreReadModel(
  candidateRuns: readonly ReliabilityCandidateRun[],
  invariantResults: readonly ReliabilityCandidateInvariantResult[],
): ReliabilityScoreReadModel {
  const score = calculateReliabilityScoreV1({
    candidateRuns,
    invariantResults,
  });

  const selectionDiagnostics = RELIABILITY_MANDATORY_SCENARIOS.map(
    (scenarioId): ReliabilitySelectionDiagnostics => {
      const breakdown = score.scenarioBreakdown.find(
        (entry) => entry.scenarioId === scenarioId,
      );
      // The engine always returns all four rows, so this is defensive only.
      const eligibleCandidateCount = breakdown?.eligibleCandidateCount ?? 0;
      const totalCandidateCount = candidateRuns.filter(
        (run) => run.scenarioId === scenarioId,
      ).length;

      const selectionReason: ReliabilitySelectionReason =
        breakdown?.selectedRunId != null
          ? "LATEST_ELIGIBLE_RUN"
          : totalCandidateCount === 0
            ? "NO_CANDIDATES"
            : "NO_ELIGIBLE_CANDIDATES";

      return {
        scenarioId,
        totalCandidateCount,
        eligibleCandidateCount,
        ineligibleCandidateCount: totalCandidateCount - eligibleCandidateCount,
        selectionReason,
      };
    },
  );

  return { score, selectionDiagnostics };
}

/**
 * Calculates the current Reliability Score from persisted evidence.
 *
 * The ONLY I/O in the score domain: two SELECTs, then the pure composition
 * above. A failed read throws and is never converted into "no evidence".
 */
export async function getCurrentReliabilityScore(): Promise<ReliabilityScoreReadModel> {
  const candidateRuns = await loadReliabilityCandidateRuns();
  const invariantResults = await loadReliabilityInvariantResults(
    candidateRuns.map((run) => run.id),
  );

  return composeReliabilityScoreReadModel(candidateRuns, invariantResults);
}
