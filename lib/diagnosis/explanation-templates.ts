/**
 * Phase 4H-1 / 4H-3 — deterministic explanation and regression guidance.
 *
 * PURE. No I/O, no clock, no randomness, no model, no network. The same
 * inputs always produce the same text, which is what lets this be tested as
 * a contract rather than reviewed as prose.
 *
 * IT STATES ONLY WHAT THE EVIDENCE CARRIES. Every sentence is composed from a
 * persisted diagnosis code, a persisted strength label, an invariant id, a
 * scenario id or a recommendation code. Nothing is inferred about the
 * merchant, the customer, or money that the evidence does not already prove.
 *
 * NO INVENTED CERTAINTY. Strength is an evidence LABEL, never a percentage.
 * `INSUFFICIENT_EVIDENCE` is stated plainly as a limitation rather than
 * softened into a weak conclusion — an undiagnosable failure is a real
 * outcome, not a rounding error.
 *
 * NOT AI. Phase 4H ships no model. These are templates over verified
 * evidence, and the wording never implies otherwise.
 */

/** Evidence-strength labels, exactly as persisted by Phase 4C. */
export type EvidenceStrength =
  "STRONG_EVIDENCE" | "PARTIAL_EVIDENCE" | "INSUFFICIENT_EVIDENCE";

export interface ExplanationInput {
  readonly diagnosisCode: string;
  readonly strength: EvidenceStrength;
  readonly diagnosisSummary: string;
  readonly invariantId: string;
  readonly scenarioId: string | null;
  readonly recommendationCode: string | null;
}

export interface DeterministicExplanation {
  /** What the evidence supports, in one sentence. */
  readonly confidenceStatement: string;
  /** What this means for the merchant, bounded by the invariant that failed. */
  readonly impactStatement: string;
  /** What the reader should treat as still unproven. */
  readonly limitationStatement: string;
}

/**
 * How much weight the reader may put on the classification.
 *
 * Deliberately qualitative. docs/DATABASE.md Section 17 forbids invented
 * confidence percentages, and a number here would be exactly that.
 */
const STRENGTH_STATEMENT: Record<EvidenceStrength, string> = {
  STRONG_EVIDENCE:
    "The persisted evidence directly supports this root cause: the records required to distinguish it from the alternatives are all present.",
  PARTIAL_EVIDENCE:
    "The persisted evidence is consistent with this root cause but does not rule out every alternative. Treat it as the leading candidate, not a settled conclusion.",
  INSUFFICIENT_EVIDENCE:
    "The persisted evidence is not sufficient to identify a root cause. PayChaos is reporting that gap rather than guessing.",
};

const LIMITATION_STATEMENT: Record<EvidenceStrength, string> = {
  STRONG_EVIDENCE:
    "This explains the recorded failure only. It does not claim the same defect exists anywhere else in the integration.",
  PARTIAL_EVIDENCE:
    "Some evidence that would confirm or exclude this cause was never recorded. Capturing it would raise or lower this classification.",
  INSUFFICIENT_EVIDENCE:
    "No further conclusion should be drawn from this finding until the missing evidence is captured. The invariant failure itself remains authoritative.",
};

/**
 * The failure, in merchant terms, derived from the invariant that failed.
 *
 * Keyed by invariant id because the invariant IS the claim — it is the only
 * authoritative statement about what went wrong. An unmapped id falls back to
 * a factual sentence rather than an invented one.
 */
const INVARIANT_IMPACT: Record<string, string> = {
  "INV-001":
    "A unique provider event executed protected business logic more than once.",
  "INV-002":
    "One successful payment produced more than one fulfilment, so the merchant delivered value it was paid for only once.",
  "INV-003":
    "An order was treated as paid even though the payment did not succeed.",
  "INV-004":
    "Fulfilment happened without an authoritative successful payment behind it.",
  "INV-005":
    "A webhook that failed signature verification still changed business state.",
  "INV-006":
    "Replaying an event changed the final business state, so processing is not idempotent.",
  "INV-007": "Duplicate webhook delivery created duplicate business records.",
  "INV-011":
    "The payment moved through a state transition that is not legal for this integration.",
};

export function buildExplanation(
  input: ExplanationInput,
): DeterministicExplanation {
  const impact =
    INVARIANT_IMPACT[input.invariantId] ??
    `The deterministic money invariant ${input.invariantId} did not hold for this run.`;

  const scenarioClause =
    input.scenarioId === null
      ? ""
      : ` It was surfaced by scenario ${input.scenarioId}.`;

  return {
    confidenceStatement: STRENGTH_STATEMENT[input.strength],
    impactStatement: `${impact}${scenarioClause}`,
    limitationStatement: LIMITATION_STATEMENT[input.strength],
  };
}

// ============================================================================
// 4H-3 — REGRESSION TEST ASSISTANCE
// ============================================================================

export interface RegressionGuidance {
  /** What a passing regression would demonstrate. */
  readonly objective: string;
  /** The invariant that must hold. */
  readonly invariantToProve: string;
  /** The unsafe behaviour that must no longer occur. */
  readonly behaviourToEliminate: string;
  /** The persisted state that must be true afterwards. */
  readonly expectedFinalState: string;
}

/**
 * The unsafe mutation each invariant exists to prevent.
 *
 * This is guidance for a developer, not executable code and not a test
 * runner. The existing Phase 4E regression engine remains the only thing that
 * can actually re-run a scenario and decide a verdict.
 */
const UNSAFE_BEHAVIOUR: Record<string, string> = {
  "INV-001": "the same provider event executing protected logic a second time",
  "INV-002": "a second fulfilment being created for one captured payment",
  "INV-003": "an order reaching a paid state from a failed payment",
  "INV-004": "fulfilment proceeding without verified successful payment",
  "INV-005": "any business mutation following a failed signature check",
  "INV-006": "a replay altering the final persisted business state",
  "INV-007": "duplicate delivery producing a duplicate business record",
  "INV-011": "an illegal or non-monotonic payment-state transition",
};

export function buildRegressionGuidance(input: {
  readonly invariantId: string;
  readonly scenarioId: string | null;
  readonly recommendationCode: string | null;
}): RegressionGuidance {
  const scenarioLabel = input.scenarioId ?? "the originating scenario";
  const behaviour =
    UNSAFE_BEHAVIOUR[input.invariantId] ??
    `the behaviour ${input.invariantId} forbids`;

  const fixClause =
    input.recommendationCode === null
      ? "After applying your fix"
      : `After applying ${input.recommendationCode}`;

  return {
    objective: `${fixClause}, re-run ${scenarioLabel} against the Demo Merchant and confirm the same failure no longer reproduces.`,
    invariantToProve: `${input.invariantId} must evaluate to PASS on the new run's persisted evidence.`,
    behaviourToEliminate: `The regression must show ${behaviour} no longer occurring.`,
    expectedFinalState:
      "The merchant's persisted order, payment and fulfilment state must remain consistent with the authoritative payment evidence once the run completes.",
  };
}
