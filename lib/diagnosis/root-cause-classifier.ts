/**
 * Phase 4C-R1 — pure deterministic root-cause classification.
 *
 * The frozen architecture is:
 *
 *   Finding -> DiagnosisEvidencePackV1 -> DiagnosticSignalSetV1
 *           -> deterministic candidate rules -> ranked candidates
 *           -> selected root cause + evidence strength
 *
 * This module implements the last arrow and STOPS there. It contains no
 * recommendation, no regression logic, no Reliability Score, no readiness
 * rule, no persistence and no explanation prose. Those belong to 4D and later
 * (`docs/AI_DESIGN.md` Sections 42–49).
 *
 * ADVISORY ONLY. A root cause is a ranked engineering hypothesis derived from
 * structured evidence. It can never change the authoritative deterministic
 * invariant verdict, and nothing here writes a Finding column.
 *
 * NO PROBABILITY. Candidates are ranked by evidence SPECIFICITY, exactly as
 * `docs/AI_DESIGN.md` Section 34 defines, and strength is one of three frozen
 * labels. There is no percentage, no confidence score and no model output
 * (Section 41). A candidate can never rank first merely because the scenario
 * normally causes that problem.
 *
 * PROSE IS NEVER EVIDENCE. Nothing here reads `finding.title`, or the
 * evaluator's `expectedSummary` / `observedSummary` / `reason`. `scenarioId`
 * and `invariantId` may gate whether a rule is APPLICABLE, but neither is
 * evidence that the technical behaviour occurred.
 *
 * UNKNOWN IS NEVER PROMOTED. A signal that could not be established never
 * counts as support. Where a required fact is UNKNOWN a candidate may at most
 * be `PARTIAL_EVIDENCE`, and where the frozen rule does not allow that, no
 * candidate is produced at all.
 *
 * PURE. No database, no network, no environment, no filesystem, no clock, no
 * randomness, no AI provider, no write of any kind, and no mutation of either
 * supplied input. The same inputs always yield a deep-equal classification.
 */

import {
  DIAGNOSTIC_SIGNAL_CODES,
  DIAGNOSTIC_SIGNAL_VERSION,
} from "@/lib/diagnosis/diagnostic-signals";
import type {
  DiagnosticSignalCode,
  DiagnosticSignalSetV1,
  DiagnosticSignalState,
} from "@/lib/diagnosis/diagnostic-signals";
import type {
  DiagnosisEvidencePackV1,
  EvidencePackGapCode,
} from "@/lib/diagnosis/evidence-pack";
// The persisted evidence-reference shape, reused rather than re-declared so
// it cannot drift from the frozen schema vocabulary. `lib/supabase/types.ts`
// is a pure declaration file with zero imports and zero runtime code, so this
// `import type` is erased at compile time and grants no database access.
import type { InvariantResultEvidenceRef } from "@/lib/supabase/types";

// ============================================================================
// VERSION / SOURCE
// ============================================================================

/** Output contract version. Bump only when the emitted shape or meaning changes. */
export const ROOT_CAUSE_CLASSIFICATION_VERSION = 1 as const;

/** The frozen deterministic rule set this module implements. */
export const DIAGNOSIS_RULE_VERSION = "DIAG-RULES-V1" as const;

/**
 * How the classification was produced. Deliberately not a model name: no AI
 * participates, and P0 must work with zero AI services available.
 */
export const DIAGNOSIS_OUTPUT_SOURCE = "DETERMINISTIC_RULES" as const;

// ============================================================================
// FROZEN P0 ROOT-CAUSE TAXONOMY (docs/AI_DESIGN.md Section 16)
// ============================================================================

const ROOT_CAUSE_CATALOGUE = Object.freeze([
  Object.freeze({ code: "RC-001", name: "MISSING_EVENT_IDEMPOTENCY" }),
  Object.freeze({ code: "RC-002", name: "MISSING_BUSINESS_IDEMPOTENCY" }),
  Object.freeze({ code: "RC-003", name: "INVALID_SIGNATURE_HANDLING" }),
  Object.freeze({ code: "RC-004", name: "EVENT_ORDERING_ASSUMPTION" }),
  Object.freeze({ code: "RC-005", name: "WEBHOOK_PROCESSING_DEADLINE_RISK" }),
  Object.freeze({ code: "RC-006", name: "RETRY_STATE_MANAGEMENT_FAILURE" }),
  Object.freeze({ code: "RC-007", name: "NON_ATOMIC_PROCESSING" }),
  Object.freeze({ code: "RC-008", name: "DATABASE_PARTIAL_FAILURE" }),
  Object.freeze({ code: "RC-009", name: "CLIENT_CONFIRMATION_DEPENDENCY" }),
  Object.freeze({ code: "RC-010", name: "STALE_PAYMENT_STATE" }),
  Object.freeze({ code: "RC-011", name: "UNSAFE_REPLAY_HANDLING" }),
  Object.freeze({ code: "RC-012", name: "UNSUPPORTED_EVENT_FALLTHROUGH" }),
  Object.freeze({ code: "RC-013", name: "PAYMENT_FAILURE_STATE_MAPPING" }),
  Object.freeze({ code: "RC-014", name: "AMOUNT_CURRENCY_MISMATCH" }),
  Object.freeze({ code: "RC-015", name: "MISSING_RECONCILIATION" }),
  Object.freeze({ code: "RC-016", name: "INSUFFICIENT_EVIDENCE" }),
] as const);

