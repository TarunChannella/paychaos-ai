import "server-only";

import { isUuid } from "@/lib/findings/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

import type {
  FindingLifecycleErrorCode,
  FindingLifecycleResult,
} from "@/lib/regression/types";
import type { Database, FindingStatus } from "@/lib/supabase/types";

/**
 * Phase 4E-R2 — the ONLY writer of a Finding's regression lifecycle.
 *
 * A new file rather than an addition to the frozen Phase 3G
 * `lib/findings/repository.ts`, which is insert-only by design and whose
 * static guard fails the build if an `.update(` ever appears against
 * `findings` there. Keeping the lifecycle writer separate leaves that
 * guarantee intact and makes this module's narrow write scope provable on
 * its own.
 *
 * WRITE SCOPE. Exactly three columns, ever:
 *
 *   status
 *   resolved_at
 *   updated_at
 *
 * It never writes `id`, `invariant_result_id`, `title`, `diagnosis_code`,
 * `diagnosis_strength`, `diagnosis_summary`, `recommendation_code`,
 * `recommendation_text`, `diagnosed_at` or `created_at`. The original
 * diagnosis and recommendation are historical evidence about the original
 * failure, and a later re-test never rewrites them.
 *
 * NO GENERIC `updateFinding`. Each approved transition is its own function
 * with its own guard, so an unapproved move cannot be expressed.
 *
 * THE DATABASE CHECK STILL RULES. `findings_resolved_at_consistent` (Phase
 * 3G) enforces `resolved_at IS NOT NULL` if and only if `status = 'RESOLVED'`.
 * Every payload below satisfies it in the same statement, so a resolution
 * timestamp can never survive a reopening and a RESOLVED Finding can never
 * lack one.
 *
 * GUARDED AND IDEMPOTENT. One conditional UPDATE matching the id, the expected
 * current status AND the caller's `expectedUpdatedAt`; if it matches no row,
 * ONE re-read decides whether the Finding already holds the target state
 * (zero-write `ALREADY`) or holds something incompatible (typed conflict). No
 * retry loop, and no PostgREST message, detail, hint or query text ever
 * escapes.
 *
 * WHY `expectedUpdatedAt` (compare-and-set). The regression active-boundary
 * releases the moment a regression terminalizes, so a NEWER regression can
 * start, finish, and move the Finding while an older attempt is still
 * retrying its own lifecycle write. A status guard alone cannot see that: the
 * older attempt could legitimately match `OPEN` again. Matching the exact
 * `updated_at` the caller observed makes the write fail closed whenever
 * anything has changed the Finding since, so a stale verdict can never
 * silently overwrite a newer one.
 */

const FINDING_COLUMNS = "id, status, resolved_at, updated_at";

type FindingUpdate = Database["public"]["Tables"]["findings"]["Update"];

interface FindingLifecycleRow {
  readonly id: string;
  readonly status: FindingStatus;
  readonly resolved_at: string | null;
  readonly updated_at: string;
}

export class FindingLifecycleError extends Error {
  readonly code: FindingLifecycleErrorCode;

  constructor(code: FindingLifecycleErrorCode, message: string) {
    super(message);
    this.name = "FindingLifecycleError";
    this.code = code;
  }
}

function toResult(
  kind: FindingLifecycleResult["kind"],
  row: FindingLifecycleRow,
): FindingLifecycleResult {
  return {
    kind,
    findingId: row.id,
    status: row.status,
    resolvedAt: row.resolved_at,
    updatedAt: row.updated_at,
  };
}

/** Reads the three lifecycle columns, or `null` when the Finding is absent. */
export async function readFindingLifecycle(
  findingId: string,
): Promise<FindingLifecycleResult | null> {
  if (!isUuid(findingId)) {
    throw new FindingLifecycleError(
      "FINDING_LIFECYCLE_ID_INVALID",
      "The finding identifier is not an internal UUID.",
    );
  }

  const { data, error } = await getSupabaseServerClient()
    .from("findings")
    .select(FINDING_COLUMNS)
    .eq("id", findingId)
    .maybeSingle();

  if (error !== null) {
    throw new FindingLifecycleError(
      "FINDING_LIFECYCLE_READ_FAILED",
      "The finding lifecycle state could not be read.",
    );
  }
  return data === null
    ? null
    : toResult("NO_CHANGE", data as unknown as FindingLifecycleRow);
}

