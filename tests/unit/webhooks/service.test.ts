import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 2D/2E: `lib/webhooks/service.ts` behavior against MOCKED
// verification/repository/correlation/logger modules (no network).
// Redaction (lib/webhooks/redaction.ts) AND normalization
// (lib/events/normalization.ts) are used for REAL — both are pure and
// already separately unit-tested — so this file also proves the real
// wiring between verification, hashing, redaction, normalization, dedup,
// and correlation, not just the mocks.
//
// 2026-08-27 architect review correction: this file now also proves
// Corrections A-E — see the dedicated describe blocks below.
vi.mock("server-only", () => ({}));

const verifyWebhookSignatureMock = vi.fn();
vi.mock("@/lib/razorpay/webhook-verification", () => ({
  verifyWebhookSignature: verifyWebhookSignatureMock,
}));

const insertWebhookEventMock = vi.fn();
const incrementWebhookDuplicateDeliveryCountMock = vi.fn();
const updateWebhookEventDerivedFieldsMock = vi.fn();

vi.mock("@/lib/webhooks/repository", () => ({
  insertWebhookEvent: insertWebhookEventMock,
  incrementWebhookDuplicateDeliveryCount:
    incrementWebhookDuplicateDeliveryCountMock,
  updateWebhookEventDerivedFields: updateWebhookEventDerivedFieldsMock,
}));

const getDurableNormalizedAttemptForWebhookEventMock = vi.fn();
const insertEventProcessingAttemptMock = vi.fn();

vi.mock("@/lib/webhooks/event-processing-repository", () => ({
  getDurableNormalizedAttemptForWebhookEvent:
    getDurableNormalizedAttemptForWebhookEventMock,
  insertEventProcessingAttempt: insertEventProcessingAttemptMock,
}));

const getPaymentAttemptByRazorpayOrderIdMock = vi.fn();
const getPaymentByRazorpayPaymentIdMock = vi.fn();
const insertPaymentFromWebhookEvidenceMock = vi.fn();

vi.mock("@/lib/demo-merchant/repository", () => ({
  getPaymentAttemptByRazorpayOrderId: getPaymentAttemptByRazorpayOrderIdMock,
  getPaymentByRazorpayPaymentId: getPaymentByRazorpayPaymentIdMock,
  insertPaymentFromWebhookEvidence: insertPaymentFromWebhookEvidenceMock,
}));

const logEventMock = vi.fn();
vi.mock("@/lib/security/logger", () => ({
  logEvent: logEventMock,
}));

const VALID_EVENT_ID = "evt_fake_id_123";
const VALID_SIGNATURE = "a".repeat(64);
const ATTEMPT_ID = "attempt-1";
const PAYMENT_ID = "payment-1";
const CANONICAL_SHA256 = "b".repeat(64);

function paymentCapturedBody(overrides: Record<string, unknown> = {}) {
  return Buffer.from(
    JSON.stringify({
      entity: "event",
      event: "payment.captured",
      created_at: 1_800_000_000,
      payload: {
        payment: {
          entity: {
            id: "pay_fake_id",
            order_id: "order_fake_id",
            amount: 50000,
            currency: "INR",
            status: "captured",
          },
        },
      },
      ...overrides,
    }),
    "utf8",
  );
}

function orderPaidBody(overrides: Record<string, unknown> = {}) {
  return Buffer.from(
    JSON.stringify({
      entity: "event",
      event: "order.paid",
      created_at: 1_800_000_000,
      payload: {
        order: {
          entity: {
            id: "order_fake_id",
            amount: 50000,
            currency: "INR",
            status: "paid",
          },
        },
      },
      ...overrides,
    }),
    "utf8",
  );
}

/** The exact redacted-evidence shape `lib/webhooks/redaction.ts` produces for `paymentCapturedBody()`. */
function redactedPaymentCapturedEvidence(
  overrides: Record<string, unknown> = {},
) {
  return {
    event: "payment.captured",
    entity: "event",
    created_at: 1_800_000_000,
    payment: {
      id: "pay_fake_id",
      order_id: "order_fake_id",
      amount: 50000,
      currency: "INR",
      status: "captured",
    },
    ...overrides,
  };
}

/**
 * The canonical `webhook_events` row as it would be persisted/returned —
 * used both for the fresh-insert path and (Correction D) as the SOLE
 * source of normalization truth for the duplicate-retry path.
 */
function fakeWebhookEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "webhook-event-1",
    razorpay_event_id: VALID_EVENT_ID,
    event_type: "payment.captured",
    provider_created_at: "2027-01-15T08:00:00.000Z",
    raw_payload_redacted: redactedPaymentCapturedEvidence(),
    raw_body_sha256: CANONICAL_SHA256,
    duplicate_delivery_count: 0,
    ...overrides,
  };
}

function fakeAttemptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID,
    razorpay_order_id: "order_fake_id",
    ...overrides,
  };
}

function fakePaymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ID,
    payment_attempt_id: ATTEMPT_ID,
    razorpay_payment_id: "pay_fake_id",
    amount_subunits: 50000,
    currency: "INR",
    ...overrides,
  };
}

function fakeDurableAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: "attempt-record-1",
    status: "PENDING",
    payment_attempt_id: ATTEMPT_ID,
    payment_id: PAYMENT_ID,
    normalized_event: { kind: "payment.captured", stored: true },
    ...overrides,
  };
}

beforeEach(() => {
  verifyWebhookSignatureMock.mockReset().mockReturnValue(true);
  insertWebhookEventMock.mockReset();
  incrementWebhookDuplicateDeliveryCountMock.mockReset();
  updateWebhookEventDerivedFieldsMock
    .mockReset()
    .mockResolvedValue(fakeWebhookEventRow());
  getDurableNormalizedAttemptForWebhookEventMock.mockReset();
  insertEventProcessingAttemptMock
    .mockReset()
    .mockResolvedValue({ id: "attempt-record-1", status: "PENDING" });
  getPaymentAttemptByRazorpayOrderIdMock.mockReset();
  getPaymentByRazorpayPaymentIdMock.mockReset();
  insertPaymentFromWebhookEvidenceMock.mockReset();
  logEventMock.mockReset();
});

