import { describe, expect, it } from "vitest";

import { evaluateGoLiveReadinessV1 } from "@/lib/readiness/readiness";
import { READINESS_DISCLAIMER } from "@/lib/readiness/types";

import type {
  ReadinessEvaluationInput,
  ReadinessGateState,
  ReadinessScenarioInvariantGate,
  ReadinessUnresolvedFinding,
} from "@/lib/readiness/types";
import type { ReliabilityScoreReadModel } from "@/lib/reliability/service";
import type {
  ReliabilityScenarioBreakdown,
  ReliabilityScenarioId,
  ReliabilityScenarioState,
} from "@/lib/reliability/types";
import type { InvariantResultSeverity } from "@/lib/supabase/types";

/**
 * Phase 4G — the pure `GO-LIVE-READINESS-V1` evaluator.
 *
 * No database, no mocks of a database, no network, no clock. Every case below
 * is a real assertion about the real decision rules.
 *
 * The properties that matter most: precedence is strict, UNKNOWN is never
 * treated as PASS, and READY is only reachable when every prerequisite is
 * positively established.
 */

const SCENARIOS: readonly ReliabilityScenarioId[] = [
  "C01",
  "C03",
  "C07",
  "C11",
];

const GENUINE: Record<ReliabilityScenarioId, string> = {
  C01: "RECORDED_TEST_EVIDENCE",
  C03: "SYNTHETIC_DEMO",
  C07: "RECORDED_TEST_EVIDENCE",
  C11: "RECORDED_TEST_EVIDENCE",
};

function breakdownRow(
  scenarioId: ReliabilityScenarioId,
  state: ReliabilityScenarioState,
  deduction: number,
): ReliabilityScenarioBreakdown {
  return {
    scenarioId,
    state,
    deduction,
    requiredDataClassification: GENUINE[
      scenarioId
    ] as ReliabilityScenarioBreakdown["requiredDataClassification"],
    eligibleCandidateCount: 1,
    selectedRunId: `run-${scenarioId}`,
    selectedDataClassification: GENUINE[
      scenarioId
    ] as ReliabilityScenarioBreakdown["selectedDataClassification"],
    selectedRunStatus: "COMPLETED",
    selectedRunOutcome: state === "PASS" ? "PASS" : "UNKNOWN",
    selectedRunCreatedAt: "2026-09-01T00:00:00.000Z",
    selectedRunCompletedAt: "2026-09-01T00:05:00.000Z",
    supportingFailedInvariantResultId: null,
    supportingInvariantId: null,
    supportingSeverity: null,
    provenanceLabel:
      scenarioId === "C03"
        ? "Controlled PayChaos security simulation"
        : "Recorded test evidence",
  };
}

/** A reliability read model with the given per-scenario states. */
function reliability(
  states: Partial<Record<ReliabilityScenarioId, ReliabilityScenarioState>> = {},
): ReliabilityScoreReadModel {
  const rows = SCENARIOS.map((id) => {
    const state = states[id] ?? "PASS";
    const deduction = state === "PASS" ? 0 : state === "FAIL" ? 25 : 15;
    return breakdownRow(id, state, deduction);
  });
  const totalDeduction = rows.reduce((sum, row) => sum + row.deduction, 0);

  return {
    score: {
      algorithmVersion: "RELIABILITY-V1",
      selectionVersion: "LATEST_SELECTION_V1",
      score: Math.max(0, 100 - totalDeduction),
      totalDeduction,
      scenarioBreakdown: rows,
    },
    selectionDiagnostics: SCENARIOS.map((id) => ({
      scenarioId: id,
      totalCandidateCount: 1,
      eligibleCandidateCount: 1,
      ineligibleCandidateCount: 0,
      selectionReason: "LATEST_ELIGIBLE_RUN",
    })),
  };
}

function invariantGates(
  state: ReadinessGateState = "PASS",
): readonly ReadinessScenarioInvariantGate[] {
  return SCENARIOS.map((scenarioId) => ({ scenarioId, state }));
}

