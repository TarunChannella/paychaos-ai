import Link from "next/link";

import { ProvenanceBadge } from "@/components/chaos/provenance-badge";
import { Badge } from "@/components/ui/badge";
import { listRecentChaosRuns } from "@/lib/chaos/run-read-model";
import { listScenarioDtos } from "@/lib/chaos/scenario-dto";

/**
 * Phase 3H — the Chaos Lab entry point (docs/PHASE_PLAN.md Section 7.13:
 * "chaos scenario list").
 *
 * Always server-rendered against current Supabase state: a cached snapshot of
 * chaos runs would show an operator a stale verdict, and a verdict is exactly
 * the thing that must never be stale here.
 */
export const dynamic = "force-dynamic";

/**
 * Timestamps are rendered as the stored UTC instant, not a locale string.
 * `toLocaleString()` would format differently on the server and the client
 * (hydration mismatch) and would quietly imply a timezone the record does not
 * carry. Evidence screens show the value that was persisted.
 */
function stamp(iso: string | null): string {
  return iso ?? "—";
}

/** A run that never executed is not a failure — say so rather than imply one. */
function outcomeText(outcome: string | null): string {
  return outcome ?? "Not yet determined";
}

export default async function ChaosLabPage() {
  const scenarios = listScenarioDtos();
  const runs = await listRecentChaosRuns(20);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="flex flex-col items-center gap-3 text-center">
        <Badge variant="outline" className="text-sm">
          Razorpay Test Mode
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          PayChaos AI — Chaos Lab
        </h1>
        <p className="max-w-xl text-balance text-sm text-muted-foreground">
          Controlled reliability scenarios executed against the internal Demo
          Merchant only. PayChaos never sends chaos traffic to an external
          target and never touches Live Mode.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-foreground">P0 Scenarios</h2>
        <ul className="flex flex-col gap-3">
          {scenarios.map((scenario) => (
            <li
              key={scenario.scenarioId}
              className="rounded-lg border border-border bg-card p-5"
              data-testid={`scenario-card-${scenario.scenarioId}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold text-card-foreground">
                  {scenario.scenarioId}
                </span>
                <span className="text-sm font-medium text-card-foreground">
                  {scenario.name}
                </span>
                <Badge variant="outline">{scenario.priority}</Badge>
                {!scenario.enabled && (
                  <Badge variant="destructive">Disabled</Badge>
                )}
              </div>

              <ul className="mt-3 flex flex-col gap-1">
                {scenario.executionRequirements.map((requirement) => (
                  <li
                    key={requirement}
                    className="text-xs text-muted-foreground"
                  >
                    • {requirement}
                  </li>
                ))}
              </ul>

              <Link
                href={`/chaos/scenarios/${scenario.scenarioId}`}
                className="mt-4 inline-flex items-center justify-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                data-testid={`scenario-open-${scenario.scenarioId}`}
              >
                Open scenario
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-foreground">Recent runs</h2>

        {runs.length === 0 ? (
          <p
            className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground"
            data-testid="no-runs"
          >
            No chaos run has been recorded yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {runs.map((run) => (
              <li
                key={run.id}
                className="rounded-lg border border-border bg-card p-4"
                data-testid="run-row"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-card-foreground">
                    {run.scenarioId}
                  </span>
                  <Badge variant="outline">{run.status}</Badge>
                  <span className="text-xs text-muted-foreground">
                    Outcome: {outcomeText(run.outcome)}
                  </span>
                  <ProvenanceBadge storedValue={run.dataClassification} />
                </div>
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  {run.id}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Created {stamp(run.createdAt)} · Started{" "}
                  {stamp(run.startedAt)} · Completed {stamp(run.completedAt)}
                </p>
                <Link
                  href={`/chaos/runs/${run.id}`}
                  className="mt-3 inline-flex items-center justify-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                >
                  Inspect run
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
