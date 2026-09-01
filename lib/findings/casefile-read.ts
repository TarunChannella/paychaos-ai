import "server-only";

import { listRegressionRunsForFinding } from "@/lib/regression/repository";
import { getSupabaseServerClient } from "@/lib/supabase/server";

import type { RegressionRun } from "@/lib/regression/types";
import type {
  FindingDiagnosisStrength,
  FindingStatus,
  InvariantResultSeverity,
  InvariantResultValue,
} from "@/lib/supabase/types";

/**
 * Phase 5B — READ-ONLY: the Phase 4 half of a Finding's story.
 *
 * WHY THIS EXISTS. Phases 4A–4E persist diagnosis, recommendation and
 * regression evidence, but no screen ever read them: the frozen Phase 3G
 * `FindingDetail` deliberately stops at expected/observed, and the Phase 3H
 * summary index deliberately projects no Phase 4 column. The result was a
 * product where the diagnosis existed in the database and nowhere else. This
 * module closes exactly that gap and nothing more.
 *
 * IT INVENTS NOTHING. Every field is a column that Phase 4 already wrote. A
 * Finding that has not been diagnosed returns `diagnosis: null` — never a
 * placeholder, never a guess, never "no issues found". The caller renders the
 * absence honestly.
 *
 * IT WRITES NOTHING. SELECT only. Diagnosis stays in the frozen Phase 4C
 * service, recommendation in 4D, regression lifecycle in 4E. This is a
 * projection over what those already decided, not a second opinion.
 *
 * A READ FAILURE IS NOT "NOT DIAGNOSED". A failed query throws a typed error.
 * Returning `null` because a SELECT failed would tell an operator that
 * PayChaos found no root cause for a real money-invariant failure, which is a
 * specific and false claim about their integration.
 *
 * BEFORE/AFTER IS EVIDENCE, NOT NARRATIVE. The regression list is returned
 * exactly as persisted, newest first, with history intact. A historical FAIL
 * is never rewritten into a PASS: the honest shape is "this failed, a
 * regression was run, here is what the regression found".
 */

// ============================================================================
// ERROR MODEL
// ============================================================================

export class FindingCasefileReadError extends Error {
  readonly code: "FINDING_CASEFILE_READ_FAILED";

  constructor() {
    super(
      "The diagnosis and regression history for this finding could not be read.",
    );
    this.name = "FindingCasefileReadError";
    this.code = "FINDING_CASEFILE_READ_FAILED";
  }
}

// ============================================================================
// CONTRACT
// ============================================================================

/**
 * The deterministic diagnosis Phase 4C persisted.
 *
 * `strength` is an evidence label, never a probability: docs/DATABASE.md
 * Section 17 forbids invented confidence percentages.
 */
export interface FindingDiagnosis {
  readonly code: string;
  readonly strength: FindingDiagnosisStrength;
  readonly summary: string;
  readonly diagnosedAt: string | null;
}

/** The deterministic recommendation Phase 4D persisted. */
export interface FindingRecommendation {
  readonly code: string;
  readonly text: string;
}

export interface FindingCasefile {
  readonly findingId: string;
  readonly status: FindingStatus;
  readonly resolvedAt: string | null;
  /** `null` means NOT DIAGNOSED — never "nothing was wrong". */
  readonly diagnosis: FindingDiagnosis | null;
  /** `null` means NO RECOMMENDATION PERSISTED. */
  readonly recommendation: FindingRecommendation | null;
  /** Newest first. Empty means no regression has ever been started. */
  readonly regressionRuns: readonly RegressionRun[];
}

/** One persisted invariant evaluation, for a before/after comparison. */
export interface RegressionComparisonRow {
  readonly invariantResultId: string;
  readonly invariantId: string;
  readonly result: InvariantResultValue;
  readonly severity: InvariantResultSeverity;
  readonly reason: string;
  readonly evaluatedAt: string;
}

/**
 * The BEFORE and AFTER evidence for a regression.
 *
 * `before` is the original failing evaluation. `after` is what the regression
 * run actually produced. Both are persisted rows; neither is derived, and the
 * original is never mutated to match the newer one.
 */
export interface RegressionComparison {
  readonly regressionRunId: string;
  readonly status: RegressionRun["status"];
  readonly before: RegressionComparisonRow | null;
  readonly after: readonly RegressionComparisonRow[];
}

