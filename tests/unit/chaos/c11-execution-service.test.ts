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
// Phase 3D-E additive C11-A lifecycle mocks (same module, extended).
const startPendingC11ARunAtomicallyMock = vi.fn();
const blockPendingC11ARunForPreSec007Mock = vi.fn();
const completeRunningC11ARunWithEvidenceMock = vi.fn();
const failRunningC11ARunExecutionMock = vi.fn();
vi.mock("@/lib/chaos/run-repository", () => ({
  getChaosRunById: (...args: unknown[]) => getChaosRunByIdMock(...args),
  startPendingC11BRunAtomically: (...args: unknown[]) =>
    startPendingC11BRunAtomicallyMock(...args),
  completeRunningC11BRunUnknown: (...args: unknown[]) =>
    completeRunningC11BRunUnknownMock(...args),
  failRunningC11BRunExecution: (...args: unknown[]) =>
    failRunningC11BRunExecutionMock(...args),
  startPendingC11ARunAtomically: (...args: unknown[]) =>
    startPendingC11ARunAtomicallyMock(...args),
  blockPendingC11ARunForPreSec007: (...args: unknown[]) =>
    blockPendingC11ARunForPreSec007Mock(...args),
  completeRunningC11ARunWithEvidence: (...args: unknown[]) =>
    completeRunningC11ARunWithEvidenceMock(...args),
  failRunningC11ARunExecution: (...args: unknown[]) =>
    failRunningC11ARunExecutionMock(...args),
}));

const resolveC11AFailureObservationEvidenceMock = vi.fn();
const readC11AObservedMerchantStateMock = vi.fn();
vi.mock("@/lib/chaos/c11-observation-repository", () => ({
  resolveC11AFailureObservationEvidence: (...args: unknown[]) =>
    resolveC11AFailureObservationEvidenceMock(...args),
  readC11AObservedMerchantState: (...args: unknown[]) =>
    readC11AObservedMerchantStateMock(...args),
}));

const getOrderBaselineMock = vi.fn();
const isFreshBaselineMock = vi.fn();
vi.mock("@/lib/chaos/repository", () => ({
  getOrderBaseline: (...args: unknown[]) => getOrderBaselineMock(...args),
  isFreshBaseline: (...args: unknown[]) => isFreshBaselineMock(...args),
}));

const getRazorpayEnvMock = vi.fn();
vi.mock("@/lib/config/razorpay-env", () => ({
  getRazorpayEnv: (...args: unknown[]) => getRazorpayEnvMock(...args),
}));

const getRazorpayWebhookSecretMock = vi.fn();
vi.mock("@/lib/config/razorpay-webhook-env", () => ({
  getRazorpayWebhookSecret: (...args: unknown[]) =>
    getRazorpayWebhookSecretMock(...args),
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
  startPendingC11ARunAtomicallyMock.mockReset();
  blockPendingC11ARunForPreSec007Mock.mockReset();
  completeRunningC11ARunWithEvidenceMock.mockReset();
  failRunningC11ARunExecutionMock.mockReset();
  resolveC11AFailureObservationEvidenceMock.mockReset();
  readC11AObservedMerchantStateMock.mockReset();
  readC11AObservedMerchantStateMock.mockResolvedValue(undefined);
  getOrderBaselineMock.mockReset();
  isFreshBaselineMock.mockReset();
  isFreshBaselineMock.mockReturnValue(true);
  getRazorpayEnvMock.mockReset();
  getRazorpayEnvMock.mockReturnValue({
    mode: "test",
    keyId: "rzp_test_fake",
    keySecret: "fake-secret",
  });
  getRazorpayWebhookSecretMock.mockReset();
  getRazorpayWebhookSecretMock.mockReturnValue(
    "fake-webhook-secret-" + "x".repeat(20),
  );
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

// ============================================================================
// PHASE 3D-E — C11-A PURE OBSERVATION (this task's Sections 12/13/16)
// ============================================================================

const C11A_ORDER_ID = "88888888-8888-8888-8888-888888888888";
const C11A_ATTEMPT_ID = "77777777-7777-7777-7777-777777777777";
const C11A_PAYMENT_ID = "66666666-6666-6666-6666-666666666666";
const C11A_WEBHOOK_EVENT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function fakeEligiblePendingC11ARun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    scenario_id: "C11",
    status: "PENDING",
    fault_type: null,
    data_classification: "RECORDED_TEST_EVIDENCE",
    order_id: C11A_ORDER_ID,
    payment_attempt_id: null,
    payment_id: null,
    source_webhook_event_id: null,
    outcome: null,
    started_at: null,
    completed_at: null,
    failed_precheck_id: null,
    execution_block_code: null,
    error_message_redacted: null,
    ...overrides,
  };
}

function fakeRunningC11ARun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    scenario_id: "C11",
    status: "RUNNING",
    fault_type: null,
    data_classification: "RECORDED_TEST_EVIDENCE",
    order_id: C11A_ORDER_ID,
    payment_attempt_id: null,
    payment_id: null,
    source_webhook_event_id: null,
    outcome: null,
    started_at: "2026-01-01T00:00:00.000Z",
    completed_at: null,
    failed_precheck_id: null,
    execution_block_code: null,
    error_message_redacted: null,
    ...overrides,
  };
}