function finding(
  severity: InvariantResultSeverity,
  findingId = `finding-${severity}`,
): ReadinessUnresolvedFinding {
  return { findingId, severity };
}

/** Everything passing: the only shape from which READY is reachable. */
function readyInput(
  overrides: Partial<ReadinessEvaluationInput> = {},
): ReadinessEvaluationInput {
  return {
    reliability: reliability(),
    testModeSecurityGate: "PASS",
    healthyBaselineGate: "PASS",
    selectedRunInvariantGates: invariantGates("PASS"),
    unresolvedFindings: [],
    realRazorpayManualVerificationGate: "PASS",
    buildGate: "PASS",
    securityVerificationGate: "PASS",
    automatedTestGate: "PASS",
    manualVerificationGate: "PASS",
    ...overrides,
  };
}

function codesOf(reasons: readonly { code: string }[]): string[] {
  return reasons.map((reason) => reason.code);
}

// ============================================================================
// READY
// ============================================================================

describe("GO-LIVE-READINESS-V1 — READY", () => {
  it("READY-01: score 100, four PASS, no findings, all gates PASS -> READY", () => {
    const result = evaluateGoLiveReadinessV1(readyInput());

    expect(result.version).toBe("GO-LIVE-READINESS-V1");
    expect(result.status).toBe("READY");
    expect(result.score).toBe(100);
    expect(result.blockingReasons).toEqual([]);
    expect(result.attentionReasons).toEqual([]);
    expect(result.disclaimer).toBe(READINESS_DISCLAIMER);
  });

  it("READY-02: the score is copied from the 4F model, never recomputed", () => {
    const model = reliability();
    const result = evaluateGoLiveReadinessV1(
      readyInput({ reliability: model }),
    );
    expect(result.score).toBe(model.score.score);
  });
});

// ============================================================================
// NOT READY
// ============================================================================

describe("GO-LIVE-READINESS-V1 — NOT READY blockers", () => {
  it("NR-01: a failed healthy baseline blocks", () => {
    const result = evaluateGoLiveReadinessV1(
      readyInput({ healthyBaselineGate: "FAIL" }),
    );
    expect(result.status).toBe("NOT READY");
    expect(codesOf(result.blockingReasons)).toContain(
      "NR_HEALTHY_BASELINE_FAILED",
    );
  });

  it("NR-02: failed Test Mode / security enforcement blocks", () => {
    const result = evaluateGoLiveReadinessV1(
      readyInput({ testModeSecurityGate: "FAIL" }),
    );
    expect(result.status).toBe("NOT READY");
    expect(codesOf(result.blockingReasons)).toContain(
      "NR_TEST_MODE_SECURITY_FAILED",
    );
  });

  it("NR-03: a mandatory scenario currently FAILING blocks", () => {
    const result = evaluateGoLiveReadinessV1(
      readyInput({ reliability: reliability({ C07: "FAIL" }) }),
    );
    expect(result.status).toBe("NOT READY");
    const reason = result.blockingReasons.find(
      (r) => r.code === "NR_MANDATORY_SCENARIO_FAILED",
    );
    expect(reason?.subject).toBe("C07");
  });

  it("NR-04: an unresolved CRITICAL finding blocks", () => {
    const result = evaluateGoLiveReadinessV1(
      readyInput({ unresolvedFindings: [finding("CRITICAL")] }),
    );
    expect(result.status).toBe("NOT READY");
    expect(codesOf(result.blockingReasons)).toContain(
      "NR_UNRESOLVED_HIGH_RISK_FINDING",
    );
  });

  it("NR-05: an unresolved HIGH finding blocks", () => {
    const result = evaluateGoLiveReadinessV1(
      readyInput({ unresolvedFindings: [finding("HIGH")] }),
    );
    expect(result.status).toBe("NOT READY");
    expect(codesOf(result.blockingReasons)).toContain(
      "NR_UNRESOLVED_HIGH_RISK_FINDING",
    );
  });

  it("NR-06: every failing scenario is named, not just the first", () => {
    const result = evaluateGoLiveReadinessV1(
      readyInput({ reliability: reliability({ C01: "FAIL", C11: "FAIL" }) }),
    );
    const subjects = result.blockingReasons
      .filter((r) => r.code === "NR_MANDATORY_SCENARIO_FAILED")
      .map((r) => r.subject);
    expect(subjects).toEqual(["C01", "C11"]);
  });
});

