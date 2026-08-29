import "server-only";

import { getChaosRunById } from "@/lib/chaos/run-repository";
import { listFindingSummariesForInvariantResults } from "@/lib/findings/run-findings-read";
import { listInvariantResultsForChaosRun } from "@/lib/invariants/result-repository";
import { getInvariantDefinition } from "@/lib/invariants/registry";
import { isMoneyInvariantId } from "@/lib/invariants/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { FindingSummary } from "@/lib/findings/run-findings-read";
import type { InvariantResultEvidenceRef } from "@/lib/supabase/types";

/**
 * Phase 3H — the SAFE read model behind the chaos-run screens.
 *
 * IT DECIDES NOTHING. Every verdict here was decided by the frozen Phase 3F
 * evaluators and persisted. This module reads rows and projects them; it never
 * re-evaluates an invariant, never derives `FAIL` from a status colour, and
 * never converts `UNKNOWN` into anything else. `UNKNOWN` reaching a screen as
 * `UNKNOWN` is the whole point — it means the rule applied and the evidence
 * was insufficient, which is not a pass.
 *
 * DELIBERATELY ABSENT from every projection: `fault_config` and `fault_state`.
 * Both are free-form JSON whose contents vary per scenario and per fault
 * primitive; nothing on a P0 screen needs them, and projecting a generic blob
 * to a browser is how a payload or an internal detail eventually leaks.
 * `error_message_redacted` IS exposed — it is redacted by contract at write
 * time (docs/DATABASE.md Section 15).
 *
 * Also absent: raw webhook bodies, signatures, secrets, unredacted database
 * errors and customer PII. Nothing in these shapes can carry them.
 *
 * A READ FAILURE IS NOT AN EMPTY RESULT. `listRecentChaosRuns` throws when its
 * query fails rather than returning `[]`. "No runs have been executed" and
 * "the run history could not be read" render identically as an empty list but
 * mean opposite things, and only one of them is a fact.
 */

/** Deterministic domain error — never leaks a raw Supabase error or payload. */
export class ChaosRunReadModelError extends Error {
  readonly code: "CHAOS_RUN_LIST_READ_FAILED";

  constructor() {
    super("Recent chaos runs could not be read.");
    this.name = "ChaosRunReadModelError";
    this.code = "CHAOS_RUN_LIST_READ_FAILED";
  }
}

export interface SafeChaosRunSummary {
  readonly id: string;
  readonly scenarioId: string;
  readonly status: string;
  /**
   * Nullable by schema: a run that has not reached an outcome yet genuinely
   * has none. Rendered as "not yet determined" — NEVER defaulted to a verdict
   * such as PASS, which would invent a result the engine never reached.
   */
  readonly outcome: string | null;
  readonly dataClassification: string;
  readonly faultType: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
}

export interface SafeChaosRunDetail extends SafeChaosRunSummary {
  readonly failedPrecheckId: string | null;
  readonly executionBlockCode: string | null;
  readonly errorMessageRedacted: string | null;
  readonly updatedAt: string;
  readonly correlations: {
    readonly orderId: string | null;
    readonly paymentAttemptId: string | null;
    readonly paymentId: string | null;
    readonly sourceWebhookEventId: string | null;
  };
  readonly invariantResults: readonly SafeInvariantResultView[];
  /**
   * `true` when the run never executed because a precheck or execution block
   * stopped it. A blocked run is NOT a payment failure and NOT an invariant
   * `FAIL` — the screen must say so, and this flag is what lets it.
   */
  readonly isBlocked: boolean;
}

export interface SafeInvariantResultView {
  readonly id: string;
  readonly invariantId: string;
  readonly invariantVersion: string;
  /** The invariant's frozen catalogue name, or `null` if uncatalogued. */
  readonly invariantName: string | null;
  readonly result: "PASS" | "FAIL" | "UNKNOWN";
  readonly severity: string;
  readonly expectedSummary: string;
  readonly observedSummary: string;
  readonly reason: string;
  readonly evidenceRefs: readonly InvariantResultEvidenceRef[];
  readonly evaluatedAt: string;
  /** The Finding this result produced, when one exists. `PASS`/`UNKNOWN` never have one. */
  readonly finding: FindingSummary | null;
}

