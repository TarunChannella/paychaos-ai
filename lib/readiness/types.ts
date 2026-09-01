/**
 * Phase 4G — the frozen `GO-LIVE-READINESS-V1` contract.
 *
 * TYPES AND CONSTANTS ONLY. No I/O, no database, no network, no environment,
 * no clock, no randomness.
 *
 * Readiness is DERIVED ON DEMAND and never stored. There is no
 * `readiness_scores`, `readiness_snapshots` or `go_live_status` table, and
 * nothing here describes a persisted row.
 *
 * NOT A CERTIFICATION. Readiness is an engineering assessment produced by
 * this project's own test suite. It is never Razorpay approval, and the
 * vocabulary below deliberately contains no word like "certified", "approved"
 * or "guaranteed".
 *
 * NO AI. Every input is a persisted deterministic fact or an explicit gate
 * state. There is no probability, no confidence and no model output anywhere
 * in this contract.
 */

import type { ReliabilityScoreReadModel } from "@/lib/reliability/service";
import type { ReliabilityScenarioId } from "@/lib/reliability/types";
import type { InvariantResultSeverity } from "@/lib/supabase/types";

// ============================================================================
// FROZEN CONSTANTS
// ============================================================================

export const READINESS_ALGORITHM_VERSION = "GO-LIVE-READINESS-V1" as const;

/**
 * The exact disclaimer every readiness surface must carry
 * (docs/AI_DESIGN.md Section 54, P4-AC-14). Defined once, so a screen cannot
 * paraphrase it into something weaker.
 */
export const READINESS_DISCLAIMER =
  "PayChaos Go-Live Readiness is an engineering assessment from the implemented PayChaos test suite. It is not Razorpay certification." as const;

export const READINESS_STATUSES = Object.freeze([
  "NOT READY",
  "NEEDS ATTENTION",
  "READY",
] as const);

export type ReadinessStatus = (typeof READINESS_STATUSES)[number];

/**
 * A gate's authoritative state.
 *
 * `UNKNOWN` is deliberately distinct from `FAIL`. "We could not establish
 * this" and "this failed" are different facts, and collapsing them would
 * either fabricate a failure or — far worse — let an unverified prerequisite
 * pass silently. `UNKNOWN` blocks READY without claiming anything broke.
 */
export const READINESS_GATE_STATES = Object.freeze([
  "PASS",
  "FAIL",
  "UNKNOWN",
] as const);

export type ReadinessGateState = (typeof READINESS_GATE_STATES)[number];

/** Every gate the frozen rules name, in stable display order. */
export const READINESS_GATE_IDS = Object.freeze([
  "TEST_MODE_SECURITY",
  "HEALTHY_BASELINE",
  "MANDATORY_SCENARIOS",
  "SELECTED_RUN_INVARIANTS",
  "UNRESOLVED_FINDINGS",
  "RELIABILITY_SCORE",
  "REAL_RAZORPAY_MANUAL_VERIFICATION",
  "BUILD_VERIFICATION",
  "SECURITY_VERIFICATION",
  "AUTOMATED_TEST_VERIFICATION",
  "MANUAL_VERIFICATION",
] as const);

export type ReadinessGateId = (typeof READINESS_GATE_IDS)[number];

// ============================================================================
// REASON CODES
// ============================================================================

/** Blockers. Any one of these forces `NOT READY`. */
export const READINESS_BLOCKING_REASONS = Object.freeze([
  "NR_TEST_MODE_SECURITY_FAILED",
  "NR_HEALTHY_BASELINE_FAILED",
  "NR_MANDATORY_SCENARIO_FAILED",
  "NR_UNRESOLVED_HIGH_RISK_FINDING",
] as const);

export type ReadinessBlockingReasonCode =
  (typeof READINESS_BLOCKING_REASONS)[number];

/** Attention reasons. Any one of these prevents `READY`. */
export const READINESS_ATTENTION_REASONS = Object.freeze([
  "NA_SCORE_BELOW_100",
  "NA_MANDATORY_SCENARIO_INCONCLUSIVE",
  "NA_UNRESOLVED_LOWER_RISK_FINDING",
  "NA_REQUIRED_VERIFICATION_INCOMPLETE",
] as const);

export type ReadinessAttentionReasonCode =
  (typeof READINESS_ATTENTION_REASONS)[number];

export const READINESS_READY_REASON = "READY_ALL_REQUIRED_GATES_PASS" as const;

