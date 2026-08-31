/**
 * Phase 4D-R1 — pure deterministic recommendation catalogue and template
 * explanation.
 *
 * The frozen architecture is:
 *
 *   DiagnosisEvidencePackV1 + RootCauseClassificationV1
 *     -> deterministic recommendation catalogue
 *       -> RecommendationV1  (code, remediation text, explanation,
 *                             advisory regression recommendation)
 *
 * This module implements that arrow and STOPS there. It persists nothing,
 * writes no Finding column, executes no regression, computes no Reliability
 * Score and no readiness rule. Those belong to 4D-R2 and later
 * (`docs/AI_DESIGN.md` Sections 42–50).
 *
 * A CATALOGUE, NOT IMAGINATION. Every recommendation code comes from the
 * frozen P0 catalogue (`docs/AI_DESIGN.md` Section 43) and every sentence
 * comes from a fixed template. There is no model, no prompt and no free-form
 * generation, so the same inputs always produce the same words.
 *
 * IT NEVER CHANGES CODE. A recommendation is advice for an engineer to read
 * (`docs/AI_DESIGN.md` Section 44). Nothing here edits, patches or executes
 * anything, and nothing here can alter payment truth.
 *
 * EVIDENCE AND INFERENCE STAY SEPARATE. `observedEvidence` contains only
 * statements derived from signals that are PRESENT *and* listed as supporting
 * the selected candidate. `inference` carries the interpretation, and
 * `uncertainty` carries what could not be established. An inference is never
 * presented in the shape of an observed fact.
 *
 * PROVENANCE IS EXPLICIT (`docs/AI_DESIGN.md` Section 48). A PayChaos replay
 * is never described as a Razorpay duplicate delivery, and a PayChaos-injected
 * fault is never described as a Razorpay failure. The C03 invalid-signature
 * scenario is a controlled PayChaos test, and the wording says so.
 *
 * PROSE IS NEVER EVIDENCE. Nothing here reads `finding.title` or the
 * evaluator's `expectedSummary` / `observedSummary` / `reason`. Only the
 * frozen structured signal codes, the selected root cause and the persisted
 * scenario/invariant identity drive output.
 *
 * IT CONSUMES A DIAGNOSIS, IT NEVER MAKES ONE. This module does not call
 * `classifyRootCause` or `extractDiagnosticSignals`: running a second
 * diagnosis engine here would create a second version of the truth. What it
 * does instead is VERIFY that the supplied classification is a coherent
 * frozen Phase 4C result before trusting its selected root cause — see
 * `assertClassificationSelection`.
 *
 * PURE. No database, no network, no environment, no filesystem, no clock, no
 * randomness, no AI provider, no code execution, and no mutation of either
 * supplied input.
 */

import {
  DIAGNOSIS_OUTPUT_SOURCE,
  DIAGNOSIS_RULE_VERSION,
  ROOT_CAUSE_CLASSIFICATION_VERSION,
  ROOT_CAUSE_TAXONOMY,
} from "@/lib/diagnosis/root-cause-classifier";
import type {
  DiagnosisEvidenceStrength,
  RootCauseCandidateV1,
  RootCauseClassificationV1,
  RootCauseCode,
  RootCauseMatchTier,
  RootCauseName,
} from "@/lib/diagnosis/root-cause-classifier";
import type { DiagnosticSignalCode } from "@/lib/diagnosis/diagnostic-signals";
import type {
  DiagnosisEvidencePackV1,
  EvidencePackGapCode,
} from "@/lib/diagnosis/evidence-pack";
import type { InvariantResultEvidenceRef } from "@/lib/supabase/types";

// ============================================================================
// VERSION / PROVENANCE
// ============================================================================

/** Output contract version. Bump only when the emitted shape or meaning changes. */
export const RECOMMENDATION_OUTPUT_VERSION = 1 as const;

/** The frozen deterministic catalogue this module implements. */
export const RECOMMENDATION_CATALOGUE_VERSION =
  "RECOMMENDATION-CATALOGUE-V1" as const;

/**
 * How the recommendation was produced. Deliberately not a model name and not
 * a prompt version: no AI participates, and P0 must work with zero AI
 * services available.
 */
export const RECOMMENDATION_OUTPUT_SOURCE = "DETERMINISTIC_CATALOGUE" as const;

/**
 * The frozen P0 explanation-template set (`docs/AI_DESIGN.md` Sections 46–48).
 *
 * Exposed as provenance so a reader — or a later phase — can tell which fixed
 * wording produced an explanation, without that wording having to be
 * re-derived or guessed. It is application-level only: no schema column
 * records it.
 */
