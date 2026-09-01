import Link from "next/link";

import { Badge } from "@/components/ui/badge";

import type { ReliabilityScoreReadModel } from "@/lib/reliability/service";
import type {
  ReliabilityScenarioBreakdown,
  ReliabilityScenarioState,
} from "@/lib/reliability/types";

/**
 * Phase 4F-R3 — the Reliability Score breakdown, rendered.
 *
 * PRESENTATION ONLY. It takes an already-calculated `ReliabilityScoreReadModel`
 * and renders it. No fetch, no Supabase, no score arithmetic, no client state:
 * every number shown here was decided by `lib/reliability/score.ts`, and this
 * component may not re-derive, round, rescale or reinterpret any of them.
 *
 * IT SHOWS WHY, NOT JUST WHAT (P4-AC-11). Each row carries the state, the
 * deduction, the required and actual evidence classification, the provenance
 * label, the selected run, and the candidate counts that explain why that run
 * was selected — or why none was.
 *
 * `UNKNOWN` IS NOT `PASS` (P4-AC-12). Every non-PASS state states its own
 * 15-point deduction in words, and `UNKNOWN` says explicitly that inconclusive
 * evidence is not counted as a pass. No state is ever described as "healthy",
 * "safe", "production ready" or "certified".
 *
 * NO READINESS. Go-Live Readiness is Phase 4G. Nothing here computes or
 * displays READY, NOT READY or NEEDS ATTENTION.
 */

/** Deterministic wording per state. Never optimistic, never a claim of safety. */
const STATE_EXPLANATION: Record<ReliabilityScenarioState, string> = {
  PASS: "No deduction.",
  FAIL: "Failed invariant evidence caused this deduction.",
  UNKNOWN: "Inconclusive evidence — not counted as PASS. 15-point deduction.",
  BLOCKED: "Required test could not complete. 15-point deduction.",
  ERROR: "Technical or inconsistent test result. 15-point deduction.",
  NOT_RUN:
    "No eligible completed evidence is currently selected. 15-point deduction.",
};

/** Only a genuine PASS gets the neutral/solid treatment. */
const STATE_VARIANT: Record<
  ReliabilityScenarioState,
  "default" | "secondary" | "outline" | "destructive"
> = {
  PASS: "default",
  FAIL: "destructive",
  UNKNOWN: "secondary",
  BLOCKED: "secondary",
  ERROR: "destructive",
  NOT_RUN: "outline",
};

/** Why this scenario's current run was — or was not — selected. */
const SELECTION_REASON_TEXT = {
  LATEST_ELIGIBLE_RUN: "Latest eligible run selected.",
  NO_CANDIDATES: "No run of this scenario exists yet.",
  NO_ELIGIBLE_CANDIDATES:
    "Runs exist, but none met this scenario's evidence requirements.",
} as const;

function Row({
  entry,
  diagnostics,
}: {
  readonly entry: ReliabilityScenarioBreakdown;
  readonly diagnostics: ReliabilityScoreReadModel["selectionDiagnostics"][number];
}) {
  return (
    <li
      className="rounded-lg border border-border bg-card p-5"
      data-testid={`reliability-row-${entry.scenarioId}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-card-foreground">
          {entry.scenarioId}
        </span>
        <Badge
          variant={STATE_VARIANT[entry.state]}
          data-testid={`reliability-state-${entry.scenarioId}`}
        >
          {entry.state}
        </Badge>
        <span
          className="text-sm text-muted-foreground"
          data-testid={`reliability-deduction-${entry.scenarioId}`}
        >
          Deduction: {entry.deduction}
        </span>
      </div>

      <p
        className="mt-2 text-sm text-card-foreground"
        data-testid={`reliability-explanation-${entry.scenarioId}`}
      >
        {STATE_EXPLANATION[entry.state]}
      </p>

      <dl className="mt-3 grid gap-1 text-xs text-muted-foreground">
        <div className="flex flex-wrap gap-2">
          <dt>Required evidence:</dt>
          <dd className="font-mono">{entry.requiredDataClassification}</dd>
        </div>

        {entry.selectedRunId !== null ? (
          <>
            <div className="flex flex-wrap gap-2">
              <dt>Selected evidence:</dt>
              <dd
                className="font-mono"
                data-testid={`reliability-classification-${entry.scenarioId}`}
              >
                {entry.selectedDataClassification}
              </dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt>Provenance:</dt>
              <dd data-testid={`reliability-provenance-${entry.scenarioId}`}>
                {entry.provenanceLabel}
              </dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt>Selected run:</dt>
              <dd>
                <Link
                  href={`/chaos/runs/${entry.selectedRunId}`}
                  className="font-mono underline underline-offset-2"
                  data-testid={`reliability-run-${entry.scenarioId}`}
                >
                  {entry.selectedRunId}
                </Link>
              </dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt>Run result:</dt>
              <dd className="font-mono">
                {entry.selectedRunStatus} / {entry.selectedRunOutcome}
              </dd>
            </div>
          </>
        ) : (
          <div data-testid={`reliability-no-run-${entry.scenarioId}`}>
            No eligible selected run.
          </div>
        )}

        {entry.supportingFailedInvariantResultId !== null && (
          <div className="flex flex-wrap gap-2">
            <dt>Supporting failed invariant:</dt>
            <dd
              className="font-mono"
              data-testid={`reliability-support-${entry.scenarioId}`}
            >
              {entry.supportingInvariantId} ({entry.supportingSeverity}) —{" "}
              {entry.supportingFailedInvariantResultId}
            </dd>
          </div>
        )}

        <div
          className="flex flex-wrap gap-2"
          data-testid={`reliability-diagnostics-${entry.scenarioId}`}
        >
          <dt>Candidates:</dt>
          <dd>
            {diagnostics.totalCandidateCount} total,{" "}
            {diagnostics.eligibleCandidateCount} eligible,{" "}
            {diagnostics.ineligibleCandidateCount} ineligible —{" "}
            {SELECTION_REASON_TEXT[diagnostics.selectionReason]}
          </dd>
        </div>
      </dl>
    </li>
  );
}

export function ReliabilityOverview({
  model,
}: {
  readonly model: ReliabilityScoreReadModel;
}) {
  const { score, selectionDiagnostics } = model;

  return (
    <div className="flex flex-col gap-8" data-testid="reliability-overview">
      <section className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">Reliability Score</p>
        <p
          className="text-4xl font-semibold tracking-tight text-card-foreground"
          data-testid="reliability-score"
        >
          {score.score} / 100
        </p>
        <p
          className="text-sm text-muted-foreground"
          data-testid="reliability-total-deduction"
        >
          Total deduction: {score.totalDeduction}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Badge variant="outline" data-testid="reliability-algorithm">
            {score.algorithmVersion}
          </Badge>
          <Badge variant="outline" data-testid="reliability-selection">
            {score.selectionVersion}
          </Badge>
        </div>
        <p className="mt-2 max-w-xl text-balance text-xs text-muted-foreground">
          Deterministic score derived on demand from persisted chaos evidence.
          Go-Live Readiness is evaluated separately.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-foreground">
          Scenario breakdown
        </h2>
        <ul className="flex flex-col gap-3">
          {score.scenarioBreakdown.map((entry) => {
            const diagnostics = selectionDiagnostics.find(
              (item) => item.scenarioId === entry.scenarioId,
            );
            if (diagnostics === undefined) return null;
            return (
              <Row
                key={entry.scenarioId}
                entry={entry}
                diagnostics={diagnostics}
              />
            );
          })}
        </ul>
      </section>
    </div>
  );
}