/**
 * Human wording derived from the code, never the other way round. The DECISION
 * is made on codes; this catalogue only renders them.
 */
export const READINESS_REASON_TEXT: Readonly<
  Record<
    | ReadinessBlockingReasonCode
    | ReadinessAttentionReasonCode
    | typeof READINESS_READY_REASON,
    string
  >
> = Object.freeze({
  NR_TEST_MODE_SECURITY_FAILED:
    "Test Mode or security enforcement did not pass.",
  NR_HEALTHY_BASELINE_FAILED: "The required healthy baseline did not pass.",
  NR_MANDATORY_SCENARIO_FAILED:
    "A mandatory P0 scenario's current state is FAIL.",
  NR_UNRESOLVED_HIGH_RISK_FINDING:
    "An unresolved CRITICAL or HIGH P0 finding remains.",

  NA_SCORE_BELOW_100: "The Reliability Score is below 100.",
  NA_MANDATORY_SCENARIO_INCONCLUSIVE:
    "A mandatory P0 scenario is UNKNOWN, BLOCKED, ERROR or NOT RUN, which is never counted as PASS.",
  NA_UNRESOLVED_LOWER_RISK_FINDING:
    "An unresolved MEDIUM or LOW P0 finding remains.",
  NA_REQUIRED_VERIFICATION_INCOMPLETE:
    "A prerequisite required for READY has not been authoritatively verified by the current runtime evidence.",

  READY_ALL_REQUIRED_GATES_PASS:
    "Every required readiness gate passed on current evidence.",
});

// ============================================================================
// INPUT CONTRACT
// ============================================================================

/**
 * One unresolved Finding, reduced to the only two facts readiness needs.
 *
 * Severity comes from the immutable linked `invariant_results.severity` — the
 * authoritative record of what actually failed. A diagnosis strength, a
 * recommendation, a regression status or any model output must never decide
 * how serious a Finding is.
 */
export interface ReadinessUnresolvedFinding {
  readonly findingId: string;
  readonly severity: InvariantResultSeverity;
}

/**
 * One selected current run's invariant evidence, for the READY prerequisite
 * that every applicable persisted evaluation passed.
 *
 * `state` is `UNKNOWN` when the evidence could not be authoritatively
 * established — never silently `PASS`.
 */
export interface ReadinessScenarioInvariantGate {
  readonly scenarioId: ReliabilityScenarioId;
  readonly state: ReadinessGateState;
}

export interface ReadinessEvaluationInput {
  /** The frozen Phase 4F read model. The current-state authority. */
  readonly reliability: ReliabilityScoreReadModel;
  readonly testModeSecurityGate: ReadinessGateState;
  readonly healthyBaselineGate: ReadinessGateState;
  readonly selectedRunInvariantGates: readonly ReadinessScenarioInvariantGate[];
  readonly unresolvedFindings: readonly ReadinessUnresolvedFinding[];
  readonly realRazorpayManualVerificationGate: ReadinessGateState;
  readonly buildGate: ReadinessGateState;
  readonly securityVerificationGate: ReadinessGateState;
  readonly automatedTestGate: ReadinessGateState;
  readonly manualVerificationGate: ReadinessGateState;
}

// ============================================================================
// OUTPUT CONTRACT
// ============================================================================

export interface ReadinessGateResult {
  readonly gateId: ReadinessGateId;
  readonly state: ReadinessGateState;
  /** Safe operator-facing wording. Never a raw error or a config value. */
  readonly detail: string;
}

export interface ReadinessReason {
  readonly code:
    | ReadinessBlockingReasonCode
    | ReadinessAttentionReasonCode
    | typeof READINESS_READY_REASON;
  readonly text: string;
  /** The scenario or finding this reason points at, when it has one. */
  readonly subject: string | null;
}

/** The derived readiness assessment. Never persisted. */
export interface GoLiveReadinessV1 {
  readonly version: typeof READINESS_ALGORITHM_VERSION;
  readonly status: ReadinessStatus;
  /** Copied verbatim from the frozen 4F read model; never recomputed. */
  readonly score: number;
  readonly blockingReasons: readonly ReadinessReason[];
  readonly attentionReasons: readonly ReadinessReason[];
  readonly gates: readonly ReadinessGateResult[];
  readonly disclaimer: typeof READINESS_DISCLAIMER;
}
