import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Phase 4F-R2 — the reliability read service.
 *
 * Only the repository is mocked. `lib/reliability/score.ts` runs FOR REAL,
 * deliberately: the point of these tests is that the service composes the
 * frozen engine rather than reimplementing it, and mocking the engine would
 * make that unprovable.
 */

const loadReliabilityCandidateRuns = vi.fn();
const loadReliabilityInvariantResults = vi.fn();

class FakeRepositoryError extends Error {
  readonly code: string;
  constructor(code: string) {
    super("safe wording");
    this.name = "ReliabilityRepositoryError";
    this.code = code;
  }
}

vi.mock("@/lib/reliability/repository", () => ({
  loadReliabilityCandidateRuns: (...a: unknown[]) =>
    loadReliabilityCandidateRuns(...a),
  loadReliabilityInvariantResults: (...a: unknown[]) =>
    loadReliabilityInvariantResults(...a),
}));

const { getCurrentReliabilityScore, composeReliabilityScoreReadModel } =
  await import("@/lib/reliability/service");
const { calculateReliabilityScoreV1 } = await import("@/lib/reliability/score");

import type {
  ReliabilityCandidateInvariantResult,
  ReliabilityCandidateRun,
  ReliabilityScenarioId,
} from "@/lib/reliability/types";

const GENUINE: Record<ReliabilityScenarioId, string> = {
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
    status: "COMPLETED",
    outcome: "PASS",
    dataClassification: GENUINE[
      scenarioId
    ] as ReliabilityCandidateRun["dataClassification"],
    createdAt: stamp,
    completedAt: stamp,
    ...overrides,
  };
}

function failure(chaosRunId: string): ReliabilityCandidateInvariantResult {
  sequence += 1;
  return {
    id: `res-${sequence}`,
    chaosRunId,
    invariantId: "INV-005",
    result: "FAIL",
    severity: "CRITICAL",
  };
}

function arrange(
  runs: readonly ReliabilityCandidateRun[],
  results: readonly ReliabilityCandidateInvariantResult[] = [],
) {
  loadReliabilityCandidateRuns.mockResolvedValue(runs);
  loadReliabilityInvariantResults.mockResolvedValue(results);
}

function diagnosticsFor(
  model: Awaited<ReturnType<typeof getCurrentReliabilityScore>>,
  scenarioId: ReliabilityScenarioId,
) {
  return model.selectionDiagnostics.find((d) => d.scenarioId === scenarioId)!;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reliability service — composition", () => {
  it("A: passes the repository's evidence into the frozen engine", async () => {
    const runs = [run("C01"), run("C11")];
    const results = [failure(runs[0]!.id)];
    arrange(runs, results);

    await getCurrentReliabilityScore();

    expect(loadReliabilityCandidateRuns).toHaveBeenCalledTimes(1);
    // Invariant results are loaded only for the runs actually loaded.
    expect(loadReliabilityInvariantResults).toHaveBeenCalledWith([
      runs[0]!.id,
      runs[1]!.id,
    ]);
  });

  it("B: the service score equals a direct pure-engine call over the same evidence", async () => {
    const failing = run("C07", { outcome: "FAIL" });
    const runs = [run("C01"), run("C03"), failing, run("C11")];
    const results = [failure(failing.id)];
    arrange(runs, results);

    const model = await getCurrentReliabilityScore();

    // No arithmetic duplication: the service returns the engine's own answer.
    expect(model.score).toEqual(
      calculateReliabilityScoreV1({
        candidateRuns: runs,
        invariantResults: results,
      }),
    );
  });

  it("B2: the engine's frozen version strings survive composition", async () => {
    arrange([]);
    const model = await getCurrentReliabilityScore();
    expect(model.score.algorithmVersion).toBe("RELIABILITY-V1");
    expect(model.score.selectionVersion).toBe("LATEST_SELECTION_V1");
  });

  it("C: diagnostics are returned in the frozen scenario order", async () => {
    arrange([run("C11"), run("C01")]);

    const model = await getCurrentReliabilityScore();

    expect(model.selectionDiagnostics.map((d) => d.scenarioId)).toEqual([
      "C01",
      "C03",
      "C07",
      "C11",
    ]);
  });
});

