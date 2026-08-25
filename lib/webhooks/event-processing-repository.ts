/**
 * Phase 2E/2F — server-only persistence boundary for
 * `event_processing_attempts`.
 *
 * Structural guarantee: `import "server-only"` (same pattern as every
 * other repository in this codebase) makes a client-bundle import of this
 * module fail at build time.
 *
 * This module is the ONLY place `event_processing_attempts` is
 * written/read. It performs no normalization, no correlation, and no
 * signature verification — its input must already be fully
 * normalized/correlated by the caller (`lib/webhooks/service.ts`). This
 * mirrors every other repository in this codebase: repositories are pure
 * persistence, domain/security logic lives one layer up.
 *
 * Phase 2F adds `processWebhookPaymentEvent` — the thin RPC wrapper around
 * the single narrow `process_webhook_payment_event` transaction
 * (supabase/migrations/20260828000000_phase2f_merchant_processing.sql) —
 * and `markEventProcessingAttemptFailedIfNotFinal`, the conditional
 * "ambiguous RPC failure safety" marker. `lib/events/processor.ts` is the
 * actual processor application boundary (this task's Section 25); this
 * module remains pure persistence/RPC-transport, same as every other
 * repository here.
 */
import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

export type EventProcessingAttemptRow =
  Database["public"]["Tables"]["event_processing_attempts"]["Row"];
export type EventProcessingAttemptStatus = EventProcessingAttemptRow["status"];

/** Deterministic domain error for this repository's I/O failures — never leaks the raw Supabase error. */
export class EventProcessingRepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EventProcessingRepositoryError";
    this.code = code;
  }
}

export interface InsertEventProcessingAttemptInput {
  readonly webhookEventId: string;
  readonly paymentAttemptId: string | null;
  readonly paymentId: string | null;
  readonly isDuplicateDelivery: boolean;
  readonly status: EventProcessingAttemptStatus;
  readonly normalizedEvent: Record<string, unknown>;
  readonly errorCode: string | null;
  readonly errorMessageRedacted: string | null;
}

/**
 * Statuses that represent a COMPLETED processing attempt — `finished_at`
 * is set for these and only these (2026-08-27 architect review correction
 * "Correction A"). `PENDING`/`HELD`/`PROCESSING` are still in flight (from
 * this row's own point of view) and must have `finished_at = NULL`, per
 * docs/DATABASE.md's own definition of the column
 * ("finished_at — Completion time"). Phase 2E itself only ever inserts
 * `PENDING`/`FAILED`/`SKIPPED_DUPLICATE`; `SUCCEEDED` is listed here only
 * so this repository stays correct once Phase 2F starts using it — this
 * module never decides business meaning, only completion-timestamp
 * mechanics for whatever status the caller (a Phase 2E or later Phase 2F
 * caller) passes.
 */
const TERMINAL_STATUSES: ReadonlySet<EventProcessingAttemptStatus> = new Set([
  "FAILED",
  "SKIPPED_DUPLICATE",
  "SUCCEEDED",
]);

/**
 * Deterministically derives `finished_at` from `status` — never accepted
 * as caller input, so nothing upstream (there is no browser input on this
 * path at all, but the principle holds regardless) can make an in-flight
 * attempt claim to be finished.
 */
function deriveFinishedAt(status: EventProcessingAttemptStatus): string | null {
  return TERMINAL_STATUSES.has(status) ? new Date().toISOString() : null;
}

/**
 * Inserts one `event_processing_attempts` row. Phase 2E only ever passes
 * `status` of `PENDING`, `FAILED`, or `SKIPPED_DUPLICATE` (this task's
 * Section 17) — `PROCESSING`/`SUCCEEDED`/`HELD` remain valid per the
 * database CHECK constraint but are Phase 2F's to use; this function does
 * not restrict the caller further than the database already does, since
 * restricting it here would just duplicate the database's own CHECK.
 *
 * `source_kind` is always `REAL_RAZORPAY_WEBHOOK` — Phase 2E has no other
 * provenance to record from (this task's Section 16).
 *
 * `finished_at` is derived from `status` (Section above) — a `PENDING`
 * insert is `NULL`; `FAILED`/`SKIPPED_DUPLICATE` (Phase 2E) and
 * `SUCCEEDED` (Phase 2F) get the current timestamp.
 */
