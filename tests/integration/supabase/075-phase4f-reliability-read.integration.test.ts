import { describe, expect, it } from "vitest";

import {
  loadReliabilityCandidateRuns,
  loadReliabilityInvariantResults,
} from "@/lib/reliability/repository";
import { calculateReliabilityScoreV1 } from "@/lib/reliability/score";
import {
  composeReliabilityScoreReadModel,
  getCurrentReliabilityScore,
} from "@/lib/reliability/service";
import {
  RELIABILITY_MANDATORY_SCENARIOS,
  RELIABILITY_PROVENANCE_LABEL,
  RELIABILITY_REQUIRED_CLASSIFICATION,
} from "@/lib/reliability/types";

/**
 * Phase 4F-R2 — the Reliability Score against the live Supabase project.
 *
 * THIS SUITE IS READ-ONLY AND OWNS NOTHING. It creates zero rows, updates
 * zero rows and deletes zero rows, so it needs no fixture and no cleanup. It
 * executes no chaos scenario, makes no Razorpay call and fabricates no
 * provider evidence — the whole score domain is a read, and this proves that
 * against the real database rather than against a fake.
 *
 * DELIBERATELY NOT PINNED TO TODAY'S NUMBER. Asserting `score === 85` would
 * mean the next legitimate chaos run breaks this suite, which would be a
 * standing incentive to avoid running chaos. Every assertion below is instead
 * a deterministic PROPERTY that must hold whatever evidence exists: the
 * versions, the four-row shape, service-equals-engine, exact count
 * arithmetic, and the provenance rules. The current live figure is reported
 * separately as an architect audit reading, not frozen into a test.
 */

describe("075 — the repository reads real persisted evidence", () => {
  it("1: mandatory-scenario chaos runs load, and only those scenarios", async () => {
    const runs = await loadReliabilityCandidateRuns();

    // Zero runs is a legitimate state; the SHAPE is what is asserted.
    for (const run of runs) {
      expect(RELIABILITY_MANDATORY_SCENARIOS as readonly string[]).toContain(
        run.scenarioId,
      );
      expect(typeof run.id).toBe("string");
      expect(["COMPLETED", "FAILED", "PENDING", "RUNNING"]).toContain(
        run.status,
      );
      expect(["RECORDED_TEST_EVIDENCE", "SYNTHETIC_DEMO"]).toContain(
        run.dataClassification,
      );
      expect(typeof run.createdAt).toBe("string");
    }
  });

  it("2: invariant results load for exactly the loaded run ids", async () => {
    const runs = await loadReliabilityCandidateRuns();
    const ids = runs.map((run) => run.id);
    const results = await loadReliabilityInvariantResults(ids);

    for (const result of results) {
      expect(ids).toContain(result.chaosRunId);
      expect(["PASS", "FAIL", "UNKNOWN"]).toContain(result.result);
      expect(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).toContain(result.severity);
    }
  });

  it("3: an empty id list issues no query and returns nothing", async () => {
    await expect(loadReliabilityInvariantResults([])).resolves.toEqual([]);
  });
});

describe("075 — the service composes the frozen engine", () => {
  it("4: the read model carries the frozen versions and exactly four rows", async () => {
    const model = await getCurrentReliabilityScore();

    expect(model.score.algorithmVersion).toBe("RELIABILITY-V1");
    expect(model.score.selectionVersion).toBe("LATEST_SELECTION_V1");
    expect(model.score.scenarioBreakdown).toHaveLength(4);
    expect(model.score.scenarioBreakdown.map((e) => e.scenarioId)).toEqual([
      "C01",
      "C03",
      "C07",
      "C11",
    ]);
    expect(model.selectionDiagnostics.map((d) => d.scenarioId)).toEqual([
      "C01",
      "C03",
      "C07",
      "C11",
    ]);
  });

  it("5: R2-AC11 — the composition equals the pure engine over ONE real snapshot", async () => {
    // The snapshot is loaded from the real database EXACTLY ONCE, and the
    // same two arrays are then handed to the frozen engine and to the service
    // composition. Nothing is read a second time, so a legitimate concurrent
    // chaos run cannot make the two sides disagree for an environmental
    // reason. An earlier version of this test loaded the snapshot twice and
    // was therefore race-prone: it asserted that the database sits still,
    // which is not a property this project should ever depend on.
    const candidateRuns = await loadReliabilityCandidateRuns();
    const invariantResults = await loadReliabilityInvariantResults(
      candidateRuns.map((run) => run.id),
    );

    const direct = calculateReliabilityScoreV1({
      candidateRuns,
      invariantResults,
    });
    const composed = composeReliabilityScoreReadModel(
      candidateRuns,
      invariantResults,
    );

    expect(composed.score).toEqual(direct);
  });

  it("5b: composing the SAME real snapshot twice is deep-equal", async () => {
    // Determinism proven over fixed values rather than over two independent
    // service calls, so this cannot fail because evidence legitimately landed
    // between them.
    const candidateRuns = await loadReliabilityCandidateRuns();
    const invariantResults = await loadReliabilityInvariantResults(
      candidateRuns.map((run) => run.id),
    );

    expect(
      composeReliabilityScoreReadModel(candidateRuns, invariantResults),
    ).toEqual(
      composeReliabilityScoreReadModel(candidateRuns, invariantResults),
    );
  });

  it("5c: the real I/O entry point still works end to end", async () => {
    // Proves the genuine repository -> service path against live Supabase.
    // Its RESULT is only checked for stable properties, never compared
    // byte-for-byte against a separately loaded snapshot.
    const model = await getCurrentReliabilityScore();

    expect(model.score.algorithmVersion).toBe("RELIABILITY-V1");
    expect(model.score.selectionVersion).toBe("LATEST_SELECTION_V1");
    expect(model.score.scenarioBreakdown).toHaveLength(4);
    expect(model.selectionDiagnostics).toHaveLength(4);
  });

  it("6: the score is a clamped integer derived from exactly four deductions", async () => {
    const model = await getCurrentReliabilityScore();

    const summed = model.score.scenarioBreakdown.reduce(
      (total, entry) => total + entry.deduction,
      0,
    );
    expect(model.score.totalDeduction).toBe(summed);
    expect(model.score.score).toBe(Math.max(0, 100 - summed));
    expect(model.score.score).toBeGreaterThanOrEqual(0);
    expect(model.score.score).toBeLessThanOrEqual(100);
  });

  it("7: diagnostic count arithmetic is exact for every scenario", async () => {
    const model = await getCurrentReliabilityScore();

    for (const d of model.selectionDiagnostics) {
      expect(
        d.totalCandidateCount,
        `${d.scenarioId} total >= eligible`,
      ).toBeGreaterThanOrEqual(d.eligibleCandidateCount);
      expect(d.ineligibleCandidateCount, d.scenarioId).toBe(
        d.totalCandidateCount - d.eligibleCandidateCount,
      );

      const breakdown = model.score.scenarioBreakdown.find(
        (e) => e.scenarioId === d.scenarioId,
      )!;
      expect(d.eligibleCandidateCount, d.scenarioId).toBe(
        breakdown.eligibleCandidateCount,
      );

      // The reason is consistent with what the engine actually selected.
      if (breakdown.selectedRunId !== null) {
        expect(d.selectionReason, d.scenarioId).toBe("LATEST_ELIGIBLE_RUN");
      } else if (d.totalCandidateCount === 0) {
        expect(d.selectionReason, d.scenarioId).toBe("NO_CANDIDATES");
      } else {
        expect(d.selectionReason, d.scenarioId).toBe("NO_ELIGIBLE_CANDIDATES");
      }
    }
  });
});