describe("reliability service — explanation-only diagnostics", () => {
  it("D: a selected scenario reports LATEST_ELIGIBLE_RUN", async () => {
    const selected = run("C11");
    arrange([selected]);

    const model = await getCurrentReliabilityScore();
    const d = diagnosticsFor(model, "C11");

    expect(d.selectionReason).toBe("LATEST_ELIGIBLE_RUN");
    expect(d.totalCandidateCount).toBe(1);
    expect(d.eligibleCandidateCount).toBe(1);
    expect(d.ineligibleCandidateCount).toBe(0);
  });

  it("E: no run of the scenario at all reports NO_CANDIDATES", async () => {
    arrange([run("C01")]);

    const d = diagnosticsFor(await getCurrentReliabilityScore(), "C11");

    expect(d.selectionReason).toBe("NO_CANDIDATES");
    expect(d.totalCandidateCount).toBe(0);
    expect(d.eligibleCandidateCount).toBe(0);
    expect(d.ineligibleCandidateCount).toBe(0);
  });

  it("F: runs exist but all are ineligible -> NO_ELIGIBLE_CANDIDATES", async () => {
    // The distinction that a bare eligible count cannot express: this C11
    // scenario HAS been run three times; every run was excluded.
    arrange([
      run("C11", { dataClassification: "SYNTHETIC_DEMO" }),
      run("C11", { outcome: null }),
      run("C11", { completedAt: null }),
    ]);

    const model = await getCurrentReliabilityScore();
    const d = diagnosticsFor(model, "C11");

    expect(d.selectionReason).toBe("NO_ELIGIBLE_CANDIDATES");
    expect(d.totalCandidateCount).toBe(3);
    expect(d.eligibleCandidateCount).toBe(0);
    expect(d.ineligibleCandidateCount).toBe(3);
    // Both reasons still score identically — the difference is explanatory.
    expect(
      model.score.scenarioBreakdown.find((e) => e.scenarioId === "C11")!.state,
    ).toBe("NOT_RUN");
  });

  it("F2: a C03 run labelled RECORDED_TEST_EVIDENCE is counted but ineligible", async () => {
    arrange([run("C03", { dataClassification: "RECORDED_TEST_EVIDENCE" })]);

    const d = diagnosticsFor(await getCurrentReliabilityScore(), "C03");

    expect(d.totalCandidateCount).toBe(1);
    expect(d.eligibleCandidateCount).toBe(0);
    expect(d.selectionReason).toBe("NO_ELIGIBLE_CANDIDATES");
  });

  it("G/H/I: counts are exact and eligible is copied from the pure breakdown", async () => {
    const eligible = run("C07");
    arrange([
      eligible,
      run("C07", { dataClassification: "SYNTHETIC_DEMO" }),
      run("C07", { status: "RUNNING", outcome: null }),
    ]);

    const model = await getCurrentReliabilityScore();
    const d = diagnosticsFor(model, "C07");
    const breakdown = model.score.scenarioBreakdown.find(
      (e) => e.scenarioId === "C07",
    )!;

    expect(d.totalCandidateCount).toBe(3);
    expect(d.eligibleCandidateCount).toBe(breakdown.eligibleCandidateCount);
    expect(d.eligibleCandidateCount).toBe(1);
    expect(d.ineligibleCandidateCount).toBe(2);
    expect(d.totalCandidateCount - d.eligibleCandidateCount).toBe(
      d.ineligibleCandidateCount,
    );
  });

  it("J: diagnostics change nothing about the score itself", async () => {
    const failing = run("C07", { outcome: "FAIL" });
    const runs = [run("C01"), run("C03"), failing, run("C11")];
    const results = [failure(failing.id)];
    arrange(runs, results);

    const model = await getCurrentReliabilityScore();
    const pure = calculateReliabilityScoreV1({
      candidateRuns: runs,
      invariantResults: results,
    });

    // Every arithmetic-bearing field is byte-identical to the pure result.
    expect(model.score.score).toBe(pure.score);
    expect(model.score.totalDeduction).toBe(pure.totalDeduction);
    expect(model.score.scenarioBreakdown).toEqual(pure.scenarioBreakdown);
  });
});

describe("reliability service — READ FAILURE IS NOT ABSENCE", () => {
  it("K: a chaos-run read failure propagates and yields no score", async () => {
    loadReliabilityCandidateRuns.mockRejectedValue(
      new FakeRepositoryError("CHAOS_RUN_READ_FAILED"),
    );

    await expect(getCurrentReliabilityScore()).rejects.toMatchObject({
      code: "CHAOS_RUN_READ_FAILED",
    });
    // It must not fall back to scoring an empty database.
    expect(loadReliabilityInvariantResults).not.toHaveBeenCalled();
  });

  it("L: an invariant-result read failure propagates and yields no score", async () => {
    loadReliabilityCandidateRuns.mockResolvedValue([run("C11")]);
    loadReliabilityInvariantResults.mockRejectedValue(
      new FakeRepositoryError("INVARIANT_RESULT_READ_FAILED"),
    );

    await expect(getCurrentReliabilityScore()).rejects.toMatchObject({
      code: "INVARIANT_RESULT_READ_FAILED",
    });
  });

  it("K2: a failed read never resolves to the empty-database score of 40", async () => {
    loadReliabilityCandidateRuns.mockRejectedValue(
      new FakeRepositoryError("CHAOS_RUN_READ_FAILED"),
    );

    let resolvedScore: number | null = null;
    await getCurrentReliabilityScore()
      .then((m) => {
        resolvedScore = m.score.score;
      })
      .catch(() => {});

    expect(resolvedScore).toBeNull();
  });
});

