import { describe, expect, it } from "vitest";

import {
  ACTIVE_RECOMMENDATION_ROOT_CAUSE_CODES,
  buildRecommendation,
  RECOMMENDATION_CATALOGUE_VERSION,
  RECOMMENDATION_CODE_VOCABULARY,
  RECOMMENDATION_ERROR_CODES,
  RECOMMENDATION_OUTPUT_SOURCE,
  RECOMMENDATION_OUTPUT_VERSION,
  RECOMMENDATION_TEMPLATE_VERSION,
  RecommendationError,
} from "@/lib/diagnosis/recommendations";
import {
  classifyRootCause,
  ROOT_CAUSE_TAXONOMY,
} from "@/lib/diagnosis/root-cause-classifier";
import type { RootCauseClassificationV1 } from "@/lib/diagnosis/root-cause-classifier";
import {
  DIAGNOSTIC_SIGNAL_CODES,
  DIAGNOSTIC_SIGNAL_VERSION,
} from "@/lib/diagnosis/diagnostic-signals";
import type {
  DiagnosticSignalCode,
  DiagnosticSignalSetV1,
  DiagnosticSignalState,
} from "@/lib/diagnosis/diagnostic-signals";
import type { DiagnosisEvidencePackV1 } from "@/lib/diagnosis/evidence-pack";
import type { ChaosScenarioId } from "@/lib/chaos/types";
import type { InvariantResultInvariantId } from "@/lib/supabase/types";

/**
 * Phase 4D-R1 — pure deterministic recommendation catalogue.
 *
 * The frozen Phase 4C classifier runs for real throughout: fixtures supply an
 * Evidence Pack and signal set, `classifyRootCause` produces the real
 * classification, and the recommendation is built from that. This proves the
 * catalogue against genuine classifier output rather than a hand-made shape.
 */

const FINDING_ID = "55555555-5555-4555-8555-555555555555";
const RESULT_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "11111111-1111-4111-8111-111111111111";

// ---------------------------------------------------------------- fixtures

function signals(
  overrides?: Partial<Record<DiagnosticSignalCode, DiagnosticSignalState>>,
): DiagnosticSignalSetV1 {
  return {
    version: DIAGNOSTIC_SIGNAL_VERSION,
    findingId: FINDING_ID,
    invariantResultId: RESULT_ID,
    signals: DIAGNOSTIC_SIGNAL_CODES.map((code) => ({
      code,
      state: overrides?.[code] ?? "UNKNOWN",
      blockingGapCodes:
        (overrides?.[code] ?? "UNKNOWN") === "UNKNOWN"
          ? (["CHAOS_EVIDENCE_UNAVAILABLE"] as const)
          : [],
    })),
  };
}

function pack(
  invariantId: InvariantResultInvariantId,
  scenarioId: ChaosScenarioId | null,
  overrides?: Partial<DiagnosisEvidencePackV1>,
): DiagnosisEvidencePackV1 {
  return {
    version: 1,
    finding: {
      findingId: FINDING_ID,
      invariantResultId: RESULT_ID,
      status: "OPEN",
      title: `${invariantId} — deterministic evaluator title`,
      createdAt: "2026-08-01T11:00:00.000Z",
    },
    invariant: {
      invariantId,
      invariantVersion: "1",
      result: "FAIL",
      severity: "CRITICAL",
      expectedSummary: "expected wording",
      observedSummary: "observed wording",
      reason: "Deterministic evaluator prose.",
      evaluatedAt: "2026-08-01T10:30:00.000Z",
    },
    correlations: {
      chaosRunId: RUN_ID,
      orderId: null,
      paymentAttemptId: null,
      paymentId: null,
    },
    evidenceRefs: [{ kind: "CHAOS_RUN", id: RUN_ID }],
    scenario:
      scenarioId === null
        ? null
        : {
            scenarioId,
            faultType: "REPLAY_EVENT",
            dataClassification: "SYNTHETIC_DEMO",
            status: "COMPLETED",
            outcome: "FAIL",
            startedAt: "2026-08-01T10:00:00.000Z",
            completedAt: "2026-08-01T10:05:00.000Z",
          },
    provenance: null,
    processing: [],
    counts: null,
    money: null,
    capture: null,
    scenarioEvidence: null,
    gaps: [],
    ...overrides,
  };
}

/** Runs the real frozen classifier, then the recommendation catalogue. */
function recommend(
  invariantId: InvariantResultInvariantId,
  scenarioId: ChaosScenarioId | null,
  states?: Partial<Record<DiagnosticSignalCode, DiagnosticSignalState>>,
  packOverrides?: Partial<DiagnosisEvidencePackV1>,
) {
  const evidencePack = pack(invariantId, scenarioId, packOverrides);
  const classification = classifyRootCause(evidencePack, signals(states));
  return buildRecommendation(evidencePack, classification);
}

/** A real classification, for tests that need to tamper with the inputs. */
function classificationFor(
  invariantId: InvariantResultInvariantId,
  scenarioId: ChaosScenarioId | null,
  states?: Partial<Record<DiagnosticSignalCode, DiagnosticSignalState>>,
): RootCauseClassificationV1 {
  return classifyRootCause(pack(invariantId, scenarioId), signals(states));
}

/**
 * Replaces the winning candidate COHERENTLY — both `selected` and
 * `rankedCandidates[0]` — so the classification stays internally consistent.
 * Used to reach checks that live beyond the selection-integrity gate.
 */
function withWinner(
  base: RootCauseClassificationV1,
  overrides: Record<string, unknown>,
): RootCauseClassificationV1 {
  const winner = { ...base.selected, ...overrides };
  return {
    ...base,
    selected: winner,
    rankedCandidates: [winner, ...base.rankedCandidates.slice(1)],
  } as unknown as RootCauseClassificationV1;
}

/** The frozen taxonomy name for a code, read from the frozen classifier. */
function frozenName(code: string): string {
  const entry = ROOT_CAUSE_TAXONOMY.find((item) => item.code === code);
  if (entry === undefined) throw new Error(`unknown code ${code}`);
  return entry.name;
}

// C01 duplicate-fulfilment evidence that selects RC-002 STRONG.
const RC002_STRONG = {
  DUPLICATE_FULFILMENTS: "PRESENT",
  SAME_LOGICAL_PAYMENT: "PRESENT",
} as const;

// ============================================================================
// CATALOGUE / VOCABULARY
// ============================================================================

