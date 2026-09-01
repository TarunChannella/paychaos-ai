import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Phase 4G — the readiness composition service.
 *
 * These tests pin the WIRING, not the rules: that the frozen Phase 4F read
 * model is passed through untouched, that a read failure propagates instead of
 * becoming a clean state, that nothing is written, and that no gate this
 * runtime cannot establish is fabricated as PASS. The decision itself belongs
 * to the pure evaluator and is proved in `readiness.test.ts`.
 */

const getCurrentReliabilityScore = vi.fn();
const loadUnresolvedFindings = vi.fn();
const loadSelectedRunInvariantEvidence = vi.fn();
const getRazorpayEnv = vi.fn();

vi.mock("@/lib/reliability/service", async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  getCurrentReliabilityScore,
}));

vi.mock("@/lib/readiness/repository", async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  loadUnresolvedFindings,
  loadSelectedRunInvariantEvidence,
}));

vi.mock("@/lib/config/razorpay-env", () => ({ getRazorpayEnv }));

const { getCurrentGoLiveReadiness } = await import("@/lib/readiness/service");
const { composeReliabilityScoreReadModel } =
  await import("@/lib/reliability/service");
const { ReadinessRepositoryError } = await import("@/lib/readiness/repository");
const { ReliabilityRepositoryError } =
  await import("@/lib/reliability/repository");
const { RELIABILITY_MANDATORY_SCENARIOS } =
  await import("@/lib/reliability/types");
const { READINESS_GATE_IDS } = await import("@/lib/readiness/types");

import type { ReliabilityScoreReadModel } from "@/lib/reliability/service";

// ============================================================================
// FIXTURES — built through the REAL 4F composer, never hand-fabricated
// ============================================================================

const INVARIANT_IDS = ["INV-001", "INV-005"] as const;

/** Four terminal, correctly classified runs whose invariants all PASS. */
function healthyReliability(): ReliabilityScoreReadModel {
  const runs = RELIABILITY_MANDATORY_SCENARIOS.map((scenarioId, index) => ({
    id: `run-${scenarioId}`,
    scenarioId,
    status: "COMPLETED" as const,
    outcome: "PASS" as const,
    dataClassification:
      scenarioId === "C03"
        ? ("SYNTHETIC_DEMO" as const)
        : ("RECORDED_TEST_EVIDENCE" as const),
    createdAt: `2026-08-3${index}T00:00:00.000Z`,
    completedAt: `2026-08-3${index}T00:01:00.000Z`,
  }));

  const results = runs.flatMap((run) =>
    INVARIANT_IDS.map((invariantId) => ({
      id: `res-${run.id}-${invariantId}`,
      chaosRunId: run.id,
      invariantId,
      result: "PASS" as const,
      severity: "CRITICAL" as const,
    })),
  );

  return composeReliabilityScoreReadModel(runs, results);
}

/** Every selected run carries passing persisted invariant evidence. */
function healthyEvidence(reliability: ReliabilityScoreReadModel) {
  return reliability.score.scenarioBreakdown
    .filter((entry) => entry.selectedRunId !== null)
    .map((entry) => ({
      chaosRunId: entry.selectedRunId as string,
      results: INVARIANT_IDS.map((invariantId) => ({
        invariantId,
        result: "PASS" as const,
      })),
    }));
}

beforeEach(() => {
  vi.clearAllMocks();
  const reliability = healthyReliability();
  getCurrentReliabilityScore.mockResolvedValue(reliability);
  loadUnresolvedFindings.mockResolvedValue([]);
  loadSelectedRunInvariantEvidence.mockResolvedValue(
    healthyEvidence(reliability),
  );
  getRazorpayEnv.mockReturnValue({ keyId: "rzp_test_x", mode: "test" });
});

// ============================================================================

