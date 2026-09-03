import { describe, expect, it } from "vitest";

import { calculateReliabilityScoreV1 } from "@/lib/reliability/score";
import {
  RELIABILITY_MANDATORY_SCENARIOS,
  RELIABILITY_STARTING_SCORE,
  RELIABILITY_STATE_DEDUCTION,
  type ReliabilityCandidateInvariantResult,
  type ReliabilityCandidateRun,
} from "@/lib/reliability/types";

/**
 * Phase 5 final audit — the Reliability Score transition matrix.
 *
 * WHY THIS FILE EXISTS. The deployed score reads 40/100 after a Demo Reset,
 * and stays 40 after an ordinary successful or failed Test Mode payment. That
 * looked wrong enough to be worth settling with evidence rather than opinion,
 * because the tempting "fix" — making a payment move the number — would break
 * the one thing the score is for.
 *
 * These tests do not introduce a rule. They exercise the existing frozen
 * scorer across the states an operator can actually produce, so the answer is
 * derived from the implementation rather than asserted about it.
 *
 * THE MODEL, stated once: score = max(0, 100 - sum of the deductions for
 * exactly the four mandatory P0 scenarios). Nothing else is an input.
 */

const NOW = "2026-01-01T00:00:00.000Z";

/** A finished run for one scenario, in whatever outcome the case needs. */
function run(
  scenarioId: (typeof RELIABILITY_MANDATORY_SCENARIOS)[number],
  outcome: "PASS" | "FAIL",
): ReliabilityCandidateRun {
  return {
    id: `run-${scenarioId}`,
    scenarioId,
    status: "COMPLETED",
    outcome,
    dataClassification:
      scenarioId === "C03" ? "SYNTHETIC_DEMO" : "RECORDED_TEST_EVIDENCE",
    createdAt: NOW,
    completedAt: NOW,
  };
}

/** The invariant row that justifies a FAIL, at a chosen severity. */
function failedInvariant(
  scenarioId: (typeof RELIABILITY_MANDATORY_SCENARIOS)[number],
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
): ReliabilityCandidateInvariantResult {
  return {
    id: `inv-${scenarioId}`,
    chaosRunId: `run-${scenarioId}`,
    invariantId: "INV-003",
    result: "FAIL",
    severity,
  };
}

function passedInvariant(
  scenarioId: (typeof RELIABILITY_MANDATORY_SCENARIOS)[number],
): ReliabilityCandidateInvariantResult {
  return {
    id: `inv-${scenarioId}`,
    chaosRunId: `run-${scenarioId}`,
    invariantId: "INV-003",
    result: "PASS",
    severity: "CRITICAL",
  };
}

function scoreOf(
  runs: ReliabilityCandidateRun[],
  results: ReliabilityCandidateInvariantResult[],
): number {
  return calculateReliabilityScoreV1({
    candidateRuns: runs,
    invariantResults: results,
  }).score;
}

describe("score audit — the fresh / post-reset state", () => {
  it("1: an empty database scores exactly 40", () => {
    // The deployed observation, reproduced from the implementation: four
    // mandatory scenarios, each NOT_RUN at 15, so 100 - 60.
    const result = calculateReliabilityScoreV1({
      candidateRuns: [],
      invariantResults: [],
    });

    expect(result.score).toBe(40);
    expect(result.totalDeduction).toBe(60);
    expect(result.scenarioBreakdown).toHaveLength(4);
    for (const entry of result.scenarioBreakdown) {
      expect(entry.state, entry.scenarioId).toBe("NOT_RUN");
      expect(entry.deduction, entry.scenarioId).toBe(15);
    }
  });

  it("2: 40 is arithmetic, not a magic number", () => {
    // Derived from the frozen table rather than hardcoded, so changing the
    // table changes this expectation instead of silently disagreeing with it.
    const expected =
      RELIABILITY_STARTING_SCORE -
      RELIABILITY_MANDATORY_SCENARIOS.length *
        RELIABILITY_STATE_DEDUCTION.NOT_RUN;

    expect(expected).toBe(40);
  });
});

describe("score audit — an ordinary payment is NOT an input", () => {
  it("3: a successful Test Mode payment leaves the score at 40", () => {
    // THE HEADLINE FINDING, and the one worth being careful about. The score
    // answers "has this integration been tested against the mandatory failure
    // scenarios?", not "did a payment work?". A payment that moved the number
    // would let an untested integration look reliable simply because the happy
    // path succeeded once — exactly the false confidence this product exists
    // to remove.
    //
    // The scorer takes only chaos runs and invariant results, so a payment
    // cannot reach it: there is no argument through which it could.
    expect(scoreOf([], [])).toBe(40);
  });

  it("4: a failed Test Mode payment also leaves the score at 40", () => {
    // Same reasoning. A failed payment is normal merchant traffic, not
    // evidence about reliability, and C11 is the scenario that decides
    // whether a failure was handled correctly.
    expect(scoreOf([], [])).toBe(40);
  });
});

