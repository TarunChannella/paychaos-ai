import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 3E-A — proves the evidence-snapshot instrumentation added to
 * `lib/events/processor.ts` around the EXISTING, unmodified merchant
 * processing call.
 *
 * Both the evidence repository and the event-processing repository are
 * mocked (no network). The central claim under test is a safety property,
 * not a feature: snapshot capture must be completely unable to change what
 * merchant processing does, what it returns, or what it throws.
 *
 * The frozen Phase 2F behavior of `processMerchantWebhookEvent` itself
 * (result mapping, error-code mapping, safe messages, structural guarantees)
 * remains covered by tests/unit/events/processor.test.ts — that file is not
 * weakened here, only isolated from the new module.
 */
vi.mock("server-only", () => ({}));

/** Ordered log of every instrumented/processing call, used to prove sequencing. */
const callLog: string[] = [];

const processWebhookPaymentEventMock = vi.fn();
const captureSnapshotMock = vi.fn();
const eligibilityMock = vi.fn();
const persistBeforeMock = vi.fn();
const persistAfterMock = vi.fn();
const logEventMock = vi.fn();

vi.mock("@/lib/webhooks/event-processing-repository", () => {
  class EventProcessingRepositoryError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = "EventProcessingRepositoryError";
      this.code = code;
    }
  }
  return {
    EventProcessingRepositoryError,
    processWebhookPaymentEvent: processWebhookPaymentEventMock,
  };
});

vi.mock("@/lib/evidence/evidence-repository", () => {
  class EvidenceRepositoryError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = "EvidenceRepositoryError";
      this.code = code;
    }
  }
  return {
    EvidenceRepositoryError,
    captureMerchantStateSnapshotForProcessingAttempt: captureSnapshotMock,
    getProcessingSnapshotEligibility: eligibilityMock,
    persistProcessingStateBefore: persistBeforeMock,
    persistProcessingStateAfter: persistAfterMock,
  };
});

vi.mock("@/lib/security/logger", () => ({
  logEvent: logEventMock,
}));

const ATTEMPT_ID = "44444444-4444-4444-4444-444444444444";

const SNAPSHOT = {
  version: 1 as const,
  order: null,
  paymentAttempt: null,
  payment: null,
  fulfilments: null,
};

const SUCCESS_RESULT = {
  outcome: "processed" as const,
  eventType: "payment.captured",
  orderId: "order-1",
  paymentId: "payment-1",
  fulfilmentId: "fulfilment-1",
};

function useHappyPath(): void {
  eligibilityMock.mockImplementation(async () => {
    callLog.push("eligibility");
    return { kind: "ELIGIBLE_PENDING", status: "PENDING" };
  });
  captureSnapshotMock.mockImplementation(async () => {
    callLog.push("capture");
    return SNAPSHOT;
  });
  persistBeforeMock.mockImplementation(async () => {
    callLog.push("persist-before");
    return { outcome: "CAPTURED", snapshot: { version: 1 } };
  });
  persistAfterMock.mockImplementation(async () => {
    callLog.push("persist-after");
    return { outcome: "CAPTURED", snapshot: { version: 1 } };
  });
  processWebhookPaymentEventMock.mockImplementation(async () => {
    callLog.push("process");
    return SUCCESS_RESULT;
  });
}

beforeEach(() => {
  callLog.length = 0;
  processWebhookPaymentEventMock.mockReset();
  captureSnapshotMock.mockReset();
  eligibilityMock.mockReset();
  persistBeforeMock.mockReset();
  persistAfterMock.mockReset();
  logEventMock.mockReset();
});