function fakeC11AEvidence(overrides: Record<string, unknown> = {}) {
  return {
    webhookEventId: C11A_WEBHOOK_EVENT_ID,
    paymentAttemptId: C11A_ATTEMPT_ID,
    paymentId: C11A_PAYMENT_ID,
    ...overrides,
  };
}

describe("startC11AFailureObservation — happy path", () => {
  it("re-checks the fresh baseline, checks PRE-SEC-007, atomically claims RUNNING, and returns OBSERVING", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligiblePendingC11ARun());
    getOrderBaselineMock.mockResolvedValue({
      orderId: C11A_ORDER_ID,
      paymentStatus: "UNPAID",
      businessStatus: "OPEN",
      fulfilmentCount: 0,
    });
    startPendingC11ARunAtomicallyMock.mockResolvedValue(fakeRunningC11ARun());

    const { startC11AFailureObservation } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await startC11AFailureObservation(RUN_ID);

    expect(getOrderBaselineMock).toHaveBeenCalledWith(C11A_ORDER_ID);
    expect(getRazorpayEnvMock).toHaveBeenCalled();
    expect(getRazorpayWebhookSecretMock).toHaveBeenCalled();
    expect(startPendingC11ARunAtomicallyMock).toHaveBeenCalledWith(RUN_ID);
    expect(result).toEqual({ kind: "OBSERVING", chaosRunId: RUN_ID });
  });
});

describe("startC11AFailureObservation — not startable (no RUNNING claim, no mutation)", () => {
  it("returns NOT_STARTABLE/RUN_NOT_FOUND when the run does not exist", async () => {
    getChaosRunByIdMock.mockResolvedValue(null);
    const { startC11AFailureObservation } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await startC11AFailureObservation(RUN_ID);
    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "RUN_NOT_FOUND",
    });
    expect(startPendingC11ARunAtomicallyMock).not.toHaveBeenCalled();
  });

  it.each([
    ["scenario_id", "C01"],
    ["scenario_id", "C07"],
    ["status", "RUNNING"],
    ["fault_type", "DROP_CLIENT_CONFIRMATION"],
    ["data_classification", "SYNTHETIC_DEMO"],
    ["order_id", null],
    // C11-B-shaped PENDING run: source_webhook_event_id/payment_attempt_id/
    // payment_id all non-null — must never be claimable by C11-A's start.
    ["source_webhook_event_id", "some-webhook-id"],
    ["payment_attempt_id", "some-attempt-id"],
    ["payment_id", "some-payment-id"],
  ])(
    "returns NOT_STARTABLE/RUN_NOT_ELIGIBLE when %s is %s",
    async (field, value) => {
      getChaosRunByIdMock.mockResolvedValue(
        fakeEligiblePendingC11ARun({ [field]: value }),
      );
      const { startC11AFailureObservation } =
        await import("@/lib/chaos/c11-execution-service");
      const result = await startC11AFailureObservation(RUN_ID);
      expect(result).toEqual({
        kind: "NOT_STARTABLE",
        reasonCategory: "RUN_NOT_ELIGIBLE",
      });
      expect(startPendingC11ARunAtomicallyMock).not.toHaveBeenCalled();
    },
  );

  it("returns NOT_STARTABLE/BASELINE_NOT_FRESH when the order baseline is no longer fresh, without mutating anything", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligiblePendingC11ARun());
    getOrderBaselineMock.mockResolvedValue({
      orderId: C11A_ORDER_ID,
      paymentStatus: "PAID",
      businessStatus: "OPEN",
      fulfilmentCount: 0,
    });
    isFreshBaselineMock.mockReturnValue(false);
    const { startC11AFailureObservation } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await startC11AFailureObservation(RUN_ID);
    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "BASELINE_NOT_FRESH",
    });
    expect(startPendingC11ARunAtomicallyMock).not.toHaveBeenCalled();
  });

  it("returns NOT_STARTABLE/BASELINE_NOT_FRESH when the order baseline no longer resolves at all", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligiblePendingC11ARun());
    getOrderBaselineMock.mockResolvedValue(null);
    const { startC11AFailureObservation } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await startC11AFailureObservation(RUN_ID);
    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "BASELINE_NOT_FRESH",
    });
  });

  it("returns NOT_STARTABLE/ALREADY_STARTED_OR_NOT_PENDING when the atomic claim returns null (concurrent double-start)", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligiblePendingC11ARun());
    getOrderBaselineMock.mockResolvedValue({
      orderId: C11A_ORDER_ID,
      paymentStatus: "UNPAID",
      businessStatus: "OPEN",
      fulfilmentCount: 0,
    });
    startPendingC11ARunAtomicallyMock.mockResolvedValue(null);
    const { startC11AFailureObservation } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await startC11AFailureObservation(RUN_ID);
    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "ALREADY_STARTED_OR_NOT_PENDING",
    });
  });

  it("returns NOT_STARTABLE/START_PERSISTENCE_UNVERIFIED when the returned durable row has a surprising shape", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligiblePendingC11ARun());
    getOrderBaselineMock.mockResolvedValue({
      orderId: C11A_ORDER_ID,
      paymentStatus: "UNPAID",
      businessStatus: "OPEN",
      fulfilmentCount: 0,
    });
    startPendingC11ARunAtomicallyMock.mockResolvedValue(
      fakeRunningC11ARun({ order_id: "some-other-order" }),
    );
    const { startC11AFailureObservation } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await startC11AFailureObservation(RUN_ID);
    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "START_PERSISTENCE_UNVERIFIED",
    });
  });
});