// ============================================================================
// NEEDS ATTENTION
// ============================================================================

describe("GO-LIVE-READINESS-V1 — NEEDS ATTENTION", () => {
  it("NA-01: score below 100 with an UNKNOWN scenario", () => {
    const result = evaluateGoLiveReadinessV1(
      readyInput({
        reliability: reliability({ C01: "UNKNOWN" }),
        selectedRunInvariantGates: invariantGates("PASS"),
      }),
    );

    expect(result.status).toBe("NEEDS ATTENTION");
    expect(result.score).toBe(85);
    expect(codesOf(result.attentionReasons)).toContain("NA_SCORE_BELOW_100");
    const inconclusive = result.attentionReasons.find(
      (r) => r.code === "NA_MANDATORY_SCENARIO_INCONCLUSIVE",
    );
    expect(inconclusive?.subject).toBe("C01");
    expect(result.blockingReasons).toEqual([]);
  });

  it.each(["BLOCKED", "ERROR", "NOT_RUN"] as const)(
    "NA-02/03/04: a %s scenario is inconclusive, never PASS",
    (state) => {
      const result = evaluateGoLiveReadinessV1(
        readyInput({ reliability: reliability({ C11: state }) }),
      );
      expect(result.status).toBe("NEEDS ATTENTION");
      const reason = result.attentionReasons.find(
        (r) => r.code === "NA_MANDATORY_SCENARIO_INCONCLUSIVE",
      );
      expect(reason?.subject).toBe("C11");
      expect(reason?.text).toContain("never counted as PASS");
    },
  );

  it("NA-05: an unresolved MEDIUM finding needs attention", () => {
    const result = evaluateGoLiveReadinessV1(
      readyInput({ unresolvedFindings: [finding("MEDIUM")] }),
    );
    expect(result.status).toBe("NEEDS ATTENTION");
    expect(codesOf(result.attentionReasons)).toContain(
      "NA_UNRESOLVED_LOWER_RISK_FINDING",
    );
    expect(result.blockingReasons).toEqual([]);
  });

  it("NA-06: an unresolved LOW finding needs attention", () => {
    const result = evaluateGoLiveReadinessV1(
      readyInput({ unresolvedFindings: [finding("LOW")] }),
    );
    expect(result.status).toBe("NEEDS ATTENTION");
    expect(codesOf(result.attentionReasons)).toContain(
      "NA_UNRESOLVED_LOWER_RISK_FINDING",
    );
  });

  it.each([
    ["realRazorpayManualVerificationGate", "REAL_RAZORPAY_MANUAL_VERIFICATION"],
    ["buildGate", "BUILD_VERIFICATION"],
    ["securityVerificationGate", "SECURITY_VERIFICATION"],
    ["automatedTestGate", "AUTOMATED_TEST_VERIFICATION"],
    ["manualVerificationGate", "MANUAL_VERIFICATION"],
    ["healthyBaselineGate", "HEALTHY_BASELINE"],
    ["testModeSecurityGate", "TEST_MODE_SECURITY"],
  ] as const)(
    "NA-07: a perfect score with %s UNKNOWN still cannot be READY",
    (gateKey, subject) => {
      const result = evaluateGoLiveReadinessV1(
        readyInput({
          [gateKey]: "UNKNOWN",
        } as Partial<ReadinessEvaluationInput>),
      );

      // UNKNOWN is not a failure — but it is never silently a PASS either.
      expect(result.status).toBe("NEEDS ATTENTION");
      expect(result.blockingReasons).toEqual([]);
      const reason = result.attentionReasons.find(
        (r) => r.code === "NA_REQUIRED_VERIFICATION_INCOMPLETE",
      );
      expect(reason?.subject).toBe(subject);
    },
  );

  it("NA-08: an UNKNOWN selected-run invariant gate prevents READY", () => {
    const result = evaluateGoLiveReadinessV1(
      readyInput({
        selectedRunInvariantGates: [
          { scenarioId: "C01", state: "UNKNOWN" },
          { scenarioId: "C03", state: "PASS" },
          { scenarioId: "C07", state: "PASS" },
          { scenarioId: "C11", state: "PASS" },
        ],
      }),
    );
    expect(result.status).toBe("NEEDS ATTENTION");
    expect(
      result.attentionReasons.some(
        (r) => r.subject === "SELECTED_RUN_INVARIANTS:C01",
      ),
    ).toBe(true);
  });
});

