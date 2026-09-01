import { describe, expect, it } from "vitest";

import { calculateReliabilityScoreV1 } from "@/lib/reliability/score";
import {
  RELIABILITY_MANDATORY_SCENARIOS,
  RELIABILITY_PROVENANCE_LABEL,
} from "@/lib/reliability/types";

import type {
  ReliabilityCandidateInvariantResult,
  ReliabilityCandidateRun,
  ReliabilityScenarioBreakdown,
  ReliabilityScenarioId,
  ReliabilityScoreInput,
} from "@/lib/reliability/types";
import type {
  ChaosRunDataClassification,
  ChaosRunOutcome,
  ChaosRunStatus,
  InvariantResultInvariantId,
  InvariantResultSeverity,
} from "@/lib/supabase/types";

/**
 * Phase 4F-R1 — the pure `RELIABILITY-V1` engine.
 *
 * Every fixture named in `docs/TESTING.md` (`SCORE-FIX-01` … `SCORE-FIX-17`)
 * is executable here, plus the determinism and purity properties the score
 * has to hold for P4-AC-10 to mean anything.
 *
 * No database, no mocks of a database, no network, no clock. The engine takes
 * ordinary in-memory values, so these are real assertions about the real
 * arithmetic rather than assertions about a fixture layer.
 */

// ============================================================================
// BUILDERS
// ============================================================================

/** The classification each scenario legitimately carries. */
const GENUINE: Record<ReliabilityScenarioId, ChaosRunDataClassification> = {
  C01: "RECORDED_TEST_EVIDENCE",
  C03: "SYNTHETIC_DEMO",
  C07: "RECORDED_TEST_EVIDENCE",
  C11: "RECORDED_TEST_EVIDENCE",
};

let sequence = 0;

function run(
  scenarioId: ReliabilityScenarioId,
  overrides: Partial<ReliabilityCandidateRun> = {},
): ReliabilityCandidateRun {
  sequence += 1;
  const stamp = `2026-09-01T00:00:${String(sequence).padStart(2, "0")}.000Z`;
  return {
    id: `run-${scenarioId}-${sequence}`,
    scenarioId,
    status: "COMPLETED" as ChaosRunStatus,
    outcome: "PASS" as ChaosRunOutcome,
    dataClassification: GENUINE[scenarioId],
    createdAt: stamp,
    completedAt: stamp,
    ...overrides,
  };
}

function failure(
  chaosRunId: string,
  severity: InvariantResultSeverity,
  overrides: Partial<ReliabilityCandidateInvariantResult> = {},
): ReliabilityCandidateInvariantResult {
  sequence += 1;
  return {
    id: `res-${sequence}`,
    chaosRunId,
    invariantId: "INV-005" as InvariantResultInvariantId,
    result: "FAIL",
    severity,
    ...overrides,
  };
}

/** Three passing scenarios, so a fixture can vary exactly one of them. */
function passingExcept(
  scenarioId: ReliabilityScenarioId,
): ReliabilityCandidateRun[] {
  return RELIABILITY_MANDATORY_SCENARIOS.filter((id) => id !== scenarioId).map(
    (id) => run(id),
  );
}

function score(input: Partial<ReliabilityScoreInput>): number {
  return calculateReliabilityScoreV1({
    candidateRuns: input.candidateRuns ?? [],
    invariantResults: input.invariantResults ?? [],
  }).score;
}

function entryFor(
  input: Partial<ReliabilityScoreInput>,
  scenarioId: ReliabilityScenarioId,
): ReliabilityScenarioBreakdown {
  const result = calculateReliabilityScoreV1({
    candidateRuns: input.candidateRuns ?? [],
    invariantResults: input.invariantResults ?? [],
  });
  return result.scenarioBreakdown.find((e) => e.scenarioId === scenarioId)!;
}

// ============================================================================
// SCORE-FIX-01 .. 17
// ============================================================================