describe("readiness service — composition", () => {
  it("1: returns the frozen 4F read model by reference, unmodified", async () => {
    const reliability = healthyReliability();
    getCurrentReliabilityScore.mockResolvedValue(reliability);
    loadSelectedRunInvariantEvidence.mockResolvedValue(
      healthyEvidence(reliability),
    );

    const model = await getCurrentGoLiveReadiness();

    // Identity, not deep equality: proof that nothing re-scored or re-selected.
    expect(model.reliability).toBe(reliability);
    expect(model.reliability.score.score).toBe(100);
  });

  it("2: reads the reliability score exactly once — no second engine", async () => {
    await getCurrentGoLiveReadiness();
    expect(getCurrentReliabilityScore).toHaveBeenCalledTimes(1);
  });

  it("3: asks for invariant evidence for exactly the selected run ids", async () => {
    const reliability = healthyReliability();
    getCurrentReliabilityScore.mockResolvedValue(reliability);
    loadSelectedRunInvariantEvidence.mockResolvedValue(
      healthyEvidence(reliability),
    );

    await getCurrentGoLiveReadiness();

    expect(loadSelectedRunInvariantEvidence).toHaveBeenCalledWith(
      RELIABILITY_MANDATORY_SCENARIOS.map((s) => `run-${s}`),
    );
  });

  it("4: a scenario with no selected run contributes no id", async () => {
    getCurrentReliabilityScore.mockResolvedValue(
      composeReliabilityScoreReadModel([], []),
    );
    loadSelectedRunInvariantEvidence.mockResolvedValue([]);

    await getCurrentGoLiveReadiness();

    // No null, no "undefined", no placeholder id reaches the database.
    expect(loadSelectedRunInvariantEvidence).toHaveBeenCalledWith([]);
  });

  it("5: emits the full frozen gate checklist, in the frozen order", async () => {
    const model = await getCurrentGoLiveReadiness();
    expect(model.readiness.gates.map((g) => g.gateId)).toEqual([
      ...READINESS_GATE_IDS,
    ]);
  });
});