/** Explicit allowlist for the recent-runs list. Never `select("*")`. */
const RUN_SUMMARY_COLUMNS =
  "id, scenario_id, status, outcome, data_classification, fault_type, started_at, completed_at, created_at";

const DEFAULT_RECENT_LIMIT = 20;
const MAX_RECENT_LIMIT = 50;

function invariantName(invariantId: string): string | null {
  if (!isMoneyInvariantId(invariantId)) return null;
  return getInvariantDefinition(invariantId)?.name ?? null;
}

/**
 * A run is blocked when it never executed: a precheck rejected it, or an
 * execution block stopped it. Read from persisted columns only — never
 * inferred from an absent result set, because "no results yet" and "blocked"
 * are different states and conflating them would mislabel a pending run.
 */
function isBlockedRun(
  failedPrecheckId: string | null,
  executionBlockCode: string | null,
): boolean {
  return failedPrecheckId !== null || executionBlockCode !== null;
}

/**
 * The most recent chaos runs, newest first.
 *
 * Ordered by `created_at` then `id` so the ordering is total and stable —
 * two runs created in the same millisecond would otherwise be free to swap
 * places between renders.
 */
export async function listRecentChaosRuns(
  limit: number = DEFAULT_RECENT_LIMIT,
): Promise<readonly SafeChaosRunSummary[]> {
  const safeLimit = Math.min(
    Math.max(
      Number.isFinite(limit) ? Math.trunc(limit) : DEFAULT_RECENT_LIMIT,
      1,
    ),
    MAX_RECENT_LIMIT,
  );

  const client = getSupabaseServerClient();
  const { data, error } = await client
    .from("chaos_runs")
    .select(RUN_SUMMARY_COLUMNS)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(safeLimit);

  // A successful query with no rows returns []; a failed one must not.
  if (error || !data) throw new ChaosRunReadModelError();

  return Object.freeze(
    data.map((row) => ({
      id: row.id,
      scenarioId: row.scenario_id,
      status: row.status,
      outcome: row.outcome,
      dataClassification: row.data_classification,
      faultType: row.fault_type,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    })),
  );
}

/**
 * One run, its persisted invariant results, and each result's Finding.
 *
 * Returns `null` for an unknown run rather than throwing: an operator
 * following a stale link should see "not found", not a server error.
 */
export async function getChaosRunDetail(
  runId: string,
): Promise<SafeChaosRunDetail | null> {
  const run = await getChaosRunById(runId);
  if (run === null) return null;

  const results = await listInvariantResultsForChaosRun(runId);
  const findings = await listFindingSummariesForInvariantResults(
    results.map((r) => r.id),
  );

  const invariantResults: SafeInvariantResultView[] = results.map((row) => ({
    id: row.id,
    invariantId: row.invariant_id,
    invariantVersion: row.invariant_version,
    invariantName: invariantName(row.invariant_id),
    result: row.result,
    severity: row.severity,
    expectedSummary: row.expected_summary,
    observedSummary: row.observed_summary,
    reason: row.reason,
    evidenceRefs: row.evidence_refs,
    evaluatedAt: row.evaluated_at,
    finding: findings.get(row.id) ?? null,
  }));

  return {
    id: run.id,
    scenarioId: run.scenario_id,
    status: run.status,
    outcome: run.outcome,
    dataClassification: run.data_classification,
    faultType: run.fault_type,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    failedPrecheckId: run.failed_precheck_id,
    executionBlockCode: run.execution_block_code,
    errorMessageRedacted: run.error_message_redacted,
    correlations: {
      orderId: run.order_id,
      paymentAttemptId: run.payment_attempt_id,
      paymentId: run.payment_id,
      sourceWebhookEventId: run.source_webhook_event_id,
    },
    invariantResults: Object.freeze(invariantResults),
    isBlocked: isBlockedRun(run.failed_precheck_id, run.execution_block_code),
  };
}