export async function insertEventProcessingAttempt(
  input: InsertEventProcessingAttemptInput,
): Promise<EventProcessingAttemptRow> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("event_processing_attempts")
    .insert({
      webhook_event_id: input.webhookEventId,
      payment_attempt_id: input.paymentAttemptId,
      payment_id: input.paymentId,
      source_kind: "REAL_RAZORPAY_WEBHOOK",
      is_duplicate_delivery: input.isDuplicateDelivery,
      status: input.status,
      normalized_event: input.normalizedEvent,
      error_code: input.errorCode,
      error_message_redacted: input.errorMessageRedacted,
      finished_at: deriveFinishedAt(input.status),
    })
    .select()
    .single();

  if (error || !data) {
    throw new EventProcessingRepositoryError(
      "EVENT_PROCESSING_ATTEMPT_INSERT_FAILED",
      "Failed to persist the event processing attempt.",
    );
  }

  return data;
}

/**
 * Statuses that constitute an existing DURABLE, normalized/ready-or-later
 * attempt for one webhook event — used to decide whether a duplicate
 * delivery may safely skip re-normalization (2026-08-27 architect review
 * correction "Correction B"). `PENDING` (Phase 2E's own terminal-for-now
 * state), plus `HELD`/`PROCESSING`/`SUCCEEDED` (Phase 2F states) all mean
 * "a normalized attempt already exists and is not a dead end" — a later
 * duplicate must not re-normalize just because the row has since advanced
 * past `PENDING`. `FAILED` and `SKIPPED_DUPLICATE` are deliberately
 * excluded: `FAILED` never established successful normalization, and
 * `SKIPPED_DUPLICATE` is itself only a marker that an eligible attempt
 * existed at THAT time — it must never be treated as the eligible attempt
 * itself, or a chain of duplicates would each see only the previous
 * `SKIPPED_DUPLICATE` and incorrectly re-normalize.
 */
const DURABLE_NORMALIZED_STATUSES: readonly EventProcessingAttemptStatus[] = [
  "PENDING",
  "HELD",
  "PROCESSING",
  "SUCCEEDED",
];

/**
 * Reads the most recent ELIGIBLE (durable, normalized-or-later)
 * `event_processing_attempts` row for one `webhook_event_id`, or `null` if
 * none exists yet. The query itself filters to `DURABLE_NORMALIZED_STATUSES`
 * — this is a direct database-level selection of an eligible row, not "load
 * the single latest row of any status and reason about it in memory" (the
 * pre-correction defect: a later `SKIPPED_DUPLICATE`/`FAILED` row could
 * hide an earlier eligible `PENDING` one). Used to decide whether a
 * duplicate delivery should skip re-normalization (an eligible row exists)
 * or retry it (no eligible row exists — i.e. no attempt yet, or every
 * attempt so far is `FAILED`) — this task's Section 14/Correction B.
 */
export async function getDurableNormalizedAttemptForWebhookEvent(
  webhookEventId: string,
): Promise<EventProcessingAttemptRow | null> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("event_processing_attempts")
    .select("*")
    .eq("webhook_event_id", webhookEventId)
    .in("status", DURABLE_NORMALIZED_STATUSES)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new EventProcessingRepositoryError(
      "EVENT_PROCESSING_ATTEMPT_LOOKUP_FAILED",
      "Failed to load event processing attempts for this webhook event.",
    );
  }

  return data;
}

/**
 * Phase 2F — the shape returned by the `process_webhook_payment_event`
 * transactional RPC (supabase/migrations/20260828000000_phase2f_merchant_processing.sql).
 * Deliberately narrow (this task's Section 26): no raw normalized evidence,
 * no secrets, no raw webhook body, no database error detail.
 */
export interface ProcessWebhookPaymentEventResult {
  readonly outcome: "processed" | "already_processed";
  readonly eventType: string;
  readonly orderId: string;
  readonly paymentId: string | null;
  readonly fulfilmentId: string | null;
}

/**
 * Deterministic safe processing failure codes the
 * `process_webhook_payment_event` SQL function raises (this task's Section
 * 27) — each `RAISE EXCEPTION` in the migration begins with exactly one of
 * these tokens followed by `:`. Kept in sync with the migration by hand;
 * any Postgres error whose message does not start with one of these is
 * mapped to the generic `PROCESSING_TRANSACTION_FAILED` fallback rather
 * than ever forwarding raw SQL error text.
 */
const KNOWN_PROCESSOR_ERROR_CODES: ReadonlySet<string> = new Set([
  "PROCESSING_ATTEMPT_NOT_FOUND",
  "PROCESSING_ATTEMPT_NOT_READY",
  "PROCESSING_SOURCE_INVALID",
  "PROCESSING_EVENT_INVALID",
  "PROCESSING_CORRELATION_INVALID",
  "PROCESSING_PAYMENT_REQUIRED",
  "PROCESSING_AMOUNT_MISMATCH",
  "PROCESSING_CURRENCY_MISMATCH",
  "PROCESSING_FULFILMENT_CONFLICT",
  "PROCESSING_TRANSACTION_FAILED",
]);

