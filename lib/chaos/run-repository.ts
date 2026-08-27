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
 * Phase 3D-A — atomically transitions one eligible PENDING C03 run to the
 * execution-time BLOCKED shape frozen by Phase 3D-0
 * (`supabase/migrations/20260831000000_phase3d_execution_safety.sql`):
 * `execution_block_code = 'PRE-SEC-007'`, `failed_precheck_id = NULL`,
 * `started_at = NULL`. The single conditional `UPDATE ... WHERE ...
 * RETURNING` requires `id`/`status = PENDING`/`scenario_id = C03`/
 * `fault_type = INVALID_SIGNATURE_TEST`/`data_classification =
 * SYNTHETIC_DEMO` all match — the same atomic-conditional-UPDATE idiom as
 * every other lifecycle transition in this module. `execution_block_code`
 * is always the hardcoded literal `'PRE-SEC-007'` — never a caller-supplied
 * value. `fault_config`/`fault_state` are left untouched (whatever the
 * PENDING row already had — always `{}` per `createPendingChaosRun`).
 *
 * Returns `null` (never throws for this case) when zero rows matched — the
 * run does not exist, or is not an eligible PENDING C03 row. The caller must
 * never treat a `null` return as "blocked successfully".
 */
export async function blockPendingC03RunForPreSec007(
  id: string,
  safeReason: string,
  now: () => Date = () => new Date(),
): Promise<ChaosRunRow | null> {
  const client = getSupabaseServerClient();
  const timestamp = now().toISOString();

  const { data, error } = await client
    .from("chaos_runs")
    .update({
      status: "COMPLETED",
      outcome: "BLOCKED",
      failed_precheck_id: null,
      execution_block_code: "PRE-SEC-007",
      error_message_redacted: safeReason,
      started_at: null,
      completed_at: timestamp,
      updated_at: timestamp,
    })
    .eq("id", id)
    .eq("status", "PENDING")
    .eq("scenario_id", "C03")
    .eq("fault_type", "INVALID_SIGNATURE_TEST")
    .eq("data_classification", "SYNTHETIC_DEMO")
    .select()
    .maybeSingle();

  if (error) {
    throw new ChaosRunRepositoryError(
      "CHAOS_RUN_C03_BLOCK_FAILED",
      "Failed to persist the PRE-SEC-007 blocked chaos run.",
    );
  }

  return data;
}

/**
 * Phase 3D-A — atomically claims one eligible PENDING C03/
 * `INVALID_SIGNATURE_TEST`/`SYNTHETIC_DEMO` chaos run for execution:
 * `PENDING -> RUNNING`, exactly once. Same atomic-conditional-UPDATE idiom
 * as `startPendingC01RunAtomically` — a single conditional `UPDATE ...
 * WHERE ... RETURNING`, never a `SELECT` followed by an unconditional
 * `UPDATE`. No scenario/fault-type parameter is accepted from a caller —
 * both are fixed literals matching C03's own registry entry.
 *
 * Returns `null` (never throws for this case) when zero rows matched — the
 * run does not exist, is not `C03`, is not `INVALID_SIGNATURE_TEST`, is not
 * `SYNTHETIC_DEMO`, does not have `outcome IS NULL`, or (the expected steady
 * state under a genuine race) has already been claimed by a concurrent
 * caller and is no longer `PENDING`. The caller must never execute the C03
 * mechanism when this returns `null`.
 */
export async function startPendingC03RunAtomically(
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
    .eq("scenario_id", "C03")
    .eq("status", "PENDING")
    .eq("fault_type", "INVALID_SIGNATURE_TEST")
    .eq("data_classification", "SYNTHETIC_DEMO")
    .is("outcome", null)
    .select()
    .maybeSingle();

  if (error) {
    throw new ChaosRunRepositoryError(
      "CHAOS_RUN_C03_START_FAILED",
      "Failed to atomically start the C03 chaos run.",
    );
  }

  return data;
}