// ============================================================================
// PRECEDENCE AND FAIL-CLOSED
// ============================================================================

describe("GO-LIVE-READINESS-V1 — precedence and fail-closed", () => {
  it("PREC-01: a scenario FAIL plus a low score plus unknown gates is NOT READY", () => {
    const result = evaluateGoLiveReadinessV1(
      readyInput({
        reliability: reliability({ C01: "FAIL" }),
        manualVerificationGate: "UNKNOWN",
      }),
    );

    // NOT READY wins outright, even though attention reasons also exist.
    expect(result.status).toBe("NOT READY");
    expect(result.score).toBeLessThan(100);
    expect(result.attentionReasons.length).toBeGreaterThan(0);
  });

  it("PREC-02: an unresolved HIGH finding plus an UNKNOWN scenario is NOT READY", () => {
    const result = evaluateGoLiveReadinessV1(
      readyInput({
        reliability: reliability({ C07: "UNKNOWN" }),
        unresolvedFindings: [finding("HIGH")],
      }),
    );
    expect(result.status).toBe("NOT READY");
  });

  it("PREC-03: both reason lists are reported, not only the winning one", () => {
    const result = evaluateGoLiveReadinessV1(
      readyInput({
        reliability: reliability({ C01: "FAIL", C11: "UNKNOWN" }),
        unresolvedFindings: [finding("CRITICAL"), finding("LOW")],
      }),
    );

    expect(result.status).toBe("NOT READY");
    expect(codesOf(result.blockingReasons)).toContain(
      "NR_MANDATORY_SCENARIO_FAILED",
    );
    expect(codesOf(result.blockingReasons)).toContain(
      "NR_UNRESOLVED_HIGH_RISK_FINDING",
    );
    expect(codesOf(result.attentionReasons)).toContain(
      "NA_UNRESOLVED_LOWER_RISK_FINDING",
    );
  });

  it("FAILCLOSED-01: an internally inconsistent input is never READY", () => {
    // A perfect score claimed alongside a FAILING scenario is contradictory.
    // Readiness must refuse rather than believe the flattering half.
    const inconsistent = reliability();
    const contradictory: ReliabilityScoreReadModel = {
      ...inconsistent,
      score: {
        ...inconsistent.score,
        score: 100,
        totalDeduction: 0,
        scenarioBreakdown: [
          { ...inconsistent.score.scenarioBreakdown[0]!, state: "FAIL" },
          ...inconsistent.score.scenarioBreakdown.slice(1),
        ],
      },
    };

    const result = evaluateGoLiveReadinessV1(
      readyInput({ reliability: contradictory }),
    );
    expect(result.status).toBe("NOT READY");
    expect(result.status).not.toBe("READY");
  });

  it("FAILCLOSED-02: no selected-run invariant gates at all is never READY", () => {
    const result = evaluateGoLiveReadinessV1(
      readyInput({ selectedRunInvariantGates: [] }),
    );
    // Absence of evidence is not evidence of correctness.
    expect(result.status).not.toBe("READY");
    const gate = result.gates.find(
      (g) => g.gateId === "SELECTED_RUN_INVARIANTS",
    );
    expect(gate?.state).toBe("UNKNOWN");
  });

  it("FAILCLOSED-03: a FAILING invariant gate prevents READY", () => {
    const result = evaluateGoLiveReadinessV1(
      readyInput({
        selectedRunInvariantGates: [
          { scenarioId: "C01", state: "FAIL" },
          { scenarioId: "C03", state: "PASS" },
          { scenarioId: "C07", state: "PASS" },
          { scenarioId: "C11", state: "PASS" },
        ],
      }),
    );
    expect(result.status).not.toBe("READY");
  });
});

