/**
 * Phase 4F-R1 — the frozen `RELIABILITY-V1` contract.
 *
 * TYPES AND CONSTANTS ONLY. No I/O, no database, no network, no environment,
 * no clock, no randomness. Every import below is type-only or a frozen
 * vocabulary, so this module pulls no runtime dependency into a caller.
 *
 * The score is DERIVED ON DEMAND. There is no `reliability_scores` table and
 * no snapshot table in P0 (docs/DATABASE.md Section 19 —
 * `reliability_score_snapshots` is P1 only), so nothing here describes a
 * persisted row and nothing here is ever written.
 *
 * NO AI ANYWHERE. The score is deterministic arithmetic over persisted
 * deterministic evidence (docs/AI_DESIGN.md Sections 52–54). A diagnosis, a
 * recommendation, a Finding status, a regression status, an ML output and an
 * LLM output are all deliberately absent from every type below — two
 * deployments of this project must compute the same score whether or not
 * either has an LLM available.
 */

import type {
  ChaosRunDataClassification,
  ChaosRunOutcome,
  ChaosRunScenarioId,
  ChaosRunStatus,
  InvariantResultInvariantId,
  InvariantResultSeverity,
  InvariantResultValue,
} from "@/lib/supabase/types";

// ============================================================================
// FROZEN CONSTANTS
// ============================================================================

/**
 * The algorithm identifier. Any change to the deterministic meaning of the
 * score requires a NEW version string, exactly as an invariant version does
 * (docs/MONEY_INVARIANTS.md Section 48).
 */
export const RELIABILITY_ALGORITHM_VERSION = "RELIABILITY-V1" as const;

/**
 * The identifier for the current-run selection rule, kept separate from the
 * algorithm version because the two can legitimately move independently.
 */
export const LATEST_SELECTION_VERSION = "LATEST_SELECTION_V1" as const;

/**
 * The mandatory P0 scenario set, in stable display order. This is the score's
 * own required set — it is deliberately NOT derived from the chaos registry
 * at runtime, so that adding a P1 scenario to the catalogue can never silently
 * change what the Reliability Score is measuring.
 */
export const RELIABILITY_MANDATORY_SCENARIOS = Object.freeze([
  "C01",
  "C03",
  "C07",
  "C11",
] as const);

export type ReliabilityScenarioId =
  (typeof RELIABILITY_MANDATORY_SCENARIOS)[number];

/**
 * Scenario-aware classification eligibility (docs/AI_DESIGN.md →
 * "Scenario-Aware Classification Eligibility").
 *
 * The required value is EXACT, not a minimum: a run whose classification
 * differs is ineligible in either direction.
 *
 * WHY C03 DIFFERS. C03 — Invalid Webhook Signature builds its request
 * internally, creates zero `webhook_events` rows and zero
 * `event_processing_attempts` rows, and makes no Razorpay call
 * (docs/CHAOS_SCENARIOS.md Section 15). It therefore CANNOT be an authentic
 * Razorpay delivery, and `SYNTHETIC_DEMO` is its truthful classification.
 * Requiring `RECORDED_TEST_EVIDENCE` of it would leave a mandatory P0
 * security test permanently NOT RUN; labelling it `RECORDED_TEST_EVIDENCE` to
 * avoid that would be provenance dishonesty. The exception is scenario-aware
 * ELIGIBILITY, never a relaxation of labelling.
 */
export const RELIABILITY_REQUIRED_CLASSIFICATION: Readonly<
  Record<ReliabilityScenarioId, ChaosRunDataClassification>
> = Object.freeze({
  C01: "RECORDED_TEST_EVIDENCE",
  C03: "SYNTHETIC_DEMO",
  C07: "RECORDED_TEST_EVIDENCE",
  C11: "RECORDED_TEST_EVIDENCE",
});

/**
 * The terminal chaos-run statuses a score candidate may hold. `PENDING` and
 * `RUNNING` carry a NULL outcome by database constraint
 * (`chaos_runs_pending_state_consistent`) and are never eligible.
 */
export const RELIABILITY_TERMINAL_STATUSES = Object.freeze([
  "COMPLETED",
  "FAILED",
] as const);

/** Severity ordering, strongest first. `CRITICAL > HIGH > MEDIUM > LOW`. */
export const RELIABILITY_SEVERITY_ORDER = Object.freeze([
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
] as const);

/** The frozen deduction for each FAIL severity. */
export const RELIABILITY_FAIL_DEDUCTION: Readonly<
  Record<InvariantResultSeverity, number>
> = Object.freeze({
  CRITICAL: 25,
  HIGH: 20,
  MEDIUM: 15,
  LOW: 10,
});

/**
 * The deduction for every non-FAIL state. `PASS` alone is zero — an
 * inconclusive result is never treated as a clean bill of health
 * (P4-AC-12: UNKNOWN is not counted as a normal PASS).
 */
export const RELIABILITY_STATE_DEDUCTION = Object.freeze({
  PASS: 0,
  UNKNOWN: 15,
  BLOCKED: 15,
  ERROR: 15,
  NOT_RUN: 15,
});

