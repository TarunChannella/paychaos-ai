import { afterAll, describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  getLatestPaymentAttemptForOrder,
  insertPaymentAttempt,
  markPaymentAttemptFailedObserved,
  markPaymentAttemptOrderCreated,
} from "@/lib/demo-merchant/repository";

import {
  taggedValue,
  testOrderInsert,
  trackAttempt,
  trackOrder,
} from "./helpers";

/**
 * Phase 2B — proves the additive migration
 * (20260824000000_phase2b_payment_attempts_razorpay_correlation.sql)
 * against the REAL Supabase project, and that the new
 * `lib/demo-merchant/repository.ts` payment_attempts functions work
 * end-to-end. No Razorpay API is called anywhere in this file — every
 * `razorpay_order_id`/`razorpay_order_status` value used here is a
 * synthetic, tagged placeholder, never a real Razorpay identifier.
 *
 * Existing coverage this file deliberately does NOT duplicate:
 *   - RLS anon denial on payment_attempts (table-level, already fully
 *     covered by 04-anon-rls.integration.test.ts and unaffected by adding
 *     nullable columns);
 *   - the pre-existing UNIQUE(order_id, attempt_no) / UNIQUE(razorpay_receipt)
 *     constraints (already covered by 03-constraints.integration.test.ts).
 */