describe("A — successful processing", () => {
  it("1: captures BEFORE once, calls the existing processor once, captures AFTER once", async () => {
    useHappyPath();
    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");

    const result = await processMerchantWebhookEvent(ATTEMPT_ID);

    expect(captureSnapshotMock).toHaveBeenCalledTimes(2);
    expect(persistBeforeMock).toHaveBeenCalledTimes(1);
    expect(processWebhookPaymentEventMock).toHaveBeenCalledTimes(1);
    expect(persistAfterMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(SUCCESS_RESULT);
  });

  it("2: the BEFORE snapshot is persisted BEFORE the processor runs, and the AFTER snapshot only once it has returned", async () => {
    useHappyPath();
    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    await processMerchantWebhookEvent(ATTEMPT_ID);

    expect(callLog).toEqual([
      "eligibility",
      "capture",
      "persist-before",
      "process",
      "capture",
      "persist-after",
    ]);
  });

  it("3: every snapshot call is scoped to the SAME internal processing-attempt id and nothing else", async () => {
    useHappyPath();
    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    await processMerchantWebhookEvent(ATTEMPT_ID);

    expect(captureSnapshotMock).toHaveBeenNthCalledWith(1, ATTEMPT_ID);
    expect(captureSnapshotMock).toHaveBeenNthCalledWith(2, ATTEMPT_ID);
    expect(persistBeforeMock).toHaveBeenCalledWith(ATTEMPT_ID, SNAPSHOT);
    expect(persistAfterMock).toHaveBeenCalledWith(ATTEMPT_ID, SNAPSHOT);
  });

  it("4: an ALREADY_CAPTURED outcome is a normal result — no error, no log, processing unchanged", async () => {
    useHappyPath();
    persistBeforeMock.mockResolvedValue({
      outcome: "ALREADY_CAPTURED",
      snapshot: { version: 1, note: "historical" },
    });
    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");

    const result = await processMerchantWebhookEvent(ATTEMPT_ID);
    expect(result).toEqual(SUCCESS_RESULT);
    expect(logEventMock).not.toHaveBeenCalled();
  });

  it("5: an ATTEMPT_NOT_FOUND persistence outcome is logged as a NON-capture and never treated as a captured snapshot", async () => {
    useHappyPath();
    persistBeforeMock.mockResolvedValue({
      outcome: "ATTEMPT_NOT_FOUND",
      snapshot: null,
    });
    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");

    const result = await processMerchantWebhookEvent(ATTEMPT_ID);
    expect(result).toEqual(SUCCESS_RESULT);
    expect(logEventMock).toHaveBeenCalledWith(
      "evidence_snapshot_not_captured",
      expect.objectContaining({
        processing_attempt_id: ATTEMPT_ID,
        snapshot_phase: "before",
        reason: "ATTEMPT_NOT_FOUND",
      }),
    );
  });
});

describe("B — the existing processor fails", () => {
  it("6: the processing error semantics are unchanged (same MerchantProcessingError code)", async () => {
    useHappyPath();
    const { EventProcessingRepositoryError } =
      await import("@/lib/webhooks/event-processing-repository");
    processWebhookPaymentEventMock.mockImplementation(async () => {
      callLog.push("process");
      throw new EventProcessingRepositoryError(
        "PROCESSING_AMOUNT_MISMATCH",
        "raw detail",
      );
    });

    const { processMerchantWebhookEvent, MerchantProcessingError } =
      await import("@/lib/events/processor");

    await expect(
      processMerchantWebhookEvent(ATTEMPT_ID),
    ).rejects.toBeInstanceOf(MerchantProcessingError);

    try {
      await processMerchantWebhookEvent(ATTEMPT_ID);
      throw new Error("expected to throw");
    } catch (err) {
      expect((err as InstanceType<typeof MerchantProcessingError>).code).toBe(
        "PROCESSING_AMOUNT_MISMATCH",
      );
      expect((err as Error).message).not.toContain("raw detail");
    }
  });

  it("7: an AFTER snapshot is still attempted around the failure (INV-009 evidence), and never converts the failure into a success", async () => {
    useHappyPath();
    processWebhookPaymentEventMock.mockImplementation(async () => {
      callLog.push("process");
      throw new Error("boom");
    });

    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");

    await expect(
      processMerchantWebhookEvent(ATTEMPT_ID),
    ).rejects.toBeInstanceOf(Error);

    expect(callLog).toEqual([
      "eligibility",
      "capture",
      "persist-before",
      "process",
      "capture",
      "persist-after",
    ]);
    expect(persistAfterMock).toHaveBeenCalledTimes(1);
  });

  it("8: an unknown thrown value still maps to PROCESSING_TRANSACTION_FAILED with the snapshot instrumentation in place", async () => {
    useHappyPath();
    processWebhookPaymentEventMock.mockRejectedValue(
      new Error("connection string leaked here"),
    );

    const { processMerchantWebhookEvent, MerchantProcessingError } =
      await import("@/lib/events/processor");

    try {
      await processMerchantWebhookEvent(ATTEMPT_ID);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MerchantProcessingError);
      const merchantErr = err as InstanceType<typeof MerchantProcessingError>;
      expect(merchantErr.code).toBe("PROCESSING_TRANSACTION_FAILED");
      expect(merchantErr.message).not.toContain("connection string");
    }
  });
});