describe("startC11AFailureObservation — PRE-SEC-007", () => {
  it("blocks PENDING->BLOCKED when Razorpay Test Mode config is unavailable, and never claims RUNNING", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligiblePendingC11ARun());
    getOrderBaselineMock.mockResolvedValue({
      orderId: C11A_ORDER_ID,
      paymentStatus: "UNPAID",
      businessStatus: "OPEN",
      fulfilmentCount: 0,
    });
    getRazorpayEnvMock.mockImplementation(() => {
      throw new Error("missing RAZORPAY_KEY_SECRET");
    });
    blockPendingC11ARunForPreSec007Mock.mockResolvedValue(
      fakeEligiblePendingC11ARun({
        status: "COMPLETED",
        outcome: "BLOCKED",
        execution_block_code: "PRE-SEC-007",
        failed_precheck_id: null,
        started_at: null,
        completed_at: "2026-01-01T00:00:00.000Z",
      }),
    );
    const { startC11AFailureObservation } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await startC11AFailureObservation(RUN_ID);
    expect(result).toEqual({ kind: "BLOCKED_PRE_SEC_007", chaosRunId: RUN_ID });
    expect(startPendingC11ARunAtomicallyMock).not.toHaveBeenCalled();
  });

  it("blocks PENDING->BLOCKED when the webhook secret is unavailable", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligiblePendingC11ARun());
    getOrderBaselineMock.mockResolvedValue({
      orderId: C11A_ORDER_ID,
      paymentStatus: "UNPAID",
      businessStatus: "OPEN",
      fulfilmentCount: 0,
    });
    getRazorpayWebhookSecretMock.mockImplementation(() => {
      throw new Error("missing RAZORPAY_WEBHOOK_SECRET");
    });
    blockPendingC11ARunForPreSec007Mock.mockResolvedValue(
      fakeEligiblePendingC11ARun({
        status: "COMPLETED",
        outcome: "BLOCKED",
        execution_block_code: "PRE-SEC-007",
        failed_precheck_id: null,
        started_at: null,
        completed_at: "2026-01-01T00:00:00.000Z",
      }),
    );
    const { startC11AFailureObservation } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await startC11AFailureObservation(RUN_ID);
    expect(result).toEqual({ kind: "BLOCKED_PRE_SEC_007", chaosRunId: RUN_ID });
  });

  it("returns BLOCK_PERSISTENCE_FAILED when the block write itself fails, never silently succeeding", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligiblePendingC11ARun());
    getOrderBaselineMock.mockResolvedValue({
      orderId: C11A_ORDER_ID,
      paymentStatus: "UNPAID",
      businessStatus: "OPEN",
      fulfilmentCount: 0,
    });
    getRazorpayEnvMock.mockImplementation(() => {
      throw new Error("missing config");
    });
    blockPendingC11ARunForPreSec007Mock.mockResolvedValue(null);
    const { startC11AFailureObservation } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await startC11AFailureObservation(RUN_ID);
    expect(result).toEqual({
      kind: "BLOCK_PERSISTENCE_FAILED",
      chaosRunId: RUN_ID,
    });
  });
});

