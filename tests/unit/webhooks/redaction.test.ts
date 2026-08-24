import { describe, expect, it } from "vitest";

import {
  buildRedactedWebhookEvidence,
  extractProviderCreatedAt,
} from "@/lib/webhooks/redaction";

// Phase 2D: pure functions, no I/O, no server-only marker — fully offline.

function fakeCapturedPaymentPayload(overrides: Record<string, unknown> = {}) {
  return {
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
          method: "netbanking",
          email: "customer@example.com",
          contact: "+911234567890",
          vpa: "someone@upi",
          card_id: "card_fake_id",
          bank: "HDFC",
          error_code: null,
          error_source: null,
          error_step: null,
          error_reason: null,
          notes: { secret_note: "do not leak" },
          ...overrides,
        },
      },
    },
  };
}

describe("buildRedactedWebhookEvidence", () => {
  it("extracts the safe top-level and payment-entity fields", () => {
    const evidence = buildRedactedWebhookEvidence(fakeCapturedPaymentPayload());

    expect(evidence.event).toBe("payment.captured");
    expect(evidence.entity).toBe("event");
    expect(evidence.created_at).toBe(1_800_000_000);
    expect(evidence.payment).toEqual({
      id: "pay_fake_id",
      order_id: "order_fake_id",
      amount: 50000,
      currency: "INR",
      status: "captured",
      error_code: null,
      error_source: null,
      error_step: null,
      error_reason: null,
    });
  });

  it("never includes email/contact/VPA/card/bank/notes/method — they are simply absent, not blanked", () => {
    const evidence = buildRedactedWebhookEvidence(fakeCapturedPaymentPayload());
    const serialized = JSON.stringify(evidence);

    for (const forbidden of [
      "email",
      "customer@example.com",
      "contact",
      "1234567890",
      "vpa",
      "upi",
      "card_id",
      "bank",
      "HDFC",
      "notes",
      "secret_note",
      "method",
      "netbanking",
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("never includes a webhook signature or secret field even if present in the payload", () => {
    const payload = fakeCapturedPaymentPayload();
    (payload as Record<string, unknown>).webhook_signature =
      "sig_should_never_leak";
    (payload as Record<string, unknown>).secret = "should_never_leak_either";

    const evidence = buildRedactedWebhookEvidence(payload);
    const serialized = JSON.stringify(evidence);

    expect(serialized).not.toContain("sig_should_never_leak");
    expect(serialized).not.toContain("should_never_leak_either");
  });

  it("extracts safe order-entity fields when present", () => {
    const orderPayload = {
      event: "order.paid",
      payload: {
        order: {
          entity: {
            id: "order_fake_id",
            amount: 50000,
            currency: "INR",
            status: "paid",
            receipt: "should-not-appear",
          },
        },
      },
    };

    const evidence = buildRedactedWebhookEvidence(orderPayload);
    expect(evidence.order).toEqual({
      id: "order_fake_id",
      amount: 50000,
      currency: "INR",
      status: "paid",
    });
    expect(JSON.stringify(evidence)).not.toContain("should-not-appear");
  });

  it("returns an empty object for a payload with no recognizable safe fields", () => {
    expect(buildRedactedWebhookEvidence({ unexpected: "shape" })).toEqual({});
  });

  it("returns an empty object (never throws) for non-object input", () => {
    expect(buildRedactedWebhookEvidence(null)).toEqual({});
    expect(buildRedactedWebhookEvidence("a string")).toEqual({});
    expect(buildRedactedWebhookEvidence([1, 2, 3])).toEqual({});
    expect(buildRedactedWebhookEvidence(undefined)).toEqual({});
  });

  it("ignores a non-scalar (nested object/array) value even for an allowlisted field name", () => {
    const payload = {
      payload: {
        payment: {
          entity: {
            id: { nested: "should not be copied" },
            amount: 50000,
          },
        },
      },
    };
    const evidence = buildRedactedWebhookEvidence(payload);
    expect(
      (evidence.payment as Record<string, unknown> | undefined)?.id,
    ).toBeUndefined();
    expect((evidence.payment as Record<string, unknown>).amount).toBe(50000);
  });
});

describe("extractProviderCreatedAt", () => {
  it("converts a valid Unix timestamp (seconds) to an ISO string", () => {
    const result = extractProviderCreatedAt({ created_at: 1_800_000_000 });
    expect(result).toBe(new Date(1_800_000_000 * 1000).toISOString());
  });

  it("returns null when created_at is missing", () => {
    expect(extractProviderCreatedAt({})).toBeNull();
  });

  it("returns null when created_at is not a number", () => {
    expect(extractProviderCreatedAt({ created_at: "not-a-number" })).toBeNull();
  });

  it("returns null when created_at is zero or negative", () => {
    expect(extractProviderCreatedAt({ created_at: 0 })).toBeNull();
    expect(extractProviderCreatedAt({ created_at: -5 })).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(extractProviderCreatedAt(null)).toBeNull();
    expect(extractProviderCreatedAt("string")).toBeNull();
  });
});
