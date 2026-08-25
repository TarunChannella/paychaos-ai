import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";

import {
  taggedValue,
  testOrderInsert,
  trackAttempt,
  trackOrder,
} from "./helpers";

/**
 * Phase 1C-B Task 6 — real constraint tests against the actual DB.
 *
 * Postgres SQLSTATE codes used below (stable, preferred over fragile
 * full-string matching per the task instructions):
 *   23514 = check_violation
 *   23503 = foreign_key_violation
 *   23505 = unique_violation
 *
 * For every rejection this file asserts BOTH that an error was returned
 * AND that no matching row was actually persisted, via a follow-up
 * service-role SELECT/count — never trusting the error alone.
 */
describe("Task 6 — orders constraints", () => {
  const client = getSupabaseServerClient();

  it("amount_subunits = 0 is rejected and no row persists", async () => {
    const { data, error } = await client
      .from("orders")
      .insert(testOrderInsert(0))
      .select()
      .single();
    try {
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23514");
    } finally {
      if (!error && data) {
        await client.from("orders").delete().eq("id", data.id);
      }
    }

    const { count, error: countError } = await client
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("amount_subunits", 0);
    expect(countError).toBeNull();
    expect(count).toBe(0);
  });

  it("amount_subunits < 0 is rejected and no row persists", async () => {
    const { data, error } = await client
      .from("orders")
      .insert(testOrderInsert(-1))
      .select()
      .single();
    try {
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23514");
    } finally {
      if (!error && data) {
        await client.from("orders").delete().eq("id", data.id);
      }
    }

    const { count, error: countError } = await client
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("amount_subunits", -1);
    expect(countError).toBeNull();
    expect(count).toBe(0);
  });

  it("lowercase/invalid currency ('inr') is rejected and no row persists", async () => {
    const sentinelAmount = 611_001;
    const { data, error } = await client
      .from("orders")
      .insert({ ...testOrderInsert(sentinelAmount), currency: "inr" })
      .select()
      .single();
    try {
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23514");
    } finally {
      if (!error && data) {
        await client.from("orders").delete().eq("id", data.id);
      }
    }

    const { count, error: countError } = await client
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("amount_subunits", sentinelAmount);
    expect(countError).toBeNull();
    expect(count).toBe(0);
  });

  it("invalid payment_status is rejected and no row persists", async () => {
    const sentinelAmount = 611_002;
    const { data, error } = await client
      .from("orders")
      .insert({
        ...testOrderInsert(sentinelAmount),
        // @ts-expect-error -- deliberately invalid value to exercise the
        // orders_payment_status_valid CHECK constraint at the real DB.
        payment_status: "BOGUS_STATUS",
      })
      .select()
      .single();
    try {
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23514");
    } finally {
      if (!error && data) {
        await client.from("orders").delete().eq("id", data.id);
      }
    }

    const { count, error: countError } = await client
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("amount_subunits", sentinelAmount);
    expect(countError).toBeNull();
    expect(count).toBe(0);
  });

  it("invalid business_status is rejected and no row persists", async () => {
    const sentinelAmount = 611_003;
    const { data, error } = await client
      .from("orders")
      .insert({
        ...testOrderInsert(sentinelAmount),
        // @ts-expect-error -- deliberately invalid value to exercise the
        // orders_business_status_valid CHECK constraint at the real DB.
        business_status: "BOGUS_STATUS",
      })
      .select()
      .single();
    try {
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23514");
    } finally {
      if (!error && data) {
        await client.from("orders").delete().eq("id", data.id);
      }
    }

    const { count, error: countError } = await client
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("amount_subunits", sentinelAmount);
    expect(countError).toBeNull();
    expect(count).toBe(0);
  });
});