describe("Phase 4D-R1 — catalogue and vocabulary", () => {
  it("1: the output version is the frozen 1", () => {
    expect(RECOMMENDATION_OUTPUT_VERSION).toBe(1);
    expect(recommend("INV-005", "C03").version).toBe(1);
  });

  it("2: the catalogue version is exact", () => {
    expect(RECOMMENDATION_CATALOGUE_VERSION).toBe(
      "RECOMMENDATION-CATALOGUE-V1",
    );
    expect(recommend("INV-005", "C03").catalogueVersion).toBe(
      "RECOMMENDATION-CATALOGUE-V1",
    );
  });

  it("2b: the template version is the frozen TEMPLATE-V1", () => {
    expect(RECOMMENDATION_TEMPLATE_VERSION).toBe("TEMPLATE-V1");
    // Provenance travels on every generated recommendation.
    expect(recommend("INV-005", "C03").templateVersion).toBe("TEMPLATE-V1");
    expect(recommend("INV-002", "C01", RC002_STRONG).templateVersion).toBe(
      "TEMPLATE-V1",
    );
  });

  it("3: the output source is DETERMINISTIC_CATALOGUE, never a model name", () => {
    expect(RECOMMENDATION_OUTPUT_SOURCE).toBe("DETERMINISTIC_CATALOGUE");
    expect(recommend("INV-005", "C03").outputSource).toBe(
      "DETERMINISTIC_CATALOGUE",
    );
  });

  it("4: exactly the fourteen unique approved recommendation codes exist", () => {
    expect([...RECOMMENDATION_CODE_VOCABULARY]).toEqual([
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
    ]);
    expect(RECOMMENDATION_CODE_VOCABULARY).toHaveLength(14);
    expect(new Set(RECOMMENDATION_CODE_VOCABULARY).size).toBe(14);
  });

  it("5: every emitted code belongs to the frozen vocabulary", () => {
    const emitted = [
      recommend("INV-001", "C01", { DUPLICATE_EVENT_ATTEMPTS: "PRESENT" }),
      recommend("INV-002", "C01", RC002_STRONG),
      recommend("INV-005", "C03", {
        INVALID_SIGNATURE_MUTATED_STATE: "PRESENT",
      }),
      recommend("INV-011", "C07", {
        CLIENT_CONFIRMATION_MISSING: "PRESENT",
        PAYMENT_CAPTURED_VIA_WEBHOOK: "PRESENT",
        CAPTURE_EXISTS_ORDER_NOT_PAID: "PRESENT",
      }),
      recommend("INV-011", null, { OUT_OF_ORDER_STATE_REGRESSION: "PRESENT" }),
      recommend("INV-003", "C11", { FAILURE_EVENT_MARKED_PAID: "PRESENT" }),
      recommend("INV-008", null, { AMOUNT_MISMATCH: "PRESENT" }),
      recommend("INV-005", "C03"),
    ];
    for (const result of emitted) {
      expect(
        RECOMMENDATION_CODE_VOCABULARY,
        result.recommendation.code,
      ).toContain(result.recommendation.code);
    }
  });

  it("6: exactly eight executable root-cause outcomes are declared", () => {
    expect([...ACTIVE_RECOMMENDATION_ROOT_CAUSE_CODES]).toEqual([
      "RC-001",
      "RC-002",
      "RC-003",
      "RC-009",
      "RC-010",
      "RC-013",
      "RC-014",
      "RC-016",
    ]);
    expect(ACTIVE_RECOMMENDATION_ROOT_CAUSE_CODES).toHaveLength(8);
  });

  it("7: an inactive root cause is rejected, never guessed", () => {
    const base = classificationFor("INV-005", "C03");
    for (const code of [
      "RC-004",
      "RC-005",
      "RC-006",
      "RC-007",
      "RC-008",
      "RC-011",
      "RC-012",
      "RC-015",
    ] as const) {
      // Substituted COHERENTLY, so this reaches the active-set check rather
      // than tripping the selection-integrity gate first.
      const tampered = withWinner(base, {
        code,
        name: frozenName(code),
        strength: "STRONG_EVIDENCE",
        matchTier: "DIRECT_EVIDENCE",
      });
      expect(
        () => buildRecommendation(pack("INV-005", "C03"), tampered),
        code,
      ).toThrow(RecommendationError);
    }
  });

  it("7b: the error vocabulary is exactly the nine approved codes", () => {
    expect([...RECOMMENDATION_ERROR_CODES]).toEqual([
      "RECOMMENDATION_INPUT_IDENTITY_MISMATCH",
      "RECOMMENDATION_INPUT_NOT_FAIL",
      "RECOMMENDATION_CLASSIFICATION_VERSION_UNSUPPORTED",
      "RECOMMENDATION_RULE_VERSION_UNSUPPORTED",
      "RECOMMENDATION_CLASSIFICATION_SOURCE_UNSUPPORTED",
      "RECOMMENDATION_EVIDENCE_REF_MISMATCH",
      "RECOMMENDATION_CLASSIFICATION_SELECTION_INVALID",
      "RECOMMENDATION_ROOT_CAUSE_UNSUPPORTED",
      "RECOMMENDATION_RC010_PATTERN_UNSUPPORTED",
    ]);
    expect(RECOMMENDATION_ERROR_CODES).toHaveLength(9);
  });
});

// ============================================================================
// INPUT INTEGRITY
// ============================================================================

