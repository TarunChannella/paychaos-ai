import { describe, expect, it } from "vitest";

import {
  ACTIVE_ROOT_CAUSE_CODES,
  classifyRootCause,
  DIAGNOSIS_OUTPUT_SOURCE,
  DIAGNOSIS_RULE_VERSION,
  FALLBACK_ROOT_CAUSE_CODE,
  ROOT_CAUSE_CLASSIFICATION_VERSION,
  ROOT_CAUSE_ERROR_CODES,
  ROOT_CAUSE_TAXONOMY,
  RootCauseClassificationError,
} from "@/lib/diagnosis/root-cause-classifier";
import type { RootCauseCode } from "@/lib/diagnosis/root-cause-classifier";
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
import type { ChaosScenarioId } from "@/lib/chaos/types";
import type { InvariantResultInvariantId } from "@/lib/supabase/types";

/**
 * Phase 4C-R1 — pure deterministic root-cause classification.
 *
 * Every fixture is an in-memory Evidence Pack plus signal set. The unit under
 * test is a pure function: no database, no network, no clock.
 */

const FINDING_ID = "55555555-5555-4555-8555-555555555555";
const RESULT_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "11111111-1111-4111-8111-111111111111";

// ---------------------------------------------------------------- fixtures

/**
 * Every signal UNKNOWN unless the test says otherwise.
 *
 * `gapOverrides` gives an UNKNOWN signal its own DISTINCT gap code, which is
 * what makes gap over-collection observable: if the fallback borrowed an
 * unrelated signal's gap, the assertion would see a code it never expected.
 */
function signals(
  overrides?: Partial<Record<DiagnosticSignalCode, DiagnosticSignalState>>,
  setOverrides?: Partial<DiagnosticSignalSetV1>,
  gapOverrides?: Partial<
    Record<DiagnosticSignalCode, readonly EvidencePackGapCode[]>
  >,
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
          ? (gapOverrides?.[code] ?? ["CHAOS_EVIDENCE_UNAVAILABLE"])
          : [],
    })),
    ...setOverrides,
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

function codesOf(
  result: ReturnType<typeof classifyRootCause>,
): readonly RootCauseCode[] {
  return result.rankedCandidates.map((candidate) => candidate.code);
}

// ============================================================================
// A — TAXONOMY
// ============================================================================

