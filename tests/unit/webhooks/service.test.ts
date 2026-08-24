import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 2D: `lib/webhooks/service.ts` behavior against MOCKED
// verification/repository/logger modules (no network). Redaction
// (lib/webhooks/redaction.ts) is used for real — it is pure and already
// separately unit-tested — so this file also proves the real wiring
// between verification, hashing, and redaction, not just the mocks.
//
// 2026-08-26 architect review correction: this file no longer asserts any
// duplicate-recognition / "already recorded" behavior. A
// `UNIQUE(razorpay_event_id)` conflict at the repository layer is, at this
// phase, indistinguishable from any other repository failure — recognizing
// and safely acknowledging a duplicate delivery is Phase 2E scope.
vi.mock("server-only", () => ({}));

const verifyWebhookSignatureMock = vi.fn();
vi.mock("@/lib/razorpay/webhook-verification", () => ({
  verifyWebhookSignature: verifyWebhookSignatureMock,
}));

const insertWebhookEventMock = vi.fn();

vi.mock("@/lib/webhooks/repository", () => ({
  insertWebhookEvent: insertWebhookEventMock,
}));

const logEventMock = vi.fn();
vi.mock("@/lib/security/logger", () => ({
  logEvent: logEventMock,
}));

const VALID_EVENT_ID = "evt_fake_id_123";
const VALID_SIGNATURE = "a".repeat(64);