interface TransitionSpec {
  readonly findingId: string;
  /** The statuses this move may legally start from. */
  readonly from: readonly FindingStatus[];
  readonly to: FindingStatus;
  /**
   * The exact `updated_at` the caller observed. The write applies only while
   * the Finding still holds it, so a concurrent lifecycle write always wins
   * over a stale one.
   */
  readonly expectedUpdatedAt: string;
  readonly payload: FindingUpdate;
  /**
   * Decides whether a row that did not match the guard is ALREADY in the
   * target state. Status alone is not always enough — a re-resolution must
   * preserve the ORIGINAL `resolved_at` rather than treat any RESOLVED row as
   * equivalent only after checking it is genuinely resolved.
   */
  readonly isAlready: (row: FindingLifecycleRow) => boolean;
  readonly conflictMessage: string;
}

async function transition(
  spec: TransitionSpec,
): Promise<FindingLifecycleResult> {
  if (!isUuid(spec.findingId)) {
    throw new FindingLifecycleError(
      "FINDING_LIFECYCLE_ID_INVALID",
      "The finding identifier is not an internal UUID.",
    );
  }

  const { data, error } = await getSupabaseServerClient()
    .from("findings")
    .update(spec.payload)
    .eq("id", spec.findingId)
    .eq("updated_at", spec.expectedUpdatedAt)
    .in("status", [...spec.from])
    .select(FINDING_COLUMNS)
    .maybeSingle();

  if (error !== null) {
    throw new FindingLifecycleError(
      "FINDING_LIFECYCLE_UPDATE_FAILED",
      "The finding lifecycle state could not be updated.",
    );
  }

  if (data !== null) {
    return toResult("UPDATED", data as unknown as FindingLifecycleRow);
  }

  // The guard matched nothing. Establish why, exactly once.
  const current = await readFindingLifecycle(spec.findingId);
  if (current === null) {
    throw new FindingLifecycleError(
      "FINDING_LIFECYCLE_NOT_FOUND",
      "No finding exists with that identifier.",
    );
  }

  const row: FindingLifecycleRow = {
    id: current.findingId,
    status: current.status,
    resolved_at: current.resolvedAt,
    updated_at: current.updatedAt,
  };
  if (row.status === spec.to && spec.isAlready(row)) {
    // Already there. Zero writes, and the original timestamps preserved.
    return toResult("ALREADY", row);
  }
  throw new FindingLifecycleError(
    "FINDING_LIFECYCLE_STATE_CONFLICT",
    spec.conflictMessage,
  );
}

/**
 * Marks a Finding `RESOLVED` after a conclusively passing regression.
 *
 * Legal from `OPEN` and `STILL_FAILING`. A Finding that is ALREADY `RESOLVED`
 * is a zero-write `ALREADY` that PRESERVES its original `resolved_at` — the
 * moment a defect was first proven fixed is a historical fact, and a later
 * confirming re-test must not overwrite it with a newer timestamp.
 */
export async function resolveFindingAfterRegression(input: {
  readonly findingId: string;
  readonly resolvedAt: string;
  /** The `updated_at` the caller read immediately before deciding. */
  readonly expectedUpdatedAt: string;
}): Promise<FindingLifecycleResult> {
  return transition({
    findingId: input.findingId,
    from: ["OPEN", "STILL_FAILING"],
    to: "RESOLVED",
    expectedUpdatedAt: input.expectedUpdatedAt,
    payload: {
      status: "RESOLVED",
      resolved_at: input.resolvedAt,
      updated_at: input.resolvedAt,
    },
    // Any genuinely resolved row is equivalent; its own timestamp stands.
    isAlready: (row) => row.resolved_at !== null,
    conflictMessage:
      "This finding is not in a state from which it can be resolved.",
  });
}

/**
 * Marks a Finding `STILL_FAILING` after a conclusively failing regression.
 *
 * Legal from all three statuses, including `RESOLVED` — a previously fixed
 * defect that fails again must reopen, and `resolved_at` is cleared in the
 * same statement so no stale resolution timestamp survives.
 */
export async function markFindingStillFailingAfterRegression(input: {
  readonly findingId: string;
  readonly updatedAt: string;
  /** The `updated_at` the caller read immediately before deciding. */
  readonly expectedUpdatedAt: string;
}): Promise<FindingLifecycleResult> {
  return transition({
    findingId: input.findingId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    // The target status is deliberately EXCLUDED from the guard. A Finding
    // that is already STILL_FAILING must fall through to the re-read and come
    // back as a zero-write ALREADY, so a repeated failing regression never
    // touches `updated_at` for a state that did not actually change.
    from: ["OPEN", "RESOLVED"],
    to: "STILL_FAILING",
    payload: {
      status: "STILL_FAILING",
      resolved_at: null,
      updated_at: input.updatedAt,
    },
    // `STILL_FAILING` always carries a null resolved_at (the Phase 3G CHECK),
    // so reaching the target status is sufficient.
    isAlready: () => true,
    conflictMessage:
      "This finding is not in a state from which it can be marked still failing.",
  });
}