export const RECOMMENDATION_TEMPLATE_VERSION = "TEMPLATE-V1" as const;

// ============================================================================
// FROZEN P0 RECOMMENDATION VOCABULARY (docs/AI_DESIGN.md Section 43)
// ============================================================================

/**
 * The fourteen unique approved recommendation codes.
 *
 * There are sixteen root causes but only fourteen codes, because several
 * causes legitimately share remediation: RC-004/RC-010 share
 * `FIX-STATE-MACHINE`, RC-007/RC-008 share `FIX-TRANSACTION-ATOMICITY`,
 * RC-010/RC-015 share `FIX-RECONCILIATION`, and RC-001/RC-011 share
 * `FIX-IDEMPOTENCY`.
 */
const RECOMMENDATION_CODES = Object.freeze([
  "FIX-IDEMPOTENCY",
  "FIX-BUSINESS-IDEMPOTENCY",
  "FIX-WEBHOOK-AUTH",
  "FIX-STATE-MACHINE",
  "FIX-WEBHOOK-TIMEOUT",
  "FIX-RETRY-HANDLING",
  "FIX-TRANSACTION-ATOMICITY",
  "FIX-CLIENT-INDEPENDENCE",
  "FIX-RECONCILIATION",
  "FIX-PROVENANCE",
  "FIX-UNSUPPORTED-EVENT-GUARD",
  "FIX-PAYMENT-FAILURE-GUARD",
  "FIX-AMOUNT-CURRENCY-VALIDATION",
  "INVESTIGATE-EVIDENCE-GAP",
] as const);

export const RECOMMENDATION_CODE_VOCABULARY: readonly RecommendationCode[] =
  RECOMMENDATION_CODES;

export type RecommendationCode = (typeof RECOMMENDATION_CODES)[number];

/**
 * The root-cause outcomes the frozen Phase 4C classifier can actually select.
 *
 * The other eight taxonomy codes remain frozen in the diagnosis layer but are
 * unreachable today, so this module deliberately has no selection rule for
 * them. Writing speculative remediation for a diagnosis that cannot occur
 * would be inventing semantics — and, for cases like RC-011, would silently
 * resolve an evidence-dependent choice between two catalogue codes that no
 * evidence has yet been asked to decide.
 */
export const ACTIVE_RECOMMENDATION_ROOT_CAUSE_CODES: readonly RootCauseCode[] =
  Object.freeze([
    "RC-001",
    "RC-002",
    "RC-003",
    "RC-009",
    "RC-010",
    "RC-013",
    "RC-014",
    "RC-016",
  ]);

// ============================================================================
// OUTPUT CONTRACT
// ============================================================================

export interface RecommendationDiagnosisV1 {
  readonly rootCauseCode: RootCauseCode;
  readonly rootCauseName: RootCauseName;
  readonly strength: DiagnosisEvidenceStrength;
  readonly matchTier: RootCauseMatchTier;
}

export interface RecommendationBodyV1 {
  readonly code: RecommendationCode;
  readonly title: string;
  readonly text: string;
}

/**
 * The explanation, split so a reader can always tell fact from interpretation.
 *
 * `observedEvidence` is what PayChaos saw. `inference` is what it concluded.
 * `uncertainty` is what it could not establish. Merging them would be exactly
 * the failure `docs/AI_DESIGN.md` Section 48 warns against.
 */
export interface RecommendationExplanationV1 {
  readonly diagnosisSummary: string;
  readonly observedEvidence: readonly string[];
  readonly inference: string;
  readonly uncertainty: string | null;
}

/**
 * An ADVISORY regression recommendation. Phase 4D recommends; Phase 4E is
 * the only phase permitted to run anything.
 *
 * `hasApprovedScenario` states one narrow fact: whether this Finding carries
 * an approved original P0 scenario that a regression could target. It is
 * deliberately NOT an execution-readiness flag — it does not claim the
 * regression engine exists, that a rerun is currently possible, that a user
 * can start one, or that any safety precondition passes. Those are Phase 4E's
 * to determine, and naming this field after a capability that has not been
 * built would be a claim this phase cannot support.
 */
export interface RegressionRecommendationV1 {
  readonly scenarioId: string | null;
  readonly failedInvariantId: string;
  readonly action: string;
  readonly hasApprovedScenario: boolean;
}