describe("RELIABILITY-V1 — the documented score fixtures", () => {
  it("SCORE-FIX-01: all four required scenarios PASS -> 100", () => {
    const runs = RELIABILITY_MANDATORY_SCENARIOS.map((id) => run(id));
    // C03 passes under SYNTHETIC_DEMO; the other three under
    // RECORDED_TEST_EVIDENCE. Both are their approved classifications.
    expect(runs.find((r) => r.scenarioId === "C03")!.dataClassification).toBe(
      "SYNTHETIC_DEMO",
    );
    for (const id of ["C01", "C07", "C11"] as const) {
      expect(runs.find((r) => r.scenarioId === id)!.dataClassification).toBe(
        "RECORDED_TEST_EVIDENCE",
      );
    }

    expect(score({ candidateRuns: runs })).toBe(100);
  });

  it("SCORE-FIX-02: three PASS plus one Critical FAIL -> 75", () => {
    const failing = run("C07", { outcome: "FAIL" });
    expect(
      score({
        candidateRuns: [...passingExcept("C07"), failing],
        invariantResults: [failure(failing.id, "CRITICAL")],
      }),
    ).toBe(75);
  });

  it("SCORE-FIX-03: three PASS plus one High FAIL -> 80", () => {
    const failing = run("C07", { outcome: "FAIL" });
    expect(
      score({
        candidateRuns: [...passingExcept("C07"), failing],
        invariantResults: [failure(failing.id, "HIGH")],
      }),
    ).toBe(80);
  });

  it("SCORE-FIX-04: three PASS plus one UNKNOWN -> 85", () => {
    expect(
      score({
        candidateRuns: [
          ...passingExcept("C01"),
          run("C01", { outcome: "UNKNOWN" }),
        ],
      }),
    ).toBe(85);
  });

  it("SCORE-FIX-05: three PASS plus one BLOCKED -> 85", () => {
    expect(
      score({
        candidateRuns: [
          ...passingExcept("C01"),
          run("C01", { outcome: "BLOCKED" }),
        ],
      }),
    ).toBe(85);
  });

  it("SCORE-FIX-06: three PASS plus one ERROR -> 85", () => {
    expect(
      score({
        candidateRuns: [
          ...passingExcept("C01"),
          run("C01", { outcome: "ERROR" }),
        ],
      }),
    ).toBe(85);
  });

  it("SCORE-FIX-07: three PASS plus one NOT RUN -> 85", () => {
    const entry = entryFor({ candidateRuns: passingExcept("C11") }, "C11");
    expect(entry.state).toBe("NOT_RUN");
    expect(entry.deduction).toBe(15);
    expect(entry.selectedRunId).toBeNull();
    expect(score({ candidateRuns: passingExcept("C11") })).toBe(85);
  });

  it("SCORE-FIX-08: a newer eligible PASS supersedes an older Critical FAIL", () => {
    const older = run("C11", {
      outcome: "FAIL",
      createdAt: "2026-08-01T00:00:00.000Z",
      completedAt: "2026-08-01T00:10:00.000Z",
    });
    const newer = run("C11", {
      outcome: "PASS",
      createdAt: "2026-08-02T00:00:00.000Z",
      completedAt: "2026-08-02T00:10:00.000Z",
    });
    const invariantResults = [failure(older.id, "CRITICAL")];
    const candidateRuns = [older, newer];

    const entry = entryFor({ candidateRuns, invariantResults }, "C11");

    expect(entry.selectedRunId).toBe(newer.id);
    expect(entry.state).toBe("PASS");
    expect(entry.deduction).toBe(0);
    // The historical failure is still present in the input, untouched.
    expect(candidateRuns).toContain(older);
    expect(invariantResults[0]!.result).toBe("FAIL");
  });

  it("SCORE-FIX-09: a newer eligible FAIL sets the deduction from ITS severity", () => {
    const older = run("C11", {
      outcome: "FAIL",
      createdAt: "2026-08-01T00:00:00.000Z",
      completedAt: "2026-08-01T00:10:00.000Z",
    });
    const newer = run("C11", {
      outcome: "FAIL",
      createdAt: "2026-08-02T00:00:00.000Z",
      completedAt: "2026-08-02T00:10:00.000Z",
    });

    const entry = entryFor(
      {
        candidateRuns: [older, newer],
        invariantResults: [
          failure(older.id, "CRITICAL"),
          failure(newer.id, "HIGH"),
        ],
      },
      "C11",
    );

    // The older Critical failure does not leak into the current deduction.
    expect(entry.selectedRunId).toBe(newer.id);
    expect(entry.supportingSeverity).toBe("HIGH");
    expect(entry.deduction).toBe(20);
  });

  it.each(["C01", "C07", "C11"] as const)(
    "SCORE-FIX-10: a newer SYNTHETIC_DEMO run is excluded for %s",
    (scenarioId) => {
      const genuine = run(scenarioId, {
        outcome: "PASS",
        createdAt: "2026-08-01T00:00:00.000Z",
        completedAt: "2026-08-01T00:10:00.000Z",
      });
      // Newer, and would otherwise flip the scenario to FAIL.
      const synthetic = run(scenarioId, {
        outcome: "FAIL",
        dataClassification: "SYNTHETIC_DEMO",
        createdAt: "2026-08-09T00:00:00.000Z",
        completedAt: "2026-08-09T00:10:00.000Z",
      });

      const entry = entryFor(
        {
          candidateRuns: [genuine, synthetic],
          invariantResults: [failure(synthetic.id, "CRITICAL")],
        },
        scenarioId,
      );

      expect(entry.selectedRunId).toBe(genuine.id);
      expect(entry.selectedDataClassification).toBe("RECORDED_TEST_EVIDENCE");
      expect(entry.state).toBe("PASS");
      expect(entry.deduction).toBe(0);
      expect(entry.eligibleCandidateCount).toBe(1);
    },
  );

  it("SCORE-FIX-11: C03 SYNTHETIC_DEMO PASS is eligible and honestly labelled", () => {
    const c03 = run("C03", { outcome: "PASS" });
    const entry = entryFor({ candidateRuns: [c03] }, "C03");

    expect(entry.selectedRunId).toBe(c03.id);
    expect(entry.state).toBe("PASS");
    expect(entry.deduction).toBe(0);
    expect(entry.selectedDataClassification).toBe("SYNTHETIC_DEMO");
    expect(entry.provenanceLabel).toBe(
      "Controlled PayChaos security simulation",
    );
    // Never dressed up as genuine provider evidence.
    expect(entry.provenanceLabel).not.toBe("Recorded test evidence");
    for (const forbidden of [
      "Real Razorpay",
      "real webhook",
      "recorded provider",
    ]) {
      expect(entry.provenanceLabel ?? "").not.toContain(forbidden);
    }
  });

  it("SCORE-FIX-12: a C03 run labelled RECORDED_TEST_EVIDENCE is ineligible", () => {
    // The anti-relabelling guard: nobody may raise the score later by calling
    // a controlled simulation genuine recorded evidence.
    const mislabelled = run("C03", {
      outcome: "PASS",
      dataClassification: "RECORDED_TEST_EVIDENCE",
    });

    const entry = entryFor({ candidateRuns: [mislabelled] }, "C03");

    expect(entry.selectedRunId).toBeNull();
    expect(entry.eligibleCandidateCount).toBe(0);
    expect(entry.state).toBe("NOT_RUN");
    expect(entry.deduction).toBe(15);
  });

  it("SCORE-FIX-13: FAILED + ERROR is a terminal candidate scoring ERROR / 15", () => {
    const technical = run("C01", { status: "FAILED", outcome: "ERROR" });
    const entry = entryFor({ candidateRuns: [technical] }, "C01");

    expect(entry.selectedRunId).toBe(technical.id);
    expect(entry.state).toBe("ERROR");
    expect(entry.deduction).toBe(15);
  });

  it("SCORE-FIX-14: FAIL with zero failed invariant results is ERROR / 15", () => {
    const inconsistent = run("C07", { outcome: "FAIL" });
    const entry = entryFor(
      {
        candidateRuns: [inconsistent],
        // A PASS row for the same run must not rescue it.
        invariantResults: [
          { ...failure(inconsistent.id, "CRITICAL"), result: "PASS" },
        ],
      },
      "C07",
    );

    expect(entry.state).toBe("ERROR");
    expect(entry.deduction).toBe(15);
    expect(entry.state).not.toBe("PASS");
    expect(entry.supportingFailedInvariantResultId).toBeNull();
  });

  it("SCORE-FIX-15: same createdAt -> the lexicographically greater id wins", () => {
    const shared = "2026-08-05T00:00:00.000Z";
    const lower = run("C11", {
      id: "aaaa-run",
      createdAt: shared,
      completedAt: shared,
      outcome: "FAIL",
    });
    const higher = run("C11", {
      id: "zzzz-run",
      createdAt: shared,
      completedAt: shared,
      outcome: "PASS",
    });

    const entry = entryFor(
      {
        candidateRuns: [lower, higher],
        invariantResults: [failure(lower.id, "CRITICAL")],
      },
      "C11",
    );

    expect(entry.selectedRunId).toBe("zzzz-run");
    expect(entry.state).toBe("PASS");
  });

  it("SCORE-FIX-16: the later createdAt wins even with an earlier completedAt", () => {
    const a = run("C11", {
      id: "run-a",
      createdAt: "2026-08-10T00:00:00.000Z",
      completedAt: "2026-08-10T00:01:00.000Z",
      outcome: "PASS",
    });
    const b = run("C11", {
      id: "run-b",
      createdAt: "2026-08-09T00:00:00.000Z",
      completedAt: "2026-08-20T00:00:00.000Z",
      outcome: "FAIL",
    });

    const entry = entryFor(
      {
        candidateRuns: [a, b],
        invariantResults: [failure(b.id, "CRITICAL")],
      },
      "C11",
    );

    // completedAt ordering would have chosen b; LATEST_SELECTION_V1 does not.
    expect(entry.selectedRunId).toBe("run-a");
    expect(entry.state).toBe("PASS");
  });

  it("SCORE-FIX-17: a null outcome or null completedAt is not eligible", () => {
    for (const broken of [
      run("C01", { outcome: null }),
      run("C01", { completedAt: null }),
      run("C01", { status: "PENDING", outcome: null }),
      run("C01", { status: "RUNNING", outcome: null }),
    ]) {
      const entry = entryFor({ candidateRuns: [broken] }, "C01");
      expect(entry.eligibleCandidateCount, broken.id).toBe(0);
      expect(entry.state, broken.id).toBe("NOT_RUN");
      expect(entry.deduction, broken.id).toBe(15);
    }
  });
});

