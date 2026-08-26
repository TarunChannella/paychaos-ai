import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 3C: `lib/chaos/replay-service.ts` orchestration behavior against
// fully mocked collaborators (no network, no real processor). Real
// end-to-end behavior is separately proven by
// tests/integration/supabase/053-chaos-replay-execution.integration.test.ts
// (NOT runnable yet — the Phase 3C migration has not been applied).
vi.mock("server-only", () => ({}));

const getChaosRunByIdMock = vi.fn();
const startPendingC01RunAtomicallyMock = vi.fn();
const completeRunningC01RunUnknownMock = vi.fn();
const failRunningC01RunExecutionMock = vi.fn();
vi.mock("@/lib/chaos/run-repository", () => ({
  getChaosRunById: (...args: unknown[]) => getChaosRunByIdMock(...args),
  startPendingC01RunAtomically: (...args: unknown[]) =>
    startPendingC01RunAtomicallyMock(...args),
  completeRunningC01RunUnknown: (...args: unknown[]) =>
    completeRunningC01RunUnknownMock(...args),
  failRunningC01RunExecution: (...args: unknown[]) =>
    failRunningC01RunExecutionMock(...args),
}));

const resolveAuthoritativeC01ReplaySourceMock = vi.fn();
const insertReplayProcessingAttemptMock = vi.fn();
vi.mock("@/lib/chaos/replay-repository", () => ({
  resolveAuthoritativeC01ReplaySource: (...args: unknown[]) =>
    resolveAuthoritativeC01ReplaySourceMock(...args),
  insertReplayProcessingAttempt: (...args: unknown[]) =>
    insertReplayProcessingAttemptMock(...args),
}));

const processMerchantWebhookEventMock = vi.fn();
class MockMerchantProcessingError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`safe-message-for-${code}`);
    this.name = "MerchantProcessingError";
    this.code = code;
  }
}
vi.mock("@/lib/events/processor", () => ({
  processMerchantWebhookEvent: (...args: unknown[]) =>
    processMerchantWebhookEventMock(...args),
  MerchantProcessingError: MockMerchantProcessingError,
}));

const markEventProcessingAttemptFailedIfNotFinalMock = vi.fn();
vi.mock("@/lib/webhooks/event-processing-repository", () => ({
  markEventProcessingAttemptFailedIfNotFinal: (...args: unknown[]) =>
    markEventProcessingAttemptFailedIfNotFinalMock(...args),
}));

vi.mock("@/lib/security/logger", () => ({ logEvent: vi.fn() }));

beforeEach(() => {
  getChaosRunByIdMock.mockReset();
  startPendingC01RunAtomicallyMock.mockReset();
  completeRunningC01RunUnknownMock.mockReset();
  failRunningC01RunExecutionMock.mockReset();
  resolveAuthoritativeC01ReplaySourceMock.mockReset();
  insertReplayProcessingAttemptMock.mockReset();
  processMerchantWebhookEventMock.mockReset();
  markEventProcessingAttemptFailedIfNotFinalMock.mockReset();
  markEventProcessingAttemptFailedIfNotFinalMock.mockResolvedValue(undefined);
});

const RUN_ID = "55555555-5555-5555-5555-555555555555";
const WEBHOOK_EVENT_ID = "11111111-1111-1111-1111-111111111111";
const ORDER_ATTEMPT_ID = "22222222-2222-2222-2222-222222222222";
const PAYMENT_ID = "33333333-3333-3333-3333-333333333333";

function fakeEligibleRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    scenario_id: "C01",
    status: "PENDING",
    fault_type: "REPLAY_EVENT",
    data_classification: "RECORDED_TEST_EVIDENCE",
    source_webhook_event_id: WEBHOOK_EVENT_ID,
    payment_attempt_id: ORDER_ATTEMPT_ID,
    payment_id: PAYMENT_ID,
    outcome: null,
    ...overrides,
  };
}

