/**
 * Phase 2D/2E — server-only persistence boundary for `webhook_events`.
 *
 * Structural guarantee: `import "server-only"` (same pattern as
 * `lib/demo-merchant/repository.ts`) makes a client-bundle import of this
 * module fail at build time.
 *
 * This module is the ONLY place `webhook_events` is written/read. It
 * performs no signature verification, no JSON parsing, no redaction, and
 * no event normalization/correlation — its input must already be fully
 * verified/validated/redacted/normalized by the caller
 * (`lib/webhooks/service.ts`). This mirrors
 * `lib/demo-merchant/repository.ts`'s existing boundary: repositories are
 * pure persistence, domain/security logic lives one layer up.
 *
 * Phase 2E now owns application-level duplicate recognition (deferred
 * from Phase 2D by the 2026-08-26 architect review correction — see
 * handoffs/PHASE-2-HANDOFF.md): `insertWebhookEvent` returns `null` on a
 * `UNIQUE(razorpay_event_id)` conflict (Postgres `23505`) rather than
 * throwing, mirroring the exact pattern already established by
 * `lib/demo-merchant/repository.ts`'s `insertVerifiedPayment` for the
 * identical race shape. The caller re-reads the existing canonical row via
 * `getWebhookEventByRazorpayEventId` and records the duplicate atomically
 * via `incrementWebhookDuplicateDeliveryCount` (docs/DATABASE.md Section
 * 13 "Duplicate Delivery Rules").
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
 * `razorpay_payment_status` field at insert time — those are DERIVED
 * fields, only ever populated afterward, by `updateWebhookEventDerivedFields`,
 * once Phase 2E normalization/correlation has actually succeeded.
 * `signature_verified` is always `true` here — this function is only ever
 * called after verification has already succeeded (the table's own CHECK
 * constraint also enforces this independently of application code).
 *
 * Returns `null` instead of throwing on a `razorpay_event_id`
 * unique-constraint violation (Postgres error code `23505`) — a genuine
 * Razorpay at-least-once redelivery of an event this table already holds.
 * The database `UNIQUE(razorpay_event_id)` constraint (docs/ARCHITECTURE.md
 * ADR-A08) is the final race-safety boundary against two concurrent
 * deliveries of the same logical event both observing "no existing row"
 * before either inserts — the caller re-reads the now-existing row rather
 * than treating this as a failure, exactly like
 * `lib/demo-merchant/repository.ts`'s `insertVerifiedPayment`.
 */
export async function insertWebhookEvent(
  input: InsertWebhookEventInput,
): Promise<WebhookEventRow | null> {
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
    if (error.code === "23505") {
      return null;
    }
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

/** Reads one canonical `webhook_events` row by its Razorpay event ID, or `null` if none exists. */
export async function getWebhookEventByRazorpayEventId(
  razorpayEventId: string,
): Promise<WebhookEventRow | null> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("webhook_events")
    .select("*")
    .eq("razorpay_event_id", razorpayEventId)
    .maybeSingle();

  if (error) {
    throw new WebhookRepositoryError(
      "WEBHOOK_EVENT_LOOKUP_FAILED",
      "Failed to load the webhook event.",
    );
  }

  return data;
}

/**
 * Atomically increments `webhook_events.duplicate_delivery_count` for one
 * `razorpay_event_id` via the `record_webhook_duplicate_delivery` SQL
 * function (`supabase/migrations/20260827000000_phase2e_webhook_dedup.sql`)
 * and returns the updated canonical row. Deliberately NOT implemented as a
 * SELECT-then-increment-in-application-code-then-UPDATE — that would lose
 * increments under two genuinely concurrent duplicate deliveries; the RPC
 * performs a single atomic `UPDATE ... SET count = count + 1` server-side.
 */