export interface RecommendationV1 {
  readonly version: typeof RECOMMENDATION_OUTPUT_VERSION;
  readonly catalogueVersion: typeof RECOMMENDATION_CATALOGUE_VERSION;
  readonly templateVersion: typeof RECOMMENDATION_TEMPLATE_VERSION;
  readonly outputSource: typeof RECOMMENDATION_OUTPUT_SOURCE;
  readonly findingId: string;
  readonly invariantResultId: string;
  readonly diagnosis: RecommendationDiagnosisV1;
  readonly recommendation: RecommendationBodyV1;
  readonly explanation: RecommendationExplanationV1;
  readonly regressionRecommendation: RegressionRecommendationV1;
  readonly supportingSignalCodes: readonly DiagnosticSignalCode[];
  readonly contradictorySignalCodes: readonly DiagnosticSignalCode[];
  readonly blockingGapCodes: readonly EvidencePackGapCode[];
  /** The persisted Evidence Pack references, verbatim. Never invented here. */
  readonly evidenceRefs: readonly InvariantResultEvidenceRef[];
}

// ============================================================================
// ERROR MODEL
// ============================================================================

/**
 * Input-contract failures.
 *
 * None of these is `INVESTIGATE-EVIDENCE-GAP`. That code is the remediation
 * for a VALID `RC-016` diagnosis — a real answer about real evidence. A
 * broken input contract or an unreachable root cause is a different
 * condition, and must fail closed rather than be dressed as advice.
 */
export const RECOMMENDATION_ERROR_CODES = Object.freeze([
  "RECOMMENDATION_INPUT_IDENTITY_MISMATCH",
  "RECOMMENDATION_INPUT_NOT_FAIL",
  "RECOMMENDATION_CLASSIFICATION_VERSION_UNSUPPORTED",
  "RECOMMENDATION_RULE_VERSION_UNSUPPORTED",
  "RECOMMENDATION_CLASSIFICATION_SOURCE_UNSUPPORTED",
  "RECOMMENDATION_EVIDENCE_REF_MISMATCH",
  /**
   * The classification object is not a coherent frozen Phase 4C result — its
   * `selected` candidate is not the ranked winner, or its shape contradicts
   * the frozen taxonomy. Deliberately distinct from
   * `RECOMMENDATION_ROOT_CAUSE_UNSUPPORTED`: the problem is not that a valid
   * diagnosis category lacks a rule, but that the supplied object is not a
   * genuine classifier output at all.
   */
  "RECOMMENDATION_CLASSIFICATION_SELECTION_INVALID",
  "RECOMMENDATION_ROOT_CAUSE_UNSUPPORTED",
  "RECOMMENDATION_RC010_PATTERN_UNSUPPORTED",
] as const);

export type RecommendationErrorCode =
  (typeof RECOMMENDATION_ERROR_CODES)[number];

export class RecommendationError extends Error {
  readonly code: RecommendationErrorCode;

  constructor(code: RecommendationErrorCode, message: string) {
    super(message);
    this.name = "RecommendationError";
    this.code = code;
  }
}

// ============================================================================
// SAFE SIGNAL-TO-OBSERVATION TEMPLATES
// ============================================================================

/**
 * One fixed sentence per frozen signal code.
 *
 * A sentence is emitted ONLY when that signal is listed as supporting the
 * selected candidate — which the frozen classifier does only for signals it
 * found `PRESENT`. An `UNKNOWN` or `ABSENT` signal therefore can never become
 * an observed statement.
 *
 * The wording is deliberately provenance-correct: a replay is a PayChaos
 * replay, and the invalid-signature case is a controlled PayChaos test.
 */
const OBSERVATION_TEMPLATES: Readonly<Record<DiagnosticSignalCode, string>> =
  Object.freeze({
    DUPLICATE_EVENT_ATTEMPTS:
      "Repeated processing attempts were recorded for the relevant event context.",
    DUPLICATE_FULFILMENTS:
      "More than one fulfilment/business-effect record was observed in the relevant order context.",
    DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS:
      "Equivalent fulfilment effects used different idempotency keys.",
    SAME_LOGICAL_PAYMENT:
      "The duplicate business effects were correlated to the same logical payment.",
    INVALID_SIGNATURE_MUTATED_STATE:
      "The controlled invalid-signature test observed business-state mutation.",
    CLIENT_CONFIRMATION_MISSING:
      "Client confirmation was intentionally absent in the controlled test.",
    PAYMENT_CAPTURED_VIA_WEBHOOK:
      "Verified captured-payment evidence was present through the server/webhook path.",
    CAPTURE_EXISTS_ORDER_NOT_PAID:
      "Captured payment evidence existed while merchant order state was not PAID.",
    FAILURE_EVENT_MARKED_PAID:
      "Verified failure evidence was associated with merchant PAID state.",
    OUT_OF_ORDER_STATE_REGRESSION:
      "A protected merchant/payment state regression was observed.",
    REPLAY_CHANGED_FINAL_STATE:
      "A PayChaos replay changed protected final merchant state.",
    AMOUNT_MISMATCH:
      "Amount values disagreed across the relevant payment records.",
    CURRENCY_MISMATCH:
      "Currency values disagreed across the relevant payment records.",
  });

