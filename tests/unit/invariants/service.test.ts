import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const assembleChaosRunEvidence = vi.fn();
const persistInvariantResult = vi.fn();
const finalizeChaosRunOutcome = vi.fn();

vi.mock("@/lib/evidence/chaos-evidence-service", () => ({
  assembleChaosRunEvidence: (...args: unknown[]) =>
    assembleChaosRunEvidence(...args),
}));

vi.mock("@/lib/invariants/result-repository", () => ({
  persistInvariantResult: (...args: unknown[]) =>
    persistInvariantResult(...args),
  finalizeChaosRunOutcome: (...args: unknown[]) =>
    finalizeChaosRunOutcome(...args),
}));

import {
  deriveAggregateOutcome,
  evaluateChaosRun,
  InvariantEvaluationServiceError,
} from "@/lib/invariants/service";

import {
  attempt,
  bundle,
  c03Scenario,
  c03Side,
  RUN_ID,
  snapshot,
  webhook,
} from "./fixtures";

/**
 * Phase 3F-C — orchestration boundary tests.
 *
 * The evidence assembler and the repository are mocked because they are
 * INFRASTRUCTURE boundaries; the evaluators are NOT mocked, so the real frozen
 * Phase 3F-B semantics decide every disposition here. That is deliberate: a
 * test that stubbed the evaluators would prove only that the plumbing runs.
 */

const captured = (s = snapshot()) => ({
  kind: "CAPTURED" as const,
  snapshot: s,
});

function persistedRow(invariantId: string, result: string) {
  return {
    id: `row-${invariantId}`,
    invariant_id: invariantId,
    invariant_version: "1",
    order_id: null,
    payment_attempt_id: null,
    payment_id: null,
    chaos_run_id: RUN_ID,
    result,
    severity: "CRITICAL",
    expected_summary: "e",
    observed_summary: "o",
    reason: "r",
    evidence_refs: [],
    evaluated_at: "2026-08-20T10:00:00.000Z",
  };
}