describe("readiness service — gate derivation", () => {
  it("6: Test Mode config resolving is PASS for the security gate", async () => {
    const model = await getCurrentGoLiveReadiness();
    const gate = model.readiness.gates.find(
      (g) => g.gateId === "TEST_MODE_SECURITY",
    );
    expect(gate?.state).toBe("PASS");
  });

  it("7: a rejected Razorpay configuration is FAIL and blocks READY", async () => {
    // getRazorpayEnv fails closed on a live key, so a throw is a real failure.
    getRazorpayEnv.mockImplementation(() => {
      throw new Error("live key rejected");
    });

    const model = await getCurrentGoLiveReadiness();

    expect(
      model.readiness.gates.find((g) => g.gateId === "TEST_MODE_SECURITY")
        ?.state,
    ).toBe("FAIL");
    expect(model.readiness.status).toBe("NOT READY");
    expect(model.readiness.blockingReasons.map((r) => r.code)).toContain(
      "NR_TEST_MODE_SECURITY_FAILED",
    );
  });

  it("8: no Razorpay key, secret or config value escapes into the output", async () => {
    getRazorpayEnv.mockReturnValue({
      keyId: "rzp_test_SECRETKEYID",
      keySecret: "super_secret_value",
      webhookSecret: "webhook_secret_value",
    });

    const model = await getCurrentGoLiveReadiness();
    const serialized = JSON.stringify(model);

    for (const leaked of [
      "rzp_test_SECRETKEYID",
      "super_secret_value",
      "webhook_secret_value",
    ]) {
      expect(serialized, leaked).not.toContain(leaked);
    }
  });

  it("9: gates with no runtime authority are UNKNOWN, never fabricated PASS", async () => {
    const model = await getCurrentGoLiveReadiness();

    for (const gateId of [
      "HEALTHY_BASELINE",
      "REAL_RAZORPAY_MANUAL_VERIFICATION",
      "BUILD_VERIFICATION",
      "SECURITY_VERIFICATION",
      "AUTOMATED_TEST_VERIFICATION",
      "MANUAL_VERIFICATION",
    ]) {
      const gate = model.readiness.gates.find((g) => g.gateId === gateId);
      expect(gate?.state, gateId).toBe("UNKNOWN");
    }
  });

  it("10: an UNKNOWN gate never produces a blocking reason", async () => {
    // UNKNOWN means "not verified", which withholds READY. It must not be
    // reported as a failure that did not happen.
    const model = await getCurrentGoLiveReadiness();

    expect(model.readiness.blockingReasons).toEqual([]);
    expect(model.readiness.status).toBe("NEEDS ATTENTION");
    expect(model.readiness.attentionReasons.map((r) => r.code)).toContain(
      "NA_REQUIRED_VERIFICATION_INCOMPLETE",
    );
  });

  it("11: a genuinely failed mandatory scenario is FAIL and blocks", () => {
    // Consistent fixture: the SAME failing invariant result drives both the
    // 4F scenario state and the readiness gate, exactly as in production
    // where both derive from the same `invariant_results` rows.
    return (async () => {
      const runs = RELIABILITY_MANDATORY_SCENARIOS.map((scenarioId, index) => ({
        id: `run-${scenarioId}`,
        scenarioId,
        status: "COMPLETED" as const,
        // The run outcome is the 4F scenario-state authority, so a genuine
        // failure must be recorded HERE as well as in the invariant rows.
        outcome: scenarioId === "C01" ? ("FAIL" as const) : ("PASS" as const),
        dataClassification:
          scenarioId === "C03"
            ? ("SYNTHETIC_DEMO" as const)
            : ("RECORDED_TEST_EVIDENCE" as const),
        createdAt: `2026-08-3${index}T00:00:00.000Z`,
        completedAt: `2026-08-3${index}T00:01:00.000Z`,
      }));
      const results = runs.flatMap((run) =>
        INVARIANT_IDS.map((invariantId) => ({
          id: `res-${run.id}-${invariantId}`,
          chaosRunId: run.id,
          invariantId,
          result:
            run.id === "run-C01" && invariantId === "INV-001"
              ? ("FAIL" as const)
              : ("PASS" as const),
          severity: "CRITICAL" as const,
        })),
      );
      const reliability = composeReliabilityScoreReadModel(runs, results);
      getCurrentReliabilityScore.mockResolvedValue(reliability);
      loadSelectedRunInvariantEvidence.mockResolvedValue(
        runs.map((run) => ({
          chaosRunId: run.id,
          results: results
            .filter((r) => r.chaosRunId === run.id)
            .map((r) => ({ invariantId: r.invariantId, result: r.result })),
        })),
      );

      const model = await getCurrentGoLiveReadiness();

      expect(
        model.readiness.gates.find(
          (g) => g.gateId === "SELECTED_RUN_INVARIANTS",
        )?.state,
      ).toBe("FAIL");
      expect(model.readiness.status).toBe("NOT READY");
      expect(model.readiness.blockingReasons.map((r) => r.code)).toContain(
        "NR_MANDATORY_SCENARIO_FAILED",
      );
    })();
  });

  it("11b: an internally inconsistent input is never READY", async () => {
    // Cannot occur in production, but must fail closed if it ever did: the 4F
    // model reports every scenario PASS while the persisted evidence for a
    // selected run reports FAIL.
    const reliability = healthyReliability();
    getCurrentReliabilityScore.mockResolvedValue(reliability);
    loadSelectedRunInvariantEvidence.mockResolvedValue([
      {
        chaosRunId: "run-C01",
        results: [{ invariantId: "INV-001", result: "FAIL" as const }],
      },
    ]);

    const model = await getCurrentGoLiveReadiness();

    expect(model.readiness.status).not.toBe("READY");
    expect(
      model.readiness.gates.find((g) => g.gateId === "SELECTED_RUN_INVARIANTS")
        ?.state,
    ).toBe("FAIL");
  });

  it("12: a selected run with NO persisted evidence is UNKNOWN, not PASS", async () => {
    loadSelectedRunInvariantEvidence.mockResolvedValue([]);

    const model = await getCurrentGoLiveReadiness();

    expect(
      model.readiness.gates.find((g) => g.gateId === "SELECTED_RUN_INVARIANTS")
        ?.state,
    ).toBe("UNKNOWN");
    expect(model.readiness.status).not.toBe("READY");
  });

  it("13: an unresolved CRITICAL finding blocks", async () => {
    loadUnresolvedFindings.mockResolvedValue([
      { findingId: "f-1", severity: "CRITICAL" },
    ]);

    const model = await getCurrentGoLiveReadiness();

    expect(model.readiness.status).toBe("NOT READY");
    expect(model.readiness.blockingReasons.map((r) => r.code)).toContain(
      "NR_UNRESOLVED_HIGH_RISK_FINDING",
    );
  });
});

