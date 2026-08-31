/**
 * Phase 4E-R1 — the pure type surface for the regression foundation.
 *
 * Types only: no I/O, no clock, no randomness, no `server-only`. Every
 * identifier vocabulary is IMPORTED from the phase that froze it — the
 * scenario ID from the chaos registry's types, the invariant ID from the
 * evaluation layer, the regression status from the generated Supabase types.
 * Nothing here re-declares a vocabulary another phase already owns, because a
 * second copy could only ever drift from the first.
 *
 * WHAT A REGRESSION IS. One historical Finding re-tested by ONE NEW chaos run
 * of the SAME approved scenario, whose full relevant invariant set is
 * re-evaluated (docs/AI_DESIGN.md Section 49, docs/DATABASE.md REG-001/002/003).
 * The original failed invariant result is never rewritten (REG-004).
 */
import type { ChaosScenarioId } from "@/lib/chaos/types";
import type {
  FindingStatus,
  InvariantResultInvariantId,
  RegressionRunStatus,
} from "@/lib/supabase/types";

// ============================================================================
// PERSISTED ROW
// ============================================================================

/**
 * A persisted `regression_runs` row, in application shape.
 *
 * Deliberately carries no scenario, invariant, evidence or outcome field:
 * every one of those is reachable through `findingId` or `chaosRunId`, and a
 * copy here could only ever contradict the authoritative row.
 */
export interface RegressionRun {
  readonly id: string;
  readonly findingId: string;
  readonly chaosRunId: string;
  readonly status: RegressionRunStatus;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
}

/** The two statuses that make a regression *active* for its Finding. */
export const ACTIVE_REGRESSION_STATUSES = Object.freeze([
  "PENDING",
  "RUNNING",
] as const);

/** The three statuses a regression can never leave. */
export const TERMINAL_REGRESSION_STATUSES = Object.freeze([
  "RESOLVED",
  "STILL_FAILING",
  "ERROR",
] as const);

export function isActiveRegressionStatus(
  status: RegressionRunStatus,
): status is (typeof ACTIVE_REGRESSION_STATUSES)[number] {
  return (ACTIVE_REGRESSION_STATUSES as readonly string[]).includes(status);
}

export function isTerminalRegressionStatus(
  status: RegressionRunStatus,
): status is (typeof TERMINAL_REGRESSION_STATUSES)[number] {
  return (TERMINAL_REGRESSION_STATUSES as readonly string[]).includes(status);
}

// ============================================================================
// REPOSITORY ERROR VOCABULARY
// ============================================================================

/**
 * Stable, safe repository error codes. A raw PostgREST `message`, `details`,
 * `hint` or query text NEVER escapes behind one of these — a caller learns
 * what went wrong categorically, never what the database said verbatim.
 */
export const REGRESSION_REPOSITORY_ERROR_CODES = Object.freeze([
  "REGRESSION_FINDING_ID_INVALID",
  "REGRESSION_RUN_ID_INVALID",
  "REGRESSION_CHAOS_RUN_ID_INVALID",
  "REGRESSION_READ_FAILED",
  "REGRESSION_INSERT_FAILED",
  "REGRESSION_UPDATE_FAILED",
  "REGRESSION_STATE_CONFLICT",
  "REGRESSION_ACTIVE_RUN_CONFLICT",
  "REGRESSION_INTEGRITY_CONFLICT",
] as const);

export type RegressionRepositoryErrorCode =
  (typeof REGRESSION_REPOSITORY_ERROR_CODES)[number];

// ============================================================================
// REPOSITORY TRANSITION RESULTS
// ============================================================================

/**
 * The outcome of one guarded state transition.
 *
 * `TRANSITIONED` means this call performed the single conditional update.
 * `ALREADY` means the row already held exactly the target status, so ZERO
 * writes occurred and the existing timestamps were preserved verbatim — a
 * retry converges rather than rewriting history.
 */
export type RegressionTransitionKind = "TRANSITIONED" | "ALREADY";

export interface RegressionTransitionResult {
  readonly kind: RegressionTransitionKind;
  readonly run: RegressionRun;
}

// ============================================================================
// ELIGIBILITY
// ============================================================================

/**
 * Why a Finding cannot currently start a regression.
 *
 * Every code describes a STRUCTURAL fact resolved from persisted identifiers.
 * None is derived from a Finding's title, diagnosis summary, recommendation
 * text or any other prose, and none requires a diagnosis or recommendation to
 * exist at all — a Finding is regression-eligible because of what it points
 * at, not because of what has been said about it.
 */
export const REGRESSION_INELIGIBILITY_CODES = Object.freeze([
  "REGRESSION_FINDING_NOT_FOUND",
  "REGRESSION_NO_ORIGINAL_CHAOS_RUN",
  "REGRESSION_ORIGINAL_CHAOS_RUN_NOT_FOUND",
  "REGRESSION_SCENARIO_NOT_REGISTERED",
  "REGRESSION_ORIGINAL_INVARIANT_NOT_REQUIRED",
  "REGRESSION_ACTIVE_RUN_EXISTS",
] as const);

export type RegressionIneligibilityCode =
  (typeof REGRESSION_INELIGIBILITY_CODES)[number];

/**
 * Everything a later round needs to start a regression, resolved structurally
 * from persisted rows.
 *
 * `requiredInvariantIds` comes from the frozen chaos registry via
 * `getScenarioDefinition`, never from a local mapping in this directory.
 */
export interface RegressionEligible {
  readonly kind: "ELIGIBLE";
  readonly findingId: string;
  readonly findingStatus: FindingStatus;
  readonly originalInvariantResultId: string;
  readonly originalInvariantId: InvariantResultInvariantId;
  readonly originalChaosRunId: string;
  readonly scenarioId: ChaosScenarioId;
  readonly requiredInvariantIds: readonly string[];
}

export interface RegressionIneligible {
  readonly kind: "INELIGIBLE";
  readonly code: RegressionIneligibilityCode;
  /** Safe operator-facing wording. Never a database message or raw evidence. */
  readonly reason: string;
  /** Present whenever the Finding itself was resolvable. */
  readonly findingId: string | null;
}

export type RegressionEligibility = RegressionEligible | RegressionIneligible;

// ============================================================================
// PURE FINALIZATION
// ============================================================================

/**
 * What the Finding lifecycle should do about this regression.
 *
 * Exactly three actions exist, and Phase 4E-R1 EXECUTES NONE of them — it
 * only decides. The Finding write surface belongs to R2.
 */
export type RegressionFindingAction =
  "RESOLVE" | "MARK_STILL_FAILING" | "NO_CHANGE";

/**
 * Why a decision came out the way it did. A stable code, never prose to be
 * parsed, and never an AI-generated explanation.
 */
export const REGRESSION_DECISION_REASONS = Object.freeze([
  "SCENARIO_CRITERIA_PASSED",
  "SCENARIO_CRITERIA_FAILED",
  "ORIGINAL_INVARIANT_NOT_PROVEN_PASS",
  "INCONCLUSIVE_UNKNOWN",
] as const);

export type RegressionDecisionReason =
  (typeof REGRESSION_DECISION_REASONS)[number];

/**
 * The deterministic verdict for one completed evaluation.
 *
 * `regressionStatus` is always terminal: a decision is only ever produced for
 * an evaluation that already finished.
 */
export interface RegressionFinalizationDecision {
  readonly regressionStatus: Extract<
    RegressionRunStatus,
    "RESOLVED" | "STILL_FAILING" | "ERROR"
  >;
  readonly findingAction: RegressionFindingAction;
  readonly reason: RegressionDecisionReason;
}
