import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 3D-D: `lib/chaos/c11-execution-service.ts` orchestration behavior
// against fully mocked collaborators (no network, no real processor, no
// real Supabase). Real end-to-end mechanics are separately proven by
// tests/integration/supabase/058-chaos-c11-real-webhook-replay.integration.test.ts.
vi.mock("server-only", () => ({}));

const getChaosRunByIdMock = vi.fn();
const startPendingC11BRunAtomicallyMock = vi.fn();
const completeRunningC11BRunUnknownMock = vi.fn();
const failRunningC11BRunExecutionMock = vi.fn();
vi.mock("@/lib/chaos/run-repository", () => ({
  getChaosRunById: (...args: unknown[]) => getChaosRunByIdMock(...args),
  startPendingC11BRunAtomically: (...args: unknown[]) =>
    startPendingC11BRunAtomicallyMock(...args),
  completeRunningC11BRunUnknown: (...args: unknown[]) =>
    completeRunningC11BRunUnknownMock(...args),
  failRunningC11BRunExecution: (...args: unknown[]) =>
    failRunningC11BRunExecutionMock(...args),
}));

const resolveAuthoritativeC11ReplaySourceMock = vi.fn();
const insertReplayProcessingAttemptMock = vi.fn();
vi.mock("@/lib/chaos/replay-repository", () => ({
  resolveAuthoritativeC11ReplaySource: (...args: unknown[]) =>
    resolveAuthoritativeC11ReplaySourceMock(...args),
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

// --- Supabase client mock, used only by readC11PostReplayMerchantState ---
interface MockResult {
  data: unknown;
  error: unknown;
}
interface FakeQueryBuilder extends PromiseLike<MockResult> {
  select: (columns?: string) => FakeQueryBuilder;
  eq: (column: string, value: unknown) => FakeQueryBuilder;
  single: () => Promise<MockResult>;
}
function makeQueryBuilder(result: MockResult): FakeQueryBuilder {
  const builder: FakeQueryBuilder = {
    select: () => builder,
    eq: () => builder,
    single: async () => result,
    then: (onfulfilled, onrejected) =>
      Promise.resolve(result).then(onfulfilled, onrejected),
  };
  return builder;
}
const fromMock = vi.fn();
const supabaseWriteCalls: { table: string; method: string }[] = [];
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => ({ from: fromMock }),
}));

beforeEach(() => {
  getChaosRunByIdMock.mockReset();
  startPendingC11BRunAtomicallyMock.mockReset();
  completeRunningC11BRunUnknownMock.mockReset();
  failRunningC11BRunExecutionMock.mockReset();
  resolveAuthoritativeC11ReplaySourceMock.mockReset();
  insertReplayProcessingAttemptMock.mockReset();
  processMerchantWebhookEventMock.mockReset();
  markEventProcessingAttemptFailedIfNotFinalMock.mockReset();
  markEventProcessingAttemptFailedIfNotFinalMock.mockResolvedValue(undefined);
  fromMock.mockReset();
  supabaseWriteCalls.length = 0;

  // Default: every table read succeeds cleanly. Any write-shaped call
  // (insert/update/delete/upsert) is recorded so tests can assert zero
  // occurred — this service must only ever SELECT via this client.
  fromMock.mockImplementation((table: string) => {
    const builder = makeQueryBuilder({ data: {}, error: null });
    for (const method of ["insert", "update", "delete", "upsert"] as const) {
      (builder as unknown as Record<string, unknown>)[method] = (
        ...args: unknown[]
      ) => {
        supabaseWriteCalls.push({ table, method });
        void args;
        return builder;
      };
    }
    return builder;
  });
});

const RUN_ID = "55555555-5555-5555-5555-555555555555";
const WEBHOOK_EVENT_ID = "11111111-1111-1111-1111-111111111111";
const ORDER_ID = "99999999-9999-9999-9999-999999999999";
const ORDER_ATTEMPT_ID = "22222222-2222-2222-2222-222222222222";
const PAYMENT_ID = "33333333-3333-3333-3333-333333333333";

function fakeEligibleRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    scenario_id: "C11",
    status: "PENDING",
    fault_type: null,
    data_classification: "RECORDED_TEST_EVIDENCE",
    source_webhook_event_id: WEBHOOK_EVENT_ID,
    order_id: ORDER_ID,
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
    normalizedEvent: {
      sourceKind: "REAL_RAZORPAY_WEBHOOK",
      eventType: "payment.failed",
      kind: "payment.failed",
      razorpayPaymentStatus: "failed",
    },
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
    normalized_event: fakeResolvedSource().normalizedEvent,
    error_code: null,
    error_message_redacted: null,
    started_at: "2026-01-01T00:00:00.000Z",
    finished_at: null,
  };
}

function fakeProcessedResult() {
  return {
    outcome: "processed",
    eventType: "payment.failed",
    orderId: ORDER_ID,
    paymentId: PAYMENT_ID,
    fulfilmentId: null,
  };
}

describe("executeC11RealWebhookReplay — happy path", () => {
  it("claims RUNNING, creates exactly C11_REPLAY_ATTEMPT_COUNT (1) replay attempt, processes it, reads post-state, and completes COMPLETED/UNKNOWN", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC11ReplaySourceMock.mockResolvedValue(
      fakeResolvedSource(),
    );
    startPendingC11BRunAtomicallyMock.mockResolvedValue(
      fakeEligibleRun({ status: "RUNNING" }),
    );
    const attemptId = "aaaaaaaa-0000-0000-0000-000000000001";
    insertReplayProcessingAttemptMock.mockResolvedValue(
      fakeInsertedAttempt(attemptId),
    );
    processMerchantWebhookEventMock.mockResolvedValue(fakeProcessedResult());
    completeRunningC11BRunUnknownMock.mockResolvedValue(
      fakeEligibleRun({ status: "COMPLETED", outcome: "UNKNOWN" }),
    );

    const { executeC11RealWebhookReplay, C11_REPLAY_ATTEMPT_COUNT } =
      await import("@/lib/chaos/c11-execution-service");

    const result = await executeC11RealWebhookReplay(RUN_ID);

    expect(C11_REPLAY_ATTEMPT_COUNT).toBe(1);
    expect(startPendingC11BRunAtomicallyMock).toHaveBeenCalledWith(RUN_ID);
    expect(insertReplayProcessingAttemptMock).toHaveBeenCalledTimes(1);
    expect(processMerchantWebhookEventMock).toHaveBeenCalledTimes(1);
    expect(processMerchantWebhookEventMock).toHaveBeenCalledWith(attemptId);
    expect(result).toEqual({
      kind: "COMPLETED",
      chaosRunId: RUN_ID,
      replayAttemptCount: 1,
    });
  });

  it("the single inserted replay attempt copies webhookEventId/paymentAttemptId/paymentId/normalizedEvent from the resolved source VERBATIM, with chaosRunId set — the normalized_event is never recomputed", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    const source = fakeResolvedSource();
    resolveAuthoritativeC11ReplaySourceMock.mockResolvedValue(source);
    startPendingC11BRunAtomicallyMock.mockResolvedValue(
      fakeEligibleRun({ status: "RUNNING" }),
    );
    insertReplayProcessingAttemptMock.mockResolvedValue(
      fakeInsertedAttempt("aaaaaaaa-0000-0000-0000-000000000001"),
    );
    processMerchantWebhookEventMock.mockResolvedValue(fakeProcessedResult());
    completeRunningC11BRunUnknownMock.mockResolvedValue(fakeEligibleRun());

    const { executeC11RealWebhookReplay } =
      await import("@/lib/chaos/c11-execution-service");
    await executeC11RealWebhookReplay(RUN_ID);

    expect(insertReplayProcessingAttemptMock).toHaveBeenCalledWith({
      chaosRunId: RUN_ID,
      webhookEventId: WEBHOOK_EVENT_ID,
      paymentAttemptId: ORDER_ATTEMPT_ID,
      paymentId: PAYMENT_ID,
      normalizedEvent: source.normalizedEvent,
    });
    expect(
      insertReplayProcessingAttemptMock.mock.calls[0]![0].normalizedEvent,
    ).toBe(source.normalizedEvent);
  });

  it("uses the PAYCHAOS_REPLAY repository (insertReplayProcessingAttempt), never a direct webhook_events/payment/fulfilment write of its own", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC11ReplaySourceMock.mockResolvedValue(
      fakeResolvedSource(),
    );
    startPendingC11BRunAtomicallyMock.mockResolvedValue(
      fakeEligibleRun({ status: "RUNNING" }),
    );
    insertReplayProcessingAttemptMock.mockResolvedValue(
      fakeInsertedAttempt("aaaaaaaa-0000-0000-0000-000000000001"),
    );
    processMerchantWebhookEventMock.mockResolvedValue(fakeProcessedResult());
    completeRunningC11BRunUnknownMock.mockResolvedValue(fakeEligibleRun());

    const { executeC11RealWebhookReplay } =
      await import("@/lib/chaos/c11-execution-service");
    await executeC11RealWebhookReplay(RUN_ID);

    expect(supabaseWriteCalls).toEqual([]);
  });
});

