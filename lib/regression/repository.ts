import "server-only";

import { isUuid } from "@/lib/findings/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

import { ACTIVE_REGRESSION_STATUSES } from "@/lib/regression/types";
import type {
  RegressionRepositoryErrorCode,
  RegressionRun,
  RegressionTransitionResult,
} from "@/lib/regression/types";
import type { Database } from "@/lib/supabase/types";

/** The generated update shape, so a payload can never name a stray column. */
type RegressionUpdate =
  Database["public"]["Tables"]["regression_runs"]["Update"];

/**
 * Phase 4E-R1 — durable persistence for `public.regression_runs`, and nothing
 * else.
 *
 * SCOPE. Every statement in this module targets `regression_runs`. It writes
 * no chaos run, no order, no payment attempt, no payment, no fulfilment, no
 * webhook event, no processing attempt, no invariant result and NO FINDING.
 * The Finding lifecycle belongs to Phase 4E-R2, and the original failed
 * invariant result is immutable historical evidence that nothing here may
 * touch (docs/DATABASE.md REG-004).
 *
 * NO GENERIC STATUS SETTER. There is deliberately no
 * `setRegressionStatus(id, status)`. Each legal transition is its own
 * function with its own guard, so an illegal move — resolving something that
 * never ran, overwriting a terminal verdict — is impossible to express rather
 * than merely discouraged.
 *
 * GUARDED, IDEMPOTENT TRANSITIONS. Every write is one conditional UPDATE that
 * matches on the id AND the expected current status. If it matches no row,
 * the module re-reads ONCE and classifies what actually happened: the row
 * already holds the target status (return `ALREADY`, zero writes, timestamps
 * preserved verbatim), or it holds something incompatible (a typed state
 * conflict). There is no retry loop anywhere.
 *
 * SAFE ERRORS. A PostgREST `message`, `details`, `hint` or query string never
 * escapes this module. Callers receive a stable code and safe wording.
 */

// ============================================================================
// ERROR MODEL
// ============================================================================

/**
 * The one error type this module raises. It carries a stable code from the
 * frozen vocabulary and safe operator-facing wording — never a PostgREST
 * message, detail, hint or query string.
 */
export class RegressionRepositoryError extends Error {
  readonly code: RegressionRepositoryErrorCode;

  constructor(code: RegressionRepositoryErrorCode, message: string) {
    super(message);
    this.name = "RegressionRepositoryError";
    this.code = code;
  }
}

// ============================================================================
// PROJECTION
// ============================================================================

/** Explicit allowlist projection. Never `select("*")`. */
const REGRESSION_COLUMNS =
  "id, finding_id, chaos_run_id, status, started_at, completed_at, created_at";

/** PostgreSQL's unique-violation SQLSTATE, used to recognise the race. */
const UNIQUE_VIOLATION = "23505";

/** The partial unique index that bounds concurrent starts. */
const ACTIVE_INDEX_NAME = "regression_runs_active_finding_uniq";

interface RegressionRow {
  readonly id: string;
  readonly finding_id: string;
  readonly chaos_run_id: string;
  readonly status: RegressionRun["status"];
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly created_at: string;
}