describe("Phase 4D-R1 — input integrity", () => {
  function expectCode(fn: () => unknown, code: string): void {
    try {
      fn();
      throw new Error("expected throw");
    } catch (error) {
      expect((error as RecommendationError).code, code).toBe(code);
    }
  }

  it("8: a finding identity mismatch is a typed error", () => {
    const base = classificationFor("INV-005", "C03");
    const tampered = {
      ...base,
      findingId: RUN_ID,
    } as unknown as RootCauseClassificationV1;
    expectCode(
      () => buildRecommendation(pack("INV-005", "C03"), tampered),
      "RECOMMENDATION_INPUT_IDENTITY_MISMATCH",
    );
  });

  it("9: an invariant-result identity mismatch is a typed error", () => {
    const base = classificationFor("INV-005", "C03");
    const tampered = {
      ...base,
      invariantResultId: RUN_ID,
    } as unknown as RootCauseClassificationV1;
    expectCode(
      () => buildRecommendation(pack("INV-005", "C03"), tampered),
      "RECOMMENDATION_INPUT_IDENTITY_MISMATCH",
    );
  });

  it("10: a non-FAIL pack is rejected", () => {
    const base = pack("INV-005", "C03");
    const notFail = {
      ...base,
      invariant: { ...base.invariant, result: "PASS" },
    } as unknown as DiagnosisEvidencePackV1;
    expectCode(
      () => buildRecommendation(notFail, classificationFor("INV-005", "C03")),
      "RECOMMENDATION_INPUT_NOT_FAIL",
    );
  });

  it("11: an unsupported classification version is rejected", () => {
    const base = classificationFor("INV-005", "C03");
    const tampered = {
      ...base,
      version: 2,
    } as unknown as RootCauseClassificationV1;
    expectCode(
      () => buildRecommendation(pack("INV-005", "C03"), tampered),
      "RECOMMENDATION_CLASSIFICATION_VERSION_UNSUPPORTED",
    );
  });

  it("12: an unsupported diagnosis rule version is rejected", () => {
    const base = classificationFor("INV-005", "C03");
    const tampered = {
      ...base,
      ruleVersion: "DIAG-RULES-V2",
    } as unknown as RootCauseClassificationV1;
    expectCode(
      () => buildRecommendation(pack("INV-005", "C03"), tampered),
      "RECOMMENDATION_RULE_VERSION_UNSUPPORTED",
    );
  });

  it("13: an unsupported classification source is rejected", () => {
    const base = classificationFor("INV-005", "C03");
    const tampered = {
      ...base,
      outputSource: "LLM_ASSISTED",
    } as unknown as RootCauseClassificationV1;
    expectCode(
      () => buildRecommendation(pack("INV-005", "C03"), tampered),
      "RECOMMENDATION_CLASSIFICATION_SOURCE_UNSUPPORTED",
    );
  });

  it("14: mismatched evidence references are rejected", () => {
    const base = classificationFor("INV-005", "C03");
    const tampered = {
      ...base,
      evidenceRefs: [{ kind: "CHAOS_RUN", id: FINDING_ID }],
    } as unknown as RootCauseClassificationV1;
    expectCode(
      () => buildRecommendation(pack("INV-005", "C03"), tampered),
      "RECOMMENDATION_EVIDENCE_REF_MISMATCH",
    );
  });

  it("15: an inactive root-cause code is a typed unsupported error", () => {
    const base = classificationFor("INV-005", "C03");
    const tampered = withWinner(base, {
      code: "RC-011",
      name: frozenName("RC-011"),
      strength: "STRONG_EVIDENCE",
      matchTier: "DIRECT_EVIDENCE",
    });
    expectCode(
      () => buildRecommendation(pack("INV-005", "C03"), tampered),
      "RECOMMENDATION_ROOT_CAUSE_UNSUPPORTED",
    );
  });

  it("15b: no integrity error is ever answered with INVESTIGATE-EVIDENCE-GAP", () => {
    const base = classificationFor("INV-005", "C03");
    const tampered = {
      ...base,
      ruleVersion: "DIAG-RULES-V2",
    } as unknown as RootCauseClassificationV1;
    let resolved: unknown = "did-not-resolve";
    try {
      resolved = buildRecommendation(pack("INV-005", "C03"), tampered);
    } catch {
      resolved = "threw";
    }
    expect(resolved).toBe("threw");
  });
});

// ============================================================================
// RC-001
// ============================================================================

describe("Phase 4D-R1 — RC-001", () => {
  it("16: maps to FIX-IDEMPOTENCY", () => {
    const result = recommend("INV-001", "C01", {
      DUPLICATE_EVENT_ATTEMPTS: "PRESENT",
    });
    expect(result.diagnosis.rootCauseCode).toBe("RC-001");
    expect(result.recommendation.code).toBe("FIX-IDEMPOTENCY");
  });

  it("17: the remediation text is deterministic and states the principle", () => {
    const first = recommend("INV-001", "C01", {
      DUPLICATE_EVENT_ATTEMPTS: "PRESENT",
    });
    const second = recommend("INV-001", "C01", {
      DUPLICATE_EVENT_ATTEMPTS: "PRESENT",
    });
    expect(second.recommendation.text).toBe(first.recommendation.text);
    expect(first.recommendation.text).toContain("canonical event identity");
    expect(first.recommendation.text).toContain(
      "replayed delivery must be safe",
    );
  });

  it("18: partial evidence keeps the same code with cautious wording", () => {
    // C01 + INV-002 + duplicate attempts and effects yields RC-001 as a
    // PARTIAL secondary candidate; RC-002 outranks it, so drive RC-001 to
    // partial directly through the classifier's own output.
    const base = classificationFor("INV-002", "C01", {
      DUPLICATE_EVENT_ATTEMPTS: "PRESENT",
      DUPLICATE_FULFILMENTS: "PRESENT",
    });
    const rc001 = base.rankedCandidates.find((c) => c.code === "RC-001")!;
    expect(rc001.strength).toBe("PARTIAL_EVIDENCE");

    // Promoted COHERENTLY — selected AND the ranked winner — so this exercises
    // the partial-wording path rather than the selection-integrity gate.
    const partial = {
      ...base,
      selected: rc001,
      rankedCandidates: [
        rc001,
        ...base.rankedCandidates.filter((c) => c.code !== "RC-001"),
      ],
    } as unknown as RootCauseClassificationV1;
    const result = buildRecommendation(pack("INV-002", "C01"), partial);

    expect(result.recommendation.code).toBe("FIX-IDEMPOTENCY");
    expect(result.explanation.uncertainty).toContain("partial");
    expect(result.explanation.uncertainty).toContain(
      "before making invasive changes",
    );
  });
});

// ============================================================================
// RC-002
// ============================================================================

describe("Phase 4D-R1 — RC-002", () => {
  it("19: maps to FIX-BUSINESS-IDEMPOTENCY", () => {
    const result = recommend("INV-002", "C01", RC002_STRONG);
    expect(result.diagnosis.rootCauseCode).toBe("RC-002");
    expect(result.recommendation.code).toBe("FIX-BUSINESS-IDEMPOTENCY");
    expect(result.diagnosis.strength).toBe("STRONG_EVIDENCE");
  });

  it("20: strong wording never blames the provider for duplicating a payment", () => {
    const result = recommend("INV-002", "C01", RC002_STRONG);
    const prose = JSON.stringify(result);
    expect(prose.toLowerCase()).not.toContain("razorpay duplicated");
    expect(prose.toLowerCase()).not.toContain("razorpay failed");
    expect(result.explanation.inference).toContain(
      "rather than a payment-provider failure",
    );
  });

  it("21: partial evidence reports the remaining uncertainty", () => {
    const result = recommend("INV-002", "C01", {
      DUPLICATE_FULFILMENTS: "PRESENT",
    });
    expect(result.diagnosis.rootCauseCode).toBe("RC-002");
    expect(result.diagnosis.strength).toBe("PARTIAL_EVIDENCE");
    expect(result.explanation.uncertainty).not.toBeNull();
    expect(result.explanation.uncertainty).toContain("partial");
  });

  it("22: the text carries the semantic business-idempotency principle", () => {
    const text = recommend("INV-002", "C01", RC002_STRONG).recommendation.text;
    expect(text).toContain("semantic idempotency boundary");
    expect(text).toContain("FULFIL_ORDER");
    expect(text).toContain("Do not derive business-effect idempotency from");
    expect(text).toContain("processing-attempt identity");
  });
});