export const ROOT_CAUSE_TAXONOMY: readonly RootCauseCatalogueEntry[] =
  ROOT_CAUSE_CATALOGUE;

export type RootCauseCatalogueEntry = (typeof ROOT_CAUSE_CATALOGUE)[number];
export type RootCauseCode = RootCauseCatalogueEntry["code"];
export type RootCauseName = RootCauseCatalogueEntry["name"];

function rootCauseName(code: RootCauseCode): RootCauseName {
  const entry = ROOT_CAUSE_CATALOGUE.find((item) => item.code === code);
  // Unreachable: `code` is constrained to the catalogue's own literal union.
  if (entry === undefined) throw new Error("unknown root cause code");
  return entry.name;
}

/**
 * The categories this R1 rule engine can select.
 *
 * The other eight remain in the frozen taxonomy but have no active rule:
 * within the approved 13-signal contract they lack a distinct evidence
 * combination that would select them without guessing, or they belong to
 * deferred P1 scenario wrappers. Activating one requires architect-approved
 * evidence support, NOT a looser rule over the signals that already exist.
 */
export const ACTIVE_ROOT_CAUSE_CODES: readonly RootCauseCode[] = Object.freeze([
  "RC-001",
  "RC-002",
  "RC-003",
  "RC-009",
  "RC-010",
  "RC-013",
  "RC-014",
]);

/** The fallback used when no active specific candidate survives safely. */
export const FALLBACK_ROOT_CAUSE_CODE = "RC-016" as const;

// ============================================================================
// EVIDENCE STRENGTH AND MATCH TIER
// ============================================================================

/**
 * Evidence strength, not confidence (`docs/AI_DESIGN.md` Sections 37–41).
 * There is deliberately no percentage and no HIGH/MEDIUM/LOW scale.
 */
export type DiagnosisEvidenceStrength =
  "STRONG_EVIDENCE" | "PARTIAL_EVIDENCE" | "INSUFFICIENT_EVIDENCE";

/**
 * Evidence specificity, in the frozen ranking order of
 * `docs/AI_DESIGN.md` Section 34. The ordinal below exists only to sort; it is
 * never emitted and must never be read as a confidence value.
 */
export type RootCauseMatchTier =
  | "DIRECT_EVIDENCE"
  | "SCENARIO_INVARIANT_SIGNAL"
  | "INVARIANT_SIGNAL"
  | "PARTIAL_MATCH"
  | "INSUFFICIENT";

const MATCH_TIER_ORDER: readonly RootCauseMatchTier[] = Object.freeze([
  "DIRECT_EVIDENCE",
  "SCENARIO_INVARIANT_SIGNAL",
  "INVARIANT_SIGNAL",
  "PARTIAL_MATCH",
  "INSUFFICIENT",
]);

const STRENGTH_ORDER: readonly DiagnosisEvidenceStrength[] = Object.freeze([
  "STRONG_EVIDENCE",
  "PARTIAL_EVIDENCE",
  "INSUFFICIENT_EVIDENCE",
]);

/**
 * Frozen precedence for candidates that tie on both specificity and strength.
 * This encodes the overlap rulings: RC-002 over RC-001 for C01, RC-009 over
 * RC-010 for C07, RC-013 over RC-010 for C11.
 */
const RULE_PRECEDENCE: readonly RootCauseCode[] = Object.freeze([
  "RC-003",
  "RC-014",
  "RC-013",
  "RC-009",
  "RC-002",
  "RC-001",
  "RC-010",
  "RC-016",
]);

// ============================================================================
// OUTPUT CONTRACT
// ============================================================================

export interface RootCauseCandidateV1 {
  readonly code: RootCauseCode;
  readonly name: RootCauseName;
  readonly strength: DiagnosisEvidenceStrength;
  readonly matchTier: RootCauseMatchTier;
  /** Frozen signal codes that are PRESENT and support this candidate. */
  readonly supportingSignalCodes: readonly DiagnosticSignalCode[];
  /** Frozen signal codes whose ABSENT state weakens, without disproving, this candidate. */
  readonly contradictorySignalCodes: readonly DiagnosticSignalCode[];
  /** Pack gaps behind the UNKNOWN signals this candidate needed. */
  readonly blockingGapCodes: readonly EvidencePackGapCode[];
}