describe("C — BEFORE snapshot capture fails", () => {
  it("9: a capture read failure does not stop or alter merchant processing", async () => {
    useHappyPath();
    captureSnapshotMock.mockImplementationOnce(async () => {
      callLog.push("capture-failed");
      throw new Error("EVIDENCE_PROCESSING_ATTEMPT_LOOKUP_FAILED");
    });

    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    const result = await processMerchantWebhookEvent(ATTEMPT_ID);

    expect(result).toEqual(SUCCESS_RESULT);
    expect(processWebhookPaymentEventMock).toHaveBeenCalledTimes(1);
    expect(processWebhookPaymentEventMock).toHaveBeenCalledWith(ATTEMPT_ID);
  });

  it("10: no snapshot is claimed when capture failed — persistBefore is never called, and the failure is logged safely", async () => {
    useHappyPath();
    captureSnapshotMock.mockImplementationOnce(async () => {
      throw new Error("capture blew up");
    });

    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    await processMerchantWebhookEvent(ATTEMPT_ID);

    expect(persistBeforeMock).not.toHaveBeenCalled();
    expect(logEventMock).toHaveBeenCalledWith(
      "evidence_snapshot_capture_failed",
      expect.objectContaining({
        processing_attempt_id: ATTEMPT_ID,
        snapshot_phase: "before",
        error_name: "Error",
      }),
    );
    // The safe log never carries the raw error message.
    const loggedFields = logEventMock.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(loggedFields)).not.toContain("capture blew up");
  });

  it("11: a BEFORE persistence failure likewise cannot change processing, and never fakes a snapshot", async () => {
    useHappyPath();
    persistBeforeMock.mockImplementation(async () => {
      throw new Error("write failed");
    });

    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    const result = await processMerchantWebhookEvent(ATTEMPT_ID);

    expect(result).toEqual(SUCCESS_RESULT);
    expect(processWebhookPaymentEventMock).toHaveBeenCalledTimes(1);
    expect(logEventMock).toHaveBeenCalledWith(
      "evidence_snapshot_capture_failed",
      expect.objectContaining({ snapshot_phase: "before" }),
    );
  });
});

describe("D — AFTER snapshot capture fails", () => {
  it("12: processor success remains processor success", async () => {
    useHappyPath();
    persistAfterMock.mockImplementation(async () => {
      throw new Error("after write failed");
    });

    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    const result = await processMerchantWebhookEvent(ATTEMPT_ID);

    expect(result).toEqual(SUCCESS_RESULT);
  });

  it("13: snapshot absence stays observable — the failure is logged for the 'after' phase and nothing claims a captured snapshot", async () => {
    useHappyPath();
    captureSnapshotMock.mockImplementationOnce(async () => SNAPSHOT);
    captureSnapshotMock.mockImplementationOnce(async () => {
      throw new Error("post-state read failed");
    });

    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    await processMerchantWebhookEvent(ATTEMPT_ID);

    expect(persistAfterMock).not.toHaveBeenCalled();
    expect(logEventMock).toHaveBeenCalledWith(
      "evidence_snapshot_capture_failed",
      expect.objectContaining({ snapshot_phase: "after" }),
    );
  });

  it("14: a processor FAILURE plus an AFTER capture failure still rethrows the original processing error, never a snapshot error", async () => {
    useHappyPath();
    processWebhookPaymentEventMock.mockRejectedValue(new Error("boom"));
    captureSnapshotMock.mockImplementationOnce(async () => SNAPSHOT);
    captureSnapshotMock.mockImplementationOnce(async () => {
      throw new Error("post-state read failed");
    });

    const { processMerchantWebhookEvent, MerchantProcessingError } =
      await import("@/lib/events/processor");

    try {
      await processMerchantWebhookEvent(ATTEMPT_ID);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MerchantProcessingError);
      expect((err as InstanceType<typeof MerchantProcessingError>).code).toBe(
        "PROCESSING_TRANSACTION_FAILED",
      );
    }
  });
});