// ============================================================================
// RC-003
// ============================================================================

describe("Phase 4D-R1 — RC-003", () => {
  const c03 = { INVALID_SIGNATURE_MUTATED_STATE: "PRESENT" } as const;

  it("23: maps to FIX-WEBHOOK-AUTH", () => {
    const result = recommend("INV-005", "C03", c03);
    expect(result.diagnosis.rootCauseCode).toBe("RC-003");
    expect(result.recommendation.code).toBe("FIX-WEBHOOK-AUTH");
  });

  it("24: the observed wording identifies a controlled invalid-signature test", () => {
    const result = recommend("INV-005", "C03", c03);
    expect(result.explanation.observedEvidence).toContain(
      "The controlled invalid-signature test observed business-state mutation.",
    );
  });

  it("25: it never says the provider sent an invalid webhook", () => {
    const prose = JSON.stringify(recommend("INV-005", "C03", c03));
    for (const forbidden of [
      "Razorpay sent",
      "Razorpay delivered",
      "Razorpay duplicated",
      "Razorpay failed",
    ]) {
      expect(prose, forbidden).not.toContain(forbidden);
    }
  });

  it("25b: the text keeps verification server-side and effect-free", () => {
    const text = recommend("INV-005", "C03", c03).recommendation.text;
    expect(text).toContain("before any trusted processing");
    expect(text).toContain("raw-body signature verification server-side");
    expect(text).toContain("zero business effect");
  });
});

// ============================================================================
// RC-009
// ============================================================================

describe("Phase 4D-R1 — RC-009", () => {
  const triple = {
    CLIENT_CONFIRMATION_MISSING: "PRESENT",
    PAYMENT_CAPTURED_VIA_WEBHOOK: "PRESENT",
    CAPTURE_EXISTS_ORDER_NOT_PAID: "PRESENT",
  } as const;

  it("26: maps to FIX-CLIENT-INDEPENDENCE", () => {
    const result = recommend("INV-011", "C07", triple);
    expect(result.diagnosis.rootCauseCode).toBe("RC-009");
    expect(result.recommendation.code).toBe("FIX-CLIENT-INDEPENDENCE");
  });

  it("27: it states the browser callback is not payment truth", () => {
    const text = recommend("INV-011", "C07", triple).recommendation.text;
    expect(text).toContain("must not depend on the browser success callback");
    expect(text).toContain("never be required for payment truth");
  });

  it("28: it preserves server/webhook reconciliation authority", () => {
    const text = recommend("INV-011", "C07", triple).recommendation.text;
    expect(text).toContain("server-side and webhook reconciliation");
  });
});

// ============================================================================
// RC-010
// ============================================================================

describe("Phase 4D-R1 — RC-010 deterministic disambiguation", () => {
  it("29: regression support maps to FIX-STATE-MACHINE", () => {
    const result = recommend("INV-011", null, {
      OUT_OF_ORDER_STATE_REGRESSION: "PRESENT",
    });
    expect(result.diagnosis.rootCauseCode).toBe("RC-010");
    expect(result.recommendation.code).toBe("FIX-STATE-MACHINE");
  });

  it("30: capture + stale support maps to FIX-RECONCILIATION", () => {
    const result = recommend("INV-011", null, {
      PAYMENT_CAPTURED_VIA_WEBHOOK: "PRESENT",
      CAPTURE_EXISTS_ORDER_NOT_PAID: "PRESENT",
    });
    expect(result.diagnosis.rootCauseCode).toBe("RC-010");
    expect(result.recommendation.code).toBe("FIX-RECONCILIATION");
  });

  it("31: regression outranks reconciliation when both patterns exist", () => {
    const result = recommend("INV-011", null, {
      OUT_OF_ORDER_STATE_REGRESSION: "PRESENT",
      PAYMENT_CAPTURED_VIA_WEBHOOK: "PRESENT",
      CAPTURE_EXISTS_ORDER_NOT_PAID: "PRESENT",
    });
    expect(result.recommendation.code).toBe("FIX-STATE-MACHINE");
  });

  it("32: partial capture with unknown stale state is cautious reconciliation", () => {
    const result = recommend("INV-011", null, {
      PAYMENT_CAPTURED_VIA_WEBHOOK: "PRESENT",
    });
    expect(result.diagnosis.rootCauseCode).toBe("RC-010");
    expect(result.diagnosis.strength).toBe("PARTIAL_EVIDENCE");
    expect(result.recommendation.code).toBe("FIX-RECONCILIATION");
    expect(result.explanation.uncertainty).toContain("partial");
    // The stale-state fact is NOT claimed as observed.
    expect(result.explanation.observedEvidence).not.toContain(
      "Captured payment evidence existed while merchant order state was not PAID.",
    );
  });

  it("33: an unsupported RC-010 shape is a typed error, never a default", () => {
    const base = classificationFor("INV-011", null, {
      OUT_OF_ORDER_STATE_REGRESSION: "PRESENT",
    });
    const stripped = withWinner(base, { supportingSignalCodes: [] });
    try {
      buildRecommendation(pack("INV-011", null), stripped);
      throw new Error("expected throw");
    } catch (error) {
      expect((error as RecommendationError).code).toBe(
        "RECOMMENDATION_RC010_PATTERN_UNSUPPORTED",
      );
    }
  });

  it("34: the state-machine recommendation never invents a provider failure", () => {
    const prose = JSON.stringify(
      recommend("INV-011", null, { OUT_OF_ORDER_STATE_REGRESSION: "PRESENT" }),
    );
    expect(prose).not.toContain("Razorpay");
    expect(prose.toLowerCase()).not.toContain("provider failed");
  });

  it("35: the reconciliation recommendation never trusts browser state", () => {
    const text = recommend("INV-011", null, {
      PAYMENT_CAPTURED_VIA_WEBHOOK: "PRESENT",
      CAPTURE_EXISTS_ORDER_NOT_PAID: "PRESENT",
    }).recommendation.text;
    expect(text).toContain("never trust a browser-supplied claim");
    expect(text).toContain("authoritative verified evidence");
  });
});

// ============================================================================
// RC-013
// ============================================================================