/** A C03 bundle whose INV-005 disposition follows the supplied mutation evidence. */
function c03Bundle(
  mutationEvidence?: Parameters<typeof c03Scenario>[0] extends
    { mutationEvidence?: infer M } | undefined
    ? M
    : never,
) {
  return {
    ...bundle({
      scenarioId: "C03",
      orderId: null,
      paymentAttemptId: null,
      paymentId: null,
      sourceWebhook: null,
      originalProcessingAttempts: [],
      canonicalSourceEventCount: null,
      authoritativeCapture: { kind: "NO_SUBJECT" },
      authoritativeCaptureWebhook: null,
      scenarioEvidence: c03Scenario(
        mutationEvidence === undefined ? {} : { mutationEvidence },
      ),
    }),
    requiredInvariantIds: ["INV-004", "INV-005"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  persistInvariantResult.mockImplementation(
    async (candidate: { invariantId: string; result: string }) => ({
      kind: "INSERTED",
      row: persistedRow(candidate.invariantId, candidate.result),
    }),
  );
  finalizeChaosRunOutcome.mockResolvedValue({
    kind: "FINALIZED",
    outcome: "PASS",
  });
});

// ============================================================================
// AGGREGATE OUTCOME (pure)
// ============================================================================

describe("Phase 3F-C — deterministic aggregate outcome", () => {
  it("1: any FAIL dominates", () => {
    expect(deriveAggregateOutcome(["PASS", "FAIL", "UNKNOWN"])).toBe("FAIL");
    expect(deriveAggregateOutcome(["NOT_APPLICABLE", "FAIL"])).toBe("FAIL");
  });

  it("2: PASS + UNKNOWN is UNKNOWN — UNKNOWN never becomes PASS", () => {
    expect(deriveAggregateOutcome(["PASS", "UNKNOWN"])).toBe("UNKNOWN");
  });

  it("3: PASS + NOT_APPLICABLE is PASS", () => {
    expect(deriveAggregateOutcome(["NOT_APPLICABLE", "PASS"])).toBe("PASS");
  });

  it("4: every invariant NOT_APPLICABLE is UNKNOWN, never PASS", () => {
    expect(deriveAggregateOutcome(["NOT_APPLICABLE"])).toBe("UNKNOWN");
    expect(deriveAggregateOutcome(["NOT_APPLICABLE", "NOT_APPLICABLE"])).toBe(
      "UNKNOWN",
    );
  });

  it("5: an empty required set proves nothing, so it is UNKNOWN", () => {
    expect(deriveAggregateOutcome([])).toBe("UNKNOWN");
  });

  it("6: ERROR is never aggregated into a payment outcome", () => {
    expect(() => deriveAggregateOutcome(["PASS", "ERROR"])).toThrow(
      InvariantEvaluationServiceError,
    );
  });

  it("7: all PASS is PASS", () => {
    expect(deriveAggregateOutcome(["PASS", "PASS"])).toBe("PASS");
  });
});

// ============================================================================
// ELIGIBILITY
// ============================================================================

describe("Phase 3F-C — run eligibility", () => {
  it("8: a missing chaos run is not evaluable", async () => {
    assembleChaosRunEvidence.mockResolvedValue(null);
    await expect(evaluateChaosRun(RUN_ID)).rejects.toMatchObject({
      code: "CHAOS_RUN_NOT_EVALUABLE",
    });
    expect(persistInvariantResult).not.toHaveBeenCalled();
  });

  it.each(["PENDING", "RUNNING", "FAILED"])(
    "9: a %s run is not evaluable and persists nothing",
    async (status) => {
      assembleChaosRunEvidence.mockResolvedValue({
        ...c03Bundle({ before: c03Side(), after: c03Side() }),
        run: { ...c03Bundle(undefined).run, status },
      });
      await expect(evaluateChaosRun(RUN_ID)).rejects.toMatchObject({
        code: "CHAOS_RUN_NOT_EVALUABLE",
      });
      expect(persistInvariantResult).not.toHaveBeenCalled();
      expect(finalizeChaosRunOutcome).not.toHaveBeenCalled();
    },
  );

  it("10: a BLOCKED outcome is not evaluable — it never executed", async () => {
    const base = c03Bundle({ before: c03Side(), after: c03Side() });
    assembleChaosRunEvidence.mockResolvedValue({
      ...base,
      run: { ...base.run, outcome: "BLOCKED" },
    });
    await expect(evaluateChaosRun(RUN_ID)).rejects.toMatchObject({
      code: "CHAOS_RUN_NOT_EVALUABLE",
    });
    expect(persistInvariantResult).not.toHaveBeenCalled();
  });

  it("11: an ERROR outcome is never overwritten by a money verdict", async () => {
    const base = c03Bundle({ before: c03Side(), after: c03Side() });
    assembleChaosRunEvidence.mockResolvedValue({
      ...base,
      run: { ...base.run, outcome: "ERROR" },
    });
    await expect(evaluateChaosRun(RUN_ID)).rejects.toMatchObject({
      code: "CHAOS_RUN_NOT_EVALUABLE",
    });
    expect(finalizeChaosRunOutcome).not.toHaveBeenCalled();
  });

  it("12: an evidence-assembly failure is a typed load error, not a verdict", async () => {
    assembleChaosRunEvidence.mockRejectedValue(new Error("boom"));
    await expect(evaluateChaosRun(RUN_ID)).rejects.toMatchObject({
      code: "INVARIANT_EVIDENCE_LOAD_FAILED",
    });
    expect(persistInvariantResult).not.toHaveBeenCalled();
  });
});

// ============================================================================
// PERSISTENCE FILTERING
// ============================================================================

describe("Phase 3F-C — only authoritative dispositions are persisted", () => {
  /**
   * The frozen Phase 3F-B evaluators decide every disposition here — they are
   * deliberately NOT mocked. Blocker 3F-C-01 (INV-004 testing snapshot
   * availability before structural applicability) was fixed in the frozen
   * evaluator, so C03 now naturally yields NOT_APPLICABLE. The service does
   * NOT special-case C03 and never converts one disposition into another.
   */
  it("13: fresh C03 — INV-004 NOT_APPLICABLE stores nothing, INV-005 PASS stores one row, aggregate PASS", async () => {
    assembleChaosRunEvidence.mockResolvedValue(
      c03Bundle({ before: c03Side(), after: c03Side() }),
    );
    const result = await evaluateChaosRun(RUN_ID);

    expect(result.aggregateOutcome).toBe("PASS");
    expect(result.evaluations.map((e) => e.disposition)).toEqual([
      "NOT_APPLICABLE",
      "PASS",
    ]);

    // Exactly one persistence call, and it is INV-005.
    expect(persistInvariantResult).toHaveBeenCalledTimes(1);
    expect(persistInvariantResult.mock.calls[0]![0]).toMatchObject({
      invariantId: "INV-005",
      result: "PASS",
      chaosRunId: RUN_ID,
    });

    // NOT_APPLICABLE is reported truthfully but stores no row.
    const notApplicable = result.evaluations.find(
      (e) => e.invariantId === "INV-004",
    )!;
    expect(notApplicable.disposition).toBe("NOT_APPLICABLE");
    expect(notApplicable.persistedResultId).toBeNull();
    expect(result.persistedResults).toHaveLength(1);
  });

  it("13b: a NOT_APPLICABLE disposition is reported but stores no row", async () => {
    // INV-003 is NOT_APPLICABLE without verified provider failure evidence,
    // so this proves the filtering with a single-invariant scenario.
    assembleChaosRunEvidence.mockResolvedValue({
      ...bundle({ originalProcessingAttempts: [attempt()] }),
      requiredInvariantIds: ["INV-003"],
    });
    finalizeChaosRunOutcome.mockResolvedValue({
      kind: "FINALIZED",
      outcome: "UNKNOWN",
    });
    const result = await evaluateChaosRun(RUN_ID);

    expect(result.evaluations).toHaveLength(1);
    expect(result.evaluations[0]!.disposition).toBe("NOT_APPLICABLE");
    expect(result.evaluations[0]!.persistedResultId).toBeNull();
    expect(persistInvariantResult).not.toHaveBeenCalled();
    expect(result.persistedResults).toHaveLength(0);
    // Every required invariant NOT_APPLICABLE proves nothing -> UNKNOWN.
    expect(result.aggregateOutcome).toBe("UNKNOWN");
  });

  it("14: the legacy C03 shape — INV-005 UNKNOWN is persisted and the aggregate is UNKNOWN", async () => {
    assembleChaosRunEvidence.mockResolvedValue(c03Bundle(undefined));
    finalizeChaosRunOutcome.mockResolvedValue({
      kind: "FINALIZED",
      outcome: "UNKNOWN",
    });
    const result = await evaluateChaosRun(RUN_ID);

    expect(result.aggregateOutcome).toBe("UNKNOWN");
    expect(result.evaluations.map((e) => e.disposition)).toEqual([
      "NOT_APPLICABLE",
      "UNKNOWN",
    ]);
    // NOT_APPLICABLE stores nothing, so exactly one row is persisted.
    expect(persistInvariantResult).toHaveBeenCalledTimes(1);
    expect(persistInvariantResult.mock.calls[0]![0]).toMatchObject({
      invariantId: "INV-005",
      result: "UNKNOWN",
    });
    expect(result.persistedResults).toHaveLength(1);
  });

  it("15: a C03 result persists NULL merchant correlations — never fabricated", async () => {
    assembleChaosRunEvidence.mockResolvedValue(
      c03Bundle({ before: c03Side(), after: c03Side() }),
    );
    await evaluateChaosRun(RUN_ID);
    expect(persistInvariantResult.mock.calls[0]![0]).toMatchObject({
      orderId: null,
      paymentAttemptId: null,
      paymentId: null,
      chaosRunId: RUN_ID,
    });
  });

  it("16: a FAIL disposition is persisted and drives a FAIL aggregate", async () => {
    assembleChaosRunEvidence.mockResolvedValue(
      c03Bundle({
        before: c03Side(),
        after: c03Side({
          trustedWebhookEvents: { count: 2, ids: ["a", "b"], complete: true },
        }),
      }),
    );
    finalizeChaosRunOutcome.mockResolvedValue({
      kind: "FINALIZED",
      outcome: "FAIL",
    });
    const result = await evaluateChaosRun(RUN_ID);
    expect(result.aggregateOutcome).toBe("FAIL");
    expect(persistInvariantResult).toHaveBeenCalledTimes(1);
    expect(persistInvariantResult.mock.calls[0]![0]).toMatchObject({
      invariantId: "INV-005",
      result: "FAIL",
    });
  });

  it("17: only the scenario's required invariants are evaluated — never all twelve", async () => {
    assembleChaosRunEvidence.mockResolvedValue(
      c03Bundle({ before: c03Side(), after: c03Side() }),
    );
    const result = await evaluateChaosRun(RUN_ID);
    expect(result.evaluations.map((e) => e.invariantId)).toEqual([
      "INV-004",
      "INV-005",
    ]);
  });

  it("18: an already-persisted equivalent row is reused, not duplicated", async () => {
    assembleChaosRunEvidence.mockResolvedValue(
      c03Bundle({ before: c03Side(), after: c03Side() }),
    );
    persistInvariantResult.mockResolvedValue({
      kind: "ALREADY_PERSISTED",
      row: persistedRow("INV-005", "PASS"),
    });
    const result = await evaluateChaosRun(RUN_ID);
    const inv005 = result.evaluations.find((e) => e.invariantId === "INV-005")!;
    expect(inv005.alreadyPersisted).toBe(true);
    expect(inv005.persistedResultId).toBe("row-INV-005");
  });
});

// ============================================================================
// ERROR AND PARTIAL-FAILURE BOUNDARIES
// ============================================================================

describe("Phase 3F-C — error boundaries", () => {
  it("19: an evaluator ERROR persists nothing and finalizes nothing", async () => {
    // A required invariant id outside the catalogue makes the dispatcher
    // return its internal-contract ERROR.
    const base = c03Bundle({ before: c03Side(), after: c03Side() });
    assembleChaosRunEvidence.mockResolvedValue({
      ...base,
      requiredInvariantIds: ["INV-005", "INV-999"],
    });
    await expect(evaluateChaosRun(RUN_ID)).rejects.toMatchObject({
      code: "INVARIANT_EVALUATION_ERROR",
    });
    expect(persistInvariantResult).not.toHaveBeenCalled();
    expect(finalizeChaosRunOutcome).not.toHaveBeenCalled();
  });

  it("20: a persistence failure stops before the aggregate is finalized", async () => {
    assembleChaosRunEvidence.mockResolvedValue(
      c03Bundle({ before: c03Side(), after: c03Side() }),
    );
    persistInvariantResult.mockRejectedValue(
      Object.assign(new Error("insert failed"), {
        code: "INVARIANT_RESULT_INSERT_FAILED",
      }),
    );
    await expect(evaluateChaosRun(RUN_ID)).rejects.toMatchObject({
      code: "INVARIANT_RESULT_INSERT_FAILED",
    });
    expect(finalizeChaosRunOutcome).not.toHaveBeenCalled();
  });

  it("21: an integrity conflict surfaces and does not finalize the outcome", async () => {
    assembleChaosRunEvidence.mockResolvedValue(
      c03Bundle({ before: c03Side(), after: c03Side() }),
    );
    persistInvariantResult.mockRejectedValue(
      Object.assign(new Error("conflict"), {
        code: "INVARIANT_RESULT_INTEGRITY_CONFLICT",
      }),
    );
    await expect(evaluateChaosRun(RUN_ID)).rejects.toMatchObject({
      code: "INVARIANT_RESULT_INTEGRITY_CONFLICT",
    });
    expect(finalizeChaosRunOutcome).not.toHaveBeenCalled();
  });

  it("22: an outcome integrity conflict surfaces after results are persisted", async () => {
    assembleChaosRunEvidence.mockResolvedValue(
      c03Bundle({ before: c03Side(), after: c03Side() }),
    );
    finalizeChaosRunOutcome.mockRejectedValue(
      Object.assign(new Error("conflict"), {
        code: "CHAOS_RUN_OUTCOME_INTEGRITY_CONFLICT",
      }),
    );
    await expect(evaluateChaosRun(RUN_ID)).rejects.toMatchObject({
      code: "CHAOS_RUN_OUTCOME_INTEGRITY_CONFLICT",
    });
    // The immutable row was already written and is deliberately NOT removed.
    expect(persistInvariantResult).toHaveBeenCalledTimes(1);
  });

  it("23: an unchanged existing aggregate is accepted idempotently", async () => {
    assembleChaosRunEvidence.mockResolvedValue(
      c03Bundle({ before: c03Side(), after: c03Side() }),
    );
    finalizeChaosRunOutcome.mockResolvedValue({
      kind: "ALREADY_FINAL",
      outcome: "PASS",
    });
    const result = await evaluateChaosRun(RUN_ID);
    expect(result.outcomeFinalization).toBe("ALREADY_FINAL");
    expect(result.aggregateOutcome).toBe("PASS");
  });
});

// ============================================================================
// MULTI-INVARIANT SCENARIO
// ============================================================================

describe("Phase 3F-C — a multi-invariant scenario aggregates correctly", () => {
  it("24: a C11 shape persists three UNKNOWN rows and aggregates UNKNOWN", async () => {
    // No captured snapshots: INV-003 is NOT_APPLICABLE (no verified provider
    // failure), INV-004 and INV-011 are UNKNOWN on absent evidence.
    assembleChaosRunEvidence.mockResolvedValue({
      ...bundle({
        scenarioId: "C11",
        sourceWebhook: webhook({ eventType: "payment.failed" }),
        authoritativeCapture: { kind: "SEARCH_INCOMPLETE" },
        authoritativeCaptureWebhook: null,
        originalProcessingAttempts: [
          attempt({
            stateBefore: { kind: "NOT_CAPTURED" },
            stateAfter: { kind: "NOT_CAPTURED" },
          }),
        ],
      }),
      requiredInvariantIds: ["INV-003", "INV-004", "INV-011"],
    });
    finalizeChaosRunOutcome.mockResolvedValue({
      kind: "FINALIZED",
      outcome: "UNKNOWN",
    });

    const result = await evaluateChaosRun(RUN_ID);
    expect(result.aggregateOutcome).toBe("UNKNOWN");
    expect(result.evaluations.map((e) => e.invariantId)).toEqual([
      "INV-003",
      "INV-004",
      "INV-011",
    ]);
    for (const evaluation of result.evaluations) {
      expect(["UNKNOWN", "NOT_APPLICABLE"]).toContain(evaluation.disposition);
    }
  });

  it("25: a healthy captured run aggregates PASS across its required invariants", async () => {
    assembleChaosRunEvidence.mockResolvedValue({
      ...bundle({ originalProcessingAttempts: [attempt()] }),
      requiredInvariantIds: ["INV-002", "INV-004", "INV-011"],
    });
    const result = await evaluateChaosRun(RUN_ID);
    expect(result.aggregateOutcome).toBe("PASS");
    expect(persistInvariantResult).toHaveBeenCalledTimes(3);
  });

  it("26: every persisted candidate carries the run's own chaos_run_id", async () => {
    assembleChaosRunEvidence.mockResolvedValue({
      ...bundle({
        originalProcessingAttempts: [attempt({ stateAfter: captured() })],
      }),
      requiredInvariantIds: ["INV-002", "INV-004", "INV-011"],
    });
    await evaluateChaosRun(RUN_ID);
    for (const call of persistInvariantResult.mock.calls) {
      expect(call[0].chaosRunId).toBe(RUN_ID);
    }
  });
});
