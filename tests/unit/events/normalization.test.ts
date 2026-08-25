import { describe, expect, it } from "vitest";

import { normalizeRazorpayEvent } from "@/lib/events/normalization";

// Phase 2E: pure functions, no I/O, no server-only marker — fully offline.
// All IDs here are fake, Razorpay-shaped placeholders — never real.

const RAZORPAY_EVENT_ID = "evt_fake_id_123";
const PROVIDER_CREATED_AT = "2026-08-27T00:00:00.000Z";

function baseInput(
  eventType: string,
  safeEvidence: Record<string, unknown>,
): Parameters<typeof normalizeRazorpayEvent>[0] {
  return {
    razorpayEventId: RAZORPAY_EVENT_ID,
    eventType,
    providerCreatedAt: PROVIDER_CREATED_AT,
    safeEvidence,
  };
}

function fakePaymentEvidence(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "pay_fake_id",
    order_id: "order_fake_id",
    amount: 50000,
    currency: "INR",
    status: "captured",
    ...overrides,
  };
}

function fakeOrderEvidence(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "order_fake_id",
    amount: 50000,
    currency: "INR",
    status: "paid",
    ...overrides,
  };
}

describe("normalizeRazorpayEvent", () => {
  // 1. payment.captured valid payload normalizes
  it("normalizes a valid payment.captured payload", () => {
    const result = normalizeRazorpayEvent(
      baseInput("payment.captured", { payment: fakePaymentEvidence() }),
    );
    expect(result.outcome).toBe("normalized");
    if (result.outcome !== "normalized") throw new Error("expected normalized");
    expect(result.event).toEqual({
      schemaVersion: 1,
      sourceKind: "REAL_RAZORPAY_WEBHOOK",
      razorpayEventId: RAZORPAY_EVENT_ID,
      eventType: "payment.captured",
      providerCreatedAt: PROVIDER_CREATED_AT,
      kind: "payment.captured",
      razorpayOrderId: "order_fake_id",
      razorpayPaymentId: "pay_fake_id",
      amountSubunits: 50000,
      currency: "INR",
      razorpayPaymentStatus: "captured",
    });
  });

  // 2. payment.failed valid payload normalizes
  it("normalizes a valid payment.failed payload, including safe error fields", () => {
    const result = normalizeRazorpayEvent(
      baseInput("payment.failed", {
        payment: fakePaymentEvidence({
          status: "failed",
          error_code: "BAD_REQUEST_ERROR",
          error_source: "customer",
          error_step: "payment_authentication",
          error_reason: "payment_failed",
        }),
      }),
    );
    expect(result.outcome).toBe("normalized");
    if (result.outcome !== "normalized") throw new Error("expected normalized");
    expect(result.event).toMatchObject({
      kind: "payment.failed",
      razorpayPaymentStatus: "failed",
      errorCode: "BAD_REQUEST_ERROR",
      errorSource: "customer",
      errorStep: "payment_authentication",
      errorReason: "payment_failed",
    });
  });

  // 3. order.paid valid payload normalizes
  it("normalizes a valid order.paid payload", () => {
    const result = normalizeRazorpayEvent(
      baseInput("order.paid", { order: fakeOrderEvidence() }),
    );
    expect(result.outcome).toBe("normalized");
    if (result.outcome !== "normalized") throw new Error("expected normalized");
    expect(result.event).toEqual({
      schemaVersion: 1,
      sourceKind: "REAL_RAZORPAY_WEBHOOK",
      razorpayEventId: RAZORPAY_EVENT_ID,
      eventType: "order.paid",
      providerCreatedAt: PROVIDER_CREATED_AT,
      kind: "order.paid",
      razorpayOrderId: "order_fake_id",
      razorpayPaymentId: null,
      amountSubunits: 50000,
      currency: "INR",
    });
  });

  // 4. payment.captured missing payment.id fails
  it("rejects payment.captured with missing payment.id", () => {
    const evidence = fakePaymentEvidence();
    delete evidence.id;
    const result = normalizeRazorpayEvent(
      baseInput("payment.captured", { payment: evidence }),
    );
    expect(result.outcome).toBe("invalid");
  });

  // 5. missing order_id fails for payment event
  it("rejects payment.captured with missing payment.order_id", () => {
    const evidence = fakePaymentEvidence();
    delete evidence.order_id;
    const result = normalizeRazorpayEvent(
      baseInput("payment.captured", { payment: evidence }),
    );
    expect(result.outcome).toBe("invalid");
  });

  // 6. invalid/zero/negative amount fails
  it("rejects zero and negative payment.amount", () => {
    for (const amount of [0, -1, -50000]) {
      const result = normalizeRazorpayEvent(
        baseInput("payment.captured", {
          payment: fakePaymentEvidence({ amount }),
        }),
      );
      expect(result.outcome).toBe("invalid");
    }
  });

  // 7. non-integer amount fails
  it("rejects a non-integer (float) payment.amount", () => {
    const result = normalizeRazorpayEvent(
      baseInput("payment.captured", {
        payment: fakePaymentEvidence({ amount: 500.5 }),
      }),
    );
    expect(result.outcome).toBe("invalid");
  });

  // 8. unsafe integer amount fails
  it("rejects an unsafe integer payment.amount (beyond Number.MAX_SAFE_INTEGER)", () => {
    const result = normalizeRazorpayEvent(
      baseInput("payment.captured", {
        payment: fakePaymentEvidence({
          amount: Number.MAX_SAFE_INTEGER + 10,
        }),
      }),
    );
    expect(result.outcome).toBe("invalid");
  });

  // 9. lowercase/invalid currency fails
  it("rejects a lowercase or malformed currency", () => {
    for (const currency of ["inr", "IN", "INRR", "123"]) {
      const result = normalizeRazorpayEvent(
        baseInput("payment.captured", {
          payment: fakePaymentEvidence({ currency }),
        }),
      );
      expect(result.outcome).toBe("invalid");
    }
  });

  // 10. payment.captured with non-captured status fails
  it("rejects payment.captured whose status is not 'captured'", () => {
    const result = normalizeRazorpayEvent(
      baseInput("payment.captured", {
        payment: fakePaymentEvidence({ status: "authorized" }),
      }),
    );
    expect(result.outcome).toBe("invalid");
  });

  // 11. payment.failed with non-failed status fails
  it("rejects payment.failed whose status is not 'failed'", () => {
    const result = normalizeRazorpayEvent(
      baseInput("payment.failed", {
        payment: fakePaymentEvidence({ status: "captured" }),
      }),
    );
    expect(result.outcome).toBe("invalid");
  });

  // 12. order.paid with non-paid order status fails
  it("rejects order.paid whose status is not 'paid'", () => {
    const result = normalizeRazorpayEvent(
      baseInput("order.paid", {
        order: fakeOrderEvidence({ status: "created" }),
      }),
    );
    expect(result.outcome).toBe("invalid");
  });

  // 13. safe payment failure fields normalize (null when absent)
  it("normalizes payment.failed with absent safe error fields as null, never undefined/missing", () => {
    const result = normalizeRazorpayEvent(
      baseInput("payment.failed", {
        payment: fakePaymentEvidence({ status: "failed" }),
      }),
    );
    expect(result.outcome).toBe("normalized");
    if (result.outcome !== "normalized") throw new Error("expected normalized");
    expect(result.event).toMatchObject({
      errorCode: null,
      errorSource: null,
      errorStep: null,
      errorReason: null,
    });
  });

  // 14. customer email/contact never appear
  it("never includes email/contact in the normalized event, even if injected into safe evidence", () => {
    const result = normalizeRazorpayEvent(
      baseInput("payment.captured", {
        payment: fakePaymentEvidence({
          email: "customer@example.com",
          contact: "+911234567890",
        }),
      }),
    );
    expect(result.outcome).toBe("normalized");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("customer@example.com");
    expect(serialized).not.toContain("1234567890");
  });

  // 15. VPA/card/bank/method never appear
  it("never includes VPA/card/bank/method in the normalized event, even if injected into safe evidence", () => {
    const result = normalizeRazorpayEvent(
      baseInput("payment.captured", {
        payment: fakePaymentEvidence({
          vpa: "someone@upi",
          card_id: "card_fake_id",
          bank: "HDFC",
          method: "netbanking",
        }),
      }),
    );
    expect(result.outcome).toBe("normalized");
    const serialized = JSON.stringify(result).toLowerCase();
    for (const forbidden of ["upi", "card_fake_id", "hdfc", "netbanking"]) {
      expect(serialized).not.toContain(forbidden.toLowerCase());
    }
  });

  // 16. unsupported event returns explicit unsupported result
  it("returns an explicit 'unsupported' outcome for a validly-shaped but unsupported event type", () => {
    const result = normalizeRazorpayEvent(
      baseInput("refund.processed", { payment: fakePaymentEvidence() }),
    );
    expect(result).toEqual({
      outcome: "unsupported",
      eventType: "refund.processed",
    });
  });

  it("returns 'unsupported' (not 'invalid') for payment.authorized — deliberately not P0", () => {
    const result = normalizeRazorpayEvent(
      baseInput("payment.authorized", { payment: fakePaymentEvidence() }),
    );
    expect(result.outcome).toBe("unsupported");
  });

  // 17. normalized event has explicit REAL_RAZORPAY_WEBHOOK provenance
  it("every normalized event carries explicit REAL_RAZORPAY_WEBHOOK provenance and schemaVersion", () => {
    const result = normalizeRazorpayEvent(
      baseInput("order.paid", { order: fakeOrderEvidence() }),
    );
    expect(result.outcome).toBe("normalized");
    if (result.outcome !== "normalized") throw new Error("expected normalized");
    expect(result.event.sourceKind).toBe("REAL_RAZORPAY_WEBHOOK");
    expect(result.event.schemaVersion).toBe(1);
  });

  // 18. normalized event contains no raw payload
  it("the normalized event never contains a raw/unredacted payload field", () => {
    const result = normalizeRazorpayEvent(
      baseInput("payment.captured", { payment: fakePaymentEvidence() }),
    );
    expect(result.outcome).toBe("normalized");
    if (result.outcome !== "normalized") throw new Error("expected normalized");
    expect(result.event).not.toHaveProperty("rawPayload");
    expect(result.event).not.toHaveProperty("payload");
    expect(result.event).not.toHaveProperty("raw_payload_redacted");
  });

  it("order.paid picks up a present-but-optional razorpayPaymentId from safe payment evidence, never inventing one", () => {
    const result = normalizeRazorpayEvent(
      baseInput("order.paid", {
        order: fakeOrderEvidence(),
        payment: { id: "pay_fake_id_present" },
      }),
    );
    expect(result.outcome).toBe("normalized");
    if (result.outcome !== "normalized") throw new Error("expected normalized");
    expect(result.event).toMatchObject({
      kind: "order.paid",
      razorpayPaymentId: "pay_fake_id_present",
    });
  });

  it("returns 'invalid' (not a thrown error) for completely missing evidence objects", () => {
    expect(
      normalizeRazorpayEvent(baseInput("payment.captured", {})).outcome,
    ).toBe("invalid");
    expect(normalizeRazorpayEvent(baseInput("order.paid", {})).outcome).toBe(
      "invalid",
    );
  });
});
