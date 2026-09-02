import Link from "next/link";

import { ProvenanceBadge } from "@/components/chaos/provenance-badge";
import { Card, PageShell, Section } from "@/components/ui/page";
import { ProvenanceTag, VerdictBadge } from "@/components/ui/status";
import { listRecentChaosRuns } from "@/lib/chaos/run-read-model";
import { listScenarioDtos } from "@/lib/chaos/scenario-dto";

/**
 * The Chaos Lab — the BREAK surface (docs/PHASE_PLAN.md Section 7.13:
 * "chaos scenario list").
 *
 * IT LOOKS LIKE A TEST SUITE, NOT A DASHBOARD. Four oversized cards read as
 * decoration; dense suite rows read as something an engineer runs. Each row
 * states the assumption the scenario attacks, so a reader who has not
 * memorised the catalogue still understands what is being tested.
 *
 * RECENT RUNS IS AN OPERATIONAL HISTORY. A table, exactly as persisted, with
 * status, outcome, provenance and time — not a stack of cards.
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

/**
 * What each mandatory scenario attacks, in one line.
 *
 * Descriptive copy only — the static registry remains the authoritative
 * catalogue, and an id absent from this map simply renders without a
 * subtitle rather than inventing one.
 */
const ATTACKS: Record<string, string> = {
  C01: "The same webhook delivered twice must not execute the protected effect twice.",
  C03: "A forged webhook signature must cause zero business mutation.",
  C07: "A captured payment must still reconcile when the client never returns.",
  C11: "A failed payment must never mark an order paid.",
};

const RUN_COLUMNS = [
  "Scenario",
  "Status",
  "Outcome",
  "Evidence",
  "Created",
  "Inspect",
];

export default async function ChaosLabPage() {
  const scenarios = listScenarioDtos();
  const runs = await listRecentChaosRuns(20);

  return (
    <PageShell wide>
      <header className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Break
        </span>
        <h1 className="text-2xl font-semibold leading-8 tracking-tight text-foreground">
          Chaos Lab
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          PayChaos deliberately stresses payment assumptions against the
          internal Demo Merchant only. It never sends chaos traffic to an
          external target and never touches Live Mode.
        </p>
      </header>

      <Section
        title="Reliability test suite"
        description="The four mandatory P0 scenarios. Each attacks a specific assumption a real payment integration is expected to hold."
      >
        <div className="overflow-hidden rounded-lg border border-border">
          <ul className="divide-y divide-border">
            {scenarios.map((scenario) => (
              <li
                key={scenario.scenarioId}
                className="flex flex-col gap-3 bg-card p-4 hover:bg-accent/20 md:flex-row md:items-start md:justify-between md:gap-6"
                data-testid={`scenario-card-${scenario.scenarioId}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-xs font-bold text-foreground">
                      {scenario.scenarioId}
                    </span>
                    <span className="text-sm font-medium text-card-foreground">
                      {scenario.name}
                    </span>
                    <ProvenanceTag label={scenario.priority} />
                    {!scenario.enabled && <ProvenanceTag label="Disabled" />}
                  </div>

                  {ATTACKS[scenario.scenarioId] !== undefined && (
                    <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
                      {ATTACKS[scenario.scenarioId]}
                    </p>
                  )}

                  {scenario.executionRequirements.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5">
                      {scenario.executionRequirements.map((requirement) => (
                        <li
                          key={requirement}
                          className="text-[11px] text-muted-foreground"
                        >
                          • {requirement}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <Link
                  href={`/chaos/scenarios/${scenario.scenarioId}`}
                  className="inline-flex shrink-0 items-center justify-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid={`scenario-open-${scenario.scenarioId}`}
                >
                  Open scenario
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section
        title="Recent runs"
        description="Operational history, exactly as persisted. A run that never executed is reported as such, never as a failure."
      >
        {runs.length === 0 ? (
          <Card data-testid="no-runs">
            <p className="text-sm leading-6 text-muted-foreground">
              No chaos run has been recorded yet.
            </p>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  {RUN_COLUMNS.map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    className="border-b border-border align-top last:border-0 hover:bg-accent/30"
                    data-testid="run-row"
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs font-bold text-foreground">
                        {run.scenarioId}
                      </span>
                      <div className="mt-0.5 font-mono text-[11px] break-all text-muted-foreground">
                        {run.id}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <VerdictBadge verdict={run.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {outcomeText(run.outcome)}
                    </td>
                    <td className="px-4 py-3">
                      <ProvenanceBadge storedValue={run.dataClassification} />
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                      <div>Created {stamp(run.createdAt)}</div>
                      <div>Completed {stamp(run.completedAt)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/chaos/runs/${run.id}`}
                        className="text-xs underline underline-offset-4 hover:no-underline"
                      >
                        Inspect
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </PageShell>
  );
}
