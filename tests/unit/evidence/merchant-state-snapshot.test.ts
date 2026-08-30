import { describe, expect, it, vi } from "vitest";

/**
 * Phase 3E-A — `lib/evidence/merchant-state-snapshot.ts` is a PURE module:
 * no Supabase client, no network, no clock, no randomness. These tests
 * therefore need no database mock at all, only the standard `server-only`
 * stub every server module in this codebase requires under Vitest.
 *
 * Real-Supabase behavior of the columns these snapshots are persisted into
 * is separately covered by
 * tests/integration/supabase/060-phase3e-evidence-snapshot.integration.test.ts,
 * which remains NOT RUN until the Phase 3E-A migration is manually applied.
 */
vi.mock("server-only", () => ({}));

import {
  MERCHANT_STATE_SNAPSHOT_VERSION,
  buildMerchantStateSnapshot,
  serializeMerchantStateSnapshot,
  type MerchantStateSnapshotSourceFulfilmentRow,
  type MerchantStateSnapshotSourceOrderRow,
  type MerchantStateSnapshotSourcePaymentAttemptRow,
  type MerchantStateSnapshotSourcePaymentRow,
} from "@/lib/evidence/merchant-state-snapshot";

const ORDER_ID = "11111111-1111-1111-1111-111111111111";
const ATTEMPT_ID = "22222222-2222-2222-2222-222222222222";
const PAYMENT_ID = "33333333-3333-3333-3333-333333333333";
const PROC_ATTEMPT_ID = "44444444-4444-4444-4444-444444444444";

function orderRow(
  overrides: Partial<MerchantStateSnapshotSourceOrderRow> = {},
): MerchantStateSnapshotSourceOrderRow {
  return {
    id: ORDER_ID,
    payment_status: "PAID",
    business_status: "FULFILLED",
    amount_subunits: 49900,
    currency: "INR",
    ...overrides,
  };
}

function paymentAttemptRow(
  overrides: Partial<MerchantStateSnapshotSourcePaymentAttemptRow> = {},
): MerchantStateSnapshotSourcePaymentAttemptRow {
  return {
    id: ATTEMPT_ID,
    order_id: ORDER_ID,
    status: "CAPTURED",
    amount_subunits: 49900,
    currency: "INR",
    razorpay_order_id: "order_TESTMODE123",
    razorpay_order_status: "paid",
    ...overrides,
  };
}

function capturedPaymentRow(
  overrides: Partial<MerchantStateSnapshotSourcePaymentRow> = {},
): MerchantStateSnapshotSourcePaymentRow {
  return {
    id: PAYMENT_ID,
    payment_attempt_id: ATTEMPT_ID,
    razorpay_payment_id: "pay_TESTMODE123",
    razorpay_payment_status: "captured",
    amount_subunits: 49900,
    currency: "INR",
    checkout_signature_verified: true,
    captured_at: "2026-01-01T10:00:00.000Z",
    failed_at: null,
    ...overrides,
  };
}

function fulfilmentRow(
  id: string,
  overrides: Partial<MerchantStateSnapshotSourceFulfilmentRow> = {},
): MerchantStateSnapshotSourceFulfilmentRow {
  return {
    id,
    order_id: ORDER_ID,
    payment_id: PAYMENT_ID,
    trigger_processing_attempt_id: PROC_ATTEMPT_ID,
    effect_type: "FULFIL_ORDER",
    applied_at: "2026-01-01T10:00:01.000Z",
    ...overrides,
  };
}

