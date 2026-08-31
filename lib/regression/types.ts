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

// ============================================================================
// PHASE 4E-R2 — ORCHESTRATION
// ============================================================================

/**
 * The complete input a caller may supply to start a regression.
 *
 * Deliberately two fields. There is no URL, host, endpoint, callback, IP,
 * script, command, payload, event type, scenario id, invariant id, diagnosis
 * or result anywhere in this shape — the scenario and its relevant invariant
 * set are re-derived from the persisted original Finding every time, and a
 * caller can never choose either. `freshOrderId` selects an EXISTING internal
 * order row for the two provider-dependent scenarios; it is a database
 * selection, never a network destination.
 */
export interface StartRegressionInput {
  readonly findingId: string;
  readonly freshOrderId?: string;
}

/**
 * The external action a multi-step regression is waiting for.
 *
 * A closed vocabulary. Phase 4E never performs these itself and never
 * pretends one happened: C07 needs a real Razorpay Test Mode Checkout in a
 * browser, and C11-A needs a genuinely failed Test Mode payment.
 */
export const REGRESSION_CONTINUATIONS = Object.freeze([
  "C07_TEST_MODE_CHECKOUT",
  "C11_A_TEST_MODE_FAILED_PAYMENT",
] as const);

export type RegressionContinuation = (typeof REGRESSION_CONTINUATIONS)[number];

/** Why a regression could not start, or could not reach a verdict. */
export const REGRESSION_SERVICE_REASONS = Object.freeze([
  /** The Finding cannot be re-tested right now. Carries the R1 code. */
  "NOT_ELIGIBLE",
  /** A provider-dependent scenario needs a fresh order and none was given. */
  "FRESH_ORDER_REQUIRED",
  /** The chosen fresh order is no longer a valid subject. */
  "FRESH_ORDER_NOT_ELIGIBLE",
  /** The original genuine source evidence is no longer eligible to replay. */
  "SOURCE_NO_LONGER_ELIGIBLE",
  /** The original run's persisted shape does not identify one C11 path. */
  "ORIGINAL_PATH_UNRESOLVED",
  /** The original chaos run could not be read. */
  "ORIGINAL_RUN_UNREADABLE",
  /** The safety gate refused, and no durable chaos run was created. */
  "CHAOS_RUN_NOT_PERSISTED",
  /** The safety gate refused and recorded a BLOCKED chaos run. */
  "CHAOS_RUN_BLOCKED",
  /** The scenario execution service refused to start the run. */
  "EXECUTION_NOT_STARTABLE",
  /** Execution began and failed technically. */
  "EXECUTION_FAILED",
  /** Invariant evaluation could not complete. */
  "EVALUATION_FAILED",
  /** The evaluation completed but proved nothing (see the R1 decision). */
  "INCONCLUSIVE",
  /** Another start won the active-regression race. */
  "ACTIVE_RACE_LOST",
  /**
   * A newer regression attempt exists for this Finding, so this older
   * completed attempt must not touch the Finding lifecycle. The Finding
   * always reflects the NEWEST applicable attempt.
   */
  "NEWER_REGRESSION_EXISTS",
  /**
   * The supplied fresh order is the very order the original run consumed. A
   * re-test must use a genuinely new subject.
   */
  "FRESH_ORDER_REUSE_FORBIDDEN",
  /**
   * A previous CONCLUSIVE regression had not yet applied its verdict to the
   * Finding, and converging it failed. Starting a new attempt on top of known
   * unconverged state would risk losing that earlier verdict entirely.
   */
  "PRIOR_CONVERGENCE_FAILED",
] as const);

export type RegressionServiceReason =
  (typeof REGRESSION_SERVICE_REASONS)[number];

/** The safe identifiers every in-flight or finished attempt carries. */
export interface RegressionAttemptRef {
  readonly findingId: string;
  readonly regressionRunId: string;
  readonly chaosRunId: string;
  readonly scenarioId: string;
}

/**
 * What one orchestration call did.
 *
 * `COMPLETED` is the only variant that carries a verdict, and even then the
 * Finding may be unchanged — an `ERROR` regression never moves a Finding.
 */
export type RegressionOperationResult =
  | {
      readonly kind: "COMPLETED";
      readonly attempt: RegressionAttemptRef;
      readonly regressionStatus: Extract<
        RegressionRunStatus,
        "RESOLVED" | "STILL_FAILING" | "ERROR"
      >;
      readonly findingAction: RegressionFindingAction;
      readonly decisionReason: RegressionDecisionReason;
    }
  | {
      readonly kind: "AWAITING_EXTERNAL_ACTION";
      readonly attempt: RegressionAttemptRef;
      readonly continuation: RegressionContinuation;
    }
  | {
      readonly kind: "IN_PROGRESS";
      readonly attempt: RegressionAttemptRef;
    }
  | {
      /**
       * This attempt reached a verdict, but a NEWER attempt has since been
       * recorded for the same Finding. The older verdict stands as history
       * and the Finding is left exactly as the newer attempt left it.
       *
       * SERVICE-LEVEL ONLY. `regression_runs.status` has no `SUPERSEDED`
       * value and never will — the row keeps its own terminal verdict.
       */
      readonly kind: "SUPERSEDED";
      readonly attempt: RegressionAttemptRef;
      readonly regressionStatus: Extract<
        RegressionRunStatus,
        "RESOLVED" | "STILL_FAILING" | "ERROR"
      >;
      readonly reason: Extract<
        RegressionServiceReason,
        "NEWER_REGRESSION_EXISTS"
      >;
    }
  | {
      readonly kind: "ERRORED";
      readonly attempt: RegressionAttemptRef;
      readonly reason: RegressionServiceReason;
      /** Present only when the safety gate recorded a BLOCKED run. */
      readonly failedPrecheckId: string | null;
    };

/**
 * Starting can also fail before any attempt exists, or leave a safety-gated
 * chaos run with no regression row when a concurrent start wins the race.
 */
export type StartRegressionResult =
  | RegressionOperationResult
  | {
      readonly kind: "NOT_STARTED";
      readonly findingId: string;
      readonly reason: RegressionServiceReason;
      /** The R1 ineligibility code, when eligibility was what refused. */
      readonly ineligibility: RegressionIneligibilityCode | null;
    }
  | {
      /**
       * A durable chaos run was created, then the regression insert lost the
       * active-regression race. The run is NEVER executed and NEVER deleted —
       * it stays as audit evidence that a start was attempted.
       */
      readonly kind: "ORPHAN_START";
      readonly findingId: string;
      readonly chaosRunId: string;
      readonly scenarioId: string;
      readonly reason: RegressionServiceReason;
    };

// ============================================================================
// FINDING LIFECYCLE
// ============================================================================

/** The outcome of one guarded Finding lifecycle write. */
export type FindingLifecycleKind = "UPDATED" | "ALREADY" | "NO_CHANGE";

export interface FindingLifecycleResult {
  readonly kind: FindingLifecycleKind;
  readonly findingId: string;
  readonly status: FindingStatus;
  readonly resolvedAt: string | null;
  readonly updatedAt: string;
}

export const FINDING_LIFECYCLE_ERROR_CODES = Object.freeze([
  "FINDING_LIFECYCLE_ID_INVALID",
  "FINDING_LIFECYCLE_READ_FAILED",
  "FINDING_LIFECYCLE_UPDATE_FAILED",
  "FINDING_LIFECYCLE_NOT_FOUND",
  "FINDING_LIFECYCLE_STATE_CONFLICT",
] as const);

export type FindingLifecycleErrorCode =
  (typeof FINDING_LIFECYCLE_ERROR_CODES)[number];
