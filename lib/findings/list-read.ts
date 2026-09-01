import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";

import type {
  FindingStatus,
  InvariantResultSeverity,
  RegressionRunStatus,
} from "@/lib/supabase/types";

/**
 * Phase 5B — READ-ONLY: the Findings index.
 *
 * WHY THIS EXISTS. Findings could previously only be reached by remembering
 * which chaos run produced them and clicking through its invariant results.
 * An operator asking the obvious question — "what is currently wrong with my
 * integration?" — had nowhere to look. This answers exactly that.
 *
 * EVERY COLUMN IS PERSISTED. Severity and invariant come from the immutable
 * invariant result the finding reports; the scenario comes from its chaos
 * run; the regression column is the newest persisted regression's status.
 * Nothing is counted, averaged, scored or inferred here.
 *
 * A READ FAILURE IS NOT "NO FINDINGS". An empty list is a strong claim — it
 * means the merchant currently has no unresolved money-invariant failure. A
 * failed query throws instead, because rendering an outage as a clean bill of
 * health is the most dangerous thing this screen could do.
 */

export class FindingListReadError extends Error {
  readonly code: "FINDING_LIST_READ_FAILED";

  constructor() {
    super("The findings list could not be read.");
    this.name = "FindingListReadError";
    this.code = "FINDING_LIST_READ_FAILED";
  }
}

export interface FindingListRow {
  readonly findingId: string;
  readonly invariantResultId: string;
  readonly title: string;
  readonly status: FindingStatus;
  readonly severity: InvariantResultSeverity;
  readonly invariantId: string;
  readonly scenarioId: string | null;
  readonly detectedAt: string;
  /** `null` means no regression has ever been started for this finding. */
  readonly regressionStatus: RegressionRunStatus | null;
}

/** CRITICAL first — the order an operator needs, not alphabetical. */
const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

interface FindingRow {
  readonly id: string;
  readonly invariant_result_id: string;
  readonly title: string;
  readonly status: FindingStatus;
  readonly created_at: string;
}

interface InvariantRow {
  readonly id: string;
  readonly invariant_id: string;
  readonly severity: InvariantResultSeverity;
  readonly chaos_run_id: string | null;
}

interface RunRow {
  readonly id: string;
  readonly scenario_id: string;
}

interface RegressionRow {
  readonly finding_id: string;
  readonly status: RegressionRunStatus;
  readonly created_at: string;
}

/**
 * Every persisted finding, most severe first, then newest first.
 *
 * Returns `[]` only when the database genuinely holds no finding.
 */
export async function listFindings(): Promise<readonly FindingListRow[]> {
  const client = getSupabaseServerClient();

  const { data: findingData, error: findingError } = await client
    .from("findings")
    .select("id, invariant_result_id, title, status, created_at");

  if (findingError !== null) throw new FindingListReadError();

  const findings = (findingData ?? []) as unknown as FindingRow[];
  if (findings.length === 0) return [];

  const { data: invariantData, error: invariantError } = await client
    .from("invariant_results")
    .select("id, invariant_id, severity, chaos_run_id")
    .in(
      "id",
      findings.map((finding) => finding.invariant_result_id),
    );

  if (invariantError !== null) throw new FindingListReadError();
  const invariants = (invariantData ?? []) as unknown as InvariantRow[];
  const invariantById = new Map(invariants.map((row) => [row.id, row]));

  const runIds = [
    ...new Set(
      invariants
        .map((row) => row.chaos_run_id)
        .filter((id): id is string => id !== null),
    ),
  ];

  const runById = new Map<string, RunRow>();
  if (runIds.length > 0) {
    const { data: runData, error: runError } = await client
      .from("chaos_runs")
      .select("id, scenario_id")
      .in("id", runIds);

    if (runError !== null) throw new FindingListReadError();
    for (const row of (runData ?? []) as unknown as RunRow[]) {
      runById.set(row.id, row);
    }
  }

  const { data: regressionData, error: regressionError } = await client
    .from("regression_runs")
    .select("finding_id, status, created_at")
    .in(
      "finding_id",
      findings.map((finding) => finding.id),
    );

  if (regressionError !== null) throw new FindingListReadError();

  // Newest regression per finding wins; ordering is done here rather than
  // trusting the server's default row order.
  const latestRegression = new Map<string, RegressionRow>();
  for (const row of (regressionData ?? []) as unknown as RegressionRow[]) {
    const current = latestRegression.get(row.finding_id);
    if (current === undefined || row.created_at > current.created_at) {
      latestRegression.set(row.finding_id, row);
    }
  }

  return findings
    .map((finding): FindingListRow => {
      const invariant = invariantById.get(finding.invariant_result_id);
      const run =
        invariant?.chaos_run_id == null
          ? undefined
          : runById.get(invariant.chaos_run_id);

      return {
        findingId: finding.id,
        invariantResultId: finding.invariant_result_id,
        title: finding.title,
        status: finding.status,
        // A finding whose severity cannot be resolved is shown at the highest
        // risk rather than dropped or quietly downgraded.
        severity:
          invariant?.severity ?? ("CRITICAL" as InvariantResultSeverity),
        invariantId: invariant?.invariant_id ?? "—",
        scenarioId: run?.scenario_id ?? null,
        detectedAt: finding.created_at,
        regressionStatus: latestRegression.get(finding.id)?.status ?? null,
      };
    })
    .sort((a, b) => {
      const bySeverity =
        (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
      if (bySeverity !== 0) return bySeverity;
      return a.detectedAt < b.detectedAt ? 1 : -1;
    });
}