describe("E — replay compatibility", () => {
  it("15: a replayed attempt uses the exact same single processing path — one processor call per invocation, no extra attempt is created here", async () => {
    useHappyPath();
    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");

    await processMerchantWebhookEvent("replay-attempt-1");
    await processMerchantWebhookEvent("replay-attempt-2");

    expect(processWebhookPaymentEventMock).toHaveBeenCalledTimes(2);
    expect(processWebhookPaymentEventMock).toHaveBeenNthCalledWith(
      1,
      "replay-attempt-1",
    );
    expect(processWebhookPaymentEventMock).toHaveBeenNthCalledWith(
      2,
      "replay-attempt-2",
    );
    // Exactly one before + one after snapshot per replayed attempt — the
    // instrumentation never multiplies attempts or re-runs the processor.
    expect(persistBeforeMock).toHaveBeenCalledTimes(2);
    expect(persistAfterMock).toHaveBeenCalledTimes(2);
  });

  it("16: the snapshot instrumentation never inspects or alters provenance — it receives only an attempt id", async () => {
    useHappyPath();
    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    await processMerchantWebhookEvent(ATTEMPT_ID);

    for (const call of captureSnapshotMock.mock.calls) {
      expect(call).toEqual([ATTEMPT_ID]);
    }
  });
});

describe("F — the existing processor's call arguments are unchanged", () => {
  it("17: processWebhookPaymentEvent is still called with EXACTLY one argument, the processing-attempt id", async () => {
    useHappyPath();
    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    await processMerchantWebhookEvent(ATTEMPT_ID);

    expect(processWebhookPaymentEventMock.mock.calls).toHaveLength(1);
    expect(processWebhookPaymentEventMock.mock.calls[0]).toEqual([ATTEMPT_ID]);
  });

  it("18: the public signature still takes exactly one parameter", async () => {
    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    expect(processMerchantWebhookEvent.length).toBe(1);
  });

  it("19: the returned result object is the processor's own result, field for field — the snapshot never contributes to it", async () => {
    useHappyPath();
    processWebhookPaymentEventMock.mockResolvedValue({
      outcome: "already_processed",
      eventType: "order.paid",
      orderId: "order-9",
      paymentId: null,
      fulfilmentId: null,
    });

    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    const result = await processMerchantWebhookEvent(ATTEMPT_ID);

    expect(result).toEqual({
      outcome: "already_processed",
      eventType: "order.paid",
      orderId: "order-9",
      paymentId: null,
      fulfilmentId: null,
    });
    expect(Object.keys(result).sort()).toEqual([
      "eventType",
      "fulfilmentId",
      "orderId",
      "outcome",
      "paymentId",
    ]);
  });
});

/**
 * ============================================================================
 * G — NO HISTORICAL BACKFILL (Phase 3E-A architect correction)
 * ============================================================================
 *
 * The blocking defect: set-once stops an OVERWRITE but not a LATE FIRST WRITE.
 * Because the frozen processor is idempotent on re-entry, calling it on an
 * attempt that succeeded yesterday would otherwise capture TODAY's merchant
 * state into a still-NULL `state_before` and present it as evidence about
 * yesterday. Every pre-Phase-3E row is NULL precisely because the migration
 * refuses to backfill, so these tests pin the gate that keeps that promise.
 */