function toRun(row: RegressionRow): RegressionRun {
  return {
    id: row.id,
    findingId: row.finding_id,
    chaosRunId: row.chaos_run_id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

// ============================================================================
// READS
// ============================================================================

/** One regression by id, or `null` when it genuinely does not exist. */
export async function findRegressionRunById(
  regressionRunId: string,
): Promise<RegressionRun | null> {
  if (!isUuid(regressionRunId)) {
    throw new RegressionRepositoryError(
      "REGRESSION_RUN_ID_INVALID",
      "The regression identifier is not an internal UUID.",
    );
  }

  const { data, error } = await getSupabaseServerClient()
    .from("regression_runs")
    .select(REGRESSION_COLUMNS)
    .eq("id", regressionRunId)
    .maybeSingle();

  if (error !== null) {
    throw new RegressionRepositoryError(
      "REGRESSION_READ_FAILED",
      "The regression record could not be read.",
    );
  }
  return data === null ? null : toRun(data as unknown as RegressionRow);
}

/**
 * Every regression ever recorded for one Finding, newest first.
 *
 * Ordered by `created_at` descending with `id` as a deterministic tiebreak, so
 * two rows created in the same clock tick still come back in a stable order.
 */
export async function listRegressionRunsForFinding(
  findingId: string,
): Promise<readonly RegressionRun[]> {
  if (!isUuid(findingId)) {
    throw new RegressionRepositoryError(
      "REGRESSION_FINDING_ID_INVALID",
      "The finding identifier is not an internal UUID.",
    );
  }

  const { data, error } = await getSupabaseServerClient()
    .from("regression_runs")
    .select(REGRESSION_COLUMNS)
    .eq("finding_id", findingId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error !== null) {
    throw new RegressionRepositoryError(
      "REGRESSION_READ_FAILED",
      "The regression history could not be read.",
    );
  }
  return ((data ?? []) as unknown as RegressionRow[]).map(toRun);
}

/**
 * The one active (`PENDING`/`RUNNING`) regression for a Finding, or `null`.
 *
 * The database's partial unique index guarantees at most one. If more than one
 * ever comes back, that invariant has been violated and this reports an
 * integrity conflict rather than silently picking a winner.
 */
export async function findActiveRegressionForFinding(
  findingId: string,
): Promise<RegressionRun | null> {
  if (!isUuid(findingId)) {
    throw new RegressionRepositoryError(
      "REGRESSION_FINDING_ID_INVALID",
      "The finding identifier is not an internal UUID.",
    );
  }

  const { data, error } = await getSupabaseServerClient()
    .from("regression_runs")
    .select(REGRESSION_COLUMNS)
    .eq("finding_id", findingId)
    .in("status", [...ACTIVE_REGRESSION_STATUSES]);

  if (error !== null) {
    throw new RegressionRepositoryError(
      "REGRESSION_READ_FAILED",
      "The active regression could not be read.",
    );
  }

  const rows = (data ?? []) as unknown as RegressionRow[];
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    throw new RegressionRepositoryError(
      "REGRESSION_INTEGRITY_CONFLICT",
      "More than one active regression exists for this finding.",
    );
  }
  return toRun(rows[0]!);
}

// ============================================================================
// INSERT
// ============================================================================

export interface InsertRegressionRunInput {
  readonly findingId: string;
  readonly chaosRunId: string;
}

/**
 * Records a new `PENDING` regression for a Finding against its NEW chaos run.
 *
 * The payload carries EXACTLY two columns. `id`, `status` and `created_at` are
 * left to their database defaults, and `started_at`/`completed_at` to NULL —
 * no caller supplies a creation timestamp, so a row's recorded creation time
 * is always the database's own.
 *
 * A partial-unique violation means a concurrent caller already has an active
 * regression for this Finding. That surfaces as a stable
 * `REGRESSION_ACTIVE_RUN_CONFLICT`, never as a raw constraint message.
 */
export async function insertPendingRegressionRun(
  input: InsertRegressionRunInput,
): Promise<RegressionRun> {
  if (!isUuid(input.findingId)) {
    throw new RegressionRepositoryError(
      "REGRESSION_FINDING_ID_INVALID",
      "The finding identifier is not an internal UUID.",
    );
  }
  if (!isUuid(input.chaosRunId)) {
    throw new RegressionRepositoryError(
      "REGRESSION_CHAOS_RUN_ID_INVALID",
      "The chaos run identifier is not an internal UUID.",
    );
  }

  const { data, error } = await getSupabaseServerClient()
    .from("regression_runs")
    .insert({
      finding_id: input.findingId,
      chaos_run_id: input.chaosRunId,
    })
    .select(REGRESSION_COLUMNS)
    .maybeSingle();

  if (error !== null) {
    if (isActiveRegressionViolation(error)) {
      throw new RegressionRepositoryError(
        "REGRESSION_ACTIVE_RUN_CONFLICT",
        "An active regression already exists for this finding.",
      );
    }
    throw new RegressionRepositoryError(
      "REGRESSION_INSERT_FAILED",
      "The regression record could not be created.",
    );
  }
  if (data === null) {
    throw new RegressionRepositoryError(
      "REGRESSION_INSERT_FAILED",
      "The regression record was not returned after creation.",
    );
  }
  return toRun(data as unknown as RegressionRow);
}

/**
 * Recognises the active-regression partial unique index specifically.
 *
 * A `chaos_run_id` unique violation is a different fault — that run is already
 * claimed by another regression — and must not be reported as an active-run
 * conflict. Only the `code` and the index NAME are inspected; no PostgREST
 * message text is ever propagated to a caller.
 */
function isActiveRegressionViolation(error: {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly details?: string | null;
}): boolean {
  if (error.code !== UNIQUE_VIOLATION) return false;
  const haystack = `${error.message ?? ""} ${error.details ?? ""}`;
  return haystack.includes(ACTIVE_INDEX_NAME);
}

// ============================================================================
// GUARDED TRANSITIONS
// ============================================================================

interface TransitionSpec {
  readonly regressionRunId: string;
  /** The statuses the row may currently hold for this move to be legal. */
  readonly from: readonly RegressionRun["status"][];
  readonly to: RegressionRun["status"];
  readonly payload: RegressionUpdate;
  readonly conflictMessage: string;
}

/**
 * One conditional UPDATE, then at most ONE re-read.
 *
 * The update matches on the id AND `status IN (from)`. Matching no row means
 * either the row already reached `to` (idempotent success, zero writes) or it
 * holds an incompatible status (typed conflict). There is no retry.
 */
async function transition(
  spec: TransitionSpec,
): Promise<RegressionTransitionResult> {
  if (!isUuid(spec.regressionRunId)) {
    throw new RegressionRepositoryError(
      "REGRESSION_RUN_ID_INVALID",
      "The regression identifier is not an internal UUID.",
    );
  }

  const { data, error } = await getSupabaseServerClient()
    .from("regression_runs")
    .update(spec.payload)
    .eq("id", spec.regressionRunId)
    .in("status", [...spec.from])
    .select(REGRESSION_COLUMNS)
    .maybeSingle();

  if (error !== null) {
    throw new RegressionRepositoryError(
      "REGRESSION_UPDATE_FAILED",
      "The regression state could not be updated.",
    );
  }

  if (data !== null) {
    return {
      kind: "TRANSITIONED",
      run: toRun(data as unknown as RegressionRow),
    };
  }

  // The guard matched nothing. Establish why, exactly once.
  const current = await findRegressionRunById(spec.regressionRunId);
  if (current === null) {
    throw new RegressionRepositoryError(
      "REGRESSION_STATE_CONFLICT",
      "No regression exists with that identifier.",
    );
  }
  if (current.status === spec.to) {
    // Already there. Zero writes, and every existing timestamp preserved.
    return { kind: "ALREADY", run: current };
  }
  throw new RegressionRepositoryError(
    "REGRESSION_STATE_CONFLICT",
    spec.conflictMessage,
  );
}

/**
 * `PENDING -> RUNNING`, recording when execution was claimed.
 *
 * `completed_at` is untouched and stays NULL. A regression that is already
 * `RUNNING` returns `ALREADY` with its original `started_at` intact — a retry
 * never rewrites when execution began.
 */
export async function startPendingRegressionRun(input: {
  readonly regressionRunId: string;
  readonly startedAt: string;
}): Promise<RegressionTransitionResult> {
  return transition({
    regressionRunId: input.regressionRunId,
    from: ["PENDING"],
    to: "RUNNING",
    payload: { status: "RUNNING", started_at: input.startedAt },
    conflictMessage:
      "This regression has already reached a terminal status and cannot be started.",
  });
}

/**
 * `RUNNING -> RESOLVED`. Only a regression that actually executed may claim a
 * verdict, so `PENDING -> RESOLVED` is rejected.
 *
 * `started_at` is preserved; a repeat returns the ORIGINAL `completed_at`.
 */
export async function finalizeRegressionResolved(input: {
  readonly regressionRunId: string;
  readonly completedAt: string;
}): Promise<RegressionTransitionResult> {
  return transition({
    regressionRunId: input.regressionRunId,
    from: ["RUNNING"],
    to: "RESOLVED",
    payload: { status: "RESOLVED", completed_at: input.completedAt },
    conflictMessage:
      "This regression is not running, or already holds a different terminal status.",
  });
}

/** `RUNNING -> STILL_FAILING`. Same guard and idempotency as resolution. */
export async function finalizeRegressionStillFailing(input: {
  readonly regressionRunId: string;
  readonly completedAt: string;
}): Promise<RegressionTransitionResult> {
  return transition({
    regressionRunId: input.regressionRunId,
    from: ["RUNNING"],
    to: "STILL_FAILING",
    payload: { status: "STILL_FAILING", completed_at: input.completedAt },
    conflictMessage:
      "This regression is not running, or already holds a different terminal status.",
  });
}

/**
 * `PENDING -> ERROR` or `RUNNING -> ERROR`.
 *
 * `PENDING` is deliberately allowed: a safety-gated chaos run can come back
 * BLOCKED before the regression ever claims execution, and that attempt must
 * still be closed honestly. Its `started_at` correctly stays NULL, because
 * nothing ever started. From `RUNNING`, `started_at` is preserved.
 *
 * A conclusive verdict is never overwritten — `RESOLVED` and `STILL_FAILING`
 * both conflict.
 */
export async function finalizeRegressionError(input: {
  readonly regressionRunId: string;
  readonly completedAt: string;
}): Promise<RegressionTransitionResult> {
  return transition({
    regressionRunId: input.regressionRunId,
    from: ["PENDING", "RUNNING"],
    to: "ERROR",
    payload: { status: "ERROR", completed_at: input.completedAt },
    conflictMessage:
      "This regression already holds a conclusive verdict, which is never overwritten.",
  });
}