/**
 * Phase 3D-A — generic terminal helper: completes a successfully-executed
 * RUNNING run of ANY scenario: `RUNNING -> COMPLETED`/`UNKNOWN`. Accepts
 * only a server-constructed safe `fault_state` object — never arbitrary
 * caller/browser JSON, never a `status`/`outcome`/`scenario`/`fault type`/
 * `execution_block_code` override (this task's Section 8C). `status =
 * COMPLETED` means the chaos mechanism execution completed; `outcome =
 * UNKNOWN` means no deterministic Money Invariant evaluation has run yet
 * (a later phase's job) — this is NOT a merchant reliability verdict. The
 * conditional `WHERE status = 'RUNNING'` means this can only ever transition
 * a run this same execution path already atomically claimed; returns `null`
 * if that precondition does not hold.
 */
export async function completeRunningChaosRunUnknown(
  id: string,
  faultState: Record<string, unknown>,
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
      fault_state: faultState,
      error_message_redacted: null,
    })
    .eq("id", id)
    .eq("status", "RUNNING")
    .select()
    .maybeSingle();

  if (error) {
    throw new ChaosRunRepositoryError(
      "CHAOS_RUN_COMPLETE_UNKNOWN_FAILED",
      "Failed to persist chaos run completion.",
    );
  }

  return data;
}

/**
 * Phase 3D-A — generic terminal helper: records a technical execution
 * failure on a RUNNING run of ANY scenario: `RUNNING -> FAILED`/`ERROR`.
 * This is NEVER how a merchant reliability FAIL is represented (that is
 * `COMPLETED`/`FAIL`, a later deterministic invariant-evaluation outcome) —
 * `FAILED`/`ERROR` means mechanism execution itself could not complete for a
 * technical reason. Accepts only a fixed safe `safeReason` string — never a
 * raw DB/Postgres error, secret, or raw payload, and no
 * `status`/`outcome`/`scenario`/`fault type`/`execution_block_code`
 * override.
 */
export async function failRunningChaosRunExecution(
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
      "CHAOS_RUN_FAIL_EXECUTION_FAILED",
      "Failed to persist chaos run technical failure.",
    );
  }

  return data;
}

/**
 * Phase 3D-B — atomically transitions one eligible PENDING C07 run to the
 * execution-time BLOCKED shape frozen by Phase 3D-0, mirroring
 * `blockPendingC03RunForPreSec007` exactly: `execution_block_code =
 * 'PRE-SEC-007'`, `failed_precheck_id = NULL`, `started_at = NULL`. The
 * conditional `UPDATE ... WHERE ... RETURNING` requires `id`/`status =
 * PENDING`/`scenario_id = C07`/`fault_type = DROP_CLIENT_CONFIRMATION`/
 * `data_classification = RECORDED_TEST_EVIDENCE`/`order_id IS NOT NULL` all
 * match. `execution_block_code` is always the hardcoded literal
 * `'PRE-SEC-007'` — never a caller-supplied value.
 *
 * Returns `null` (never throws for this case) when zero rows matched — the
 * run does not exist, or is not an eligible PENDING C07 row. The caller must
 * never treat a `null` return as "blocked successfully".
 */
export async function blockPendingC07RunForPreSec007(
  id: string,
  safeReason: string,
  now: () => Date = () => new Date(),
): Promise<ChaosRunRow | null> {
  const client = getSupabaseServerClient();
  const timestamp = now().toISOString();

  const { data, error } = await client
    .from("chaos_runs")
    .update({
      status: "COMPLETED",
      outcome: "BLOCKED",
      failed_precheck_id: null,
      execution_block_code: "PRE-SEC-007",
      error_message_redacted: safeReason,
      started_at: null,
      completed_at: timestamp,
      updated_at: timestamp,
    })
    .eq("id", id)
    .eq("status", "PENDING")
    .eq("scenario_id", "C07")
    .eq("fault_type", "DROP_CLIENT_CONFIRMATION")
    .eq("data_classification", "RECORDED_TEST_EVIDENCE")
    .not("order_id", "is", null)
    .select()
    .maybeSingle();

  if (error) {
    throw new ChaosRunRepositoryError(
      "CHAOS_RUN_C07_BLOCK_FAILED",
      "Failed to persist the PRE-SEC-007 blocked chaos run.",
    );
  }

  return data;
}

/** The fixed, server-owned C07 fault_state shape at the moment of arming — no additional keys, never caller-supplied. */
export const C07_ARMED_FAULT_STATE = {
  armed: true,
  consumed: false,
} as const;

