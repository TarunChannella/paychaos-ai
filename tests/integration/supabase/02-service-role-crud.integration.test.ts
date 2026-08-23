import { afterAll, describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";

import {
  taggedValue,
  testOrderInsert,
  trackAttempt,
  trackOrder,
} from "./helpers";

/**
 * Phase 1C-B Task 5 — real service-role write path, uniquely-tagged test
 * data, against the REAL Supabase project. No Razorpay/external API is
 * called anywhere in this file — these are internal placeholder records
 * only.
 */
describe("Task 5 — real service-role order + payment_attempt CRUD", () => {
  const client = getSupabaseServerClient();

  // Defensive cleanup ledger for THIS file only: rows pushed here are
  // deleted in afterAll if a per-test try/finally didn't already remove
  // them (e.g. an assertion threw before reaching its own cleanup).
  const outstandingAttemptIds: string[] = [];
  const outstandingOrderIds: string[] = [];

  it("A-D: create, read back, update (UNPAID -> PENDING), then delete one orders row", async () => {
    const { data: created, error: insertError } = await client
      .from("orders")
      .insert(testOrderInsert(50_000))
      .select()
      .single();

    expect(insertError).toBeNull();
    if (!created)
      throw new Error("expected orders insert to return the created row");

    trackOrder(created.id);
    outstandingOrderIds.push(created.id);
    const orderId = created.id;

    try {
      // B: read back
      const { data: readBack, error: readError } = await client
        .from("orders")
        .select("*")
        .eq("id", orderId)
        .single();
      expect(readError).toBeNull();
      expect(readBack?.amount_subunits).toBe(50_000);
      expect(readBack?.currency).toBe("INR");
      expect(readBack?.payment_status).toBe("UNPAID");
      expect(readBack?.business_status).toBe("OPEN");

      // C: UNPAID -> PENDING. This is a raw service-role DB-access check
      // proving the row is mutable and that PENDING is accepted by the
      // orders_payment_status_valid CHECK constraint. It is NOT a claim
      // that this is how a future Phase 1D domain state machine will
      // perform or authorize this transition — that belongs to Phase 1D
      // application code, outside this infrastructure-verification suite.
      const { data: updated, error: updateError } = await client
        .from("orders")
        .update({ payment_status: "PENDING" })
        .eq("id", orderId)
        .select()
        .single();
      expect(updateError).toBeNull();
      expect(updated?.payment_status).toBe("PENDING");
    } finally {
      // D: delete (no dependents exist for this order in this test)
      const { error: deleteError } = await client
        .from("orders")
        .delete()
        .eq("id", orderId);
      expect(deleteError).toBeNull();
      const idx = outstandingOrderIds.indexOf(orderId);
      if (idx !== -1) outstandingOrderIds.splice(idx, 1);
    }
  });

  it("payment_attempts CRUD: create/read/delete via service-role with a valid parent order", async () => {
    const { data: order, error: orderError } = await client
      .from("orders")
      .insert(testOrderInsert(75_000))
      .select()
      .single();
    expect(orderError).toBeNull();
    if (!order)
      throw new Error("expected orders insert to return the created row");

    trackOrder(order.id);
    outstandingOrderIds.push(order.id);
    const orderId = order.id;

    try {
      const receipt = taggedValue("payment-attempt-crud");
      const { data: attempt, error: attemptError } = await client
        .from("payment_attempts")
        .insert({
          order_id: orderId,
          attempt_no: 1,
          amount_subunits: 75_000,
          currency: "INR",
          status: "CREATED",
          razorpay_receipt: receipt,
        })
        .select()
        .single();
      expect(attemptError).toBeNull();
      if (!attempt) {
        throw new Error(
          "expected payment_attempts insert to return the created row",
        );
      }

      trackAttempt(attempt.id);
      outstandingAttemptIds.push(attempt.id);
      const attemptId = attempt.id;

      try {
        const { data: readBack, error: readError } = await client
          .from("payment_attempts")
          .select("*")
          .eq("id", attemptId)
          .single();
        expect(readError).toBeNull();
        expect(readBack?.order_id).toBe(orderId);
        expect(readBack?.attempt_no).toBe(1);
        expect(readBack?.amount_subunits).toBe(75_000);
        expect(readBack?.currency).toBe("INR");
        expect(readBack?.status).toBe("CREATED");
        expect(readBack?.razorpay_receipt).toBe(receipt);
      } finally {
        const { error: deleteAttemptError } = await client
          .from("payment_attempts")
          .delete()
          .eq("id", attemptId);
        expect(deleteAttemptError).toBeNull();
        const idx = outstandingAttemptIds.indexOf(attemptId);
        if (idx !== -1) outstandingAttemptIds.splice(idx, 1);
      }
    } finally {
      // payment_attempts.order_id -> orders(id) ON DELETE RESTRICT: the
      // dependent attempt above must already be gone before this succeeds.
      const { error: deleteOrderError } = await client
        .from("orders")
        .delete()
        .eq("id", orderId);
      expect(deleteOrderError).toBeNull();
      const idx = outstandingOrderIds.indexOf(orderId);
      if (idx !== -1) outstandingOrderIds.splice(idx, 1);
    }
  });

  afterAll(async () => {
    // Dependency-safe defensive cleanup: attempts before orders.
    for (const id of [...outstandingAttemptIds]) {
      await client.from("payment_attempts").delete().eq("id", id);
    }
    for (const id of [...outstandingOrderIds]) {
      await client.from("orders").delete().eq("id", id);
    }
  });
});