// ============================================================================
// REMEDIATION TEMPLATES
// ============================================================================

interface RemediationTemplate {
  readonly code: RecommendationCode;
  readonly title: string;
  readonly text: string;
  /** The engineering principle behind the fix, restated for the summary. */
  readonly inference: string;
}

const REMEDIATION_FIX_IDEMPOTENCY: RemediationTemplate = Object.freeze({
  code: "FIX-IDEMPOTENCY",
  title: "Make event-level processing idempotent",
  text: [
    "Use a durable canonical event identity as the idempotency boundary for event-level processing.",
    "Repeated processing of the same logical event must not repeat protected business logic or protected effects.",
    "A duplicate or replayed delivery must be safe by construction, not safe by timing.",
    "Do not assume a delivery pattern the evidence does not prove; enforce the boundary on your side.",
  ].join(" "),
  inference:
    "The evidence indicates that repeated processing of one logical event was able to repeat protected work.",
});

const REMEDIATION_FIX_BUSINESS_IDEMPOTENCY: RemediationTemplate = Object.freeze(
  {
    code: "FIX-BUSINESS-IDEMPOTENCY",
    title: "Use one semantic idempotency boundary for the business effect",
    text: [
      "Use a single stable semantic idempotency boundary for the protected business action.",
      "For fulfilment, that means one logical FULFIL_ORDER action per merchant order/payment semantics.",
      "Do not derive business-effect idempotency from webhook-delivery identity, and do not derive it from processing-attempt identity: both can legitimately repeat.",
      "Enforce the uniqueness durably at the database/business-effect boundary rather than in application control flow.",
    ].join(" "),
    inference:
      "The evidence indicates a business-level idempotency boundary problem rather than a payment-provider failure.",
  },
);

const REMEDIATION_FIX_WEBHOOK_AUTH: RemediationTemplate = Object.freeze({
  code: "FIX-WEBHOOK-AUTH",
  title: "Verify webhook authenticity before any trusted processing",
  text: [
    "Verify webhook authenticity before any trusted processing begins.",
    "An invalid signature must be rejected before any payment or business mutation occurs.",
    "Keep raw-body signature verification server-side; never move it to the client and never accept a client-supplied verdict.",
    "Handling an invalid signature must have zero business effect.",
  ].join(" "),
  inference:
    "The evidence indicates that rejected-signature handling was able to reach business state.",
});

const REMEDIATION_FIX_CLIENT_INDEPENDENCE: RemediationTemplate = Object.freeze({
  code: "FIX-CLIENT-INDEPENDENCE",
  title: "Do not depend on the browser callback for payment truth",
  text: [
    "Final merchant payment convergence must not depend on the browser success callback.",
    "Verified server-side and provider evidence must be sufficient on its own to establish the durable merchant state.",
    "The client callback may improve the user experience, but it can never be required for payment truth.",
    "Preserve server-side and webhook reconciliation as the authority for final state.",
  ].join(" "),
  inference:
    "The evidence indicates that durable merchant state depended on a client confirmation that was absent.",
});

const REMEDIATION_FIX_STATE_MACHINE: RemediationTemplate = Object.freeze({
  code: "FIX-STATE-MACHINE",
  title: "Define legal monotonic payment state transitions",
  text: [
    "Define the legal payment and order state transitions explicitly, and make protected transitions monotonic.",
    "Older or weaker evidence must not regress a stronger already-verified state.",
    "Process events on the basis of state validity, not arrival order.",
  ].join(" "),
  inference:
    "The evidence indicates that a protected state was allowed to move backwards.",
});