// ============================================================================
// DETERMINISM, PURITY AND FAIL-CLOSED BEHAVIOUR
// ============================================================================

describe("RELIABILITY-V1 — determinism and purity", () => {
  function mixedInput(): ReliabilityScoreInput {
    const failing = run("C07", { outcome: "FAIL" });
    return {
      candidateRuns: [
        run("C01", { outcome: "UNKNOWN" }),
        run("C03", { outcome: "PASS" }),
        failing,
        run("C11", { outcome: "PASS" }),
      ],
      invariantResults: [
        failure(failing.id, "HIGH", { invariantId: "INV-011" }),
        failure(failing.id, "CRITICAL", { invariantId: "INV-002" }),
      ],
    };
  }

  it("A: the same input twice yields a deep-equal score and breakdown", () => {
    const input = mixedInput();
    expect(calculateReliabilityScoreV1(input)).toEqual(
      calculateReliabilityScoreV1(input),
    );
  });

  it("B: shuffling the candidate runs changes nothing", () => {
    const input = mixedInput();
    const shuffled = {
      ...input,
      candidateRuns: [...input.candidateRuns].reverse(),
    };
    expect(calculateReliabilityScoreV1(shuffled)).toEqual(
      calculateReliabilityScoreV1(input),
    );
  });

  it("C: shuffling the invariant results changes nothing", () => {
    const input = mixedInput();
    const shuffled = {
      ...input,
      invariantResults: [...input.invariantResults].reverse(),
    };
    expect(calculateReliabilityScoreV1(shuffled)).toEqual(
      calculateReliabilityScoreV1(input),
    );
  });

  it("D: an unsupported failed-invariant severity fails closed to ERROR / 15", () => {
    const failing = run("C07", { outcome: "FAIL" });
    const entry = entryFor(
      {
        candidateRuns: [failing],
        invariantResults: [
          {
            ...failure(failing.id, "CRITICAL"),
            severity: "INFO" as InvariantResultSeverity,
          },
        ],
      },
      "C07",
    );

    expect(entry.state).toBe("ERROR");
    expect(entry.deduction).toBe(15);
    // Never silently priced at zero.
    expect(entry.deduction).not.toBe(0);
  });

  it("E: Critical outranks High when both failed on the selected run", () => {
    const failing = run("C07", { outcome: "FAIL" });
    const entry = entryFor(
      {
        candidateRuns: [failing],
        invariantResults: [
          failure(failing.id, "HIGH", { invariantId: "INV-004" }),
          failure(failing.id, "CRITICAL", { invariantId: "INV-005" }),
        ],
      },
      "C07",
    );

    expect(entry.supportingSeverity).toBe("CRITICAL");
    expect(entry.supportingInvariantId).toBe("INV-005");
    expect(entry.deduction).toBe(25);
  });

  it("F: equal highest severity resolves by invariantId ASC then result id ASC", () => {
    const failing = run("C07", { outcome: "FAIL" });
    const results: ReliabilityCandidateInvariantResult[] = [
      {
        ...failure(failing.id, "CRITICAL"),
        id: "res-z",
        invariantId: "INV-011",
      },
      {
        ...failure(failing.id, "CRITICAL"),
        id: "res-b",
        invariantId: "INV-002",
      },
      {
        ...failure(failing.id, "CRITICAL"),
        id: "res-a",
        invariantId: "INV-002",
      },
    ];

    const entry = entryFor(
      { candidateRuns: [failing], invariantResults: results },
      "C07",
    );

    // Explanation-only tie-break: the deduction is 25 whichever row wins.
    expect(entry.supportingInvariantId).toBe("INV-002");
    expect(entry.supportingFailedInvariantResultId).toBe("res-a");
    expect(entry.deduction).toBe(25);
  });

  it("G: FAILED + PASS is an unapproved combination -> ERROR / 15", () => {
    const entry = entryFor(
      { candidateRuns: [run("C01", { status: "FAILED", outcome: "PASS" })] },
      "C01",
    );
    expect(entry.state).toBe("ERROR");
    expect(entry.deduction).toBe(15);
  });

  it("H: FAILED + FAIL is an unapproved combination -> ERROR / 15", () => {
    const failing = run("C01", { status: "FAILED", outcome: "FAIL" });
    const entry = entryFor(
      {
        candidateRuns: [failing],
        invariantResults: [failure(failing.id, "CRITICAL")],
      },
      "C01",
    );
    // Even with a genuine Critical failure present, a technical execution
    // failure proves nothing about the invariant and never scores as FAIL.
    expect(entry.state).toBe("ERROR");
    expect(entry.deduction).toBe(15);
  });

  it("I: a COMPLETED run with an unrecognised outcome -> ERROR / 15", () => {
    const entry = entryFor(
      {
        candidateRuns: [
          run("C01", { outcome: "SOMETHING_ELSE" as ChaosRunOutcome }),
        ],
      },
      "C01",
    );
    expect(entry.state).toBe("ERROR");
    expect(entry.deduction).toBe(15);
  });

  it("J: the caller's input arrays are never mutated or reordered", () => {
    const input = mixedInput();
    const runsBefore = [...input.candidateRuns];
    const resultsBefore = [...input.invariantResults];

    calculateReliabilityScoreV1(input);

    expect(input.candidateRuns).toEqual(runsBefore);
    expect(input.invariantResults).toEqual(resultsBefore);
  });

  it("K: exactly four breakdown rows, in the frozen order, always", () => {
    for (const input of [
      { candidateRuns: [], invariantResults: [] },
      mixedInput(),
    ]) {
      const result = calculateReliabilityScoreV1(input);
      expect(result.scenarioBreakdown).toHaveLength(4);
      expect(result.scenarioBreakdown.map((e) => e.scenarioId)).toEqual([
        "C01",
        "C03",
        "C07",
        "C11",
      ]);
    }
  });

  it("L: the score floor is zero, never negative", () => {
    const runs = RELIABILITY_MANDATORY_SCENARIOS.map((id) =>
      run(id, { outcome: "FAIL" }),
    );
    const result = calculateReliabilityScoreV1({
      candidateRuns: runs,
      invariantResults: runs.map((r) => failure(r.id, "CRITICAL")),
    });

    expect(result.totalDeduction).toBe(100);
    expect(result.score).toBe(0);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("M: an empty input is four NOT_RUN rows and a score of 40", () => {
    const result = calculateReliabilityScoreV1({
      candidateRuns: [],
      invariantResults: [],
    });
    expect(result.scenarioBreakdown.every((e) => e.state === "NOT_RUN")).toBe(
      true,
    );
    expect(result.totalDeduction).toBe(60);
    expect(result.score).toBe(40);
  });

  it("N: the frozen version strings are reported on every result", () => {
    const result = calculateReliabilityScoreV1({
      candidateRuns: [],
      invariantResults: [],
    });
    expect(result.algorithmVersion).toBe("RELIABILITY-V1");
    expect(result.selectionVersion).toBe("LATEST_SELECTION_V1");
  });

  it("O: a genuine recorded selection is labelled as recorded test evidence", () => {
    const entry = entryFor({ candidateRuns: [run("C11")] }, "C11");
    expect(entry.provenanceLabel).toBe(
      RELIABILITY_PROVENANCE_LABEL.RECORDED_TEST_EVIDENCE,
    );
    expect(entry.provenanceLabel).toBe("Recorded test evidence");
  });

  it("P: another scenario's run never satisfies this scenario", () => {
    // A C07 run cannot stand in for C11, however recent it is.
    const entry = entryFor({ candidateRuns: [run("C07")] }, "C11");
    expect(entry.state).toBe("NOT_RUN");
    expect(entry.eligibleCandidateCount).toBe(0);
  });

  it("Q: an invariant result belonging to another run never supports a FAIL", () => {
    const failing = run("C07", { outcome: "FAIL" });
    const otherRun = run("C11", { outcome: "FAIL" });
    const entry = entryFor(
      {
        candidateRuns: [failing, otherRun],
        invariantResults: [failure(otherRun.id, "CRITICAL")],
      },
      "C07",
    );

    // C07's own run has no failed row, so it fails closed rather than
    // borrowing evidence from a different run.
    expect(entry.state).toBe("ERROR");
    expect(entry.deduction).toBe(15);
  });
});