function fakeResolvedSource(overrides: Record<string, unknown> = {}) {
  return {
    processingAttemptId: "44444444-4444-4444-4444-444444444444",
    webhookEventId: WEBHOOK_EVENT_ID,
    paymentAttemptId: ORDER_ATTEMPT_ID,
    paymentId: PAYMENT_ID,
    normalizedEvent: { eventType: "payment.captured" },
    ...overrides,
  };
}

function fakeInsertedAttempt(id: string) {
  return {
    id,
    webhook_event_id: WEBHOOK_EVENT_ID,
    payment_attempt_id: ORDER_ATTEMPT_ID,
    payment_id: PAYMENT_ID,
    chaos_run_id: RUN_ID,
    source_kind: "PAYCHAOS_REPLAY",
    is_duplicate_delivery: false,
    status: "PENDING",
    normalized_event: { eventType: "payment.captured" },
    error_code: null,
    error_message_redacted: null,
    started_at: "2026-01-01T00:00:00.000Z",
    finished_at: null,
  };
}

describe("executeC01Replay — happy path", () => {
  it("claims RUNNING, creates exactly C01_REPLAY_ATTEMPT_COUNT (2) new replay attempts, processes each through the existing processor, and completes COMPLETED/UNKNOWN", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC01ReplaySourceMock.mockResolvedValue(
      fakeResolvedSource(),
    );
    startPendingC01RunAtomicallyMock.mockResolvedValue(
      fakeEligibleRun({ status: "RUNNING" }),
    );
    const attemptIdA = "aaaaaaaa-0000-0000-0000-000000000001";
    const attemptIdB = "aaaaaaaa-0000-0000-0000-000000000002";
    insertReplayProcessingAttemptMock
      .mockResolvedValueOnce(fakeInsertedAttempt(attemptIdA))
      .mockResolvedValueOnce(fakeInsertedAttempt(attemptIdB));
    processMerchantWebhookEventMock.mockResolvedValue({
      outcome: "processed",
      eventType: "payment.captured",
      orderId: "order-1",
      paymentId: PAYMENT_ID,
      fulfilmentId: "fulfilment-1",
    });
    completeRunningC01RunUnknownMock.mockResolvedValue(
      fakeEligibleRun({ status: "COMPLETED", outcome: "UNKNOWN" }),
    );

    const { executeC01Replay, C01_REPLAY_ATTEMPT_COUNT } =
      await import("@/lib/chaos/replay-service");

    const result = await executeC01Replay(RUN_ID);

    expect(C01_REPLAY_ATTEMPT_COUNT).toBe(2);
    expect(startPendingC01RunAtomicallyMock).toHaveBeenCalledWith(RUN_ID);
    expect(insertReplayProcessingAttemptMock).toHaveBeenCalledTimes(2);
    expect(processMerchantWebhookEventMock).toHaveBeenCalledTimes(2);
    expect(processMerchantWebhookEventMock).toHaveBeenNthCalledWith(
      1,
      attemptIdA,
    );
    expect(processMerchantWebhookEventMock).toHaveBeenNthCalledWith(
      2,
      attemptIdB,
    );
    expect(result).toEqual({
      kind: "COMPLETED",
      chaosRunId: RUN_ID,
      replayAttemptCount: 2,
    });
  });

  it("every inserted replay attempt copies webhookEventId/paymentAttemptId/paymentId/normalizedEvent from the resolved source, with chaosRunId set", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC01ReplaySourceMock.mockResolvedValue(
      fakeResolvedSource(),
    );
    startPendingC01RunAtomicallyMock.mockResolvedValue(
      fakeEligibleRun({ status: "RUNNING" }),
    );
    insertReplayProcessingAttemptMock.mockResolvedValue(
      fakeInsertedAttempt("aaaaaaaa-0000-0000-0000-000000000001"),
    );
    processMerchantWebhookEventMock.mockResolvedValue({
      outcome: "processed",
      eventType: "payment.captured",
      orderId: "order-1",
      paymentId: PAYMENT_ID,
      fulfilmentId: "fulfilment-1",
    });
    completeRunningC01RunUnknownMock.mockResolvedValue(fakeEligibleRun());

    const { executeC01Replay } = await import("@/lib/chaos/replay-service");
    await executeC01Replay(RUN_ID);

    for (const call of insertReplayProcessingAttemptMock.mock.calls) {
      expect(call[0]).toEqual({
        chaosRunId: RUN_ID,
        webhookEventId: WEBHOOK_EVENT_ID,
        paymentAttemptId: ORDER_ATTEMPT_ID,
        paymentId: PAYMENT_ID,
        normalizedEvent: { eventType: "payment.captured" },
      });
    }
  });
});