const REMEDIATION_FIX_RECONCILIATION: RemediationTemplate = Object.freeze({
  code: "FIX-RECONCILIATION",
  title: "Reconcile merchant state from verified payment evidence",
  text: [
    "Add or strengthen a deterministic reconciliation path from verified captured payment evidence to merchant state.",
    "Convergence must be recoverable when the ordinary local confirmation path is missed, rather than depending on it.",
    "Reconciliation must read authoritative verified evidence; it must never trust a browser-supplied claim about payment state.",
  ].join(" "),
  inference:
    "The evidence indicates that verified payment state and merchant state did not converge.",
});

const REMEDIATION_FIX_PAYMENT_FAILURE_GUARD: RemediationTemplate =
  Object.freeze({
    code: "FIX-PAYMENT-FAILURE-GUARD",
    title: "Never let failure evidence mark an order paid",
    text: [
      "Payment failure evidence must never mark the merchant order PAID.",
      "Keep failed-attempt state separate from successful/captured state so a failure can never be mapped onto success.",
      "Preserve legal state-machine convergence at the same time, so that a later legitimate success is not incorrectly blocked by the guard.",
    ].join(" "),
    inference:
      "The evidence indicates that failure evidence was mapped onto a paid merchant state.",
  });

const REMEDIATION_FIX_AMOUNT_CURRENCY_VALIDATION: RemediationTemplate =
  Object.freeze({
    code: "FIX-AMOUNT-CURRENCY-VALIDATION",
    title: "Validate amount and currency across the payment path",
    text: [
      "Validate amount and currency consistently across the merchant order, the payment attempt and the verified payment evidence.",
      "Compare amounts as integer smallest-currency-subunit values, and compare currency as a canonical code.",
      "Never recompute money from a formatted display string.",
      "Hold or reject payment-state convergence and fulfilment while a mismatch is unresolved, rather than choosing one value.",
    ].join(" "),
    inference:
      "The evidence indicates a money-consistency problem across the correlated payment records.",
  });

const REMEDIATION_INVESTIGATE_EVIDENCE_GAP: RemediationTemplate = Object.freeze(
  {
    code: "INVESTIGATE-EVIDENCE-GAP",
    title: "Collect the missing evidence before changing payment code",
    text: [
      "The invariant failure is proven, but a specific technical root cause is not.",
      "Inspect the listed blocking evidence gaps and the missing structured evidence for this finding.",
      "Collect or repair that evidence before making invasive changes to payment code.",
      "Then rerun the original approved test context, where one is available, and re-evaluate.",
    ].join(" "),
    inference:
      "The available structured evidence does not safely identify a specific technical root cause.",
  },
);

// ============================================================================
// ROOT-CAUSE -> REMEDIATION SELECTION
// ============================================================================

/**
 * RC-010 has two approved remediation families, and the choice must come from
 * the SELECTED candidate's own supporting signals rather than from the
 * scenario or from a default.
 *
 * A proven state regression is the more specific finding and takes precedence
 * even when capture/stale evidence is also present: a system that moves
 * protected state backwards needs its transition rules fixed before any
 * reconciliation path is worth adding.
 */
function selectRc010Template(
  classification: RootCauseClassificationV1,
): RemediationTemplate {
  const supporting = new Set(classification.selected.supportingSignalCodes);

  // Case A — a proven protected-state regression.
  if (supporting.has("OUT_OF_ORDER_STATE_REGRESSION")) {
    return REMEDIATION_FIX_STATE_MACHINE;
  }

  // Case B — verified capture alongside a merchant that is not paid.
  if (
    supporting.has("PAYMENT_CAPTURED_VIA_WEBHOOK") &&
    supporting.has("CAPTURE_EXISTS_ORDER_NOT_PAID")
  ) {
    return REMEDIATION_FIX_RECONCILIATION;
  }

  // Case C — capture established, stale merchant state not established. The
  // frozen classifier expresses exactly this as a PARTIAL candidate whose
  // only support is the capture signal.
  if (
    classification.selected.strength === "PARTIAL_EVIDENCE" &&
    supporting.has("PAYMENT_CAPTURED_VIA_WEBHOOK")
  ) {
    return REMEDIATION_FIX_RECONCILIATION;
  }

  // No frozen R1 support pattern matched. Fail closed rather than defaulting
  // to one of the two families arbitrarily.
  throw new RecommendationError(
    "RECOMMENDATION_RC010_PATTERN_UNSUPPORTED",
    "The stale-payment-state diagnosis does not carry a supported remediation evidence pattern.",
  );
}

