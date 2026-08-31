import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Phase 4E-R2 — trusted regression orchestration.
 *
 * Every frozen Phase 3 surface is mocked so the assertions are about what
 * this service DOES: which scenario it rebuilds, which existing service it
 * calls, what it re-reads, and in what order it writes. Two things are
 * deliberately NOT mocked and run for real:
 *
 *   - `lib/regression/finalization.ts`, so the frozen R1 verdict rules decide
 *     every outcome here rather than a fixture pretending to;
 *   - `RegressionRepositoryError`, so the active-race branch is exercised
 *     through the genuine error type.
 */

// --- frozen Phase 3 surfaces ------------------------------------------------
const resolveRegressionEligibility = vi.fn();
const getChaosRunById = vi.fn();
const createChaosRun = vi.fn();
const revalidateEligibility = vi.fn();
const executeC01Replay = vi.fn();
const executeC03InvalidSignatureTest = vi.fn();
const armC07ClientConfirmationDrop = vi.fn();
const executeC11RealWebhookReplay = vi.fn();
const startC11AFailureObservation = vi.fn();
const evaluateChaosRun = vi.fn();
const findFindingById = vi.fn();
const findInvariantResultById = vi.fn();

// --- Phase 4E persistence ---------------------------------------------------
const insertPendingRegressionRun = vi.fn();
const startPendingRegressionRun = vi.fn();
const finalizeRegressionResolved = vi.fn();
const finalizeRegressionStillFailing = vi.fn();
const finalizeRegressionError = vi.fn();
const findRegressionRunById = vi.fn();
const resolveFindingAfterRegression = vi.fn();
const markFindingStillFailingAfterRegression = vi.fn();
const readFindingLifecycle = vi.fn();
const listRegressionRunsForFinding = vi.fn();

/** Ordered record of the durable writes, to prove the finalization order. */
const writeLog: string[] = [];

vi.mock("@/lib/regression/eligibility", () => ({
  resolveRegressionEligibility: (...a: unknown[]) =>
    resolveRegressionEligibility(...a),
}));
vi.mock("@/lib/chaos/run-repository", () => ({
  getChaosRunById: (...a: unknown[]) => getChaosRunById(...a),
}));
vi.mock("@/lib/chaos/run-service", () => ({
  createChaosRun: (...a: unknown[]) => createChaosRun(...a),
}));
vi.mock("@/lib/chaos/eligibility-service", () => ({
  revalidateEligibility: (...a: unknown[]) => revalidateEligibility(...a),
}));
vi.mock("@/lib/chaos/replay-service", () => ({
  executeC01Replay: (...a: unknown[]) => executeC01Replay(...a),
}));
vi.mock("@/lib/chaos/c03-execution-service", () => ({
  executeC03InvalidSignatureTest: (...a: unknown[]) =>
    executeC03InvalidSignatureTest(...a),
}));
vi.mock("@/lib/chaos/c07-execution-service", () => ({
  armC07ClientConfirmationDrop: (...a: unknown[]) =>
    armC07ClientConfirmationDrop(...a),
}));
vi.mock("@/lib/chaos/c11-execution-service", () => ({
  executeC11RealWebhookReplay: (...a: unknown[]) =>
    executeC11RealWebhookReplay(...a),
  startC11AFailureObservation: (...a: unknown[]) =>
    startC11AFailureObservation(...a),
}));
vi.mock("@/lib/invariants/service", () => ({
  evaluateChaosRun: (...a: unknown[]) => evaluateChaosRun(...a),
}));
vi.mock("@/lib/findings/repository", () => ({
  findFindingById: (...a: unknown[]) => findFindingById(...a),
  findInvariantResultById: (...a: unknown[]) => findInvariantResultById(...a),
}));
vi.mock("@/lib/regression/repository", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/regression/repository")
  >("@/lib/regression/repository");
  return {
    RegressionRepositoryError: actual.RegressionRepositoryError,
    insertPendingRegressionRun: (...a: unknown[]) =>
      insertPendingRegressionRun(...a),
    startPendingRegressionRun: (...a: unknown[]) =>
      startPendingRegressionRun(...a),
    finalizeRegressionResolved: (...a: unknown[]) =>
      finalizeRegressionResolved(...a),
    finalizeRegressionStillFailing: (...a: unknown[]) =>
      finalizeRegressionStillFailing(...a),
    finalizeRegressionError: (...a: unknown[]) => finalizeRegressionError(...a),
    findRegressionRunById: (...a: unknown[]) => findRegressionRunById(...a),
    listRegressionRunsForFinding: (...a: unknown[]) =>
      listRegressionRunsForFinding(...a),
  };
});
vi.mock("@/lib/regression/finding-lifecycle-repository", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/regression/finding-lifecycle-repository")
  >("@/lib/regression/finding-lifecycle-repository");
  return {
    FindingLifecycleError: actual.FindingLifecycleError,
    readFindingLifecycle: (...a: unknown[]) => readFindingLifecycle(...a),
    resolveFindingAfterRegression: (...a: unknown[]) =>
      resolveFindingAfterRegression(...a),
    markFindingStillFailingAfterRegression: (...a: unknown[]) =>
      markFindingStillFailingAfterRegression(...a),
  };
});

const { advanceRegression, completeRegression, startRegression } =
  await import("@/lib/regression/service");
const { RegressionRepositoryError } =
  await import("@/lib/regression/repository");
const { FindingLifecycleError } =
  await import("@/lib/regression/finding-lifecycle-repository");

const FINDING_ID = "11111111-1111-4111-8111-111111111111";
const RESULT_ID = "22222222-2222-4222-8222-222222222222";
const OLD_RUN_ID = "33333333-3333-4333-8333-333333333333";
const NEW_RUN_ID = "44444444-4444-4444-8444-444444444444";
const REGRESSION_ID = "55555555-5555-4555-8555-555555555555";
const SOURCE_EVENT_ID = "66666666-6666-4666-8666-666666666666";
const ORDER_ID = "77777777-7777-4777-8777-777777777777";
const FRESH_ORDER_ID = "88888888-8888-4888-8888-888888888888";

function eligible(scenarioId: string, invariantId = "INV-005") {
  return {
    kind: "ELIGIBLE",
    findingId: FINDING_ID,
    findingStatus: "OPEN",
    originalInvariantResultId: RESULT_ID,
    originalInvariantId: invariantId,
    originalChaosRunId: OLD_RUN_ID,
    scenarioId,
    requiredInvariantIds: ["INV-004", "INV-005"],
  };
}

function chaosRun(overrides: Record<string, unknown> = {}) {
  return {
    id: NEW_RUN_ID,
    scenario_id: "C03",
    status: "COMPLETED",
    outcome: "UNKNOWN",
    source_webhook_event_id: null,
    order_id: null,
    ...overrides,
  };
}

/**
 * The NEW run's durable status, which the execution mocks advance exactly as
 * the real services do. Without this the run would look finished before it
 * ran, and `advanceRegression` would correctly skip execution — hiding the
 * very call each scenario test is meant to prove.
 */
let newRunStatus = "PENDING";
let newRunOutcome: string | null = null;

function regression(overrides: Record<string, unknown> = {}) {
  return {
    id: REGRESSION_ID,
    findingId: FINDING_ID,
    chaosRunId: NEW_RUN_ID,
    status: "PENDING",
    startedAt: null,
    completedAt: null,
    createdAt: "2026-09-04T10:00:00.000Z",
    ...overrides,
  };
}

function evaluation(
  aggregateOutcome: string,
  reports: { invariantId: string; disposition: string }[],
) {
  return {
    aggregateOutcome,
    evaluations: reports.map((r) => ({
      ...r,
      persistedResultId: "row",
      alreadyPersisted: false,
    })),
  };
}

/**
 * The common C03 happy path: eligible finding, old subject-free run, a new
 * run created and executed, and a passing evaluation.
 */
