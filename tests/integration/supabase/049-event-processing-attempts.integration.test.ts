import { createHash, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

import {
  getAnonClientForTest,
  taggedValue,
  testOrderInsert,
  trackAttempt,
  trackOrder,
} from "./helpers";

/**
 * Phase 2E — proves the additive migration
 * (20260827000000_phase2e_webhook_dedup.sql) against the REAL Supabase
 * project: the `event_processing_attempts` table, its constraints/RLS, and
 * the `record_webhook_duplicate_delivery` atomic RPC. Every ID used here is
 * a synthetic, tagged placeholder — never a real Razorpay identifier — and
 * no real HMAC verification or Razorpay API call happens anywhere in this
 * file.
 *
 * IMPORTANT: this file will fail with "relation ... does not exist" /
 * "function ... does not exist" until the developer manually applies
 * 20260827000000_phase2e_webhook_dedup.sql against the real Supabase
 * project — this is expected and must be reported honestly, not hidden or
 * auto-applied. Claude does not apply this migration.
 */
function fakeSha256Hex(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

function validWebhookEventInsert(
  label: string,
): Database["public"]["Tables"]["webhook_events"]["Insert"] {
  return {
    razorpay_event_id: taggedValue(label),
    event_type: "payment.captured",
    signature_verified: true,
    raw_body_sha256: fakeSha256Hex(`${label}-${randomUUID()}`),
    raw_payload_redacted: { event: "payment.captured" },
  };
}

function validAttemptInsert(
  label: string,
): Database["public"]["Tables"]["event_processing_attempts"]["Insert"] {
  return {
    source_kind: "REAL_RAZORPAY_WEBHOOK",
    is_duplicate_delivery: false,
    status: "PENDING",
    normalized_event: { kind: "payment.captured", label },
  };
}

describe("Phase 2E — event_processing_attempts table (real Supabase)", () => {
  const client = getSupabaseServerClient();
  const outstandingAttemptIds: string[] = [];
  const outstandingWebhookEventIds: string[] = [];

  async function createTrackedWebhookEvent(label: string): Promise<string> {
    const { data, error } = await client
      .from("webhook_events")
      .insert(validWebhookEventInsert(label))
      .select()
      .single();
    expect(error).toBeNull();
    if (!data)
      throw new Error("expected webhook_events insert to return a row");
    outstandingWebhookEventIds.push(data.id);
    return data.id;
  }

  async function deleteTrackedAttempt(id: string): Promise<void> {
    await client.from("event_processing_attempts").delete().eq("id", id);
    const idx = outstandingAttemptIds.indexOf(id);
    if (idx !== -1) outstandingAttemptIds.splice(idx, 1);
  }

  async function deleteTrackedWebhookEvent(id: string): Promise<void> {
    await client.from("webhook_events").delete().eq("id", id);
    const idx = outstandingWebhookEventIds.indexOf(id);
    if (idx !== -1) outstandingWebhookEventIds.splice(idx, 1);
  }

  // 43. event_processing_attempts exists; 44. service_role CRUD succeeds.
  it("service-role can insert a minimal valid row and read it back", async () => {
    const webhookEventId = await createTrackedWebhookEvent("attempt-minimal");
    try {
      const { data: row, error } = await client
        .from("event_processing_attempts")
        .insert({
          ...validAttemptInsert("attempt-minimal"),
          webhook_event_id: webhookEventId,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(row).not.toBeNull();
      outstandingAttemptIds.push(row!.id);

      expect(row!.source_kind).toBe("REAL_RAZORPAY_WEBHOOK");
      expect(row!.is_duplicate_delivery).toBe(false);
      expect(row!.status).toBe("PENDING");
      expect(row!.webhook_event_id).toBe(webhookEventId);
      expect(row!.payment_attempt_id).toBeNull();
      expect(row!.payment_id).toBeNull();
      expect(row!.error_code).toBeNull();
      expect(row!.error_message_redacted).toBeNull();

      const { data: reread, error: rereadError } = await client
        .from("event_processing_attempts")
        .select("*")
        .eq("id", row!.id)
        .single();
      expect(rereadError).toBeNull();
      expect(reread?.id).toBe(row!.id);

      await deleteTrackedAttempt(row!.id);
    } finally {
      await deleteTrackedWebhookEvent(webhookEventId);
    }
  });

  // 49. invalid source_kind rejected.
  //
  // Phase 3C widened the current-schema source_kind CHECK to accept
  // PAYCHAOS_REPLAY in addition to REAL_RAZORPAY_WEBHOOK (see the Phase 3C
  // describe block in tests/unit/supabase/migration.test.ts for the
  // historical-vs-current distinction), so PAYCHAOS_REPLAY is no longer a
  // truly unsupported value here — a genuinely bogus value is used instead
  // to keep proving the CHECK constraint itself is enforced.
  it("an invalid source_kind is rejected (23514)", async () => {
    const webhookEventId = await createTrackedWebhookEvent("bad-source-kind");
    try {
      const { data, error } = await client
        .from("event_processing_attempts")
        .insert({
          ...validAttemptInsert("bad-source-kind"),
          webhook_event_id: webhookEventId,
          source_kind: "NOT_A_REAL_SOURCE_KIND" as "REAL_RAZORPAY_WEBHOOK",
        })
        .select()
        .single();

      expect(error).not.toBeNull();
      expect(error?.code).toBe("23514");
      expect(data).toBeNull();
    } finally {
      await deleteTrackedWebhookEvent(webhookEventId);
    }
  });

  // 50. REAL_RAZORPAY_WEBHOOK without webhook_event_id rejected.
  it("REAL_RAZORPAY_WEBHOOK without a webhook_event_id is rejected (23514)", async () => {
    const { data, error } = await client
      .from("event_processing_attempts")
      .insert({
        ...validAttemptInsert("missing-webhook-event-id"),
        webhook_event_id: null,
      })
      .select()
      .single();

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
    expect(data).toBeNull();
  });

  // 51. invalid status rejected.
  it("an invalid status is rejected (23514)", async () => {
    const webhookEventId = await createTrackedWebhookEvent("bad-status");
    try {
      const { data, error } = await client
        .from("event_processing_attempts")
        .insert({
          ...validAttemptInsert("bad-status"),
          webhook_event_id: webhookEventId,
          status: "NOT_A_REAL_STATUS" as "PENDING",
        })
        .select()
        .single();

      expect(error).not.toBeNull();
      expect(error?.code).toBe("23514");
      expect(data).toBeNull();
    } finally {
      await deleteTrackedWebhookEvent(webhookEventId);
    }
  });

  // 52. normalized_event array rejected.
  it("a non-object (array) normalized_event is rejected (23514)", async () => {
    const webhookEventId = await createTrackedWebhookEvent(
      "bad-normalized-event",
    );
    try {
      const { data, error } = await client
        .from("event_processing_attempts")
        .insert({
          ...validAttemptInsert("bad-normalized-event"),
          webhook_event_id: webhookEventId,
          normalized_event: [1, 2, 3] as unknown as Record<string, unknown>,
        })
        .select()
        .single();

      expect(error).not.toBeNull();
      expect(error?.code).toBe("23514");
      expect(data).toBeNull();
    } finally {
      await deleteTrackedWebhookEvent(webhookEventId);
    }
  });

  // 53. nonexistent webhook FK rejected.
  it("webhook_event_id FK rejects a nonexistent webhook event (23503)", async () => {
    const { data, error } = await client
      .from("event_processing_attempts")
      .insert({
        ...validAttemptInsert("fk-reject-webhook"),
        webhook_event_id: randomUUID(),
      })
      .select()
      .single();

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23503");
    expect(data).toBeNull();
  });

  // 54. nonexistent payment_attempt FK rejected.
  it("payment_attempt_id FK rejects a nonexistent payment attempt (23503)", async () => {
    const webhookEventId = await createTrackedWebhookEvent("fk-reject-attempt");
    try {
      const { data, error } = await client
        .from("event_processing_attempts")
        .insert({
          ...validAttemptInsert("fk-reject-attempt"),
          webhook_event_id: webhookEventId,
          payment_attempt_id: randomUUID(),
        })
        .select()
        .single();

      expect(error).not.toBeNull();
      expect(error?.code).toBe("23503");
      expect(data).toBeNull();
    } finally {
      await deleteTrackedWebhookEvent(webhookEventId);
    }
  });

  // 55. nonexistent payment FK rejected.
  it("payment_id FK rejects a nonexistent payment (23503)", async () => {
    const webhookEventId = await createTrackedWebhookEvent("fk-reject-payment");
    try {
      const { data, error } = await client
        .from("event_processing_attempts")
        .insert({
          ...validAttemptInsert("fk-reject-payment"),
          webhook_event_id: webhookEventId,
          payment_id: randomUUID(),
        })
        .select()
        .single();

      expect(error).not.toBeNull();
      expect(error?.code).toBe("23503");
      expect(data).toBeNull();
    } finally {
      await deleteTrackedWebhookEvent(webhookEventId);
    }
  });

  afterAll(async () => {
    for (const id of [...outstandingAttemptIds]) {
      await client.from("event_processing_attempts").delete().eq("id", id);
    }
    for (const id of [...outstandingWebhookEventIds]) {
      await client.from("webhook_events").delete().eq("id", id);
    }
  });
});

describe("Phase 2E — record_webhook_duplicate_delivery RPC (real Supabase)", () => {
  const client = getSupabaseServerClient();
  const outstandingWebhookEventIds: string[] = [];

  async function createTrackedWebhookEvent(label: string): Promise<{
    id: string;
    razorpayEventId: string;
  }> {
    const insertPayload = validWebhookEventInsert(label);
    const { data, error } = await client
      .from("webhook_events")
      .insert(insertPayload)
      .select()
      .single();
    expect(error).toBeNull();
    if (!data)
      throw new Error("expected webhook_events insert to return a row");
    outstandingWebhookEventIds.push(data.id);
    return { id: data.id, razorpayEventId: insertPayload.razorpay_event_id };
  }

  // 56. duplicate increment RPC callable by service_role. 57. increases
  // exactly by one.
  it("increments duplicate_delivery_count by exactly one", async () => {
    const { id, razorpayEventId } =
      await createTrackedWebhookEvent("rpc-increment-once");
    try {
      const { data, error } = await client.rpc(
        "record_webhook_duplicate_delivery",
        { p_razorpay_event_id: razorpayEventId },
      );

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.duplicate_delivery_count).toBe(1);
      expect(data!.id).toBe(id);
    } finally {
      await client.from("webhook_events").delete().eq("id", id);
    }
  });

  // 58. two sequential increments increase exactly by two.
  it("two sequential increments increase the count by exactly two", async () => {
    const { id, razorpayEventId } = await createTrackedWebhookEvent(
      "rpc-increment-twice",
    );
    try {
      await client.rpc("record_webhook_duplicate_delivery", {
        p_razorpay_event_id: razorpayEventId,
      });
      const { data, error } = await client.rpc(
        "record_webhook_duplicate_delivery",
        { p_razorpay_event_id: razorpayEventId },
      );

      expect(error).toBeNull();
      expect(data!.duplicate_delivery_count).toBe(2);
    } finally {
      await client.from("webhook_events").delete().eq("id", id);
    }
  });

  // Concurrency: N concurrent increments against the SAME row must produce
  // exactly N — not fewer, which would indicate a lost-update race. This is
  // the direct proof the atomic SQL UPDATE, not a
  // SELECT-then-increment-in-JS pattern, is what's actually running.
  it("N concurrent increments against the same row lose zero updates", async () => {
    const { id, razorpayEventId } = await createTrackedWebhookEvent(
      "rpc-increment-concurrent",
    );
    const CONCURRENCY = 5;
    try {
      await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          client.rpc("record_webhook_duplicate_delivery", {
            p_razorpay_event_id: razorpayEventId,
          }),
        ),
      );

      const { data: finalRow, error } = await client
        .from("webhook_events")
        .select("duplicate_delivery_count")
        .eq("id", id)
        .single();

      expect(error).toBeNull();
      expect(finalRow?.duplicate_delivery_count).toBe(CONCURRENCY);
    } finally {
      await client.from("webhook_events").delete().eq("id", id);
    }
  });

  // 60. canonical webhook immutable evidence is unchanged by duplicate count.
  it("incrementing duplicate_delivery_count never changes the immutable evidence fields", async () => {
    const insertPayload = validWebhookEventInsert("rpc-immutable-evidence");
    const { data: original, error: insertError } = await client
      .from("webhook_events")
      .insert(insertPayload)
      .select()
      .single();
    expect(insertError).toBeNull();
    if (!original) throw new Error("expected insert to return a row");
    outstandingWebhookEventIds.push(original.id);

    try {
      const { data: updated, error } = await client.rpc(
        "record_webhook_duplicate_delivery",
        { p_razorpay_event_id: insertPayload.razorpay_event_id },
      );

      expect(error).toBeNull();
      expect(updated!.razorpay_event_id).toBe(original.razorpay_event_id);
      expect(updated!.event_type).toBe(original.event_type);
      expect(updated!.source_kind).toBe(original.source_kind);
      expect(updated!.signature_verified).toBe(original.signature_verified);
      expect(updated!.received_at).toBe(original.received_at);
      expect(updated!.raw_body_sha256).toBe(original.raw_body_sha256);
      expect(updated!.raw_payload_redacted).toEqual(
        original.raw_payload_redacted,
      );
    } finally {
      await client.from("webhook_events").delete().eq("id", original.id);
    }
  });

  // 61. derived normalization fields can be updated.
  it("derived correlation fields (razorpay_order_id/payment_attempt_id/etc.) can be updated after insert", async () => {
    const orderRow = await client
      .from("orders")
      .insert(testOrderInsert(50_000))
      .select()
      .single();
    expect(orderRow.error).toBeNull();
    const orderId = orderRow.data!.id;
    trackOrder(orderId);

    try {
      const attemptRow = await client
        .from("payment_attempts")
        .insert({
          order_id: orderId,
          attempt_no: 1,
          amount_subunits: 50_000,
          currency: "INR",
          razorpay_receipt: taggedValue("derived-update-receipt"),
        })
        .select()
        .single();
      expect(attemptRow.error).toBeNull();
      const attemptId = attemptRow.data!.id;
      trackAttempt(attemptId);

      const insertPayload = validWebhookEventInsert("derived-update");
      const { data: webhookEvent, error: insertError } = await client
        .from("webhook_events")
        .insert(insertPayload)
        .select()
        .single();
      expect(insertError).toBeNull();
      outstandingWebhookEventIds.push(webhookEvent!.id);

      const { data: updated, error } = await client
        .from("webhook_events")
        .update({
          razorpay_order_id: taggedValue("derived-order-id"),
          payment_attempt_id: attemptId,
          amount_subunits: 50_000,
          currency: "INR",
        })
        .eq("id", webhookEvent!.id)
        .select()
        .single();

      expect(error).toBeNull();
      expect(updated?.payment_attempt_id).toBe(attemptId);
      expect(updated?.amount_subunits).toBe(50_000);

      await client.from("webhook_events").delete().eq("id", webhookEvent!.id);
    } finally {
      await client.from("payment_attempts").delete().eq("order_id", orderId);
      await client.from("orders").delete().eq("id", orderId);
    }
  });

  afterAll(async () => {
    for (const id of [...outstandingWebhookEventIds]) {
      await client.from("webhook_events").delete().eq("id", id);
    }
  });
});

describe("Phase 2E — anon client is denied on event_processing_attempts and the duplicate RPC", () => {
  const anon = getAnonClientForTest();
  const service = getSupabaseServerClient();

  // 45. anon SELECT denied.
  it("SELECT is denied", async () => {
    const { data, error } = await anon
      .from("event_processing_attempts")
      .select("id")
      .limit(1);
    expect(error).not.toBeNull();
    expect(data === null || data.length === 0).toBe(true);
  });

  // 46. anon INSERT denied.
  it("INSERT is denied and no row is created", async () => {
    const { error } = await anon.from("event_processing_attempts").insert({
      source_kind: "REAL_RAZORPAY_WEBHOOK",
      status: "PENDING",
    });
    expect(error).not.toBeNull();
  });

  // 47. anon UPDATE denied.
  it("UPDATE is denied (target: random non-existent UUID)", async () => {
    const { error } = await anon
      .from("event_processing_attempts")
      .update({ status: "FAILED" })
      .eq("id", randomUUID());
    expect(error).not.toBeNull();
  });

  // 48. anon DELETE denied.
  it("DELETE is denied (target: random non-existent UUID)", async () => {
    const { error } = await anon
      .from("event_processing_attempts")
      .delete()
      .eq("id", randomUUID());
    expect(error).not.toBeNull();
  });

  // 59. anon cannot execute the duplicate increment RPC.
  it("the record_webhook_duplicate_delivery RPC is not executable by anon", async () => {
    const razorpayEventId = taggedValue("anon-rpc-denied");
    const { data, error } = await anon.rpc(
      "record_webhook_duplicate_delivery",
      {
        p_razorpay_event_id: razorpayEventId,
      },
    );
    expect(error).not.toBeNull();
    expect(data).toBeNull();

    // Independently reconfirm via service-role that no row was ever
    // touched/created as a side effect of the denied call.
    const { count, error: verifyError } = await service
      .from("webhook_events")
      .select("id", { count: "exact", head: true })
      .eq("razorpay_event_id", razorpayEventId);
    expect(verifyError).toBeNull();
    expect(count).toBe(0);
  });
});