function selectTemplate(
  classification: RootCauseClassificationV1,
): RemediationTemplate {
  switch (classification.selected.code) {
    case "RC-001":
      return REMEDIATION_FIX_IDEMPOTENCY;
    case "RC-002":
      return REMEDIATION_FIX_BUSINESS_IDEMPOTENCY;
    case "RC-003":
      return REMEDIATION_FIX_WEBHOOK_AUTH;
    case "RC-009":
      return REMEDIATION_FIX_CLIENT_INDEPENDENCE;
    case "RC-010":
      return selectRc010Template(classification);
    case "RC-013":
      return REMEDIATION_FIX_PAYMENT_FAILURE_GUARD;
    case "RC-014":
      return REMEDIATION_FIX_AMOUNT_CURRENCY_VALIDATION;
    case "RC-016":
      return REMEDIATION_INVESTIGATE_EVIDENCE_GAP;
    default:
      // An inactive taxonomy code the frozen classifier cannot currently
      // select. Guessing remediation for an unreachable diagnosis would be
      // inventing semantics.
      throw new RecommendationError(
        "RECOMMENDATION_ROOT_CAUSE_UNSUPPORTED",
        "This root cause has no approved deterministic recommendation rule in the current catalogue.",
      );
  }
}

// ============================================================================
// EXPLANATION
// ============================================================================

function observedEvidenceFor(
  classification: RootCauseClassificationV1,
): readonly string[] {
  // Supporting codes are already emitted by the classifier in frozen signal
  // order, and the classifier lists a signal there only when it is PRESENT.
  return classification.selected.supportingSignalCodes.map(
    (code) => OBSERVATION_TEMPLATES[code],
  );
}

/**
 * What could not be established, in fixed wording.
 *
 * The typed `contradictorySignalCodes` and `blockingGapCodes` travel on the
 * output verbatim; this sentence never spells a code name out into a prose
 * claim, because a gap code names a missing fact, not an observed one.
 */
function uncertaintyFor(
  classification: RootCauseClassificationV1,
): string | null {
  const selected = classification.selected;

  if (selected.code === "RC-016") {
    return "The invariant failure is authoritative, but the available structured evidence does not safely prove a specific technical root cause.";
  }

  if (selected.strength === "PARTIAL_EVIDENCE") {
    return "The diagnosis is partial because one or more required evidence facts were unavailable. Validate the suspected boundary before making invasive changes.";
  }

  if (selected.blockingGapCodes.length > 0) {
    return "Some required diagnostic evidence is incomplete.";
  }

  if (selected.contradictorySignalCodes.length > 0) {
    return "Some evidence weakens, without disproving, the selected diagnosis.";
  }

  return null;
}

/**
 * A concise deterministic summary intended for later persistence into
 * `findings.diagnosis_summary`. R1 writes nothing.
 *
 * It states the failed invariant, the selected cause and the evidence
 * strength, then why the structured signals support the inference, and
 * finally what is uncertain. It invents no fact and copies no evaluator
 * prose.
 */
function diagnosisSummaryFor(
  pack: DiagnosisEvidencePackV1,
  classification: RootCauseClassificationV1,
  template: RemediationTemplate,
): string {
  const selected = classification.selected;
  const parts: string[] = [];

  parts.push(
    `${pack.invariant.invariantId} failed. PayChaos selected ${selected.code} ${selected.name} with ${selected.strength}.`,
  );

  const observed = observedEvidenceFor(classification);
  if (observed.length > 0) {
    parts.push(`Observed: ${observed.join(" ")}`);
  } else {
    parts.push("No supporting structured signal could be established.");
  }

  parts.push(template.inference);

  const uncertainty = uncertaintyFor(classification);
  if (uncertainty !== null) parts.push(uncertainty);

  parts.push(`Recommended action: ${template.title}.`);

  return parts.join(" ");
}

// ============================================================================
// REGRESSION RECOMMENDATION (ADVISORY)
// ============================================================================

/**
 * The deterministic regression recommendation of `docs/AI_DESIGN.md`
 * Section 49: rerun the SAME approved scenario and re-evaluate the SAME
 * relevant invariant SET.
 *
 * THE WHOLE SET, NOT JUST ONE INVARIANT. The failed invariant is named
 * because it produced this Finding and must pass, but the recommendation asks
 * for the scenario's approved relevant invariant set to be re-evaluated.
 * Narrowing a rerun to a single invariant would let a fix that repairs one
 * property while breaking another look like a success.
 *
 * The set itself is deliberately NOT enumerated here. Resolving a scenario to
 * its required invariants belongs to Phase 4E, which must read the
 * authoritative scenario registry; duplicating that frozen mapping into this
 * pure module would create a second copy free to drift from it.
 *
 * Never a new scenario, never an arbitrary target, never an HTTP action, and
 * never an execution. When the pack carries no scenario, that absence is
 * reported rather than filled in.
 */