describe("G — historical/terminal attempts are never backfilled", () => {
  /** Makes the attempt look terminal to the eligibility gate. */
  function useTerminal(status: string): void {
    useHappyPath();
    eligibilityMock.mockImplementation(async () => {
      callLog.push("eligibility");
      return { kind: "NOT_ELIGIBLE_TERMINAL", status };
    });
  }

  it("20: SUCCEEDED with a NULL state_before — calling the processor does NOT persist a 'before' snapshot (blocker test 1)", async () => {
    useTerminal("SUCCEEDED");
    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");

    await processMerchantWebhookEvent(ATTEMPT_ID);

    expect(captureSnapshotMock).not.toHaveBeenCalled();
    expect(persistBeforeMock).not.toHaveBeenCalled();
  });

  it("21: an already_processed result never triggers an AFTER capture, even for an otherwise eligible invocation (blocker test 2)", async () => {
    useHappyPath();
    processWebhookPaymentEventMock.mockImplementation(async () => {
      callLog.push("process");
      return { ...SUCCESS_RESULT, outcome: "already_processed" as const };
    });

    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    const result = await processMerchantWebhookEvent(ATTEMPT_ID);

    expect(result.outcome).toBe("already_processed");
    expect(persistAfterMock).not.toHaveBeenCalled();
    expect(logEventMock).toHaveBeenCalledWith(
      "evidence_snapshot_skipped",
      expect.objectContaining({
        snapshot_phase: "after",
        reason: "ALREADY_PROCESSED_REENTRY",
      }),
    );
  });

  it("22: a historical SUCCEEDED attempt with BOTH snapshots null is left completely uncaptured by a full idempotent re-entry (blocker test 3)", async () => {
    useTerminal("SUCCEEDED");
    processWebhookPaymentEventMock.mockImplementation(async () => {
      callLog.push("process");
      return { ...SUCCESS_RESULT, outcome: "already_processed" as const };
    });

    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    const result = await processMerchantWebhookEvent(ATTEMPT_ID);

    // The frozen processor still ran and stayed idempotent...
    expect(result.outcome).toBe("already_processed");
    expect(processWebhookPaymentEventMock).toHaveBeenCalledTimes(1);
    // ...and NOTHING was captured or persisted, in either phase.
    expect(captureSnapshotMock).not.toHaveBeenCalled();
    expect(persistBeforeMock).not.toHaveBeenCalled();
    expect(persistAfterMock).not.toHaveBeenCalled();
    expect(callLog).toEqual(["eligibility", "process"]);
  });

  it.each([["FAILED"], ["HELD"], ["SKIPPED_DUPLICATE"], ["PROCESSING"]])(
    "23: a %s attempt gets NO late before and NO late after (blocker test 4)",
    async (status) => {
      useTerminal(status);
      const { EventProcessingRepositoryError } =
        await import("@/lib/webhooks/event-processing-repository");
      processWebhookPaymentEventMock.mockImplementation(async () => {
        callLog.push("process");
        throw new EventProcessingRepositoryError(
          "PROCESSING_ATTEMPT_NOT_READY",
          "raw detail",
        );
      });

      const { processMerchantWebhookEvent, MerchantProcessingError } =
        await import("@/lib/events/processor");

      await expect(
        processMerchantWebhookEvent(ATTEMPT_ID),
      ).rejects.toBeInstanceOf(MerchantProcessingError);

      expect(persistBeforeMock).not.toHaveBeenCalled();
      expect(persistAfterMock).not.toHaveBeenCalled();
    },
  );

  it("24: even for an ELIGIBLE invocation, a PROCESSING_ATTEMPT_NOT_READY failure never produces a late AFTER snapshot", async () => {
    useHappyPath();
    const { EventProcessingRepositoryError } =
      await import("@/lib/webhooks/event-processing-repository");
    processWebhookPaymentEventMock.mockImplementation(async () => {
      callLog.push("process");
      throw new EventProcessingRepositoryError(
        "PROCESSING_ATTEMPT_NOT_READY",
        "raw detail",
      );
    });

    const { processMerchantWebhookEvent, MerchantProcessingError } =
      await import("@/lib/events/processor");

    try {
      await processMerchantWebhookEvent(ATTEMPT_ID);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MerchantProcessingError);
      // The error returned to existing callers is unchanged.
      expect((err as InstanceType<typeof MerchantProcessingError>).code).toBe(
        "PROCESSING_ATTEMPT_NOT_READY",
      );
    }

    expect(persistAfterMock).not.toHaveBeenCalled();
    expect(logEventMock).toHaveBeenCalledWith(
      "evidence_snapshot_skipped",
      expect.objectContaining({
        snapshot_phase: "after",
        reason: "PROCESSING_ATTEMPT_NOT_READY",
      }),
    );
  });

  it("25: an eligibility-lookup failure means NO snapshots are claimed, while merchant processing still executes exactly once (blocker test 5)", async () => {
    useHappyPath();
    eligibilityMock.mockImplementation(async () => {
      callLog.push("eligibility");
      return { kind: "READ_FAILED" };
    });

    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    const result = await processMerchantWebhookEvent(ATTEMPT_ID);

    expect(result).toEqual(SUCCESS_RESULT);
    expect(processWebhookPaymentEventMock).toHaveBeenCalledTimes(1);
    expect(processWebhookPaymentEventMock).toHaveBeenCalledWith(ATTEMPT_ID);
    expect(captureSnapshotMock).not.toHaveBeenCalled();
    expect(persistBeforeMock).not.toHaveBeenCalled();
    expect(persistAfterMock).not.toHaveBeenCalled();
    expect(logEventMock).toHaveBeenCalledWith(
      "evidence_snapshot_skipped",
      expect.objectContaining({
        processing_attempt_id: ATTEMPT_ID,
        reason: "READ_FAILED",
      }),
    );
  });

  it("26: an eligibility read that THROWS is also treated as ineligible, safely logged, and never blocks merchant processing", async () => {
    useHappyPath();
    eligibilityMock.mockImplementation(async () => {
      throw new Error("eligibility infra blew up");
    });

    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    const result = await processMerchantWebhookEvent(ATTEMPT_ID);

    expect(result).toEqual(SUCCESS_RESULT);
    expect(persistBeforeMock).not.toHaveBeenCalled();
    expect(persistAfterMock).not.toHaveBeenCalled();
    expect(logEventMock).toHaveBeenCalledWith(
      "evidence_snapshot_capture_failed",
      expect.objectContaining({
        snapshot_phase: "eligibility",
        error_name: "Error",
      }),
    );
    expect(JSON.stringify(logEventMock.mock.calls)).not.toContain(
      "eligibility infra blew up",
    );
  });

  it("27: an ATTEMPT_NOT_FOUND eligibility result captures nothing", async () => {
    useHappyPath();
    eligibilityMock.mockImplementation(async () => ({
      kind: "ATTEMPT_NOT_FOUND",
    }));

    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    await processMerchantWebhookEvent(ATTEMPT_ID);

    expect(captureSnapshotMock).not.toHaveBeenCalled();
    expect(persistBeforeMock).not.toHaveBeenCalled();
    expect(persistAfterMock).not.toHaveBeenCalled();
  });

  it("28: a BEFORE capture failure does NOT disable the AFTER snapshot for the same genuine eligible invocation — eligibility, not 'before persisted successfully', is the governing condition (blocker test 6)", async () => {
    useHappyPath();
    captureSnapshotMock.mockImplementationOnce(async () => {
      callLog.push("capture-before-failed");
      throw new Error("before capture blew up");
    });

    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    const result = await processMerchantWebhookEvent(ATTEMPT_ID);

    expect(result).toEqual(SUCCESS_RESULT);
    expect(processWebhookPaymentEventMock).toHaveBeenCalledTimes(1);
    expect(persistBeforeMock).not.toHaveBeenCalled();
    // The AFTER snapshot still happens — this is the whole point.
    expect(persistAfterMock).toHaveBeenCalledTimes(1);
  });

  it("29: a NOT_ELIGIBLE persistence outcome is logged as a NON-capture and never treated as captured (blocker test 7, processor side)", async () => {
    useHappyPath();
    persistBeforeMock.mockResolvedValue({
      outcome: "NOT_ELIGIBLE",
      snapshot: null,
    });

    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    const result = await processMerchantWebhookEvent(ATTEMPT_ID);

    expect(result).toEqual(SUCCESS_RESULT);
    expect(logEventMock).toHaveBeenCalledWith(
      "evidence_snapshot_not_captured",
      expect.objectContaining({
        snapshot_phase: "before",
        reason: "NOT_ELIGIBLE",
      }),
    );
  });

  it("30: a PENDING attempt whose state_before already exists still processes normally, and the AFTER snapshot is still taken (blocker test 8)", async () => {
    useHappyPath();
    persistBeforeMock.mockResolvedValue({
      outcome: "ALREADY_CAPTURED",
      snapshot: {
        version: 1,
        note: "earlier-caller-crashed-before-processing",
      },
    });

    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    const result = await processMerchantWebhookEvent(ATTEMPT_ID);

    expect(result).toEqual(SUCCESS_RESULT);
    expect(processWebhookPaymentEventMock).toHaveBeenCalledTimes(1);
    expect(persistAfterMock).toHaveBeenCalledTimes(1);
  });

  it("31: the eligibility gate is resolved ONCE per invocation, before the processor, and is scoped to the attempt id alone", async () => {
    useHappyPath();
    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    await processMerchantWebhookEvent(ATTEMPT_ID);

    expect(eligibilityMock).toHaveBeenCalledTimes(1);
    expect(eligibilityMock).toHaveBeenCalledWith(ATTEMPT_ID);
    expect(callLog.indexOf("eligibility")).toBeLessThan(
      callLog.indexOf("process"),
    );
    expect(callLog.indexOf("eligibility")).toBe(0);
  });
});