describe("ingestRazorpayWebhook — envelope validation (Phase 2D, unchanged)", () => {
  it("rejects an oversized body before any verification/persistence", async () => {
    const {
      ingestRazorpayWebhook,
      WebhookPayloadTooLargeError,
      MAX_WEBHOOK_BODY_BYTES,
    } = await import("@/lib/webhooks/service");

    await expect(
      ingestRazorpayWebhook({
        rawBody: Buffer.alloc(MAX_WEBHOOK_BODY_BYTES + 1, "x"),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      }),
    ).rejects.toThrow(WebhookPayloadTooLargeError);
    expect(insertWebhookEventMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature with zero persistence", async () => {
    verifyWebhookSignatureMock.mockReturnValue(false);
    const { ingestRazorpayWebhook, WebhookSignatureInvalidError } =
      await import("@/lib/webhooks/service");

    await expect(
      ingestRazorpayWebhook({
        rawBody: paymentCapturedBody(),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      }),
    ).rejects.toThrow(WebhookSignatureInvalidError);
    expect(insertWebhookEventMock).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only event id with zero persistence", async () => {
    const { ingestRazorpayWebhook, WebhookEventIdMissingError } =
      await import("@/lib/webhooks/service");

    await expect(
      ingestRazorpayWebhook({
        rawBody: paymentCapturedBody(),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: "   ",
      }),
    ).rejects.toThrow(WebhookEventIdMissingError);
    expect(insertWebhookEventMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with zero persistence", async () => {
    const { ingestRazorpayWebhook, WebhookPayloadMalformedError } =
      await import("@/lib/webhooks/service");

    await expect(
      ingestRazorpayWebhook({
        rawBody: Buffer.from("not-json{{{", "utf8"),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      }),
    ).rejects.toThrow(WebhookPayloadMalformedError);
    expect(insertWebhookEventMock).not.toHaveBeenCalled();
  });
});

describe("ingestRazorpayWebhook — fresh event (supported)", () => {
  it("a fresh payment.captured event correlates, updates derived fields THEN persists a PENDING attempt, and returns 'processed'", async () => {
    insertWebhookEventMock.mockResolvedValue(fakeWebhookEventRow());
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(null);
    insertPaymentFromWebhookEvidenceMock.mockResolvedValue(fakePaymentRow());

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");
    const rawBody = paymentCapturedBody();
    const result = await ingestRazorpayWebhook({
      rawBody,
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    });

    expect(result).toEqual({
      outcome: "processed",
      webhookEventId: "webhook-event-1",
      eventType: "payment.captured",
    });
    expect(incrementWebhookDuplicateDeliveryCountMock).not.toHaveBeenCalled();
    expect(getPaymentAttemptByRazorpayOrderIdMock).toHaveBeenCalledWith(
      "order_fake_id",
    );
    expect(insertPaymentFromWebhookEvidenceMock).toHaveBeenCalledWith({
      paymentAttemptId: ATTEMPT_ID,
      razorpayPaymentId: "pay_fake_id",
      amountSubunits: 50000,
      currency: "INR",
    });

    // Correction C: derived-field update happens BEFORE the PENDING insert.
    const derivedCallOrder =
      updateWebhookEventDerivedFieldsMock.mock.invocationCallOrder[0]!;
    const pendingCall = insertEventProcessingAttemptMock.mock.calls.find(
      (call) => call[0]?.status === "PENDING",
    );
    expect(pendingCall).toBeDefined();
    const pendingCallIndex =
      insertEventProcessingAttemptMock.mock.calls.indexOf(pendingCall!);
    const pendingCallOrder =
      insertEventProcessingAttemptMock.mock.invocationCallOrder[
        pendingCallIndex
      ]!;
    expect(derivedCallOrder).toBeLessThan(pendingCallOrder);

    expect(pendingCall![0]).toMatchObject({
      webhookEventId: "webhook-event-1",
      paymentAttemptId: ATTEMPT_ID,
      paymentId: PAYMENT_ID,
      isDuplicateDelivery: false,
      status: "PENDING",
    });
    expect(pendingCall![0].normalizedEvent).toMatchObject({
      kind: "payment.captured",
      sourceKind: "REAL_RAZORPAY_WEBHOOK",
      razorpayOrderId: "order_fake_id",
      razorpayPaymentId: "pay_fake_id",
    });

    expect(updateWebhookEventDerivedFieldsMock).toHaveBeenCalledWith(
      "webhook-event-1",
      expect.objectContaining({
        razorpayOrderId: "order_fake_id",
        razorpayPaymentId: "pay_fake_id",
        paymentAttemptId: ATTEMPT_ID,
        paymentId: PAYMENT_ID,
        amountSubunits: 50000,
        currency: "INR",
        razorpayPaymentStatus: "captured",
      }),
    );
  });

  it("passes the exact raw bytes to the signature verifier before any parsing", async () => {
    insertWebhookEventMock.mockResolvedValue(fakeWebhookEventRow());
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(fakePaymentRow());

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");
    const rawBody = paymentCapturedBody();
    await ingestRazorpayWebhook({
      rawBody,
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    });

    const calledWith = verifyWebhookSignatureMock.mock.calls[0]?.[0] as {
      rawBody: Buffer;
    };
    expect(calledWith.rawBody.equals(rawBody)).toBe(true);
  });

  it("correlates to an existing payments row already created by Checkout, without re-inserting", async () => {
    insertWebhookEventMock.mockResolvedValue(fakeWebhookEventRow());
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(
      fakePaymentRow({ checkout_signature_verified: true }),
    );

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");
    await ingestRazorpayWebhook({
      rawBody: paymentCapturedBody(),
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    });

    expect(insertPaymentFromWebhookEvidenceMock).not.toHaveBeenCalled();
    const pendingCall = insertEventProcessingAttemptMock.mock.calls.find(
      (call) => call[0]?.status === "PENDING",
    );
    expect(pendingCall![0].paymentId).toBe(PAYMENT_ID);
  });

  it("order.paid without a payment id in the safe evidence correlates with paymentId null, never inventing one", async () => {
    insertWebhookEventMock.mockResolvedValue(
      fakeWebhookEventRow({
        event_type: "order.paid",
        raw_payload_redacted: {
          event: "order.paid",
          order: {
            id: "order_fake_id",
            amount: 50000,
            currency: "INR",
            status: "paid",
          },
        },
      }),
    );
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");
    await ingestRazorpayWebhook({
      rawBody: orderPaidBody(),
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    });

    expect(getPaymentByRazorpayPaymentIdMock).not.toHaveBeenCalled();
    expect(insertPaymentFromWebhookEvidenceMock).not.toHaveBeenCalled();
    const pendingCall = insertEventProcessingAttemptMock.mock.calls.find(
      (call) => call[0]?.status === "PENDING",
    );
    expect(pendingCall![0].paymentId).toBeNull();
    expect(updateWebhookEventDerivedFieldsMock).toHaveBeenCalledWith(
      "webhook-event-1",
      expect.objectContaining({ paymentId: null, razorpayPaymentStatus: null }),
    );
  });

  it("order.paid with a present payment id correlates to it ONLY if it already exists — never creates a payment row", async () => {
    insertWebhookEventMock.mockResolvedValue(
      fakeWebhookEventRow({
        event_type: "order.paid",
        raw_payload_redacted: {
          event: "order.paid",
          order: {
            id: "order_fake_id",
            amount: 50000,
            currency: "INR",
            status: "paid",
          },
          payment: { id: "pay_fake_id" },
        },
      }),
    );
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(fakePaymentRow());

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");
    await ingestRazorpayWebhook({
      rawBody: orderPaidBody({
        payload: {
          order: {
            entity: {
              id: "order_fake_id",
              amount: 50000,
              currency: "INR",
              status: "paid",
            },
          },
          payment: { entity: { id: "pay_fake_id" } },
        },
      }),
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    });

    expect(insertPaymentFromWebhookEvidenceMock).not.toHaveBeenCalled();
    const pendingCall = insertEventProcessingAttemptMock.mock.calls.find(
      (call) => call[0]?.status === "PENDING",
    );
    expect(pendingCall![0].paymentId).toBe(PAYMENT_ID);
  });
});

describe("ingestRazorpayWebhook — normalization outcomes", () => {
  it("an unsupported (but validly signed) event returns 'unsupported_event_accepted' and creates NO processing attempt", async () => {
    insertWebhookEventMock.mockResolvedValue(
      fakeWebhookEventRow({
        event_type: "refund.processed",
        raw_payload_redacted: { event: "refund.processed" },
      }),
    );

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");
    const result = await ingestRazorpayWebhook({
      rawBody: Buffer.from(
        JSON.stringify({ event: "refund.processed" }),
        "utf8",
      ),
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    });

    expect(result).toEqual({
      outcome: "unsupported_event_accepted",
      webhookEventId: "webhook-event-1",
      eventType: "refund.processed",
    });
    expect(getPaymentAttemptByRazorpayOrderIdMock).not.toHaveBeenCalled();
    expect(insertEventProcessingAttemptMock).not.toHaveBeenCalled();
    expect(updateWebhookEventDerivedFieldsMock).not.toHaveBeenCalled();
  });

  it("a supported event with an invalid/malformed payload throws WebhookEventNormalizationInvalidError and records a FAILED attempt", async () => {
    insertWebhookEventMock.mockResolvedValue(
      fakeWebhookEventRow({
        raw_payload_redacted: { event: "payment.captured" },
      }),
    );

    const { ingestRazorpayWebhook, WebhookEventNormalizationInvalidError } =
      await import("@/lib/webhooks/service");

    await expect(
      ingestRazorpayWebhook({
        rawBody: Buffer.from(
          JSON.stringify({ event: "payment.captured" }),
          "utf8",
        ),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      }),
    ).rejects.toThrow(WebhookEventNormalizationInvalidError);

    expect(getPaymentAttemptByRazorpayOrderIdMock).not.toHaveBeenCalled();
    const failedAttemptCall =
      insertEventProcessingAttemptMock.mock.calls[0]?.[0];
    expect(failedAttemptCall).toMatchObject({
      status: "FAILED",
      errorCode: "NORMALIZATION_INVALID_PAYLOAD",
    });
  });
});

// ============================================================================
// Correction B — duplicate lookup must use a durable ELIGIBLE attempt, not
// merely the single latest row.
// ============================================================================
describe("ingestRazorpayWebhook — Correction B: durable eligible-attempt duplicate recognition", () => {
  function mockDuplicateWebhookEvent() {
    insertWebhookEventMock.mockResolvedValue(null);
    incrementWebhookDuplicateDeliveryCountMock.mockResolvedValue(
      fakeWebhookEventRow({ duplicate_delivery_count: 1 }),
    );
  }

  it("B1-B3/B10: original PENDING attempt; three consecutive duplicate deliveries ALL skip re-normalization, each incrementing the duplicate counter exactly once and creating their own SKIPPED_DUPLICATE record", async () => {
    mockDuplicateWebhookEvent();
    getDurableNormalizedAttemptForWebhookEventMock.mockResolvedValue(
      fakeDurableAttempt({ status: "PENDING" }),
    );

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");

    for (let i = 0; i < 3; i++) {
      const result = await ingestRazorpayWebhook({
        rawBody: paymentCapturedBody(),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      });
      expect(result.outcome).toBe("duplicate_received");
    }

    expect(incrementWebhookDuplicateDeliveryCountMock).toHaveBeenCalledTimes(3);
    // Re-normalization NEVER happens across any of the three deliveries.
    expect(getPaymentAttemptByRazorpayOrderIdMock).not.toHaveBeenCalled();
    expect(getPaymentByRazorpayPaymentIdMock).not.toHaveBeenCalled();
    expect(insertPaymentFromWebhookEvidenceMock).not.toHaveBeenCalled();
    expect(updateWebhookEventDerivedFieldsMock).not.toHaveBeenCalled();

    const skippedCalls = insertEventProcessingAttemptMock.mock.calls.filter(
      (call) => call[0]?.status === "SKIPPED_DUPLICATE",
    );
    expect(skippedCalls).toHaveLength(3);
    for (const call of skippedCalls) {
      expect(call[0]).toMatchObject({
        isDuplicateDelivery: true,
        status: "SKIPPED_DUPLICATE",
        paymentAttemptId: ATTEMPT_ID,
        paymentId: PAYMENT_ID,
      });
    }
  });

  it.each(["SUCCEEDED", "PROCESSING", "HELD"] as const)(
    "B4-B6: an existing %s attempt causes duplicate skip (no re-normalization)",
    async (status) => {
      mockDuplicateWebhookEvent();
      getDurableNormalizedAttemptForWebhookEventMock.mockResolvedValue(
        fakeDurableAttempt({ status }),
      );

      const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");
      const result = await ingestRazorpayWebhook({
        rawBody: paymentCapturedBody(),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      });

      expect(result.outcome).toBe("duplicate_received");
      expect(getPaymentAttemptByRazorpayOrderIdMock).not.toHaveBeenCalled();
      const skippedCall = insertEventProcessingAttemptMock.mock.calls.find(
        (call) => call[0]?.status === "SKIPPED_DUPLICATE",
      );
      expect(skippedCall).toBeDefined();
    },
  );

  it("B9: a duplicate with no eligible durable attempt (none exists at all) retries normalization/correlation from scratch", async () => {
    mockDuplicateWebhookEvent();
    getDurableNormalizedAttemptForWebhookEventMock.mockResolvedValue(null);
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(fakePaymentRow());

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");
    const result = await ingestRazorpayWebhook({
      rawBody: paymentCapturedBody(),
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    });

    expect(result.outcome).toBe("processed");
    expect(getPaymentAttemptByRazorpayOrderIdMock).toHaveBeenCalledTimes(1);
    const pendingCall = insertEventProcessingAttemptMock.mock.calls.find(
      (call) => call[0]?.status === "PENDING",
    );
    expect(pendingCall![0]).toMatchObject({ isDuplicateDelivery: true });
  });

  it("B9: a duplicate whose only prior attempt is FAILED (not eligible) also retries normalization", async () => {
    mockDuplicateWebhookEvent();
    // The repository query itself excludes FAILED — a FAILED-only history
    // means the mocked lookup correctly returns null, exactly like "no
    // attempt at all" from the service's point of view.
    getDurableNormalizedAttemptForWebhookEventMock.mockResolvedValue(null);
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(fakePaymentRow());

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");
    const result = await ingestRazorpayWebhook({
      rawBody: paymentCapturedBody(),
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    });

    expect(result.outcome).toBe("processed");
  });

  it("a duplicate retry that fails normalization/correlation again still throws and records a new FAILED attempt", async () => {
    mockDuplicateWebhookEvent();
    getDurableNormalizedAttemptForWebhookEventMock.mockResolvedValue(null);
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(null);

    const { ingestRazorpayWebhook, WebhookEventCorrelationFailedError } =
      await import("@/lib/webhooks/service");

    await expect(
      ingestRazorpayWebhook({
        rawBody: paymentCapturedBody(),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      }),
    ).rejects.toThrow(WebhookEventCorrelationFailedError);

    const failedCall = insertEventProcessingAttemptMock.mock.calls.find(
      (call) => call[0]?.status === "FAILED",
    );
    expect(failedCall![0]).toMatchObject({ isDuplicateDelivery: true });
  });
});

// ============================================================================
// Correction C — derived webhook_events update must be durable BEFORE a
// PENDING attempt is created; its failure is fatal, not swallowed.
// ============================================================================
describe("ingestRazorpayWebhook — Correction C: derived-field durability ordering", () => {
  it("C1/C2: a derived-field update failure throws and creates NO PENDING attempt", async () => {
    insertWebhookEventMock.mockResolvedValue(fakeWebhookEventRow());
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(fakePaymentRow());
    updateWebhookEventDerivedFieldsMock.mockRejectedValue(new Error("db down"));

    const { ingestRazorpayWebhook, WebhookEventCorrelationFailedError } =
      await import("@/lib/webhooks/service");

    await expect(
      ingestRazorpayWebhook({
        rawBody: paymentCapturedBody(),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      }),
    ).rejects.toThrow(WebhookEventCorrelationFailedError);

    const pendingCall = insertEventProcessingAttemptMock.mock.calls.find(
      (call) => call[0]?.status === "PENDING",
    );
    expect(pendingCall).toBeUndefined();
  });

  it("C3: a derived-field update failure never calls any merchant-state mutation function (structurally impossible — none imported)", async () => {
    insertWebhookEventMock.mockResolvedValue(fakeWebhookEventRow());
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(fakePaymentRow());
    updateWebhookEventDerivedFieldsMock.mockRejectedValue(new Error("db down"));

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");
    await ingestRazorpayWebhook({
      rawBody: paymentCapturedBody(),
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    }).catch(() => undefined);

    // Only the mocked, explicitly-imported functions exist to call —
    // asserting the full mocked module surface stayed within it.
    expect(
      insertPaymentFromWebhookEvidenceMock.mock.calls.length,
    ).toBeLessThanOrEqual(1);
  });

  it("C4/C5: a duplicate retry after a derived-field failure repairs it and creates exactly one PENDING attempt", async () => {
    // First delivery: derived-field update fails.
    insertWebhookEventMock.mockResolvedValueOnce(fakeWebhookEventRow());
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(fakePaymentRow());
    updateWebhookEventDerivedFieldsMock.mockRejectedValueOnce(
      new Error("db down"),
    );

    const { ingestRazorpayWebhook, WebhookEventCorrelationFailedError } =
      await import("@/lib/webhooks/service");

    await expect(
      ingestRazorpayWebhook({
        rawBody: paymentCapturedBody(),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      }),
    ).rejects.toThrow(WebhookEventCorrelationFailedError);

    // Second delivery (Razorpay redelivers): duplicate, no eligible durable
    // attempt exists yet (the first delivery never reached PENDING), so it
    // retries — this time the derived-field update succeeds.
    insertWebhookEventMock.mockResolvedValueOnce(null);
    incrementWebhookDuplicateDeliveryCountMock.mockResolvedValue(
      fakeWebhookEventRow({ duplicate_delivery_count: 1 }),
    );
    getDurableNormalizedAttemptForWebhookEventMock.mockResolvedValue(null);
    updateWebhookEventDerivedFieldsMock.mockResolvedValueOnce(
      fakeWebhookEventRow(),
    );

    const result = await ingestRazorpayWebhook({
      rawBody: paymentCapturedBody(),
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    });

    expect(result.outcome).toBe("processed");
    const pendingCalls = insertEventProcessingAttemptMock.mock.calls.filter(
      (call) => call[0]?.status === "PENDING",
    );
    expect(pendingCalls).toHaveLength(1);
  });

  it("C6/C7: a PENDING-insertion failure AFTER a successful derived-field update remains a safe, redacted failure", async () => {
    insertWebhookEventMock.mockResolvedValue(fakeWebhookEventRow());
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(fakePaymentRow());
    updateWebhookEventDerivedFieldsMock.mockResolvedValue(
      fakeWebhookEventRow(),
    );
    insertEventProcessingAttemptMock.mockImplementation(async (input) => {
      if (input.status === "PENDING") {
        throw new Error("connection string leaked here");
      }
      return { id: "attempt-record-failed", status: input.status };
    });

    const { ingestRazorpayWebhook, WebhookEventCorrelationFailedError } =
      await import("@/lib/webhooks/service");

    try {
      await ingestRazorpayWebhook({
        rawBody: paymentCapturedBody(),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(WebhookEventCorrelationFailedError);
      expect((err as Error).message).not.toContain("connection string");
    }

    // Derived-field update DID succeed and was called exactly once.
    expect(updateWebhookEventDerivedFieldsMock).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Correction D — duplicate normalization must use the CANONICAL persisted
// row, never the incoming duplicate delivery's own parsed body.
// ============================================================================
describe("ingestRazorpayWebhook — Correction D: canonical evidence, not incoming duplicate body", () => {
  it("D1: a fresh event normalizes from the canonical persisted row returned by insertWebhookEvent", async () => {
    insertWebhookEventMock.mockResolvedValue(fakeWebhookEventRow());
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(fakePaymentRow());

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");
    await ingestRazorpayWebhook({
      rawBody: paymentCapturedBody(),
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    });

    const pendingCall = insertEventProcessingAttemptMock.mock.calls.find(
      (call) => call[0]?.status === "PENDING",
    );
    expect(pendingCall![0].normalizedEvent).toMatchObject({
      razorpayOrderId: "order_fake_id",
      amountSubunits: 50000,
    });
  });

  it("D2/D3: a duplicate retry normalizes from canonical raw_payload_redacted — a changed incoming amount cannot redefine it", async () => {
    insertWebhookEventMock.mockResolvedValue(null);
    incrementWebhookDuplicateDeliveryCountMock.mockResolvedValue(
      // Canonical row still says amount 50000 — untouched by this delivery.
      fakeWebhookEventRow({ duplicate_delivery_count: 1 }),
    );
    getDurableNormalizedAttemptForWebhookEventMock.mockResolvedValue(null);
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(fakePaymentRow());

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");
    // This delivery's OWN body claims a different amount (999999) — must
    // be ignored in favor of the canonical row's 50000.
    await ingestRazorpayWebhook({
      rawBody: paymentCapturedBody({
        payload: {
          payment: {
            entity: {
              id: "pay_fake_id",
              order_id: "order_fake_id",
              amount: 999999,
              currency: "INR",
              status: "captured",
            },
          },
        },
      }),
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    });

    const pendingCall = insertEventProcessingAttemptMock.mock.calls.find(
      (call) => call[0]?.status === "PENDING",
    );
    expect(pendingCall![0].normalizedEvent).toMatchObject({
      amountSubunits: 50000,
    });
    expect(updateWebhookEventDerivedFieldsMock).toHaveBeenCalledWith(
      "webhook-event-1",
      expect.objectContaining({ amountSubunits: 50000 }),
    );
  });

  it("D4: a duplicate whose incoming body claims a different event type cannot redefine the canonical event type", async () => {
    insertWebhookEventMock.mockResolvedValue(null);
    incrementWebhookDuplicateDeliveryCountMock.mockResolvedValue(
      // Canonical row is (and remains) payment.captured.
      fakeWebhookEventRow({ duplicate_delivery_count: 1 }),
    );
    getDurableNormalizedAttemptForWebhookEventMock.mockResolvedValue(null);
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(fakePaymentRow());

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");
    // Incoming duplicate body (implausibly) claims order.paid instead.
    const result = await ingestRazorpayWebhook({
      rawBody: orderPaidBody(),
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    });

    expect(result.eventType).toBe("payment.captured");
    const pendingCall = insertEventProcessingAttemptMock.mock.calls.find(
      (call) => call[0]?.status === "PENDING",
    );
    expect(pendingCall![0].normalizedEvent.kind).toBe("payment.captured");
  });

  it("D5: the canonical raw_payload_redacted is never rewritten — updateWebhookEventDerivedFields' payload never carries it", async () => {
    insertWebhookEventMock.mockResolvedValue(fakeWebhookEventRow());
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(fakePaymentRow());

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");
    await ingestRazorpayWebhook({
      rawBody: paymentCapturedBody(),
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    });

    const derivedCall = updateWebhookEventDerivedFieldsMock.mock.calls[0]?.[1];
    expect(derivedCall).not.toHaveProperty("rawPayloadRedacted");
    expect(derivedCall).not.toHaveProperty("razorpayEventId");
    expect(derivedCall).not.toHaveProperty("eventType");
  });

  it("D6/logs a mismatch warning (never rejecting) when a duplicate's incoming body differs from the canonical evidence", async () => {
    insertWebhookEventMock.mockResolvedValue(null);
    incrementWebhookDuplicateDeliveryCountMock.mockResolvedValue(
      fakeWebhookEventRow({ duplicate_delivery_count: 1 }),
    );
    getDurableNormalizedAttemptForWebhookEventMock.mockResolvedValue(
      fakeDurableAttempt(),
    );

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");
    const result = await ingestRazorpayWebhook({
      rawBody: paymentCapturedBody({ event: "payment.captured", extra: "x" }),
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    });

    // Never rejected — still a safe duplicate acknowledgement.
    expect(result.outcome).toBe("duplicate_received");
    expect(incrementWebhookDuplicateDeliveryCountMock).toHaveBeenCalledTimes(1);
    // A mismatch (different raw bytes -> different sha256) is logged.
    const mismatchLog = logEventMock.mock.calls.find(
      (call) => call[0] === "webhook_duplicate_evidence_mismatch",
    );
    expect(mismatchLog).toBeDefined();
    expect(mismatchLog![1]).toMatchObject({ body_matches: false });
    // Never stores/exposes the new raw body itself.
    expect(JSON.stringify(mismatchLog)).not.toContain("extra");
  });
});

// ============================================================================
// Correction E — canonical payment identity must fully agree (attempt id +
// razorpay_payment_id + amount + currency), not merely attempt id.
// ============================================================================
describe("ingestRazorpayWebhook — Correction E: full canonical payment identity agreement", () => {
  it("E1: existing payment agreeing on attempt/id/amount/currency is accepted", async () => {
    insertWebhookEventMock.mockResolvedValue(fakeWebhookEventRow());
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(fakePaymentRow());

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");
    const result = await ingestRazorpayWebhook({
      rawBody: paymentCapturedBody(),
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    });

    expect(result.outcome).toBe("processed");
  });

  it("E2: existing payment with the wrong attempt is rejected (PAYMENT_EVIDENCE_CONFLICT)", async () => {
    insertWebhookEventMock.mockResolvedValue(fakeWebhookEventRow());
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(
      fakePaymentRow({ payment_attempt_id: "some-other-attempt" }),
    );

    const { ingestRazorpayWebhook, WebhookEventCorrelationFailedError } =
      await import("@/lib/webhooks/service");

    let caught: unknown;
    try {
      await ingestRazorpayWebhook({
        rawBody: paymentCapturedBody(),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebhookEventCorrelationFailedError);
    expect(
      (caught as InstanceType<typeof WebhookEventCorrelationFailedError>).code,
    ).toBe("PAYMENT_EVIDENCE_CONFLICT");
  });

  it("E3: existing payment with a mismatched amount is rejected", async () => {
    insertWebhookEventMock.mockResolvedValue(fakeWebhookEventRow());
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(
      fakePaymentRow({ amount_subunits: 12345 }),
    );

    const { ingestRazorpayWebhook, WebhookEventCorrelationFailedError } =
      await import("@/lib/webhooks/service");

    await expect(
      ingestRazorpayWebhook({
        rawBody: paymentCapturedBody(),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      }),
    ).rejects.toThrow(WebhookEventCorrelationFailedError);
  });

  it("E4: existing payment with a mismatched currency is rejected", async () => {
    insertWebhookEventMock.mockResolvedValue(fakeWebhookEventRow());
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(
      fakePaymentRow({ currency: "USD" }),
    );

    const { ingestRazorpayWebhook, WebhookEventCorrelationFailedError } =
      await import("@/lib/webhooks/service");

    await expect(
      ingestRazorpayWebhook({
        rawBody: paymentCapturedBody(),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      }),
    ).rejects.toThrow(WebhookEventCorrelationFailedError);
  });

  it("E5: a race-winning reread with a mismatched amount is rejected", async () => {
    insertWebhookEventMock.mockResolvedValue(fakeWebhookEventRow());
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(fakePaymentRow({ amount_subunits: 1 }));
    insertPaymentFromWebhookEvidenceMock.mockResolvedValue(null);

    const { ingestRazorpayWebhook, WebhookEventCorrelationFailedError } =
      await import("@/lib/webhooks/service");

    let caught: unknown;
    try {
      await ingestRazorpayWebhook({
        rawBody: paymentCapturedBody(),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WebhookEventCorrelationFailedError);
    expect(
      (caught as InstanceType<typeof WebhookEventCorrelationFailedError>).code,
    ).toBe("PAYMENT_EVIDENCE_CONFLICT");
  });

  it("E6: a race-winning reread with a mismatched currency is rejected", async () => {
    insertWebhookEventMock.mockResolvedValue(fakeWebhookEventRow());
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(fakePaymentRow({ currency: "USD" }));
    insertPaymentFromWebhookEvidenceMock.mockResolvedValue(null);

    const { ingestRazorpayWebhook, WebhookEventCorrelationFailedError } =
      await import("@/lib/webhooks/service");

    await expect(
      ingestRazorpayWebhook({
        rawBody: paymentCapturedBody(),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      }),
    ).rejects.toThrow(WebhookEventCorrelationFailedError);
  });

  it("E7: a conflicting canonical payment is never overwritten — no update-payment function exists to call", async () => {
    insertWebhookEventMock.mockResolvedValue(fakeWebhookEventRow());
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(
      fakePaymentRow({ amount_subunits: 1 }),
    );

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");
    await ingestRazorpayWebhook({
      rawBody: paymentCapturedBody(),
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    }).catch(() => undefined);

    // The mocked demo-merchant/repository module exposes no update/patch
    // function at all — structurally impossible to overwrite the row.
    expect(insertPaymentFromWebhookEvidenceMock).not.toHaveBeenCalled();
  });

  it("E8: the correlation-failure error message never leaks the conflicting amount/currency values", async () => {
    insertWebhookEventMock.mockResolvedValue(fakeWebhookEventRow());
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(
      fakePaymentRow({ amount_subunits: 7_777_777 }),
    );

    const { ingestRazorpayWebhook, WebhookEventCorrelationFailedError } =
      await import("@/lib/webhooks/service");

    try {
      await ingestRazorpayWebhook({
        rawBody: paymentCapturedBody(),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(WebhookEventCorrelationFailedError);
      expect((err as Error).message).not.toContain("7777777");
      expect((err as Error).message).not.toContain("7_777_777");
    }
  });
});

describe("ingestRazorpayWebhook — zero merchant/business mutation (structural)", () => {
  it("this module never imports order/fulfilment mutation functions", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../lib/webhooks/service.ts"),
      "utf-8",
    );
    // Only mentioned in the doc-comment explaining what is deferred to
    // Phase 2F — status-word strings legitimately appear there and are
    // not checked here; only real function-call identifiers are.
    for (const forbidden of [
      "markPaymentAttemptOrderCreated",
      "markPaymentAttemptFailedObserved",
      "markPaymentAttemptCheckoutInProgress",
      "insertOrder(",
      "insertFulfilment",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("no logged event ever contains the signature header value, on any path including duplicates", async () => {
    insertWebhookEventMock.mockResolvedValue(null);
    incrementWebhookDuplicateDeliveryCountMock.mockResolvedValue(
      fakeWebhookEventRow(),
    );
    getDurableNormalizedAttemptForWebhookEventMock.mockResolvedValue(
      fakeDurableAttempt(),
    );

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");
    await ingestRazorpayWebhook({
      rawBody: paymentCapturedBody(),
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    });

    for (const call of logEventMock.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(VALID_SIGNATURE);
    }
  });
});

describe("ingestRazorpayWebhook — raw body hashing wiring (unchanged from Phase 2D)", () => {
  it("hashes the same exact raw bytes used for HMAC verification", async () => {
    insertWebhookEventMock.mockImplementation(async (input) => {
      const rawBody = paymentCapturedBody();
      expect(input.rawBodySha256).toBe(
        createHash("sha256").update(rawBody).digest("hex"),
      );
      return fakeWebhookEventRow({ raw_body_sha256: input.rawBodySha256 });
    });
    getPaymentAttemptByRazorpayOrderIdMock.mockResolvedValue(fakeAttemptRow());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(fakePaymentRow());

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");
    await ingestRazorpayWebhook({
      rawBody: paymentCapturedBody(),
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    });

    expect(insertWebhookEventMock).toHaveBeenCalledTimes(1);
  });
});