describe("Phase 4D-R1 — RC-013", () => {
  const c11 = { FAILURE_EVENT_MARKED_PAID: "PRESENT" } as const;

  it("36: maps to FIX-PAYMENT-FAILURE-GUARD", () => {
    const result = recommend("INV-003", "C11", c11);
    expect(result.diagnosis.rootCauseCode).toBe("RC-013");
    expect(result.recommendation.code).toBe("FIX-PAYMENT-FAILURE-GUARD");
  });

  it("37: exactly one recommendation code is emitted", () => {
    const result = recommend("INV-003", "C11", c11);
    expect(typeof result.recommendation.code).toBe("string");
    expect(result.recommendation.code).not.toBe("FIX-STATE-MACHINE");
    expect(JSON.stringify(result)).not.toContain("FIX-STATE-MACHINE");
  });

  it("38: the text may still mention legal state-machine convergence", () => {
    const text = recommend("INV-003", "C11", c11).recommendation.text;
    expect(text).toContain("never mark the merchant order PAID");
    expect(text).toContain("legal state-machine convergence");
  });

  it("39: the failure evidence remains the supported observed fact", () => {
    const result = recommend("INV-003", "C11", c11);
    expect(result.explanation.observedEvidence).toEqual([
      "Verified failure evidence was associated with merchant PAID state.",
    ]);
  });
});

// ============================================================================
// RC-014
// ============================================================================

describe("Phase 4D-R1 — RC-014", () => {
  it("40: maps to FIX-AMOUNT-CURRENCY-VALIDATION", () => {
    const result = recommend("INV-008", null, { AMOUNT_MISMATCH: "PRESENT" });
    expect(result.diagnosis.rootCauseCode).toBe("RC-014");
    expect(result.recommendation.code).toBe("FIX-AMOUNT-CURRENCY-VALIDATION");
  });

  it("41: amount-mismatch support produces the safe observed sentence", () => {
    const result = recommend("INV-008", null, { AMOUNT_MISMATCH: "PRESENT" });
    expect(result.explanation.observedEvidence).toEqual([
      "Amount values disagreed across the relevant payment records.",
    ]);
  });

  it("42: currency-mismatch support produces the safe observed sentence", () => {
    const result = recommend("INV-008", null, { CURRENCY_MISMATCH: "PRESENT" });
    expect(result.explanation.observedEvidence).toEqual([
      "Currency values disagreed across the relevant payment records.",
    ]);
  });

  it("43: both mismatches remain deterministic and ordered", () => {
    const states = {
      AMOUNT_MISMATCH: "PRESENT",
      CURRENCY_MISMATCH: "PRESENT",
    } as const;
    const first = recommend("INV-008", null, states);
    const second = recommend("INV-008", null, states);
    expect(second).toEqual(first);
    expect(first.explanation.observedEvidence).toEqual([
      "Amount values disagreed across the relevant payment records.",
      "Currency values disagreed across the relevant payment records.",
    ]);
  });

  it("44: it never recalculates or asserts an authoritative money value", () => {
    const result = recommend("INV-008", null, { AMOUNT_MISMATCH: "PRESENT" });
    expect(result.recommendation.text).toContain(
      "Never recompute money from a formatted display string",
    );
    // No money VALUE and no money field is emitted. Digit runs are not banned
    // outright: the persisted evidence-reference UUIDs legitimately contain
    // them, and those must travel verbatim.
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "amountSubunits",
      "amount_subunits",
      "expectedAmount",
      "observedAmount",
      "currency:",
      "INR",
      "₹",
      "$",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    // No decimal money literal, and no bare integer outside a UUID.
    expect(serialized).not.toMatch(/\d+\.\d{2}\b/);
  });
});

// ============================================================================
// RC-016
// ============================================================================