export interface RootCauseClassificationV1 {
  readonly version: typeof ROOT_CAUSE_CLASSIFICATION_VERSION;
  readonly ruleVersion: typeof DIAGNOSIS_RULE_VERSION;
  readonly outputSource: typeof DIAGNOSIS_OUTPUT_SOURCE;
  readonly findingId: string;
  readonly invariantResultId: string;
  readonly selected: RootCauseCandidateV1;
  readonly rankedCandidates: readonly RootCauseCandidateV1[];
  /** The persisted Evidence Pack references, verbatim. Never invented here. */
  readonly evidenceRefs: readonly InvariantResultEvidenceRef[];
}

// ============================================================================
// ERROR MODEL
// ============================================================================

/**
 * Input-contract failures.
 *
 * These are deliberately NOT `RC-016`. `RC-016` is a valid advisory answer
 * about valid inputs whose evidence is insufficient. An error here means the
 * two frozen inputs do not belong together, or the signal set does not match
 * its own frozen contract — a different condition entirely, and one that must
 * fail closed rather than be reported as a diagnosis.
 */
export const ROOT_CAUSE_ERROR_CODES = Object.freeze([
  "DIAGNOSIS_INPUT_IDENTITY_MISMATCH",
  "DIAGNOSIS_INPUT_NOT_FAIL",
  "DIAGNOSIS_SIGNAL_VERSION_UNSUPPORTED",
  "DIAGNOSIS_SIGNAL_SET_INVALID",
] as const);

export type RootCauseErrorCode = (typeof ROOT_CAUSE_ERROR_CODES)[number];

export class RootCauseClassificationError extends Error {
  readonly code: RootCauseErrorCode;

  constructor(code: RootCauseErrorCode, message: string) {
    super(message);
    this.name = "RootCauseClassificationError";
    this.code = code;
  }
}

// ============================================================================
// SIGNAL ACCESS
// ============================================================================

type SignalStates = ReadonlyMap<DiagnosticSignalCode, DiagnosticSignalState>;

type SignalGaps = ReadonlyMap<
  DiagnosticSignalCode,
  readonly EvidencePackGapCode[]
>;

const SIGNAL_ORDER: ReadonlyMap<DiagnosticSignalCode, number> = new Map(
  DIAGNOSTIC_SIGNAL_CODES.map((code, index) => [code, index]),
);

/** Emits signal codes in the frozen vocabulary order, deduplicated. */
function orderedSignals(
  codes: readonly DiagnosticSignalCode[],
): readonly DiagnosticSignalCode[] {
  return [...new Set(codes)].sort(
    (a, b) => (SIGNAL_ORDER.get(a) ?? 0) - (SIGNAL_ORDER.get(b) ?? 0),
  );
}

// ============================================================================
// CANDIDATE RULES
// ============================================================================

/**
 * A rule's verdict before ranking.
 *
 * `relevant` names every signal the rule consulted, so the blocking gaps can
 * be derived from exactly the facts this candidate needed and nothing else.
 */
interface RuleMatch {
  readonly code: RootCauseCode;
  readonly strength: DiagnosisEvidenceStrength;
  readonly matchTier: RootCauseMatchTier;
  readonly supporting: readonly DiagnosticSignalCode[];
  readonly contradictory: readonly DiagnosticSignalCode[];
  readonly relevant: readonly DiagnosticSignalCode[];
}

interface RuleContext {
  readonly scenarioId: string | null;
  readonly invariantId: string;
  readonly state: (code: DiagnosticSignalCode) => DiagnosticSignalState;
}

/**
 * One active rule, declared rather than scattered.
 *
 * `applies` uses ONLY scenario and invariant identity — the two things that
 * may gate whether a rule is in scope. Neither is evidence, and neither can
 * make a signal `PRESENT`.
 *
 * `relevantSignals` names the facts this rule would consult for this
 * particular failure. It is what makes the `RC-016` fallback honest: when no
 * specific cause survives, the gaps reported are those behind the facts an
 * APPLICABLE rule actually needed, never every unestablished signal in the
 * pack. A missing money projection is not why a C03 signature diagnosis could
 * not be reached.
 *
 * `RuleMatch.relevant` is deliberately narrower still: it is what one
 * concrete match needed, so an optional strengthening signal never becomes a
 * blocking gap on an already-proven candidate.
 */
interface RuleDefinition {
  readonly code: RootCauseCode;
  readonly applies: (context: RuleContext) => boolean;
  readonly relevantSignals: (
    context: RuleContext,
  ) => readonly DiagnosticSignalCode[];
  readonly evaluate: (context: RuleContext) => RuleMatch | null;
}

const C01_RC001_INVARIANTS: readonly string[] = Object.freeze([
  "INV-001",
  "INV-002",
  "INV-006",
  "INV-007",
]);