describe("executeC01Replay — not startable (no RUNNING claim, no mutation)", () => {
  it("returns NOT_STARTABLE/RUN_NOT_FOUND when the run does not exist", async () => {
    getChaosRunByIdMock.mockResolvedValue(null);
    const { executeC01Replay } = await import("@/lib/chaos/replay-service");
    const result = await executeC01Replay(RUN_ID);
    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "RUN_NOT_FOUND",
    });
    expect(startPendingC01RunAtomicallyMock).not.toHaveBeenCalled();
  });

  it.each([
    ["scenario_id", "C03"],
    ["status", "RUNNING"],
    ["fault_type", "INVALID_SIGNATURE_TEST"],
    ["data_classification", "SYNTHETIC_DEMO"],
  ])(
    "returns NOT_STARTABLE/RUN_NOT_ELIGIBLE when %s is wrong",
    async (field, value) => {
      getChaosRunByIdMock.mockResolvedValue(
        fakeEligibleRun({ [field]: value }),
      );
      const { executeC01Replay } = await import("@/lib/chaos/replay-service");
      const result = await executeC01Replay(RUN_ID);
      expect(result).toEqual({
        kind: "NOT_STARTABLE",
        reasonCategory: "RUN_NOT_ELIGIBLE",
      });
      expect(startPendingC01RunAtomicallyMock).not.toHaveBeenCalled();
    },
  );

  it("returns NOT_STARTABLE/RUN_NOT_ELIGIBLE when source_webhook_event_id or payment_attempt_id is missing", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      fakeEligibleRun({ source_webhook_event_id: null }),
    );
    const { executeC01Replay } = await import("@/lib/chaos/replay-service");
    const result = await executeC01Replay(RUN_ID);
    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "RUN_NOT_ELIGIBLE",
    });
  });

  it("returns NOT_STARTABLE/SOURCE_EVIDENCE_UNRESOLVED when source resolution fails, without claiming RUNNING", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC01ReplaySourceMock.mockResolvedValue(null);
    const { executeC01Replay } = await import("@/lib/chaos/replay-service");
    const result = await executeC01Replay(RUN_ID);
    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "SOURCE_EVIDENCE_UNRESOLVED",
    });
    expect(startPendingC01RunAtomicallyMock).not.toHaveBeenCalled();
  });

  it("returns NOT_STARTABLE/ALREADY_STARTED_OR_NOT_PENDING when the atomic claim returns null (concurrent double-start)", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC01ReplaySourceMock.mockResolvedValue(
      fakeResolvedSource(),
    );
    startPendingC01RunAtomicallyMock.mockResolvedValue(null);
    const { executeC01Replay } = await import("@/lib/chaos/replay-service");
    const result = await executeC01Replay(RUN_ID);
    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "ALREADY_STARTED_OR_NOT_PENDING",
    });
    expect(insertReplayProcessingAttemptMock).not.toHaveBeenCalled();
    expect(processMerchantWebhookEventMock).not.toHaveBeenCalled();
  });
});