describe("executeC11RealWebhookReplay — not startable (no RUNNING claim, no mutation)", () => {
  it("returns NOT_STARTABLE/RUN_NOT_FOUND when the run does not exist", async () => {
    getChaosRunByIdMock.mockResolvedValue(null);
    const { executeC11RealWebhookReplay } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await executeC11RealWebhookReplay(RUN_ID);
    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "RUN_NOT_FOUND",
    });
    expect(startPendingC11BRunAtomicallyMock).not.toHaveBeenCalled();
  });

  it.each([
    ["scenario_id", "C01"],
    ["scenario_id", "C03"],
    ["scenario_id", "C07"],
    ["status", "RUNNING"],
    ["fault_type", "REPLAY_EVENT"],
    ["fault_type", "INVALID_SIGNATURE_TEST"],
    ["data_classification", "SYNTHETIC_DEMO"],
  ])(
    "returns NOT_STARTABLE/RUN_NOT_ELIGIBLE when %s is %s",
    async (field, value) => {
      getChaosRunByIdMock.mockResolvedValue(
        fakeEligibleRun({ [field]: value }),
      );
      const { executeC11RealWebhookReplay } =
        await import("@/lib/chaos/c11-execution-service");
      const result = await executeC11RealWebhookReplay(RUN_ID);
      expect(result).toEqual({
        kind: "NOT_STARTABLE",
        reasonCategory: "RUN_NOT_ELIGIBLE",
      });
      expect(startPendingC11BRunAtomicallyMock).not.toHaveBeenCalled();
    },
  );

  it("returns NOT_STARTABLE/RUN_NOT_ELIGIBLE when source_webhook_event_id is missing", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      fakeEligibleRun({ source_webhook_event_id: null }),
    );
    const { executeC11RealWebhookReplay } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await executeC11RealWebhookReplay(RUN_ID);
    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "RUN_NOT_ELIGIBLE",
    });
  });

  it("returns NOT_STARTABLE/SOURCE_EVIDENCE_UNRESOLVED when source resolution fails, without claiming RUNNING", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC11ReplaySourceMock.mockResolvedValue(null);
    const { executeC11RealWebhookReplay } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await executeC11RealWebhookReplay(RUN_ID);
    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "SOURCE_EVIDENCE_UNRESOLVED",
    });
    expect(startPendingC11BRunAtomicallyMock).not.toHaveBeenCalled();
  });

  it("returns NOT_STARTABLE/ALREADY_STARTED_OR_NOT_PENDING when the atomic claim returns null (concurrent double-start)", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC11ReplaySourceMock.mockResolvedValue(
      fakeResolvedSource(),
    );
    startPendingC11BRunAtomicallyMock.mockResolvedValue(null);
    const { executeC11RealWebhookReplay } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await executeC11RealWebhookReplay(RUN_ID);
    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "ALREADY_STARTED_OR_NOT_PENDING",
    });
    expect(insertReplayProcessingAttemptMock).not.toHaveBeenCalled();
    expect(processMerchantWebhookEventMock).not.toHaveBeenCalled();
  });
});