/**
 * RC-002 — MISSING_BUSINESS_IDEMPOTENCY.
 *
 * The defining fact is that ONE logical payment produced more than one
 * protected business effect. Distinct semantic idempotency keys are highly
 * specific ADDITIONAL support, and are deliberately optional: two effects for
 * the same payment is already an idempotency failure whatever the keys say.
 *
 * Because the key signal is optional, its ABSENT state is not a
 * contradiction, its UNKNOWN state does not downgrade an otherwise fully
 * proven candidate, and neither ever becomes a blocking gap here. The only
 * fact that can hold RC-002 at `PARTIAL_EVIDENCE` is unproven same-logical-
 * payment identity, which key evidence cannot substitute for.
 */
const definitionRc002: RuleDefinition = {
  code: "RC-002",
  applies: ({ scenarioId, invariantId }) =>
    scenarioId === "C01" &&
    (invariantId === "INV-002" || invariantId === "INV-007"),
  relevantSignals: () => [
    "DUPLICATE_FULFILMENTS",
    "SAME_LOGICAL_PAYMENT",
    "DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS",
  ],
  evaluate: ({ state }) => {
    const duplicates = state("DUPLICATE_FULFILMENTS");
    const samePayment = state("SAME_LOGICAL_PAYMENT");
    const keys = state("DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS");

    // The duplicates are proven to sit on different payment paths: this is
    // not a business-idempotency failure at all.
    if (samePayment === "ABSENT") return null;
    if (duplicates !== "PRESENT") return null;

    if (samePayment === "PRESENT") {
      const supporting: DiagnosticSignalCode[] = [
        "DUPLICATE_FULFILMENTS",
        "SAME_LOGICAL_PAYMENT",
      ];
      // Optional strengthening: added when proven, silently omitted when
      // absent or unavailable. Never contradictory, never blocking.
      if (keys === "PRESENT") {
        supporting.push("DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS");
      }
      return {
        code: "RC-002",
        strength: "STRONG_EVIDENCE",
        matchTier: "DIRECT_EVIDENCE",
        supporting,
        contradictory: [],
        // Only the two defining facts, both PRESENT, so nothing blocks.
        relevant: ["DUPLICATE_FULFILMENTS", "SAME_LOGICAL_PAYMENT"],
      };
    }

    // samePayment is UNKNOWN: duplicate effects are proven, but whether they
    // belong to one logical payment is not — and that, not the key evidence,
    // is what holds this candidate at PARTIAL.
    return {
      code: "RC-002",
      strength: "PARTIAL_EVIDENCE",
      matchTier: "SCENARIO_INVARIANT_SIGNAL",
      supporting: ["DUPLICATE_FULFILMENTS"],
      contradictory: [],
      relevant: ["DUPLICATE_FULFILMENTS", "SAME_LOGICAL_PAYMENT"],
    };
  },
};

/**
 * RC-001 — MISSING_EVENT_IDEMPOTENCY.
 *
 * C01 deliberately CAUSES repeated delivery, so a raised attempt count is the
 * scenario working as designed — never on its own proof that the merchant's
 * event idempotency is broken. Each accepted case therefore pairs the attempt
 * count with an authoritative invariant failure, or with a proven protected
 * effect of the repetition.
 */
const definitionRc001: RuleDefinition = {
  code: "RC-001",
  applies: ({ scenarioId, invariantId }) =>
    scenarioId === "C01" && C01_RC001_INVARIANTS.includes(invariantId),
  relevantSignals: ({ invariantId }) => {
    // Exactly the facts this invariant's own case would consult.
    if (invariantId === "INV-001") return ["DUPLICATE_EVENT_ATTEMPTS"];
    if (invariantId === "INV-006") {
      return ["DUPLICATE_EVENT_ATTEMPTS", "REPLAY_CHANGED_FINAL_STATE"];
    }
    if (invariantId === "INV-007") {
      return [
        "DUPLICATE_EVENT_ATTEMPTS",
        "DUPLICATE_FULFILMENTS",
        "REPLAY_CHANGED_FINAL_STATE",
      ];
    }
    return ["DUPLICATE_EVENT_ATTEMPTS", "DUPLICATE_FULFILMENTS"];
  },
  evaluate: ({ invariantId, state }) => {
    const attempts = state("DUPLICATE_EVENT_ATTEMPTS");
    if (attempts !== "PRESENT") return null;

    const replayChanged = state("REPLAY_CHANGED_FINAL_STATE");
    const duplicates = state("DUPLICATE_FULFILMENTS");

    // A — the invariant itself proves protected logic ran more than once.
    if (invariantId === "INV-001") {
      return {
        code: "RC-001",
        strength: "STRONG_EVIDENCE",
        matchTier: "DIRECT_EVIDENCE",
        supporting: ["DUPLICATE_EVENT_ATTEMPTS"],
        contradictory: [],
        relevant: ["DUPLICATE_EVENT_ATTEMPTS"],
      };
    }

    // B — repeated processing demonstrably changed protected final state.
    if (invariantId === "INV-006" && replayChanged === "PRESENT") {
      return {
        code: "RC-001",
        strength: "STRONG_EVIDENCE",
        matchTier: "DIRECT_EVIDENCE",
        supporting: ["DUPLICATE_EVENT_ATTEMPTS", "REPLAY_CHANGED_FINAL_STATE"],
        contradictory: [],
        relevant: ["DUPLICATE_EVENT_ATTEMPTS", "REPLAY_CHANGED_FINAL_STATE"],
      };
    }

    // C — repeated processing produced a protected effect or state change.
    if (
      invariantId === "INV-007" &&
      (replayChanged === "PRESENT" || duplicates === "PRESENT")
    ) {
      const supporting: DiagnosticSignalCode[] = ["DUPLICATE_EVENT_ATTEMPTS"];
      if (replayChanged === "PRESENT") {
        supporting.push("REPLAY_CHANGED_FINAL_STATE");
      }
      if (duplicates === "PRESENT") supporting.push("DUPLICATE_FULFILMENTS");
      return {
        code: "RC-001",
        strength: "STRONG_EVIDENCE",
        matchTier: "DIRECT_EVIDENCE",
        supporting,
        contradictory: [],
        relevant: [
          "DUPLICATE_EVENT_ATTEMPTS",
          "DUPLICATE_FULFILMENTS",
          "REPLAY_CHANGED_FINAL_STATE",
        ],
      };
    }

    // D — secondary partial candidate: repeated delivery coincided with a
    // duplicate business effect, but the effect itself is better explained by
    // RC-002 when same-logical-payment evidence exists.
    if (invariantId === "INV-002" && duplicates === "PRESENT") {
      return {
        code: "RC-001",
        strength: "PARTIAL_EVIDENCE",
        matchTier: "SCENARIO_INVARIANT_SIGNAL",
        supporting: ["DUPLICATE_EVENT_ATTEMPTS", "DUPLICATE_FULFILMENTS"],
        contradictory: [],
        relevant: ["DUPLICATE_EVENT_ATTEMPTS", "DUPLICATE_FULFILMENTS"],
      };
    }

    return null;
  },
};