describe("buildMerchantStateSnapshot — complete captured-payment snapshot", () => {
  it("1: projects every allowlisted order/attempt/payment/fulfilment field, and nothing else", () => {
    const snapshot = buildMerchantStateSnapshot({
      order: orderRow(),
      paymentAttempt: paymentAttemptRow(),
      payment: capturedPaymentRow(),
      fulfilments: [fulfilmentRow("aaaaaaaa-0000-0000-0000-000000000001")],
    });

    expect(snapshot).toEqual({
      version: 1,
      order: {
        id: ORDER_ID,
        paymentStatus: "PAID",
        businessStatus: "FULFILLED",
        amountSubunits: 49900,
        currency: "INR",
      },
      paymentAttempt: {
        id: ATTEMPT_ID,
        orderId: ORDER_ID,
        status: "CAPTURED",
        amountSubunits: 49900,
        currency: "INR",
        razorpayOrderId: "order_TESTMODE123",
        razorpayOrderStatus: "paid",
      },
      payment: {
        id: PAYMENT_ID,
        paymentAttemptId: ATTEMPT_ID,
        razorpayPaymentId: "pay_TESTMODE123",
        razorpayPaymentStatus: "captured",
        amountSubunits: 49900,
        currency: "INR",
        checkoutSignatureVerified: true,
        capturedAt: "2026-01-01T10:00:00.000Z",
        failedAt: null,
      },
      fulfilments: [
        {
          id: "aaaaaaaa-0000-0000-0000-000000000001",
          orderId: ORDER_ID,
          paymentId: PAYMENT_ID,
          triggerProcessingAttemptId: PROC_ATTEMPT_ID,
          effectType: "FULFIL_ORDER",
          appliedAt: "2026-01-01T10:00:01.000Z",
          // This source row carries no idempotency column, so the snapshot
          // records NOT CAPTURED rather than deriving one.
          idempotencyKey: null,
        },
      ],
    });
  });

  it("2: stamps the versioned envelope", () => {
    const snapshot = buildMerchantStateSnapshot({
      order: orderRow(),
      paymentAttempt: paymentAttemptRow(),
      payment: capturedPaymentRow(),
      fulfilments: [],
    });
    expect(snapshot.version).toBe(1);
    expect(MERCHANT_STATE_SNAPSHOT_VERSION).toBe(1);
  });
});

describe("buildMerchantStateSnapshot — failed-payment snapshot", () => {
  it("3: preserves failed_at / a null captured_at / the failed provider status, and never invents a fulfilment", () => {
    const snapshot = buildMerchantStateSnapshot({
      order: orderRow({
        payment_status: "FAILED_OBSERVED",
        business_status: "OPEN",
      }),
      paymentAttempt: paymentAttemptRow({ status: "FAILED_OBSERVED" }),
      payment: capturedPaymentRow({
        razorpay_payment_status: "failed",
        checkout_signature_verified: false,
        captured_at: null,
        failed_at: "2026-01-01T11:00:00.000Z",
      }),
      fulfilments: [],
    });

    expect(snapshot.order?.paymentStatus).toBe("FAILED_OBSERVED");
    expect(snapshot.order?.businessStatus).toBe("OPEN");
    expect(snapshot.paymentAttempt?.status).toBe("FAILED_OBSERVED");
    expect(snapshot.payment?.razorpayPaymentStatus).toBe("failed");
    expect(snapshot.payment?.checkoutSignatureVerified).toBe(false);
    expect(snapshot.payment?.capturedAt).toBeNull();
    expect(snapshot.payment?.failedAt).toBe("2026-01-01T11:00:00.000Z");
    expect(snapshot.fulfilments).toEqual([]);
  });
});

describe("buildMerchantStateSnapshot — missing entities stay null, never invented", () => {
  it("4: payment absent -> payment is null (never a fabricated placeholder)", () => {
    const snapshot = buildMerchantStateSnapshot({
      order: orderRow({ payment_status: "PENDING" }),
      paymentAttempt: paymentAttemptRow({ status: "CHECKOUT_IN_PROGRESS" }),
      payment: null,
      fulfilments: [],
    });
    expect(snapshot.payment).toBeNull();
    expect(snapshot.order).not.toBeNull();
  });

  it("5: order absent -> order is null AND fulfilments is null, because [] would positively claim 'this order had zero fulfilments'", () => {
    const snapshot = buildMerchantStateSnapshot({
      order: null,
      paymentAttempt: null,
      payment: null,
      fulfilments: null,
    });
    expect(snapshot).toEqual({
      version: 1,
      order: null,
      paymentAttempt: null,
      payment: null,
      fulfilments: null,
    });
  });

  it("6: a resolved order with zero fulfilment rows -> [] (a genuine, positive 'zero' claim)", () => {
    const snapshot = buildMerchantStateSnapshot({
      order: orderRow(),
      paymentAttempt: paymentAttemptRow(),
      payment: capturedPaymentRow(),
      fulfilments: [],
    });
    expect(snapshot.fulfilments).toEqual([]);
    expect(snapshot.fulfilments).not.toBeNull();
  });

  it("7: a payment attempt with no Razorpay Order correlation keeps both correlation fields null", () => {
    const snapshot = buildMerchantStateSnapshot({
      order: orderRow({ payment_status: "UNPAID", business_status: "OPEN" }),
      paymentAttempt: paymentAttemptRow({
        status: "CREATED",
        razorpay_order_id: null,
        razorpay_order_status: null,
      }),
      payment: null,
      fulfilments: [],
    });
    expect(snapshot.paymentAttempt?.razorpayOrderId).toBeNull();
    expect(snapshot.paymentAttempt?.razorpayOrderStatus).toBeNull();
  });
});