describe("executeC11RealWebhookReplay — technical execution failure", () => {
  it("marks the run FAILED/ERROR with a fixed safe reason (never the raw error) when the processor throws", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC11ReplaySourceMock.mockResolvedValue(
      fakeResolvedSource(),
    );
    startPendingC11BRunAtomicallyMock.mockResolvedValue(
      fakeEligibleRun({ status: "RUNNING" }),
    );
    insertReplayProcessingAttemptMock.mockResolvedValue(
      fakeInsertedAttempt("aaaaaaaa-0000-0000-0000-000000000001"),
    );
    processMerchantWebhookEventMock.mockRejectedValue(
      new Error("raw-postgres-detail-that-must-never-leak"),
    );
    failRunningC11BRunExecutionMock.mockResolvedValue(
      fakeEligibleRun({ status: "FAILED", outcome: "ERROR" }),
    );

    const { executeC11RealWebhookReplay } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await executeC11RealWebhookReplay(RUN_ID);

    expect(result).toEqual({
      kind: "FAILED",
      chaosRunId: RUN_ID,
      reasonCategory: "EXECUTION_FAILED",
    });
    expect(failRunningC11BRunExecutionMock).toHaveBeenCalledTimes(1);
    const [, safeReason] = failRunningC11BRunExecutionMock.mock.calls[0]!;
    expect(safeReason).not.toContain(
      "raw-postgres-detail-that-must-never-leak",
    );
    expect(completeRunningC11BRunUnknownMock).not.toHaveBeenCalled();
  });

  it("marks the replay attempt itself FAILED with the safe MerchantProcessingError code/message, never a raw error", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC11ReplaySourceMock.mockResolvedValue(
      fakeResolvedSource(),
    );
    startPendingC11BRunAtomicallyMock.mockResolvedValue(
      fakeEligibleRun({ status: "RUNNING" }),
    );
    const attemptId = "aaaaaaaa-0000-0000-0000-000000000001";
    insertReplayProcessingAttemptMock.mockResolvedValue(
      fakeInsertedAttempt(attemptId),
    );
    processMerchantWebhookEventMock.mockRejectedValue(
      new MockMerchantProcessingError("PROCESSING_AMOUNT_MISMATCH"),
    );
    failRunningC11BRunExecutionMock.mockResolvedValue(
      fakeEligibleRun({ status: "FAILED", outcome: "ERROR" }),
    );

    const { executeC11RealWebhookReplay } =
      await import("@/lib/chaos/c11-execution-service");
    await executeC11RealWebhookReplay(RUN_ID);

    expect(
      markEventProcessingAttemptFailedIfNotFinalMock,
    ).toHaveBeenCalledTimes(1);
    const [markedId, code, message] =
      markEventProcessingAttemptFailedIfNotFinalMock.mock.calls[0]!;
    expect(markedId).toBe(attemptId);
    expect(code).toBe("PROCESSING_AMOUNT_MISMATCH");
    expect(message).toBe("safe-message-for-PROCESSING_AMOUNT_MISMATCH");
  });

  it("does not mask the original failure if failRunningC11BRunExecution itself throws (best-effort)", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC11ReplaySourceMock.mockResolvedValue(
      fakeResolvedSource(),
    );
    startPendingC11BRunAtomicallyMock.mockResolvedValue(
      fakeEligibleRun({ status: "RUNNING" }),
    );
    insertReplayProcessingAttemptMock.mockRejectedValue(
      new Error("insert failed"),
    );
    failRunningC11BRunExecutionMock.mockRejectedValue(
      new Error("failed to persist failure"),
    );

    const { executeC11RealWebhookReplay } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await executeC11RealWebhookReplay(RUN_ID);

    expect(result).toEqual({
      kind: "FAILED",
      chaosRunId: RUN_ID,
      reasonCategory: "EXECUTION_FAILED",
    });
  });
});