/**
 * RC-003 — INVALID_SIGNATURE_HANDLING.
 *
 * The whole claim is that a rejected signature nevertheless mutated business
 * state. Only the mutation signal establishes that; C03 and INV-005 merely
 * say which failure was being tested.
 */
const definitionRc003: RuleDefinition = {
  code: "RC-003",
  applies: ({ scenarioId, invariantId }) =>
    scenarioId === "C03" &&
    (invariantId === "INV-005" || invariantId === "INV-004"),
  relevantSignals: () => ["INVALID_SIGNATURE_MUTATED_STATE"],
  evaluate: ({ state }) => {
    if (state("INVALID_SIGNATURE_MUTATED_STATE") !== "PRESENT") return null;
    return {
      code: "RC-003",
      strength: "STRONG_EVIDENCE",
      matchTier: "DIRECT_EVIDENCE",
      supporting: ["INVALID_SIGNATURE_MUTATED_STATE"],
      contradictory: [],
      relevant: ["INVALID_SIGNATURE_MUTATED_STATE"],
    };
  },
};

/**
 * RC-009 — CLIENT_CONFIRMATION_DEPENDENCY.
 *
 * The specific pattern is a verified provider capture, an intentionally
 * missing client confirmation, and a merchant that stayed stale — which
 * together show final state depending on the browser callback.
 */
const definitionRc009: RuleDefinition = {
  code: "RC-009",
  applies: ({ scenarioId, invariantId }) =>
    scenarioId === "C07" && invariantId === "INV-011",
  relevantSignals: () => [
    "CLIENT_CONFIRMATION_MISSING",
    "PAYMENT_CAPTURED_VIA_WEBHOOK",
    "CAPTURE_EXISTS_ORDER_NOT_PAID",
  ],
  evaluate: ({ state }) => {
    const clientMissing = state("CLIENT_CONFIRMATION_MISSING");
    const captured = state("PAYMENT_CAPTURED_VIA_WEBHOOK");
    const stale = state("CAPTURE_EXISTS_ORDER_NOT_PAID");
    const relevant: DiagnosticSignalCode[] = [
      "CLIENT_CONFIRMATION_MISSING",
      "PAYMENT_CAPTURED_VIA_WEBHOOK",
      "CAPTURE_EXISTS_ORDER_NOT_PAID",
    ];

    // The order converged despite the missing confirmation: the dependency
    // the candidate asserts is disproved.
    if (stale === "ABSENT") return null;
    if (clientMissing !== "PRESENT" || captured !== "PRESENT") return null;

    if (stale === "PRESENT") {
      return {
        code: "RC-009",
        strength: "STRONG_EVIDENCE",
        matchTier: "DIRECT_EVIDENCE",
        supporting: [
          "CLIENT_CONFIRMATION_MISSING",
          "PAYMENT_CAPTURED_VIA_WEBHOOK",
          "CAPTURE_EXISTS_ORDER_NOT_PAID",
        ],
        contradictory: [],
        relevant,
      };
    }

    // stale is UNKNOWN: the failed INV-011 shows convergence failed, but the
    // exact final merchant state was not established.
    return {
      code: "RC-009",
      strength: "PARTIAL_EVIDENCE",
      matchTier: "SCENARIO_INVARIANT_SIGNAL",
      supporting: [
        "CLIENT_CONFIRMATION_MISSING",
        "PAYMENT_CAPTURED_VIA_WEBHOOK",
      ],
      contradictory: [],
      relevant,
    };
  },
};

