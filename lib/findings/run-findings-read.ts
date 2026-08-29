import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { FindingStatus } from "@/lib/supabase/types";

/**
 * Phase 3H — READ-ONLY: which persisted invariant results already have a
 * Finding.
 *
 * WHY THIS EXISTS. The run-detail screen lists a run's invariant results and
 * needs to show "Finding available" beside a `FAIL`. Asking the frozen
 * `getFindingDetailByInvariantResultId` once per row would be N round-trips
 * for a fact that is one indexed lookup, and it returns far more than a badge
 * needs. This module answers exactly that question and nothing else.
 *
 * IT CREATES NOTHING. No insert, no update, no delete. Finding generation
 * stays entirely in the frozen Phase 3G service, and the Finding DETAIL page
 * keeps using the frozen `getFindingDetailByInvariantResultId` — this is a
 * summary index, not a second read model.
 *
 * NO PHASE 4 SURFACE. `diagnosis_*`, `recommendation_*`, `diagnosed_at` and
 * `resolved_at` are never selected. They are NULL after Phase 3G and belong to
 * Phase 4; projecting them would invite a caller to depend on them.
 *
 * A READ FAILURE IS NOT "NO FINDING". This module throws when the query fails
 * rather than returning an empty index. An empty index renders as "no Finding
 * for this result" — which, beside a persisted `FAIL`, is a specific and
 * serious claim. Saying it because a SELECT failed would be a false statement
 * about the merchant's reliability, so the caller is made to deal with the
 * outage instead.
 */

/** Deterministic domain error — never leaks a raw Supabase error or payload. */
export class FindingSummaryReadError extends Error {
  readonly code: "FINDING_SUMMARY_READ_FAILED";

  constructor() {
    super("Findings for these invariant results could not be read.");
    this.name = "FindingSummaryReadError";
    this.code = "FINDING_SUMMARY_READ_FAILED";
  }
}

export interface FindingSummary {
  readonly findingId: string;
  readonly invariantResultId: string;
  readonly status: FindingStatus;
  readonly title: string;
  readonly createdAt: string;
}

/** Explicit allowlist. Never `select("*")`. */
const SUMMARY_COLUMNS = "id, invariant_result_id, status, title, created_at";

/**
 * Maps `invariant_result_id -> FindingSummary` for the supplied results.
 *
 * A result with no Finding is simply absent from the map, which is the
 * truthful answer: `PASS` and `UNKNOWN` never produce one, and a `FAIL` whose
 * Finding has not been generated yet genuinely has none.
 */
export async function listFindingSummariesForInvariantResults(
  invariantResultIds: readonly string[],
): Promise<ReadonlyMap<string, FindingSummary>> {
  if (invariantResultIds.length === 0) {
    return new Map();
  }

  const client = getSupabaseServerClient();
  const { data, error } = await client
    .from("findings")
    .select(SUMMARY_COLUMNS)
    .in("invariant_result_id", [...invariantResultIds]);

  // A successful query with no matching rows returns an empty index — that is
  // the truthful "these results have no Finding". A FAILED query must not
  // produce the same answer.
  if (error || !data) {
    throw new FindingSummaryReadError();
  }

  const index = new Map<string, FindingSummary>();
  for (const row of data) {
    index.set(row.invariant_result_id, {
      findingId: row.id,
      invariantResultId: row.invariant_result_id,
      status: row.status,
      title: row.title,
      createdAt: row.created_at,
    });
  }
  return index;
}