describe("readiness service — READ FAILURE IS NOT A CLEAN STATE", () => {
  it("14: a findings read failure propagates and yields no verdict", async () => {
    loadUnresolvedFindings.mockRejectedValue(
      new ReadinessRepositoryError("FINDING_READ_FAILED", "safe"),
    );

    await expect(getCurrentGoLiveReadiness()).rejects.toBeInstanceOf(
      ReadinessRepositoryError,
    );
  });

  it("15: an invariant-evidence read failure propagates", async () => {
    loadSelectedRunInvariantEvidence.mockRejectedValue(
      new ReadinessRepositoryError("INVARIANT_RESULT_READ_FAILED", "safe"),
    );

    await expect(getCurrentGoLiveReadiness()).rejects.toBeInstanceOf(
      ReadinessRepositoryError,
    );
  });

  it("16: a reliability read failure propagates untouched", async () => {
    getCurrentReliabilityScore.mockRejectedValue(
      new ReliabilityRepositoryError("CHAOS_RUN_READ_FAILED", "safe"),
    );

    await expect(getCurrentGoLiveReadiness()).rejects.toBeInstanceOf(
      ReliabilityRepositoryError,
    );
  });

  it("17: a read failure NEVER resolves to a READY assessment", async () => {
    // The defining safety property of this phase.
    for (const failing of [
      loadUnresolvedFindings,
      loadSelectedRunInvariantEvidence,
      getCurrentReliabilityScore,
    ]) {
      vi.clearAllMocks();
      const reliability = healthyReliability();
      getCurrentReliabilityScore.mockResolvedValue(reliability);
      loadUnresolvedFindings.mockResolvedValue([]);
      loadSelectedRunInvariantEvidence.mockResolvedValue(
        healthyEvidence(reliability),
      );
      getRazorpayEnv.mockReturnValue({ keyId: "rzp_test_x" });
      failing.mockRejectedValue(
        new ReadinessRepositoryError("FINDING_READ_FAILED", "safe"),
      );

      const outcome = await getCurrentGoLiveReadiness()
        .then(() => "resolved")
        .catch(() => "rejected");

      expect(outcome).toBe("rejected");
    }
  });

  it("18: a failed read is not caught and downgraded into NEEDS ATTENTION", async () => {
    loadUnresolvedFindings.mockRejectedValue(
      new ReadinessRepositoryError("FINDING_READ_FAILED", "safe"),
    );

    const settled = await getCurrentGoLiveReadiness().then(
      (value) => ({ ok: true, value }),
      () => ({ ok: false, value: null }),
    );

    expect(settled.ok).toBe(false);
  });
});

describe("readiness service — determinism and non-persistence", () => {
  it("19: the same evidence produces an identical assessment", async () => {
    const first = await getCurrentGoLiveReadiness();
    const second = await getCurrentGoLiveReadiness();

    expect(second.readiness).toEqual(first.readiness);
  });

  it("20: the module exposes only the single read entry point", async () => {
    const readinessModule = await import("@/lib/readiness/service");
    const exported = Object.keys(readinessModule).filter(
      (key) =>
        typeof (readinessModule as Record<string, unknown>)[key] === "function",
    );

    // No save/persist/store/upsert/record function exists to be called.
    expect(exported).toEqual(["getCurrentGoLiveReadiness"]);
  });

  it("21: the loaded evidence arrays are never mutated", async () => {
    const findings = [{ findingId: "f-1", severity: "LOW" as const }];
    loadUnresolvedFindings.mockResolvedValue(findings);

    await getCurrentGoLiveReadiness();

    expect(findings).toEqual([{ findingId: "f-1", severity: "LOW" }]);
  });
});