export type StartPendingC07RunResult =
  | { readonly kind: "STARTED"; readonly run: ChaosRunRow }
  | { readonly kind: "NOT_ELIGIBLE" }
  | { readonly kind: "ALREADY_ARMED_FOR_ORDER" };

/**
 * Phase 3D-B — the ONE atomic arm-and-claim statement (this task's Section
 * 8 "Atomic Arm"). A single conditional `UPDATE ... WHERE ... RETURNING`
 * simultaneously transitions `PENDING -> RUNNING`, sets `started_at =
 * now()`, and sets `fault_state = {armed: true, consumed: false}` — there
 * is no intermediate "PENDING + armed" state. The `WHERE` clause hardcodes
 * every eligibility fact (`scenario_id = C07`, `fault_type =
 * DROP_CLIENT_CONFIRMATION`, `data_classification = RECORDED_TEST_EVIDENCE`,
 * `status = PENDING`, `order_id IS NOT NULL`) — no scenario/fault
 * type/status/fault_state/order id is ever accepted as a caller-controlled
 * parameter.
 *
 * The Phase 3D-0 partial unique index
 * (`chaos_runs_one_active_c07_fault_per_order_idx`) is the authoritative
 * race-safety boundary for "at most one RUNNING C07 fault per order" — this
 * function detects a violation of specifically that index (Postgres
 * `23505`) and reports it as `ALREADY_ARMED_FOR_ORDER`, rather than
 * replacing the database guarantee with an application-only existence
 * check. Any other unique-constraint violation on this table would be a
 * genuine anomaly, not an expected outcome, and is thrown as a generic
 * repository error instead of being silently reinterpreted.
 *
 * Returns `NOT_ELIGIBLE` (zero rows matched, no error) when the run does
 * not exist, is not an eligible PENDING C07 row, or has already been
 * claimed by a concurrent caller.
 */
export async function startPendingC07RunAtomically(
  id: string,
  now: () => Date = () => new Date(),
): Promise<StartPendingC07RunResult> {
  const client = getSupabaseServerClient();
  const timestamp = now().toISOString();

  const { data, error } = await client
    .from("chaos_runs")
    .update({
      status: "RUNNING",
      started_at: timestamp,
      updated_at: timestamp,
      fault_state: C07_ARMED_FAULT_STATE,
    })
    .eq("id", id)
    .eq("scenario_id", "C07")
    .eq("fault_type", "DROP_CLIENT_CONFIRMATION")
    .eq("data_classification", "RECORDED_TEST_EVIDENCE")
    .eq("status", "PENDING")
    .not("order_id", "is", null)
    .select()
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return { kind: "ALREADY_ARMED_FOR_ORDER" };
    }
    throw new ChaosRunRepositoryError(
      "CHAOS_RUN_C07_START_FAILED",
      "Failed to atomically arm the C07 chaos run.",
    );
  }

  if (!data) {
    return { kind: "NOT_ELIGIBLE" };
  }

  return { kind: "STARTED", run: data };
}

/**
 * Phase 3D-B (correction round — Blocker 3/14 "exact JSON state") — the one
 * atomic `consumed: false -> true` mutation (this task's Section 14
 * "Consume Semantics + Race Safety"). Scoped via EXACT JSONB equality
 * (`.filter("fault_state", "eq", JSON.stringify({armed:true, consumed:false}))`
 * — a raw object passed to postgrest-js's `.eq()` is not serialized as
 * JSON, and `.eq()`'s TS typing also rejects a string value for this
 * `Record<string, unknown>`-typed column, so the JSON text is supplied via
 * `.filter()`, postgrest-js's documented raw-syntax escape hatch) — not
 * containment — combined with `id`/`scenario_id = C07`/`fault_type =
 * DROP_CLIENT_CONFIRMATION`/`data_classification = RECORDED_TEST_EVIDENCE`/
 * `status = RUNNING`. A row whose `fault_state` carries any extra key or a
 * non-boolean `consumed` can never satisfy this exact match, so a malformed
 * state can never be mutated by this function — a single conditional
 * `UPDATE`, never a `SELECT` followed by an unconditional `UPDATE`. Two
 * concurrent duplicate client confirmations racing this same call can only
 * ever produce ONE successful `false -> true` transition; the loser
 * receives `null` and must re-read the active fault
 * (`resolveActiveArmedC07FaultForOrder`) to decide whether it is still
 * suppressed.
 *
 * Returns `null` (never throws for this case) when zero rows matched —
 * already consumed, not RUNNING, not exactly armed-and-unconsumed, wrong
 * classification, or the run does not exist.
 */
