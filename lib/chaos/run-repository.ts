/**
 * Phase 3B — server-only, durable `chaos_runs` persistence
 * (docs/DATABASE.md Section 15, this task's Section 10).
 *
 * This module performs exactly two write shapes and one read — nothing
 * else. It never replays a webhook, injects a fault, calls Razorpay, or
 * mutates `orders`/`payment_attempts`/`payments`/`fulfilments` in any way.
 *
 * Exported surface is deliberately exactly three functions:
 *   - `createPendingChaosRun`  — a Phase 3A `PRECHECK_PASSED` result.
 *   - `createBlockedChaosRun`  — a persistable Phase 3A `BLOCKED` result
 *     (see `lib/chaos/run-service.ts` for which precheck IDs qualify).
 *   - `getChaosRunById`        — read-only lookup.
 * No `startRun`/`transitionRun`/`completeRun`/`failRun`/
 * `updateFaultState`, and no other speculative Phase 3C+ lifecycle
 * function — those belong to whichever later phase actually executes a
 * mechanism and needs them.
 *
 * Every entity FK (`orderId`/`paymentAttemptId`/`paymentId`/
 * `sourceWebhookEventId`) is optional and nullable here by design — this
 * module never fabricates one. The caller (`lib/chaos/run-service.ts`)
 * is responsible for having already independently established that any
 * non-null value it passes refers to a genuinely valid, resolved record;
 * this repository trusts its caller for that and only enforces persistence
 * shape (which fields are required for which of the two write shapes).
 *
 * `fault_config`/`fault_state` are always written as `{}` by both write
 * functions — this repository never accepts or persists an arbitrary
 * caller-supplied JSON object for either column.
 */
import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ChaosRunDataClassification,
  ChaosRunFaultType,
  ChaosRunScenarioId,
  Database,
} from "@/lib/supabase/types";

export type ChaosRunRow = Database["public"]["Tables"]["chaos_runs"]["Row"];

/**
 * The only Phase 3A `BLOCKED` precheck IDs Phase 3B's approved persistence
 * contract ever writes to `chaos_runs` (architect correction, Finding 2).
 * The `chaos_runs.failed_precheck_id` DATABASE column CHECK constraint
 * intentionally stays future-capable and allows the full `PRECHECK-01`
 * through `PRECHECK-10` range (already architect-approved schema) — this
 * narrower TypeScript type is the Phase 3B repository API's own additional
 * restriction, independent of and stricter than the DB CHECK. It is a
 * repository-local type, not a modification to the frozen Phase 3A
 * `ChaosPrecheckId` union in `lib/chaos/types.ts`.
 */
export type PersistableChaosRunFailedPrecheckId =
  "PRECHECK-07" | "PRECHECK-08" | "PRECHECK-09" | "PRECHECK-10";

/** Deterministic domain error for this repository's I/O failures — never leaks the raw Supabase error (matches every other repository's error-boundary convention in this codebase, e.g. `WebhookRepositoryError`/`ChaosRepositoryError`). */
export class ChaosRunRepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ChaosRunRepositoryError";
    this.code = code;
  }
}

/** The entity/evidence FK selection shared by both write shapes — every field optional and nullable; never fabricated by this module. */
export interface ChaosRunEntityLinks {
  readonly orderId?: string | null;
  readonly paymentAttemptId?: string | null;
  readonly paymentId?: string | null;
  readonly sourceWebhookEventId?: string | null;
}

export interface CreatePendingChaosRunInput extends ChaosRunEntityLinks {
  readonly scenarioId: ChaosRunScenarioId;
  /** `null` for C11 (both mechanisms) — it has no fault primitive. */
  readonly faultType: ChaosRunFaultType | null;
  readonly dataClassification: ChaosRunDataClassification;
}

/**
 * Persists a `PENDING` chaos run: `outcome`/`failed_precheck_id`/
 * `error_message_redacted`/`started_at`/`completed_at` are always `NULL`,
 * `fault_config`/`fault_state` are always `{}`. This is the ONLY shape this
 * function can produce — the database's own
 * `chaos_runs_pending_state_consistent` CHECK constraint enforces the same
 * rule independently.
 */
