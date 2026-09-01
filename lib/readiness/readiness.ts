/**
 * Phase 4G — the PURE `GO-LIVE-READINESS-V1` evaluator.
 *
 * ```text
 * frozen 4F ReliabilityScoreReadModel + explicit gate states
 *   -> NOT READY blockers        (any one wins)
 *     -> NEEDS ATTENTION reasons (any one prevents READY)
 *       -> READY                 (only when every prerequisite passed)
 * ```
 *
 * PURE. No I/O, no database, no network, no environment, no filesystem, no
 * clock, no randomness, no React, no Razorpay, no AI. Given the same input it
 * returns a deep-equal result every time, and it never mutates its input.
 *
 * IT CONSUMES THE SCORE, IT DOES NOT RECOMPUTE IT. The four current scenario
 * states and the score come from the frozen Phase 4F read model. There is no
 * second deduction table, no second eligibility matrix, no second latest-run
 * selector and no re-reading of `chaos_runs` here — a copy could only ever
 * drift from `lib/reliability/score.ts`.
 *
 * FINDINGS AFFECT READINESS ONLY. An unresolved Finding never changes the
 * Reliability Score; `RELIABILITY-V1` arithmetic is untouched by this module.
 * Applying Findings in both places would double-count the same fact.
 *
 * UNKNOWN IS NEVER PASS. This is the rule that matters most here. A gate that
 * could not be authoritatively established is `UNKNOWN`, which blocks READY
 * without claiming a failure. Fabricating a `PASS` for an unverified
 * prerequisite — a manual verification, a security review, a build — would
 * make READY a statement nobody actually checked.
 */

import {
  READINESS_ALGORITHM_VERSION,
  READINESS_ATTENTION_REASONS,
  READINESS_BLOCKING_REASONS,
  READINESS_DISCLAIMER,
  READINESS_READY_REASON,
  READINESS_REASON_TEXT,
} from "./types";

import type {
  GoLiveReadinessV1,
  ReadinessAttentionReasonCode,
  ReadinessBlockingReasonCode,
  ReadinessEvaluationInput,
  ReadinessGateResult,
  ReadinessGateState,
  ReadinessReason,
} from "./types";

// ============================================================================
// HELPERS
// ============================================================================

function blocking(
  code: ReadinessBlockingReasonCode,
  subject: string | null = null,
): ReadinessReason {
  return { code, text: READINESS_REASON_TEXT[code], subject };
}

function attention(
  code: ReadinessAttentionReasonCode,
  subject: string | null = null,
): ReadinessReason {
  return { code, text: READINESS_REASON_TEXT[code], subject };
}

/** The scenario states that are inconclusive — never counted as PASS. */
const INCONCLUSIVE_STATES = ["UNKNOWN", "BLOCKED", "ERROR", "NOT_RUN"] as const;

/** Safe wording for a gate, derived from its state alone. */
function gateDetail(state: ReadinessGateState, subject: string): string {
  if (state === "PASS") return `${subject} passed on current evidence.`;
  if (state === "FAIL") return `${subject} did not pass.`;
  return `${subject} is not verified by the current runtime evidence.`;
}

// ============================================================================
// THE EVALUATOR
// ============================================================================

/**
 * Evaluates Go-Live Readiness from already-established evidence.
 *
 * Precedence is strict and non-negotiable:
 * `NOT READY` > `NEEDS ATTENTION` > `READY`. A blocker present alongside
 * attention reasons still yields `NOT READY`, and both reason lists are
 * always reported so an operator sees the whole picture rather than only the
 * first problem found.
 */
