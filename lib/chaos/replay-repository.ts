/**
 * Phase 3C (C01) / Phase 3D-D (C11-B) — server-only persistence boundary for
 * controlled replay (docs/CHAOS_SCENARIOS.md Section 13 "P0 SCENARIO C01",
 * Section 23 "P0 SCENARIO C11").
 *
 * This module performs exactly three operations: (1) a deterministic,
 * fail-closed READ that resolves the one authoritative original
 * `event_processing_attempts` row a C01 chaos run is allowed to replay
 * (`resolveAuthoritativeC01ReplaySource`), (1B) the same, narrowed to C11's
 * `payment.failed` semantics (`resolveAuthoritativeC11ReplaySource`, Phase
 * 3D-D — a genuinely separate function, never sharing mutable state with or
 * changing the C01 resolver's behavior), and (2) a dedicated INSERT for a
 * new `PAYCHAOS_REPLAY` processing attempt, shared by both scenarios. It
 * never touches the live Phase 2 ingestion path
 * (`lib/webhooks/event-processing-repository.ts`'s `insertEventProcessingAttempt`
 * stays untouched — it is embedded in three live production real-webhook
 * call sites and must never change behavior for this task). It never
 * inserts/updates `webhook_events`, never calls
 * `record_webhook_duplicate_delivery`, and never mutates
 * `orders`/`payment_attempts`/`payments`/`fulfilments` — those mutations
 * happen only inside the existing `process_webhook_payment_event`
 * transaction, invoked separately via `lib/events/processor.ts`.
 *
 * Structural guarantee: `import "server-only"` (same pattern as every other
 * repository in this codebase) makes a client-bundle import of this module
 * fail at build time.
 */
import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  Database,
  EventProcessingAttemptSourceKind,
} from "@/lib/supabase/types";

export type EventProcessingAttemptRow =
  Database["public"]["Tables"]["event_processing_attempts"]["Row"];
export type ChaosRunRow = Database["public"]["Tables"]["chaos_runs"]["Row"];

/** Deterministic domain error for this repository's I/O failures — never leaks the raw Supabase error (matches every other repository's error-boundary convention in this codebase). */
export class ChaosReplayRepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ChaosReplayRepositoryError";
    this.code = code;
  }
}

/** The narrow slice of a `chaos_runs` row this module's source resolution needs — accepting the full row is also fine, this exists so callers/tests do not need to fabricate irrelevant fields. */
export interface C01ReplaySourceQuery {
  readonly sourceWebhookEventId: string | null;
  readonly paymentAttemptId: string | null;
  readonly paymentId: string | null;
}

/** The C01 P0 source event types this codebase's merchant processor understands (docs/CHAOS_SCENARIOS.md Section 13 "Inputs / Events Used"). */
const ALLOWED_C01_SOURCE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "payment.captured",
  "order.paid",
]);

export interface ResolvedC01ReplaySource {
  readonly processingAttemptId: string;
  readonly webhookEventId: string;
  readonly paymentAttemptId: string | null;
  readonly paymentId: string | null;
  readonly normalizedEvent: Record<string, unknown>;
}

function isSafeNormalizedEventObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolves the ONE authoritative original `event_processing_attempts` row a
 * C01 chaos run may replay (docs/CHAOS_SCENARIOS.md Section 13 "Exact
 * Injection / Replay Method", this task's Section 6 "Source Attempt
 * Resolution"). Requires ALL of:
 *   - the correlated canonical `webhook_events` row exists, is
 *     `source_kind = REAL_RAZORPAY_WEBHOOK`, `signature_verified = true`,
 *     and has a P0-supported `event_type`;
 *   - an `event_processing_attempts` row exists with
 *     `source_kind = REAL_RAZORPAY_WEBHOOK`, `status = SUCCEEDED`,
 *     `is_duplicate_delivery = false`, `webhook_event_id` matching the run's
 *     `source_webhook_event_id`, and `payment_attempt_id`/`payment_id`
 *     matching the run's own correlation (including truthful NULL
 *     equality — a run whose `payment_id` is NULL only matches an attempt
 *     whose `payment_id` is also NULL, never any non-NULL value);
 *   - exactly ONE such row exists;
 *   - its `normalized_event` is a JSON object whose `sourceKind` is
 *     `REAL_RAZORPAY_WEBHOOK`, whose `eventType` is one of the P0-supported
 *     C01 source event types, whose `kind` equals that `eventType`, and
 *     whose `eventType` agrees with the correlated canonical
 *     `webhook_events.event_type` (architect correction, Finding 3 —
 *     defense in depth: a historical `SUCCEEDED` status only proves the
 *     envelope was valid at ORIGINAL processing time, not that it is
 *     unchanged now, since service-role code can later mutate any row).
 *     This does NOT duplicate the processor's full deterministic merchant
 *     validation (amount/currency/payment correlation remain solely
 *     `process_webhook_payment_event`'s authority) — it only re-establishes
 *     the minimum provenance/envelope agreement needed to call this
 *     "authoritative replay evidence" at all.
 *
 * Returns `null` (never fabricates a source, never guesses) if any of that
 * does not hold — including when MORE than one candidate row exists: with
 * no deterministic way to prove which one is the canonical original (e.g.
 * a prior replay attempt somehow also reached SUCCEEDED with the same
 * correlation — should not happen given `PAYCHAOS_REPLAY`'s distinct
 * `source_kind`, but this function never assumes that invariant holds
 * elsewhere and fails closed instead of picking "the latest" one).
 */
export async function resolveAuthoritativeC01ReplaySource(
  run: C01ReplaySourceQuery,
): Promise<ResolvedC01ReplaySource | null> {
  if (!run.sourceWebhookEventId) {
    return null;
  }

  const client = getSupabaseServerClient();

  const { data: webhookEvent, error: webhookError } = await client
    .from("webhook_events")
    .select("*")
    .eq("id", run.sourceWebhookEventId)
    .maybeSingle();

  if (webhookError) {
    throw new ChaosReplayRepositoryError(
      "CHAOS_REPLAY_WEBHOOK_LOOKUP_FAILED",
      "Failed to load the correlated webhook event.",
    );
  }
  if (!webhookEvent) {
    return null;
  }
  if (
    webhookEvent.source_kind !== "REAL_RAZORPAY_WEBHOOK" ||
    webhookEvent.signature_verified !== true
  ) {
    return null;
  }
  if (!ALLOWED_C01_SOURCE_EVENT_TYPES.has(webhookEvent.event_type)) {
    return null;
  }

  let query = client
    .from("event_processing_attempts")
    .select("*")
    .eq("webhook_event_id", run.sourceWebhookEventId)
    .eq(
      "source_kind",
      "REAL_RAZORPAY_WEBHOOK" satisfies EventProcessingAttemptSourceKind,
    )
    .eq("status", "SUCCEEDED")
    .eq("is_duplicate_delivery", false);

  query =
    run.paymentAttemptId === null
      ? query.is("payment_attempt_id", null)
      : query.eq("payment_attempt_id", run.paymentAttemptId);

  query =
    run.paymentId === null
      ? query.is("payment_id", null)
      : query.eq("payment_id", run.paymentId);

  const { data: candidates, error } = await query;

  if (error) {
    throw new ChaosReplayRepositoryError(
      "CHAOS_REPLAY_SOURCE_LOOKUP_FAILED",
      "Failed to load candidate source processing attempts.",
    );
  }

  // Zero candidates: nothing suitable. More than one: no deterministic way
  // to prove which is the canonical original — fail closed either way,
  // never pick "the latest" (this task's Section 6 explicit instruction).
  if (!candidates || candidates.length !== 1) {
    return null;
  }

  const attempt = candidates[0]!;

  if (!attempt.webhook_event_id) {
    // Cannot happen given the query filter above, but never trust a
    // non-null assertion for a value that is later returned as the FK this
    // module's caller will persist.
    return null;
  }

  if (!isSafeNormalizedEventObject(attempt.normalized_event)) {
    return null;
  }
  const { sourceKind, eventType, kind } = attempt.normalized_event;

  // Architect correction, Finding 3 (defense in depth) — a historical
  // SUCCEEDED attempt proves its envelope was valid at ORIGINAL processing
  // time, not that it is unchanged now: service-role code can later mutate
  // any row. Re-check the minimum provenance/envelope facts a value must
  // still satisfy to be called "authoritative replay evidence" — this does
  // NOT duplicate the processor's full deterministic merchant validation
  // (amount/currency/payment correlation remain solely the processor's
  // authority); it only re-establishes provenance/shape agreement.
  if (sourceKind !== "REAL_RAZORPAY_WEBHOOK") {
    return null;
  }
  if (
    typeof eventType !== "string" ||
    !ALLOWED_C01_SOURCE_EVENT_TYPES.has(eventType)
  ) {
    return null;
  }
  if (kind !== eventType) {
    return null;
  }
  if (eventType !== webhookEvent.event_type) {
    return null;
  }

  return {
    processingAttemptId: attempt.id,
    webhookEventId: attempt.webhook_event_id,
    paymentAttemptId: attempt.payment_attempt_id,
    paymentId: attempt.payment_id,
    normalizedEvent: attempt.normalized_event,
  };
}

/** The C11 Mechanism B `payment.failed` source event type (docs/CHAOS_SCENARIOS.md Section 23 "Inputs / Events Used") — the only event type C11-B may ever replay. Never `payment.captured`/`order.paid` (those are C01's concern). */
const C11_SOURCE_EVENT_TYPE = "payment.failed" as const;

/** The narrow slice of a `chaos_runs` row this module's C11 source resolution needs — same shape as `C01ReplaySourceQuery`, kept as its own distinct type so a future divergence in either scenario's needs never silently couples the two. */
export interface C11ReplaySourceQuery {
  readonly sourceWebhookEventId: string | null;
  readonly paymentAttemptId: string | null;
  readonly paymentId: string | null;
}

export interface ResolvedC11ReplaySource {
  readonly processingAttemptId: string;
  readonly webhookEventId: string;
  readonly paymentAttemptId: string | null;
  readonly paymentId: string | null;
  readonly normalizedEvent: Record<string, unknown>;
}

/**
 * Resolves the ONE authoritative original `event_processing_attempts` row a
 * C11-B chaos run may replay (docs/CHAOS_SCENARIOS.md Section 23, Phase
 * 3D-D). Mirrors `resolveAuthoritativeC01ReplaySource`'s exact fail-closed
 * discipline above, narrowed to C11's `payment.failed` semantics — a
 * genuinely separate function that shares no mutable state with, and never
 * changes the behavior of, the C01 resolver (only the private
 * `isSafeNormalizedEventObject` shape-check helper is reused, read-only).
 * Requires ALL of:
 *   - the correlated canonical `webhook_events` row exists, is
 *     `source_kind = REAL_RAZORPAY_WEBHOOK`, `signature_verified = true`,
 *     `event_type = payment.failed`, and `processing_status = PROCESSED`
 *     (this task's Section 4 — stricter than C01's resolver, which does not
 *     require a particular `processing_status`);
 *   - an `event_processing_attempts` row exists with
 *     `source_kind = REAL_RAZORPAY_WEBHOOK`, `status = SUCCEEDED`,
 *     `is_duplicate_delivery = false`, `webhook_event_id` matching the run's
 *     `source_webhook_event_id`, and `payment_attempt_id`/`payment_id`
 *     matching the run's own correlation (including truthful NULL equality
 *     — the same semantics as the C01 resolver);
 *   - exactly ONE such row exists (zero or more than one both fail closed —
 *     never "latest"/"first"/arbitrary);
 *   - its `normalized_event` is a JSON object whose `sourceKind` is
 *     `REAL_RAZORPAY_WEBHOOK`, whose `eventType` is exactly
 *     `payment.failed`, whose `kind` equals `payment.failed`, whose
 *     `razorpayPaymentStatus` is exactly `failed`, and whose `eventType`
 *     agrees with the correlated canonical `webhook_events.event_type`.
 *
 * Returns `null` (never fabricates a source, never guesses) if any of that
 * does not hold. Throws `ChaosReplayRepositoryError` only on a genuine read
 * failure, distinct from "not found"/"not eligible".
 */
export async function resolveAuthoritativeC11ReplaySource(
  run: C11ReplaySourceQuery,
): Promise<ResolvedC11ReplaySource | null> {
  if (!run.sourceWebhookEventId) {
    return null;
  }

  const client = getSupabaseServerClient();

  const { data: webhookEvent, error: webhookError } = await client
    .from("webhook_events")
    .select("*")
    .eq("id", run.sourceWebhookEventId)
    .maybeSingle();

  if (webhookError) {
    throw new ChaosReplayRepositoryError(
      "CHAOS_REPLAY_C11_WEBHOOK_LOOKUP_FAILED",
      "Failed to load the correlated webhook event.",
    );
  }
  if (!webhookEvent) {
    return null;
  }
  if (
    webhookEvent.source_kind !== "REAL_RAZORPAY_WEBHOOK" ||
    webhookEvent.signature_verified !== true ||
    webhookEvent.event_type !== C11_SOURCE_EVENT_TYPE ||
    webhookEvent.processing_status !== "PROCESSED"
  ) {
    return null;
  }

  let query = client
    .from("event_processing_attempts")
    .select("*")
    .eq("webhook_event_id", run.sourceWebhookEventId)
    .eq(
      "source_kind",
      "REAL_RAZORPAY_WEBHOOK" satisfies EventProcessingAttemptSourceKind,
    )
    .eq("status", "SUCCEEDED")
    .eq("is_duplicate_delivery", false);

  query =
    run.paymentAttemptId === null
      ? query.is("payment_attempt_id", null)
      : query.eq("payment_attempt_id", run.paymentAttemptId);

  query =
    run.paymentId === null
      ? query.is("payment_id", null)
      : query.eq("payment_id", run.paymentId);

  const { data: candidates, error } = await query;

  if (error) {
    throw new ChaosReplayRepositoryError(
      "CHAOS_REPLAY_C11_SOURCE_LOOKUP_FAILED",
      "Failed to load candidate source processing attempts.",
    );
  }

  // Zero candidates: nothing suitable. More than one: no deterministic way
  // to prove which is the canonical original — fail closed either way,
  // never pick "the latest" (same discipline as the C01 resolver above).
  if (!candidates || candidates.length !== 1) {
    return null;
  }

  const attempt = candidates[0]!;

  if (!attempt.webhook_event_id) {
    return null;
  }

  if (!isSafeNormalizedEventObject(attempt.normalized_event)) {
    return null;
  }
  const { sourceKind, eventType, kind, razorpayPaymentStatus } =
    attempt.normalized_event;

  if (sourceKind !== "REAL_RAZORPAY_WEBHOOK") {
    return null;
  }
  if (eventType !== C11_SOURCE_EVENT_TYPE) {
    return null;
  }
  if (kind !== C11_SOURCE_EVENT_TYPE) {
    return null;
  }
  if (razorpayPaymentStatus !== "failed") {
    return null;
  }
  if (eventType !== webhookEvent.event_type) {
    return null;
  }

  return {
    processingAttemptId: attempt.id,
    webhookEventId: attempt.webhook_event_id,
    paymentAttemptId: attempt.payment_attempt_id,
    paymentId: attempt.payment_id,
    normalizedEvent: attempt.normalized_event,
  };
}

export interface InsertReplayProcessingAttemptInput {
  readonly chaosRunId: string;
  readonly webhookEventId: string;
  readonly paymentAttemptId: string | null;
  readonly paymentId: string | null;
  readonly normalizedEvent: Record<string, unknown>;
}

/**
 * Inserts one NEW `PAYCHAOS_REPLAY` `event_processing_attempts` row (this
 * task's Section 7 "Insert Replay Attempt"). Always:
 *   - `source_kind = PAYCHAOS_REPLAY`;
 *   - `is_duplicate_delivery = false` (a replay is explicitly NOT a genuine
 *     duplicate HTTP delivery from Razorpay);
 *   - `status = PENDING` (driven through the existing
 *     `process_webhook_payment_event` lifecycle by the caller, exactly like
 *     any other attempt);
 *   - `chaos_run_id` set to the requesting run.
 *
 * `webhook_event_id`/`payment_attempt_id`/`payment_id`/`normalized_event`
 * are copied verbatim from the caller's already-resolved authoritative
 * source (`resolveAuthoritativeC01ReplaySource`) — this function never
 * recomputes or rewrites `normalized_event`, so
 * `normalized_event.sourceKind` stays truthfully `REAL_RAZORPAY_WEBHOOK`
 * (it describes the evidence's origin, not who is replaying it — this
 * task's Section 2).
 *
 * Never inserts a `webhook_events` row, never updates one, never calls
 * `record_webhook_duplicate_delivery` — this function touches
 * `event_processing_attempts` only.
 */
export async function insertReplayProcessingAttempt(
  input: InsertReplayProcessingAttemptInput,
): Promise<EventProcessingAttemptRow> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("event_processing_attempts")
    .insert({
      webhook_event_id: input.webhookEventId,
      payment_attempt_id: input.paymentAttemptId,
      payment_id: input.paymentId,
      chaos_run_id: input.chaosRunId,
      source_kind: "PAYCHAOS_REPLAY",
      is_duplicate_delivery: false,
      status: "PENDING",
      normalized_event: input.normalizedEvent,
      error_code: null,
      error_message_redacted: null,
    })
    .select()
    .single();

  if (error || !data) {
    throw new ChaosReplayRepositoryError(
      "CHAOS_REPLAY_ATTEMPT_INSERT_FAILED",
      "Failed to persist the replay processing attempt.",
    );
  }

  return data;
}