describe("075 — provenance holds against real data", () => {
  it("8: every selected run carries its scenario's required classification", async () => {
    const model = await getCurrentReliabilityScore();

    for (const entry of model.score.scenarioBreakdown) {
      if (entry.selectedRunId === null) {
        expect(entry.selectedDataClassification, entry.scenarioId).toBeNull();
        expect(entry.provenanceLabel, entry.scenarioId).toBeNull();
        continue;
      }
      expect(entry.selectedDataClassification, entry.scenarioId).toBe(
        RELIABILITY_REQUIRED_CLASSIFICATION[entry.scenarioId],
      );
    }
  });

  it("9: a selected C03 run is a controlled simulation, never real evidence", async () => {
    const c03 = (
      await getCurrentReliabilityScore()
    ).score.scenarioBreakdown.find((e) => e.scenarioId === "C03")!;

    if (c03.selectedRunId === null) return; // Legitimately possible.

    expect(c03.selectedDataClassification).toBe("SYNTHETIC_DEMO");
    expect(c03.provenanceLabel).toBe(
      RELIABILITY_PROVENANCE_LABEL.SYNTHETIC_DEMO,
    );
    expect(c03.provenanceLabel).toBe("Controlled PayChaos security simulation");
    for (const forbidden of ["Real Razorpay", "real webhook", "provider"]) {
      expect(c03.provenanceLabel ?? "", forbidden).not.toContain(forbidden);
    }
  });

  it("10: a selected C01/C07/C11 run is recorded test evidence", async () => {
    const model = await getCurrentReliabilityScore();

    for (const scenarioId of ["C01", "C07", "C11"] as const) {
      const entry = model.score.scenarioBreakdown.find(
        (e) => e.scenarioId === scenarioId,
      )!;
      if (entry.selectedRunId === null) continue;

      expect(entry.selectedDataClassification, scenarioId).toBe(
        "RECORDED_TEST_EVIDENCE",
      );
      expect(entry.provenanceLabel, scenarioId).toBe(
        RELIABILITY_PROVENANCE_LABEL.RECORDED_TEST_EVIDENCE,
      );
    }
  });

  it("11: a FAIL state always names its supporting failed invariant", async () => {
    const model = await getCurrentReliabilityScore();

    for (const entry of model.score.scenarioBreakdown) {
      if (entry.state === "FAIL") {
        // A FAIL with no evidence would have been ERROR, by the frozen rule.
        expect(
          entry.supportingFailedInvariantResultId,
          entry.scenarioId,
        ).not.toBeNull();
        expect(entry.supportingSeverity, entry.scenarioId).not.toBeNull();
        expect(entry.deduction, entry.scenarioId).toBeGreaterThan(0);
      } else {
        expect(
          entry.supportingFailedInvariantResultId,
          entry.scenarioId,
        ).toBeNull();
      }
    }
  });

  it("12: the live read model is internally consistent with its own snapshot", async () => {
    // Deliberately NOT two service calls compared to each other: that would
    // assert external inactivity. Determinism is proven over a fixed snapshot
    // in test 5b and exhaustively in the R1 unit suite; what is checked here
    // is that a single live result is self-consistent.
    const model = await getCurrentReliabilityScore();

    for (const entry of model.score.scenarioBreakdown) {
      const d = model.selectionDiagnostics.find(
        (item) => item.scenarioId === entry.scenarioId,
      )!;
      expect(d.eligibleCandidateCount, entry.scenarioId).toBe(
        entry.eligibleCandidateCount,
      );
      if (entry.selectedRunId === null) {
        expect(entry.deduction, entry.scenarioId).toBe(15);
        expect(entry.state, entry.scenarioId).toBe("NOT_RUN");
      }
    }
  });
});