export function evaluateGoLiveReadinessV1(
  input: ReadinessEvaluationInput,
): GoLiveReadinessV1 {
  const {
    reliability,
    testModeSecurityGate,
    healthyBaselineGate,
    selectedRunInvariantGates,
    unresolvedFindings,
    realRazorpayManualVerificationGate,
    buildGate,
    securityVerificationGate,
    automatedTestGate,
    manualVerificationGate,
  } = input;

  const breakdown = reliability.score.scenarioBreakdown;
  const score = reliability.score.score;

  const blockingReasons: ReadinessReason[] = [];
  const attentionReasons: ReadinessReason[] = [];

  // --- NOT READY blockers -------------------------------------------------

  if (testModeSecurityGate === "FAIL") {
    blockingReasons.push(blocking("NR_TEST_MODE_SECURITY_FAILED"));
  }
  if (healthyBaselineGate === "FAIL") {
    blockingReasons.push(blocking("NR_HEALTHY_BASELINE_FAILED"));
  }
  for (const entry of breakdown) {
    if (entry.state === "FAIL") {
      blockingReasons.push(
        blocking("NR_MANDATORY_SCENARIO_FAILED", entry.scenarioId),
      );
    }
  }
  const highRiskFindings = unresolvedFindings.filter(
    (finding) => finding.severity === "CRITICAL" || finding.severity === "HIGH",
  );
  for (const finding of highRiskFindings) {
    blockingReasons.push(
      blocking("NR_UNRESOLVED_HIGH_RISK_FINDING", finding.findingId),
    );
  }

  // --- NEEDS ATTENTION reasons --------------------------------------------

  if (score < 100) {
    attentionReasons.push(attention("NA_SCORE_BELOW_100"));
  }
  for (const entry of breakdown) {
    if ((INCONCLUSIVE_STATES as readonly string[]).includes(entry.state)) {
      attentionReasons.push(
        attention("NA_MANDATORY_SCENARIO_INCONCLUSIVE", entry.scenarioId),
      );
    }
  }
  const lowerRiskFindings = unresolvedFindings.filter(
    (finding) => finding.severity === "MEDIUM" || finding.severity === "LOW",
  );
  for (const finding of lowerRiskFindings) {
    attentionReasons.push(
      attention("NA_UNRESOLVED_LOWER_RISK_FINDING", finding.findingId),
    );
  }

  /**
   * The conservative totality rule. Every READY prerequisite that is not
   * positively `PASS` — including one that is merely `UNKNOWN` — prevents
   * READY. It is reported as an incomplete verification, not as a failure,
   * because "we have not checked" is not the same claim as "it broke".
   */
  const readyPrerequisites: readonly (readonly [string, ReadinessGateState])[] =
    [
      ["TEST_MODE_SECURITY", testModeSecurityGate],
      ["HEALTHY_BASELINE", healthyBaselineGate],
      ["REAL_RAZORPAY_MANUAL_VERIFICATION", realRazorpayManualVerificationGate],
      ["BUILD_VERIFICATION", buildGate],
      ["SECURITY_VERIFICATION", securityVerificationGate],
      ["AUTOMATED_TEST_VERIFICATION", automatedTestGate],
      ["MANUAL_VERIFICATION", manualVerificationGate],
      // An EMPTY list is itself an unverified prerequisite, not a vacuous
      // pass: "we hold no invariant evidence for the selected runs" must
      // never satisfy a READY gate. Without this the `.map` below would
      // contribute nothing and READY would be reachable with no evidence at
      // all.
      ...(selectedRunInvariantGates.length === 0
        ? ([["SELECTED_RUN_INVARIANTS", "UNKNOWN"]] as const)
        : selectedRunInvariantGates.map(
            (gate) =>
              [
                `SELECTED_RUN_INVARIANTS:${gate.scenarioId}`,
                gate.state,
              ] as const,
          )),
    ];

  for (const [subject, state] of readyPrerequisites) {
    // A FAIL on a blocking gate is already recorded above as a blocker; a
    // FAIL here that has no blocker (the invariant gates) still prevents
    // READY, and an UNKNOWN always does.
    if (state !== "PASS") {
      attentionReasons.push(
        attention("NA_REQUIRED_VERIFICATION_INCOMPLETE", subject),
      );
    }
  }

  // --- The verdict --------------------------------------------------------

  const status =
    blockingReasons.length > 0
      ? "NOT READY"
      : attentionReasons.length > 0
        ? "NEEDS ATTENTION"
        : "READY";

  // --- The explainable gate checklist -------------------------------------

  const scenariosFailing = breakdown.some((entry) => entry.state === "FAIL");
  const scenariosInconclusive = breakdown.some((entry) =>
    (INCONCLUSIVE_STATES as readonly string[]).includes(entry.state),
  );
  const scenarioGateState: ReadinessGateState = scenariosFailing
    ? "FAIL"
    : scenariosInconclusive
      ? "UNKNOWN"
      : "PASS";

  const invariantGateState: ReadinessGateState =
    selectedRunInvariantGates.length === 0
      ? "UNKNOWN"
      : selectedRunInvariantGates.some((gate) => gate.state === "FAIL")
        ? "FAIL"
        : selectedRunInvariantGates.some((gate) => gate.state === "UNKNOWN")
          ? "UNKNOWN"
          : "PASS";

  const findingsGateState: ReadinessGateState =
    highRiskFindings.length > 0
      ? "FAIL"
      : lowerRiskFindings.length > 0
        ? "UNKNOWN"
        : "PASS";

  const gates: ReadinessGateResult[] = [
    {
      gateId: "TEST_MODE_SECURITY",
      state: testModeSecurityGate,
      detail: gateDetail(
        testModeSecurityGate,
        "Test Mode and security enforcement",
      ),
    },
    {
      gateId: "HEALTHY_BASELINE",
      state: healthyBaselineGate,
      detail: gateDetail(healthyBaselineGate, "The required healthy baseline"),
    },
    {
      gateId: "MANDATORY_SCENARIOS",
      state: scenarioGateState,
      detail:
        scenarioGateState === "PASS"
          ? "All four mandatory P0 scenarios currently PASS."
          : scenarioGateState === "FAIL"
            ? "At least one mandatory P0 scenario currently FAILS."
            : "At least one mandatory P0 scenario is inconclusive, which is never counted as PASS.",
    },
    {
      gateId: "SELECTED_RUN_INVARIANTS",
      state: invariantGateState,
      detail: gateDetail(
        invariantGateState,
        "Persisted invariant evidence for the selected current runs",
      ),
    },
    {
      gateId: "UNRESOLVED_FINDINGS",
      state: findingsGateState,
      detail:
        findingsGateState === "PASS"
          ? "No unresolved P0 finding remains."
          : findingsGateState === "FAIL"
            ? `${highRiskFindings.length} unresolved CRITICAL or HIGH P0 finding(s) remain.`
            : `${lowerRiskFindings.length} unresolved MEDIUM or LOW P0 finding(s) remain.`,
    },
    {
      gateId: "RELIABILITY_SCORE",
      state: score === 100 ? "PASS" : "UNKNOWN",
      detail:
        score === 100
          ? "The Reliability Score is 100."
          : `The Reliability Score is ${score}, below the 100 required for READY.`,
    },
    {
      gateId: "REAL_RAZORPAY_MANUAL_VERIFICATION",
      state: realRazorpayManualVerificationGate,
      detail: gateDetail(
        realRazorpayManualVerificationGate,
        "Manual verification of a real Razorpay Test Mode order, payment and webhook",
      ),
    },
    {
      gateId: "BUILD_VERIFICATION",
      state: buildGate,
      detail: gateDetail(buildGate, "Build verification"),
    },
    {
      gateId: "SECURITY_VERIFICATION",
      state: securityVerificationGate,
      detail: gateDetail(
        securityVerificationGate,
        "Security review verification",
      ),
    },
    {
      gateId: "AUTOMATED_TEST_VERIFICATION",
      state: automatedTestGate,
      detail: gateDetail(automatedTestGate, "Automated test verification"),
    },
    {
      gateId: "MANUAL_VERIFICATION",
      state: manualVerificationGate,
      detail: gateDetail(manualVerificationGate, "Manual verification"),
    },
  ];

  return {
    version: READINESS_ALGORITHM_VERSION,
    status,
    score,
    blockingReasons,
    // Reported even when a blocker is present: an operator should see
    // everything standing between the project and READY, not only the first
    // problem found.
    attentionReasons,
    gates,
    disclaimer: READINESS_DISCLAIMER,
  };
}

/** Re-exported so a caller can enumerate the frozen vocabularies. */
export {
  READINESS_ATTENTION_REASONS,
  READINESS_BLOCKING_REASONS,
  READINESS_READY_REASON,
};