export async function consumeC07ClientConfirmationDrop(
  chaosRunId: string,
  now: () => Date = () => new Date(),
): Promise<ChaosRunRow | null> {
  const client = getSupabaseServerClient();
  const timestamp = now().toISOString();

  const { data, error } = await client
    .from("chaos_runs")
    .update({
      fault_state: { armed: true, consumed: true },
      updated_at: timestamp,
    })
    .eq("id", chaosRunId)
    .eq("scenario_id", "C07")
    .eq("fault_type", "DROP_CLIENT_CONFIRMATION")
    .eq("data_classification", "RECORDED_TEST_EVIDENCE")
    .eq("status", "RUNNING")
    // `.eq()` types its value against the column's `Record<string, unknown>`
    // TS type, but postgrest-js does not JSON-serialize non-primitive
    // filter values — it would send the literal "[object Object]" and the
    // database would reject it (22P02). `.filter(column, "eq", value)` is
    // postgrest-js's documented raw-PostgREST-syntax escape hatch for
    // exactly this case; its runtime behavior is otherwise identical to
    // `.eq()`.
    .filter(
      "fault_state",
      "eq",
      JSON.stringify({ armed: true, consumed: false }),
    )
    .select()
    .maybeSingle();

  if (error) {
    throw new ChaosRunRepositoryError(
      "CHAOS_RUN_C07_CONSUME_FAILED",
      "Failed to persist the C07 client-confirmation consumption.",
    );
  }

  return data;
}

/** The authoritative evidence FK selection a C07 reconciliation completion may populate — never fabricated, only ever the resolved result of `resolveC07ConvergenceEvidence`. */
export interface C07ConvergenceEvidenceLinks {
  readonly paymentAttemptId: string;
  readonly paymentId: string;
  readonly sourceWebhookEventId: string;
}

/**
 * Phase 3D-B (correction round — Blocker 3/14 "exact JSON state") —
 * atomically transitions a RUNNING + exactly-armed-and-consumed C07 run to
 * `COMPLETED`/`UNKNOWN` once authoritative convergence has been proven
 * (this task's Section 17). Requires `id`/`order_id = expectedOrderId`
 * (defense-in-depth scoping to the trusted expected order)/`scenario_id =
 * C07`/`fault_type = DROP_CLIENT_CONFIRMATION`/`data_classification =
 * RECORDED_TEST_EVIDENCE`/`status = RUNNING` and EXACT JSONB equality
 * (`.filter("fault_state", "eq", JSON.stringify({armed:true, consumed:true}))`)
 * — not containment — so a malformed persisted state (extra key, wrong
 * type) can never satisfy this mutation. The `consumed = true` gate is mandatory (prevents a
 * webhook that arrives very quickly from completing the run before
 * PayChaos has actually observed and suppressed the client confirmation).
 * Populates the resolved evidence FK columns; `fault_state` is re-asserted
 * unchanged. Never decides invariant PASS/FAIL — `outcome = UNKNOWN` is
 * deliberate.
 *
 * Returns `null` (never throws for this case) when zero rows matched. The
 * caller (`lib/chaos/c07-execution-service.ts`) independently re-validates
 * the exact returned row shape before ever reporting `COMPLETED` —
 * verified persisted state is authoritative, not merely a non-null return.
 */