describe("Task 6 — payment_attempts constraints", () => {
  const client = getSupabaseServerClient();
  const outstandingOrderIds: string[] = [];
  const outstandingAttemptIds: string[] = [];

  async function createValidOrder(amountSubunits: number): Promise<string> {
    const { data, error } = await client
      .from("orders")
      .insert(testOrderInsert(amountSubunits))
      .select()
      .single();
    expect(error).toBeNull();
    if (!data)
      throw new Error("expected orders insert to return the created row");
    trackOrder(data.id);
    outstandingOrderIds.push(data.id);
    return data.id;
  }

  async function deleteOrder(orderId: string): Promise<void> {
    await client.from("orders").delete().eq("id", orderId);
    const idx = outstandingOrderIds.indexOf(orderId);
    if (idx !== -1) outstandingOrderIds.splice(idx, 1);
  }

  it("orphan order_id is rejected (foreign_key_violation) and no row persists", async () => {
    const receipt = taggedValue("orphan-order-id");
    const orphanOrderId = randomUUID();

    const { data, error } = await client
      .from("payment_attempts")
      .insert({
        order_id: orphanOrderId,
        attempt_no: 1,
        amount_subunits: 10_000,
        currency: "INR",
        status: "CREATED",
        razorpay_receipt: receipt,
      })
      .select()
      .single();
    try {
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23503");
    } finally {
      if (!error && data) {
        await client.from("payment_attempts").delete().eq("id", data.id);
      }
    }

    const { count, error: countError } = await client
      .from("payment_attempts")
      .select("id", { count: "exact", head: true })
      .eq("razorpay_receipt", receipt);
    expect(countError).toBeNull();
    expect(count).toBe(0);
  });

  it("attempt_no = 0 is rejected and no row persists", async () => {
    const orderId = await createValidOrder(20_000);
    try {
      const receipt = taggedValue("attempt-no-zero");
      const { data, error } = await client
        .from("payment_attempts")
        .insert({
          order_id: orderId,
          attempt_no: 0,
          amount_subunits: 20_000,
          currency: "INR",
          status: "CREATED",
          razorpay_receipt: receipt,
        })
        .select()
        .single();
      try {
        expect(error).not.toBeNull();
        expect(error?.code).toBe("23514");
      } finally {
        if (!error && data) {
          await client.from("payment_attempts").delete().eq("id", data.id);
        }
      }

      const { count, error: countError } = await client
        .from("payment_attempts")
        .select("id", { count: "exact", head: true })
        .eq("razorpay_receipt", receipt);
      expect(countError).toBeNull();
      expect(count).toBe(0);
    } finally {
      await deleteOrder(orderId);
    }
  });

  it("amount_subunits <= 0 is rejected and no row persists", async () => {
    const orderId = await createValidOrder(20_000);
    try {
      for (const invalidAmount of [0, -1]) {
        const receipt = taggedValue(`attempt-amount-${invalidAmount}`);
        const { data, error } = await client
          .from("payment_attempts")
          .insert({
            order_id: orderId,
            attempt_no: 1,
            amount_subunits: invalidAmount,
            currency: "INR",
            status: "CREATED",
            razorpay_receipt: receipt,
          })
          .select()
          .single();
        try {
          expect(error).not.toBeNull();
          expect(error?.code).toBe("23514");
        } finally {
          if (!error && data) {
            await client.from("payment_attempts").delete().eq("id", data.id);
          }
        }

        const { count, error: countError } = await client
          .from("payment_attempts")
          .select("id", { count: "exact", head: true })
          .eq("razorpay_receipt", receipt);
        expect(countError).toBeNull();
        expect(count).toBe(0);
      }
    } finally {
      await deleteOrder(orderId);
    }
  });

  it("invalid status is rejected and no row persists", async () => {
    const orderId = await createValidOrder(20_000);
    try {
      const receipt = taggedValue("invalid-status");
      const { data, error } = await client
        .from("payment_attempts")
        .insert({
          order_id: orderId,
          attempt_no: 1,
          amount_subunits: 20_000,
          currency: "INR",
          // @ts-expect-error -- deliberately invalid value to exercise the
          // payment_attempts_status_valid CHECK constraint at the real DB.
          status: "BOGUS_STATUS",
          razorpay_receipt: receipt,
        })
        .select()
        .single();
      try {
        expect(error).not.toBeNull();
        expect(error?.code).toBe("23514");
      } finally {
        if (!error && data) {
          await client.from("payment_attempts").delete().eq("id", data.id);
        }
      }

      const { count, error: countError } = await client
        .from("payment_attempts")
        .select("id", { count: "exact", head: true })
        .eq("razorpay_receipt", receipt);
      expect(countError).toBeNull();
      expect(count).toBe(0);
    } finally {
      await deleteOrder(orderId);
    }
  });

  it("duplicate (order_id, attempt_no) is rejected; exactly one row survives", async () => {
    const orderId = await createValidOrder(30_000);
    try {
      const firstReceipt = taggedValue("dup-attempt-no-first");
      const { data: first, error: firstError } = await client
        .from("payment_attempts")
        .insert({
          order_id: orderId,
          attempt_no: 1,
          amount_subunits: 30_000,
          currency: "INR",
          status: "CREATED",
          razorpay_receipt: firstReceipt,
        })
        .select()
        .single();
      expect(firstError).toBeNull();
      if (!first) throw new Error("expected first insert to succeed");
      trackAttempt(first.id);
      outstandingAttemptIds.push(first.id);

      try {
        const secondReceipt = taggedValue("dup-attempt-no-second");
        const { data: second, error: secondError } = await client
          .from("payment_attempts")
          .insert({
            order_id: orderId,
            attempt_no: 1, // same (order_id, attempt_no) pair as `first`
            amount_subunits: 30_000,
            currency: "INR",
            status: "CREATED",
            razorpay_receipt: secondReceipt,
          })
          .select()
          .single();
        try {
          expect(secondError).not.toBeNull();
          expect(secondError?.code).toBe("23505");
        } finally {
          if (!secondError && second) {
            await client.from("payment_attempts").delete().eq("id", second.id);
          }
        }

        const { count, error: countError } = await client
          .from("payment_attempts")
          .select("id", { count: "exact", head: true })
          .eq("order_id", orderId)
          .eq("attempt_no", 1);
        expect(countError).toBeNull();
        expect(count).toBe(1);
      } finally {
        await client.from("payment_attempts").delete().eq("id", first.id);
        const idx = outstandingAttemptIds.indexOf(first.id);
        if (idx !== -1) outstandingAttemptIds.splice(idx, 1);
      }
    } finally {
      await deleteOrder(orderId);
    }
  });

  it("duplicate razorpay_receipt is rejected; exactly one row survives", async () => {
    const orderA = await createValidOrder(40_000);
    const orderB = await createValidOrder(40_000);
    try {
      const sharedReceipt = taggedValue("dup-receipt");
      const { data: first, error: firstError } = await client
        .from("payment_attempts")
        .insert({
          order_id: orderA,
          attempt_no: 1,
          amount_subunits: 40_000,
          currency: "INR",
          status: "CREATED",
          razorpay_receipt: sharedReceipt,
        })
        .select()
        .single();
      expect(firstError).toBeNull();
      if (!first) throw new Error("expected first insert to succeed");
      trackAttempt(first.id);
      outstandingAttemptIds.push(first.id);

      try {
        const { data: second, error: secondError } = await client
          .from("payment_attempts")
          .insert({
            order_id: orderB,
            attempt_no: 1,
            amount_subunits: 40_000,
            currency: "INR",
            status: "CREATED",
            razorpay_receipt: sharedReceipt, // duplicate across a different order
          })
          .select()
          .single();
        try {
          expect(secondError).not.toBeNull();
          expect(secondError?.code).toBe("23505");
        } finally {
          if (!secondError && second) {
            await client.from("payment_attempts").delete().eq("id", second.id);
          }
        }

        const { count, error: countError } = await client
          .from("payment_attempts")
          .select("id", { count: "exact", head: true })
          .eq("razorpay_receipt", sharedReceipt);
        expect(countError).toBeNull();
        expect(count).toBe(1);
      } finally {
        await client.from("payment_attempts").delete().eq("id", first.id);
        const idx = outstandingAttemptIds.indexOf(first.id);
        if (idx !== -1) outstandingAttemptIds.splice(idx, 1);
      }
    } finally {
      await deleteOrder(orderA);
      await deleteOrder(orderB);
    }
  });

  afterAll(async () => {
    for (const id of [...outstandingAttemptIds]) {
      await client.from("payment_attempts").delete().eq("id", id);
    }
    for (const id of [...outstandingOrderIds]) {
      await client.from("orders").delete().eq("id", id);
    }
  });
});