function arrangeC03(
  evalResult = evaluation("PASS", [
    { invariantId: "INV-004", disposition: "PASS" },
    { invariantId: "INV-005", disposition: "PASS" },
  ]),
) {
  resolveRegressionEligibility.mockResolvedValue(eligible("C03"));
  getChaosRunById.mockImplementation((id: string) =>
    Promise.resolve(
      id === OLD_RUN_ID
        ? chaosRun({ id: OLD_RUN_ID, status: "COMPLETED", outcome: "FAIL" })
        : chaosRun({ status: newRunStatus, outcome: newRunOutcome }),
    ),
  );
  createChaosRun.mockResolvedValue({
    kind: "PERSISTED_PENDING",
    chaosRunId: NEW_RUN_ID,
    scenarioId: "C03",
  });
  insertPendingRegressionRun.mockResolvedValue(regression());
  findRegressionRunById.mockResolvedValue(regression({ status: "RUNNING" }));
  startPendingRegressionRun.mockResolvedValue({
    kind: "TRANSITIONED",
    run: regression({ status: "RUNNING" }),
  });
  executeC03InvalidSignatureTest.mockImplementation(() => {
    newRunStatus = "COMPLETED";
    newRunOutcome = "UNKNOWN";
    return Promise.resolve({
      kind: "COMPLETED",
      chaosRunId: NEW_RUN_ID,
      checks: [],
    });
  });
  evaluateChaosRun.mockResolvedValue(evalResult);
  findFindingById.mockResolvedValue({
    id: FINDING_ID,
    invariantResultId: RESULT_ID,
    status: "OPEN",
  });
  findInvariantResultById.mockResolvedValue({
    id: RESULT_ID,
    invariant_id: "INV-005",
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  writeLog.length = 0;
  newRunStatus = "PENDING";
  newRunOutcome = null;
  // By default this attempt IS the newest one for its Finding.
  listRegressionRunsForFinding.mockResolvedValue([
    {
      id: REGRESSION_ID,
      findingId: FINDING_ID,
      chaosRunId: NEW_RUN_ID,
      status: "PENDING",
    },
  ]);
  readFindingLifecycle.mockResolvedValue({
    kind: "NO_CHANGE",
    findingId: FINDING_ID,
    status: "OPEN",
    resolvedAt: null,
    updatedAt: "OBSERVED",
  });
  finalizeRegressionResolved.mockImplementation(() => {
    writeLog.push("regression:RESOLVED");
    return Promise.resolve({ kind: "TRANSITIONED", run: regression() });
  });
  finalizeRegressionStillFailing.mockImplementation(() => {
    writeLog.push("regression:STILL_FAILING");
    return Promise.resolve({ kind: "TRANSITIONED", run: regression() });
  });
  finalizeRegressionError.mockImplementation(() => {
    writeLog.push("regression:ERROR");
    return Promise.resolve({ kind: "TRANSITIONED", run: regression() });
  });
  resolveFindingAfterRegression.mockImplementation(() => {
    writeLog.push("finding:RESOLVE");
    return Promise.resolve({ kind: "UPDATED" });
  });
  markFindingStillFailingAfterRegression.mockImplementation(() => {
    writeLog.push("finding:STILL_FAILING");
    return Promise.resolve({ kind: "UPDATED" });
  });
});

// ============================================================================
// ELIGIBILITY
// ============================================================================

describe("Phase 4E-R2 service — eligibility", () => {
  it("1: an ineligible finding stops before any chaos run is created", async () => {
    resolveRegressionEligibility.mockResolvedValue({
      kind: "INELIGIBLE",
      code: "REGRESSION_FINDING_NOT_FOUND",
      reason: "safe",
      findingId: null,
    });

    const result = await startRegression({ findingId: FINDING_ID });

    expect(result).toMatchObject({
      kind: "NOT_STARTED",
      reason: "NOT_ELIGIBLE",
      ineligibility: "REGRESSION_FINDING_NOT_FOUND",
    });
    expect(createChaosRun).not.toHaveBeenCalled();
    expect(insertPendingRegressionRun).not.toHaveBeenCalled();
  });

  it("2: an existing active regression stops before createChaosRun", async () => {
    resolveRegressionEligibility.mockResolvedValue({
      kind: "INELIGIBLE",
      code: "REGRESSION_ACTIVE_RUN_EXISTS",
      reason: "safe",
      findingId: FINDING_ID,
    });

    const result = await startRegression({ findingId: FINDING_ID });
    expect(result).toMatchObject({
      ineligibility: "REGRESSION_ACTIVE_RUN_EXISTS",
    });
    expect(createChaosRun).not.toHaveBeenCalled();
  });

  it("3: a RESOLVED finding may be re-tested", async () => {
    arrangeC03();
    resolveRegressionEligibility.mockResolvedValue({
      ...eligible("C03"),
      findingStatus: "RESOLVED",
    });

    const result = await startRegression({ findingId: FINDING_ID });
    expect(result.kind).toBe("COMPLETED");
    expect(createChaosRun).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// C03
// ============================================================================

describe("Phase 4E-R2 service — C03", () => {
  it("4: rebuilds the exact subject-free C03 creation shape", async () => {
    arrangeC03();
    await startRegression({ findingId: FINDING_ID });

    expect(createChaosRun).toHaveBeenCalledWith({
      scenarioId: "C03",
      mechanism: "C",
      faultType: "INVALID_SIGNATURE_TEST",
    });
    // No subject at all, and no revalidation for a scenario with no subject.
    expect(revalidateEligibility).not.toHaveBeenCalled();
  });

  it("5: executes through the existing C03 service and the frozen evaluator", async () => {
    arrangeC03();
    const result = await startRegression({ findingId: FINDING_ID });

    expect(executeC03InvalidSignatureTest).toHaveBeenCalledWith(NEW_RUN_ID);
    expect(evaluateChaosRun).toHaveBeenCalledWith(NEW_RUN_ID);
    expect(result).toMatchObject({
      kind: "COMPLETED",
      regressionStatus: "RESOLVED",
      findingAction: "RESOLVE",
    });
  });

  it("6: the new run is linked to the finding and differs from the original", async () => {
    arrangeC03();
    const result = await startRegression({ findingId: FINDING_ID });

    expect(insertPendingRegressionRun).toHaveBeenCalledWith({
      findingId: FINDING_ID,
      chaosRunId: NEW_RUN_ID,
    });
    expect(NEW_RUN_ID).not.toBe(OLD_RUN_ID);
    if (result.kind !== "COMPLETED") throw new Error("expected COMPLETED");
    expect(result.attempt.chaosRunId).toBe(NEW_RUN_ID);
    expect(result.attempt.scenarioId).toBe("C03");
  });
});

// ============================================================================
// C01
// ============================================================================

describe("Phase 4E-R2 service — C01", () => {
  function arrangeC01(eligibleSource = true) {
    resolveRegressionEligibility.mockResolvedValue(eligible("C01", "INV-002"));
    getChaosRunById.mockImplementation((id: string) =>
      Promise.resolve(
        id === OLD_RUN_ID
          ? chaosRun({
              id: OLD_RUN_ID,
              scenario_id: "C01",
              source_webhook_event_id: SOURCE_EVENT_ID,
            })
          : chaosRun({
              scenario_id: "C01",
              source_webhook_event_id: SOURCE_EVENT_ID,
              status: newRunStatus,
              outcome: newRunOutcome,
            }),
      ),
    );
    revalidateEligibility.mockResolvedValue(eligibleSource);
    createChaosRun.mockResolvedValue({
      kind: "PERSISTED_PENDING",
      chaosRunId: NEW_RUN_ID,
      scenarioId: "C01",
    });
    insertPendingRegressionRun.mockResolvedValue(regression());
    findRegressionRunById.mockResolvedValue(regression({ status: "RUNNING" }));
    startPendingRegressionRun.mockResolvedValue({ kind: "TRANSITIONED" });
    executeC01Replay.mockImplementation(() => {
      newRunStatus = "COMPLETED";
      newRunOutcome = "UNKNOWN";
      return Promise.resolve({
        kind: "COMPLETED",
        chaosRunId: NEW_RUN_ID,
        replayAttemptCount: 2,
      });
    });
    evaluateChaosRun.mockResolvedValue(
      evaluation("FAIL", [{ invariantId: "INV-002", disposition: "FAIL" }]),
    );
    findFindingById.mockResolvedValue({
      id: FINDING_ID,
      invariantResultId: RESULT_ID,
    });
    findInvariantResultById.mockResolvedValue({
      id: RESULT_ID,
      invariant_id: "INV-002",
    });
  }

  it("7: reuses the same scenario and the original genuine source", async () => {
    arrangeC01();
    await startRegression({ findingId: FINDING_ID });

    expect(createChaosRun).toHaveBeenCalledWith({
      scenarioId: "C01",
      mechanism: "B",
      faultType: "REPLAY_EVENT",
      sourceWebhookEventId: SOURCE_EVENT_ID,
    });
  });

  it("8: the source is REVALIDATED before the run is created", async () => {
    arrangeC01();
    await startRegression({ findingId: FINDING_ID });

    expect(revalidateEligibility).toHaveBeenCalledWith(
      { scenarioId: "C01" },
      SOURCE_EVENT_ID,
    );
    const revalidateOrder =
      revalidateEligibility.mock.invocationCallOrder[0] ?? 0;
    const createOrder = createChaosRun.mock.invocationCallOrder[0] ?? 0;
    expect(revalidateOrder).toBeLessThan(createOrder);
  });

  it("9: a stale original source fails closed and creates nothing", async () => {
    arrangeC01(false);
    const result = await startRegression({ findingId: FINDING_ID });

    expect(result).toMatchObject({
      kind: "NOT_STARTED",
      reason: "SOURCE_NO_LONGER_ELIGIBLE",
    });
    expect(createChaosRun).not.toHaveBeenCalled();
    expect(executeC01Replay).not.toHaveBeenCalled();
  });

  it("10: executes the existing replay service and never generates a Finding", async () => {
    arrangeC01();
    const result = await startRegression({ findingId: FINDING_ID });

    expect(executeC01Replay).toHaveBeenCalledWith(NEW_RUN_ID);
    expect(result).toMatchObject({
      kind: "COMPLETED",
      regressionStatus: "STILL_FAILING",
      findingAction: "MARK_STILL_FAILING",
    });
  });
});

// ============================================================================
// C07
// ============================================================================

describe("Phase 4E-R2 service — C07", () => {
  function arrangeC07() {
    resolveRegressionEligibility.mockResolvedValue(eligible("C07", "INV-011"));
    getChaosRunById.mockImplementation((id: string) =>
      Promise.resolve(
        id === OLD_RUN_ID
          ? chaosRun({ id: OLD_RUN_ID, scenario_id: "C07", order_id: ORDER_ID })
          : chaosRun({
              scenario_id: "C07",
              status: newRunStatus,
              outcome: newRunOutcome,
              order_id: FRESH_ORDER_ID,
            }),
      ),
    );
    revalidateEligibility.mockResolvedValue(true);
    createChaosRun.mockResolvedValue({
      kind: "PERSISTED_PENDING",
      chaosRunId: NEW_RUN_ID,
      scenarioId: "C07",
    });
    insertPendingRegressionRun.mockResolvedValue(regression());
    findRegressionRunById.mockResolvedValue(regression());
    startPendingRegressionRun.mockResolvedValue({ kind: "TRANSITIONED" });
    armC07ClientConfirmationDrop.mockImplementation(() => {
      newRunStatus = "RUNNING";
      return Promise.resolve({ kind: "ARMED", chaosRunId: NEW_RUN_ID });
    });
  }

  it("11: a missing fresh order fails closed before anything is created", async () => {
    resolveRegressionEligibility.mockResolvedValue(eligible("C07", "INV-011"));
    getChaosRunById.mockResolvedValue(
      chaosRun({ id: OLD_RUN_ID, scenario_id: "C07", order_id: ORDER_ID }),
    );

    const result = await startRegression({ findingId: FINDING_ID });
    expect(result).toMatchObject({
      kind: "NOT_STARTED",
      reason: "FRESH_ORDER_REQUIRED",
    });
    expect(createChaosRun).not.toHaveBeenCalled();
  });

  it("12: the historical order is never reused as the fresh subject", async () => {
    arrangeC07();
    await startRegression({
      findingId: FINDING_ID,
      freshOrderId: FRESH_ORDER_ID,
    });

    expect(createChaosRun).toHaveBeenCalledWith({
      scenarioId: "C07",
      mechanism: ["A", "C"],
      faultType: "DROP_CLIENT_CONFIRMATION",
      freshOrderId: FRESH_ORDER_ID,
    });
    expect(FRESH_ORDER_ID).not.toBe(ORDER_ID);
  });

  it("13: the fresh order is revalidated first", async () => {
    arrangeC07();
    await startRegression({
      findingId: FINDING_ID,
      freshOrderId: FRESH_ORDER_ID,
    });
    expect(revalidateEligibility).toHaveBeenCalledWith(
      { scenarioId: "C07" },
      FRESH_ORDER_ID,
    );
  });

  it("14: an ineligible fresh order fails closed", async () => {
    arrangeC07();
    revalidateEligibility.mockResolvedValue(false);

    const result = await startRegression({
      findingId: FINDING_ID,
      freshOrderId: FRESH_ORDER_ID,
    });
    expect(result).toMatchObject({ reason: "FRESH_ORDER_NOT_ELIGIBLE" });
    expect(createChaosRun).not.toHaveBeenCalled();
  });

  it("15: arming returns AWAITING_EXTERNAL_ACTION, never a completion", async () => {
    arrangeC07();
    const result = await startRegression({
      findingId: FINDING_ID,
      freshOrderId: FRESH_ORDER_ID,
    });

    expect(armC07ClientConfirmationDrop).toHaveBeenCalledWith(NEW_RUN_ID);
    expect(result).toMatchObject({
      kind: "AWAITING_EXTERNAL_ACTION",
      continuation: "C07_TEST_MODE_CHECKOUT",
    });
  });

  it("16: no Checkout is faked and nothing is evaluated prematurely", async () => {
    arrangeC07();
    await startRegression({
      findingId: FINDING_ID,
      freshOrderId: FRESH_ORDER_ID,
    });

    expect(evaluateChaosRun).not.toHaveBeenCalled();
    expect(resolveFindingAfterRegression).not.toHaveBeenCalled();
    expect(markFindingStillFailingAfterRegression).not.toHaveBeenCalled();
    expect(finalizeRegressionResolved).not.toHaveBeenCalled();
  });

  it("16b: reusing the HISTORICAL order is refused before anything is created", async () => {
    arrangeC07();
    // Even a still-"fresh"-looking original order is not a valid re-test
    // subject: the original run already consumed it.
    revalidateEligibility.mockResolvedValue(true);

    const result = await startRegression({
      findingId: FINDING_ID,
      freshOrderId: ORDER_ID,
    });

    expect(result).toMatchObject({
      kind: "NOT_STARTED",
      reason: "FRESH_ORDER_REUSE_FORBIDDEN",
    });
    // Structural reuse is known invalid, so eligibility is not even consulted.
    expect(revalidateEligibility).not.toHaveBeenCalled();
    expect(createChaosRun).not.toHaveBeenCalled();
    expect(insertPendingRegressionRun).not.toHaveBeenCalled();
    expect(armC07ClientConfirmationDrop).not.toHaveBeenCalled();
    expect(writeLog).toEqual([]);
  });

  it("16c: ARMED plus a durable RUNNING row means a real action is pending", async () => {
    arrangeC07();
    const result = await startRegression({
      findingId: FINDING_ID,
      freshOrderId: FRESH_ORDER_ID,
    });

    expect(result).toMatchObject({ kind: "AWAITING_EXTERNAL_ACTION" });
    // The row is re-read AFTER the arm call, never trusted from memory.
    const armOrder = armC07ClientConfirmationDrop.mock.invocationCallOrder[0]!;
    const reads = getChaosRunById.mock.invocationCallOrder;
    expect(reads.some((order) => order > armOrder)).toBe(true);
  });

  it("16d: ARMED but a durable PENDING row is NOT awaiting external action", async () => {
    arrangeC07();
    // The service reported ARMED, but nothing was durably established.
    armC07ClientConfirmationDrop.mockResolvedValue({
      kind: "ARMED",
      chaosRunId: NEW_RUN_ID,
    });

    const result = await startRegression({
      findingId: FINDING_ID,
      freshOrderId: FRESH_ORDER_ID,
    });

    expect(result).toMatchObject({ kind: "IN_PROGRESS" });
    expect(result.kind).not.toBe("AWAITING_EXTERNAL_ACTION");
    expect(writeLog).toEqual([]);
  });

  it("16e: BLOCK_PERSISTENCE_FAILED is never labelled BLOCKED on its own", async () => {
    arrangeC07();
    // The contract says durable state is UNKNOWN after this result, so the
    // row decides — and it still says PENDING.
    armC07ClientConfirmationDrop.mockResolvedValue({
      kind: "BLOCK_PERSISTENCE_FAILED",
      chaosRunId: NEW_RUN_ID,
    });

    const result = await startRegression({
      findingId: FINDING_ID,
      freshOrderId: FRESH_ORDER_ID,
    });

    expect(result).toMatchObject({ kind: "IN_PROGRESS" });
    // Not blocked, not resolved, not still-failing, and the Finding untouched.
    expect(finalizeRegressionError).not.toHaveBeenCalled();
    expect(finalizeRegressionResolved).not.toHaveBeenCalled();
    expect(finalizeRegressionStillFailing).not.toHaveBeenCalled();
    expect(writeLog).toEqual([]);
  });

  it("16f: NOT_STARTABLE loses to a durable RUNNING row", async () => {
    arrangeC07();
    // A concurrent actor already armed it; persisted truth wins.
    armC07ClientConfirmationDrop.mockImplementation(() => {
      newRunStatus = "RUNNING";
      return Promise.resolve({
        kind: "NOT_STARTABLE",
        reasonCategory: "ALREADY_STARTED_OR_NOT_PENDING",
      });
    });

    const result = await startRegression({
      findingId: FINDING_ID,
      freshOrderId: FRESH_ORDER_ID,
    });

    expect(result).toMatchObject({
      kind: "AWAITING_EXTERNAL_ACTION",
      continuation: "C07_TEST_MODE_CHECKOUT",
    });
    expect(finalizeRegressionError).not.toHaveBeenCalled();
  });

  it("16g: a durable COMPLETED row goes straight to completion", async () => {
    arrangeC07();
    armC07ClientConfirmationDrop.mockImplementation(() => {
      newRunStatus = "COMPLETED";
      newRunOutcome = "UNKNOWN";
      return Promise.resolve({ kind: "ARMED", chaosRunId: NEW_RUN_ID });
    });
    evaluateChaosRun.mockResolvedValue(
      evaluation("FAIL", [{ invariantId: "INV-011", disposition: "FAIL" }]),
    );
    findFindingById.mockResolvedValue({
      id: FINDING_ID,
      invariantResultId: RESULT_ID,
    });
    findInvariantResultById.mockResolvedValue({
      id: RESULT_ID,
      invariant_id: "INV-011",
    });

    const result = await startRegression({
      findingId: FINDING_ID,
      freshOrderId: FRESH_ORDER_ID,
    });

    expect(result).toMatchObject({ kind: "COMPLETED" });
    expect(evaluateChaosRun).toHaveBeenCalledWith(NEW_RUN_ID);
  });

  it("17: advancing an armed run keeps waiting and never re-arms", async () => {
    arrangeC07();
    findRegressionRunById.mockResolvedValue(regression({ status: "RUNNING" }));
    getChaosRunById.mockResolvedValue(
      chaosRun({
        scenario_id: "C07",
        status: "RUNNING",
        outcome: null,
        order_id: FRESH_ORDER_ID,
      }),
    );

    const result = await advanceRegression(REGRESSION_ID);
    expect(result).toMatchObject({ kind: "AWAITING_EXTERNAL_ACTION" });
    expect(armC07ClientConfirmationDrop).not.toHaveBeenCalled();
  });
});

// ============================================================================
// C11
// ============================================================================

describe("Phase 4E-R2 service — C11 path resolution", () => {
  function arrangeC11(originalRun: Record<string, unknown>) {
    resolveRegressionEligibility.mockResolvedValue(eligible("C11", "INV-003"));
    getChaosRunById.mockImplementation((id: string) =>
      Promise.resolve(
        id === OLD_RUN_ID
          ? chaosRun({ id: OLD_RUN_ID, scenario_id: "C11", ...originalRun })
          : chaosRun({
              scenario_id: "C11",
              ...originalRun,
              status: newRunStatus,
              outcome: newRunOutcome,
            }),
      ),
    );
    revalidateEligibility.mockResolvedValue(true);
    createChaosRun.mockResolvedValue({
      kind: "PERSISTED_PENDING",
      chaosRunId: NEW_RUN_ID,
      scenarioId: "C11",
    });
    insertPendingRegressionRun.mockResolvedValue(regression());
    findRegressionRunById.mockResolvedValue(regression({ status: "RUNNING" }));
    startPendingRegressionRun.mockResolvedValue({ kind: "TRANSITIONED" });
    executeC11RealWebhookReplay.mockImplementation(() => {
      newRunStatus = "COMPLETED";
      newRunOutcome = "UNKNOWN";
      return Promise.resolve({
        kind: "COMPLETED",
        chaosRunId: NEW_RUN_ID,
        replayAttemptCount: 1,
      });
    });
    startC11AFailureObservation.mockImplementation(() => {
      newRunStatus = "RUNNING";
      return Promise.resolve({ kind: "OBSERVING", chaosRunId: NEW_RUN_ID });
    });
    evaluateChaosRun.mockResolvedValue(
      evaluation("PASS", [{ invariantId: "INV-003", disposition: "PASS" }]),
    );
    findFindingById.mockResolvedValue({
      id: FINDING_ID,
      invariantResultId: RESULT_ID,
    });
    findInvariantResultById.mockResolvedValue({
      id: RESULT_ID,
      invariant_id: "INV-003",
    });
  }

  it("18: a persisted source event resolves the run as C11-B", async () => {
    arrangeC11({ source_webhook_event_id: SOURCE_EVENT_ID });
    await startRegression({ findingId: FINDING_ID });

    expect(createChaosRun).toHaveBeenCalledWith({
      scenarioId: "C11",
      mechanism: "B",
      failureEvidence: {
        kind: "REAL_WEBHOOK_EVENT",
        webhookEventId: SOURCE_EVENT_ID,
      },
    });
    expect(executeC11RealWebhookReplay).toHaveBeenCalledWith(NEW_RUN_ID);
  });

  it("19: C11-B revalidates the genuine payment.failed source", async () => {
    arrangeC11({ source_webhook_event_id: SOURCE_EVENT_ID });
    await startRegression({ findingId: FINDING_ID });

    expect(revalidateEligibility).toHaveBeenCalledWith(
      { scenarioId: "C11", mechanism: "B" },
      SOURCE_EVENT_ID,
    );
  });

  it("20: TEST_FIXTURE evidence is never constructed at runtime", async () => {
    arrangeC11({ source_webhook_event_id: SOURCE_EVENT_ID });
    await startRegression({ findingId: FINDING_ID });

    const created = JSON.stringify(createChaosRun.mock.calls);
    expect(created).toContain("REAL_WEBHOOK_EVENT");
    expect(created).not.toContain("TEST_FIXTURE");
    expect(created).not.toContain("fixtureId");
  });

  it("21: a stale C11-B source fails closed", async () => {
    arrangeC11({ source_webhook_event_id: SOURCE_EVENT_ID });
    revalidateEligibility.mockResolvedValue(false);

    const result = await startRegression({ findingId: FINDING_ID });
    expect(result).toMatchObject({ reason: "SOURCE_NO_LONGER_ELIGIBLE" });
    expect(createChaosRun).not.toHaveBeenCalled();
  });

  it("22: an order-shaped original resolves as C11-A and requires a fresh order", async () => {
    arrangeC11({ source_webhook_event_id: null, order_id: ORDER_ID });

    const missing = await startRegression({ findingId: FINDING_ID });
    expect(missing).toMatchObject({ reason: "FRESH_ORDER_REQUIRED" });

    vi.clearAllMocks();
    arrangeC11({ source_webhook_event_id: null, order_id: ORDER_ID });
    const started = await startRegression({
      findingId: FINDING_ID,
      freshOrderId: FRESH_ORDER_ID,
    });

    expect(createChaosRun).toHaveBeenCalledWith({
      scenarioId: "C11",
      mechanism: "A",
      freshOrderId: FRESH_ORDER_ID,
    });
    expect(startC11AFailureObservation).toHaveBeenCalledWith(NEW_RUN_ID);
    expect(started).toMatchObject({
      kind: "AWAITING_EXTERNAL_ACTION",
      continuation: "C11_A_TEST_MODE_FAILED_PAYMENT",
    });
  });

  it("23: C11-A never fakes a provider failure or evaluates early", async () => {
    arrangeC11({ source_webhook_event_id: null, order_id: ORDER_ID });
    await startRegression({
      findingId: FINDING_ID,
      freshOrderId: FRESH_ORDER_ID,
    });

    expect(evaluateChaosRun).not.toHaveBeenCalled();
    expect(executeC11RealWebhookReplay).not.toHaveBeenCalled();
    expect(writeLog).not.toContain("finding:RESOLVE");
  });

  it("23b: C11-A refuses the historical order as its fresh subject", async () => {
    arrangeC11({ source_webhook_event_id: null, order_id: ORDER_ID });
    revalidateEligibility.mockResolvedValue(true);

    const result = await startRegression({
      findingId: FINDING_ID,
      freshOrderId: ORDER_ID,
    });

    expect(result).toMatchObject({
      kind: "NOT_STARTED",
      reason: "FRESH_ORDER_REUSE_FORBIDDEN",
    });
    expect(revalidateEligibility).not.toHaveBeenCalled();
    expect(createChaosRun).not.toHaveBeenCalled();
    expect(startC11AFailureObservation).not.toHaveBeenCalled();
  });

  it("23c: C11-A re-reads the durable row after starting observation", async () => {
    arrangeC11({ source_webhook_event_id: null, order_id: ORDER_ID });

    const result = await startRegression({
      findingId: FINDING_ID,
      freshOrderId: FRESH_ORDER_ID,
    });

    expect(result).toMatchObject({ kind: "AWAITING_EXTERNAL_ACTION" });
    const startOrder = startC11AFailureObservation.mock.invocationCallOrder[0]!;
    expect(
      getChaosRunById.mock.invocationCallOrder.some((o) => o > startOrder),
    ).toBe(true);
  });

  it("23d: OBSERVING with a durable PENDING row is recoverable, not awaiting", async () => {
    arrangeC11({ source_webhook_event_id: null, order_id: ORDER_ID });
    startC11AFailureObservation.mockResolvedValue({
      kind: "OBSERVING",
      chaosRunId: NEW_RUN_ID,
    });

    const result = await startRegression({
      findingId: FINDING_ID,
      freshOrderId: FRESH_ORDER_ID,
    });

    expect(result).toMatchObject({ kind: "IN_PROGRESS" });
    expect(writeLog).toEqual([]);
  });

  it("24: an unclassifiable original fails closed rather than guessing", async () => {
    arrangeC11({ source_webhook_event_id: null, order_id: null });

    const result = await startRegression({
      findingId: FINDING_ID,
      freshOrderId: FRESH_ORDER_ID,
    });
    expect(result).toMatchObject({ reason: "ORIGINAL_PATH_UNRESOLVED" });
    expect(createChaosRun).not.toHaveBeenCalled();
  });
});

// ============================================================================
// FINALIZATION
// ============================================================================

describe("Phase 4E-R2 service — finalization", () => {
  it("25: aggregate PASS with the original invariant PASS resolves both", async () => {
    arrangeC03();
    const result = await startRegression({ findingId: FINDING_ID });

    expect(result).toMatchObject({
      regressionStatus: "RESOLVED",
      findingAction: "RESOLVE",
      decisionReason: "SCENARIO_CRITERIA_PASSED",
    });
    expect(writeLog).toEqual(["regression:RESOLVED", "finding:RESOLVE"]);
  });

  it("26: aggregate FAIL marks both still failing", async () => {
    arrangeC03(
      evaluation("FAIL", [
        { invariantId: "INV-004", disposition: "FAIL" },
        { invariantId: "INV-005", disposition: "PASS" },
      ]),
    );
    const result = await startRegression({ findingId: FINDING_ID });

    expect(result).toMatchObject({
      regressionStatus: "STILL_FAILING",
      findingAction: "MARK_STILL_FAILING",
    });
    expect(writeLog).toEqual([
      "regression:STILL_FAILING",
      "finding:STILL_FAILING",
    ]);
  });

  it("27: aggregate UNKNOWN errors the regression and leaves the finding alone", async () => {
    arrangeC03(
      evaluation("UNKNOWN", [
        { invariantId: "INV-005", disposition: "UNKNOWN" },
      ]),
    );
    const result = await startRegression({ findingId: FINDING_ID });

    expect(result).toMatchObject({
      regressionStatus: "ERROR",
      findingAction: "NO_CHANGE",
      decisionReason: "INCONCLUSIVE_UNKNOWN",
    });
    expect(writeLog).toEqual(["regression:ERROR"]);
    expect(resolveFindingAfterRegression).not.toHaveBeenCalled();
    expect(markFindingStillFailingAfterRegression).not.toHaveBeenCalled();
  });

  it("28: PASS with the original invariant missing never resolves", async () => {
    arrangeC03(
      evaluation("PASS", [{ invariantId: "INV-004", disposition: "PASS" }]),
    );
    const result = await startRegression({ findingId: FINDING_ID });

    expect(result).toMatchObject({
      regressionStatus: "ERROR",
      findingAction: "NO_CHANGE",
      decisionReason: "ORIGINAL_INVARIANT_NOT_PROVEN_PASS",
    });
    expect(writeLog).toEqual(["regression:ERROR"]);
  });

  it("29: an evaluation failure errors the regression, not the finding", async () => {
    arrangeC03();
    evaluateChaosRun.mockRejectedValue(new Error("evaluator exploded"));

    const result = await startRegression({ findingId: FINDING_ID });
    expect(result).toMatchObject({
      kind: "ERRORED",
      reason: "EVALUATION_FAILED",
    });
    expect(writeLog).toEqual(["regression:ERROR"]);
  });

  it("30: a technically FAILED chaos run is never reported as an invariant failure", async () => {
    arrangeC03();
    getChaosRunById.mockResolvedValue(
      chaosRun({ status: "FAILED", outcome: "ERROR" }),
    );

    const result = await startRegression({ findingId: FINDING_ID });
    expect(result).toMatchObject({
      kind: "ERRORED",
      reason: "EXECUTION_FAILED",
    });
    expect(evaluateChaosRun).not.toHaveBeenCalled();
    expect(writeLog).toEqual(["regression:ERROR"]);
  });

  it("31: a BLOCKED outcome errors without evaluating", async () => {
    arrangeC03();
    getChaosRunById.mockResolvedValue(
      chaosRun({ status: "COMPLETED", outcome: "BLOCKED" }),
    );

    const result = await startRegression({ findingId: FINDING_ID });
    expect(result).toMatchObject({ reason: "CHAOS_RUN_BLOCKED" });
    expect(evaluateChaosRun).not.toHaveBeenCalled();
  });

  it("32: a persisted-BLOCKED start never executes and never touches the finding", async () => {
    arrangeC03();
    createChaosRun.mockResolvedValue({
      kind: "PERSISTED_BLOCKED",
      chaosRunId: NEW_RUN_ID,
      scenarioId: "C03",
      failedPrecheckId: "PRECHECK-08",
      reason: "safe",
    });

    const result = await startRegression({ findingId: FINDING_ID });
    expect(result).toMatchObject({
      kind: "ERRORED",
      reason: "CHAOS_RUN_BLOCKED",
      failedPrecheckId: "PRECHECK-08",
    });
    // The regression row still exists, so the attempt is auditable.
    expect(insertPendingRegressionRun).toHaveBeenCalled();
    expect(executeC03InvalidSignatureTest).not.toHaveBeenCalled();
    expect(startPendingRegressionRun).not.toHaveBeenCalled();
    expect(writeLog).toEqual(["regression:ERROR"]);
  });

  it("33: a non-persisted block creates no regression row at all", async () => {
    arrangeC03();
    createChaosRun.mockResolvedValue({
      kind: "NOT_PERSISTED_BLOCKED",
      reasonCategory: "PRECHECK_FAILED",
      reason: "safe",
    });

    const result = await startRegression({ findingId: FINDING_ID });
    expect(result).toMatchObject({
      kind: "NOT_STARTED",
      reason: "CHAOS_RUN_NOT_PERSISTED",
    });
    expect(insertPendingRegressionRun).not.toHaveBeenCalled();
  });

  it("34: the regression is terminalized BEFORE the finding is written", async () => {
    arrangeC03();
    await startRegression({ findingId: FINDING_ID });

    expect(writeLog[0]).toBe("regression:RESOLVED");
    expect(writeLog[1]).toBe("finding:RESOLVE");
  });
});

// ============================================================================
// EVIDENCE, RETRY, RACE
// ============================================================================

describe("Phase 4E-R2 service — evidence and recovery", () => {
  it("35: no Finding is ever generated for the new invariant results", async () => {
    arrangeC03();
    await startRegression({ findingId: FINDING_ID });

    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("lib/regression/service.ts", "utf8"),
    );
    expect(source).not.toContain("generateFindingsForChaosRun");
    expect(source).not.toContain("createFindingFromInvariantResult");
  });

  it("36: the original invariant result is never written", async () => {
    arrangeC03();
    await startRegression({ findingId: FINDING_ID });

    // The only reads of the original evidence are exactly that — reads.
    expect(findInvariantResultById).toHaveBeenCalledWith(RESULT_ID);
    expect(writeLog.filter((w) => w.startsWith("finding:"))).toEqual([
      "finding:RESOLVE",
    ]);
  });

  it("37: completion converges the finding after a lost lifecycle write", async () => {
    arrangeC03();
    // The chaos run genuinely finished and the regression already
    // terminalized; only the Finding write was lost. That is the exact state
    // a crash between the two durable steps leaves behind.
    newRunStatus = "COMPLETED";
    newRunOutcome = "UNKNOWN";
    findRegressionRunById.mockResolvedValue(
      regression({ status: "RESOLVED", completedAt: "T" }),
    );

    const result = await completeRegression(REGRESSION_ID);

    expect(result).toMatchObject({ regressionStatus: "RESOLVED" });
    expect(resolveFindingAfterRegression).toHaveBeenCalledTimes(1);
    // Re-terminalizing an already-terminal regression is the repository's
    // idempotent ALREADY path, never a status rewrite.
    expect(finalizeRegressionResolved).toHaveBeenCalledTimes(1);
  });

  it("38: a repeated completion is idempotent", async () => {
    arrangeC03();
    newRunStatus = "COMPLETED";
    newRunOutcome = "UNKNOWN";
    findRegressionRunById.mockResolvedValue(
      regression({ status: "RESOLVED", completedAt: "T" }),
    );
    resolveFindingAfterRegression.mockImplementation(() => {
      writeLog.push("finding:ALREADY");
      return Promise.resolve({ kind: "ALREADY" });
    });

    const first = await completeRegression(REGRESSION_ID);
    const second = await completeRegression(REGRESSION_ID);
    expect(second).toEqual(first);
  });

  it("39: advancing a terminal regression never re-executes the scenario", async () => {
    arrangeC03();
    newRunStatus = "COMPLETED";
    newRunOutcome = "UNKNOWN";
    evaluateChaosRun.mockResolvedValue(
      evaluation("FAIL", [{ invariantId: "INV-005", disposition: "FAIL" }]),
    );
    findRegressionRunById.mockResolvedValue(
      regression({ status: "STILL_FAILING", completedAt: "T" }),
    );

    await advanceRegression(REGRESSION_ID);
    expect(executeC03InvalidSignatureTest).not.toHaveBeenCalled();
    expect(createChaosRun).not.toHaveBeenCalled();
    expect(insertPendingRegressionRun).not.toHaveBeenCalled();
  });

  it("40: a lost active-race leaves an orphan run unexecuted and undeleted", async () => {
    arrangeC03();
    insertPendingRegressionRun.mockRejectedValue(
      new RegressionRepositoryError(
        "REGRESSION_ACTIVE_RUN_CONFLICT",
        "An active regression already exists for this finding.",
      ),
    );

    const result = await startRegression({ findingId: FINDING_ID });

    expect(result).toMatchObject({
      kind: "ORPHAN_START",
      chaosRunId: NEW_RUN_ID,
      reason: "ACTIVE_RACE_LOST",
    });
    // Never executed, never evaluated, and no Finding touched.
    expect(executeC03InvalidSignatureTest).not.toHaveBeenCalled();
    expect(evaluateChaosRun).not.toHaveBeenCalled();
    expect(writeLog).toEqual([]);
  });

  it("41: a non-race repository failure is not swallowed as an orphan", async () => {
    arrangeC03();
    insertPendingRegressionRun.mockRejectedValue(
      new RegressionRepositoryError(
        "REGRESSION_INSERT_FAILED",
        "The regression record could not be created.",
      ),
    );

    await expect(
      startRegression({ findingId: FINDING_ID }),
    ).rejects.toMatchObject({ code: "REGRESSION_INSERT_FAILED" });
  });

  it("43: an older PASS retry never overwrites a newer FAIL verdict", async () => {
    // A resolved, then a newer attempt that failed and reopened the Finding.
    arrangeC03();
    newRunStatus = "COMPLETED";
    newRunOutcome = "UNKNOWN";
    findRegressionRunById.mockResolvedValue(
      regression({ status: "RESOLVED", completedAt: "T1" }),
    );
    listRegressionRunsForFinding.mockResolvedValue([
      {
        id: "newer-attempt",
        findingId: FINDING_ID,
        chaosRunId: "newer-run",
        status: "STILL_FAILING",
      },
      {
        id: REGRESSION_ID,
        findingId: FINDING_ID,
        chaosRunId: NEW_RUN_ID,
        status: "RESOLVED",
      },
    ]);

    const result = await completeRegression(REGRESSION_ID);

    expect(result).toMatchObject({
      kind: "SUPERSEDED",
      regressionStatus: "RESOLVED",
      reason: "NEWER_REGRESSION_EXISTS",
    });
    // The older verdict stands as history; the Finding is left alone.
    expect(resolveFindingAfterRegression).not.toHaveBeenCalled();
    expect(markFindingStillFailingAfterRegression).not.toHaveBeenCalled();
    expect(writeLog.filter((w) => w.startsWith("finding:"))).toEqual([]);
  });

  it("44: an older FAIL retry never reopens a newer RESOLVED Finding", async () => {
    arrangeC03(
      evaluation("FAIL", [{ invariantId: "INV-005", disposition: "FAIL" }]),
    );
    newRunStatus = "COMPLETED";
    newRunOutcome = "UNKNOWN";
    findRegressionRunById.mockResolvedValue(
      regression({ status: "STILL_FAILING", completedAt: "T1" }),
    );
    listRegressionRunsForFinding.mockResolvedValue([
      {
        id: "newer-attempt",
        findingId: FINDING_ID,
        chaosRunId: "newer-run",
        status: "RESOLVED",
      },
      {
        id: REGRESSION_ID,
        findingId: FINDING_ID,
        chaosRunId: NEW_RUN_ID,
        status: "STILL_FAILING",
      },
    ]);

    const result = await completeRegression(REGRESSION_ID);

    expect(result).toMatchObject({
      kind: "SUPERSEDED",
      regressionStatus: "STILL_FAILING",
      reason: "NEWER_REGRESSION_EXISTS",
    });
    expect(markFindingStillFailingAfterRegression).not.toHaveBeenCalled();
    expect(writeLog.filter((w) => w.startsWith("finding:"))).toEqual([]);
  });

  it("45: a newer attempt appearing DURING the write is caught by the CAS", async () => {
    // The latest-attempt check passes, then a newer regression completes and
    // moves the Finding before this write lands. The compare-and-set fails,
    // and the second history read reveals why.
    arrangeC03();
    newRunStatus = "COMPLETED";
    newRunOutcome = "UNKNOWN";
    findRegressionRunById.mockResolvedValue(
      regression({ status: "RESOLVED", completedAt: "T1" }),
    );
    listRegressionRunsForFinding
      .mockResolvedValueOnce([
        {
          id: REGRESSION_ID,
          findingId: FINDING_ID,
          chaosRunId: NEW_RUN_ID,
          status: "RESOLVED",
        },
      ])
      .mockResolvedValue([
        {
          id: "newer-attempt",
          findingId: FINDING_ID,
          chaosRunId: "newer-run",
          status: "STILL_FAILING",
        },
        {
          id: REGRESSION_ID,
          findingId: FINDING_ID,
          chaosRunId: NEW_RUN_ID,
          status: "RESOLVED",
        },
      ]);
    resolveFindingAfterRegression.mockRejectedValue(
      new FindingLifecycleError(
        "FINDING_LIFECYCLE_STATE_CONFLICT",
        "safe wording",
      ),
    );

    const result = await completeRegression(REGRESSION_ID);

    expect(result).toMatchObject({
      kind: "SUPERSEDED",
      reason: "NEWER_REGRESSION_EXISTS",
    });
    // Exactly one attempt, and no retry loop.
    expect(resolveFindingAfterRegression).toHaveBeenCalledTimes(1);
  });

  it("46: a genuine conflict on the newest attempt is never hidden", async () => {
    arrangeC03();
    newRunStatus = "COMPLETED";
    newRunOutcome = "UNKNOWN";
    findRegressionRunById.mockResolvedValue(
      regression({ status: "RESOLVED", completedAt: "T1" }),
    );
    resolveFindingAfterRegression.mockRejectedValue(
      new FindingLifecycleError(
        "FINDING_LIFECYCLE_STATE_CONFLICT",
        "safe wording",
      ),
    );

    await expect(completeRegression(REGRESSION_ID)).rejects.toMatchObject({
      code: "FINDING_LIFECYCLE_STATE_CONFLICT",
    });
  });

  it("47: the lifecycle write is compare-and-set on the observed updated_at", async () => {
    arrangeC03();
    await startRegression({ findingId: FINDING_ID });

    expect(resolveFindingAfterRegression).toHaveBeenCalledWith(
      expect.objectContaining({ expectedUpdatedAt: "OBSERVED" }),
    );
  });

  // ==========================================================================
  // SINGLE-STEP: PERSISTED STATE IS AUTHORITATIVE
  // ==========================================================================

  it("48: C03 NOT_STARTABLE plus a durable COMPLETED row still evaluates", async () => {
    arrangeC03();
    // Another actor already ran it: the execution call refuses, but the
    // durable evidence is real and must be evaluated.
    executeC03InvalidSignatureTest.mockImplementation(() => {
      newRunStatus = "COMPLETED";
      newRunOutcome = "UNKNOWN";
      return Promise.resolve({
        kind: "NOT_STARTABLE",
        reasonCategory: "ALREADY_STARTED_OR_NOT_PENDING",
      });
    });

    const result = await startRegression({ findingId: FINDING_ID });

    expect(evaluateChaosRun).toHaveBeenCalledWith(NEW_RUN_ID);
    expect(result).toMatchObject({
      kind: "COMPLETED",
      regressionStatus: "RESOLVED",
    });
    // NOT an ERROR merely because the in-memory result said NOT_STARTABLE.
    expect(writeLog).toEqual(["regression:RESOLVED", "finding:RESOLVE"]);
  });

  it("49: C01 NOT_STARTABLE plus a durable COMPLETED row still evaluates", async () => {
    resolveRegressionEligibility.mockResolvedValue(eligible("C01", "INV-002"));
    getChaosRunById.mockImplementation((id: string) =>
      Promise.resolve(
        id === OLD_RUN_ID
          ? chaosRun({
              id: OLD_RUN_ID,
              scenario_id: "C01",
              source_webhook_event_id: SOURCE_EVENT_ID,
            })
          : chaosRun({
              scenario_id: "C01",
              source_webhook_event_id: SOURCE_EVENT_ID,
              status: newRunStatus,
              outcome: newRunOutcome,
            }),
      ),
    );
    revalidateEligibility.mockResolvedValue(true);
    createChaosRun.mockResolvedValue({
      kind: "PERSISTED_PENDING",
      chaosRunId: NEW_RUN_ID,
      scenarioId: "C01",
    });
    insertPendingRegressionRun.mockResolvedValue(regression());
    findRegressionRunById.mockResolvedValue(regression({ status: "RUNNING" }));
    startPendingRegressionRun.mockResolvedValue({ kind: "TRANSITIONED" });
    executeC01Replay.mockImplementation(() => {
      newRunStatus = "COMPLETED";
      newRunOutcome = "UNKNOWN";
      return Promise.resolve({
        kind: "NOT_STARTABLE",
        reasonCategory: "ALREADY_STARTED_OR_NOT_PENDING",
      });
    });
    evaluateChaosRun.mockResolvedValue(
      evaluation("FAIL", [{ invariantId: "INV-002", disposition: "FAIL" }]),
    );
    findFindingById.mockResolvedValue({
      id: FINDING_ID,
      invariantResultId: RESULT_ID,
    });
    findInvariantResultById.mockResolvedValue({
      id: RESULT_ID,
      invariant_id: "INV-002",
    });

    const result = await startRegression({ findingId: FINDING_ID });

    expect(evaluateChaosRun).toHaveBeenCalledWith(NEW_RUN_ID);
    expect(result).toMatchObject({
      kind: "COMPLETED",
      regressionStatus: "STILL_FAILING",
    });
  });

  it("50: C11-B NOT_STARTABLE plus a durable COMPLETED row still evaluates", async () => {
    resolveRegressionEligibility.mockResolvedValue(eligible("C11", "INV-003"));
    getChaosRunById.mockImplementation((id: string) =>
      Promise.resolve(
        id === OLD_RUN_ID
          ? chaosRun({
              id: OLD_RUN_ID,
              scenario_id: "C11",
              source_webhook_event_id: SOURCE_EVENT_ID,
            })
          : chaosRun({
              scenario_id: "C11",
              source_webhook_event_id: SOURCE_EVENT_ID,
              status: newRunStatus,
              outcome: newRunOutcome,
            }),
      ),
    );
    revalidateEligibility.mockResolvedValue(true);
    createChaosRun.mockResolvedValue({
      kind: "PERSISTED_PENDING",
      chaosRunId: NEW_RUN_ID,
      scenarioId: "C11",
    });
    insertPendingRegressionRun.mockResolvedValue(regression());
    findRegressionRunById.mockResolvedValue(regression({ status: "RUNNING" }));
    startPendingRegressionRun.mockResolvedValue({ kind: "TRANSITIONED" });
    executeC11RealWebhookReplay.mockImplementation(() => {
      newRunStatus = "COMPLETED";
      newRunOutcome = "UNKNOWN";
      return Promise.resolve({
        kind: "NOT_STARTABLE",
        reasonCategory: "ALREADY_STARTED_OR_NOT_PENDING",
      });
    });
    evaluateChaosRun.mockResolvedValue(
      evaluation("PASS", [{ invariantId: "INV-003", disposition: "PASS" }]),
    );
    findFindingById.mockResolvedValue({
      id: FINDING_ID,
      invariantResultId: RESULT_ID,
    });
    findInvariantResultById.mockResolvedValue({
      id: RESULT_ID,
      invariant_id: "INV-003",
    });

    const result = await startRegression({ findingId: FINDING_ID });

    expect(evaluateChaosRun).toHaveBeenCalledWith(NEW_RUN_ID);
    expect(result).toMatchObject({
      kind: "COMPLETED",
      regressionStatus: "RESOLVED",
    });
  });

  it("51: single-step NOT_STARTABLE with a durable PENDING row is IN_PROGRESS", async () => {
    arrangeC03();
    executeC03InvalidSignatureTest.mockResolvedValue({
      kind: "NOT_STARTABLE",
      reasonCategory: "RUN_NOT_ELIGIBLE",
    });

    const result = await startRegression({ findingId: FINDING_ID });

    expect(result).toMatchObject({ kind: "IN_PROGRESS" });
    // Never terminalized on the in-memory result alone.
    expect(finalizeRegressionError).not.toHaveBeenCalled();
    expect(evaluateChaosRun).not.toHaveBeenCalled();
    expect(writeLog).toEqual([]);
  });

  // ==========================================================================
  // PRE-START CONVERGENCE
  // ==========================================================================

  /**
   * A finished conclusive attempt whose Finding write never landed.
   *
   * Models the real shape faithfully: its own chaos run genuinely COMPLETED
   * (that is how it reached a verdict), the history holds only it at
   * pre-start convergence time, and the new attempt joins the history —
   * newest first — once it exists.
   */
  function arrangePriorConclusive(
    status: "RESOLVED" | "STILL_FAILING",
    priorId = "prior-attempt",
    priorRunId = "prior-run",
  ) {
    const priorEntry = {
      id: priorId,
      findingId: FINDING_ID,
      chaosRunId: priorRunId,
      status,
    };
    listRegressionRunsForFinding
      .mockResolvedValueOnce([priorEntry])
      .mockResolvedValue([
        {
          id: REGRESSION_ID,
          findingId: FINDING_ID,
          chaosRunId: NEW_RUN_ID,
          status: "PENDING",
        },
        priorEntry,
      ]);
    findRegressionRunById.mockImplementation((id: string) =>
      Promise.resolve(
        id === priorId
          ? regression({ id: priorId, chaosRunId: priorRunId, status })
          : regression({ status: "RUNNING" }),
      ),
    );
    getChaosRunById.mockImplementation((id: string) => {
      if (id === OLD_RUN_ID) {
        return Promise.resolve(
          chaosRun({ id: OLD_RUN_ID, status: "COMPLETED", outcome: "FAIL" }),
        );
      }
      if (id === NEW_RUN_ID) {
        return Promise.resolve(
          chaosRun({ status: newRunStatus, outcome: newRunOutcome }),
        );
      }
      // A historical attempt's own run: it finished, which is how it reached
      // a verdict in the first place.
      return Promise.resolve(
        chaosRun({ id, status: "COMPLETED", outcome: "UNKNOWN" }),
      );
    });
    return priorId;
  }

  it("52: a previous RESOLVED verdict is applied BEFORE the new run is created", async () => {
    arrangeC03();
    arrangePriorConclusive("RESOLVED");

    await startRegression({ findingId: FINDING_ID });

    expect(resolveFindingAfterRegression).toHaveBeenCalled();
    const convergeOrder =
      resolveFindingAfterRegression.mock.invocationCallOrder[0]!;
    const createOrder = createChaosRun.mock.invocationCallOrder[0]!;
    expect(convergeOrder).toBeLessThan(createOrder);
  });

  it("53: a previous STILL_FAILING verdict converges, creating nothing of its own", async () => {
    arrangeC03(
      evaluation("FAIL", [{ invariantId: "INV-005", disposition: "FAIL" }]),
    );
    arrangePriorConclusive("STILL_FAILING");

    await startRegression({ findingId: FINDING_ID });

    expect(markFindingStillFailingAfterRegression).toHaveBeenCalled();
    // Exactly one creation and one link, both belonging to the NEW attempt.
    expect(createChaosRun).toHaveBeenCalledTimes(1);
    expect(insertPendingRegressionRun).toHaveBeenCalledTimes(1);
  });

  it("54: a newer ERROR attempt never masks an older conclusive verdict", async () => {
    // History: A RESOLVED, then B ERROR. ERROR means NO_CHANGE, so A remains
    // the lifecycle authority and is the attempt that must converge.
    arrangeC03();
    const A = arrangePriorConclusive("RESOLVED", "attempt-a", "run-a");
    // A newer, inconclusive attempt sits on top of A in the history.
    listRegressionRunsForFinding.mockReset();
    listRegressionRunsForFinding.mockResolvedValue([
      {
        id: "attempt-b",
        findingId: FINDING_ID,
        chaosRunId: "run-b",
        status: "ERROR",
      },
      {
        id: A,
        findingId: FINDING_ID,
        chaosRunId: "run-a",
        status: "RESOLVED",
      },
    ]);

    await startRegression({ findingId: FINDING_ID });

    // A converged despite a NEWER row existing, because that row is ERROR.
    expect(resolveFindingAfterRegression).toHaveBeenCalled();
  });

  it("55: PASS then a newer ERROR still leaves the Finding RESOLVED", async () => {
    arrangeC03();
    newRunStatus = "COMPLETED";
    newRunOutcome = "UNKNOWN";
    findRegressionRunById.mockResolvedValue(
      regression({ status: "RESOLVED", completedAt: "T1" }),
    );
    listRegressionRunsForFinding.mockResolvedValue([
      {
        id: "newer-error",
        findingId: FINDING_ID,
        chaosRunId: "newer-run",
        status: "ERROR",
      },
      {
        id: REGRESSION_ID,
        findingId: FINDING_ID,
        chaosRunId: NEW_RUN_ID,
        status: "RESOLVED",
      },
    ]);

    const result = await completeRegression(REGRESSION_ID);

    // An inconclusive newer attempt must not supersede a conclusive one.
    expect(result).toMatchObject({ kind: "COMPLETED" });
    expect(resolveFindingAfterRegression).toHaveBeenCalled();
  });

  it("56: FAIL then a newer ERROR still leaves the Finding STILL_FAILING", async () => {
    arrangeC03(
      evaluation("FAIL", [{ invariantId: "INV-005", disposition: "FAIL" }]),
    );
    newRunStatus = "COMPLETED";
    newRunOutcome = "UNKNOWN";
    findRegressionRunById.mockResolvedValue(
      regression({ status: "STILL_FAILING", completedAt: "T1" }),
    );
    listRegressionRunsForFinding.mockResolvedValue([
      {
        id: "newer-error",
        findingId: FINDING_ID,
        chaosRunId: "newer-run",
        status: "ERROR",
      },
      {
        id: REGRESSION_ID,
        findingId: FINDING_ID,
        chaosRunId: NEW_RUN_ID,
        status: "STILL_FAILING",
      },
    ]);

    const result = await completeRegression(REGRESSION_ID);

    expect(result).toMatchObject({ kind: "COMPLETED" });
    expect(markFindingStillFailingAfterRegression).toHaveBeenCalled();
  });

  it("57: an already-applied prior verdict converges idempotently", async () => {
    arrangeC03();
    arrangePriorConclusive("RESOLVED");
    resolveFindingAfterRegression.mockImplementation(() => {
      writeLog.push("finding:ALREADY");
      return Promise.resolve({ kind: "ALREADY" });
    });

    const result = await startRegression({ findingId: FINDING_ID });

    expect(result.kind).toBe("COMPLETED");
    expect(createChaosRun).toHaveBeenCalledTimes(1);
  });

  it("58: a failed convergence refuses to start a new attempt", async () => {
    arrangeC03();
    arrangePriorConclusive("RESOLVED");
    resolveFindingAfterRegression.mockRejectedValue(
      new FindingLifecycleError(
        "FINDING_LIFECYCLE_STATE_CONFLICT",
        "safe wording",
      ),
    );

    const result = await startRegression({ findingId: FINDING_ID });

    expect(result).toMatchObject({
      kind: "NOT_STARTED",
      reason: "PRIOR_CONVERGENCE_FAILED",
    });
    // Nothing was created on top of known unconverged state.
    expect(createChaosRun).not.toHaveBeenCalled();
    expect(insertPendingRegressionRun).not.toHaveBeenCalled();
  });

  it("42: an unknown regression id is a typed service error", async () => {
    findRegressionRunById.mockResolvedValue(null);
    await expect(advanceRegression(REGRESSION_ID)).rejects.toMatchObject({
      code: "REGRESSION_SERVICE_RUN_NOT_FOUND",
    });
  });
});