// ============================================================================
// DETERMINISM, PURITY AND THE GATE CHECKLIST
// ============================================================================

describe("GO-LIVE-READINESS-V1 — determinism and output shape", () => {
  it("DETERMINISM-01: the same input twice yields a deep-equal result", () => {
    const input = readyInput({
      reliability: reliability({ C01: "UNKNOWN" }),
      unresolvedFindings: [finding("MEDIUM")],
    });
    expect(evaluateGoLiveReadinessV1(input)).toEqual(
      evaluateGoLiveReadinessV1(input),
    );
  });

  it("IMMUTABILITY-01: the caller's inputs are never mutated", () => {
    const findings = [finding("MEDIUM"), finding("LOW")];
    const gates = invariantGates("PASS");
    const model = reliability({ C01: "UNKNOWN" });
    const findingsBefore = [...findings];
    const gatesBefore = [...gates];
    const breakdownBefore = [...model.score.scenarioBreakdown];

    evaluateGoLiveReadinessV1(
      readyInput({
        reliability: model,
        unresolvedFindings: findings,
        selectedRunInvariantGates: gates,
      }),
    );

    expect(findings).toEqual(findingsBefore);
    expect(gates).toEqual(gatesBefore);
    expect(model.score.scenarioBreakdown).toEqual(breakdownBefore);
  });

  it("GATES-01: every frozen gate appears, in stable order", () => {
    const result = evaluateGoLiveReadinessV1(readyInput());
    expect(result.gates.map((g) => g.gateId)).toEqual([
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
    ]);
  });

  it("GATES-02: an UNKNOWN gate reads as unverified, not as failed", () => {
    const result = evaluateGoLiveReadinessV1(
      readyInput({ buildGate: "UNKNOWN" }),
    );
    const gate = result.gates.find((g) => g.gateId === "BUILD_VERIFICATION");
    expect(gate?.state).toBe("UNKNOWN");
    expect(gate?.detail).toContain("not verified by the current runtime");
    expect(gate?.detail).not.toContain("did not pass");
  });

  it("GATES-03: the score gate reports the real score, below 100", () => {
    const result = evaluateGoLiveReadinessV1(
      readyInput({ reliability: reliability({ C01: "UNKNOWN" }) }),
    );
    const gate = result.gates.find((g) => g.gateId === "RELIABILITY_SCORE");
    expect(gate?.state).toBe("UNKNOWN");
    expect(gate?.detail).toContain("85");
  });

  it("DISCLAIMER-01: the exact mandatory disclaimer is always carried", () => {
    for (const input of [
      readyInput(),
      readyInput({ reliability: reliability({ C01: "FAIL" }) }),
      readyInput({ reliability: reliability({ C01: "UNKNOWN" }) }),
    ]) {
      const result = evaluateGoLiveReadinessV1(input);
      expect(result.disclaimer).toBe(
        "PayChaos Go-Live Readiness is an engineering assessment from the implemented PayChaos test suite. It is not Razorpay certification.",
      );
    }
  });

  it("NO-CERTIFICATION-01: no reason or gate text claims approval", () => {
    const serialized = JSON.stringify(evaluateGoLiveReadinessV1(readyInput()));
    for (const forbidden of [
      "Razorpay approved",
      "Razorpay certified",
      "safe for production",
      "guaranteed production ready",
      "guaranteed",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});
