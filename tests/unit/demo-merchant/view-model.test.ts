import { describe, expect, it } from "vitest";

import {
  formatAmountForDisplay,
  formatConceptualState,
  toDemoMerchantOrderViewModel,
  toPaymentAttemptViewModel,
} from "@/lib/demo-merchant/view-model";
import type { Database } from "@/lib/supabase/types";

// Phase 1E/2B: pure DB-row -> view-model mapping and display formatting —
// no Supabase/network — fully offline.

type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
type PaymentAttemptRow =
  Database["public"]["Tables"]["payment_attempts"]["Row"];

function row(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    amount_subunits: 50000,
    currency: "INR",
    payment_status: "UNPAID",
    business_status: "OPEN",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function attemptRow(
  overrides: Partial<PaymentAttemptRow> = {},
): PaymentAttemptRow {
  return {
    id: "attempt-1",
    order_id: "11111111-1111-1111-1111-111111111111",
    attempt_no: 1,
    amount_subunits: 50000,
    currency: "INR",
    status: "CREATED",
    razorpay_receipt: "receipt-1",
    razorpay_order_id: null,
    razorpay_order_status: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("formatAmountForDisplay", () => {
  it("formats INR subunits as a rupee amount with 2 decimals", () => {
    expect(formatAmountForDisplay(50000, "INR")).toBe("₹500.00");
  });

  it("formats a single-digit-paise amount correctly (no truncation)", () => {
    expect(formatAmountForDisplay(1, "INR")).toBe("₹0.01");
  });

  it("formats a non-INR currency with a currency-code prefix instead of ₹", () => {
    expect(formatAmountForDisplay(50000, "USD")).toBe("USD 500.00");
  });
});

describe("toDemoMerchantOrderViewModel", () => {
  it("maps a fresh UNPAID/OPEN row with 0 fulfilments to conceptualState=CREATED, latestPaymentAttempt=null by default", () => {
    const vm = toDemoMerchantOrderViewModel(row(), 0);

    expect(vm).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      amountSubunits: 50000,
      currency: "INR",
      paymentStatus: "UNPAID",
      businessStatus: "OPEN",
      fulfilmentCount: 0,
      conceptualState: "CREATED",
      createdAt: "2026-01-01T00:00:00.000Z",
      latestPaymentAttempt: null,
    });
  });

  it("maps PENDING/OPEN to PAYMENT_PENDING", () => {
    const vm = toDemoMerchantOrderViewModel(
      row({ payment_status: "PENDING" }),
      0,
    );
    expect(vm.conceptualState).toBe("PAYMENT_PENDING");
  });

  it("delegates impossible-state rejection to the approved Phase 1D projection (FULFILLED without PAID)", () => {
    expect(() =>
      toDemoMerchantOrderViewModel(row({ business_status: "FULFILLED" }), 1),
    ).toThrow();
  });

  it("maps the latest payment attempt row when one is supplied", () => {
    const vm = toDemoMerchantOrderViewModel(row(), 0, attemptRow());
    expect(vm.latestPaymentAttempt).toEqual({
      id: "attempt-1",
      orderId: "11111111-1111-1111-1111-111111111111",
      attemptNo: 1,
      amountSubunits: 50000,
      currency: "INR",
      status: "CREATED",
      razorpayReceipt: "receipt-1",
      razorpayOrderId: null,
      razorpayOrderStatus: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("toPaymentAttemptViewModel", () => {
  it("maps every field, including Razorpay correlation fields when present", () => {
    const vm = toPaymentAttemptViewModel(
      attemptRow({
        status: "ORDER_CREATED",
        razorpay_order_id: "order_fake_id",
        razorpay_order_status: "created",
      }),
    );
    expect(vm).toEqual({
      id: "attempt-1",
      orderId: "11111111-1111-1111-1111-111111111111",
      attemptNo: 1,
      amountSubunits: 50000,
      currency: "INR",
      status: "ORDER_CREATED",
      razorpayReceipt: "receipt-1",
      razorpayOrderId: "order_fake_id",
      razorpayOrderStatus: "created",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("maps null Razorpay correlation fields as null (never fabricated)", () => {
    const vm = toPaymentAttemptViewModel(attemptRow());
    expect(vm.razorpayOrderId).toBeNull();
    expect(vm.razorpayOrderStatus).toBeNull();
  });
});

describe("formatConceptualState", () => {
  it("labels CREATED as 'Created', never implying a payment failure", () => {
    const label = formatConceptualState("CREATED");
    expect(label).toBe("Created");
    expect(label.toLowerCase()).not.toContain("fail");
  });

  it("labels PAYMENT_FAILED distinctly from CREATED/UNPAID", () => {
    expect(formatConceptualState("PAYMENT_FAILED")).not.toBe(
      formatConceptualState("CREATED"),
    );
  });
});