export async function incrementWebhookDuplicateDeliveryCount(
  razorpayEventId: string,
): Promise<WebhookEventRow> {
  const client = getSupabaseServerClient();

  const { data, error } = await client.rpc(
    "record_webhook_duplicate_delivery",
    { p_razorpay_event_id: razorpayEventId },
  );

  if (error || !data) {
    throw new WebhookRepositoryError(
      "WEBHOOK_EVENT_DUPLICATE_INCREMENT_FAILED",
      "Failed to record the duplicate webhook delivery.",
    );
  }

  return data;
}

/**
 * Phase 2G readiness — real server-side lookup of each canonical payment's
 * most recent `webhook_events` row (by `payment_id`), grouped by
 * `payment_id` — never hardcoded, never guessed. Mirrors
 * `lib/demo-merchant/repository.ts`'s `listLatestPaymentsForAttemptIds`
 * batch-lookup shape exactly, for the Demo Merchant evidence UI (this
 * round's Section 6 "Basic Payment/Event Evidence UI").
 *
 * `webhook_events.source_kind` is a fixed-value database CHECK constraint
 * (`docs/DATABASE.md` Section 13: "For this canonical table the only
 * permitted P0 value is: REAL_RAZORPAY_WEBHOOK") — every row this function
 * can possibly return is therefore genuine real-provider evidence by
 * construction, never a PayChaos replay/simulation/test-fixture row (those
 * only ever appear in `event_processing_attempts`, a different table).
 */
export async function listLatestWebhookEventsForPaymentIds(
  paymentIds: readonly string[],
): Promise<Map<string, WebhookEventRow>> {
  const latestByPaymentId = new Map<string, WebhookEventRow>();
  if (paymentIds.length === 0) return latestByPaymentId;

  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("webhook_events")
    .select("*")
    .in("payment_id", [...paymentIds])
    .order("received_at", { ascending: false });

  if (error) {
    throw new WebhookRepositoryError(
      "WEBHOOK_EVENT_LOOKUP_FAILED",
      "Failed to load webhook events for these payments.",
    );
  }

  for (const row of data ?? []) {
    // `payment_id` is nullable at the schema level (only populated once
    // Phase 2E correlation succeeds) — every row reaching this loop was
    // just selected `WHERE payment_id IN (...)`, so it is always present
    // here, but the null check keeps this defensive rather than asserting.
    if (row.payment_id && !latestByPaymentId.has(row.payment_id)) {
      latestByPaymentId.set(row.payment_id, row);
    }
  }

  return latestByPaymentId;
}

export interface UpdateWebhookEventDerivedFieldsInput {
  readonly razorpayOrderId: string | null;
  readonly razorpayPaymentId: string | null;
  readonly paymentAttemptId: string | null;
  readonly paymentId: string | null;
  readonly amountSubunits: number | null;
  readonly currency: string | null;
  readonly razorpayPaymentStatus: string | null;
}

/**
 * Updates ONLY the derived correlation fields on one canonical
 * `webhook_events` row, after Phase 2E normalization/correlation has
 * succeeded (this task's Section 10). Never touches the immutable evidence
 * fields (`razorpay_event_id`/`event_type`/`source_kind`/
 * `signature_verified`/`received_at`/`provider_created_at`/
 * `raw_body_sha256`/`raw_payload_redacted`) — this function's parameter
 * type structurally cannot carry any of them. Also never touches
 * `processing_status`/`processed_at` — those stay `RECEIVED`/`NULL`
 * through Phase 2E; Phase 2F owns transitioning them.
 */
export async function updateWebhookEventDerivedFields(
  id: string,
  input: UpdateWebhookEventDerivedFieldsInput,
): Promise<WebhookEventRow> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("webhook_events")
    .update({
      razorpay_order_id: input.razorpayOrderId,
      razorpay_payment_id: input.razorpayPaymentId,
      payment_attempt_id: input.paymentAttemptId,
      payment_id: input.paymentId,
      amount_subunits: input.amountSubunits,
      currency: input.currency,
      razorpay_payment_status: input.razorpayPaymentStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    throw new WebhookRepositoryError(
      "WEBHOOK_EVENT_DERIVED_UPDATE_FAILED",
      "Failed to update the webhook event's derived fields.",
    );
  }

  return data;
}