describe("reconcileC11AFailedPaymentObservation — stateless CHECK NOW", () => {
  it("returns NOT_YET_CONVERGED and mutates NOTHING when no evidence has arrived yet", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeRunningC11ARun());
    resolveC11AFailureObservationEvidenceMock.mockResolvedValue({
      kind: "NOT_YET_CONVERGED",
    });
    const { reconcileC11AFailedPaymentObservation } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await reconcileC11AFailedPaymentObservation(RUN_ID);
    expect(result).toEqual({ kind: "NOT_YET_CONVERGED", chaosRunId: RUN_ID });
    expect(failRunningC11ARunExecutionMock).not.toHaveBeenCalled();
    expect(completeRunningC11ARunWithEvidenceMock).not.toHaveBeenCalled();
  });

  it("repeated no-evidence calls remain NOT_YET_CONVERGED with zero writes", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeRunningC11ARun());
    resolveC11AFailureObservationEvidenceMock.mockResolvedValue({
      kind: "NOT_YET_CONVERGED",
    });
    const { reconcileC11AFailedPaymentObservation } =
      await import("@/lib/chaos/c11-execution-service");
    await reconcileC11AFailedPaymentObservation(RUN_ID);
    await reconcileC11AFailedPaymentObservation(RUN_ID);
    await reconcileC11AFailedPaymentObservation(RUN_ID);
    expect(failRunningC11ARunExecutionMock).not.toHaveBeenCalled();
    expect(completeRunningC11ARunWithEvidenceMock).not.toHaveBeenCalled();
  });

  it("valid authoritative evidence -> COMPLETED with the correct three evidence FKs, outcome remains UNKNOWN", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeRunningC11ARun());
    resolveC11AFailureObservationEvidenceMock.mockResolvedValue({
      kind: "RESOLVED",
      evidence: fakeC11AEvidence(),
    });
    completeRunningC11ARunWithEvidenceMock.mockResolvedValue(
      fakeRunningC11ARun({
        status: "COMPLETED",
        outcome: "UNKNOWN",
        payment_attempt_id: C11A_ATTEMPT_ID,
        payment_id: C11A_PAYMENT_ID,
        source_webhook_event_id: C11A_WEBHOOK_EVENT_ID,
        completed_at: "2026-01-01T01:00:00.000Z",
      }),
    );
    const { reconcileC11AFailedPaymentObservation } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await reconcileC11AFailedPaymentObservation(RUN_ID);
    expect(readC11AObservedMerchantStateMock).toHaveBeenCalledWith(
      C11A_ORDER_ID,
      C11A_ATTEMPT_ID,
      C11A_PAYMENT_ID,
    );
    expect(completeRunningC11ARunWithEvidenceMock).toHaveBeenCalledWith(
      RUN_ID,
      C11A_ORDER_ID,
      {
        paymentAttemptId: C11A_ATTEMPT_ID,
        paymentId: C11A_PAYMENT_ID,
        sourceWebhookEventId: C11A_WEBHOOK_EVENT_ID,
      },
    );
    expect(result).toEqual({ kind: "COMPLETED", chaosRunId: RUN_ID });
  });

  it("merchant state observed as unexpectedly PAID/FULFILLED/captured/fulfilment>0 STILL completes COMPLETED/UNKNOWN — Phase 3D never assigns invariant PASS/FAIL", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeRunningC11ARun());
    resolveC11AFailureObservationEvidenceMock.mockResolvedValue({
      kind: "RESOLVED",
      evidence: fakeC11AEvidence(),
    });
    // readC11AObservedMerchantState succeeds regardless of content — it is
    // mocked to resolve void; the service never inspects returned content
    // because the repository function itself is read-only/void-returning.
    completeRunningC11ARunWithEvidenceMock.mockResolvedValue(
      fakeRunningC11ARun({
        status: "COMPLETED",
        outcome: "UNKNOWN",
        payment_attempt_id: C11A_ATTEMPT_ID,
        payment_id: C11A_PAYMENT_ID,
        source_webhook_event_id: C11A_WEBHOOK_EVENT_ID,
        completed_at: "2026-01-01T01:00:00.000Z",
      }),
    );
    const { reconcileC11AFailedPaymentObservation } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await reconcileC11AFailedPaymentObservation(RUN_ID);
    expect(result.kind).toBe("COMPLETED");
  });

  // Architect correction round 1 (Phase 3D-E) — the durable row returned
  // from `failRunningC11ARunExecutionMock` must be the EXACT valid
  // FAILED/ERROR shape (`completed_at` set, `error_message_redacted` set,
  // matching `order_id`, etc.) for `reconcileC11AFailedPaymentObservation`
  // to ever report `FAILED` — this is exactly what
  // `isValidFailedC11AShape`/`persistAndVerifyC11ATechnicalFailure` now
  // require. This single fixture is reused by every "successfully
  // persisted" test below.
  function fakeValidFailedC11ARun(overrides: Record<string, unknown> = {}) {
    return fakeRunningC11ARun({
      status: "FAILED",
      outcome: "ERROR",
      completed_at: "2026-01-01T02:00:00.000Z",
      error_message_redacted: "safe-redacted-technical-failure-reason",
      ...overrides,
    });
  }

  describe("AMBIGUOUS evidence", () => {
    it("durably verified FAILED/ERROR -> FAILED/AMBIGUOUS_EVIDENCE, terminalizes RUNNING->FAILED/ERROR", async () => {
      getChaosRunByIdMock.mockResolvedValue(fakeRunningC11ARun());
      resolveC11AFailureObservationEvidenceMock.mockResolvedValue({
        kind: "AMBIGUOUS",
      });
      failRunningC11ARunExecutionMock.mockResolvedValue(
        fakeValidFailedC11ARun(),
      );
      const { reconcileC11AFailedPaymentObservation } =
        await import("@/lib/chaos/c11-execution-service");
      const result = await reconcileC11AFailedPaymentObservation(RUN_ID);
      expect(result).toEqual({
        kind: "FAILED",
        chaosRunId: RUN_ID,
        reasonCategory: "AMBIGUOUS_EVIDENCE",
      });
      expect(failRunningC11ARunExecutionMock).toHaveBeenCalledTimes(1);
      expect(completeRunningC11ARunWithEvidenceMock).not.toHaveBeenCalled();
    });

    it("failure persistence cannot be verified -> FAILURE_PERSISTENCE_FAILED, never claims FAILED", async () => {
      getChaosRunByIdMock.mockResolvedValue(fakeRunningC11ARun());
      resolveC11AFailureObservationEvidenceMock.mockResolvedValue({
        kind: "AMBIGUOUS",
      });
      failRunningC11ARunExecutionMock.mockResolvedValue(null);
      const { reconcileC11AFailedPaymentObservation } =
        await import("@/lib/chaos/c11-execution-service");
      const result = await reconcileC11AFailedPaymentObservation(RUN_ID);
      expect(result).toEqual({
        kind: "FAILURE_PERSISTENCE_FAILED",
        chaosRunId: RUN_ID,
      });
    });
  });

  describe("evidence resolution error (resolver throws)", () => {
    it("durably verified FAILED/ERROR -> FAILED/EVIDENCE_RESOLUTION_FAILED, never leaking the raw error", async () => {
      getChaosRunByIdMock.mockResolvedValue(fakeRunningC11ARun());
      resolveC11AFailureObservationEvidenceMock.mockRejectedValue(
        new Error("raw-postgres-detail-that-must-never-leak"),
      );
      failRunningC11ARunExecutionMock.mockResolvedValue(
        fakeValidFailedC11ARun(),
      );
      const { reconcileC11AFailedPaymentObservation } =
        await import("@/lib/chaos/c11-execution-service");
      const result = await reconcileC11AFailedPaymentObservation(RUN_ID);
      expect(result).toEqual({
        kind: "FAILED",
        chaosRunId: RUN_ID,
        reasonCategory: "EVIDENCE_RESOLUTION_FAILED",
      });
      const [, safeReason] = failRunningC11ARunExecutionMock.mock.calls[0]!;
      expect(safeReason).not.toContain(
        "raw-postgres-detail-that-must-never-leak",
      );
    });

    it("failRunningC11ARunExecution THROWS -> FAILURE_PERSISTENCE_FAILED, never a fabricated FAILED", async () => {
      getChaosRunByIdMock.mockResolvedValue(fakeRunningC11ARun());
      resolveC11AFailureObservationEvidenceMock.mockRejectedValue(
        new Error("read failed"),
      );
      failRunningC11ARunExecutionMock.mockRejectedValue(
        new Error("raw-secret-detail-from-the-fail-attempt-itself"),
      );
      const { reconcileC11AFailedPaymentObservation } =
        await import("@/lib/chaos/c11-execution-service");
      const result = await reconcileC11AFailedPaymentObservation(RUN_ID);
      expect(result).toEqual({
        kind: "FAILURE_PERSISTENCE_FAILED",
        chaosRunId: RUN_ID,
      });
    });

    it("failRunningC11ARunExecution returns null -> FAILURE_PERSISTENCE_FAILED", async () => {
      getChaosRunByIdMock.mockResolvedValue(fakeRunningC11ARun());
      resolveC11AFailureObservationEvidenceMock.mockRejectedValue(
        new Error("read failed"),
      );
      failRunningC11ARunExecutionMock.mockResolvedValue(null);
      const { reconcileC11AFailedPaymentObservation } =
        await import("@/lib/chaos/c11-execution-service");
      const result = await reconcileC11AFailedPaymentObservation(RUN_ID);
      expect(result).toEqual({
        kind: "FAILURE_PERSISTENCE_FAILED",
        chaosRunId: RUN_ID,
      });
    });

    it.each([
      ["status RUNNING / outcome null", { status: "RUNNING", outcome: null }],
      ["wrong order_id", { order_id: "some-other-order-id" }],
      ["wrong scenario_id", { scenario_id: "C07" }],
      ["wrong data_classification", { data_classification: "SYNTHETIC_DEMO" }],
      ["non-null source_webhook_event_id", { source_webhook_event_id: "x" }],
      ["null completed_at", { completed_at: null }],
      ["null error_message_redacted", { error_message_redacted: null }],
    ])(
      "failRunningC11ARunExecution returns a wrong durable shape (%s) -> FAILURE_PERSISTENCE_FAILED",
      async (_label, overrides) => {
        getChaosRunByIdMock.mockResolvedValue(fakeRunningC11ARun());
        resolveC11AFailureObservationEvidenceMock.mockRejectedValue(
          new Error("read failed"),
        );
        failRunningC11ARunExecutionMock.mockResolvedValue(
          fakeValidFailedC11ARun(overrides),
        );
        const { reconcileC11AFailedPaymentObservation } =
          await import("@/lib/chaos/c11-execution-service");
        const result = await reconcileC11AFailedPaymentObservation(RUN_ID);
        expect(result).toEqual({
          kind: "FAILURE_PERSISTENCE_FAILED",
          chaosRunId: RUN_ID,
        });
      },
    );
  });

  describe("post-state read failure", () => {
    it("durably verified FAILED/ERROR -> FAILED/POST_STATE_VERIFICATION_FAILED, never claims COMPLETED", async () => {
      getChaosRunByIdMock.mockResolvedValue(fakeRunningC11ARun());
      resolveC11AFailureObservationEvidenceMock.mockResolvedValue({
        kind: "RESOLVED",
        evidence: fakeC11AEvidence(),
      });
      readC11AObservedMerchantStateMock.mockRejectedValue(
        new Error("leaked-secret-detail"),
      );
      failRunningC11ARunExecutionMock.mockResolvedValue(
        fakeValidFailedC11ARun(),
      );
      const { reconcileC11AFailedPaymentObservation } =
        await import("@/lib/chaos/c11-execution-service");
      const result = await reconcileC11AFailedPaymentObservation(RUN_ID);
      expect(result).toEqual({
        kind: "FAILED",
        chaosRunId: RUN_ID,
        reasonCategory: "POST_STATE_VERIFICATION_FAILED",
      });
      expect(completeRunningC11ARunWithEvidenceMock).not.toHaveBeenCalled();
    });

    it("failure persistence cannot be verified -> FAILURE_PERSISTENCE_FAILED, never claims FAILED or COMPLETED", async () => {
      getChaosRunByIdMock.mockResolvedValue(fakeRunningC11ARun());
      resolveC11AFailureObservationEvidenceMock.mockResolvedValue({
        kind: "RESOLVED",
        evidence: fakeC11AEvidence(),
      });
      readC11AObservedMerchantStateMock.mockRejectedValue(
        new Error("leaked-secret-detail"),
      );
      failRunningC11ARunExecutionMock.mockRejectedValue(
        new Error("raw-persistence-error"),
      );
      const { reconcileC11AFailedPaymentObservation } =
        await import("@/lib/chaos/c11-execution-service");
      const result = await reconcileC11AFailedPaymentObservation(RUN_ID);
      expect(result).toEqual({
        kind: "FAILURE_PERSISTENCE_FAILED",
        chaosRunId: RUN_ID,
      });
      expect(completeRunningC11ARunWithEvidenceMock).not.toHaveBeenCalled();
    });
  });

  describe("technical-failure safety", () => {
    it("a raw database/Supabase error string is never forwarded into the persisted safeReason for any of the three technical-failure paths", async () => {
      getChaosRunByIdMock.mockResolvedValue(fakeRunningC11ARun());
      resolveC11AFailureObservationEvidenceMock.mockResolvedValue({
        kind: "AMBIGUOUS",
      });
      failRunningC11ARunExecutionMock.mockResolvedValue(
        fakeValidFailedC11ARun(),
      );
      const { reconcileC11AFailedPaymentObservation } =
        await import("@/lib/chaos/c11-execution-service");
      await reconcileC11AFailedPaymentObservation(RUN_ID);
      const [, safeReason] = failRunningC11ARunExecutionMock.mock.calls[0]!;
      expect(safeReason).not.toMatch(/postgres|pg_|relation|stack trace/i);
      expect(typeof safeReason).toBe("string");
    });

    it("FAILURE_PERSISTENCE_FAILED never appears alongside a FAILED-shaped result — the two kinds are mutually exclusive", async () => {
      getChaosRunByIdMock.mockResolvedValue(fakeRunningC11ARun());
      resolveC11AFailureObservationEvidenceMock.mockResolvedValue({
        kind: "AMBIGUOUS",
      });
      failRunningC11ARunExecutionMock.mockResolvedValue(null);
      const { reconcileC11AFailedPaymentObservation } =
        await import("@/lib/chaos/c11-execution-service");
      const result = await reconcileC11AFailedPaymentObservation(RUN_ID);
      expect(result.kind).toBe("FAILURE_PERSISTENCE_FAILED");
      expect(result).not.toHaveProperty("reasonCategory");
    });
  });

  it("completion persistence failure -> COMPLETION_PERSISTENCE_FAILED, never claims COMPLETED", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeRunningC11ARun());
    resolveC11AFailureObservationEvidenceMock.mockResolvedValue({
      kind: "RESOLVED",
      evidence: fakeC11AEvidence(),
    });
    completeRunningC11ARunWithEvidenceMock.mockResolvedValue(null);
    const { reconcileC11AFailedPaymentObservation } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await reconcileC11AFailedPaymentObservation(RUN_ID);
    expect(result).toEqual({
      kind: "COMPLETION_PERSISTENCE_FAILED",
      chaosRunId: RUN_ID,
    });
  });

  it("returns NOT_RECONCILABLE/RUN_NOT_FOUND when the run does not exist", async () => {
    getChaosRunByIdMock.mockResolvedValue(null);
    const { reconcileC11AFailedPaymentObservation } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await reconcileC11AFailedPaymentObservation(RUN_ID);
    expect(result).toEqual({
      kind: "NOT_RECONCILABLE",
      reasonCategory: "RUN_NOT_FOUND",
    });
  });

  it.each([
    ["status", "PENDING"],
    ["scenario_id", "C07"],
    ["fault_type", "DROP_CLIENT_CONFIRMATION"],
    ["data_classification", "SYNTHETIC_DEMO"],
    ["order_id", null],
    // A C11-B RUNNING run always has source_webhook_event_id set.
    ["source_webhook_event_id", "already-resolved-webhook-id"],
  ])(
    "returns NOT_RECONCILABLE/RUN_NOT_ELIGIBLE when %s is %s",
    async (field, value) => {
      getChaosRunByIdMock.mockResolvedValue(
        fakeRunningC11ARun({ [field]: value }),
      );
      const { reconcileC11AFailedPaymentObservation } =
        await import("@/lib/chaos/c11-execution-service");
      const result = await reconcileC11AFailedPaymentObservation(RUN_ID);
      expect(result).toEqual({
        kind: "NOT_RECONCILABLE",
        reasonCategory: "RUN_NOT_ELIGIBLE",
      });
      expect(resolveC11AFailureObservationEvidenceMock).not.toHaveBeenCalled();
    },
  );
});