describe("buildMerchantStateSnapshot — fulfilment ordering is deterministic", () => {
  it("8: one fulfilment round-trips unchanged", () => {
    const snapshot = buildMerchantStateSnapshot({
      order: orderRow(),
      paymentAttempt: paymentAttemptRow(),
      payment: capturedPaymentRow(),
      fulfilments: [fulfilmentRow("bbbbbbbb-0000-0000-0000-000000000002")],
    });
    expect(snapshot.fulfilments).toHaveLength(1);
    expect(snapshot.fulfilments?.[0]?.id).toBe(
      "bbbbbbbb-0000-0000-0000-000000000002",
    );
  });

  it("9: multiple fulfilments are sorted by id ascending regardless of the order the database returned them in", () => {
    const ids = [
      "cccccccc-0000-0000-0000-000000000003",
      "aaaaaaaa-0000-0000-0000-000000000001",
      "dddddddd-0000-0000-0000-000000000004",
      "bbbbbbbb-0000-0000-0000-000000000002",
    ];
    const snapshot = buildMerchantStateSnapshot({
      order: orderRow(),
      paymentAttempt: paymentAttemptRow(),
      payment: capturedPaymentRow(),
      fulfilments: ids.map((id) => fulfilmentRow(id)),
    });
    expect(snapshot.fulfilments?.map((f) => f.id)).toEqual([
      "aaaaaaaa-0000-0000-0000-000000000001",
      "bbbbbbbb-0000-0000-0000-000000000002",
      "cccccccc-0000-0000-0000-000000000003",
      "dddddddd-0000-0000-0000-000000000004",
    ]);
  });

  it("10: any input permutation of the same rows produces the identical output array", () => {
    const rows = [
      fulfilmentRow("cccccccc-0000-0000-0000-000000000003"),
      fulfilmentRow("aaaaaaaa-0000-0000-0000-000000000001"),
      fulfilmentRow("bbbbbbbb-0000-0000-0000-000000000002"),
    ];
    const forward = buildMerchantStateSnapshot({
      order: orderRow(),
      paymentAttempt: paymentAttemptRow(),
      payment: capturedPaymentRow(),
      fulfilments: rows,
    });
    const reversed = buildMerchantStateSnapshot({
      order: orderRow(),
      paymentAttempt: paymentAttemptRow(),
      payment: capturedPaymentRow(),
      fulfilments: [...rows].reverse(),
    });
    expect(reversed).toEqual(forward);
  });

  it("11: never mutates the caller's input array", () => {
    const rows = [
      fulfilmentRow("cccccccc-0000-0000-0000-000000000003"),
      fulfilmentRow("aaaaaaaa-0000-0000-0000-000000000001"),
    ];
    const originalOrder = rows.map((r) => r.id);
    buildMerchantStateSnapshot({
      order: orderRow(),
      paymentAttempt: paymentAttemptRow(),
      payment: capturedPaymentRow(),
      fulfilments: rows,
    });
    expect(rows.map((r) => r.id)).toEqual(originalOrder);
  });
});

describe("buildMerchantStateSnapshot — money is integer subunits plus an exact currency", () => {
  it("12: amount_subunits is preserved as the exact integer, never converted to a float/major unit", () => {
    const snapshot = buildMerchantStateSnapshot({
      order: orderRow({ amount_subunits: 1 }),
      paymentAttempt: paymentAttemptRow({ amount_subunits: 1 }),
      payment: capturedPaymentRow({ amount_subunits: 1 }),
      fulfilments: [],
    });
    expect(snapshot.order?.amountSubunits).toBe(1);
    expect(Number.isInteger(snapshot.order?.amountSubunits)).toBe(true);
    expect(snapshot.paymentAttempt?.amountSubunits).toBe(1);
    expect(snapshot.payment?.amountSubunits).toBe(1);
  });

  it("13: a large integer amount survives exactly", () => {
    const snapshot = buildMerchantStateSnapshot({
      order: orderRow({ amount_subunits: 99999999 }),
      paymentAttempt: paymentAttemptRow({ amount_subunits: 99999999 }),
      payment: capturedPaymentRow({ amount_subunits: 99999999 }),
      fulfilments: [],
    });
    expect(snapshot.order?.amountSubunits).toBe(99999999);
    expect(snapshot.payment?.amountSubunits).toBe(99999999);
  });

  it("14: currency is preserved exactly, on every entity that carries one", () => {
    const snapshot = buildMerchantStateSnapshot({
      order: orderRow({ currency: "USD" }),
      paymentAttempt: paymentAttemptRow({ currency: "USD" }),
      payment: capturedPaymentRow({ currency: "USD" }),
      fulfilments: [],
    });
    expect(snapshot.order?.currency).toBe("USD");
    expect(snapshot.paymentAttempt?.currency).toBe("USD");
    expect(snapshot.payment?.currency).toBe("USD");
  });

  it("15: an order/payment currency disagreement is recorded faithfully, never normalized away (Phase 3F decides what it means, not this module)", () => {
    const snapshot = buildMerchantStateSnapshot({
      order: orderRow({ currency: "INR" }),
      paymentAttempt: paymentAttemptRow({ currency: "INR" }),
      payment: capturedPaymentRow({ currency: "USD" }),
      fulfilments: [],
    });
    expect(snapshot.order?.currency).toBe("INR");
    expect(snapshot.payment?.currency).toBe("USD");
  });
});

