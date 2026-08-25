/**
 * Phase 2E — server-only persistence boundary for
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
