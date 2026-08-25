import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 2F: `lib/events/processor.ts` exercised here against a MOCKED
// repository (no network). Real-Supabase behavior for the underlying RPC is
// separately proven by
// tests/integration/supabase/050-merchant-processing.integration.test.ts.
vi.mock("server-only", () => ({}));

const processWebhookPaymentEventMock = vi.fn();

// A minimal stand-in for EventProcessingRepositoryError, defined INSIDE the
// mock factory (vi.mock is hoisted, so it cannot reference an
// outer-scope class declared with `class X {}` at module top-level without
// the "cannot access before initialization" hazard) but exported so the
// test file below can also import and use it directly.
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

beforeEach(() => {
  processWebhookPaymentEventMock.mockReset();
});

describe("processMerchantWebhookEvent", () => {
  it("1: calls the repository with ONLY the processing-attempt id and maps a 'processed' result", async () => {
    processWebhookPaymentEventMock.mockResolvedValue({
      outcome: "processed",
      eventType: "payment.captured",
      orderId: "order-1",
      paymentId: "payment-1",
      fulfilmentId: "fulfilment-1",
    });

    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    const result = await processMerchantWebhookEvent("attempt-1");

    expect(processWebhookPaymentEventMock).toHaveBeenCalledTimes(1);
    expect(processWebhookPaymentEventMock).toHaveBeenCalledWith("attempt-1");
    expect(result).toEqual({
      outcome: "processed",
      eventType: "payment.captured",
      orderId: "order-1",
      paymentId: "payment-1",
      fulfilmentId: "fulfilment-1",
    });
  });

  it("2: maps an 'already_processed' result idempotently", async () => {
    processWebhookPaymentEventMock.mockResolvedValue({
      outcome: "already_processed",
      eventType: "payment.captured",
      orderId: "order-1",
      paymentId: "payment-1",
      fulfilmentId: "fulfilment-1",
    });

    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    const result = await processMerchantWebhookEvent("attempt-1");
    expect(result.outcome).toBe("already_processed");
  });

  it("3: a nullable payment/fulfilment id (order.paid, or failure-only) passes through as null", async () => {
    processWebhookPaymentEventMock.mockResolvedValue({
      outcome: "processed",
      eventType: "order.paid",
      orderId: "order-1",
      paymentId: null,
      fulfilmentId: null,
    });

    const { processMerchantWebhookEvent } =
      await import("@/lib/events/processor");
    const result = await processMerchantWebhookEvent("attempt-1");
    expect(result.paymentId).toBeNull();
    expect(result.fulfilmentId).toBeNull();
  });

  it("4: a repository error with a known code maps to MerchantProcessingError carrying the SAME code", async () => {
    const { EventProcessingRepositoryError } =
      await import("@/lib/webhooks/event-processing-repository");
    processWebhookPaymentEventMock.mockRejectedValue(
      new EventProcessingRepositoryError(
        "PROCESSING_AMOUNT_MISMATCH",
        "Merchant processing failed (PROCESSING_AMOUNT_MISMATCH).",
      ),
    );

    const { processMerchantWebhookEvent, MerchantProcessingError } =
      await import("@/lib/events/processor");

    try {
      await processMerchantWebhookEvent("attempt-1");
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MerchantProcessingError);
      expect((err as InstanceType<typeof MerchantProcessingError>).code).toBe(
        "PROCESSING_AMOUNT_MISMATCH",
      );
    }
  });

  it("5: an unknown/unexpected error maps to PROCESSING_TRANSACTION_FAILED, never leaking the raw error", async () => {
    processWebhookPaymentEventMock.mockRejectedValue(
      new Error("connection string leaked here"),
    );

    const { processMerchantWebhookEvent, MerchantProcessingError } =
      await import("@/lib/events/processor");

    try {
      await processMerchantWebhookEvent("attempt-1");
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MerchantProcessingError);
      const merchantErr = err as InstanceType<typeof MerchantProcessingError>;
      expect(merchantErr.code).toBe("PROCESSING_TRANSACTION_FAILED");
      expect(merchantErr.message).not.toContain("connection string");
    }
  });

  it("6: every MerchantProcessingError message is a fixed safe string, never the raw repository error message", async () => {
    const { EventProcessingRepositoryError } =
      await import("@/lib/webhooks/event-processing-repository");
    processWebhookPaymentEventMock.mockRejectedValue(
      new EventProcessingRepositoryError(
        "PROCESSING_FULFILMENT_CONFLICT",
        "raw detail: fulfilment abc123 conflicts with payment xyz789",
      ),
    );

    const { processMerchantWebhookEvent, MerchantProcessingError } =
      await import("@/lib/events/processor");

    try {
      await processMerchantWebhookEvent("attempt-1");
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MerchantProcessingError);
      expect((err as Error).message).not.toContain("abc123");
      expect((err as Error).message).not.toContain("xyz789");
    }
  });

  it("7: an unrecognized repository code string still maps to PROCESSING_TRANSACTION_FAILED (defensive)", async () => {
    const { EventProcessingRepositoryError } =
      await import("@/lib/webhooks/event-processing-repository");
    processWebhookPaymentEventMock.mockRejectedValue(
      new EventProcessingRepositoryError(
        "SOME_UNKNOWN_FUTURE_CODE",
        "unexpected",
      ),
    );

    const { processMerchantWebhookEvent, MerchantProcessingError } =
      await import("@/lib/events/processor");

    try {
      await processMerchantWebhookEvent("attempt-1");
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MerchantProcessingError);
      expect((err as InstanceType<typeof MerchantProcessingError>).code).toBe(
        "PROCESSING_TRANSACTION_FAILED",
      );
    }
  });
});

describe("lib/events/processor.ts — structural guarantees", () => {
  it("8: is server-only", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../lib/events/processor.ts"),
      "utf-8",
    );
    expect(source).toMatch(/^import\s+["']server-only["'];/m);
  });

  it("9: never imports razorpay/webhook raw-body or signature modules — cannot accept a raw webhook body as input", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../lib/events/processor.ts"),
      "utf-8",
    );
    expect(source).not.toMatch(/razorpay\/webhook-verification/);
    expect(source).not.toMatch(/rawBody/);
  });

  it("10: never imports an AI/LLM/ML module", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../lib/events/processor.ts"),
      "utf-8",
    );
    expect(source).not.toMatch(/openai|anthropic|ollama|langchain/i);
  });

  it("11: the exported function's only parameter is a processing-attempt id string (browser/request values cannot set desired payment status)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../lib/events/processor.ts"),
      "utf-8",
    );
    const fnMatch = source.match(
      /export async function processMerchantWebhookEvent\(([^)]*)\)/,
    );
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]!.trim().replace(/,$/, "")).toBe(
      "processingAttemptId: string",
    );
  });
});