describe("cancelRunningC11AObservation", () => {
  it("transitions RUNNING -> CANCELLED (FAILED/ERROR) with the fixed safe operator-cancel reason", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeRunningC11ARun());
    failRunningC11ARunExecutionMock.mockResolvedValue(
      fakeRunningC11ARun({
        status: "FAILED",
        outcome: "ERROR",
        completed_at: "2026-01-01T02:00:00.000Z",
        error_message_redacted:
          "The C11-A observation was explicitly cancelled by the operator.",
      }),
    );
    const { cancelRunningC11AObservation } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await cancelRunningC11AObservation(RUN_ID);
    expect(result).toEqual({ kind: "CANCELLED", chaosRunId: RUN_ID });
    const [, safeReason] = failRunningC11ARunExecutionMock.mock.calls[0]!;
    expect(safeReason).toBe(
      "The C11-A observation was explicitly cancelled by the operator.",
    );
  });

  it("PENDING run cannot be cancelled", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeEligiblePendingC11ARun());
    const { cancelRunningC11AObservation } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await cancelRunningC11AObservation(RUN_ID);
    expect(result).toEqual({
      kind: "NOT_CANCELLABLE",
      reasonCategory: "RUN_NOT_RUNNING",
    });
    expect(failRunningC11ARunExecutionMock).not.toHaveBeenCalled();
  });

  it("COMPLETED run cannot be cancelled", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      fakeRunningC11ARun({
        status: "COMPLETED",
        outcome: "UNKNOWN",
        source_webhook_event_id: C11A_WEBHOOK_EVENT_ID,
      }),
    );
    const { cancelRunningC11AObservation } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await cancelRunningC11AObservation(RUN_ID);
    // source_webhook_event_id non-null on a COMPLETED run fails the
    // eligibility shape check first.
    expect(result.kind).toBe("NOT_CANCELLABLE");
    expect(failRunningC11ARunExecutionMock).not.toHaveBeenCalled();
  });

  it("a C11-B run cannot be cancelled through the C11-A helper (source_webhook_event_id is non-null)", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      fakeRunningC11ARun({ source_webhook_event_id: "c11b-webhook-id" }),
    );
    const { cancelRunningC11AObservation } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await cancelRunningC11AObservation(RUN_ID);
    expect(result).toEqual({
      kind: "NOT_CANCELLABLE",
      reasonCategory: "RUN_NOT_ELIGIBLE",
    });
    expect(failRunningC11ARunExecutionMock).not.toHaveBeenCalled();
  });

  it("returns NOT_CANCELLABLE/RUN_NOT_FOUND when the run does not exist", async () => {
    getChaosRunByIdMock.mockResolvedValue(null);
    const { cancelRunningC11AObservation } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await cancelRunningC11AObservation(RUN_ID);
    expect(result).toEqual({
      kind: "NOT_CANCELLABLE",
      reasonCategory: "RUN_NOT_FOUND",
    });
  });

  it("cancellation persistence failure never claims CANCELLED", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeRunningC11ARun());
    failRunningC11ARunExecutionMock.mockResolvedValue(null);
    const { cancelRunningC11AObservation } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await cancelRunningC11AObservation(RUN_ID);
    expect(result).toEqual({
      kind: "CANCEL_PERSISTENCE_FAILED",
      chaosRunId: RUN_ID,
    });
  });

  it("cancellation persistence throwing never leaks the raw error and never claims CANCELLED", async () => {
    getChaosRunByIdMock.mockResolvedValue(fakeRunningC11ARun());
    failRunningC11ARunExecutionMock.mockRejectedValue(
      new Error("raw-secret-detail"),
    );
    const { cancelRunningC11AObservation } =
      await import("@/lib/chaos/c11-execution-service");
    const result = await cancelRunningC11AObservation(RUN_ID);
    expect(result).toEqual({
      kind: "CANCEL_PERSISTENCE_FAILED",
      chaosRunId: RUN_ID,
    });
  });
});
