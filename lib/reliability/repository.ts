import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";

import { RELIABILITY_MANDATORY_SCENARIOS } from "./types";

import type {
  ReliabilityCandidateInvariantResult,
  ReliabilityCandidateRun,
} from "./types";
import type {
  ChaosRunDataClassification,
  ChaosRunOutcome,
  ChaosRunScenarioId,
  ChaosRunStatus,
  InvariantResultInvariantId,
  InvariantResultSeverity,
  InvariantResultValue,
} from "@/lib/supabase/types";

/**
 * Phase 4F-R2 — SELECT-ONLY loading for the Reliability Score.
 *
 * Every statement in this module is a read. There is no `insert`, `update`,
 * `upsert`, `delete` or mutating `rpc` anywhere, and there is deliberately no
 * function that could grow one: the Reliability Score is DERIVED ON DEMAND
 * (docs/DATABASE.md Section 19 — `reliability_score_snapshots` is P1 only),
 * so nothing here has anything to persist.
 *
 * IT READS EXACTLY TWO TABLES. `chaos_runs` and `invariant_results`, both
 * through narrow explicit column projections. It never touches `findings`,
 * `regression_runs`, `orders`, `payments`, `webhook_events` or
 * `event_processing_attempts` — a Finding status, a regression status, a
 * diagnosis and a recommendation are all explanatory display data and never
 * score arithmetic (docs/AI_DESIGN.md → "Finding / Regression Boundary").
 *
 * NO ARITHMETIC. This module maps persisted rows into the frozen R1 input
 * contract and stops. Eligibility, latest selection, state mapping and every
 * deduction belong to `lib/reliability/score.ts`, which stays the sole
 * arithmetic authority.
 *
 * READ FAILURE IS NOT ABSENCE. This is the rule that matters most here. A
 * failed read raises a typed `ReliabilityRepositoryError`; it never returns an
 * empty array. An outage that quietly became "no candidates" would produce a
 * confident, wrong score of 40 out of four NOT_RUN scenarios — a number that
 * looks like a measurement but is really a database timeout.
 *
 * SAFE ERRORS. A PostgREST `message`, `details`, `hint` or query string never
 * escapes this module. Callers receive a stable code and safe wording, the
 * same discipline every other repository in this project follows.
 */

// ============================================================================
// ERROR MODEL
// ============================================================================

export const RELIABILITY_REPOSITORY_ERROR_CODES = Object.freeze([
  /** The mandatory-scenario chaos-run projection could not be read. */
  "CHAOS_RUN_READ_FAILED",
  /** The invariant-result projection could not be read. */
  "INVARIANT_RESULT_READ_FAILED",
] as const);

export type ReliabilityRepositoryErrorCode =
  (typeof RELIABILITY_REPOSITORY_ERROR_CODES)[number];

/**
 * The one error type this module raises.
 *
 * Deliberately distinct from "there is no evidence": a caller must be able to
 * tell a failed read from a genuinely empty database, because only one of
 * those two may reach the scoring engine.
 */
export class ReliabilityRepositoryError extends Error {
  readonly code: ReliabilityRepositoryErrorCode;

  constructor(code: ReliabilityRepositoryErrorCode, message: string) {
    super(message);
    this.name = "ReliabilityRepositoryError";
    this.code = code;
  }
}

// ============================================================================
// PROJECTIONS
// ============================================================================

/**
 * Exactly the seven columns `ReliabilityCandidateRun` needs.
 *
 * `fault_config`, `fault_state`, `error_message_redacted` and every entity
 * foreign key are deliberately absent — the score has no business reading
 * them, and not selecting them makes that structural rather than a matter of
 * discipline.
 */
const CHAOS_RUN_COLUMNS =
  "id, scenario_id, status, outcome, data_classification, created_at, completed_at";

/** Exactly the five columns `ReliabilityCandidateInvariantResult` needs. */
const INVARIANT_RESULT_COLUMNS =
  "id, chaos_run_id, invariant_id, result, severity";

interface ChaosRunProjection {
  readonly id: string;
  readonly scenario_id: ChaosRunScenarioId;
  readonly status: ChaosRunStatus;
  readonly outcome: ChaosRunOutcome | null;
  readonly data_classification: ChaosRunDataClassification;
  readonly created_at: string;
  readonly completed_at: string | null;
}

interface InvariantResultProjection {
  readonly id: string;
  readonly chaos_run_id: string | null;
  readonly invariant_id: InvariantResultInvariantId;
  readonly result: InvariantResultValue;
  readonly severity: InvariantResultSeverity;
}

// ============================================================================
// READS
// ============================================================================

/**
 * Every persisted chaos run belonging to a mandatory P0 scenario.
 *
 * The scenario filter is applied in the QUERY, so a P1 scenario's run is
 * never loaded and can never reach the engine. No ordering is requested:
 * `LATEST_SELECTION_V1` is the engine's job, and sorting here would create a
 * second, drift-prone selection implementation.
 */
export async function loadReliabilityCandidateRuns(): Promise<
  readonly ReliabilityCandidateRun[]
> {
  const { data, error } = await getSupabaseServerClient()
    .from("chaos_runs")
    .select(CHAOS_RUN_COLUMNS)
    .in("scenario_id", [...RELIABILITY_MANDATORY_SCENARIOS]);

  if (error !== null) {
    // Never an empty array: see "READ FAILURE IS NOT ABSENCE" above.
    throw new ReliabilityRepositoryError(
      "CHAOS_RUN_READ_FAILED",
      "The chaos runs required by the reliability score could not be read.",
    );
  }

  const rows = (data ?? []) as unknown as ChaosRunProjection[];
  return rows.map((row) => ({
    id: row.id,
    scenarioId: row.scenario_id,
    status: row.status,
    outcome: row.outcome,
    dataClassification: row.data_classification,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));
}

/**
 * The persisted invariant results belonging to the supplied chaos runs.
 *
 * An empty id list returns `[]` WITHOUT issuing a query: PostgREST's `.in()`
 * with an empty array is a malformed filter, and there is nothing to ask for
 * anyway.
 *
 * Only `result` and `severity` are read for arithmetic. `expected_summary`,
 * `observed_summary`, `reason` and `evidence_refs` are not projected at all —
 * a score must never be derived from prose.
 */
export async function loadReliabilityInvariantResults(
  chaosRunIds: readonly string[],
): Promise<readonly ReliabilityCandidateInvariantResult[]> {
  if (chaosRunIds.length === 0) return [];

  const { data, error } = await getSupabaseServerClient()
    .from("invariant_results")
    .select(INVARIANT_RESULT_COLUMNS)
    .in("chaos_run_id", [...chaosRunIds]);

  if (error !== null) {
    throw new ReliabilityRepositoryError(
      "INVARIANT_RESULT_READ_FAILED",
      "The invariant results required by the reliability score could not be read.",
    );
  }

  const rows = (data ?? []) as unknown as InvariantResultProjection[];
  return (
    rows
      // A baseline evaluation carries a NULL chaos_run_id and belongs to no run.
      .filter(
        (row): row is InvariantResultProjection & { chaos_run_id: string } =>
          row.chaos_run_id !== null,
      )
      .map((row) => ({
        id: row.id,
        chaosRunId: row.chaos_run_id,
        invariantId: row.invariant_id,
        result: row.result,
        severity: row.severity,
      }))
  );
}