describe("Phase 4D-R1 — RC-016", () => {
  it("45: maps to INVESTIGATE-EVIDENCE-GAP", () => {
    const result = recommend("INV-005", "C03");
    expect(result.diagnosis.rootCauseCode).toBe("RC-016");
    expect(result.recommendation.code).toBe("INVESTIGATE-EVIDENCE-GAP");
  });

  it("46: the INSUFFICIENT_EVIDENCE strength is preserved", () => {
    const result = recommend("INV-005", "C03");
    expect(result.diagnosis.strength).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.diagnosis.matchTier).toBe("INSUFFICIENT");
  });

  it("47: the text says the invariant failed but the cause is unproven", () => {
    const result = recommend("INV-005", "C03");
    expect(result.recommendation.text).toContain(
      "The invariant failure is proven, but a specific technical root cause is not.",
    );
    expect(result.explanation.uncertainty).toContain(
      "does not safely prove a specific technical root cause",
    );
  });

  it("48: no speculative FIX-* recommendation is offered", () => {
    const serialized = JSON.stringify(recommend("INV-005", "C03"));
    for (const forbidden of [
      "FIX-IDEMPOTENCY",
      "FIX-BUSINESS-IDEMPOTENCY",
      "FIX-WEBHOOK-AUTH",
      "FIX-STATE-MACHINE",
      "FIX-RECONCILIATION",
      "FIX-CLIENT-INDEPENDENCE",
      "FIX-PAYMENT-FAILURE-GUARD",
      "FIX-AMOUNT-CURRENCY-VALIDATION",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it("49: the blocking gaps remain visible on the output", () => {
    const result = recommend("INV-005", "C03");
    expect(result.blockingGapCodes.length).toBeGreaterThan(0);
    expect(new Set(result.blockingGapCodes).size).toBe(
      result.blockingGapCodes.length,
    );
  });

  it("50: no missing value is invented as an observation", () => {
    const result = recommend("INV-005", "C03");
    expect(result.explanation.observedEvidence).toEqual([]);
    expect(result.explanation.diagnosisSummary).toContain(
      "No supporting structured signal could be established.",
    );
  });
});

// ============================================================================
// EXPLANATION SAFETY
// ============================================================================

describe("Phase 4D-R1 — explanation safety", () => {
  it("51: every observed sentence maps to a selected supporting signal", () => {
    const result = recommend("INV-002", "C01", {
      DUPLICATE_FULFILMENTS: "PRESENT",
      SAME_LOGICAL_PAYMENT: "PRESENT",
      DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS: "PRESENT",
    });
    expect(result.explanation.observedEvidence).toHaveLength(
      result.supportingSignalCodes.length,
    );
    expect(result.explanation.observedEvidence).toEqual([
      "More than one fulfilment/business-effect record was observed in the relevant order context.",
      "Equivalent fulfilment effects used different idempotency keys.",
      "The duplicate business effects were correlated to the same logical payment.",
    ]);
  });

  it("52: an UNKNOWN signal never becomes an observed fact", () => {
    const result = recommend("INV-002", "C01", RC002_STRONG);
    // The key signal is UNKNOWN here and must not appear.
    expect(result.explanation.observedEvidence).not.toContain(
      "Equivalent fulfilment effects used different idempotency keys.",
    );
  });

  it("53: an ABSENT signal never becomes an observed fact", () => {
    const result = recommend("INV-002", "C01", {
      ...RC002_STRONG,
      DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS: "ABSENT",
    });
    expect(result.explanation.observedEvidence).not.toContain(
      "Equivalent fulfilment effects used different idempotency keys.",
    );
  });

  it("54-57: evaluator prose and Finding title never change the recommendation", () => {
    const plain = pack("INV-002", "C01");
    const shouty = pack("INV-002", "C01", {
      finding: {
        ...plain.finding,
        title: "CATASTROPHIC RAZORPAY DUPLICATED THE PAYMENT AND LOST MONEY",
      },
      invariant: {
        ...plain.invariant,
        expectedSummary: "razorpay failed and the provider duplicated delivery",
        observedSummary: "RC-008 DATABASE_PARTIAL_FAILURE definitely happened",
        reason: "recommend FIX-TRANSACTION-ATOMICITY immediately",
      },
    });
    const structured = signals(RC002_STRONG);

    const fromPlain = buildRecommendation(
      plain,
      classifyRootCause(plain, structured),
    );
    const fromShouty = buildRecommendation(
      shouty,
      classifyRootCause(shouty, structured),
    );

    expect(fromShouty).toEqual(fromPlain);
    expect(JSON.stringify(fromShouty)).not.toContain("Razorpay");
    expect(JSON.stringify(fromShouty)).not.toContain("RC-008");
  });

  it("58: replay wording says PayChaos replay, not a provider delivery", () => {
    const result = recommend("INV-006", "C01", {
      DUPLICATE_EVENT_ATTEMPTS: "PRESENT",
      REPLAY_CHANGED_FINAL_STATE: "PRESENT",
    });
    expect(result.explanation.observedEvidence).toContain(
      "A PayChaos replay changed protected final merchant state.",
    );
    expect(JSON.stringify(result)).not.toContain("Razorpay");
  });

  it("59: controlled-fault wording never blames the provider", () => {
    const c07 = recommend("INV-011", "C07", {
      CLIENT_CONFIRMATION_MISSING: "PRESENT",
      PAYMENT_CAPTURED_VIA_WEBHOOK: "PRESENT",
      CAPTURE_EXISTS_ORDER_NOT_PAID: "PRESENT",
    });
    expect(c07.explanation.observedEvidence).toContain(
      "Client confirmation was intentionally absent in the controlled test.",
    );
    expect(JSON.stringify(c07)).not.toContain("Razorpay");
  });

  it("60: no secret or raw evidence field appears", () => {
    const serialized = JSON.stringify(
      recommend("INV-002", "C01", RC002_STRONG),
    );
    for (const forbidden of [
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
      "service_role",
      "fault_config",
      "fault_state",
      "raw_payload_redacted",
      "raw_body_sha256",
      "normalized_event",
      "x-razorpay-signature",
      "eyJ",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    expect(serialized).not.toMatch(/[A-Fa-f0-9]{40,}/);
  });

  it("61: evidence references are preserved verbatim", () => {
    const evidencePack = pack("INV-002", "C01");
    const result = buildRecommendation(
      evidencePack,
      classifyRootCause(evidencePack, signals(RC002_STRONG)),
    );
    expect(result.evidenceRefs).toEqual(evidencePack.evidenceRefs);
    expect(result.evidenceRefs).toEqual([{ kind: "CHAOS_RUN", id: RUN_ID }]);
  });

  it("61b: the diagnosis summary is concise and names the failed invariant", () => {
    const summary = recommend("INV-002", "C01", RC002_STRONG).explanation
      .diagnosisSummary;
    expect(summary).toContain("INV-002 failed");
    expect(summary).toContain("RC-002");
    expect(summary).toContain("STRONG_EVIDENCE");
    expect(summary).toContain("Recommended action:");
    expect(summary.length).toBeLessThan(1200);
  });
});

// ============================================================================
// REGRESSION RECOMMENDATION
// ============================================================================

describe("Phase 4D-R1 — advisory regression recommendation", () => {
  const SCENARIO_CASES = [
    ["C01", "INV-002", RC002_STRONG],
    ["C03", "INV-005", { INVALID_SIGNATURE_MUTATED_STATE: "PRESENT" }],
    [
      "C07",
      "INV-011",
      {
        CLIENT_CONFIRMATION_MISSING: "PRESENT",
        PAYMENT_CAPTURED_VIA_WEBHOOK: "PRESENT",
        CAPTURE_EXISTS_ORDER_NOT_PAID: "PRESENT",
      },
    ],
    ["C11", "INV-003", { FAILURE_EVENT_MARKED_PAID: "PRESENT" }],
  ] as const;

  function forCase(index: number) {
    const [scenarioId, invariantId, states] = SCENARIO_CASES[index]!;
    return recommend(
      invariantId as InvariantResultInvariantId,
      scenarioId as ChaosScenarioId,
      states as Partial<Record<DiagnosticSignalCode, DiagnosticSignalState>>,
    );
  }

  it("62-65: each approved scenario recommends rerunning itself", () => {
    for (let index = 0; index < SCENARIO_CASES.length; index += 1) {
      const [scenarioId] = SCENARIO_CASES[index]!;
      const regression = forCase(index).regressionRecommendation;
      expect(regression.scenarioId, scenarioId).toBe(scenarioId);
      expect(regression.action, scenarioId).toContain(scenarioId);
    }
  });

  it("65b: a scenario-bearing finding reports hasApprovedScenario", () => {
    for (let index = 0; index < SCENARIO_CASES.length; index += 1) {
      const [scenarioId] = SCENARIO_CASES[index]!;
      expect(
        forCase(index).regressionRecommendation.hasApprovedScenario,
        scenarioId,
      ).toBe(true);
    }
  });

  it("65c: the action asks for the approved relevant invariant SET", () => {
    // The source contract is "rerun the same approved scenario + reevaluate
    // the same relevant invariant set", not one invariant.
    for (let index = 0; index < SCENARIO_CASES.length; index += 1) {
      const [scenarioId] = SCENARIO_CASES[index]!;
      expect(
        forCase(index).regressionRecommendation.action,
        scenarioId,
      ).toContain("approved relevant invariant set");
    }
  });

  it("66: the failed invariant is named and required to pass", () => {
    const regression = recommend("INV-003", "C11", {
      FAILURE_EVENT_MARKED_PAID: "PRESENT",
    }).regressionRecommendation;

    expect(regression.failedInvariantId).toBe("INV-003");
    expect(regression.action).toContain("C11");
    expect(regression.action).toContain("approved relevant invariant set");
    expect(regression.action).toContain("INV-003");
    expect(regression.action).toContain("must pass");
  });

  it("66b: the action never narrows the rerun to a single invariant", () => {
    for (let index = 0; index < SCENARIO_CASES.length; index += 1) {
      const [scenarioId, invariantId] = SCENARIO_CASES[index]!;
      const action = forCase(index).regressionRecommendation.action;
      const lowered = action.toLowerCase();
      for (const forbidden of [
        `only ${invariantId.toLowerCase()}`,
        `re-evaluate ${invariantId.toLowerCase()} only`,
        `reevaluate ${invariantId.toLowerCase()} only`,
        "single invariant",
        "that invariant only",
      ]) {
        expect(lowered, `${scenarioId}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("67-69: a null scenario stays null and is never invented", () => {
    const result = recommend("INV-008", null, { AMOUNT_MISMATCH: "PRESENT" });
    const regression = result.regressionRecommendation;

    expect(regression.scenarioId).toBeNull();
    expect(regression.hasApprovedScenario).toBe(false);
    expect(regression.action).toContain(
      "do not invent a runtime regression target",
    );
    // Still a valid recommendation overall.
    expect(result.recommendation.code).toBe("FIX-AMOUNT-CURRENCY-VALIDATION");
    for (const scenario of ["C01", "C03", "C07", "C11"]) {
      expect(regression.scenarioId, scenario).not.toBe(scenario);
      expect(regression.action, scenario).not.toContain(scenario);
    }
  });

  it("69b: no execution-readiness capability field is exposed", () => {
    // Phase 4D knows only whether an approved scenario exists. It must not
    // claim the regression engine exists or that a rerun can be started.
    const serialized = JSON.stringify(
      recommend("INV-003", "C11", { FAILURE_EVENT_MARKED_PAID: "PRESENT" }),
    );
    for (const forbidden of [
      "canAutoRerun",
      "autoRerun",
      "executionReady",
      "canExecute",
      "canStart",
      "regressionRunId",
      "runnable",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    expect(serialized).toContain("hasApprovedScenario");
  });

  it("70: no execution, target or HTTP action is expressed", () => {
    const serialized = JSON.stringify(
      recommend("INV-003", "C11", { FAILURE_EVENT_MARKED_PAID: "PRESENT" }),
    );
    for (const forbidden of [
      "http://",
      "https://",
      "fetch",
      "POST",
      "GET",
      "targetUrl",
      "endpoint",
      "execute",
      "regression_runs",
      "regressionRunId",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});

// ============================================================================
// DETERMINISM AND PURITY
// ============================================================================

describe("Phase 4D-R1 — determinism and purity", () => {
  it("71: identical input always produces a deep-equal recommendation", () => {
    const evidencePack = pack("INV-002", "C01");
    const classification = classifyRootCause(
      evidencePack,
      signals(RC002_STRONG),
    );
    expect(buildRecommendation(evidencePack, classification)).toEqual(
      buildRecommendation(evidencePack, classification),
    );
    expect(recommend("INV-005", "C03")).toEqual(recommend("INV-005", "C03"));
  });

  it("72: the evidence pack is never mutated", () => {
    const evidencePack = pack("INV-002", "C01");
    const serialized = JSON.stringify(evidencePack);
    const refs = evidencePack.evidenceRefs;
    buildRecommendation(
      evidencePack,
      classifyRootCause(evidencePack, signals(RC002_STRONG)),
    );
    expect(JSON.stringify(evidencePack)).toBe(serialized);
    expect(evidencePack.evidenceRefs).toBe(refs);
  });

  it("73: the classification is never mutated", () => {
    const evidencePack = pack("INV-002", "C01");
    const classification = classifyRootCause(
      evidencePack,
      signals(RC002_STRONG),
    );
    const serialized = JSON.stringify(classification);
    const ranked = classification.rankedCandidates;
    buildRecommendation(evidencePack, classification);
    expect(JSON.stringify(classification)).toBe(serialized);
    expect(classification.rankedCandidates).toBe(ranked);
  });

  it("74-78: no timestamp, probability, execution, status or score field appears", () => {
    const serialized = JSON.stringify(
      recommend("INV-002", "C01", RC002_STRONG),
    );
    for (const forbidden of [
      "generatedAt",
      "createdAt",
      "diagnosedAt",
      "diagnosed_at",
      "timestamp",
      "confidence",
      "probability",
      "percent",
      "likelihood",
      "resolved_at",
      "resolvedAt",
      "STILL_FAILING",
      "RESOLVED",
      "reliabilityScore",
      "RELIABILITY-V1",
      "readiness",
      "goLive",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    expect(serialized).not.toMatch(/\d+(\.\d+)?%/);
    expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

// ============================================================================
// CLASSIFICATION-SELECTION INTEGRITY
// ============================================================================

/**
 * Phase 4D consumes Phase 4C's selected root cause; it never substitutes its
 * own. These prove the trust boundary holds even when an object carries
 * otherwise-valid provenance metadata.
 */
describe("Phase 4D-R1 — classification selection integrity", () => {
  const SELECTION_INVALID = "RECOMMENDATION_CLASSIFICATION_SELECTION_INVALID";

  function expectSelectionInvalid(
    classification: RootCauseClassificationV1,
    label: string,
  ): void {
    let outcome: unknown = "did-not-throw";
    try {
      buildRecommendation(pack("INV-005", "C03"), classification);
    } catch (error) {
      outcome = (error as RecommendationError).code;
    }
    expect(outcome, label).toBe(SELECTION_INVALID);
  }

  /** Tampers ONLY `selected`, leaving the genuine ranked winner in place. */
  function tamperSelected(
    base: RootCauseClassificationV1,
    overrides: Record<string, unknown>,
  ): RootCauseClassificationV1 {
    return {
      ...base,
      selected: { ...base.selected, ...overrides },
    } as unknown as RootCauseClassificationV1;
  }

  it("I1: a genuine classification is accepted unchanged", () => {
    const evidencePack = pack("INV-002", "C01");
    const classification = classifyRootCause(
      evidencePack,
      signals(RC002_STRONG),
    );
    const result = buildRecommendation(evidencePack, classification);

    expect(result.diagnosis.rootCauseCode).toBe("RC-002");
    expect(result.recommendation.code).toBe("FIX-BUSINESS-IDEMPOTENCY");
    // The selected candidate really is the ranked winner.
    expect(classification.selected).toEqual(classification.rankedCandidates[0]);
  });

  it("I2: an ACTIVE selected-code swap is rejected, and emits no remediation", () => {
    // Genuine minimal C03 evidence selects RC-016. Swap only the selected
    // code to another ACTIVE code, keeping every provenance field valid.
    const base = classificationFor("INV-005", "C03");
    expect(base.selected.code).toBe("RC-016");

    const tampered = tamperSelected(base, {
      code: "RC-003",
      name: frozenName("RC-003"),
    });

    let outcome: unknown = "did-not-throw";
    let returned: unknown = null;
    try {
      returned = buildRecommendation(pack("INV-005", "C03"), tampered);
    } catch (error) {
      outcome = (error as RecommendationError).code;
    }

    expect(outcome).toBe(SELECTION_INVALID);
    // Critically: the webhook-auth remediation was NOT produced.
    expect(returned).toBeNull();
    expect(JSON.stringify(returned)).not.toContain("FIX-WEBHOOK-AUTH");
  });

  it("I3: a selected supporting-signal swap is rejected", () => {
    const base = classificationFor("INV-002", "C01", RC002_STRONG);
    expect(base.selected.code).toBe("RC-002");
    expectSelectionInvalid(
      tamperSelected(base, {
        supportingSignalCodes: ["DUPLICATE_EVENT_ATTEMPTS"],
      }),
      "supporting signals",
    );
    // Reordering alone is enough: 4C emits canonical order.
    expectSelectionInvalid(
      tamperSelected(base, {
        supportingSignalCodes: [
          ...base.selected.supportingSignalCodes,
        ].reverse(),
      }),
      "reordered supporting signals",
    );
  });

  it("I4: a selected strength swap is rejected", () => {
    const base = classificationFor("INV-002", "C01", RC002_STRONG);
    expectSelectionInvalid(
      tamperSelected(base, { strength: "PARTIAL_EVIDENCE" }),
      "strength",
    );
  });

  it("I5: a selected matchTier swap is rejected", () => {
    const base = classificationFor("INV-002", "C01", RC002_STRONG);
    expectSelectionInvalid(
      tamperSelected(base, { matchTier: "PARTIAL_MATCH" }),
      "matchTier",
    );
  });

  it("I6: a selected code/name pair that contradicts the taxonomy is rejected", () => {
    const base = classificationFor("INV-005", "C03", {
      INVALID_SIGNATURE_MUTATED_STATE: "PRESENT",
    });
    expect(base.selected.code).toBe("RC-003");

    // Coherent against the ranked winner, but the name belongs to a
    // different frozen code.
    expectSelectionInvalid(
      withWinner(base, { name: frozenName("RC-016") }),
      "code/name mismatch",
    );
  });

  it("I7: an empty rankedCandidates list is rejected", () => {
    const base = classificationFor("INV-005", "C03");
    const empty = {
      ...base,
      rankedCandidates: [],
    } as unknown as RootCauseClassificationV1;
    expectSelectionInvalid(empty, "empty ranked candidates");
  });

  it("I8: substituting a genuine LOWER-ranked candidate is rejected", () => {
    // C01 with both duplicate effects and repeated attempts produces two real
    // candidates: RC-002 wins, RC-001 ranks second.
    const evidencePack = pack("INV-002", "C01");
    const base = classifyRootCause(
      evidencePack,
      signals({
        DUPLICATE_EVENT_ATTEMPTS: "PRESENT",
        DUPLICATE_FULFILMENTS: "PRESENT",
        SAME_LOGICAL_PAYMENT: "PRESENT",
      }),
    );
    expect(base.rankedCandidates.length).toBeGreaterThan(1);
    expect(base.selected.code).toBe("RC-002");
    const runnerUp = base.rankedCandidates[1]!;
    expect(runnerUp.code).toBe("RC-001");

    const substituted = {
      ...base,
      selected: runnerUp,
    } as unknown as RootCauseClassificationV1;

    let outcome: unknown = "did-not-throw";
    try {
      buildRecommendation(evidencePack, substituted);
    } catch (error) {
      outcome = (error as RecommendationError).code;
    }
    // Phase 4D must consume the actual ranked winner, not a real but losing
    // candidate.
    expect(outcome).toBe(SELECTION_INVALID);
  });

  it("I9: an impossible RC-016 shape is rejected even when internally coherent", () => {
    const base = classificationFor("INV-005", "C03");
    expect(base.selected.code).toBe("RC-016");

    // Both selected and the winner are changed together, so selected-vs-first
    // equality still holds. Only the frozen abstention semantics catch this.
    expectSelectionInvalid(
      withWinner(base, { strength: "STRONG_EVIDENCE" }),
      "RC-016 with STRONG_EVIDENCE",
    );
    expectSelectionInvalid(
      withWinner(base, { matchTier: "DIRECT_EVIDENCE" }),
      "RC-016 with DIRECT_EVIDENCE",
    );
    expectSelectionInvalid(
      withWinner(base, { supportingSignalCodes: ["AMOUNT_MISMATCH"] }),
      "RC-016 with supporting signals",
    );
    expectSelectionInvalid(
      withWinner(base, { contradictorySignalCodes: ["AMOUNT_MISMATCH"] }),
      "RC-016 with contradictory signals",
    );
  });

  it("I10: no selection-invalid case is ever answered with an abstention", () => {
    const base = classificationFor("INV-005", "C03");
    const cases: readonly RootCauseClassificationV1[] = [
      tamperSelected(base, { code: "RC-003", name: frozenName("RC-003") }),
      tamperSelected(base, { strength: "STRONG_EVIDENCE" }),
      tamperSelected(base, { matchTier: "DIRECT_EVIDENCE" }),
      { ...base, rankedCandidates: [] } as unknown as RootCauseClassificationV1,
      withWinner(base, { strength: "PARTIAL_EVIDENCE" }),
    ];

    for (const [index, classification] of cases.entries()) {
      let returned: unknown = null;
      let threw = false;
      try {
        returned = buildRecommendation(pack("INV-005", "C03"), classification);
      } catch {
        threw = true;
      }
      // No RecommendationV1 at all — and in particular no abstention.
      expect(threw, `case ${index}`).toBe(true);
      expect(returned, `case ${index}`).toBeNull();
      expect(JSON.stringify(returned)).not.toContain(
        "INVESTIGATE-EVIDENCE-GAP",
      );
    }
  });
});
