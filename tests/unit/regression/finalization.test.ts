import { describe, expect, it } from "vitest";

import { decideRegressionOutcome } from "@/lib/regression/finalization";
import type { RegressionEvaluationInput } from "@/lib/regression/finalization";

/**
 * Phase 4E-R1 — the pure regression verdict.
 *
 * These cases enumerate the frozen D-5/D-6 rules exhaustively over the
 * aggregate outcome and the original invariant's disposition. The safety
 * property under test throughout: an inconclusive regression NEVER resolves a
 * Finding, and never claims a failure that was not proven either.
 */

const ORIGINAL = "INV-005";

type Disposition =
  RegressionEvaluationInput["evaluations"][number]["disposition"];

function report(invariantId: string, disposition: Disposition) {
  return {
    invariantId: invariantId as never,
    disposition,
    persistedResultId: disposition === "NOT_APPLICABLE" ? null : "row-id",
    alreadyPersisted: false,
  };
}

function evaluation(
  aggregateOutcome: RegressionEvaluationInput["aggregateOutcome"],
  reports: ReturnType<typeof report>[],
): RegressionEvaluationInput {
  return { aggregateOutcome, evaluations: reports };
}

describe("Phase 4E-R1 — aggregate PASS", () => {
  it("1: PASS with the original invariant PASS resolves", () => {
    const decision = decideRegressionOutcome(
      evaluation("PASS", [report(ORIGINAL, "PASS"), report("INV-004", "PASS")]),
      ORIGINAL,
    );
    expect(decision).toEqual({
      regressionStatus: "RESOLVED",
      findingAction: "RESOLVE",
      reason: "SCENARIO_CRITERIA_PASSED",
    });
  });

  it("2: PASS with the original invariant absent fails closed", () => {
    const decision = decideRegressionOutcome(
      evaluation("PASS", [report("INV-004", "PASS")]),
      ORIGINAL,
    );
    expect(decision).toEqual({
      regressionStatus: "ERROR",
      findingAction: "NO_CHANGE",
      reason: "ORIGINAL_INVARIANT_NOT_PROVEN_PASS",
    });
  });

  it("3: PASS with the original invariant UNKNOWN never resolves", () => {
    // An aggregate of PASS cannot arise alongside an UNKNOWN in the real
    // evaluator, but the decision must not DEPEND on that: a caller passing
    // this shape must still be refused rather than trusted.
    const decision = decideRegressionOutcome(
      evaluation("PASS", [
        report(ORIGINAL, "UNKNOWN"),
        report("INV-004", "PASS"),
      ]),
      ORIGINAL,
    );
    expect(decision.regressionStatus).toBe("ERROR");
    expect(decision.findingAction).toBe("NO_CHANGE");
    expect(decision.reason).toBe("ORIGINAL_INVARIANT_NOT_PROVEN_PASS");
  });

  it("4: PASS with the original invariant NOT_APPLICABLE never resolves", () => {
    const decision = decideRegressionOutcome(
      evaluation("PASS", [
        report(ORIGINAL, "NOT_APPLICABLE"),
        report("INV-004", "PASS"),
      ]),
      ORIGINAL,
    );
    expect(decision.regressionStatus).toBe("ERROR");
    expect(decision.findingAction).toBe("NO_CHANGE");
  });

  it("5: an empty evaluation list under PASS fails closed", () => {
    const decision = decideRegressionOutcome(evaluation("PASS", []), ORIGINAL);
    expect(decision.regressionStatus).toBe("ERROR");
    expect(decision.reason).toBe("ORIGINAL_INVARIANT_NOT_PROVEN_PASS");
  });

  it("6: the original invariant is matched by exact identity, not prefix", () => {
    // "INV-0051" must not satisfy a lookup for "INV-005".
    const decision = decideRegressionOutcome(
      evaluation("PASS", [report("INV-0051", "PASS")]),
      ORIGINAL,
    );
    expect(decision.regressionStatus).toBe("ERROR");
  });
});

describe("Phase 4E-R1 — aggregate FAIL", () => {
  it("7: FAIL with the original invariant FAIL marks still failing", () => {
    const decision = decideRegressionOutcome(
      evaluation("FAIL", [report(ORIGINAL, "FAIL"), report("INV-004", "PASS")]),
      ORIGINAL,
    );
    expect(decision).toEqual({
      regressionStatus: "STILL_FAILING",
      findingAction: "MARK_STILL_FAILING",
      reason: "SCENARIO_CRITERIA_FAILED",
    });
  });

  it("8: FAIL still marks still-failing when the ORIGINAL invariant passed", () => {
    // The frozen D-5 set rule. The finding's own property recovered, but
    // another required invariant of the same scenario failed, so the
    // scenario's approved criteria did not pass and nothing is called fixed.
    const decision = decideRegressionOutcome(
      evaluation("FAIL", [report(ORIGINAL, "PASS"), report("INV-004", "FAIL")]),
      ORIGINAL,
    );
    expect(decision.regressionStatus).toBe("STILL_FAILING");
    expect(decision.findingAction).toBe("MARK_STILL_FAILING");
  });

  it("9: FAIL with the original invariant absent is still a failure", () => {
    const decision = decideRegressionOutcome(
      evaluation("FAIL", [report("INV-004", "FAIL")]),
      ORIGINAL,
    );
    expect(decision.regressionStatus).toBe("STILL_FAILING");
  });
});

