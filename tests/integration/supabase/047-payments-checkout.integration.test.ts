import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import {
  getPaymentByRazorpayPaymentId,
  insertPaymentAttempt,
  insertVerifiedPayment,
  markPaymentAttemptOrderCreated,
} from "@/lib/demo-merchant/repository";
import { getSupabaseServerClient } from "@/lib/supabase/server";

import {
  getAnonClientForTest,
  taggedValue,
  testOrderInsert,
  trackAttempt,
  trackOrder,
} from "./helpers";

/**
 * Phase 2C — proves the additive migration
 * (20260825000000_phase2c_payments.sql) against the REAL Supabase project,
 * and that `lib/demo-merchant/repository.ts`'s new `payments` functions
 * work end-to-end. No Razorpay API is called anywhere in this file — every
 * `razorpay_payment_id` value used here is a synthetic, tagged placeholder,
 * never a real Razorpay identifier, and no Checkout signature verification
 * happens here (that is covered entirely offline by
 * tests/unit/razorpay/checkout-verification.test.ts and
 * tests/unit/demo-merchant/service.test.ts).
 *
 * Existing coverage this file deliberately does NOT duplicate:
 *   - orders/payment_attempts constraints and RLS (already covered by
 *     03-constraints.integration.test.ts / 04-anon-rls.integration.test.ts /
 *     046-payment-attempt-razorpay-correlation.integration.test.ts).
 */
