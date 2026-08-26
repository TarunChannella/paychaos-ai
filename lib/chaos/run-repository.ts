/**
 * Phase 3B — server-only, durable `chaos_runs` persistence
 * (docs/DATABASE.md Section 15, this task's Section 10).
 *
 * This module performs exactly two write shapes and one read — nothing
 * else. It never replays a webhook, injects a fault, calls Razorpay, or
 * mutates `orders`/`payment_attempts`/`payments`/`fulfilments` in any way.
 *
 * Phase 3B's exported surface was deliberately exactly three functions
 * (`createPendingChaosRun`/`createBlockedChaosRun`/`getChaosRunById`) — no
 * lifecycle-transition function existed yet, since no phase executed a
 * mechanism yet. Phase 3C is that phase for C01: it adds exactly the three
 * narrow lifecycle transitions C01's controlled replay actually needs —
 * `startPendingC01RunAtomically`, `completeRunningC01RunUnknown`,
 * `failRunningC01RunExecution` — each a single atomic conditional UPDATE
 * (never a SELECT-then-UPDATE race), each scoped narrowly to the exact
 * status transition it names. This is an ADDITIVE change: the three frozen
 * Phase 3B functions above are byte-for-byte unchanged.
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
 * Phase 3C — atomically claims one PENDING C01/`REPLAY_EVENT` chaos run for
 * execution: `PENDING -> RUNNING`, exactly once (this task's Section 8A
 * "atomic start"). A single conditional `UPDATE ... WHERE ... RETURNING`
 * (never a `SELECT` followed by an unconditional `UPDATE`, which would race
 * under two concurrent callers) — the same atomic-conditional-UPDATE idiom
 * already established in this codebase by
 * `lib/webhooks/event-processing-repository.ts`'s
 * `markEventProcessingAttemptFailedIfNotFinal`.
 *
 * Returns `null` (never throws for this case) when zero rows matched the
 * WHERE clause — the run does not exist, is not `C01`, is not
 * `REPLAY_EVENT`, does not have `outcome IS NULL`, or (the expected steady
 * state under a genuine race) has already been claimed by a concurrent
 * caller and is no longer `PENDING`. The caller must never execute a
 * replay when this returns `null`.
 */
export async function startPendingC01RunAtomically(
  id: string,
  now: () => Date = () => new Date(),
): Promise<ChaosRunRow | null> {
  const client = getSupabaseServerClient();
  const timestamp = now().toISOString();

  const { data, error } = await client
    .from("chaos_runs")
    .update({
      status: "RUNNING",
      started_at: timestamp,
      updated_at: timestamp,
    })
    .eq("id", id)
    .eq("scenario_id", "C01")
    .eq("status", "PENDING")
    .eq("fault_type", "REPLAY_EVENT")
    .is("outcome", null)
    .select()
    .maybeSingle();

  if (error) {
    throw new ChaosRunRepositoryError(
      "CHAOS_RUN_START_FAILED",
      "Failed to atomically start the chaos run.",
    );
  }

  return data;
}

/**
 * Phase 3C — completes a successfully-replayed RUNNING run (this task's
 * Section 8B "successful completion"): `RUNNING -> COMPLETED`/`UNKNOWN`.
 * `status = COMPLETED` means the chaos mechanism execution completed;
 * `outcome = UNKNOWN` means no deterministic Money Invariant evaluation has
 * run yet (Phase 3F's job) — this is NOT a merchant reliability verdict.
 * The conditional `WHERE status = 'RUNNING'` means this can only ever
 * transition a run this same execution path already atomically claimed;
 * returns `null` if that precondition somehow does not hold (should not
 * happen in the normal flow — the caller treats it as a technical
 * anomaly).
 */
export async function completeRunningC01RunUnknown(
  id: string,
  now: () => Date = () => new Date(),
): Promise<ChaosRunRow | null> {
  const client = getSupabaseServerClient();
  const timestamp = now().toISOString();

  const { data, error } = await client
    .from("chaos_runs")
    .update({
      status: "COMPLETED",
      outcome: "UNKNOWN",
      completed_at: timestamp,
      updated_at: timestamp,
      error_message_redacted: null,
    })
    .eq("id", id)
    .eq("status", "RUNNING")
    .select()
    .maybeSingle();

  if (error) {
    throw new ChaosRunRepositoryError(
      "CHAOS_RUN_COMPLETE_FAILED",
      "Failed to persist chaos run completion.",
    );
  }

  return data;
}

/**
 * Phase 3C — records a technical execution failure on a RUNNING run (this
 * task's Section 8C "technical execution failure"): `RUNNING ->
 * FAILED`/`ERROR`. This is NEVER how a merchant reliability FAIL is
 * represented (that is `COMPLETED`/`FAIL`, a later Phase 3F deterministic
 * invariant-evaluation outcome) — `FAILED`/`ERROR` means the replay
 * execution itself could not complete for a technical reason before the
 * intended scenario finished. `safeReason` must already be a fixed, safe,
 * redacted string — this function never accepts or persists a raw
 * Postgres/Supabase error, a stack trace, a secret, or a raw payload.
 */
export async function failRunningC01RunExecution(
  id: string,
  safeReason: string,
  now: () => Date = () => new Date(),
): Promise<ChaosRunRow | null> {
  const client = getSupabaseServerClient();
  const timestamp = now().toISOString();

  const { data, error } = await client
    .from("chaos_runs")
    .update({
      status: "FAILED",
      outcome: "ERROR",
      completed_at: timestamp,
      updated_at: timestamp,
      error_message_redacted: safeReason,
    })
    .eq("id", id)
    .eq("status", "RUNNING")
    .select()
    .maybeSingle();

  if (error) {
    throw new ChaosRunRepositoryError(
      "CHAOS_RUN_FAIL_FAILED",
      "Failed to persist chaos run technical failure.",
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
