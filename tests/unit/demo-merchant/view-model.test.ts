import { describe, expect, it } from "vitest";

import {
  formatAmountForDisplay,
  formatConceptualState,
  toDemoMerchantOrderViewModel,
  toPaymentAttemptViewModel,
  toPaymentViewModel,
} from "@/lib/demo-merchant/view-model";
import type { Database } from "@/lib/supabase/types";

// Phase 1E/2B/2C: pure DB-row -> view-model mapping and display formatting —
// no Supabase/network — fully offline.

type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
type PaymentAttemptRow =
  Database["public"]["Tables"]["payment_attempts"]["Row"];
type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];

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

function paymentRow(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: "payment-1",
    payment_attempt_id: "attempt-1",
    razorpay_payment_id: "pay_fake_id",
    razorpay_payment_status: null,
    amount_subunits: 50000,
    currency: "INR",
    checkout_signature_verified: true,
    checkout_verified_at: "2026-01-01T00:00:00.000Z",
    first_observed_at: "2026-01-01T00:00:00.000Z",
    last_observed_at: "2026-01-01T00:00:00.000Z",
    captured_at: null,
    failed_at: null,
    error_code: null,
    error_description_redacted: null,
    error_source: null,
    error_step: null,
    error_reason: null,
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
  it("maps a fresh UNPAID/OPEN row with 0 fulfilments to conceptualState=CREATED, latestPaymentAttempt=null and latestPayment=null by default", () => {
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
      latestPayment: null,
    });
  });

  it("maps the latest verified payment row when one is supplied", () => {
    const vm = toDemoMerchantOrderViewModel(
      row(),
      0,
      attemptRow(),
      paymentRow({ razorpay_payment_status: "authorized" }),
    );
    expect(vm.latestPayment).toEqual({
      id: "payment-1",
      paymentAttemptId: "attempt-1",
      razorpayPaymentId: "pay_fake_id",
      razorpayPaymentStatus: "authorized",
      checkoutSignatureVerified: true,
      checkoutVerifiedAt: "2026-01-01T00:00:00.000Z",
      capturedAt: null,
      failedAt: null,
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

describe("toPaymentViewModel", () => {
  it("maps every field, never including the Checkout signature (it is never part of the row at all)", () => {
    const vm = toPaymentViewModel(paymentRow());
    expect(vm).toEqual({
      id: "payment-1",
      paymentAttemptId: "attempt-1",
      razorpayPaymentId: "pay_fake_id",
      razorpayPaymentStatus: null,
      checkoutSignatureVerified: true,
      checkoutVerifiedAt: "2026-01-01T00:00:00.000Z",
      capturedAt: null,
      failedAt: null,
    });
    // Structural: PaymentRow itself has no signature-shaped field, so the
    // view model cannot leak one even by accident.
    expect(Object.keys(paymentRow())).not.toContain("razorpay_signature");
  });

  it("maps null razorpay_payment_status/captured_at/failed_at as null (never fabricated)", () => {
    const vm = toPaymentViewModel(paymentRow());
    expect(vm.razorpayPaymentStatus).toBeNull();
    expect(vm.capturedAt).toBeNull();
    expect(vm.failedAt).toBeNull();
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