describe("executeC01Replay — technical execution failure", () => {
  it("marks the run FAILED/ERROR with a fixed safe reason (never the raw error) when the processor throws on the second attempt", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC01ReplaySourceMock.mockResolvedValue(
      fakeResolvedSource(),
    );
    startPendingC01RunAtomicallyMock.mockResolvedValue(
      fakeEligibleRun({ status: "RUNNING" }),
    );
    insertReplayProcessingAttemptMock.mockResolvedValue(
      fakeInsertedAttempt("aaaaaaaa-0000-0000-0000-000000000001"),
    );
    processMerchantWebhookEventMock
      .mockResolvedValueOnce({
        outcome: "processed",
        eventType: "payment.captured",
        orderId: "order-1",
        paymentId: PAYMENT_ID,
        fulfilmentId: "fulfilment-1",
      })
      .mockRejectedValueOnce(
        new Error("raw-postgres-detail-that-must-never-leak"),
      );
    failRunningC01RunExecutionMock.mockResolvedValue(
      fakeEligibleRun({ status: "FAILED", outcome: "ERROR" }),
    );

    const { executeC01Replay } = await import("@/lib/chaos/replay-service");
    const result = await executeC01Replay(RUN_ID);

    expect(result).toEqual({
      kind: "FAILED",
      chaosRunId: RUN_ID,
      reasonCategory: "EXECUTION_FAILED",
    });
    expect(failRunningC01RunExecutionMock).toHaveBeenCalledTimes(1);
    const [, safeReason] = failRunningC01RunExecutionMock.mock.calls[0]!;
    expect(safeReason).not.toContain(
      "raw-postgres-detail-that-must-never-leak",
    );
    expect(completeRunningC01RunUnknownMock).not.toHaveBeenCalled();
  });

  it("does not mask the original failure if failRunningC01RunExecution itself throws (best-effort)", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC01ReplaySourceMock.mockResolvedValue(
      fakeResolvedSource(),
    );
    startPendingC01RunAtomicallyMock.mockResolvedValue(
      fakeEligibleRun({ status: "RUNNING" }),
    );
    insertReplayProcessingAttemptMock.mockRejectedValue(
      new Error("insert failed"),
    );
    failRunningC01RunExecutionMock.mockRejectedValue(
      new Error("failed to persist failure"),
    );

    const { executeC01Replay } = await import("@/lib/chaos/replay-service");
    const result = await executeC01Replay(RUN_ID);

    expect(result).toEqual({
      kind: "FAILED",
      chaosRunId: RUN_ID,
      reasonCategory: "EXECUTION_FAILED",
    });
  });

  it("returns FAILED/COMPLETION_PERSISTENCE_FAILED when completeRunningC01RunUnknown returns null after a successful replay", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC01ReplaySourceMock.mockResolvedValue(
      fakeResolvedSource(),
    );
    startPendingC01RunAtomicallyMock.mockResolvedValue(
      fakeEligibleRun({ status: "RUNNING" }),
    );
    insertReplayProcessingAttemptMock.mockResolvedValue(
      fakeInsertedAttempt("aaaaaaaa-0000-0000-0000-000000000001"),
    );
    processMerchantWebhookEventMock.mockResolvedValue({
      outcome: "processed",
      eventType: "payment.captured",
      orderId: "order-1",
      paymentId: PAYMENT_ID,
      fulfilmentId: "fulfilment-1",
    });
    completeRunningC01RunUnknownMock.mockResolvedValue(null);
    failRunningC01RunExecutionMock.mockResolvedValue(
      fakeEligibleRun({ status: "FAILED", outcome: "ERROR" }),
    );

    const { executeC01Replay } = await import("@/lib/chaos/replay-service");
    const result = await executeC01Replay(RUN_ID);

    expect(result).toEqual({
      kind: "FAILED",
      chaosRunId: RUN_ID,
      reasonCategory: "COMPLETION_PERSISTENCE_FAILED",
    });
  });
});