export async function createPendingChaosRun(
  input: CreatePendingChaosRunInput,
): Promise<ChaosRunRow> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("chaos_runs")
    .insert({
      scenario_id: input.scenarioId,
      order_id: input.orderId ?? null,
      payment_attempt_id: input.paymentAttemptId ?? null,
      payment_id: input.paymentId ?? null,
      source_webhook_event_id: input.sourceWebhookEventId ?? null,
      status: "PENDING",
      outcome: null,
      fault_type: input.faultType,
      failed_precheck_id: null,
      fault_config: {},
      fault_state: {},
      data_classification: input.dataClassification,
      error_message_redacted: null,
      started_at: null,
      completed_at: null,
    })
    .select()
    .single();

  if (error || !data) {
    throw new ChaosRunRepositoryError(
      "CHAOS_RUN_PENDING_INSERT_FAILED",
      "Failed to persist a pending chaos run.",
    );
  }

  return data;
}

export interface CreateBlockedChaosRunInput extends ChaosRunEntityLinks {
  readonly scenarioId: ChaosRunScenarioId;
  readonly failedPrecheckId: PersistableChaosRunFailedPrecheckId;
  /** Safe, deterministic text only — never a raw DB error, secret, or raw request content. Becomes `error_message_redacted`. */
  readonly safeReason: string;
  readonly dataClassification: ChaosRunDataClassification;
  /** `null`/omitted whenever the fault primitive itself cannot be trusted as safe canonical metadata (this task's Section 15) — never a rejected/unknown value. */
  readonly faultType?: ChaosRunFaultType | null;
  /** Injectable for deterministic tests; defaults to the real clock. */
  readonly now?: () => Date;
}

/**
 * Persists a `COMPLETED`/`BLOCKED` chaos run: `started_at` is always
 * `NULL` (no execution ever began — architect correction), `completed_at`
 * is always set to the finalization timestamp, `failed_precheck_id` and
 * `error_message_redacted` are always both non-null, and
 * `fault_config`/`fault_state` are always `{}`. This is the ONLY shape this
 * function can produce — the database's own
 * `chaos_runs_blocked_state_consistent` CHECK constraint enforces the same
 * rule independently. This function never accepts or persists a raw
 * request object, a URL/host/IP/endpoint value, or an unrecognized fault
 * primitive — the caller must have already reduced its input to exactly
 * these typed, safe fields.
 */
export async function createBlockedChaosRun(
  input: CreateBlockedChaosRunInput,
): Promise<ChaosRunRow> {
  const client = getSupabaseServerClient();
  const now = (input.now ?? (() => new Date()))();

  const { data, error } = await client
    .from("chaos_runs")
    .insert({
      scenario_id: input.scenarioId,
      order_id: input.orderId ?? null,
      payment_attempt_id: input.paymentAttemptId ?? null,
      payment_id: input.paymentId ?? null,
      source_webhook_event_id: input.sourceWebhookEventId ?? null,
      status: "COMPLETED",
      outcome: "BLOCKED",
      fault_type: input.faultType ?? null,
      failed_precheck_id: input.failedPrecheckId,
      fault_config: {},
      fault_state: {},
      data_classification: input.dataClassification,
      error_message_redacted: input.safeReason,
      started_at: null,
      completed_at: now.toISOString(),
    })
    .select()
    .single();

  if (error || !data) {
    throw new ChaosRunRepositoryError(
      "CHAOS_RUN_BLOCKED_INSERT_FAILED",
      "Failed to persist a blocked chaos run.",
    );
  }

  return data;
}

/**
 * Read-only lookup by internal id. Returns `null` if no such row exists.
 * Throws `ChaosRunRepositoryError` on a genuine DB failure — never returns
 * `null` to mean "the database errored", so a caller cannot mistake an
 * error for a legitimate not-found result.
 */
export async function getChaosRunById(id: string): Promise<ChaosRunRow | null> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("chaos_runs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new ChaosRunRepositoryError(
      "CHAOS_RUN_LOOKUP_FAILED",
      "Failed to load chaos run.",
    );
  }

  return data;
}