describe("Task 6 — fulfilments constraint (orphan order_id)", () => {
  const client = getSupabaseServerClient();

  // Phase 2F additive migration made fulfilments.payment_id NOT NULL with
  // its own FK (docs/DATABASE.md Section 12) — an orphan payment_id is
  // supplied purely to satisfy that requirement so this test can still
  // isolate the order_id FK's rejection behavior. Both order_id and
  // payment_id are orphaned here (neither references a real row), and
  // either alone is sufficient to produce a 23503 foreign-key violation —
  // this test only asserts the error code, not which specific FK fired.
  it("orphan order_id is rejected; NO fulfilments row is ever inserted by this test", async () => {
    const idempotencyKey = taggedValue("fulfilment-orphan-order-id");
    const orphanOrderId = randomUUID();

    const { data, error } = await client
      .from("fulfilments")
      .insert({
        order_id: orphanOrderId,
        payment_id: randomUUID(),
        effect_type: "FULFIL_ORDER",
        idempotency_key: idempotencyKey,
      })
      .select()
      .single();
    try {
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23503");
    } finally {
      // Defensive only: per docs/DATABASE.md, Phase 1 must NEVER persist a
      // fulfilments row. If this ever unexpectedly succeeded, delete it
      // immediately rather than leaving the table non-empty.
      if (!error && data) {
        await client.from("fulfilments").delete().eq("id", data.id);
      }
    }

    const { count, error: countError } = await client
      .from("fulfilments")
      .select("id", { count: "exact", head: true })
      .eq("idempotency_key", idempotencyKey);
    expect(countError).toBeNull();
    expect(count).toBe(0);
  });
});