function regressionRecommendationFor(
  pack: DiagnosisEvidencePackV1,
): RegressionRecommendationV1 {
  const invariantId = pack.invariant.invariantId;

  if (pack.scenario === null) {
    return {
      scenarioId: null,
      failedInvariantId: invariantId,
      action:
        "No approved original chaos scenario is available on this evidence pack; do not invent a runtime regression target.",
      hasApprovedScenario: false,
    };
  }

  const scenarioId = pack.scenario.scenarioId;
  return {
    scenarioId,
    failedInvariantId: invariantId,
    action:
      `Rerun the original approved ${scenarioId} scenario and re-evaluate its approved relevant invariant set. ` +
      `${invariantId}, the invariant that produced this Finding, must pass.`,
    hasApprovedScenario: true,
  };
}

// ============================================================================
// INPUT INTEGRITY
// ============================================================================

function sameStringList(a: readonly string[], b: readonly string[]): boolean {
  // Order matters: Phase 4C already emits these in canonical frozen order, so
  // a reordering is itself evidence the object was not produced by it.
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function sameCandidate(
  a: RootCauseCandidateV1,
  b: RootCauseCandidateV1,
): boolean {
  return (
    a.code === b.code &&
    a.name === b.name &&
    a.strength === b.strength &&
    a.matchTier === b.matchTier &&
    sameStringList(a.supportingSignalCodes, b.supportingSignalCodes) &&
    sameStringList(a.contradictorySignalCodes, b.contradictorySignalCodes) &&
    sameStringList(a.blockingGapCodes, b.blockingGapCodes)
  );
}

/**
 * Verifies the supplied classification is a coherent frozen Phase 4C result.
 *
 * THIS IS A TRUST BOUNDARY, NOT A FORMALITY. Phase 4D consumes Phase 4C's
 * selected root cause; it never substitutes its own. Without this check an
 * object could carry valid provenance metadata — right version, right rule
 * version, right source, matching identities and evidence references — while
 * its `selected.code` had been swapped from the genuine ranked winner to a
 * different ACTIVE code. The catalogue would then dutifully emit remediation
 * for a diagnosis the classifier never made.
 *
 * Every failure fails closed. The winner is never silently substituted for
 * the supplied `selected`, because quietly repairing a malformed object would
 * hide exactly the tampering this check exists to catch.
 */
function assertClassificationSelection(
  classification: RootCauseClassificationV1,
): void {
  const invalid = (message: string): never => {
    throw new RecommendationError(
      "RECOMMENDATION_CLASSIFICATION_SELECTION_INVALID",
      message,
    );
  };

  // A — the frozen classifier always emits at least one candidate, because
  // RC-016 is its fallback.
  const winner = classification.rankedCandidates[0];
  if (winner === undefined) {
    invalid("The supplied classification carries no ranked candidate.");
    return;
  }

  const selected = classification.selected;

  // B — the selected candidate must BE the ranked winner, field for field.
  if (!sameCandidate(selected, winner)) {
    invalid(
      "The supplied classification's selected root cause is not its ranked winner.",
    );
  }

  // C — the code/name pair must match the frozen taxonomy. The taxonomy is
  // read from the frozen classifier rather than re-declared here, so the two
  // cannot drift.
  const entry = ROOT_CAUSE_TAXONOMY.find((item) => item.code === selected.code);
  if (entry === undefined || entry.name !== selected.name) {
    invalid(
      "The supplied classification's selected root-cause code and name do not match the frozen taxonomy.",
    );
  }

  // D — RC-016's shape is itself frozen: it is an abstention, so it can carry
  // neither a stronger label nor any supporting or contradictory signal.
  if (selected.code === "RC-016") {
    if (
      selected.strength !== "INSUFFICIENT_EVIDENCE" ||
      selected.matchTier !== "INSUFFICIENT" ||
      selected.supportingSignalCodes.length > 0 ||
      selected.contradictorySignalCodes.length > 0
    ) {
      invalid(
        "The supplied insufficient-evidence classification does not carry the frozen abstention shape.",
      );
    }
  }
}

function sameEvidenceRefs(
  a: readonly InvariantResultEvidenceRef[],
  b: readonly InvariantResultEvidenceRef[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((ref, index) => {
    const other = b[index];
    return (
      other !== undefined && ref.kind === other.kind && ref.id === other.id
    );
  });
}

/**
 * Fails closed when the two frozen inputs do not belong together, or did not
 * come from the approved deterministic classifier.
 *
 * None of these becomes `INVESTIGATE-EVIDENCE-GAP`: a broken contract is not
 * a statement about evidence, and offering advice for it would be exactly the
 * confident-but-unfounded output this design forbids.
 */
function assertInputIntegrity(
  pack: DiagnosisEvidencePackV1,
  classification: RootCauseClassificationV1,
): void {
  if (
    pack.finding.findingId !== classification.findingId ||
    pack.finding.invariantResultId !== classification.invariantResultId
  ) {
    throw new RecommendationError(
      "RECOMMENDATION_INPUT_IDENTITY_MISMATCH",
      "The evidence pack and classification do not describe the same finding.",
    );
  }

  if (pack.invariant.result !== "FAIL") {
    throw new RecommendationError(
      "RECOMMENDATION_INPUT_NOT_FAIL",
      "A recommendation may only be generated for a failed invariant result.",
    );
  }

  if (classification.version !== ROOT_CAUSE_CLASSIFICATION_VERSION) {
    throw new RecommendationError(
      "RECOMMENDATION_CLASSIFICATION_VERSION_UNSUPPORTED",
      "The supplied classification uses an unsupported contract version.",
    );
  }

  if (classification.ruleVersion !== DIAGNOSIS_RULE_VERSION) {
    throw new RecommendationError(
      "RECOMMENDATION_RULE_VERSION_UNSUPPORTED",
      "The supplied classification uses an unsupported diagnosis rule version.",
    );
  }

  if (classification.outputSource !== DIAGNOSIS_OUTPUT_SOURCE) {
    throw new RecommendationError(
      "RECOMMENDATION_CLASSIFICATION_SOURCE_UNSUPPORTED",
      "The supplied classification did not come from the approved deterministic rules.",
    );
  }

  if (!sameEvidenceRefs(classification.evidenceRefs, pack.evidenceRefs)) {
    throw new RecommendationError(
      "RECOMMENDATION_EVIDENCE_REF_MISMATCH",
      "The classification and evidence pack do not carry the same persisted evidence references.",
    );
  }

  // The classification's own internal coherence, checked BEFORE any
  // recommendation is selected from it.
  assertClassificationSelection(classification);
}

// ============================================================================
// GENERATION
// ============================================================================

/**
 * Builds the deterministic recommendation for one diagnosed Finding.
 *
 * Pure: it reads no clock, consults no randomness, mutates neither input, and
 * returns a deep-equal result for identical inputs. It throws only
 * `RecommendationError`, and only for a broken input contract or an
 * unreachable root cause.
 */
export function buildRecommendation(
  pack: DiagnosisEvidencePackV1,
  classification: RootCauseClassificationV1,
): RecommendationV1 {
  assertInputIntegrity(pack, classification);

  if (
    !ACTIVE_RECOMMENDATION_ROOT_CAUSE_CODES.includes(
      classification.selected.code,
    )
  ) {
    throw new RecommendationError(
      "RECOMMENDATION_ROOT_CAUSE_UNSUPPORTED",
      "This root cause has no approved deterministic recommendation rule in the current catalogue.",
    );
  }

  const template = selectTemplate(classification);
  const selected = classification.selected;

  return {
    version: RECOMMENDATION_OUTPUT_VERSION,
    catalogueVersion: RECOMMENDATION_CATALOGUE_VERSION,
    templateVersion: RECOMMENDATION_TEMPLATE_VERSION,
    outputSource: RECOMMENDATION_OUTPUT_SOURCE,
    findingId: classification.findingId,
    invariantResultId: classification.invariantResultId,
    diagnosis: {
      rootCauseCode: selected.code,
      rootCauseName: selected.name,
      strength: selected.strength,
      matchTier: selected.matchTier,
    },
    recommendation: {
      code: template.code,
      title: template.title,
      text: template.text,
    },
    explanation: {
      diagnosisSummary: diagnosisSummaryFor(pack, classification, template),
      observedEvidence: observedEvidenceFor(classification),
      inference: template.inference,
      uncertainty: uncertaintyFor(classification),
    },
    regressionRecommendation: regressionRecommendationFor(pack),
    supportingSignalCodes: selected.supportingSignalCodes,
    contradictorySignalCodes: selected.contradictorySignalCodes,
    blockingGapCodes: selected.blockingGapCodes,
    evidenceRefs: pack.evidenceRefs,
  };
}
