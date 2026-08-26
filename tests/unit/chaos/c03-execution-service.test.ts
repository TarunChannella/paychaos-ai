import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 3D-A (correction round 1) — `lib/chaos/c03-execution-service.ts`
// exercised here against FULLY MOCKED dependencies: the run repository, the
// webhook-secret config loader, the underlying `verifyWebhookSignature`
// primitive, and the logger. This proves only the SERVICE's own
// orchestration (eligibility, PRE-SEC-007 + its durable-proof requirement,
// atomic claim, exactly-two-runtime-cases, safe fault_state,
// terminalization) — the real webhook route's HTTP-boundary behavior is
// separately proven by
// tests/unit/api/webhooks-razorpay-route-signature-rejection.test.ts and
// tests/unit/api/webhooks-razorpay-route-modified-body.test.ts, and the
// real end-to-end mechanism by
// tests/integration/supabase/055-chaos-c03-invalid-signature.integration.test.ts.

vi.mock("server-only", () => ({}));

class FakeEnvValidationError extends Error {
  readonly variable: string;
  constructor(variable: string) {
    super(`${variable} is invalid`);
    this.name = "EnvValidationError";
    this.variable = variable;
  }
}

const getChaosRunByIdMock = vi.fn();
const blockPendingC03RunForPreSec007Mock = vi.fn();
const startPendingC03RunAtomicallyMock = vi.fn();
const completeRunningChaosRunUnknownMock = vi.fn();
const failRunningChaosRunExecutionMock = vi.fn();

vi.mock("@/lib/chaos/run-repository", () => ({
  getChaosRunById: getChaosRunByIdMock,
  blockPendingC03RunForPreSec007: blockPendingC03RunForPreSec007Mock,
  startPendingC03RunAtomically: startPendingC03RunAtomicallyMock,
  completeRunningChaosRunUnknown: completeRunningChaosRunUnknownMock,
  failRunningChaosRunExecution: failRunningChaosRunExecutionMock,
}));

const getRazorpayWebhookSecretMock = vi.fn();
vi.mock("@/lib/config/razorpay-webhook-env", () => ({
  getRazorpayWebhookSecret: getRazorpayWebhookSecretMock,
}));

const verifyWebhookSignatureMock = vi.fn();
vi.mock("@/lib/razorpay/webhook-verification", () => ({
  verifyWebhookSignature: verifyWebhookSignatureMock,
}));

const logEventMock = vi.fn();
vi.mock("@/lib/security/logger", () => ({
  logEvent: logEventMock,
}));

const RUN_ID = "11111111-1111-1111-1111-111111111111";

function makeEligibleRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    scenario_id: "C03",
    order_id: null,
    payment_attempt_id: null,
    payment_id: null,
    source_webhook_event_id: null,
    status: "PENDING",
    outcome: null,
    fault_type: "INVALID_SIGNATURE_TEST",
    failed_precheck_id: null,
    execution_block_code: null,
    fault_config: {},
    fault_state: {},
    data_classification: "SYNTHETIC_DEMO",
    error_message_redacted: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeValidBlockedRun(overrides: Record<string, unknown> = {}) {
  return makeEligibleRun({
    status: "COMPLETED",
    outcome: "BLOCKED",
    failed_precheck_id: null,
    execution_block_code: "PRE-SEC-007",
    started_at: null,
    completed_at: "2026-01-01T00:05:00.000Z",
    ...overrides,
  });
}

beforeEach(() => {
  getChaosRunByIdMock.mockReset();
  blockPendingC03RunForPreSec007Mock.mockReset();
  startPendingC03RunAtomicallyMock.mockReset();
  completeRunningChaosRunUnknownMock.mockReset();
  failRunningChaosRunExecutionMock.mockReset();
  getRazorpayWebhookSecretMock.mockReset();
  verifyWebhookSignatureMock.mockReset();
  logEventMock.mockReset();
});

async function importService() {
  return import("@/lib/chaos/c03-execution-service");
}