describe("Phase 4E-R1 — aggregate UNKNOWN", () => {
  it("10: UNKNOWN with the original invariant UNKNOWN is inconclusive", () => {
    const decision = decideRegressionOutcome(
      evaluation("UNKNOWN", [report(ORIGINAL, "UNKNOWN")]),
      ORIGINAL,
    );
    expect(decision).toEqual({
      regressionStatus: "ERROR",
      findingAction: "NO_CHANGE",
      reason: "INCONCLUSIVE_UNKNOWN",
    });
  });

  it("11: UNKNOWN with the original invariant PASS is STILL inconclusive", () => {
    // The finding's own invariant passed, but another required invariant
    // proved nothing. Resolving here would overstate the evidence.
    const decision = decideRegressionOutcome(
      evaluation("UNKNOWN", [
        report(ORIGINAL, "PASS"),
        report("INV-004", "UNKNOWN"),
      ]),
      ORIGINAL,
    );
    expect(decision.regressionStatus).toBe("ERROR");
    expect(decision.findingAction).toBe("NO_CHANGE");
    expect(decision.reason).toBe("INCONCLUSIVE_UNKNOWN");
  });

  it("12: UNKNOWN never produces RESOLVED, for any disposition", () => {
    const dispositions: Disposition[] = [
      "PASS",
      "FAIL",
      "UNKNOWN",
      "NOT_APPLICABLE",
    ];
    for (const disposition of dispositions) {
      const decision = decideRegressionOutcome(
        evaluation("UNKNOWN", [report(ORIGINAL, disposition)]),
        ORIGINAL,
      );
      expect(decision.regressionStatus, disposition).not.toBe("RESOLVED");
      expect(decision.findingAction, disposition).not.toBe("RESOLVE");
    }
  });

  it("13: UNKNOWN never produces STILL_FAILING, for any disposition", () => {
    const dispositions: Disposition[] = [
      "PASS",
      "FAIL",
      "UNKNOWN",
      "NOT_APPLICABLE",
    ];
    for (const disposition of dispositions) {
      const decision = decideRegressionOutcome(
        evaluation("UNKNOWN", [report(ORIGINAL, disposition)]),
        ORIGINAL,
      );
      expect(decision.regressionStatus, disposition).toBe("ERROR");
      expect(decision.findingAction, disposition).toBe("NO_CHANGE");
    }
  });
});

describe("Phase 4E-R1 — determinism and independence", () => {
  it("14: repeated calls are deep-equal", () => {
    const input = evaluation("PASS", [
      report(ORIGINAL, "PASS"),
      report("INV-004", "PASS"),
    ]);
    const first = decideRegressionOutcome(input, ORIGINAL);
    const second = decideRegressionOutcome(input, ORIGINAL);
    const third = decideRegressionOutcome(input, ORIGINAL);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("15: the decision never depends on report ORDER", () => {
    const forward = decideRegressionOutcome(
      evaluation("FAIL", [report(ORIGINAL, "PASS"), report("INV-004", "FAIL")]),
      ORIGINAL,
    );
    const reversed = decideRegressionOutcome(
      evaluation("FAIL", [report("INV-004", "FAIL"), report(ORIGINAL, "PASS")]),
      ORIGINAL,
    );
    expect(reversed).toEqual(forward);
  });

  it("16: only the three approved finding actions can be produced", () => {
    const approved = new Set(["RESOLVE", "MARK_STILL_FAILING", "NO_CHANGE"]);
    const aggregates = ["PASS", "FAIL", "UNKNOWN"] as const;
    const dispositions: Disposition[] = [
      "PASS",
      "FAIL",
      "UNKNOWN",
      "NOT_APPLICABLE",
    ];
    for (const aggregate of aggregates) {
      for (const disposition of dispositions) {
        const decision = decideRegressionOutcome(
          evaluation(aggregate, [report(ORIGINAL, disposition)]),
          ORIGINAL,
        );
        expect(approved.has(decision.findingAction)).toBe(true);
        expect(
          ["RESOLVED", "STILL_FAILING", "ERROR"].includes(
            decision.regressionStatus,
          ),
        ).toBe(true);
      }
    }
  });

  it("17: RESOLVE is produced ONLY by aggregate PASS + original PASS", () => {
    const aggregates = ["PASS", "FAIL", "UNKNOWN"] as const;
    const dispositions: Disposition[] = [
      "PASS",
      "FAIL",
      "UNKNOWN",
      "NOT_APPLICABLE",
    ];
    for (const aggregate of aggregates) {
      for (const disposition of dispositions) {
        const decision = decideRegressionOutcome(
          evaluation(aggregate, [report(ORIGINAL, disposition)]),
          ORIGINAL,
        );
        const shouldResolve = aggregate === "PASS" && disposition === "PASS";
        expect(
          decision.findingAction === "RESOLVE",
          `${aggregate}/${disposition}`,
        ).toBe(shouldResolve);
      }
    }
  });
});