const PROCESSOR_ERROR_CODE_PATTERN = /^([A-Z_]+):/;

/**
 * Extracts only the leading deterministic code token from a Postgres error
 * message (e.g. `"PROCESSING_AMOUNT_MISMATCH: amount_subunits disagree..."`
 * -> `"PROCESSING_AMOUNT_MISMATCH"`), discarding everything else — this is
 * the ONLY part of the raw database error text that is ever propagated
 * beyond this function, and even that only as a fixed code, never as free
 * text (this task's Section 27 "do not expose raw SQL errors").
 */
function extractProcessorErrorCode(message: string | undefined): string {
  const match = message ? PROCESSOR_ERROR_CODE_PATTERN.exec(message) : null;
  const code = match?.[1];
  return code && KNOWN_PROCESSOR_ERROR_CODES.has(code)
    ? code
    : "PROCESSING_TRANSACTION_FAILED";
}

function isValidProcessorResult(value: unknown): value is Record<
  string,
  unknown
> & {
  outcome: "processed" | "already_processed";
} {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.outcome === "processed" ||
      record.outcome === "already_processed") &&
    typeof record.event_type === "string" &&
    typeof record.order_id === "string" &&
    (record.payment_id === null || typeof record.payment_id === "string") &&
    (record.fulfilment_id === null || typeof record.fulfilment_id === "string")
  );
}

/**
 * Phase 2F — invokes the single narrow `process_webhook_payment_event`
 * transactional RPC for one internal processing-attempt id (this task's
 * Sections 3/25/26). This is the ONLY place that calls this RPC — never a
 * sequence of independent UPDATE/INSERT calls that could commit partially.
 *
 * Never accepts a normalized event, order id, payment id, amount, currency,
 * status, or fulfilment key from its own caller — the ONLY parameter is the
 * internal processing-attempt id; every fact the transaction acts on is
 * loaded from trusted database rows inside the SQL function itself.
 *
 * Throws `EventProcessingRepositoryError` with a deterministic safe `.code`
 * (one of `KNOWN_PROCESSOR_ERROR_CODES`) on any failure — never leaks the
 * raw Postgres error message.
 */
export async function processWebhookPaymentEvent(
  processingAttemptId: string,
): Promise<ProcessWebhookPaymentEventResult> {
  const client = getSupabaseServerClient();

  const { data, error } = await client.rpc("process_webhook_payment_event", {
    p_processing_attempt_id: processingAttemptId,
  });

  if (error) {
    const code = extractProcessorErrorCode(error.message);
    throw new EventProcessingRepositoryError(
      code,
      `Merchant processing failed (${code}).`,
    );
  }

  if (!isValidProcessorResult(data)) {
    throw new EventProcessingRepositoryError(
      "PROCESSING_TRANSACTION_FAILED",
      "Merchant processing returned an unexpected result shape.",
    );
  }

  return {
    outcome: data.outcome,
    eventType: data.event_type as string,
    orderId: data.order_id as string,
    paymentId: (data.payment_id as string | null) ?? null,
    fulfilmentId: (data.fulfilment_id as string | null) ?? null,
  };
}

/**
 * Phase 2F — "ambiguous RPC failure safety" (this task's Section 21).
 * Application code calling `processWebhookPaymentEvent` must behave safely
 * if the RPC call itself errors (which may be a genuine database-side
 * rejection, OR a network/client error masking a transaction that actually
 * committed SUCCEEDED server-side). This function marks the target
 * processing attempt `FAILED` ONLY via a conditional
 * `WHERE id = ... AND status IN ('PENDING', 'PROCESSING')` update — so it
 * can never regress an attempt that is already `SUCCEEDED` (or any other
 * terminal status) back to `FAILED`. Never throws: a failure to record the
 * failure must never mask the original error the caller is already
 * propagating, and must never itself become an unhandled rejection (same
 * best-effort contract as `lib/webhooks/service.ts`'s
 * `recordFailedProcessingAttempt`).
 */
export async function markEventProcessingAttemptFailedIfNotFinal(
  id: string,
  errorCode: string,
  errorMessageRedacted: string,
): Promise<void> {
  try {
    const client = getSupabaseServerClient();
    await client
      .from("event_processing_attempts")
      .update({
        status: "FAILED",
        error_code: errorCode,
        error_message_redacted: errorMessageRedacted,
        finished_at: new Date().toISOString(),
      })
      .eq("id", id)
      .in("status", ["PENDING", "PROCESSING"]);
  } catch {
    // Best-effort only — never mask the original error the caller is
    // about to (re)throw.
  }
}
