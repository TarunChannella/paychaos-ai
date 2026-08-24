/**
 * Phase 2D — server-only persistence boundary for `webhook_events`.
 *
 * Structural guarantee: `import "server-only"` (same pattern as
 * `lib/demo-merchant/repository.ts`) makes a client-bundle import of this
 * module fail at build time.
 *
 * This module is the ONLY place `webhook_events` is written/read. It
 * performs no signature verification, no JSON parsing, and no redaction —
 * its input must already be fully verified/validated/redacted by the
 * caller (`lib/webhooks/service.ts`). This mirrors
 * `lib/demo-merchant/repository.ts`'s existing boundary: repositories are
 * pure persistence, domain/security logic lives one layer up.
 */
import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

export type WebhookEventRow =
  Database["public"]["Tables"]["webhook_events"]["Row"];

/** Deterministic domain error for this repository's I/O failures — never leaks the raw Supabase error. */
export class WebhookRepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WebhookRepositoryError";
    this.code = code;
  }
}

export interface InsertWebhookEventInput {
  readonly razorpayEventId: string;
  readonly eventType: string;
  readonly providerCreatedAt: string | null;
  readonly rawBodySha256: string;
  readonly rawPayloadRedacted: Record<string, unknown>;
}

/**
 * Inserts one canonical `webhook_events` row for an ALREADY
 * signature-verified, already-parsed, already-redacted Razorpay webhook.
 *
 * Deliberately accepts no `razorpay_order_id`/`razorpay_payment_id`/
 * `payment_attempt_id`/`payment_id`/`amount_subunits`/`currency`/
 * `razorpay_payment_status` field — Phase 2D leaves every
 * normalization/correlation column `NULL` (database default); populating
 * them is Phase 2E's event-normalization responsibility
 * (docs/DATABASE.md Section 13 Phase Ownership). `signature_verified` is
 * always `true` here — this function is only ever called after
 * verification has already succeeded (the table's own CHECK constraint
 * also enforces this independently of application code).
 */
export async function insertWebhookEvent(
  input: InsertWebhookEventInput,
): Promise<WebhookEventRow> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("webhook_events")
    .insert({
      razorpay_event_id: input.razorpayEventId,
      event_type: input.eventType,
      signature_verified: true,
      provider_created_at: input.providerCreatedAt,
      raw_body_sha256: input.rawBodySha256,
      raw_payload_redacted: input.rawPayloadRedacted,
    })
    .select()
    .single();

  if (error) {
    // Phase 2D treats every insert failure identically, including a
    // `UNIQUE(razorpay_event_id)` conflict (Postgres `23505`) — a real
    // Razorpay redelivery of an event this table has already recorded.
    // Recognizing and safely acknowledging that specific case is Phase
    // 2E's duplicate-delivery workflow (`duplicate_delivery_count`,
    // normalized duplicate handling); Phase 2D deliberately does not
    // interpret 23505 specially (2026-08-26 architect review correction —
    // see handoffs/PHASE-2-HANDOFF.md).
    throw new WebhookRepositoryError(
      "WEBHOOK_EVENT_INSERT_FAILED",
      "Failed to persist the webhook event.",
    );
  }
  if (!data) {
    throw new WebhookRepositoryError(
      "WEBHOOK_EVENT_INSERT_FAILED",
      "Failed to persist the webhook event.",
    );
  }

  return data;
}