function failPreSec007() {
  getRazorpayWebhookSecretMock.mockImplementation(() => {
    throw new FakeEnvValidationError("RAZORPAY_WEBHOOK_SECRET");
  });
}

describe("executeC03InvalidSignatureTest", () => {
  it("1: eligible PENDING C03 + valid execution config completes with two checks", async () => {
    getChaosRunByIdMock.mockResolvedValue(makeEligibleRun());
    getRazorpayWebhookSecretMock.mockReturnValue("fake-secret-not-real");
    startPendingC03RunAtomicallyMock.mockResolvedValue(
      makeEligibleRun({ status: "RUNNING" }),
    );
    verifyWebhookSignatureMock.mockReturnValue(false);
    completeRunningChaosRunUnknownMock.mockResolvedValue(
      makeEligibleRun({ status: "COMPLETED", outcome: "UNKNOWN" }),
    );

    const { executeC03InvalidSignatureTest } = await importService();
    const result = await executeC03InvalidSignatureTest(RUN_ID);

    expect(result.kind).toBe("COMPLETED");
    if (result.kind === "COMPLETED") {
      expect(result.checks).toHaveLength(2);
    }
  }, 20_000);

  it("2: PRE-SEC-007 failure + BLOCK persistence succeeds returns BLOCKED_PRE_SEC_007, claims no RUNNING, verifies nothing", async () => {
    getChaosRunByIdMock.mockResolvedValue(makeEligibleRun());
    failPreSec007();
    blockPendingC03RunForPreSec007Mock.mockResolvedValue(makeValidBlockedRun());

    const { executeC03InvalidSignatureTest } = await importService();
    const result = await executeC03InvalidSignatureTest(RUN_ID);

    expect(result).toEqual({ kind: "BLOCKED_PRE_SEC_007", chaosRunId: RUN_ID });
    expect(blockPendingC03RunForPreSec007Mock).toHaveBeenCalledTimes(1);
    expect(blockPendingC03RunForPreSec007Mock).toHaveBeenCalledWith(
      RUN_ID,
      expect.any(String),
    );
    expect(startPendingC03RunAtomicallyMock).not.toHaveBeenCalled();
    expect(verifyWebhookSignatureMock).not.toHaveBeenCalled();
  });

  it("3: BLOCK repository throws returns BLOCK_PERSISTENCE_FAILED, never BLOCKED_PRE_SEC_007", async () => {
    getChaosRunByIdMock.mockResolvedValue(makeEligibleRun());
    failPreSec007();
    blockPendingC03RunForPreSec007Mock.mockRejectedValue(
      new Error("db unavailable"),
    );

    const { executeC03InvalidSignatureTest } = await importService();
    const result = await executeC03InvalidSignatureTest(RUN_ID);

    expect(result).toEqual({
      kind: "BLOCK_PERSISTENCE_FAILED",
      chaosRunId: RUN_ID,
    });
    expect(startPendingC03RunAtomicallyMock).not.toHaveBeenCalled();
    expect(verifyWebhookSignatureMock).not.toHaveBeenCalled();
    expect(failRunningChaosRunExecutionMock).not.toHaveBeenCalled();
  });

  it("4: BLOCK repository returns null returns BLOCK_PERSISTENCE_FAILED, never BLOCKED_PRE_SEC_007", async () => {
    getChaosRunByIdMock.mockResolvedValue(makeEligibleRun());
    failPreSec007();
    blockPendingC03RunForPreSec007Mock.mockResolvedValue(null);

    const { executeC03InvalidSignatureTest } = await importService();
    const result = await executeC03InvalidSignatureTest(RUN_ID);

    expect(result).toEqual({
      kind: "BLOCK_PERSISTENCE_FAILED",
      chaosRunId: RUN_ID,
    });
    expect(startPendingC03RunAtomicallyMock).not.toHaveBeenCalled();
    expect(verifyWebhookSignatureMock).not.toHaveBeenCalled();
  });

  it("5: BLOCK repository returns an unexpected/non-BLOCKED shape returns BLOCK_PERSISTENCE_FAILED, never BLOCKED_PRE_SEC_007", async () => {
    getChaosRunByIdMock.mockResolvedValue(makeEligibleRun());
    failPreSec007();
    // Still PENDING — e.g. a stale/incorrect row somehow returned instead of
    // the genuine transitioned shape (wrong status/outcome/execution_block_code).
    blockPendingC03RunForPreSec007Mock.mockResolvedValue(makeEligibleRun());

    const { executeC03InvalidSignatureTest } = await importService();
    const result = await executeC03InvalidSignatureTest(RUN_ID);

    expect(result).toEqual({
      kind: "BLOCK_PERSISTENCE_FAILED",
      chaosRunId: RUN_ID,
    });
    expect(startPendingC03RunAtomicallyMock).not.toHaveBeenCalled();
    expect(verifyWebhookSignatureMock).not.toHaveBeenCalled();
  });

  it("5b: a row with a mismatched id is also rejected as an unexpected shape", async () => {
    getChaosRunByIdMock.mockResolvedValue(makeEligibleRun());
    failPreSec007();
    blockPendingC03RunForPreSec007Mock.mockResolvedValue(
      makeValidBlockedRun({ id: "99999999-9999-9999-9999-999999999999" }),
    );

    const { executeC03InvalidSignatureTest } = await importService();
    const result = await executeC03InvalidSignatureTest(RUN_ID);

    expect(result).toEqual({
      kind: "BLOCK_PERSISTENCE_FAILED",
      chaosRunId: RUN_ID,
    });
  });

  it("6: every PRE-SEC-007 failure path invokes zero mechanism checks (verifyWebhookSignature never called)", async () => {
    getChaosRunByIdMock.mockResolvedValue(makeEligibleRun());
    failPreSec007();

    for (const outcome of [
      () =>
        blockPendingC03RunForPreSec007Mock.mockResolvedValue(
          makeValidBlockedRun(),
        ),
      () =>
        blockPendingC03RunForPreSec007Mock.mockRejectedValue(
          new Error("db down"),
        ),
      () => blockPendingC03RunForPreSec007Mock.mockResolvedValue(null),
      () =>
        blockPendingC03RunForPreSec007Mock.mockResolvedValue(makeEligibleRun()),
    ]) {
      verifyWebhookSignatureMock.mockClear();
      startPendingC03RunAtomicallyMock.mockClear();
      outcome();
      const { executeC03InvalidSignatureTest } = await importService();
      await executeC03InvalidSignatureTest(RUN_ID);
      expect(verifyWebhookSignatureMock).not.toHaveBeenCalled();
      expect(startPendingC03RunAtomicallyMock).not.toHaveBeenCalled();
    }
  });

  it("7: wrong scenario is rejected before any secret check or claim", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeEligibleRun({ scenario_id: "C01" }),
    );

    const { executeC03InvalidSignatureTest } = await importService();
    const result = await executeC03InvalidSignatureTest(RUN_ID);

    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "RUN_NOT_ELIGIBLE",
    });
    expect(getRazorpayWebhookSecretMock).not.toHaveBeenCalled();
    expect(startPendingC03RunAtomicallyMock).not.toHaveBeenCalled();
  });

  it("8: wrong fault_type is rejected", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeEligibleRun({ fault_type: "REPLAY_EVENT" }),
    );

    const { executeC03InvalidSignatureTest } = await importService();
    const result = await executeC03InvalidSignatureTest(RUN_ID);

    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "RUN_NOT_ELIGIBLE",
    });
  });

  it("9: wrong data_classification is rejected", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeEligibleRun({ data_classification: "RECORDED_TEST_EVIDENCE" }),
    );

    const { executeC03InvalidSignatureTest } = await importService();
    const result = await executeC03InvalidSignatureTest(RUN_ID);

    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "RUN_NOT_ELIGIBLE",
    });
  });

  it("10: wrong lifecycle (not PENDING) is rejected", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeEligibleRun({ status: "RUNNING" }),
    );

    const { executeC03InvalidSignatureTest } = await importService();
    const result = await executeC03InvalidSignatureTest(RUN_ID);

    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "RUN_NOT_ELIGIBLE",
    });
  });

  it("11: losing the atomic PENDING->RUNNING claim race prevents any execution", async () => {
    getChaosRunByIdMock.mockResolvedValue(makeEligibleRun());
    getRazorpayWebhookSecretMock.mockReturnValue("fake-secret-not-real");
    startPendingC03RunAtomicallyMock.mockResolvedValue(null);

    const { executeC03InvalidSignatureTest } = await importService();
    const result = await executeC03InvalidSignatureTest(RUN_ID);

    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "ALREADY_STARTED_OR_NOT_PENDING",
    });
    expect(verifyWebhookSignatureMock).not.toHaveBeenCalled();
  });

  it("12: WRONG_SIGNATURE invokes verifyWebhookSignature exactly once with the fixed malformed value", async () => {
    getChaosRunByIdMock.mockResolvedValue(makeEligibleRun());
    getRazorpayWebhookSecretMock.mockReturnValue("fake-secret-not-real");
    startPendingC03RunAtomicallyMock.mockResolvedValue(
      makeEligibleRun({ status: "RUNNING" }),
    );
    verifyWebhookSignatureMock.mockReturnValue(false);
    completeRunningChaosRunUnknownMock.mockResolvedValue(makeEligibleRun());

    const { executeC03InvalidSignatureTest } = await importService();
    await executeC03InvalidSignatureTest(RUN_ID);

    const firstCallInput = verifyWebhookSignatureMock.mock.calls[0]?.[0];
    expect(firstCallInput.signature).toBe(
      "paychaos-synthetic-wrong-signature-value",
    );
    expect(Buffer.isBuffer(firstCallInput.rawBody)).toBe(true);
  });

  it("13: MISSING_SIGNATURE invokes verifyWebhookSignature exactly once with an empty signature", async () => {
    getChaosRunByIdMock.mockResolvedValue(makeEligibleRun());
    getRazorpayWebhookSecretMock.mockReturnValue("fake-secret-not-real");
    startPendingC03RunAtomicallyMock.mockResolvedValue(
      makeEligibleRun({ status: "RUNNING" }),
    );
    verifyWebhookSignatureMock.mockReturnValue(false);
    completeRunningChaosRunUnknownMock.mockResolvedValue(makeEligibleRun());

    const { executeC03InvalidSignatureTest } = await importService();
    await executeC03InvalidSignatureTest(RUN_ID);

    const secondCallInput = verifyWebhookSignatureMock.mock.calls[1]?.[0];
    expect(secondCallInput.signature).toBe("");
  });

  it("14: exactly two runtime cases total are ever invoked", async () => {
    getChaosRunByIdMock.mockResolvedValue(makeEligibleRun());
    getRazorpayWebhookSecretMock.mockReturnValue("fake-secret-not-real");
    startPendingC03RunAtomicallyMock.mockResolvedValue(
      makeEligibleRun({ status: "RUNNING" }),
    );
    verifyWebhookSignatureMock.mockReturnValue(false);
    completeRunningChaosRunUnknownMock.mockResolvedValue(makeEligibleRun());

    const { executeC03InvalidSignatureTest } = await importService();
    await executeC03InvalidSignatureTest(RUN_ID);

    expect(verifyWebhookSignatureMock).toHaveBeenCalledTimes(2);
  });

  it("15: no caller-controlled count — the exported function accepts only chaosRunId", async () => {
    const { executeC03InvalidSignatureTest } = await importService();
    expect(executeC03InvalidSignatureTest.length).toBe(1);
  });

  it("16: both REJECTED results are recorded safely in the persisted fault_state", async () => {
    getChaosRunByIdMock.mockResolvedValue(makeEligibleRun());
    getRazorpayWebhookSecretMock.mockReturnValue("fake-secret-not-real");
    startPendingC03RunAtomicallyMock.mockResolvedValue(
      makeEligibleRun({ status: "RUNNING" }),
    );
    verifyWebhookSignatureMock.mockReturnValue(false);
    completeRunningChaosRunUnknownMock.mockResolvedValue(makeEligibleRun());

    const { executeC03InvalidSignatureTest } = await importService();
    await executeC03InvalidSignatureTest(RUN_ID);

    const faultState = completeRunningChaosRunUnknownMock.mock.calls[0]?.[1];
    expect(faultState.checks).toEqual([
      { case: "WRONG_SIGNATURE", classification: "REJECTED" },
      { case: "MISSING_SIGNATURE", classification: "REJECTED" },
    ]);
  });

  it("17: an unexpected acceptance is recorded as UNEXPECTED_ACCEPTANCE and the run still completes COMPLETED/UNKNOWN — never converted to an invariant verdict here", async () => {
    getChaosRunByIdMock.mockResolvedValue(makeEligibleRun());
    getRazorpayWebhookSecretMock.mockReturnValue("fake-secret-not-real");
    startPendingC03RunAtomicallyMock.mockResolvedValue(
      makeEligibleRun({ status: "RUNNING" }),
    );
    verifyWebhookSignatureMock
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    completeRunningChaosRunUnknownMock.mockResolvedValue(makeEligibleRun());

    const { executeC03InvalidSignatureTest } = await importService();
    const result = await executeC03InvalidSignatureTest(RUN_ID);

    expect(result.kind).toBe("COMPLETED");
    const faultState = completeRunningChaosRunUnknownMock.mock.calls[0]?.[1];
    expect(faultState.checks[1]).toEqual({
      case: "MISSING_SIGNATURE",
      classification: "UNEXPECTED_ACCEPTANCE",
    });
  });

  it("18: a genuine technical exception from verification after RUNNING was claimed marks the run FAILED/ERROR", async () => {
    getChaosRunByIdMock.mockResolvedValue(makeEligibleRun());
    getRazorpayWebhookSecretMock.mockReturnValue("fake-secret-not-real");
    startPendingC03RunAtomicallyMock.mockResolvedValue(
      makeEligibleRun({ status: "RUNNING" }),
    );
    verifyWebhookSignatureMock.mockImplementation(() => {
      throw new Error("secret became invalid mid-flight");
    });
    failRunningChaosRunExecutionMock.mockResolvedValue(
      makeEligibleRun({ status: "FAILED", outcome: "ERROR" }),
    );

    const { executeC03InvalidSignatureTest } = await importService();
    const result = await executeC03InvalidSignatureTest(RUN_ID);

    expect(result).toEqual({
      kind: "FAILED",
      chaosRunId: RUN_ID,
      reasonCategory: "EXECUTION_FAILED",
    });
    expect(failRunningChaosRunExecutionMock).toHaveBeenCalledWith(
      RUN_ID,
      expect.any(String),
    );
    expect(completeRunningChaosRunUnknownMock).not.toHaveBeenCalled();
  });

  it("19: the persisted fault_state never contains a secret, signature value, or raw payload", async () => {
    getChaosRunByIdMock.mockResolvedValue(makeEligibleRun());
    getRazorpayWebhookSecretMock.mockReturnValue(
      "super-secret-value-must-never-appear",
    );
    startPendingC03RunAtomicallyMock.mockResolvedValue(
      makeEligibleRun({ status: "RUNNING" }),
    );
    verifyWebhookSignatureMock.mockReturnValue(false);
    completeRunningChaosRunUnknownMock.mockResolvedValue(makeEligibleRun());

    const { executeC03InvalidSignatureTest } = await importService();
    await executeC03InvalidSignatureTest(RUN_ID);

    const faultState = completeRunningChaosRunUnknownMock.mock.calls[0]?.[1];
    const serialized = JSON.stringify(faultState);
    expect(serialized).not.toContain("super-secret-value-must-never-appear");
    expect(serialized).not.toContain("paychaos_synthetic_c03_");
    expect(Object.keys(faultState)).toEqual(["checks"]);
    for (const check of faultState.checks) {
      expect(Object.keys(check).sort()).toEqual(
        ["case", "classification"].sort(),
      );
    }
  });
});