describe("Phase 2C — payments table (real Supabase)", () => {
  const client = getSupabaseServerClient();

  const outstandingPaymentIds: string[] = [];
  const outstandingAttemptIds: string[] = [];
  const outstandingOrderIds: string[] = [];

  async function createTrackedOrder(amountSubunits: number): Promise<string> {
    const { data: order, error } = await client
      .from("orders")
      .insert(testOrderInsert(amountSubunits))
      .select()
      .single();
    expect(error).toBeNull();
    if (!order) throw new Error("expected orders insert to return a row");
    trackOrder(order.id);
    outstandingOrderIds.push(order.id);
    return order.id;
  }

  async function createTrackedAttempt(
    orderId: string,
    amountSubunits: number,
    label: string,
  ): Promise<string> {
    const attempt = await insertPaymentAttempt({
      orderId,
      attemptNo: 1,
      amountSubunits,
      currency: "INR",
      razorpayReceipt: taggedValue(label),
    });
    trackAttempt(attempt.id);
    outstandingAttemptIds.push(attempt.id);
    return attempt.id;
  }

  async function deleteTrackedPayment(paymentId: string): Promise<void> {
    await client.from("payments").delete().eq("id", paymentId);
    const idx = outstandingPaymentIds.indexOf(paymentId);
    if (idx !== -1) outstandingPaymentIds.splice(idx, 1);
  }

  async function deleteTrackedAttempt(attemptId: string): Promise<void> {
    await client.from("payment_attempts").delete().eq("id", attemptId);
    const idx = outstandingAttemptIds.indexOf(attemptId);
    if (idx !== -1) outstandingAttemptIds.splice(idx, 1);
  }

  async function deleteTrackedOrder(orderId: string): Promise<void> {
    await client.from("orders").delete().eq("id", orderId);
    const idx = outstandingOrderIds.indexOf(orderId);
    if (idx !== -1) outstandingOrderIds.splice(idx, 1);
  }

  it("insertVerifiedPayment persists a canonical row correlated to a real payment_attempts row, with checkout_signature_verified true and a non-null checkout_verified_at", async () => {
    const orderId = await createTrackedOrder(50_000);
    try {
      const attemptId = await createTrackedAttempt(
        orderId,
        50_000,
        "insert-verified-payment",
      );
      await markPaymentAttemptOrderCreated(attemptId, {
        razorpayOrderId: taggedValue("order-id"),
        razorpayOrderStatus: "created",
      });

      const razorpayPaymentId = taggedValue("payment-id");
      const inserted = await insertVerifiedPayment({
        paymentAttemptId: attemptId,
        razorpayPaymentId,
        amountSubunits: 50_000,
        currency: "INR",
      });
      expect(inserted).not.toBeNull();
      const payment = inserted!;
      outstandingPaymentIds.push(payment.id);

      try {
        expect(payment.payment_attempt_id).toBe(attemptId);
        expect(payment.razorpay_payment_id).toBe(razorpayPaymentId);
        expect(payment.checkout_signature_verified).toBe(true);
        expect(payment.checkout_verified_at).not.toBeNull();
        // Absent stronger provider evidence, these remain NULL — never
        // fabricated (docs/MONEY_INVARIANTS.md Section 5).
        expect(payment.razorpay_payment_status).toBeNull();
        expect(payment.captured_at).toBeNull();
        expect(payment.failed_at).toBeNull();

        const reread = await getPaymentByRazorpayPaymentId(razorpayPaymentId);
        expect(reread?.id).toBe(payment.id);

        // No credential/secret column exists on the row at all — the
        // returned key set is exhaustively the approved DATABASE.md
        // Section 11 field list.
        expect(Object.keys(payment).sort()).toEqual(
          [
            "amount_subunits",
            "captured_at",
            "checkout_signature_verified",
            "checkout_verified_at",
            "created_at",
            "currency",
            "error_code",
            "error_description_redacted",
            "error_reason",
            "error_source",
            "error_step",
            "failed_at",
            "first_observed_at",
            "id",
            "last_observed_at",
            "payment_attempt_id",
            "razorpay_payment_id",
            "razorpay_payment_status",
            "updated_at",
          ].sort(),
        );
      } finally {
        await deleteTrackedPayment(payment.id);
      }
    } finally {
      for (const attemptId of [...outstandingAttemptIds]) {
        await deleteTrackedAttempt(attemptId);
      }
      await deleteTrackedOrder(orderId);
    }
  });

  it("payment_attempt_id FK rejects a nonexistent payment attempt", async () => {
    const { data, error } = await client
      .from("payments")
      .insert({
        payment_attempt_id: randomUUID(),
        razorpay_payment_id: taggedValue("fk-reject"),
        amount_subunits: 50_000,
        currency: "INR",
      })
      .select()
      .single();

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23503");
    expect(data).toBeNull();
  });

  it("duplicate razorpay_payment_id is rejected by the database (23505)", async () => {
    const orderId = await createTrackedOrder(50_000);
    try {
      const attemptId = await createTrackedAttempt(
        orderId,
        50_000,
        "duplicate-payment-id",
      );

      const razorpayPaymentId = taggedValue("dup-payment-id");
      const first = await insertVerifiedPayment({
        paymentAttemptId: attemptId,
        razorpayPaymentId,
        amountSubunits: 50_000,
        currency: "INR",
      });
      expect(first).not.toBeNull();
      outstandingPaymentIds.push(first!.id);

      try {
        // insertVerifiedPayment itself treats 23505 as a race and returns
        // null (proven by the unit test) — here we exercise the raw
        // constraint directly to prove the database itself enforces it.
        const { data, error } = await client
          .from("payments")
          .insert({
            payment_attempt_id: attemptId,
            razorpay_payment_id: razorpayPaymentId,
            amount_subunits: 50_000,
            currency: "INR",
          })
          .select()
          .single();

        expect(error).not.toBeNull();
        expect(error?.code).toBe("23505");
        expect(data).toBeNull();
      } finally {
        await deleteTrackedPayment(first!.id);
      }
    } finally {
      for (const attemptId of [...outstandingAttemptIds]) {
        await deleteTrackedAttempt(attemptId);
      }
      await deleteTrackedOrder(orderId);
    }
  });

  it("amount_subunits <= 0 is rejected", async () => {
    for (const invalidAmount of [0, -1]) {
      const { data, error } = await client
        .from("payments")
        .insert({
          payment_attempt_id: randomUUID(),
          razorpay_payment_id: taggedValue(`amount-${invalidAmount}`),
          amount_subunits: invalidAmount,
          currency: "INR",
        })
        .select()
        .single();

      expect(error).not.toBeNull();
      expect(data).toBeNull();
    }
  });

  it("an invalid lowercase currency is rejected", async () => {
    const { data, error } = await client
      .from("payments")
      .insert({
        payment_attempt_id: randomUUID(),
        razorpay_payment_id: taggedValue("lowercase-currency"),
        amount_subunits: 50_000,
        currency: "inr",
      })
      .select()
      .single();

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("checkout_verified_at consistency constraint: checkout_signature_verified=true with a NULL checkout_verified_at is rejected", async () => {
    const orderId = await createTrackedOrder(50_000);
    try {
      const attemptId = await createTrackedAttempt(
        orderId,
        50_000,
        "consistency-reject",
      );

      const { data, error } = await client
        .from("payments")
        .insert({
          payment_attempt_id: attemptId,
          razorpay_payment_id: taggedValue("consistency-reject"),
          amount_subunits: 50_000,
          currency: "INR",
          checkout_signature_verified: true,
          checkout_verified_at: null,
        })
        .select()
        .single();

      expect(error).not.toBeNull();
      expect(error?.code).toBe("23514");
      expect(data).toBeNull();
    } finally {
      for (const attemptId of [...outstandingAttemptIds]) {
        await deleteTrackedAttempt(attemptId);
      }
      await deleteTrackedOrder(orderId);
    }
  });

  it("checkout_signature_verified=false with a NULL checkout_verified_at is allowed (the default, unverified state)", async () => {
    const orderId = await createTrackedOrder(50_000);
    try {
      const attemptId = await createTrackedAttempt(
        orderId,
        50_000,
        "consistency-allow",
      );

      const { data: payment, error } = await client
        .from("payments")
        .insert({
          payment_attempt_id: attemptId,
          razorpay_payment_id: taggedValue("consistency-allow"),
          amount_subunits: 50_000,
          currency: "INR",
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(payment).not.toBeNull();
      expect(payment!.checkout_signature_verified).toBe(false);
      expect(payment!.checkout_verified_at).toBeNull();
      outstandingPaymentIds.push(payment!.id);
      await deleteTrackedPayment(payment!.id);
    } finally {
      for (const attemptId of [...outstandingAttemptIds]) {
        await deleteTrackedAttempt(attemptId);
      }
      await deleteTrackedOrder(orderId);
    }
  });

  afterAll(async () => {
    // Dependency-safe defensive cleanup: payments before payment_attempts
    // before orders.
    for (const id of [...outstandingPaymentIds]) {
      await client.from("payments").delete().eq("id", id);
    }
    for (const id of [...outstandingAttemptIds]) {
      await client.from("payment_attempts").delete().eq("id", id);
    }
    for (const id of [...outstandingOrderIds]) {
      await client.from("orders").delete().eq("id", id);
    }
  });
});

describe("Phase 2C — anon client is denied on payments", () => {
  const anon = getAnonClientForTest();
  const service = getSupabaseServerClient();

  it("SELECT is denied", async () => {
    const { data, error } = await anon.from("payments").select("id").limit(1);
    expect(error).not.toBeNull();
    expect(data === null || data.length === 0).toBe(true);
  });

  it("INSERT is denied and no row is created", async () => {
    const razorpayPaymentId = taggedValue("anon-insert-payment");
    const { error } = await anon.from("payments").insert({
      payment_attempt_id: randomUUID(),
      razorpay_payment_id: razorpayPaymentId,
      amount_subunits: 50_000,
      currency: "INR",
    });
    expect(error).not.toBeNull();

    const { count, error: verifyError } = await service
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("razorpay_payment_id", razorpayPaymentId);
    expect(verifyError).toBeNull();
    expect(count).toBe(0);
  });

  it("UPDATE is denied (target: random non-existent UUID)", async () => {
    const { error } = await anon
      .from("payments")
      .update({ checkout_signature_verified: true })
      .eq("id", randomUUID());
    expect(error).not.toBeNull();
  });

  it("DELETE is denied (target: random non-existent UUID)", async () => {
    const { error } = await anon
      .from("payments")
      .delete()
      .eq("id", randomUUID());
    expect(error).not.toBeNull();
  });
});