describe("buildMerchantStateSnapshot — determinism", () => {
  it("16: two builds from identical rows are deeply equal", () => {
    const source = {
      order: orderRow(),
      paymentAttempt: paymentAttemptRow(),
      payment: capturedPaymentRow(),
      fulfilments: [
        fulfilmentRow("bbbbbbbb-0000-0000-0000-000000000002"),
        fulfilmentRow("aaaaaaaa-0000-0000-0000-000000000001"),
      ],
    };
    const first = buildMerchantStateSnapshot(source);
    const second = buildMerchantStateSnapshot(source);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("17: serialization of two independently-built identical snapshots is byte-identical (no timestamp, no uuid, no counter is injected)", () => {
    const build = () =>
      serializeMerchantStateSnapshot(
        buildMerchantStateSnapshot({
          order: orderRow(),
          paymentAttempt: paymentAttemptRow(),
          payment: capturedPaymentRow(),
          fulfilments: [fulfilmentRow("aaaaaaaa-0000-0000-0000-000000000001")],
        }),
      );
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});

describe("serializeMerchantStateSnapshot", () => {
  it("18: returns a plain JSON OBJECT (satisfying the database jsonb_typeof = 'object' CHECK), never an array or scalar", () => {
    const value = serializeMerchantStateSnapshot(
      buildMerchantStateSnapshot({
        order: null,
        paymentAttempt: null,
        payment: null,
        fulfilments: null,
      }),
    );
    expect(typeof value).toBe("object");
    expect(value).not.toBeNull();
    expect(Array.isArray(value)).toBe(false);
  });

  it("19: round-trips through JSON without loss", () => {
    const snapshot = buildMerchantStateSnapshot({
      order: orderRow(),
      paymentAttempt: paymentAttemptRow(),
      payment: capturedPaymentRow(),
      fulfilments: [fulfilmentRow("aaaaaaaa-0000-0000-0000-000000000001")],
    });
    const serialized = serializeMerchantStateSnapshot(snapshot);
    expect(JSON.parse(JSON.stringify(serialized))).toEqual(serialized);
  });

  it("20: contains no `undefined` value anywhere (an undefined would silently vanish on the way into jsonb)", () => {
    const serialized = serializeMerchantStateSnapshot(
      buildMerchantStateSnapshot({
        order: orderRow(),
        paymentAttempt: paymentAttemptRow(),
        payment: capturedPaymentRow({ captured_at: null, failed_at: null }),
        fulfilments: [
          fulfilmentRow("aaaaaaaa-0000-0000-0000-000000000001", {
            trigger_processing_attempt_id: null,
          }),
        ],
      }),
    );
    const seen: unknown[] = [];
    const walk = (value: unknown): void => {
      expect(value).not.toBeUndefined();
      if (value && typeof value === "object") {
        seen.push(value);
        for (const child of Object.values(value as Record<string, unknown>)) {
          walk(child);
        }
      }
    };
    walk(serialized);
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe("snapshot output carries no raw payload / signature / secret / PII", () => {
  it("21: forbidden fields present on the SOURCE rows never reach the output — the projection is an explicit allowlist, not a spread", () => {
    // Deliberately polluted source rows. Assigned to variables first so
    // TypeScript's excess-property check does not reject them at the call
    // site — the point of this test is precisely that a row carrying extra
    // columns (as a future migration could produce) cannot leak them.
    const pollutedOrder = {
      ...orderRow(),
      raw_payload_redacted: { card: { number: "4111111111111111" } },
      customer_email: "person@example.com",
      customer_phone: "+919999999999",
      customer_name: "Real Person",
    };
    const pollutedAttempt = {
      ...paymentAttemptRow(),
      razorpay_key_secret: "rzp_secret_value",
      webhook_secret: "whsec_value",
    };
    const pollutedPayment = {
      ...capturedPaymentRow(),
      checkout_signature: "deadbeefsignature",
      cvv: "123",
      otp: "654321",
      card_number: "4111111111111111",
      error_description_redacted: "some provider prose",
    };
    const pollutedFulfilment = {
      ...fulfilmentRow("aaaaaaaa-0000-0000-0000-000000000001"),
      idempotency_key: "fulfil:order:payment",
      llm_explanation: "the model thinks this is fine",
      diagnosis: "RC-001",
      confidence: 0.93,
    };

    const serialized = serializeMerchantStateSnapshot(
      buildMerchantStateSnapshot({
        order: pollutedOrder,
        paymentAttempt: pollutedAttempt,
        payment: pollutedPayment,
        fulfilments: [pollutedFulfilment],
      }),
    );
    const asText = JSON.stringify(serialized);

    for (const forbidden of [
      "raw_payload_redacted",
      "rawPayload",
      "customer_email",
      "person@example.com",
      "customer_phone",
      "+919999999999",
      "customer_name",
      "Real Person",
      "razorpay_key_secret",
      "rzp_secret_value",
      "webhook_secret",
      "whsec_value",
      "checkout_signature",
      "deadbeefsignature",
      "cvv",
      "otp",
      "654321",
      "card_number",
      "4111111111111111",
      "error_description_redacted",
      "some provider prose",
      "idempotency_key",
      "llm_explanation",
      "diagnosis",
      "confidence",
    ]) {
      expect(asText).not.toContain(forbidden);
    }
  });

  it("22: the output's top-level key set is exactly the declared contract", () => {
    const serialized = serializeMerchantStateSnapshot(
      buildMerchantStateSnapshot({
        order: orderRow(),
        paymentAttempt: paymentAttemptRow(),
        payment: capturedPaymentRow(),
        fulfilments: [fulfilmentRow("aaaaaaaa-0000-0000-0000-000000000001")],
      }),
    );
    expect(Object.keys(serialized).sort()).toEqual([
      "fulfilments",
      "order",
      "payment",
      "paymentAttempt",
      "version",
    ]);
  });

  it("23: each nested entity's key set is exactly the declared contract", () => {
    const serialized = serializeMerchantStateSnapshot(
      buildMerchantStateSnapshot({
        order: orderRow(),
        paymentAttempt: paymentAttemptRow(),
        payment: capturedPaymentRow(),
        fulfilments: [fulfilmentRow("aaaaaaaa-0000-0000-0000-000000000001")],
      }),
    ) as {
      order: Record<string, unknown>;
      paymentAttempt: Record<string, unknown>;
      payment: Record<string, unknown>;
      fulfilments: Record<string, unknown>[];
    };

    expect(Object.keys(serialized.order).sort()).toEqual([
      "amountSubunits",
      "businessStatus",
      "currency",
      "id",
      "paymentStatus",
    ]);
    expect(Object.keys(serialized.paymentAttempt).sort()).toEqual([
      "amountSubunits",
      "currency",
      "id",
      "orderId",
      "razorpayOrderId",
      "razorpayOrderStatus",
      "status",
    ]);
    expect(Object.keys(serialized.payment).sort()).toEqual([
      "amountSubunits",
      "capturedAt",
      "checkoutSignatureVerified",
      "currency",
      "failedAt",
      "id",
      "paymentAttemptId",
      "razorpayPaymentId",
      "razorpayPaymentStatus",
    ]);
    expect(Object.keys(serialized.fulfilments[0]!).sort()).toEqual([
      "appliedAt",
      "effectType",
      "id",
      "idempotencyKey",
      "orderId",
      "paymentId",
      "triggerProcessingAttemptId",
    ]);
  });

  it("24: carries no invariant verdict, finding, score, or recommendation field — Phase 3E records facts only", () => {
    const asText = JSON.stringify(
      serializeMerchantStateSnapshot(
        buildMerchantStateSnapshot({
          order: orderRow(),
          paymentAttempt: paymentAttemptRow(),
          payment: capturedPaymentRow(),
          fulfilments: [],
        }),
      ),
    );
    for (const forbidden of [
      "PASS",
      "FAIL",
      "UNKNOWN",
      "invariant",
      "finding",
      "recommendation",
      "rootCause",
      "score",
    ]) {
      expect(asText).not.toContain(forbidden);
    }
  });
});