const FINDING_COLUMNS =
  "id, status, resolved_at, diagnosis_code, diagnosis_strength, diagnosis_summary, recommendation_code, recommendation_text, diagnosed_at";

const INVARIANT_COLUMNS =
  "id, invariant_id, result, severity, reason, evaluated_at";

interface FindingRow {
  readonly id: string;
  readonly status: FindingStatus;
  readonly resolved_at: string | null;
  readonly diagnosis_code: string | null;
  readonly diagnosis_strength: FindingDiagnosisStrength | null;
  readonly diagnosis_summary: string | null;
  readonly recommendation_code: string | null;
  readonly recommendation_text: string | null;
  readonly diagnosed_at: string | null;
}

interface InvariantRow {
  readonly id: string;
  readonly invariant_id: string;
  readonly result: InvariantResultValue;
  readonly severity: InvariantResultSeverity;
  readonly reason: string;
  readonly evaluated_at: string;
}

// ============================================================================
// READS
// ============================================================================

/**
 * The Phase 4 casefile for one Finding.
 *
 * Returns `null` only when the Finding genuinely does not exist — and only
 * after the query succeeded.
 */
export async function getFindingCasefile(
  findingId: string,
): Promise<FindingCasefile | null> {
  const { data, error } = await getSupabaseServerClient()
    .from("findings")
    .select(FINDING_COLUMNS)
    .eq("id", findingId)
    .maybeSingle();

  if (error !== null) throw new FindingCasefileReadError();
  if (data === null) return null;

  const row = data as unknown as FindingRow;

  let regressionRuns: readonly RegressionRun[];
  try {
    regressionRuns = await listRegressionRunsForFinding(findingId);
  } catch {
    // Same rule: an unreadable regression history is not "never retested".
    throw new FindingCasefileReadError();
  }

  return {
    findingId: row.id,
    status: row.status,
    resolvedAt: row.resolved_at,
    // All three diagnosis fields are written together by Phase 4C. Requiring
    // all three keeps a half-written row from rendering as a diagnosis.
    diagnosis:
      row.diagnosis_code !== null &&
      row.diagnosis_strength !== null &&
      row.diagnosis_summary !== null
        ? {
            code: row.diagnosis_code,
            strength: row.diagnosis_strength,
            summary: row.diagnosis_summary,
            diagnosedAt: row.diagnosed_at,
          }
        : null,
    recommendation:
      row.recommendation_code !== null && row.recommendation_text !== null
        ? { code: row.recommendation_code, text: row.recommendation_text }
        : null,
    regressionRuns,
  };
}

/**
 * BEFORE/AFTER evidence for the most recent regression of a Finding.
 *
 * `before` is the Finding's own original invariant result. `after` is every
 * invariant result the regression's chaos run persisted. Both sides are read;
 * nothing is computed, and a missing side is reported as missing.
 */
export async function getRegressionComparison(
  findingId: string,
  originalInvariantResultId: string,
): Promise<RegressionComparison | null> {
  let runs: readonly RegressionRun[];
  try {
    runs = await listRegressionRunsForFinding(findingId);
  } catch {
    throw new FindingCasefileReadError();
  }

  const latest = runs[0];
  if (latest === undefined) return null;

  const client = getSupabaseServerClient();

  const { data: beforeData, error: beforeError } = await client
    .from("invariant_results")
    .select(INVARIANT_COLUMNS)
    .eq("id", originalInvariantResultId)
    .maybeSingle();

  if (beforeError !== null) throw new FindingCasefileReadError();

  const { data: afterData, error: afterError } = await client
    .from("invariant_results")
    .select(INVARIANT_COLUMNS)
    .eq("chaos_run_id", latest.chaosRunId);

  if (afterError !== null) throw new FindingCasefileReadError();

  return {
    regressionRunId: latest.id,
    status: latest.status,
    before:
      beforeData === null ? null : toRow(beforeData as unknown as InvariantRow),
    after: ((afterData ?? []) as unknown as InvariantRow[])
      .map(toRow)
      .sort((a, b) => (a.invariantId < b.invariantId ? -1 : 1)),
  };
}

function toRow(row: InvariantRow): RegressionComparisonRow {
  return {
    invariantResultId: row.id,
    invariantId: row.invariant_id,
    result: row.result,
    severity: row.severity,
    reason: row.reason,
    evaluatedAt: row.evaluated_at,
  };
}