export async function completeRunningC07RunWithEvidence(
  chaosRunId: string,
  expectedOrderId: string,
  evidence: C07ConvergenceEvidenceLinks,
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
      fault_state: { armed: true, consumed: true },
      payment_attempt_id: evidence.paymentAttemptId,
      payment_id: evidence.paymentId,
      source_webhook_event_id: evidence.sourceWebhookEventId,
      error_message_redacted: null,
    })
    .eq("id", chaosRunId)
    .eq("order_id", expectedOrderId)
    .eq("scenario_id", "C07")
    .eq("fault_type", "DROP_CLIENT_CONFIRMATION")
    .eq("data_classification", "RECORDED_TEST_EVIDENCE")
    .eq("status", "RUNNING")
    // See consumeC07ClientConfirmationDrop's comment above `.filter(...)` —
    // same postgrest-js raw-syntax escape hatch, same reason.
    .filter(
      "fault_state",
      "eq",
      JSON.stringify({ armed: true, consumed: true }),
    )
    .select()
    .maybeSingle();

  if (error) {
    throw new ChaosRunRepositoryError(
      "CHAOS_RUN_C07_COMPLETE_FAILED",
      "Failed to persist C07 reconciliation completion.",
    );
  }

  return data;
}

/**
 * Phase 3D-B (final correction round — Blocker A) — explicit,
 * operator-initiated-only cancellation of a RUNNING C07 fault (this task's
 * Section 19). Requires `id`/`order_id = expectedOrderId` (defense-in-depth
 * scoping to the trusted expected order)/`scenario_id = C07`/`fault_type =
 * DROP_CLIENT_CONFIRMATION`/`data_classification = RECORDED_TEST_EVIDENCE`/
 * `status = RUNNING`; transitions to `FAILED`/`ERROR`. Preserves the
 * server-owned `fault_state` untouched — this function never rewrites it.
 *
 * `expectedConsumed` is the caller's server-validated, already-resolved
 * pre-cancel `consumed` value (never an arbitrary caller-supplied JSON
 * object) — this function itself constructs the exact expected shape
 * `{armed: true, consumed: expectedConsumed}` and requires the persisted
 * `fault_state` to match it EXACTLY (via `.filter(column, "eq", ...)`, never
 * `.contains()`) as part of the SAME atomic conditional `UPDATE` that
 * transitions status/outcome. This closes the race the prior round's
 * read-then-validate approach left open: if a genuine Checkout confirmation
 * consumes the fault (`false -> true`) between this function's caller
 * reading the pre-cancel state and this UPDATE executing, the exact-state
 * predicate no longer matches the (now stale) `expectedConsumed`, so this
 * UPDATE matches zero rows and never terminalizes the run underneath the
 * winning consume — it is impossible for this function to both change
 * `fault_state`'s owning meaning-in-effect and report success against a
 * value that was never the row's true value at mutation time.
 *
 * After cancellation, the `verifyCheckoutAction` suppression lookup
 * (`resolveActiveArmedC07FaultForOrder`) no longer matches this run (its
 * `status` is no longer `RUNNING`), which is how the scoped client-drop
 * fault clears, and the Phase 3D-0 one-active-fault index slot for this
 * order is released.
 *
 * This is a NARROW, C07-specific cancel — not a generic cross-scenario
 * cancel function.
 *
 * Returns `null` (never throws for this case) when zero rows matched — the
 * run does not exist, is not currently a RUNNING C07 fault, does not belong
 * to `expectedOrderId`, or its persisted `fault_state` no longer exactly
 * matches `expectedConsumed` (a concurrent consume raced in first). The
 * caller (`lib/chaos/c07-execution-service.ts`) independently re-validates
 * the exact returned row shape before ever reporting `CANCELLED`.
 */
export async function cancelRunningC07Fault(
  chaosRunId: string,
  expectedOrderId: string,
  expectedConsumed: boolean,
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
    .eq("id", chaosRunId)
    .eq("order_id", expectedOrderId)
    .eq("scenario_id", "C07")
    .eq("fault_type", "DROP_CLIENT_CONFIRMATION")
    .eq("data_classification", "RECORDED_TEST_EVIDENCE")
    .eq("status", "RUNNING")
    // Atomic exact-state predicate (Blocker A) — the server constructs this
    // value itself from a validated boolean, never from caller-supplied
    // JSON. Same postgrest-js raw-syntax escape hatch as the consume/
    // complete mutations above, for the same reason (.eq() does not
    // serialize a non-primitive value).
    .filter(
      "fault_state",
      "eq",
      JSON.stringify({ armed: true, consumed: expectedConsumed }),
    )
    .select()
    .maybeSingle();

  if (error) {
    throw new ChaosRunRepositoryError(
      "CHAOS_RUN_C07_CANCEL_FAILED",
      "Failed to cancel the C07 chaos run.",
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
