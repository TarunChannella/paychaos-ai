import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";

import type { ReadinessUnresolvedFinding } from "./types";
import type {
  FindingStatus,
  InvariantResultSeverity,
  InvariantResultValue,
} from "@/lib/supabase/types";

/**
 * Phase 4G — SELECT-ONLY loading for the readiness gates that the frozen
 * Phase 4F read model does not already supply.
 *
 * Every statement here is a read. There is no `insert`, `update`, `upsert`,
 * `delete` or mutating `rpc`, and there is deliberately no function that could
 * grow one: readiness is DERIVED ON DEMAND and there is nothing to persist.
 *
 * IT READS EXACTLY TWO TABLES. `findings` and `invariant_results`, through
 * narrow explicit projections. `regression_runs` is never queried — a
 * regression's status must not decide how serious an unresolved Finding is —
 * and no prose column is ever selected.
 *
 * SEVERITY COMES FROM THE INVARIANT RESULT. A Finding's risk is the severity
 * of the immutable invariant evaluation it points at, never
 * `diagnosis_strength`, a recommendation, or any model output. Those are
 * advisory text; this is the authoritative record of what failed.
 *
 * READ FAILURE IS NOT A CLEAN STATE. A failed read raises a typed
 * `ReadinessRepositoryError`; it never returns an empty array. "No unresolved
 * findings" and "we could not check for unresolved findings" are opposite
 * facts, and a database timeout silently reported as the former would be the
 * single most dangerous bug this phase could contain.
 *
 * SAFE ERRORS. A PostgREST `message`, `details`, `hint` or query string never
 * escapes this module.
 */

// ============================================================================
// ERROR MODEL
// ============================================================================

export const READINESS_REPOSITORY_ERROR_CODES = Object.freeze([
  /** The unresolved-Finding projection could not be read. */
  "FINDING_READ_FAILED",
  /** The selected-run invariant projection could not be read. */
  "INVARIANT_RESULT_READ_FAILED",
] as const);

export type ReadinessRepositoryErrorCode =
  (typeof READINESS_REPOSITORY_ERROR_CODES)[number];

export class ReadinessRepositoryError extends Error {
  readonly code: ReadinessRepositoryErrorCode;

  constructor(code: ReadinessRepositoryErrorCode, message: string) {
    super(message);
    this.name = "ReadinessRepositoryError";
    this.code = code;
  }
}

// ============================================================================
// PROJECTIONS
// ============================================================================

/** The unresolved Finding statuses (docs/DATABASE.md — `findings.status`). */
const UNRESOLVED_STATUSES: readonly FindingStatus[] = ["OPEN", "STILL_FAILING"];

/** Only the id and the link to the authoritative severity. */
const FINDING_COLUMNS = "id, invariant_result_id, status";

/** Only what a readiness gate needs; no summary, reason or evidence prose. */
const INVARIANT_RESULT_COLUMNS =
  "id, chaos_run_id, invariant_id, result, severity";

interface FindingProjection {
  readonly id: string;
  readonly invariant_result_id: string;
  readonly status: FindingStatus;
}

interface InvariantResultProjection {
  readonly id: string;
  readonly chaos_run_id: string | null;
  readonly invariant_id: string;
  readonly result: InvariantResultValue;
  readonly severity: InvariantResultSeverity;
}

/** One selected run's persisted invariant evidence. */
export interface ReadinessRunInvariantEvidence {
  readonly chaosRunId: string;
  readonly results: readonly {
    readonly invariantId: string;
    readonly result: InvariantResultValue;
  }[];
}

// ============================================================================
// READS
// ============================================================================

/**
 * Every unresolved P0 Finding, carrying the severity of the invariant result
 * it reports.
 *
 * An empty array here means the database genuinely holds no unresolved
 * Finding — it is only ever returned after both queries succeeded.
 */
export async function loadUnresolvedFindings(): Promise<
  readonly ReadinessUnresolvedFinding[]
> {
  const client = getSupabaseServerClient();

  const { data: findingRows, error: findingError } = await client
    .from("findings")
    .select(FINDING_COLUMNS)
    .in("status", [...UNRESOLVED_STATUSES]);

  if (findingError !== null) {
    // Never an empty array: see "READ FAILURE IS NOT A CLEAN STATE" above.
    throw new ReadinessRepositoryError(
      "FINDING_READ_FAILED",
      "The unresolved findings required by the readiness assessment could not be read.",
    );
  }

  const findings = (findingRows ?? []) as unknown as FindingProjection[];
  if (findings.length === 0) return [];

  const { data: resultRows, error: resultError } = await client
    .from("invariant_results")
    .select("id, severity")
    .in(
      "id",
      findings.map((finding) => finding.invariant_result_id),
    );

  if (resultError !== null) {
    throw new ReadinessRepositoryError(
      "INVARIANT_RESULT_READ_FAILED",
      "The invariant severities required by the readiness assessment could not be read.",
    );
  }

  const severityById = new Map<string, InvariantResultSeverity>();
  for (const row of (resultRows ?? []) as unknown as {
    id: string;
    severity: InvariantResultSeverity;
  }[]) {
    severityById.set(row.id, row.severity);
  }

  return findings
    .map((finding) => {
      const severity = severityById.get(finding.invariant_result_id);
      // A Finding whose severity cannot be established is NOT dropped: it is
      // reported at the highest risk, because an unclassifiable unresolved
      // failure is exactly the thing that must not slip past a READY gate.
      return {
        findingId: finding.id,
        severity: severity ?? ("CRITICAL" as InvariantResultSeverity),
      };
    })
    .sort((a, b) => (a.findingId < b.findingId ? -1 : 1));
}

/**
 * The persisted invariant results for the supplied selected chaos runs.
 *
 * An empty id list returns `[]` WITHOUT issuing a query: PostgREST's `.in()`
 * with an empty array is a malformed filter, and there is nothing to ask for.
 */
export async function loadSelectedRunInvariantEvidence(
  chaosRunIds: readonly string[],
): Promise<readonly ReadinessRunInvariantEvidence[]> {
  if (chaosRunIds.length === 0) return [];

  const { data, error } = await getSupabaseServerClient()
    .from("invariant_results")
    .select(INVARIANT_RESULT_COLUMNS)
    .in("chaos_run_id", [...chaosRunIds]);

  if (error !== null) {
    throw new ReadinessRepositoryError(
      "INVARIANT_RESULT_READ_FAILED",
      "The invariant evidence required by the readiness assessment could not be read.",
    );
  }

  const rows = (data ?? []) as unknown as InvariantResultProjection[];
  return chaosRunIds.map((chaosRunId) => ({
    chaosRunId,
    results: rows
      .filter((row) => row.chaos_run_id === chaosRunId)
      .map((row) => ({ invariantId: row.invariant_id, result: row.result })),
  }));
}
