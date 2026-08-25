import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";

import { getAnonClientForTest, taggedValue, trackOrder } from "./helpers";

/**
 * Phase 1C-B Task 7 — real anon/RLS denial tests against the actual DB.
 *
 * The anon client here is built ONLY from NEXT_PUBLIC_SUPABASE_URL +
 * NEXT_PUBLIC_SUPABASE_ANON_KEY (see helpers.getAnonClientForTest) — never
 * the service-role key. Per the approved migration
 * (supabase/migrations/20260823000000_phase1_foundation_schema.sql), the
 * `anon`/`authenticated` roles have RLS enabled with ZERO policies AND
 * their table-level privileges explicitly REVOKEd on all three Phase 1
 * tables, so every operation below is expected to be denied at the
 * database/PostgREST layer.
 *
 * If ANY anon operation below unexpectedly succeeds, this is a BLOCKER:
 * do not weaken/patch around it. It means RLS/grants are not actually
 * enforced on the real project, and that must be reported, not routed
 * around by this test file.
 */
describe("Task 7 — anon client is denied on orders", () => {
  const anon = getAnonClientForTest();
  const service = getSupabaseServerClient();

  it("SELECT is denied", async () => {
    const { data, error } = await anon.from("orders").select("id").limit(1);
    expect(error).not.toBeNull();
    expect(data === null || data.length === 0).toBe(true);
  });

  it("INSERT is denied and no row is created", async () => {
    const sentinelAmount = 622_001;
    const { error } = await anon.from("orders").insert({
      amount_subunits: sentinelAmount,
      currency: "INR",
      payment_status: "UNPAID",
      business_status: "OPEN",
    });
    expect(error).not.toBeNull();

    const { count, error: verifyError } = await service
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("amount_subunits", sentinelAmount);
    expect(verifyError).toBeNull();
    expect(count).toBe(0);
  });

  it("UPDATE is denied (target: random non-existent UUID)", async () => {
    const { error } = await anon
      .from("orders")
      .update({ payment_status: "PAID" })
      .eq("id", randomUUID());
    expect(error).not.toBeNull();
  });

  it("DELETE is denied (target: random non-existent UUID)", async () => {
    const { error } = await anon.from("orders").delete().eq("id", randomUUID());
    expect(error).not.toBeNull();
  });
});

describe("Task 7 — anon client is denied on payment_attempts", () => {
  const anon = getAnonClientForTest();
  const service = getSupabaseServerClient();

  it("SELECT is denied", async () => {
    const { data, error } = await anon
      .from("payment_attempts")
      .select("id")
      .limit(1);
    expect(error).not.toBeNull();
    expect(data === null || data.length === 0).toBe(true);
  });

  it("INSERT is denied and no row is created", async () => {
    const receipt = taggedValue("anon-insert-payment-attempt");
    const { error } = await anon.from("payment_attempts").insert({
      order_id: randomUUID(),
      attempt_no: 1,
      amount_subunits: 10_000,
      currency: "INR",
      status: "CREATED",
      razorpay_receipt: receipt,
    });
    expect(error).not.toBeNull();

    const { count, error: verifyError } = await service
      .from("payment_attempts")
      .select("id", { count: "exact", head: true })
      .eq("razorpay_receipt", receipt);
    expect(verifyError).toBeNull();
    expect(count).toBe(0);
  });

  it("UPDATE is denied (target: random non-existent UUID)", async () => {
    const { error } = await anon
      .from("payment_attempts")
      .update({ status: "CAPTURED" })
      .eq("id", randomUUID());
    expect(error).not.toBeNull();
  });

  it("DELETE is denied (target: random non-existent UUID)", async () => {
    const { error } = await anon
      .from("payment_attempts")
      .delete()
      .eq("id", randomUUID());
    expect(error).not.toBeNull();
  });
});

describe("Task 7 — anon client is denied on fulfilments", () => {
  const anon = getAnonClientForTest();
  const service = getSupabaseServerClient();

  it("SELECT is denied", async () => {
    const { data, error } = await anon
      .from("fulfilments")
      .select("id")
      .limit(1);
    expect(error).not.toBeNull();
    expect(data === null || data.length === 0).toBe(true);
  });

  it("INSERT is denied and no row is created (synthetic, non-sensitive values)", async () => {
    const idempotencyKey = taggedValue("anon-insert-fulfilment");
    // Phase 2F additive migration made fulfilments.payment_id NOT NULL
    // (docs/DATABASE.md Section 12) — a synthetic, non-referencing value is
    // supplied only to satisfy the column's type; RLS denies this INSERT
    // before any FK/constraint would even be relevant.
    const { error } = await anon.from("fulfilments").insert({
      order_id: randomUUID(),
      payment_id: randomUUID(),
      effect_type: "FULFIL_ORDER",
      idempotency_key: idempotencyKey,
    });
    expect(error).not.toBeNull();

    const { count, error: verifyError } = await service
      .from("fulfilments")
      .select("id", { count: "exact", head: true })
      .eq("idempotency_key", idempotencyKey);
    expect(verifyError).toBeNull();
    expect(count).toBe(0);
  });

  it("UPDATE is denied (target: random non-existent UUID)", async () => {
    const { error } = await anon
      .from("fulfilments")
      .update({ effect_type: "FULFIL_ORDER" })
      .eq("id", randomUUID());
    expect(error).not.toBeNull();
  });

  it("DELETE is denied (target: random non-existent UUID)", async () => {
    const { error } = await anon
      .from("fulfilments")
      .delete()
      .eq("id", randomUUID());
    expect(error).not.toBeNull();
  });
});

describe("Task 7 — sanity: the anon client cannot see a real service-role-created order", () => {
  const anon = getAnonClientForTest();
  const service = getSupabaseServerClient();
  const outstandingOrderIds: string[] = [];

  it("a genuinely existing order is invisible to anon SELECT by id", async () => {
    const { data: created, error: insertError } = await service
      .from("orders")
      .insert({
        amount_subunits: 90_000,
        currency: "INR",
        payment_status: "UNPAID",
        business_status: "OPEN",
      })
      .select()
      .single();
    expect(insertError).toBeNull();
    if (!created) throw new Error("expected service-role insert to succeed");
    trackOrder(created.id);
    outstandingOrderIds.push(created.id);

    try {
      const { data, error } = await anon
        .from("orders")
        .select("id")
        .eq("id", created.id);
      expect(error).not.toBeNull();
      expect(data === null || data.length === 0).toBe(true);
    } finally {
      await service.from("orders").delete().eq("id", created.id);
      const idx = outstandingOrderIds.indexOf(created.id);
      if (idx !== -1) outstandingOrderIds.splice(idx, 1);
    }
  });

  afterAll(async () => {
    for (const id of [...outstandingOrderIds]) {
      await service.from("orders").delete().eq("id", id);
    }
  });
});