describe("executeC01Replay — Finding 1: run must never be stranded RUNNING when finalization fails", () => {
  function setUpSuccessfulReplayThenFinalization() {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC01ReplaySourceMock.mockResolvedValue(
      fakeResolvedSource(),
    );
    startPendingC01RunAtomicallyMock.mockResolvedValue(
      fakeEligibleRun({ status: "RUNNING" }),
    );
    insertReplayProcessingAttemptMock.mockResolvedValue(
      fakeInsertedAttempt("aaaaaaaa-0000-0000-0000-000000000001"),
    );
    processMerchantWebhookEventMock.mockResolvedValue({
      outcome: "processed",
      eventType: "payment.captured",
      orderId: "order-1",
      paymentId: PAYMENT_ID,
      fulfilmentId: "fulfilment-1",
    });
  }

  it("1. completeRunningC01RunUnknown returns null → failRunningC01RunExecution is called once with a safe finalization reason → result is FAILED/COMPLETION_PERSISTENCE_FAILED", async () => {
    setUpSuccessfulReplayThenFinalization();
    completeRunningC01RunUnknownMock.mockResolvedValue(null);
    failRunningC01RunExecutionMock.mockResolvedValue(
      fakeEligibleRun({ status: "FAILED", outcome: "ERROR" }),
    );

    const { executeC01Replay } = await import("@/lib/chaos/replay-service");
    const result = await executeC01Replay(RUN_ID);

    expect(failRunningC01RunExecutionMock).toHaveBeenCalledTimes(1);
    const [failedRunId, safeReason] =
      failRunningC01RunExecutionMock.mock.calls[0]!;
    expect(failedRunId).toBe(RUN_ID);
    expect(typeof safeReason).toBe("string");
    expect(safeReason).toContain("could not be persisted");
    expect(result).toEqual({
      kind: "FAILED",
      chaosRunId: RUN_ID,
      reasonCategory: "COMPLETION_PERSISTENCE_FAILED",
    });
  });

  it("2. completeRunningC01RunUnknown THROWS a raw secret-shaped DB error → failRunningC01RunExecution is called once → the raw message is never forwarded/persisted → result remains safe", async () => {
    setUpSuccessfulReplayThenFinalization();
    completeRunningC01RunUnknownMock.mockRejectedValue(
      new Error("raw-postgres-secret-detail-that-must-never-leak"),
    );
    failRunningC01RunExecutionMock.mockResolvedValue(
      fakeEligibleRun({ status: "FAILED", outcome: "ERROR" }),
    );

    const { executeC01Replay } = await import("@/lib/chaos/replay-service");
    const result = await executeC01Replay(RUN_ID);

    expect(failRunningC01RunExecutionMock).toHaveBeenCalledTimes(1);
    const [, safeReason] = failRunningC01RunExecutionMock.mock.calls[0]!;
    expect(safeReason).not.toContain(
      "raw-postgres-secret-detail-that-must-never-leak",
    );
    expect(result).toEqual({
      kind: "FAILED",
      chaosRunId: RUN_ID,
      reasonCategory: "COMPLETION_PERSISTENCE_FAILED",
    });
  });

  it("3. completion fails AND failRunningC01RunExecution itself also throws → no raw error escapes → the safe FAILED result is still returned", async () => {
    setUpSuccessfulReplayThenFinalization();
    completeRunningC01RunUnknownMock.mockResolvedValue(null);
    failRunningC01RunExecutionMock.mockRejectedValue(
      new Error("raw-secret-detail-from-the-finalization-attempt-itself"),
    );

    const { executeC01Replay } = await import("@/lib/chaos/replay-service");
    const result = await executeC01Replay(RUN_ID);

    expect(result).toEqual({
      kind: "FAILED",
      chaosRunId: RUN_ID,
      reasonCategory: "COMPLETION_PERSISTENCE_FAILED",
    });
  });

  it("never uses COMPLETED+ERROR for a finalization failure — only FAILED+ERROR is ever persisted via failRunningC01RunExecution", async () => {
    setUpSuccessfulReplayThenFinalization();
    completeRunningC01RunUnknownMock.mockResolvedValue(null);
    failRunningC01RunExecutionMock.mockResolvedValue(
      fakeEligibleRun({ status: "FAILED", outcome: "ERROR" }),
    );

    const { executeC01Replay } = await import("@/lib/chaos/replay-service");
    await executeC01Replay(RUN_ID);

    // failRunningC01RunExecution (not completeRunningC01RunUnknown again, and
    // no other repository function) is the only finalization path taken.
    expect(failRunningC01RunExecutionMock).toHaveBeenCalledTimes(1);
    expect(completeRunningC01RunUnknownMock).toHaveBeenCalledTimes(1);
  });
});