describe("Phase 4C-R1 — taxonomy", () => {
  it("1: exactly the frozen sixteen RC codes exist, in order", () => {
    expect(ROOT_CAUSE_TAXONOMY.map((entry) => entry.code)).toEqual([
      "RC-001",
      "RC-002",
      "RC-003",
      "RC-004",
      "RC-005",
      "RC-006",
      "RC-007",
      "RC-008",
      "RC-009",
      "RC-010",
      "RC-011",
      "RC-012",
      "RC-013",
      "RC-014",
      "RC-015",
      "RC-016",
    ]);
    expect(ROOT_CAUSE_TAXONOMY).toHaveLength(16);
  });

  it("2: the frozen names match docs/AI_DESIGN.md Section 16 exactly", () => {
    expect(ROOT_CAUSE_TAXONOMY.map((entry) => entry.name)).toEqual([
      "MISSING_EVENT_IDEMPOTENCY",
      "MISSING_BUSINESS_IDEMPOTENCY",
      "INVALID_SIGNATURE_HANDLING",
      "EVENT_ORDERING_ASSUMPTION",
      "WEBHOOK_PROCESSING_DEADLINE_RISK",
      "RETRY_STATE_MANAGEMENT_FAILURE",
      "NON_ATOMIC_PROCESSING",
      "DATABASE_PARTIAL_FAILURE",
      "CLIENT_CONFIRMATION_DEPENDENCY",
      "STALE_PAYMENT_STATE",
      "UNSAFE_REPLAY_HANDLING",
      "UNSUPPORTED_EVENT_FALLTHROUGH",
      "PAYMENT_FAILURE_STATE_MAPPING",
      "AMOUNT_CURRENCY_MISMATCH",
      "MISSING_RECONCILIATION",
      "INSUFFICIENT_EVIDENCE",
    ]);
  });

  it("3: the rule version is the frozen DIAG-RULES-V1", () => {
    expect(DIAGNOSIS_RULE_VERSION).toBe("DIAG-RULES-V1");
    const result = classifyRootCause(pack("INV-008", null), signals());
    expect(result.ruleVersion).toBe("DIAG-RULES-V1");
    expect(result.version).toBe(ROOT_CAUSE_CLASSIFICATION_VERSION);
  });

  it("4: the output source is DETERMINISTIC_RULES, never a model name", () => {
    expect(DIAGNOSIS_OUTPUT_SOURCE).toBe("DETERMINISTIC_RULES");
    const result = classifyRootCause(pack("INV-008", null), signals());
    expect(result.outputSource).toBe("DETERMINISTIC_RULES");
  });

  it("5: the strength vocabulary is exactly the three approved labels", () => {
    const strong = classifyRootCause(
      pack("INV-008", null),
      signals({ AMOUNT_MISMATCH: "PRESENT" }),
    );
    expect(strong.selected.strength).toBe("STRONG_EVIDENCE");

    const partial = classifyRootCause(
      pack("INV-002", "C01"),
      signals({ DUPLICATE_FULFILMENTS: "PRESENT" }),
    );
    expect(partial.selected.strength).toBe("PARTIAL_EVIDENCE");

    const insufficient = classifyRootCause(pack("INV-008", null), signals());
    expect(insufficient.selected.strength).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("5b: the active and fallback code sets are exactly as approved", () => {
    expect([...ACTIVE_ROOT_CAUSE_CODES]).toEqual([
      "RC-001",
      "RC-002",
      "RC-003",
      "RC-009",
      "RC-010",
      "RC-013",
      "RC-014",
    ]);
    expect(FALLBACK_ROOT_CAUSE_CODE).toBe("RC-016");
  });
});

// ============================================================================
// B — INPUT INTEGRITY
// ============================================================================

describe("Phase 4C-R1 — input integrity", () => {
  it("6: a finding identity mismatch is a typed error, never RC-016", () => {
    const mismatched = signals(undefined, { findingId: RUN_ID });
    expect(() => classifyRootCause(pack("INV-008", null), mismatched)).toThrow(
      RootCauseClassificationError,
    );
    try {
      classifyRootCause(pack("INV-008", null), mismatched);
    } catch (error) {
      expect((error as RootCauseClassificationError).code).toBe(
        "DIAGNOSIS_INPUT_IDENTITY_MISMATCH",
      );
    }
  });

  it("7: an invariant-result identity mismatch is a typed error", () => {
    const mismatched = signals(undefined, { invariantResultId: RUN_ID });
    try {
      classifyRootCause(pack("INV-008", null), mismatched);
      throw new Error("expected throw");
    } catch (error) {
      expect((error as RootCauseClassificationError).code).toBe(
        "DIAGNOSIS_INPUT_IDENTITY_MISMATCH",
      );
    }
  });

  it("8: a non-FAIL pack is rejected", () => {
    const passing = pack("INV-008", null);
    // The pack type pins `result` to the literal "FAIL", so this can only be
    // reached through an unsafe cast — which is exactly why the classifier
    // still checks at runtime rather than trusting the type.
    const notFail = {
      ...passing,
      invariant: { ...passing.invariant, result: "PASS" },
    } as unknown as DiagnosisEvidencePackV1;
    try {
      classifyRootCause(notFail, signals());
      throw new Error("expected throw");
    } catch (error) {
      expect((error as RootCauseClassificationError).code).toBe(
        "DIAGNOSIS_INPUT_NOT_FAIL",
      );
    }
  });

  it("9: an unsupported signal contract version is rejected", () => {
    const future = {
      ...signals(),
      version: 2,
    } as unknown as DiagnosticSignalSetV1;
    try {
      classifyRootCause(pack("INV-008", null), future);
      throw new Error("expected throw");
    } catch (error) {
      expect((error as RootCauseClassificationError).code).toBe(
        "DIAGNOSIS_SIGNAL_VERSION_UNSUPPORTED",
      );
    }
  });

  it("10: a missing signal invalidates the set", () => {
    const base = signals();
    const short: DiagnosticSignalSetV1 = {
      ...base,
      signals: base.signals.slice(0, 12),
    };
    try {
      classifyRootCause(pack("INV-008", null), short);
      throw new Error("expected throw");
    } catch (error) {
      expect((error as RootCauseClassificationError).code).toBe(
        "DIAGNOSIS_SIGNAL_SET_INVALID",
      );
    }
  });

  it("11: a duplicated signal invalidates the set", () => {
    const base = signals();
    const duplicated: DiagnosticSignalSetV1 = {
      ...base,
      signals: [...base.signals.slice(0, 12), base.signals[0]!],
    };
    try {
      classifyRootCause(pack("INV-008", null), duplicated);
      throw new Error("expected throw");
    } catch (error) {
      expect((error as RootCauseClassificationError).code).toBe(
        "DIAGNOSIS_SIGNAL_SET_INVALID",
      );
    }
  });

  it("12: an extra signal invalidates the set", () => {
    const base = signals();
    const extra: DiagnosticSignalSetV1 = {
      ...base,
      signals: [...base.signals, base.signals[0]!],
    };
    try {
      classifyRootCause(pack("INV-008", null), extra);
      throw new Error("expected throw");
    } catch (error) {
      expect((error as RootCauseClassificationError).code).toBe(
        "DIAGNOSIS_SIGNAL_SET_INVALID",
      );
    }
  });

  it("13: a reordered frozen signal list invalidates the set", () => {
    const base = signals();
    const reordered: DiagnosticSignalSetV1 = {
      ...base,
      signals: [...base.signals].reverse(),
    };
    try {
      classifyRootCause(pack("INV-008", null), reordered);
      throw new Error("expected throw");
    } catch (error) {
      expect((error as RootCauseClassificationError).code).toBe(
        "DIAGNOSIS_SIGNAL_SET_INVALID",
      );
    }
  });

  it("13b: the error vocabulary is exactly the four approved codes", () => {
    expect([...ROOT_CAUSE_ERROR_CODES]).toEqual([
      "DIAGNOSIS_INPUT_IDENTITY_MISMATCH",
      "DIAGNOSIS_INPUT_NOT_FAIL",
      "DIAGNOSIS_SIGNAL_VERSION_UNSUPPORTED",
      "DIAGNOSIS_SIGNAL_SET_INVALID",
    ]);
  });
});

// ============================================================================
// C — C01
// ============================================================================

describe("Phase 4C-R1 — C01 idempotency", () => {
  it("14: duplicate fulfilments on one logical payment prove RC-002 STRONG", () => {
    const result = classifyRootCause(
      pack("INV-002", "C01"),
      signals({
        DUPLICATE_FULFILMENTS: "PRESENT",
        SAME_LOGICAL_PAYMENT: "PRESENT",
      }),
    );
    expect(result.selected.code).toBe("RC-002");
    expect(result.selected.name).toBe("MISSING_BUSINESS_IDEMPOTENCY");
    expect(result.selected.strength).toBe("STRONG_EVIDENCE");
    expect(result.selected.matchTier).toBe("DIRECT_EVIDENCE");
  });

  it("15: distinct idempotency keys stay RC-002 and are recorded as support", () => {
    const result = classifyRootCause(
      pack("INV-002", "C01"),
      signals({
        DUPLICATE_FULFILMENTS: "PRESENT",
        SAME_LOGICAL_PAYMENT: "PRESENT",
        DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS: "PRESENT",
      }),
    );
    expect(result.selected.code).toBe("RC-002");
    expect(result.selected.supportingSignalCodes).toEqual([
      "DUPLICATE_FULFILMENTS",
      "DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS",
      "SAME_LOGICAL_PAYMENT",
    ]);
  });

  it("16: RC-002 outranks RC-001 when both candidates exist", () => {
    const result = classifyRootCause(
      pack("INV-002", "C01"),
      signals({
        DUPLICATE_EVENT_ATTEMPTS: "PRESENT",
        DUPLICATE_FULFILMENTS: "PRESENT",
        SAME_LOGICAL_PAYMENT: "PRESENT",
      }),
    );
    expect(codesOf(result)).toEqual(["RC-002", "RC-001"]);
    expect(result.selected.code).toBe("RC-002");
  });

  it("17: INV-001 with repeated processing attempts proves RC-001 STRONG", () => {
    const result = classifyRootCause(
      pack("INV-001", "C01"),
      signals({ DUPLICATE_EVENT_ATTEMPTS: "PRESENT" }),
    );
    expect(result.selected.code).toBe("RC-001");
    expect(result.selected.name).toBe("MISSING_EVENT_IDEMPOTENCY");
    expect(result.selected.strength).toBe("STRONG_EVIDENCE");
  });

  it("18: C01 plus duplicate attempts alone never manufactures RC-001", () => {
    // C01 deliberately causes repeated delivery; attempt count on its own is
    // the scenario working, not proof of broken merchant idempotency.
    const result = classifyRootCause(
      pack("INV-011", "C01"),
      signals({ DUPLICATE_EVENT_ATTEMPTS: "PRESENT" }),
    );
    expect(codesOf(result)).not.toContain("RC-001");
    expect(result.selected.code).toBe("RC-016");
  });

  it("18b: INV-002 with duplicate attempts but no effect evidence is not RC-001", () => {
    const result = classifyRootCause(
      pack("INV-002", "C01"),
      signals({ DUPLICATE_EVENT_ATTEMPTS: "PRESENT" }),
    );
    expect(codesOf(result)).not.toContain("RC-001");
    expect(result.selected.code).toBe("RC-016");
  });

  it("19: duplicate fulfilments with UNKNOWN same-payment is RC-002 PARTIAL", () => {
    const result = classifyRootCause(
      pack("INV-002", "C01"),
      signals({ DUPLICATE_FULFILMENTS: "PRESENT" }),
    );
    expect(result.selected.code).toBe("RC-002");
    expect(result.selected.strength).toBe("PARTIAL_EVIDENCE");
    expect(result.selected.matchTier).toBe("SCENARIO_INVARIANT_SIGNAL");
    // The unestablished fact is reported through its own pack gap.
    expect(result.selected.blockingGapCodes).toEqual([
      "CHAOS_EVIDENCE_UNAVAILABLE",
    ]);
  });

  it("20: a proven different logical payment eliminates RC-002", () => {
    const result = classifyRootCause(
      pack("INV-002", "C01"),
      signals({
        DUPLICATE_FULFILMENTS: "PRESENT",
        SAME_LOGICAL_PAYMENT: "ABSENT",
      }),
    );
    expect(codesOf(result)).not.toContain("RC-002");
    expect(result.selected.code).toBe("RC-016");
  });

  // The former "identical keys are contradictory" expectation was removed:
  // the frozen semantics make the key signal OPTIONAL strengthening, so its
  // absence cannot contradict the defining business-idempotency failure. The
  // replacement coverage lives in the correction-B block below.

  it("20c: INV-006 replay that changed final state proves RC-001", () => {
    const result = classifyRootCause(
      pack("INV-006", "C01"),
      signals({
        DUPLICATE_EVENT_ATTEMPTS: "PRESENT",
        REPLAY_CHANGED_FINAL_STATE: "PRESENT",
      }),
    );
    expect(result.selected.code).toBe("RC-001");
    expect(result.selected.strength).toBe("STRONG_EVIDENCE");
  });
});

// ============================================================================
// D — C03
// ============================================================================

describe("Phase 4C-R1 — C03 signature handling", () => {
  it("21: a proven mutation after a rejected signature is RC-003 STRONG", () => {
    const result = classifyRootCause(
      pack("INV-005", "C03"),
      signals({ INVALID_SIGNATURE_MUTATED_STATE: "PRESENT" }),
    );
    expect(result.selected.code).toBe("RC-003");
    expect(result.selected.name).toBe("INVALID_SIGNATURE_HANDLING");
    expect(result.selected.strength).toBe("STRONG_EVIDENCE");
    expect(result.selected.matchTier).toBe("DIRECT_EVIDENCE");
  });

  it("22: an UNKNOWN mutation signal falls back to RC-016", () => {
    const result = classifyRootCause(pack("INV-005", "C03"), signals());
    expect(result.selected.code).toBe("RC-016");
    expect(result.selected.strength).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("23: scenario C03 alone never selects RC-003", () => {
    const result = classifyRootCause(
      pack("INV-005", "C03"),
      signals({ INVALID_SIGNATURE_MUTATED_STATE: "ABSENT" }),
    );
    expect(codesOf(result)).not.toContain("RC-003");
    expect(result.selected.code).toBe("RC-016");
  });

  it("23b: INV-004 under C03 uses the same rule", () => {
    const result = classifyRootCause(
      pack("INV-004", "C03"),
      signals({ INVALID_SIGNATURE_MUTATED_STATE: "PRESENT" }),
    );
    expect(result.selected.code).toBe("RC-003");
  });
});

// ============================================================================
// E — C07
// ============================================================================

describe("Phase 4C-R1 — C07 client confirmation", () => {
  const triple = {
    CLIENT_CONFIRMATION_MISSING: "PRESENT",
    PAYMENT_CAPTURED_VIA_WEBHOOK: "PRESENT",
    CAPTURE_EXISTS_ORDER_NOT_PAID: "PRESENT",
  } as const;

  it("24: the exact client-dependency triple is RC-009 STRONG", () => {
    const result = classifyRootCause(pack("INV-011", "C07"), signals(triple));
    expect(result.selected.code).toBe("RC-009");
    expect(result.selected.name).toBe("CLIENT_CONFIRMATION_DEPENDENCY");
    expect(result.selected.strength).toBe("STRONG_EVIDENCE");
    expect(result.selected.matchTier).toBe("DIRECT_EVIDENCE");
  });

  it("25: RC-009 outranks RC-010 on the exact triple", () => {
    const result = classifyRootCause(pack("INV-011", "C07"), signals(triple));
    expect(codesOf(result)).toEqual(["RC-009", "RC-010"]);
  });

  it("26: an UNKNOWN stale state leaves RC-009 PARTIAL", () => {
    const result = classifyRootCause(
      pack("INV-011", "C07"),
      signals({
        CLIENT_CONFIRMATION_MISSING: "PRESENT",
        PAYMENT_CAPTURED_VIA_WEBHOOK: "PRESENT",
      }),
    );
    expect(result.selected.code).toBe("RC-009");
    expect(result.selected.strength).toBe("PARTIAL_EVIDENCE");
  });

  it("27: a converged order eliminates RC-009", () => {
    const result = classifyRootCause(
      pack("INV-011", "C07"),
      signals({
        CLIENT_CONFIRMATION_MISSING: "PRESENT",
        PAYMENT_CAPTURED_VIA_WEBHOOK: "PRESENT",
        CAPTURE_EXISTS_ORDER_NOT_PAID: "ABSENT",
      }),
    );
    expect(codesOf(result)).not.toContain("RC-009");
  });

  it("28: verified capture plus stale state without client dependency is RC-010 STRONG", () => {
    const result = classifyRootCause(
      pack("INV-011", "C07"),
      signals({
        PAYMENT_CAPTURED_VIA_WEBHOOK: "PRESENT",
        CAPTURE_EXISTS_ORDER_NOT_PAID: "PRESENT",
      }),
    );
    expect(result.selected.code).toBe("RC-010");
    expect(result.selected.name).toBe("STALE_PAYMENT_STATE");
    expect(result.selected.strength).toBe("STRONG_EVIDENCE");
  });

  it("29: an out-of-order regression under INV-011 is RC-010 STRONG", () => {
    const result = classifyRootCause(
      pack("INV-011", null),
      signals({ OUT_OF_ORDER_STATE_REGRESSION: "PRESENT" }),
    );
    expect(result.selected.code).toBe("RC-010");
    expect(result.selected.strength).toBe("STRONG_EVIDENCE");
  });
});

// ============================================================================
// F — C11
// ============================================================================

describe("Phase 4C-R1 — C11 failure-state mapping", () => {
  it("30: a failure event that marked the order paid is RC-013 STRONG", () => {
    const result = classifyRootCause(
      pack("INV-003", "C11"),
      signals({ FAILURE_EVENT_MARKED_PAID: "PRESENT" }),
    );
    expect(result.selected.code).toBe("RC-013");
    expect(result.selected.name).toBe("PAYMENT_FAILURE_STATE_MAPPING");
    expect(result.selected.strength).toBe("STRONG_EVIDENCE");
    expect(result.selected.matchTier).toBe("DIRECT_EVIDENCE");
  });

  it("31: RC-013 outranks RC-010 when both exist", () => {
    const result = classifyRootCause(
      pack("INV-011", "C11"),
      signals({
        FAILURE_EVENT_MARKED_PAID: "PRESENT",
        OUT_OF_ORDER_STATE_REGRESSION: "PRESENT",
      }),
    );
    expect(codesOf(result)).toEqual(["RC-013", "RC-010"]);
  });

  it("32: an UNKNOWN failure-mapping signal never selects RC-013", () => {
    const result = classifyRootCause(pack("INV-003", "C11"), signals());
    expect(codesOf(result)).not.toContain("RC-013");
    expect(result.selected.code).toBe("RC-016");
  });

  it("32b: an ABSENT failure-mapping signal eliminates RC-013", () => {
    const result = classifyRootCause(
      pack("INV-003", "C11"),
      signals({ FAILURE_EVENT_MARKED_PAID: "ABSENT" }),
    );
    expect(codesOf(result)).not.toContain("RC-013");
  });

  it("33: an out-of-order regression alone may select RC-010 under INV-011", () => {
    const result = classifyRootCause(
      pack("INV-011", "C11"),
      signals({ OUT_OF_ORDER_STATE_REGRESSION: "PRESENT" }),
    );
    expect(result.selected.code).toBe("RC-010");
  });
});

// ============================================================================
// G — MONEY
// ============================================================================

describe("Phase 4C-R1 — money mismatch", () => {
  it("34: INV-008 with a proven amount mismatch is RC-014", () => {
    const result = classifyRootCause(
      pack("INV-008", null),
      signals({ AMOUNT_MISMATCH: "PRESENT" }),
    );
    expect(result.selected.code).toBe("RC-014");
    expect(result.selected.name).toBe("AMOUNT_CURRENCY_MISMATCH");
    expect(result.selected.strength).toBe("STRONG_EVIDENCE");
    expect(result.selected.supportingSignalCodes).toEqual(["AMOUNT_MISMATCH"]);
  });

  it("35: INV-008 with a proven currency mismatch is RC-014", () => {
    const result = classifyRootCause(
      pack("INV-008", null),
      signals({ CURRENCY_MISMATCH: "PRESENT" }),
    );
    expect(result.selected.code).toBe("RC-014");
    expect(result.selected.supportingSignalCodes).toEqual([
      "CURRENCY_MISMATCH",
    ]);
  });

  it("36: both mismatches produce one RC-014 candidate carrying both signals", () => {
    const result = classifyRootCause(
      pack("INV-008", null),
      signals({ AMOUNT_MISMATCH: "PRESENT", CURRENCY_MISMATCH: "PRESENT" }),
    );
    expect(codesOf(result)).toEqual(["RC-014"]);
    expect(result.selected.supportingSignalCodes).toEqual([
      "AMOUNT_MISMATCH",
      "CURRENCY_MISMATCH",
    ]);
  });

  it("37: INV-008 with both money signals UNKNOWN falls back to RC-016", () => {
    const result = classifyRootCause(pack("INV-008", null), signals());
    expect(result.selected.code).toBe("RC-016");
  });

  it("38: a money mismatch under an unrelated invariant never creates RC-014", () => {
    const result = classifyRootCause(
      pack("INV-005", "C03"),
      signals({ AMOUNT_MISMATCH: "PRESENT", CURRENCY_MISMATCH: "PRESENT" }),
    );
    expect(codesOf(result)).not.toContain("RC-014");
    expect(result.selected.code).toBe("RC-016");
  });
});

// ============================================================================
// H — INSUFFICIENT / INACTIVE TAXONOMY
// ============================================================================

describe("Phase 4C-R1 — insufficient evidence and inactive categories", () => {
  it("39: all signals UNKNOWN yields RC-016 INSUFFICIENT_EVIDENCE", () => {
    const result = classifyRootCause(pack("INV-002", "C01"), signals());
    expect(result.selected.code).toBe("RC-016");
    expect(result.selected.name).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.selected.strength).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.selected.matchTier).toBe("INSUFFICIENT");
    // No fabricated support for a cause that was never established.
    expect(result.selected.supportingSignalCodes).toEqual([]);
  });

  it("40: a scenario and invariant with no structured support is RC-016", () => {
    for (const [invariantId, scenarioId] of [
      ["INV-005", "C03"],
      ["INV-011", "C07"],
      ["INV-003", "C11"],
      ["INV-002", "C01"],
    ] as const) {
      const result = classifyRootCause(
        pack(invariantId, scenarioId),
        signals(),
      );
      expect(result.selected.code, `${scenarioId}/${invariantId}`).toBe(
        "RC-016",
      );
    }
  });

  it("41: the eight inactive categories are never selected by the R1 engine", () => {
    const inactive: readonly RootCauseCode[] = [
      "RC-004",
      "RC-005",
      "RC-006",
      "RC-007",
      "RC-008",
      "RC-011",
      "RC-012",
      "RC-015",
    ];
    // Every scenario/invariant pairing this engine knows, with every signal
    // driven to each of the three states.
    const scenarios = ["C01", "C03", "C07", "C11", null] as const;
    const invariants = [
      "INV-001",
      "INV-002",
      "INV-003",
      "INV-004",
      "INV-005",
      "INV-006",
      "INV-007",
      "INV-008",
      "INV-011",
    ] as const;
    const states: readonly DiagnosticSignalState[] = [
      "PRESENT",
      "ABSENT",
      "UNKNOWN",
    ];

    for (const scenarioId of scenarios) {
      for (const invariantId of invariants) {
        for (const state of states) {
          const all = Object.fromEntries(
            DIAGNOSTIC_SIGNAL_CODES.map((code) => [code, state]),
          ) as Partial<Record<DiagnosticSignalCode, DiagnosticSignalState>>;
          const result = classifyRootCause(
            pack(invariantId, scenarioId),
            signals(all),
          );
          for (const code of codesOf(result)) {
            expect(
              inactive,
              `${scenarioId}/${invariantId}/${state}`,
            ).not.toContain(code);
          }
        }
      }
    }
  });

  it("42: RC-016 is a fallback, never a competing specific candidate", () => {
    const specific = classifyRootCause(
      pack("INV-008", null),
      signals({ AMOUNT_MISMATCH: "PRESENT" }),
    );
    expect(codesOf(specific)).not.toContain("RC-016");

    const fallback = classifyRootCause(pack("INV-008", null), signals());
    expect(codesOf(fallback)).toEqual(["RC-016"]);
  });
});

// ============================================================================
// I — DETERMINISM AND AUTHORITY
// ============================================================================

describe("Phase 4C-R1 — determinism and authority", () => {
  it("43: identical input always produces a deep-equal classification", () => {
    const p = pack("INV-011", "C07");
    const s = signals({
      CLIENT_CONFIRMATION_MISSING: "PRESENT",
      PAYMENT_CAPTURED_VIA_WEBHOOK: "PRESENT",
      CAPTURE_EXISTS_ORDER_NOT_PAID: "PRESENT",
    });
    expect(classifyRootCause(p, s)).toEqual(classifyRootCause(p, s));
    expect(classifyRootCause(pack("INV-011", "C07"), signals())).toEqual(
      classifyRootCause(pack("INV-011", "C07"), signals()),
    );
  });

  it("44: the evidence pack is never mutated", () => {
    const p = pack("INV-002", "C01");
    const serialized = JSON.stringify(p);
    const refs = p.evidenceRefs;
    classifyRootCause(
      p,
      signals({
        DUPLICATE_FULFILMENTS: "PRESENT",
        SAME_LOGICAL_PAYMENT: "PRESENT",
      }),
    );
    expect(JSON.stringify(p)).toBe(serialized);
    expect(p.evidenceRefs).toBe(refs);
  });

  it("45: the signal set is never mutated", () => {
    const s = signals({ AMOUNT_MISMATCH: "PRESENT" });
    const serialized = JSON.stringify(s);
    const list = s.signals;
    classifyRootCause(pack("INV-008", null), s);
    expect(JSON.stringify(s)).toBe(serialized);
    expect(s.signals).toBe(list);
  });

  it("46: dramatic prose changes never change the classification", () => {
    const structured = signals({
      DUPLICATE_FULFILMENTS: "PRESENT",
      SAME_LOGICAL_PAYMENT: "PRESENT",
    });
    const plain = pack("INV-002", "C01");
    const shouty = pack("INV-002", "C01", {
      finding: {
        ...plain.finding,
        title: "CATASTROPHIC INVALID SIGNATURE MUTATED STATE AMOUNT MISMATCH",
      },
      invariant: {
        ...plain.invariant,
        expectedSummary: "the payment failed and money was lost forever",
        observedSummary: "duplicate reconciliation regression replay disaster",
        reason: "RC-008 DATABASE_PARTIAL_FAILURE definitely happened here",
      },
    });

    expect(classifyRootCause(shouty, structured)).toEqual(
      classifyRootCause(plain, structured),
    );
  });

  it("47: supporting and contradictory codes follow the frozen signal order", () => {
    const result = classifyRootCause(
      pack("INV-002", "C01"),
      signals({
        DUPLICATE_FULFILMENTS: "PRESENT",
        SAME_LOGICAL_PAYMENT: "PRESENT",
        DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS: "PRESENT",
      }),
    );
    const order = result.selected.supportingSignalCodes.map((code) =>
      DIAGNOSTIC_SIGNAL_CODES.indexOf(code),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("48: blocking gap codes are deterministic and deduplicated", () => {
    const s = signals({ DUPLICATE_FULFILMENTS: "PRESENT" });
    const first = classifyRootCause(pack("INV-002", "C01"), s);
    const second = classifyRootCause(pack("INV-002", "C01"), s);
    expect(first.selected.blockingGapCodes).toEqual(
      second.selected.blockingGapCodes,
    );
    expect(new Set(first.selected.blockingGapCodes).size).toBe(
      first.selected.blockingGapCodes.length,
    );
  });

  it("49: no confidence percentage or probability is ever emitted", () => {
    const serialized = JSON.stringify(
      classifyRootCause(
        pack("INV-011", "C07"),
        signals({
          CLIENT_CONFIRMATION_MISSING: "PRESENT",
          PAYMENT_CAPTURED_VIA_WEBHOOK: "PRESENT",
          CAPTURE_EXISTS_ORDER_NOT_PAID: "PRESENT",
        }),
      ),
    );
    for (const forbidden of [
      "confidence",
      "probability",
      "percent",
      "likelihood",
      "score",
      "HIGH",
      "MEDIUM",
      "LOW",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    expect(serialized).not.toMatch(/\d+(\.\d+)?%/);
  });

  it("50: no recommendation, regression, score or readiness field appears", () => {
    const serialized = JSON.stringify(
      classifyRootCause(
        pack("INV-008", null),
        signals({ AMOUNT_MISMATCH: "PRESENT" }),
      ),
    );
    for (const forbidden of [
      "recommendation",
      "FIX-",
      "regression_runs",
      "regressionRun",
      "retest",
      "reliabilityScore",
      "RELIABILITY-V1",
      "readiness",
      "goLive",
      "diagnosed_at",
      "diagnosedAt",
      "generatedAt",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it("51: evidence references are passed through verbatim, never invented", () => {
    const p = pack("INV-008", null);
    const result = classifyRootCause(
      p,
      signals({ AMOUNT_MISMATCH: "PRESENT" }),
    );
    expect(result.selected.code).toBe("RC-014");
    expect(result.evidenceRefs).toEqual(p.evidenceRefs);
  });

  it("52: identity fields mirror the validated inputs", () => {
    const result = classifyRootCause(pack("INV-008", null), signals());
    expect(result.findingId).toBe(FINDING_ID);
    expect(result.invariantResultId).toBe(RESULT_ID);
  });
});

// ============================================================================
// CORRECTION A — RC-016 relevant-gap discipline
// ============================================================================

describe("Phase 4C-R1 correction A — RC-016 reports only relevant gaps", () => {
  it("A1: a C03 signature fallback never borrows money or C07 gaps", () => {
    const result = classifyRootCause(
      pack("INV-005", "C03"),
      signals(undefined, undefined, {
        INVALID_SIGNATURE_MUTATED_STATE: [
          "C03_VERIFICATION_CHECKS_UNAVAILABLE",
        ],
        AMOUNT_MISMATCH: ["MONEY_CONTEXT_UNAVAILABLE"],
        CLIENT_CONFIRMATION_MISSING: ["C07_FAULT_FACTS_UNAVAILABLE"],
      }),
    );
    expect(result.selected.code).toBe("RC-016");
    expect(result.selected.blockingGapCodes).toContain(
      "C03_VERIFICATION_CHECKS_UNAVAILABLE",
    );
    // Money context is irrelevant to whether a C03 signature diagnosis could
    // be reached; so is C07 fault evidence.
    expect(result.selected.blockingGapCodes).not.toContain(
      "MONEY_CONTEXT_UNAVAILABLE",
    );
    expect(result.selected.blockingGapCodes).not.toContain(
      "C07_FAULT_FACTS_UNAVAILABLE",
    );
  });

  it("A2: an INV-008 money fallback never borrows C03 gaps", () => {
    const result = classifyRootCause(
      pack("INV-008", null),
      signals(undefined, undefined, {
        AMOUNT_MISMATCH: ["MONEY_CONTEXT_UNAVAILABLE"],
        INVALID_SIGNATURE_MUTATED_STATE: ["C03_MUTATION_FACTS_UNAVAILABLE"],
      }),
    );
    expect(result.selected.code).toBe("RC-016");
    expect(result.selected.blockingGapCodes).toContain(
      "MONEY_CONTEXT_UNAVAILABLE",
    );
    expect(result.selected.blockingGapCodes).not.toContain(
      "C03_MUTATION_FACTS_UNAVAILABLE",
    );
  });

  it("A3: a C07/INV-011 fallback keeps its own gaps and excludes money", () => {
    const result = classifyRootCause(
      pack("INV-011", "C07"),
      signals(undefined, undefined, {
        CLIENT_CONFIRMATION_MISSING: ["C07_FAULT_FACTS_UNAVAILABLE"],
        PAYMENT_CAPTURED_VIA_WEBHOOK: ["SOURCE_WEBHOOK_UNAVAILABLE"],
        CAPTURE_EXISTS_ORDER_NOT_PAID: ["CAPTURE_CONTEXT_UNAVAILABLE"],
        AMOUNT_MISMATCH: ["MONEY_CONTEXT_UNAVAILABLE"],
      }),
    );
    expect(result.selected.code).toBe("RC-016");
    for (const gap of [
      "C07_FAULT_FACTS_UNAVAILABLE",
      "SOURCE_WEBHOOK_UNAVAILABLE",
      "CAPTURE_CONTEXT_UNAVAILABLE",
    ] as const) {
      expect(result.selected.blockingGapCodes, gap).toContain(gap);
    }
    expect(result.selected.blockingGapCodes).not.toContain(
      "MONEY_CONTEXT_UNAVAILABLE",
    );
  });

  it("A4: a C11/INV-003 fallback keeps its own gap and excludes C07", () => {
    const result = classifyRootCause(
      pack("INV-003", "C11"),
      signals(undefined, undefined, {
        FAILURE_EVENT_MARKED_PAID: ["SOURCE_WEBHOOK_UNAVAILABLE"],
        CLIENT_CONFIRMATION_MISSING: ["C07_FAULT_FACTS_UNAVAILABLE"],
      }),
    );
    expect(result.selected.code).toBe("RC-016");
    expect(result.selected.blockingGapCodes).toEqual([
      "SOURCE_WEBHOOK_UNAVAILABLE",
    ]);
    expect(result.selected.blockingGapCodes).not.toContain(
      "C07_FAULT_FACTS_UNAVAILABLE",
    );
  });

  it("A5: fallback gap order is deterministic regardless of how gaps are supplied", () => {
    const gapsA = {
      CLIENT_CONFIRMATION_MISSING: [
        "C07_FAULT_FACTS_UNAVAILABLE",
        "CHAOS_EVIDENCE_UNAVAILABLE",
      ],
      CAPTURE_EXISTS_ORDER_NOT_PAID: [
        "CAPTURE_CONTEXT_UNAVAILABLE",
        "CHAOS_EVIDENCE_UNAVAILABLE",
      ],
    } as const;
    const first = classifyRootCause(
      pack("INV-011", "C07"),
      signals(undefined, undefined, gapsA),
    );
    const second = classifyRootCause(
      pack("INV-011", "C07"),
      signals(undefined, undefined, gapsA),
    );
    expect(first.selected.blockingGapCodes).toEqual(
      second.selected.blockingGapCodes,
    );
    // Deduplicated: the shared gap appears once, not once per signal.
    expect(new Set(first.selected.blockingGapCodes).size).toBe(
      first.selected.blockingGapCodes.length,
    );
  });

  it("A6: with no applicable active rule the fallback reports no gaps", () => {
    // INV-009 has no active R1 rule, so nothing was actually blocked.
    const result = classifyRootCause(
      pack("INV-009", null),
      signals(undefined, undefined, {
        AMOUNT_MISMATCH: ["MONEY_CONTEXT_UNAVAILABLE"],
        CLIENT_CONFIRMATION_MISSING: ["C07_FAULT_FACTS_UNAVAILABLE"],
      }),
    );
    expect(result.selected.code).toBe("RC-016");
    // Unrelated gaps are never attached just to look more informative.
    expect(result.selected.blockingGapCodes).toEqual([]);
  });

  it("A7: a C01/INV-002 fallback uses only idempotency-path gaps", () => {
    const result = classifyRootCause(
      pack("INV-002", "C01"),
      signals(undefined, undefined, {
        DUPLICATE_EVENT_ATTEMPTS: ["CHAOS_EVIDENCE_UNAVAILABLE"],
        DUPLICATE_FULFILMENTS: ["CHAOS_EVIDENCE_UNAVAILABLE"],
        SAME_LOGICAL_PAYMENT: ["CHAOS_EVIDENCE_UNAVAILABLE"],
        INVALID_SIGNATURE_MUTATED_STATE: [
          "C03_VERIFICATION_CHECKS_UNAVAILABLE",
        ],
        AMOUNT_MISMATCH: ["MONEY_CONTEXT_UNAVAILABLE"],
      }),
    );
    expect(result.selected.code).toBe("RC-016");
    expect(result.selected.blockingGapCodes).toEqual([
      "CHAOS_EVIDENCE_UNAVAILABLE",
    ]);
  });
});

// ============================================================================
// CORRECTION B — RC-002 optional idempotency-key semantics
// ============================================================================

describe("Phase 4C-R1 correction B — the key signal is optional support", () => {
  it("B1: PRESENT distinct keys strengthen and are listed as support", () => {
    const result = classifyRootCause(
      pack("INV-002", "C01"),
      signals({
        DUPLICATE_FULFILMENTS: "PRESENT",
        SAME_LOGICAL_PAYMENT: "PRESENT",
        DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS: "PRESENT",
      }),
    );
    expect(result.selected.code).toBe("RC-002");
    expect(result.selected.strength).toBe("STRONG_EVIDENCE");
    expect(result.selected.supportingSignalCodes).toContain(
      "DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS",
    );
  });

  it("B2: ABSENT keys are neither support nor contradiction, and RC-002 stays STRONG", () => {
    const result = classifyRootCause(
      pack("INV-002", "C01"),
      signals({
        DUPLICATE_FULFILMENTS: "PRESENT",
        SAME_LOGICAL_PAYMENT: "PRESENT",
        DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS: "ABSENT",
      }),
    );
    expect(result.selected.code).toBe("RC-002");
    expect(result.selected.strength).toBe("STRONG_EVIDENCE");
    expect(result.selected.supportingSignalCodes).not.toContain(
      "DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS",
    );
    // The absence of an optional strengthening pattern does not contradict
    // the defining failure.
    expect(result.selected.contradictorySignalCodes).toEqual([]);
  });

  it("B3: UNKNOWN keys neither downgrade RC-002 nor become a blocking gap", () => {
    const result = classifyRootCause(
      pack("INV-002", "C01"),
      signals(
        {
          DUPLICATE_FULFILMENTS: "PRESENT",
          SAME_LOGICAL_PAYMENT: "PRESENT",
        },
        undefined,
        {
          DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS: ["CHAOS_EVIDENCE_UNAVAILABLE"],
        },
      ),
    );
    expect(result.selected.code).toBe("RC-002");
    expect(result.selected.strength).toBe("STRONG_EVIDENCE");
    // Both defining facts were proven, so nothing blocked this candidate.
    expect(result.selected.blockingGapCodes).toEqual([]);
  });

  it("B4: distinct keys never promote a same-payment-UNKNOWN candidate to STRONG", () => {
    const result = classifyRootCause(
      pack("INV-002", "C01"),
      signals({
        DUPLICATE_FULFILMENTS: "PRESENT",
        DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS: "PRESENT",
      }),
    );
    expect(result.selected.code).toBe("RC-002");
    // Key evidence cannot substitute for proof that the duplicate rows belong
    // to one logical payment.
    expect(result.selected.strength).toBe("PARTIAL_EVIDENCE");
  });

  it("B5: a proven different logical payment still eliminates RC-002", () => {
    const result = classifyRootCause(
      pack("INV-002", "C01"),
      signals({
        DUPLICATE_FULFILMENTS: "PRESENT",
        SAME_LOGICAL_PAYMENT: "ABSENT",
        DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS: "PRESENT",
      }),
    );
    expect(codesOf(result)).not.toContain("RC-002");
  });
});

// ============================================================================
// CORRECTION C — RC-010 direct-evidence tier
// ============================================================================

describe("Phase 4C-R1 correction C — RC-010 is direct evidence", () => {
  it("C1: a protected-state regression is RC-010 STRONG / DIRECT_EVIDENCE", () => {
    const result = classifyRootCause(
      pack("INV-011", null),
      signals({ OUT_OF_ORDER_STATE_REGRESSION: "PRESENT" }),
    );
    expect(result.selected.code).toBe("RC-010");
    expect(result.selected.strength).toBe("STRONG_EVIDENCE");
    expect(result.selected.matchTier).toBe("DIRECT_EVIDENCE");
  });

  it("C2: verified capture plus stale merchant state is RC-010 STRONG / DIRECT_EVIDENCE", () => {
    const result = classifyRootCause(
      pack("INV-011", null),
      signals({
        PAYMENT_CAPTURED_VIA_WEBHOOK: "PRESENT",
        CAPTURE_EXISTS_ORDER_NOT_PAID: "PRESENT",
      }),
    );
    expect(result.selected.code).toBe("RC-010");
    expect(result.selected.strength).toBe("STRONG_EVIDENCE");
    expect(result.selected.matchTier).toBe("DIRECT_EVIDENCE");
  });

  it("C3: the partial capture case stays PARTIAL_EVIDENCE / PARTIAL_MATCH", () => {
    const result = classifyRootCause(
      pack("INV-011", null),
      signals({ PAYMENT_CAPTURED_VIA_WEBHOOK: "PRESENT" }),
    );
    expect(result.selected.code).toBe("RC-010");
    expect(result.selected.strength).toBe("PARTIAL_EVIDENCE");
    expect(result.selected.matchTier).toBe("PARTIAL_MATCH");
  });

  it("C4: RC-009 still outranks RC-010 with both at DIRECT_EVIDENCE", () => {
    const result = classifyRootCause(
      pack("INV-011", "C07"),
      signals({
        CLIENT_CONFIRMATION_MISSING: "PRESENT",
        PAYMENT_CAPTURED_VIA_WEBHOOK: "PRESENT",
        CAPTURE_EXISTS_ORDER_NOT_PAID: "PRESENT",
      }),
    );
    expect(codesOf(result)).toEqual(["RC-009", "RC-010"]);
    // The ordering comes from frozen precedence, not from understating
    // RC-010's evidence.
    for (const candidate of result.rankedCandidates) {
      expect(candidate.matchTier, candidate.code).toBe("DIRECT_EVIDENCE");
      expect(candidate.strength, candidate.code).toBe("STRONG_EVIDENCE");
    }
  });

  it("C5: RC-013 still outranks RC-010 with both at DIRECT_EVIDENCE", () => {
    const result = classifyRootCause(
      pack("INV-011", "C11"),
      signals({
        FAILURE_EVENT_MARKED_PAID: "PRESENT",
        OUT_OF_ORDER_STATE_REGRESSION: "PRESENT",
      }),
    );
    expect(codesOf(result)).toEqual(["RC-013", "RC-010"]);
    for (const candidate of result.rankedCandidates) {
      expect(candidate.matchTier, candidate.code).toBe("DIRECT_EVIDENCE");
      expect(candidate.strength, candidate.code).toBe("STRONG_EVIDENCE");
    }
  });

  it("C6: ranking is unchanged when the same evidence is built in another order", () => {
    const forward = classifyRootCause(
      pack("INV-011", "C07"),
      signals({
        CLIENT_CONFIRMATION_MISSING: "PRESENT",
        PAYMENT_CAPTURED_VIA_WEBHOOK: "PRESENT",
        CAPTURE_EXISTS_ORDER_NOT_PAID: "PRESENT",
      }),
    );
    const reversed = classifyRootCause(
      pack("INV-011", "C07"),
      signals({
        CAPTURE_EXISTS_ORDER_NOT_PAID: "PRESENT",
        PAYMENT_CAPTURED_VIA_WEBHOOK: "PRESENT",
        CLIENT_CONFIRMATION_MISSING: "PRESENT",
      }),
    );
    expect(codesOf(reversed)).toEqual(codesOf(forward));
    expect(reversed).toEqual(forward);
  });
});