function validRawBody(overrides: Record<string, unknown> = {}) {
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

beforeEach(() => {
  verifyWebhookSignatureMock.mockReset();
  insertWebhookEventMock.mockReset();
  logEventMock.mockReset();
});

describe("ingestRazorpayWebhook", () => {
  it("rejects an oversized body before any verification/persistence", async () => {
    const {
      ingestRazorpayWebhook,
      WebhookPayloadTooLargeError,
      MAX_WEBHOOK_BODY_BYTES,
    } = await import("@/lib/webhooks/service");

    const oversized = Buffer.alloc(MAX_WEBHOOK_BODY_BYTES + 1, "x");

    await expect(
      ingestRazorpayWebhook({
        rawBody: oversized,
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      }),
    ).rejects.toThrow(WebhookPayloadTooLargeError);

    expect(verifyWebhookSignatureMock).not.toHaveBeenCalled();
    expect(insertWebhookEventMock).not.toHaveBeenCalled();
  });

  it("rejects a missing signature header before any persistence", async () => {
    const { ingestRazorpayWebhook, WebhookSignatureMissingError } =
      await import("@/lib/webhooks/service");

    await expect(
      ingestRazorpayWebhook({
        rawBody: validRawBody(),
        signatureHeader: null,
        eventIdHeader: VALID_EVENT_ID,
      }),
    ).rejects.toThrow(WebhookSignatureMissingError);

    expect(verifyWebhookSignatureMock).not.toHaveBeenCalled();
    expect(insertWebhookEventMock).not.toHaveBeenCalled();
  });

  it("passes the EXACT raw bytes to the signature verifier — before any JSON parsing", async () => {
    verifyWebhookSignatureMock.mockReturnValue(true);
    insertWebhookEventMock.mockResolvedValue({
      id: "row-1",
      razorpay_event_id: VALID_EVENT_ID,
      event_type: "payment.captured",
    });

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");
    const rawBody = validRawBody();

    await ingestRazorpayWebhook({
      rawBody,
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    });

    expect(verifyWebhookSignatureMock).toHaveBeenCalledWith({
      rawBody,
      signature: VALID_SIGNATURE,
    });
    // The exact same Buffer instance/bytes — never a re-serialized copy.
    const calledWith = verifyWebhookSignatureMock.mock.calls[0]?.[0] as {
      rawBody: Buffer;
    };
    expect(calledWith.rawBody.equals(rawBody)).toBe(true);
  });

  it("an invalid signature is rejected and creates zero persistence calls", async () => {
    verifyWebhookSignatureMock.mockReturnValue(false);

    const { ingestRazorpayWebhook, WebhookSignatureInvalidError } =
      await import("@/lib/webhooks/service");

    await expect(
      ingestRazorpayWebhook({
        rawBody: validRawBody(),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      }),
    ).rejects.toThrow(WebhookSignatureInvalidError);

    expect(insertWebhookEventMock).not.toHaveBeenCalled();
  });

  it("a signature-verifier config error (e.g. EnvValidationError) propagates uncaught, with zero persistence", async () => {
    class FakeEnvValidationError extends Error {}
    verifyWebhookSignatureMock.mockImplementation(() => {
      throw new FakeEnvValidationError("webhook secret misconfigured");
    });

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");

    await expect(
      ingestRazorpayWebhook({
        rawBody: validRawBody(),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      }),
    ).rejects.toThrow(FakeEnvValidationError);

    expect(insertWebhookEventMock).not.toHaveBeenCalled();
  });

  it("requires x-razorpay-event-id ONLY after signature verification succeeds, zero persistence when missing", async () => {
    verifyWebhookSignatureMock.mockReturnValue(true);

    const { ingestRazorpayWebhook, WebhookEventIdMissingError } =
      await import("@/lib/webhooks/service");

    await expect(
      ingestRazorpayWebhook({
        rawBody: validRawBody(),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: null,
      }),
    ).rejects.toThrow(WebhookEventIdMissingError);

    // Signature WAS checked (verification happens before the event-ID
    // check), but persistence never happened.
    expect(verifyWebhookSignatureMock).toHaveBeenCalledTimes(1);
    expect(insertWebhookEventMock).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only x-razorpay-event-id with zero persistence (envelope validation, not Phase 2E semantic validation)", async () => {
    verifyWebhookSignatureMock.mockReturnValue(true);

    const { ingestRazorpayWebhook, WebhookEventIdMissingError } =
      await import("@/lib/webhooks/service");

    await expect(
      ingestRazorpayWebhook({
        rawBody: validRawBody(),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: "   ",
      }),
    ).rejects.toThrow(WebhookEventIdMissingError);

    expect(insertWebhookEventMock).not.toHaveBeenCalled();
  });

  it("trims a whitespace-padded x-razorpay-event-id and persists the trimmed value", async () => {
    verifyWebhookSignatureMock.mockReturnValue(true);
    insertWebhookEventMock.mockResolvedValue({
      id: "row-1",
      razorpay_event_id: VALID_EVENT_ID,
      event_type: "payment.captured",
    });

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");

    await ingestRazorpayWebhook({
      rawBody: validRawBody(),
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: `  ${VALID_EVENT_ID}  `,
    });

    const call = insertWebhookEventMock.mock.calls[0]?.[0];
    expect(call.razorpayEventId).toBe(VALID_EVENT_ID);
  });

  it("signed malformed (non-JSON) body is rejected with zero persistence", async () => {
    verifyWebhookSignatureMock.mockReturnValue(true);

    const { ingestRazorpayWebhook, WebhookPayloadMalformedError } =
      await import("@/lib/webhooks/service");

    await expect(
      ingestRazorpayWebhook({
        rawBody: Buffer.from("not-json-at-all{{{", "utf8"),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      }),
    ).rejects.toThrow(WebhookPayloadMalformedError);

    expect(insertWebhookEventMock).not.toHaveBeenCalled();
  });

  it("signed non-object JSON (e.g. an array) is rejected with zero persistence", async () => {
    verifyWebhookSignatureMock.mockReturnValue(true);

    const { ingestRazorpayWebhook, WebhookPayloadMalformedError } =
      await import("@/lib/webhooks/service");

    await expect(
      ingestRazorpayWebhook({
        rawBody: Buffer.from("[1,2,3]", "utf8"),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      }),
    ).rejects.toThrow(WebhookPayloadMalformedError);

    expect(insertWebhookEventMock).not.toHaveBeenCalled();
  });

  it("signed JSON missing the required 'event' field is rejected with zero persistence", async () => {
    verifyWebhookSignatureMock.mockReturnValue(true);

    const { ingestRazorpayWebhook, WebhookPayloadMalformedError } =
      await import("@/lib/webhooks/service");

    await expect(
      ingestRazorpayWebhook({
        rawBody: Buffer.from(JSON.stringify({ entity: "event" }), "utf8"),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      }),
    ).rejects.toThrow(WebhookPayloadMalformedError);

    expect(insertWebhookEventMock).not.toHaveBeenCalled();
  });

  it("a whitespace-only 'event' field is rejected with zero persistence", async () => {
    verifyWebhookSignatureMock.mockReturnValue(true);

    const { ingestRazorpayWebhook, WebhookPayloadMalformedError } =
      await import("@/lib/webhooks/service");

    await expect(
      ingestRazorpayWebhook({
        rawBody: Buffer.from(JSON.stringify({ event: "   " }), "utf8"),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      }),
    ).rejects.toThrow(WebhookPayloadMalformedError);

    expect(insertWebhookEventMock).not.toHaveBeenCalled();
  });

  it("trims a whitespace-padded 'event' field and persists the trimmed event_type", async () => {
    verifyWebhookSignatureMock.mockReturnValue(true);
    insertWebhookEventMock.mockResolvedValue({
      id: "row-1",
      razorpay_event_id: VALID_EVENT_ID,
      event_type: "payment.captured",
    });

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");

    await ingestRazorpayWebhook({
      rawBody: Buffer.from(
        JSON.stringify({ event: "  payment.captured  " }),
        "utf8",
      ),
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    });

    const call = insertWebhookEventMock.mock.calls[0]?.[0];
    expect(call.eventType).toBe("payment.captured");
  });

  it("does NOT require event to be one of payment.captured/payment.failed/order.paid — any non-empty event string is accepted", async () => {
    verifyWebhookSignatureMock.mockReturnValue(true);
    insertWebhookEventMock.mockResolvedValue({
      id: "row-x",
      razorpay_event_id: VALID_EVENT_ID,
      event_type: "refund.processed",
    });

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");

    const result = await ingestRazorpayWebhook({
      rawBody: Buffer.from(
        JSON.stringify({ event: "refund.processed" }),
        "utf8",
      ),
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    });

    expect(result.eventType).toBe("refund.processed");
    expect(insertWebhookEventMock).toHaveBeenCalledTimes(1);
  });

  it("on success: persistence is called once with signature_verified implied true, exact razorpay_event_id, and the exact-bytes SHA-256", async () => {
    verifyWebhookSignatureMock.mockReturnValue(true);
    insertWebhookEventMock.mockResolvedValue({
      id: "row-1",
      razorpay_event_id: VALID_EVENT_ID,
      event_type: "payment.captured",
    });

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");
    const rawBody = validRawBody();
    const expectedHash = createHash("sha256").update(rawBody).digest("hex");

    const result = await ingestRazorpayWebhook({
      rawBody,
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    });

    expect(insertWebhookEventMock).toHaveBeenCalledTimes(1);
    const call = insertWebhookEventMock.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      razorpayEventId: VALID_EVENT_ID,
      eventType: "payment.captured",
      rawBodySha256: expectedHash,
    });
    expect(call.rawPayloadRedacted).toMatchObject({
      event: "payment.captured",
      payment: expect.objectContaining({ id: "pay_fake_id" }),
    });
    // A successful ingest is exactly {id, eventType} — no
    // duplicate-recognition field exists at this phase.
    expect(result).toEqual({
      id: "row-1",
      eventType: "payment.captured",
    });
  });

  it("event_type is extracted from the payload only AFTER signature verification (never trusted from an unverified body)", async () => {
    verifyWebhookSignatureMock.mockReturnValue(false);

    const { ingestRazorpayWebhook, WebhookSignatureInvalidError } =
      await import("@/lib/webhooks/service");

    await expect(
      ingestRazorpayWebhook({
        rawBody: validRawBody({ event: "payment.captured" }),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      }),
    ).rejects.toThrow(WebhookSignatureInvalidError);

    // Rejected before the body was ever parsed for its event field.
    expect(insertWebhookEventMock).not.toHaveBeenCalled();
  });

  it("architect review correction (2026-08-26): a UNIQUE(razorpay_event_id) conflict at the repository layer propagates as an ordinary failure — there is no duplicate-recognition branch in this module", async () => {
    verifyWebhookSignatureMock.mockReturnValue(true);
    class FakeWebhookRepositoryError extends Error {
      readonly code = "WEBHOOK_EVENT_INSERT_FAILED";
    }
    insertWebhookEventMock.mockRejectedValue(
      new FakeWebhookRepositoryError("insert failed"),
    );

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");

    await expect(
      ingestRazorpayWebhook({
        rawBody: validRawBody(),
        signatureHeader: VALID_SIGNATURE,
        eventIdHeader: VALID_EVENT_ID,
      }),
    ).rejects.toThrow(FakeWebhookRepositoryError);

    // Exactly one insert attempt — no retry, no second call, no
    // alternate-outcome branching.
    expect(insertWebhookEventMock).toHaveBeenCalledTimes(1);
  });

  it("this module's source contains no duplicate-recognition/already-recorded logic (structural scope guard)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../lib/webhooks/service.ts"),
      "utf-8",
    );
    // `duplicate_delivery_count` legitimately appears in a scope-boundary
    // doc comment explaining what is deferred to Phase 2E — that is
    // documentation, not implemented behavior, so it is not checked here.
    for (const forbidden of [
      "alreadyRecorded",
      "already_recorded",
      "WebhookEventAlreadyRecordedError",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("no logged event ever contains the signature header value", async () => {
    verifyWebhookSignatureMock.mockReturnValue(true);
    insertWebhookEventMock.mockResolvedValue({
      id: "row-1",
      razorpay_event_id: VALID_EVENT_ID,
      event_type: "payment.captured",
    });

    const { ingestRazorpayWebhook } = await import("@/lib/webhooks/service");

    await ingestRazorpayWebhook({
      rawBody: validRawBody(),
      signatureHeader: VALID_SIGNATURE,
      eventIdHeader: VALID_EVENT_ID,
    });

    for (const call of logEventMock.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(VALID_SIGNATURE);
    }
  });
});