/** The starting score before any deduction. */
export const RELIABILITY_STARTING_SCORE = 100 as const;

// ============================================================================
// INPUT CONTRACT — ordinary in-memory values, never a database row
// ============================================================================

/**
 * The narrow projection of one `chaos_runs` row the score needs.
 *
 * Deliberately NOT the full row type: `fault_config`, `fault_state`, the
 * entity foreign keys and `error_message_redacted` are all irrelevant to
 * scoring, and accepting them would invite the engine to grow a dependency on
 * evidence it has no business reading.
 */
export interface ReliabilityCandidateRun {
  readonly id: string;
  readonly scenarioId: ChaosRunScenarioId;
  readonly status: ChaosRunStatus;
  readonly outcome: ChaosRunOutcome | null;
  readonly dataClassification: ChaosRunDataClassification;
  /** ISO-8601. The `LATEST_SELECTION_V1` primary ordering key. */
  readonly createdAt: string;
  /** ISO-8601. Required for FINALITY; never used for ordering. */
  readonly completedAt: string | null;
}

/**
 * The narrow projection of one `invariant_results` row the score needs.
 *
 * `invariant_version` is deliberately absent: the score reports what a run
 * actually produced, and does not re-interpret a historical verdict under a
 * newer invariant version (docs/MONEY_INVARIANTS.md Section 49).
 */
export interface ReliabilityCandidateInvariantResult {
  readonly id: string;
  readonly chaosRunId: string;
  readonly invariantId: InvariantResultInvariantId;
  readonly result: InvariantResultValue;
  readonly severity: InvariantResultSeverity;
}

/** The complete input. Both arrays are read, never mutated. */
export interface ReliabilityScoreInput {
  readonly candidateRuns: readonly ReliabilityCandidateRun[];
  readonly invariantResults: readonly ReliabilityCandidateInvariantResult[];
}

// ============================================================================
// OUTPUT CONTRACT
// ============================================================================

export const RELIABILITY_SCENARIO_STATES = Object.freeze([
  "PASS",
  "FAIL",
  "UNKNOWN",
  "BLOCKED",
  "ERROR",
  "NOT_RUN",
] as const);

export type ReliabilityScenarioState =
  (typeof RELIABILITY_SCENARIO_STATES)[number];

/**
 * Deterministic provenance wording for the breakdown.
 *
 * A C03 selection MUST read as a controlled simulation. It is never described
 * as a real Razorpay event, a real webhook delivery, or recorded provider
 * evidence — in the breakdown, the UI, the API response or the demo.
 */
export const RELIABILITY_PROVENANCE_LABEL = Object.freeze({
  RECORDED_TEST_EVIDENCE: "Recorded test evidence",
  SYNTHETIC_DEMO: "Controlled PayChaos security simulation",
});

export type ReliabilityProvenanceLabel =
  (typeof RELIABILITY_PROVENANCE_LABEL)[keyof typeof RELIABILITY_PROVENANCE_LABEL];

/**
 * One mandatory scenario's contribution, carrying enough evidence for
 * P4-AC-11 ("score breakdown is visible and explainable") without any
 * decorative metric: no probability, no confidence, no trend, no
 * merchant-wide statistic.
 */
export interface ReliabilityScenarioBreakdown {
  readonly scenarioId: ReliabilityScenarioId;
  readonly state: ReliabilityScenarioState;
  readonly deduction: number;

  /** What eligibility demanded, so a NOT_RUN is explainable rather than bare. */
  readonly requiredDataClassification: ChaosRunDataClassification;
  /** How many candidates survived eligibility filtering. */
  readonly eligibleCandidateCount: number;

  readonly selectedRunId: string | null;
  readonly selectedDataClassification: ChaosRunDataClassification | null;
  readonly selectedRunStatus: ChaosRunStatus | null;
  readonly selectedRunOutcome: ChaosRunOutcome | null;
  readonly selectedRunCreatedAt: string | null;
  readonly selectedRunCompletedAt: string | null;

  /** Present only for a FAIL state, identifying the deduction's evidence. */
  readonly supportingFailedInvariantResultId: string | null;
  readonly supportingInvariantId: InvariantResultInvariantId | null;
  readonly supportingSeverity: InvariantResultSeverity | null;

  /** `null` when nothing was selected. */
  readonly provenanceLabel: ReliabilityProvenanceLabel | null;
}

/** The derived score. Never persisted, never cached, never a database row. */
export interface ReliabilityScoreV1 {
  readonly algorithmVersion: typeof RELIABILITY_ALGORITHM_VERSION;
  readonly selectionVersion: typeof LATEST_SELECTION_VERSION;
  readonly score: number;
  readonly totalDeduction: number;
  /** Exactly four entries, in `RELIABILITY_MANDATORY_SCENARIOS` order. */
  readonly scenarioBreakdown: readonly ReliabilityScenarioBreakdown[];
}