describe("reliability service — determinism and frozen behaviour", () => {
  it("M: the same repository snapshot twice yields a deep-equal read model", async () => {
    const failing = run("C07", { outcome: "FAIL" });
    arrange(
      [run("C01"), run("C03"), failing, run("C11")],
      [failure(failing.id)],
    );

    const first = await getCurrentReliabilityScore();
    const second = await getCurrentReliabilityScore();

    expect(first).toEqual(second);
  });

  it("N: an older FAIL plus a newer eligible PASS is a current PASS", async () => {
    // Proven WITHOUT reading regression_runs: a regression influences the
    // score only by having created a newer eligible chaos run.
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
    arrange([older, newer], [failure(older.id)]);

    const model = await getCurrentReliabilityScore();
    const breakdown = model.score.scenarioBreakdown.find(
      (e) => e.scenarioId === "C11",
    )!;

    expect(breakdown.selectedRunId).toBe(newer.id);
    expect(breakdown.state).toBe("PASS");
    expect(breakdown.deduction).toBe(0);
    // The historical failure is still in the loaded evidence, just unselected.
    expect(diagnosticsFor(model, "C11").totalCandidateCount).toBe(2);
  });

  it("O: C03's provenance label survives composition unchanged", async () => {
    arrange([run("C03")]);

    const breakdown = (
      await getCurrentReliabilityScore()
    ).score.scenarioBreakdown.find((e) => e.scenarioId === "C03")!;

    expect(breakdown.selectedDataClassification).toBe("SYNTHETIC_DEMO");
    expect(breakdown.provenanceLabel).toBe(
      "Controlled PayChaos security simulation",
    );
  });

  it("Q: the composition helper over one snapshot equals the pure engine", () => {
    // R2-AC11 in miniature, with no I/O at all: the exact same two arrays go
    // to the engine and to the composition, so nothing can differ between
    // them for an environmental reason.
    const failing = run("C07", { outcome: "FAIL" });
    const candidateRuns = [run("C01"), run("C03"), failing, run("C11")];
    const invariantResults = [failure(failing.id)];

    const composed = composeReliabilityScoreReadModel(
      candidateRuns,
      invariantResults,
    );

    expect(composed.score).toEqual(
      calculateReliabilityScoreV1({ candidateRuns, invariantResults }),
    );
  });

  it("Q2: the helper is pure — same snapshot twice, deep-equal, inputs untouched", () => {
    const failing = run("C11", { outcome: "FAIL" });
    const candidateRuns = [run("C01"), failing];
    const invariantResults = [failure(failing.id)];
    const runsBefore = [...candidateRuns];
    const resultsBefore = [...invariantResults];

    const first = composeReliabilityScoreReadModel(
      candidateRuns,
      invariantResults,
    );
    const second = composeReliabilityScoreReadModel(
      candidateRuns,
      invariantResults,
    );

    expect(first).toEqual(second);
    expect(candidateRuns).toEqual(runsBefore);
    expect(invariantResults).toEqual(resultsBefore);
  });

  it("Q3: the helper derives its diagnostics from that same snapshot", () => {
    const candidateRuns = [
      run("C07"),
      run("C07", { dataClassification: "SYNTHETIC_DEMO" }),
      run("C07", { outcome: null }),
    ];

    const composed = composeReliabilityScoreReadModel(candidateRuns, []);
    const d = composed.selectionDiagnostics.find(
      (entry) => entry.scenarioId === "C07",
    )!;

    expect(d.totalCandidateCount).toBe(3);
    expect(d.eligibleCandidateCount).toBe(1);
    expect(d.ineligibleCandidateCount).toBe(2);
    expect(d.selectionReason).toBe("LATEST_ELIGIBLE_RUN");
    // And a scenario absent from the snapshot reports NO_CANDIDATES.
    expect(
      composed.selectionDiagnostics.find((e) => e.scenarioId === "C01")!
        .selectionReason,
    ).toBe("NO_CANDIDATES");
  });

  it("Q4: the helper performs no I/O — it never touches the repository", () => {
    composeReliabilityScoreReadModel([run("C01")], []);

    expect(loadReliabilityCandidateRuns).not.toHaveBeenCalled();
    expect(loadReliabilityInvariantResults).not.toHaveBeenCalled();
  });

  it("Q5: getCurrentReliabilityScore loads once each and returns the composed model", async () => {
    const failing = run("C07", { outcome: "FAIL" });
    const candidateRuns = [run("C01"), run("C03"), failing, run("C11")];
    const invariantResults = [failure(failing.id)];
    arrange(candidateRuns, invariantResults);

    const model = await getCurrentReliabilityScore();

    expect(loadReliabilityCandidateRuns).toHaveBeenCalledTimes(1);
    expect(loadReliabilityInvariantResults).toHaveBeenCalledTimes(1);
    // The I/O entry point returns exactly what the pure composition would.
    expect(model).toEqual(
      composeReliabilityScoreReadModel(candidateRuns, invariantResults),
    );
  });

  it("P: an entirely empty database is four NOT_RUN scenarios, not a failure", async () => {
    arrange([]);

    const model = await getCurrentReliabilityScore();

    expect(model.score.score).toBe(40);
    expect(
      model.selectionDiagnostics.every(
        (d) => d.selectionReason === "NO_CANDIDATES",
      ),
    ).toBe(true);
    // The genuinely-empty case and the read-failure case are different
    // outcomes: this one returns a score, test K does not.
    expect(loadReliabilityInvariantResults).toHaveBeenCalledWith([]);
  });
});