/**
 * RC-010 — STALE_PAYMENT_STATE.
 *
 * Scenario-independent: it is about verified newer provider state coexisting
 * with stale merchant state, or protected state running backwards. Both
 * strong patterns are DIRECT evidence of that technical failure — the
 * invariant only gates applicability, while the signals do the proving.
 *
 * RC-009 and RC-013 still outrank it, not because RC-010's evidence is
 * weaker, but because they name WHY the state went stale. That ordering is
 * expressed through the frozen precedence list, never by understating this
 * candidate's evidence tier.
 */
const definitionRc010: RuleDefinition = {
  code: "RC-010",
  applies: ({ invariantId }) => invariantId === "INV-011",
  relevantSignals: () => [
    "PAYMENT_CAPTURED_VIA_WEBHOOK",
    "CAPTURE_EXISTS_ORDER_NOT_PAID",
    "OUT_OF_ORDER_STATE_REGRESSION",
  ],
  evaluate: ({ state }) => {
    const regression = state("OUT_OF_ORDER_STATE_REGRESSION");
    const captured = state("PAYMENT_CAPTURED_VIA_WEBHOOK");
    const stale = state("CAPTURE_EXISTS_ORDER_NOT_PAID");
    const relevant: DiagnosticSignalCode[] = [
      "PAYMENT_CAPTURED_VIA_WEBHOOK",
      "CAPTURE_EXISTS_ORDER_NOT_PAID",
      "OUT_OF_ORDER_STATE_REGRESSION",
    ];

    // A — protected state demonstrably ran backwards.
    if (regression === "PRESENT") {
      const supporting: DiagnosticSignalCode[] = [
        "OUT_OF_ORDER_STATE_REGRESSION",
      ];
      if (captured === "PRESENT") {
        supporting.push("PAYMENT_CAPTURED_VIA_WEBHOOK");
      }
      if (stale === "PRESENT") supporting.push("CAPTURE_EXISTS_ORDER_NOT_PAID");
      return {
        code: "RC-010",
        strength: "STRONG_EVIDENCE",
        matchTier: "DIRECT_EVIDENCE",
        supporting,
        contradictory: [],
        relevant: ["OUT_OF_ORDER_STATE_REGRESSION"],
      };
    }

    // B — verified newer capture evidence alongside a merchant that is not
    // paid.
    if (captured === "PRESENT" && stale === "PRESENT") {
      return {
        code: "RC-010",
        strength: "STRONG_EVIDENCE",
        matchTier: "DIRECT_EVIDENCE",
        supporting: [
          "PAYMENT_CAPTURED_VIA_WEBHOOK",
          "CAPTURE_EXISTS_ORDER_NOT_PAID",
        ],
        contradictory: [],
        relevant: [
          "PAYMENT_CAPTURED_VIA_WEBHOOK",
          "CAPTURE_EXISTS_ORDER_NOT_PAID",
        ],
      };
    }

    // Partial: the capture is verified, but the final merchant state is not.
    if (captured === "PRESENT" && stale === "UNKNOWN") {
      return {
        code: "RC-010",
        strength: "PARTIAL_EVIDENCE",
        matchTier: "PARTIAL_MATCH",
        supporting: ["PAYMENT_CAPTURED_VIA_WEBHOOK"],
        contradictory: [],
        relevant,
      };
    }

    return null;
  },
};

/**
 * RC-013 — PAYMENT_FAILURE_STATE_MAPPING.
 *
 * A verified failure event that nevertheless left the order PAID is direct,
 * unambiguous evidence of failure-state mapping. C11 is the scenario that
 * exercises it, but the signal — not the scenario — is what selects it.
 */
const definitionRc013: RuleDefinition = {
  code: "RC-013",
  applies: ({ invariantId }) =>
    invariantId === "INV-003" || invariantId === "INV-011",
  relevantSignals: () => ["FAILURE_EVENT_MARKED_PAID"],
  evaluate: ({ state }) => {
    if (state("FAILURE_EVENT_MARKED_PAID") !== "PRESENT") return null;
    return {
      code: "RC-013",
      strength: "STRONG_EVIDENCE",
      matchTier: "DIRECT_EVIDENCE",
      supporting: ["FAILURE_EVENT_MARKED_PAID"],
      contradictory: [],
      relevant: ["FAILURE_EVENT_MARKED_PAID"],
    };
  },
};