describe("executeC11RealWebhookReplay — post-state verification failure (this task's Section 11)", () => {
  it("returns FAILED/POST_STATE_VERIFICATION_FAILED when the post-replay order read technically fails, and never claims COMPLETED", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC11ReplaySourceMock.mockResolvedValue(
      fakeResolvedSource(),
    );
    startPendingC11BRunAtomicallyMock.mockResolvedValue(
      fakeEligibleRun({ status: "RUNNING" }),
    );
    insertReplayProcessingAttemptMock.mockResolvedValue(
      fakeInsertedAttempt("aaaaaaaa-0000-0000-0000-000000000001"),
    );
    processMerchantWebhookEventMock.mockResolvedValue(fakeProcessedResult());
    fromMock.mockImplementation((table: string) => {
      if (table === "orders") {
        return makeQueryBuilder({
          data: null,
          error: { message: "leaked-secret-detail" },
        });
      }
      return makeQueryBuilder({ data: {}, error: null });
    });
    failRunningC11BRunExecutionMock.mockResolvedValue(
      fakeEligibleRun({ status: "FAILED", outcome: "ERROR" }),
    );

    const { executeC11RealWebhookReplay } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await executeC11RealWebhookReplay(RUN_ID);

    expect(result).toEqual({
      kind: "FAILED",
      chaosRunId: RUN_ID,
      reasonCategory: "POST_STATE_VERIFICATION_FAILED",
    });
    expect(completeRunningC11BRunUnknownMock).not.toHaveBeenCalled();
    const [, safeReason] = failRunningC11BRunExecutionMock.mock.calls[0]!;
    expect(safeReason).not.toContain("leaked-secret-detail");
  });

  it("never gates COMPLETED vs FAILED on the CONTENT of the post-state read — a successful read (regardless of what it returns) still completes normally", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC11ReplaySourceMock.mockResolvedValue(
      fakeResolvedSource(),
    );
    startPendingC11BRunAtomicallyMock.mockResolvedValue(
      fakeEligibleRun({ status: "RUNNING" }),
    );
    insertReplayProcessingAttemptMock.mockResolvedValue(
      fakeInsertedAttempt("aaaaaaaa-0000-0000-0000-000000000001"),
    );
    processMerchantWebhookEventMock.mockResolvedValue(fakeProcessedResult());
    // Deliberately "unexpected-looking" content (e.g. a PAID order) — the
    // service must still complete; Phase 3D never assigns invariant
    // PASS/FAIL, so this content alone can never fail the run.
    fromMock.mockImplementation(() =>
      makeQueryBuilder({
        data: { payment_status: "PAID", business_status: "FULFILLED" },
        error: null,
      }),
    );
    completeRunningC11BRunUnknownMock.mockResolvedValue(
      fakeEligibleRun({ status: "COMPLETED", outcome: "UNKNOWN" }),
    );

    const { executeC11RealWebhookReplay } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await executeC11RealWebhookReplay(RUN_ID);

    expect(result.kind).toBe("COMPLETED");
  });

  it("returns FAILED/POST_STATE_VERIFICATION_FAILED (never silently skipping) if the claimed run's order_id is unexpectedly missing", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC11ReplaySourceMock.mockResolvedValue(
      fakeResolvedSource(),
    );
    startPendingC11BRunAtomicallyMock.mockResolvedValue(
      fakeEligibleRun({ status: "RUNNING", order_id: null }),
    );
    insertReplayProcessingAttemptMock.mockResolvedValue(
      fakeInsertedAttempt("aaaaaaaa-0000-0000-0000-000000000001"),
    );
    processMerchantWebhookEventMock.mockResolvedValue(fakeProcessedResult());
    failRunningC11BRunExecutionMock.mockResolvedValue(
      fakeEligibleRun({ status: "FAILED", outcome: "ERROR" }),
    );

    const { executeC11RealWebhookReplay } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await executeC11RealWebhookReplay(RUN_ID);

    expect(result).toEqual({
      kind: "FAILED",
      chaosRunId: RUN_ID,
      reasonCategory: "POST_STATE_VERIFICATION_FAILED",
    });
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("executeC11RealWebhookReplay — finalization never strands RUNNING", () => {
  function setUpSuccessfulReplayThenFinalization() {
    getChaosRunByIdMock.mockResolvedValue(fakeEligibleRun());
    resolveAuthoritativeC11ReplaySourceMock.mockResolvedValue(
      fakeResolvedSource(),
    );
    startPendingC11BRunAtomicallyMock.mockResolvedValue(
      fakeEligibleRun({ status: "RUNNING" }),
    );
    insertReplayProcessingAttemptMock.mockResolvedValue(
      fakeInsertedAttempt("aaaaaaaa-0000-0000-0000-000000000001"),
    );
    processMerchantWebhookEventMock.mockResolvedValue(fakeProcessedResult());
  }

  it("completeRunningC11BRunUnknown returns null → failRunningC11BRunExecution called once with a safe finalization reason → FAILED/COMPLETION_PERSISTENCE_FAILED", async () => {
    setUpSuccessfulReplayThenFinalization();
    completeRunningC11BRunUnknownMock.mockResolvedValue(null);
    failRunningC11BRunExecutionMock.mockResolvedValue(
      fakeEligibleRun({ status: "FAILED", outcome: "ERROR" }),
    );

    const { executeC11RealWebhookReplay } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await executeC11RealWebhookReplay(RUN_ID);

    expect(failRunningC11BRunExecutionMock).toHaveBeenCalledTimes(1);
    const [failedRunId, safeReason] =
      failRunningC11BRunExecutionMock.mock.calls[0]!;
    expect(failedRunId).toBe(RUN_ID);
    expect(safeReason).toContain("could not be persisted");
    expect(result).toEqual({
      kind: "FAILED",
      chaosRunId: RUN_ID,
      reasonCategory: "COMPLETION_PERSISTENCE_FAILED",
    });
  });

  it("completeRunningC11BRunUnknown THROWS a raw secret-shaped error → the raw message is never forwarded/persisted", async () => {
    setUpSuccessfulReplayThenFinalization();
    completeRunningC11BRunUnknownMock.mockRejectedValue(
      new Error("raw-postgres-secret-detail-that-must-never-leak"),
    );
    failRunningC11BRunExecutionMock.mockResolvedValue(
      fakeEligibleRun({ status: "FAILED", outcome: "ERROR" }),
    );

    const { executeC11RealWebhookReplay } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await executeC11RealWebhookReplay(RUN_ID);

    const [, safeReason] = failRunningC11BRunExecutionMock.mock.calls[0]!;
    expect(safeReason).not.toContain(
      "raw-postgres-secret-detail-that-must-never-leak",
    );
    expect(result).toEqual({
      kind: "FAILED",
      chaosRunId: RUN_ID,
      reasonCategory: "COMPLETION_PERSISTENCE_FAILED",
    });
  });

  it("completion fails AND failRunningC11BRunExecution itself also throws → no raw error escapes, safe FAILED result still returned", async () => {
    setUpSuccessfulReplayThenFinalization();
    completeRunningC11BRunUnknownMock.mockResolvedValue(null);
    failRunningC11BRunExecutionMock.mockRejectedValue(
      new Error("raw-secret-detail-from-the-finalization-attempt-itself"),
    );

    const { executeC11RealWebhookReplay } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await executeC11RealWebhookReplay(RUN_ID);

    expect(result).toEqual({
      kind: "FAILED",
      chaosRunId: RUN_ID,
      reasonCategory: "COMPLETION_PERSISTENCE_FAILED",
    });
  });
});

describe("lib/chaos/c11-execution-service.ts — module surface", () => {
  it("imports the server-only marker package", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../lib/chaos/c11-execution-service.ts",
      ),
      "utf-8",
    );
    expect(source).toMatch(/import\s+["']server-only["']/);
  });

  it("has no route/URL/host/endpoint/target/script/SQL/count/authorized input surface anywhere in executeC11RealWebhookReplay's own signature beyond chaosRunId", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../lib/chaos/c11-execution-service.ts",
      ),
      "utf-8",
    );
    const signatureMatch = source.match(
      /export async function executeC11RealWebhookReplay\(([\s\S]*?)\)/,
    );
    expect(signatureMatch).not.toBeNull();
    expect(signatureMatch![1]!.trim().replace(/,$/, "")).toBe(
      "chaosRunId: string",
    );
  });

  it("never imports C01_REPLAY_ATTEMPT_COUNT from lib/chaos/replay-service.ts", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../lib/chaos/c11-execution-service.ts",
      ),
      "utf-8",
    );
    // Strip comments first — the module doc comment legitimately
    // documents that C01_REPLAY_ATTEMPT_COUNT is never imported/reused
    // here, which would otherwise trip this check on the raw source.
    const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const functionalSource = withoutBlockComments
      .split("\n")
      .map((line) => {
        const idx = line.indexOf("//");
        return idx === -1 ? line : line.slice(0, idx);
      })
      .join("\n");
    expect(functionalSource).not.toMatch(/C01_REPLAY_ATTEMPT_COUNT/);
    expect(functionalSource).not.toMatch(
      /from\s*["']@\/lib\/chaos\/replay-service["']/,
    );
  });
});