describe("score audit — each scenario moves the score independently", () => {
  it("5: one PASS removes exactly that scenario's deduction", () => {
    for (const scenarioId of RELIABILITY_MANDATORY_SCENARIOS) {
      expect(
        scoreOf([run(scenarioId, "PASS")], [passedInvariant(scenarioId)]),
        scenarioId,
      ).toBe(55);
    }
  });

  it("6: one CRITICAL FAIL deducts 25 instead of 15", () => {
    for (const scenarioId of RELIABILITY_MANDATORY_SCENARIOS) {
      // Three NOT_RUN (45) + one CRITICAL FAIL (25) = 70 deducted.
      expect(
        scoreOf(
          [run(scenarioId, "FAIL")],
          [failedInvariant(scenarioId, "CRITICAL")],
        ),
        scenarioId,
      ).toBe(30);
    }
  });

  it("7: FAIL severity changes the deduction, as the frozen table says", () => {
    const cases = [
      ["CRITICAL", 30],
      ["HIGH", 35],
      ["MEDIUM", 40],
      ["LOW", 45],
    ] as const;

    for (const [severity, expected] of cases) {
      expect(
        scoreOf([run("C01", "FAIL")], [failedInvariant("C01", severity)]),
        severity,
      ).toBe(expected);
    }
  });

  it("8: a MEDIUM FAIL scores the same as NOT RUN — and that is deliberate", () => {
    // Worth stating rather than hiding: a MEDIUM failure and an untested
    // scenario both deduct 15, so the SCORE alone cannot tell them apart.
    // The scenario breakdown and Go-Live Readiness do, which is why neither
    // screen shows the number on its own.
    expect(
      scoreOf([run("C01", "FAIL")], [failedInvariant("C01", "MEDIUM")]),
    ).toBe(40);
    expect(scoreOf([], [])).toBe(40);
  });
});

describe("score audit — combinations reach the expected totals", () => {
  it("9: all four passing gives a perfect 100", () => {
    const runs = RELIABILITY_MANDATORY_SCENARIOS.map((id) => run(id, "PASS"));
    const results = RELIABILITY_MANDATORY_SCENARIOS.map((id) =>
      passedInvariant(id),
    );

    const result = calculateReliabilityScoreV1({
      candidateRuns: runs,
      invariantResults: results,
    });

    expect(result.score).toBe(100);
    expect(result.totalDeduction).toBe(0);
  });

  it("10: mixed results add up exactly", () => {
    // C01 PASS (0) + C03 PASS (0) + C07 CRITICAL FAIL (25) + C11 NOT_RUN (15)
    const runs = [run("C01", "PASS"), run("C03", "PASS"), run("C07", "FAIL")];
    const results = [
      passedInvariant("C01"),
      passedInvariant("C03"),
      failedInvariant("C07", "CRITICAL"),
    ];

    const result = calculateReliabilityScoreV1({
      candidateRuns: runs,
      invariantResults: results,
    });

    expect(result.totalDeduction).toBe(40);
    expect(result.score).toBe(60);
  });

  it("11: the score never goes below zero", () => {
    // Four CRITICAL failures deduct 100 exactly; the clamp still matters if
    // the table ever grows.
    const runs = RELIABILITY_MANDATORY_SCENARIOS.map((id) => run(id, "FAIL"));
    const results = RELIABILITY_MANDATORY_SCENARIOS.map((id) =>
      failedInvariant(id, "CRITICAL"),
    );

    expect(
      calculateReliabilityScoreV1({
        candidateRuns: runs,
        invariantResults: results,
      }).score,
    ).toBe(0);
  });
});

describe("score audit — the score is derived, never remembered", () => {
  it("12: identical input always produces an identical score", () => {
    // No persistence, no snapshot, no cache: the same evidence scores the
    // same way on every request, so the number cannot go stale.
    const input = {
      candidateRuns: [run("C01", "PASS")],
      invariantResults: [passedInvariant("C01")],
    };

    const first = calculateReliabilityScoreV1(input);
    const second = calculateReliabilityScoreV1(input);

    expect(first).toEqual(second);
  });

  it("13: removing the evidence returns the score to 40", () => {
    // What a Demo Reset does, expressed as arithmetic: clearing the runs
    // restores every scenario to NOT_RUN.
    expect(scoreOf([run("C01", "PASS")], [passedInvariant("C01")])).toBe(55);
    expect(scoreOf([], [])).toBe(40);
  });
});