/**
 * RC-014 — AMOUNT_CURRENCY_MISMATCH.
 *
 * Money disagreement is scenario-independent and needs no fault to explain
 * it: a proven mismatch under the money invariant is direct evidence. Both
 * dimensions may be proven at once, and both are then recorded.
 */
const definitionRc014: RuleDefinition = {
  code: "RC-014",
  applies: ({ invariantId }) => invariantId === "INV-008",
  relevantSignals: () => ["AMOUNT_MISMATCH", "CURRENCY_MISMATCH"],
  evaluate: ({ state }) => {
    const amount = state("AMOUNT_MISMATCH");
    const currency = state("CURRENCY_MISMATCH");
    if (amount !== "PRESENT" && currency !== "PRESENT") return null;

    const supporting: DiagnosticSignalCode[] = [];
    if (amount === "PRESENT") supporting.push("AMOUNT_MISMATCH");
    if (currency === "PRESENT") supporting.push("CURRENCY_MISMATCH");

    return {
      code: "RC-014",
      strength: "STRONG_EVIDENCE",
      matchTier: "DIRECT_EVIDENCE",
      supporting,
      contradictory: [],
      relevant: ["AMOUNT_MISMATCH", "CURRENCY_MISMATCH"],
    };
  },
};

/** Evaluated in a fixed order; ranking, not this order, decides the outcome. */
const RULE_DEFINITIONS: readonly RuleDefinition[] = Object.freeze([
  definitionRc002,
  definitionRc001,
  definitionRc003,
  definitionRc009,
  definitionRc010,
  definitionRc013,
  definitionRc014,
]);

/**
 * The signals an APPLICABLE active rule would have consulted for this
 * failure, in frozen order.
 *
 * This is what keeps the `RC-016` fallback's blocking gaps honest. Phase 4B
 * deliberately made `blockingGapCodes` narrow per signal, and that discipline
 * must survive here: an unestablished money projection is not the reason a
 * C03 signature diagnosis could not be reached, so it must not be reported as
 * one. When no active rule applies at all the set is empty, and the fallback
 * reports no gaps rather than borrowing unrelated ones to look informative.
 */
function relevantFallbackSignals(
  context: RuleContext,
): readonly DiagnosticSignalCode[] {
  const collected: DiagnosticSignalCode[] = [];
  for (const definition of RULE_DEFINITIONS) {
    if (!definition.applies(context)) continue;
    collected.push(...definition.relevantSignals(context));
  }
  return orderedSignals(collected);
}

// ============================================================================
// INPUT INTEGRITY
// ============================================================================

/**
 * Fails closed when the two frozen inputs do not belong together.
 *
 * None of these becomes `RC-016`: a broken input contract is not a statement
 * about evidence, and silently diagnosing it would be exactly the kind of
 * confident-but-unfounded output this design forbids.
 */
function assertInputIntegrity(
  pack: DiagnosisEvidencePackV1,
  signals: DiagnosticSignalSetV1,
): void {
  if (
    pack.finding.findingId !== signals.findingId ||
    pack.finding.invariantResultId !== signals.invariantResultId
  ) {
    throw new RootCauseClassificationError(
      "DIAGNOSIS_INPUT_IDENTITY_MISMATCH",
      "The evidence pack and signal set do not describe the same finding.",
    );
  }

  if (pack.invariant.result !== "FAIL") {
    throw new RootCauseClassificationError(
      "DIAGNOSIS_INPUT_NOT_FAIL",
      "A root cause may only be classified for a failed invariant result.",
    );
  }

  if (signals.version !== DIAGNOSTIC_SIGNAL_VERSION) {
    throw new RootCauseClassificationError(
      "DIAGNOSIS_SIGNAL_VERSION_UNSUPPORTED",
      "The supplied diagnostic signal set uses an unsupported contract version.",
    );
  }

  // Exactly the frozen thirteen, in the frozen order: no missing, duplicate,
  // extra or reordered code. Order matters because a reordered set signals a
  // producer that is not the frozen extractor.
  const observed = signals.signals.map((signal) => signal.code);
  const expected = DIAGNOSTIC_SIGNAL_CODES;
  const matches =
    observed.length === expected.length &&
    observed.every((code, index) => code === expected[index]);
  if (!matches) {
    throw new RootCauseClassificationError(
      "DIAGNOSIS_SIGNAL_SET_INVALID",
      "The supplied diagnostic signal set does not match the frozen signal contract.",
    );
  }
}

// ============================================================================
// RANKING
// ============================================================================

function tierIndex(tier: RootCauseMatchTier): number {
  return MATCH_TIER_ORDER.indexOf(tier);
}

function strengthIndex(strength: DiagnosisEvidenceStrength): number {
  return STRENGTH_ORDER.indexOf(strength);
}

function precedenceIndex(code: RootCauseCode): number {
  const index = RULE_PRECEDENCE.indexOf(code);
  return index === -1 ? RULE_PRECEDENCE.length : index;
}