describe("Phase 2B — payment_attempts Razorpay Order correlation (real Supabase)", () => {
  const client = getSupabaseServerClient();

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

  it("insertPaymentAttempt creates a row with razorpay_order_id/status NULL", async () => {
    const orderId = await createTrackedOrder(50_000);
    try {
      const attempt = await insertPaymentAttempt({
        orderId,
        attemptNo: 1,
        amountSubunits: 50_000,
        currency: "INR",
        razorpayReceipt: taggedValue("insert-null-check"),
      });
      trackAttempt(attempt.id);
      outstandingAttemptIds.push(attempt.id);

      try {
        expect(attempt.status).toBe("CREATED");
        expect(attempt.razorpay_order_id).toBeNull();
        expect(attempt.razorpay_order_status).toBeNull();
      } finally {
        await deleteTrackedAttempt(attempt.id);
      }
    } finally {
      await deleteTrackedOrder(orderId);
    }
  });

  it("markPaymentAttemptOrderCreated persists the correlation and transitions to ORDER_CREATED", async () => {
    const orderId = await createTrackedOrder(50_000);
    try {
      const attempt = await insertPaymentAttempt({
        orderId,
        attemptNo: 1,
        amountSubunits: 50_000,
        currency: "INR",
        razorpayReceipt: taggedValue("mark-order-created"),
      });
      trackAttempt(attempt.id);
      outstandingAttemptIds.push(attempt.id);

      try {
        const fakeRazorpayOrderId = taggedValue("order-id");
        const updated = await markPaymentAttemptOrderCreated(attempt.id, {
          razorpayOrderId: fakeRazorpayOrderId,
          razorpayOrderStatus: "created",
        });

        expect(updated.status).toBe("ORDER_CREATED");
        expect(updated.razorpay_order_id).toBe(fakeRazorpayOrderId);
        expect(updated.razorpay_order_status).toBe("created");

        const latest = await getLatestPaymentAttemptForOrder(orderId);
        expect(latest?.id).toBe(attempt.id);
        expect(latest?.status).toBe("ORDER_CREATED");
      } finally {
        await deleteTrackedAttempt(attempt.id);
      }
    } finally {
      await deleteTrackedOrder(orderId);
    }
  });

  it("markPaymentAttemptFailedObserved sets FAILED_OBSERVED and never fabricates a Razorpay Order ID", async () => {
    const orderId = await createTrackedOrder(50_000);
    try {
      const attempt = await insertPaymentAttempt({
        orderId,
        attemptNo: 1,
        amountSubunits: 50_000,
        currency: "INR",
        razorpayReceipt: taggedValue("mark-failed"),
      });
      trackAttempt(attempt.id);
      outstandingAttemptIds.push(attempt.id);

      try {
        const updated = await markPaymentAttemptFailedObserved(attempt.id);
        expect(updated.status).toBe("FAILED_OBSERVED");
        expect(updated.razorpay_order_id).toBeNull();
        expect(updated.razorpay_order_status).toBeNull();
      } finally {
        await deleteTrackedAttempt(attempt.id);
      }
    } finally {
      await deleteTrackedOrder(orderId);
    }
  });

  it("multiple attempts may each have razorpay_order_id = NULL simultaneously (partial unique index does not block NULLs)", async () => {
    const orderIdA = await createTrackedOrder(10_000);
    const orderIdB = await createTrackedOrder(20_000);
    try {
      const attemptA = await insertPaymentAttempt({
        orderId: orderIdA,
        attemptNo: 1,
        amountSubunits: 10_000,
        currency: "INR",
        razorpayReceipt: taggedValue("null-a"),
      });
      trackAttempt(attemptA.id);
      outstandingAttemptIds.push(attemptA.id);

      const attemptB = await insertPaymentAttempt({
        orderId: orderIdB,
        attemptNo: 1,
        amountSubunits: 20_000,
        currency: "INR",
        razorpayReceipt: taggedValue("null-b"),
      });
      trackAttempt(attemptB.id);
      outstandingAttemptIds.push(attemptB.id);

      try {
        expect(attemptA.razorpay_order_id).toBeNull();
        expect(attemptB.razorpay_order_id).toBeNull();
      } finally {
        await deleteTrackedAttempt(attemptA.id);
        await deleteTrackedAttempt(attemptB.id);
      }
    } finally {
      await deleteTrackedOrder(orderIdA);
      await deleteTrackedOrder(orderIdB);
    }
  });

  it("a non-null razorpay_order_id has real database uniqueness (23505 on a duplicate)", async () => {
    const orderIdA = await createTrackedOrder(30_000);
    const orderIdB = await createTrackedOrder(40_000);
    try {
      const attemptA = await insertPaymentAttempt({
        orderId: orderIdA,
        attemptNo: 1,
        amountSubunits: 30_000,
        currency: "INR",
        razorpayReceipt: taggedValue("unique-a"),
      });
      trackAttempt(attemptA.id);
      outstandingAttemptIds.push(attemptA.id);

      const attemptB = await insertPaymentAttempt({
        orderId: orderIdB,
        attemptNo: 1,
        amountSubunits: 40_000,
        currency: "INR",
        razorpayReceipt: taggedValue("unique-b"),
      });
      trackAttempt(attemptB.id);
      outstandingAttemptIds.push(attemptB.id);

      try {
        const sharedFakeOrderId = taggedValue("shared-order-id");
        await markPaymentAttemptOrderCreated(attemptA.id, {
          razorpayOrderId: sharedFakeOrderId,
          razorpayOrderStatus: "created",
        });

        // Direct client used here (not the repository wrapper) so the raw
        // Postgres error code can be asserted, matching the existing
        // constraint-test convention in 03-constraints.integration.test.ts.
        const { data, error } = await client
          .from("payment_attempts")
          .update({
            status: "ORDER_CREATED",
            razorpay_order_id: sharedFakeOrderId,
            razorpay_order_status: "created",
          })
          .eq("id", attemptB.id)
          .select()
          .single();

        expect(error).not.toBeNull();
        expect(error?.code).toBe("23505");
        expect(data).toBeNull();

        // Confirm no row was actually mutated by the rejected update.
        const { data: reread } = await client
          .from("payment_attempts")
          .select("razorpay_order_id")
          .eq("id", attemptB.id)
          .single();
        expect(reread?.razorpay_order_id).toBeNull();
      } finally {
        await deleteTrackedAttempt(attemptA.id);
        await deleteTrackedAttempt(attemptB.id);
      }
    } finally {
      await deleteTrackedOrder(orderIdA);
      await deleteTrackedOrder(orderIdB);
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
