import { createHash, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

import { getAnonClientForTest, taggedValue } from "./helpers";

/**
 * Phase 2D — proves the additive migration
 * (20260826000000_phase2d_webhook_events.sql) against the REAL Supabase
 * project. Every `razorpay_event_id` used here is a synthetic, tagged
 * placeholder (never a real Razorpay identifier) — no real HMAC
 * verification or Razorpay API call happens anywhere in this file. HMAC
 * math is proven entirely offline by
 * tests/unit/razorpay/webhook-verification.test.ts; the full ingestion
 * orchestration by tests/unit/webhooks/service.test.ts and
 * tests/unit/webhooks/repository.test.ts. This file exists ONLY to prove
 * the real database constraints/RLS/grants this application code depends
 * on actually exist and behave as declared.
 *
 * The developer has manually applied
 * 20260826000000_phase2d_webhook_events.sql against the real Supabase
 * project (2026-08-26) — this file's assertions now run against the real
 * `public.webhook_events` table.
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

describe("Phase 2D — webhook_events table (real Supabase)", () => {
  const client = getSupabaseServerClient();
  const outstandingEventIds: string[] = [];

  async function insertTracked(
    payload: Database["public"]["Tables"]["webhook_events"]["Insert"],
  ) {
    const result = await client
      .from("webhook_events")
      .insert(payload)
      .select()
      .single();
    if (result.data) outstandingEventIds.push(result.data.id);
    return result;
  }

  async function deleteTracked(id: string): Promise<void> {
    await client.from("webhook_events").delete().eq("id", id);
    const idx = outstandingEventIds.indexOf(id);
    if (idx !== -1) outstandingEventIds.splice(idx, 1);
  }

  it("service-role can insert a minimal valid row and read it back, with all Phase 2D defaults applied", async () => {
    const insertPayload = validWebhookEventInsert("minimal-insert");
    const { data: row, error } = await insertTracked(insertPayload);

    expect(error).toBeNull();
    expect(row).not.toBeNull();
    try {
      expect(row!.razorpay_event_id).toBe(insertPayload.razorpay_event_id);
      expect(row!.event_type).toBe("payment.captured");
      expect(row!.source_kind).toBe("REAL_RAZORPAY_WEBHOOK");
      expect(row!.signature_verified).toBe(true);
      expect(row!.processing_status).toBe("RECEIVED");
      expect(row!.duplicate_delivery_count).toBe(0);
      expect(row!.received_at).not.toBeNull();
      // Not yet normalized (Phase 2E) — deliberately NULL.
      expect(row!.razorpay_order_id).toBeNull();
      expect(row!.razorpay_payment_id).toBeNull();
      expect(row!.payment_attempt_id).toBeNull();
      expect(row!.payment_id).toBeNull();
      expect(row!.amount_subunits).toBeNull();
      expect(row!.currency).toBeNull();
      expect(row!.razorpay_payment_status).toBeNull();
      expect(row!.processed_at).toBeNull();

      const { data: reread, error: rereadError } = await client
        .from("webhook_events")
        .select("*")
        .eq("id", row!.id)
        .single();
      expect(rereadError).toBeNull();
      expect(reread?.razorpay_event_id).toBe(insertPayload.razorpay_event_id);
    } finally {
      await deleteTracked(row!.id);
    }
  });

  it("signature_verified=false is rejected by the database CHECK constraint (23514)", async () => {
    const { data, error } = await client
      .from("webhook_events")
      .insert({
        ...validWebhookEventInsert("signature-false"),
        signature_verified: false,
      })
      .select()
      .single();

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
    expect(data).toBeNull();
  });

  it("a source_kind other than REAL_RAZORPAY_WEBHOOK is rejected — no PayChaos replay/simulation may ever insert here", async () => {
    const { data, error } = await client
      .from("webhook_events")
      .insert({
        ...validWebhookEventInsert("bad-source-kind"),
        // Deliberately invalid at the type level too — proves the database
        // CHECK constraint is the real enforcement boundary, not just TS.
        source_kind:
          "PAYCHAOS_CONTROLLED_SIMULATION" as "REAL_RAZORPAY_WEBHOOK",
      })
      .select()
      .single();

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
    expect(data).toBeNull();
  });

  it("a missing razorpay_event_id is rejected (NOT NULL)", async () => {
    const payload = validWebhookEventInsert("missing-event-id") as Record<
      string,
      unknown
    >;
    delete payload.razorpay_event_id;

    const { data, error } = await client
      .from("webhook_events")
      .insert(
        payload as Database["public"]["Tables"]["webhook_events"]["Insert"],
      )
      .select()
      .single();

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("duplicate razorpay_event_id is rejected by the database (23505) — foundational integrity, independent of the Phase 2E duplicate workflow", async () => {
    const insertPayload = validWebhookEventInsert("duplicate-event-id");
    const { data: first, error: firstError } =
      await insertTracked(insertPayload);
    expect(firstError).toBeNull();
    expect(first).not.toBeNull();

    try {
      const { data: second, error: secondError } = await client
        .from("webhook_events")
        .insert({
          ...validWebhookEventInsert("duplicate-event-id-2"),
          razorpay_event_id: insertPayload.razorpay_event_id,
        })
        .select()
        .single();

      expect(secondError).not.toBeNull();
      expect(secondError?.code).toBe("23505");
      expect(second).toBeNull();
    } finally {
      await deleteTracked(first!.id);
    }
  });

  // `raw_body_sha256` is `char(64)`, a fixed-length blank-padded type, plus
  // a `~ '^[0-9a-f]{64}$'` CHECK. Postgres evaluates the column's own
  // length/type boundary BEFORE the CHECK constraint:
  //   - a value shorter than 64 chars is blank-padded to 64 chars, then
  //     the padding spaces make the CHECK regex fail -> 23514.
  //   - a value of exactly 64 chars that merely has the wrong content
  //     (uppercase / non-hex) reaches the CHECK unmodified -> 23514.
  //   - a value LONGER than 64 chars with non-blank excess characters is
  //     rejected at the char(64) type boundary itself, before the CHECK
  //     ever runs -> 22001 (string_data_right_truncation), not 23514.
  // Both codes equally prove the invalid value is rejected and no row is
  // persisted — this test asserts the specific code each shape actually
  // produces rather than a single assumed code for every case (2026-08-26
  // architect review correction).
  const INVALID_RAW_BODY_SHA256_CASES: Array<{
    label: string;
    value: string;
    expectedCode: "23514" | "22001";
  }> = [
    { label: "too-short", value: "too-short", expectedCode: "23514" },
    {
      label: "uppercase-64",
      value: "A".repeat(64),
      expectedCode: "23514",
    },
    { label: "non-hex-64", value: "g".repeat(64), expectedCode: "23514" },
    { label: "one-short-63", value: "a".repeat(63), expectedCode: "23514" },
    {
      label: "one-long-65",
      value: "a".repeat(65),
      expectedCode: "22001",
    },
  ];

  it.each(INVALID_RAW_BODY_SHA256_CASES)(
    "an invalid raw_body_sha256 shape ($label) is rejected with the expected PostgreSQL error code ($expectedCode)",
    async ({ label, value, expectedCode }) => {
      const { data, error } = await client
        .from("webhook_events")
        .insert({
          ...validWebhookEventInsert(`bad-hash-${label}`),
          raw_body_sha256: value,
        })
        .select()
        .single();

      expect(error).not.toBeNull();
      expect(error?.code).toBe(expectedCode);
      expect(data).toBeNull();
    },
  );

  it("a non-object raw_payload_redacted (array) is rejected (23514)", async () => {
    const { data, error } = await client
      .from("webhook_events")
      .insert({
        ...validWebhookEventInsert("non-object-redacted"),
        raw_payload_redacted: [1, 2, 3] as unknown as Record<string, unknown>,
      })
      .select()
      .single();

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
    expect(data).toBeNull();
  });

  it("an invalid processing_status is rejected (23514)", async () => {
    const { data, error } = await client
      .from("webhook_events")
      .insert({
        ...validWebhookEventInsert("bad-processing-status"),
        // Deliberately invalid at the type level too — proves the database
        // CHECK constraint is the real enforcement boundary, not just TS.
        processing_status: "NOT_A_REAL_STATUS" as "RECEIVED",
      })
      .select()
      .single();

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
    expect(data).toBeNull();
  });

  it("a negative duplicate_delivery_count is rejected (23514)", async () => {
    const { data, error } = await client
      .from("webhook_events")
      .insert({
        ...validWebhookEventInsert("negative-duplicate-count"),
        duplicate_delivery_count: -1,
      })
      .select()
      .single();

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
    expect(data).toBeNull();
  });

  it("a non-null amount_subunits <= 0 is rejected, while NULL remains allowed", async () => {
    for (const invalidAmount of [0, -1]) {
      const { data, error } = await client
        .from("webhook_events")
        .insert({
          ...validWebhookEventInsert(`bad-amount-${invalidAmount}`),
          amount_subunits: invalidAmount,
        })
        .select()
        .single();

      expect(error).not.toBeNull();
      expect(error?.code).toBe("23514");
      expect(data).toBeNull();
    }
  });

  it("a non-null lowercase currency is rejected, while NULL remains allowed", async () => {
    const { data, error } = await client
      .from("webhook_events")
      .insert({
        ...validWebhookEventInsert("lowercase-currency"),
        currency: "inr",
      })
      .select()
      .single();

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
    expect(data).toBeNull();
  });

  it("payment_attempt_id FK rejects a nonexistent payment attempt (23503)", async () => {
    const { data, error } = await client
      .from("webhook_events")
      .insert({
        ...validWebhookEventInsert("fk-reject-attempt"),
        payment_attempt_id: randomUUID(),
      })
      .select()
      .single();

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23503");
    expect(data).toBeNull();
  });

  it("payment_id FK rejects a nonexistent payment (23503)", async () => {
    const { data, error } = await client
      .from("webhook_events")
      .insert({
        ...validWebhookEventInsert("fk-reject-payment"),
        payment_id: randomUUID(),
      })
      .select()
      .single();

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23503");
    expect(data).toBeNull();
  });

  afterAll(async () => {
    for (const id of [...outstandingEventIds]) {
      await client.from("webhook_events").delete().eq("id", id);
    }
  });
});

describe("Phase 2D — anon client is denied on webhook_events", () => {
  const anon = getAnonClientForTest();
  const service = getSupabaseServerClient();

  it("SELECT is denied", async () => {
    const { data, error } = await anon
      .from("webhook_events")
      .select("id")
      .limit(1);
    expect(error).not.toBeNull();
    expect(data === null || data.length === 0).toBe(true);
  });

  it("INSERT is denied and no row is created", async () => {
    const insertPayload = validWebhookEventInsert("anon-insert-denied");
    const { error } = await anon.from("webhook_events").insert(insertPayload);
    expect(error).not.toBeNull();

    const { count, error: verifyError } = await service
      .from("webhook_events")
      .select("id", { count: "exact", head: true })
      .eq("razorpay_event_id", insertPayload.razorpay_event_id);
    expect(verifyError).toBeNull();
    expect(count).toBe(0);
  });

  it("UPDATE is denied (target: random non-existent UUID)", async () => {
    const { error } = await anon
      .from("webhook_events")
      .update({ processing_status: "PROCESSED" })
      .eq("id", randomUUID());
    expect(error).not.toBeNull();
  });

  it("DELETE is denied (target: random non-existent UUID)", async () => {
    const { error } = await anon
      .from("webhook_events")
      .delete()
      .eq("id", randomUUID());
    expect(error).not.toBeNull();
  });
});