/**
 * Total, deterministic ordering: evidence specificity, then evidence
 * strength, then frozen rule precedence, then the code itself.
 *
 * The final tiebreak guarantees totality, so the result cannot depend on the
 * input array order or on sort implementation details.
 */
function compareCandidates(
  a: RootCauseCandidateV1,
  b: RootCauseCandidateV1,
): number {
  const byTier = tierIndex(a.matchTier) - tierIndex(b.matchTier);
  if (byTier !== 0) return byTier;

  const byStrength = strengthIndex(a.strength) - strengthIndex(b.strength);
  if (byStrength !== 0) return byStrength;

  const byPrecedence = precedenceIndex(a.code) - precedenceIndex(b.code);
  if (byPrecedence !== 0) return byPrecedence;

  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

// ============================================================================
// CLASSIFICATION
// ============================================================================

function buildCandidate(
  match: RuleMatch,
  gaps: SignalGaps,
  states: SignalStates,
): RootCauseCandidateV1 {
  // Blocking gaps come only from the facts this candidate actually needed and
  // could not establish — never from unrelated UNKNOWN signals.
  const blocking: EvidencePackGapCode[] = [];
  for (const code of orderedSignals(match.relevant)) {
    if (states.get(code) !== "UNKNOWN") continue;
    for (const gap of gaps.get(code) ?? []) {
      if (!blocking.includes(gap)) blocking.push(gap);
    }
  }

  return {
    code: match.code,
    name: rootCauseName(match.code),
    strength: match.strength,
    matchTier: match.matchTier,
    supportingSignalCodes: orderedSignals(match.supporting),
    contradictorySignalCodes: orderedSignals(match.contradictory),
    blockingGapCodes: blocking,
  };
}

function buildFallback(
  context: RuleContext,
  gaps: SignalGaps,
  states: SignalStates,
): RootCauseCandidateV1 {
  // Only the facts an APPLICABLE active rule would have consulted. An
  // unestablished signal that no applicable rule needs is not the reason a
  // specific cause could not be reached, and reporting it as one would undo
  // the narrow per-signal gap discipline Phase 4B established.
  const blocking: EvidencePackGapCode[] = [];
  for (const code of relevantFallbackSignals(context)) {
    if (states.get(code) !== "UNKNOWN") continue;
    for (const gap of gaps.get(code) ?? []) {
      if (!blocking.includes(gap)) blocking.push(gap);
    }
  }

  return {
    code: FALLBACK_ROOT_CAUSE_CODE,
    name: rootCauseName(FALLBACK_ROOT_CAUSE_CODE),
    strength: "INSUFFICIENT_EVIDENCE",
    matchTier: "INSUFFICIENT",
    // No fabricated support. The invariant failure remains proven; only the
    // root cause is not.
    supportingSignalCodes: [],
    contradictorySignalCodes: [],
    blockingGapCodes: blocking,
  };
}

/**
 * Classifies the deterministic root cause for one Finding's frozen inputs.
 *
 * Pure and deterministic: it reads no clock, consults no randomness, mutates
 * neither input, and returns a deep-equal result for identical inputs. It
 * throws only `RootCauseClassificationError`, and only for a broken input
 * contract.
 */
export function classifyRootCause(
  pack: DiagnosisEvidencePackV1,
  signals: DiagnosticSignalSetV1,
): RootCauseClassificationV1 {
  assertInputIntegrity(pack, signals);

  const states = new Map<DiagnosticSignalCode, DiagnosticSignalState>();
  const gaps = new Map<DiagnosticSignalCode, readonly EvidencePackGapCode[]>();
  for (const signal of signals.signals) {
    states.set(signal.code, signal.state);
    gaps.set(signal.code, signal.blockingGapCodes);
  }

  const context: RuleContext = {
    scenarioId: pack.scenario === null ? null : pack.scenario.scenarioId,
    invariantId: pack.invariant.invariantId,
    state: (code) => states.get(code) ?? "UNKNOWN",
  };

  const candidates: RootCauseCandidateV1[] = [];
  for (const definition of RULE_DEFINITIONS) {
    if (!definition.applies(context)) continue;
    const match = definition.evaluate(context);
    if (match === null) continue;
    candidates.push(buildCandidate(match, gaps, states));
  }

  // RC-016 is a fallback, never a competing specific candidate: it appears
  // only when nothing else survived.
  const ranked =
    candidates.length === 0
      ? [buildFallback(context, gaps, states)]
      : [...candidates].sort(compareCandidates);

  const selected = ranked[0];
  // Unreachable: `ranked` always holds at least the fallback.
  if (selected === undefined) throw new Error("no candidate produced");

  return {
    version: ROOT_CAUSE_CLASSIFICATION_VERSION,
    ruleVersion: DIAGNOSIS_RULE_VERSION,
    outputSource: DIAGNOSIS_OUTPUT_SOURCE,
    findingId: signals.findingId,
    invariantResultId: signals.invariantResultId,
    selected,
    rankedCandidates: ranked,
    evidenceRefs: pack.evidenceRefs,
  };
}