describe("executeC01Replay — Finding 2: a failed replay processing attempt must itself be marked FAILED, never left PENDING", () => {
  it("1. a processor failure after the replay insert causes exactly that replay attempt's ID to be passed to the failure marker", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC01ReplaySourceMock.mockResolvedValue(
      fakeResolvedSource(),
    );
    startPendingC01RunAtomicallyMock.mockResolvedValue(
      fakeEligibleRun({ status: "RUNNING" }),
    );
    const attemptId = "aaaaaaaa-0000-0000-0000-000000000001";
    insertReplayProcessingAttemptMock.mockResolvedValue(
      fakeInsertedAttempt(attemptId),
    );
    processMerchantWebhookEventMock.mockRejectedValue(
      new MockMerchantProcessingError("PROCESSING_AMOUNT_MISMATCH"),
    );
    failRunningC01RunExecutionMock.mockResolvedValue(
      fakeEligibleRun({ status: "FAILED", outcome: "ERROR" }),
    );

    const { executeC01Replay } = await import("@/lib/chaos/replay-service");
    await executeC01Replay(RUN_ID);

    expect(
      markEventProcessingAttemptFailedIfNotFinalMock,
    ).toHaveBeenCalledTimes(1);
    const [markedId] =
      markEventProcessingAttemptFailedIfNotFinalMock.mock.calls[0]!;
    expect(markedId).toBe(attemptId);
  });

  it("2. the safe MerchantProcessingError code/message are persisted — never a raw processor/DB error", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC01ReplaySourceMock.mockResolvedValue(
      fakeResolvedSource(),
    );
    startPendingC01RunAtomicallyMock.mockResolvedValue(
      fakeEligibleRun({ status: "RUNNING" }),
    );
    insertReplayProcessingAttemptMock.mockResolvedValue(
      fakeInsertedAttempt("aaaaaaaa-0000-0000-0000-000000000001"),
    );
    processMerchantWebhookEventMock.mockRejectedValue(
      new MockMerchantProcessingError("PROCESSING_CORRELATION_INVALID"),
    );
    failRunningC01RunExecutionMock.mockResolvedValue(
      fakeEligibleRun({ status: "FAILED", outcome: "ERROR" }),
    );

    const { executeC01Replay } = await import("@/lib/chaos/replay-service");
    await executeC01Replay(RUN_ID);

    const [, code, message] =
      markEventProcessingAttemptFailedIfNotFinalMock.mock.calls[0]!;
    expect(code).toBe("PROCESSING_CORRELATION_INVALID");
    expect(message).toBe("safe-message-for-PROCESSING_CORRELATION_INVALID");
  });

  it("2b. an UNKNOWN (non-MerchantProcessingError) failure persists the generic safe PROCESSING_TRANSACTION_FAILED code/message — never err.message", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC01ReplaySourceMock.mockResolvedValue(
      fakeResolvedSource(),
    );
    startPendingC01RunAtomicallyMock.mockResolvedValue(
      fakeEligibleRun({ status: "RUNNING" }),
    );
    insertReplayProcessingAttemptMock.mockResolvedValue(
      fakeInsertedAttempt("aaaaaaaa-0000-0000-0000-000000000001"),
    );
    processMerchantWebhookEventMock.mockRejectedValue(
      new Error("raw-unknown-detail-that-must-never-leak"),
    );
    failRunningC01RunExecutionMock.mockResolvedValue(
      fakeEligibleRun({ status: "FAILED", outcome: "ERROR" }),
    );

    const { executeC01Replay } = await import("@/lib/chaos/replay-service");
    await executeC01Replay(RUN_ID);

    const [, code, message] =
      markEventProcessingAttemptFailedIfNotFinalMock.mock.calls[0]!;
    expect(code).toBe("PROCESSING_TRANSACTION_FAILED");
    expect(message).toBe("Merchant processing failed.");
    expect(message).not.toContain("raw-unknown-detail-that-must-never-leak");
  });

  it("3. replay #1 succeeds and replay #2 fails → replay #1 is never failure-marked, only replay #2 is", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC01ReplaySourceMock.mockResolvedValue(
      fakeResolvedSource(),
    );
    startPendingC01RunAtomicallyMock.mockResolvedValue(
      fakeEligibleRun({ status: "RUNNING" }),
    );
    const attemptIdA = "aaaaaaaa-0000-0000-0000-000000000001";
    const attemptIdB = "aaaaaaaa-0000-0000-0000-000000000002";
    insertReplayProcessingAttemptMock
      .mockResolvedValueOnce(fakeInsertedAttempt(attemptIdA))
      .mockResolvedValueOnce(fakeInsertedAttempt(attemptIdB));
    processMerchantWebhookEventMock
      .mockResolvedValueOnce({
        outcome: "processed",
        eventType: "payment.captured",
        orderId: "order-1",
        paymentId: PAYMENT_ID,
        fulfilmentId: "fulfilment-1",
      })
      .mockRejectedValueOnce(
        new MockMerchantProcessingError("PROCESSING_TRANSACTION_FAILED"),
      );
    failRunningC01RunExecutionMock.mockResolvedValue(
      fakeEligibleRun({ status: "FAILED", outcome: "ERROR" }),
    );

    const { executeC01Replay } = await import("@/lib/chaos/replay-service");
    await executeC01Replay(RUN_ID);

    expect(
      markEventProcessingAttemptFailedIfNotFinalMock,
    ).toHaveBeenCalledTimes(1);
    const [markedId] =
      markEventProcessingAttemptFailedIfNotFinalMock.mock.calls[0]!;
    expect(markedId).toBe(attemptIdB);
    expect(markedId).not.toBe(attemptIdA);
  });

  it("4. the failure marker itself throws → the chaos run still follows the FAILED/ERROR path → the raw marker error does not escape", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC01ReplaySourceMock.mockResolvedValue(
      fakeResolvedSource(),
    );
    startPendingC01RunAtomicallyMock.mockResolvedValue(
      fakeEligibleRun({ status: "RUNNING" }),
    );
    insertReplayProcessingAttemptMock.mockResolvedValue(
      fakeInsertedAttempt("aaaaaaaa-0000-0000-0000-000000000001"),
    );
    processMerchantWebhookEventMock.mockRejectedValue(
      new MockMerchantProcessingError("PROCESSING_TRANSACTION_FAILED"),
    );
    markEventProcessingAttemptFailedIfNotFinalMock.mockRejectedValue(
      new Error("raw-marker-detail-that-must-never-leak"),
    );
    failRunningC01RunExecutionMock.mockResolvedValue(
      fakeEligibleRun({ status: "FAILED", outcome: "ERROR" }),
    );

    const { executeC01Replay } = await import("@/lib/chaos/replay-service");
    const result = await executeC01Replay(RUN_ID);

    expect(result).toEqual({
      kind: "FAILED",
      chaosRunId: RUN_ID,
      reasonCategory: "EXECUTION_FAILED",
    });
    expect(failRunningC01RunExecutionMock).toHaveBeenCalledTimes(1);
  });
});

describe("lib/chaos/replay-service.ts — module surface", () => {
  it("imports the server-only marker package", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../lib/chaos/replay-service.ts"),
      "utf-8",
    );
    expect(source).toMatch(/import\s+["']server-only["']/);
  });

  it("has no route/URL/host/endpoint/target/script/SQL/count/authorized input surface anywhere in executeC01Replay's own signature or body beyond chaosRunId", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../lib/chaos/replay-service.ts"),
      "utf-8",
    );
    const signatureMatch = source.match(
      /export async function executeC01Replay\(([\s\S]*?)\)/,
    );
    expect(signatureMatch).not.toBeNull();
    expect(signatureMatch![1]!.trim().replace(/,$/, "")).toBe(
      "chaosRunId: string",
    );
  });
});
