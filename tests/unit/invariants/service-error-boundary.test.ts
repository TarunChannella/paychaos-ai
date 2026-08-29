import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const assembleChaosRunEvidence = vi.fn();
const persistInvariantResult = vi.fn();
const finalizeChaosRunOutcome = vi.fn();
const evaluateInvariant = vi.fn();

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

vi.mock("@/lib/invariants/evaluate", () => ({
  evaluateInvariant: (...args: unknown[]) => evaluateInvariant(...args),
}));

import {
  evaluateChaosRun,
  InvariantEvaluationServiceError,
} from "@/lib/invariants/service";

import { bundle, c11Scenario, RUN_ID } from "./fixtures";

/**
 * Phase 3F-C — the service's ERROR boundary, and ONLY that.
 *
 * `evaluateInvariant` is mocked in this file — and nowhere else — because the
 * frozen Phase 3F-B evaluators are deliberately built so that a well-formed
 * bundle can never produce `ERROR`. `ERROR` exists for an internal contract
 * violation (an unregistered id reaching the dispatcher, an evaluator throwing),
 * which is exactly what the dispatcher's own frozen unit test already covers.
 *
 * What is NOT covered anywhere else, and is covered here, is the ORCHESTRATION
 * consequence: when any required invariant comes back `ERROR`, the service must
 * abandon the whole run BEFORE it writes anything — no `invariant_results` row,
 * no `chaos_runs.outcome` finalization — and surface a safe typed error.
 *
 * This mock exists solely to reach that branch. It never mocks payment
 * semantics: `tests/unit/invariants/service.test.ts` runs the real evaluators.
 */

/** A C11 bundle — three required invariants, so partial persistence is visible. */
function c11Bundle() {
  return {
    ...bundle({ scenarioId: "C11", scenarioEvidence: c11Scenario() }),
    requiredInvariantIds: ["INV-003", "INV-004", "INV-011"] as const,
  };
}

function envelope(invariantId: string, disposition: string) {
  if (disposition === "ERROR" || disposition === "NOT_APPLICABLE") {
    return { invariantId, disposition, reason: "boundary fixture" };
  }
  return {
    invariantId,
    disposition,
    invariantVersion: "1",
    severity: "CRITICAL",
    expectedSummary: "expected",
    observedSummary: "observed",
    reason: "boundary fixture",
    evidenceRefs: [],
    correlations: { orderId: null, paymentAttemptId: null, paymentId: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  assembleChaosRunEvidence.mockResolvedValue(c11Bundle());
  persistInvariantResult.mockRejectedValue(
    new Error("persistInvariantResult must never be reached on the ERROR path"),
  );
  finalizeChaosRunOutcome.mockRejectedValue(
    new Error(
      "finalizeChaosRunOutcome must never be reached on the ERROR path",
    ),
  );
});

describe("Phase 3F-C — evaluator ERROR aborts the orchestration before any write", () => {
  it("1: a single ERROR envelope persists nothing, finalizes nothing, and throws INVARIANT_EVALUATION_ERROR", async () => {
    evaluateInvariant.mockImplementation((id: string) =>
      id === "INV-004" ? envelope(id, "ERROR") : envelope(id, "PASS"),
    );

    const failure = evaluateChaosRun(RUN_ID);

    await expect(failure).rejects.toBeInstanceOf(
      InvariantEvaluationServiceError,
    );
    await expect(failure).rejects.toMatchObject({
      code: "INVARIANT_EVALUATION_ERROR",
    });

    // The whole required set WAS evaluated in memory first...
    expect(evaluateInvariant).toHaveBeenCalledTimes(3);
    // ...and then nothing at all was written.
    expect(persistInvariantResult).not.toHaveBeenCalled();
    expect(finalizeChaosRunOutcome).not.toHaveBeenCalled();
  });

  it("2: an ERROR alongside a would-be FAIL still writes nothing — ERROR never becomes payment truth", async () => {
    evaluateInvariant.mockImplementation((id: string) => {
      if (id === "INV-003") return envelope(id, "FAIL");
      if (id === "INV-004") return envelope(id, "ERROR");
      return envelope(id, "PASS");
    });

    await expect(evaluateChaosRun(RUN_ID)).rejects.toMatchObject({
      code: "INVARIANT_EVALUATION_ERROR",
    });

    expect(persistInvariantResult).not.toHaveBeenCalled();
    expect(finalizeChaosRunOutcome).not.toHaveBeenCalled();
  });

  it("3: EVERY required invariant returning ERROR is still a single safe typed failure", async () => {
    evaluateInvariant.mockImplementation((id: string) => envelope(id, "ERROR"));

    await expect(evaluateChaosRun(RUN_ID)).rejects.toMatchObject({
      code: "INVARIANT_EVALUATION_ERROR",
    });

    expect(persistInvariantResult).not.toHaveBeenCalled();
    expect(finalizeChaosRunOutcome).not.toHaveBeenCalled();
  });

  it("4: the thrown error leaks no raw internal detail", async () => {
    evaluateInvariant.mockImplementation((id: string) =>
      id === "INV-011" ? envelope(id, "ERROR") : envelope(id, "PASS"),
    );

    let thrown: unknown;
    try {
      await evaluateChaosRun(RUN_ID);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(InvariantEvaluationServiceError);
    const message = (thrown as Error).message;
    const serialized = `${message} ${JSON.stringify((thrown as { code: string }).code)}`;

    // A stable, human-readable statement of consequence — not a stack, not a
    // payload, not a raw evaluator dump.
    expect(message).toMatch(/no result was persisted/i);
    for (const forbidden of [
      "boundary fixture",
      "state_before",
      "state_after",
      "raw_body_sha256",
      "signature",
      "razorpay",
      "select",
      "insert",
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("5: the control case — with no ERROR the same orchestration DOES persist and finalize", async () => {
    // Proves tests 1-4 fail for the intended reason, not because the mocked
    // repository was simply never reachable.
    persistInvariantResult.mockReset();
    finalizeChaosRunOutcome.mockReset();
    persistInvariantResult.mockImplementation(
      (candidate: { invariantId: string }) => ({
        kind: "INSERTED",
        row: { id: `row-${candidate.invariantId}` },
      }),
    );
    finalizeChaosRunOutcome.mockResolvedValue({ kind: "FINALIZED" });
    evaluateInvariant.mockImplementation((id: string) => envelope(id, "PASS"));

    const result = await evaluateChaosRun(RUN_ID);

    expect(result.aggregateOutcome).toBe("PASS");
    expect(persistInvariantResult).toHaveBeenCalledTimes(3);
    expect(finalizeChaosRunOutcome).toHaveBeenCalledTimes(1);
  });
});
