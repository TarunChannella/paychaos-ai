import Link from "next/link";

import { ProvenanceBadge } from "@/components/chaos/provenance-badge";
import { Card, PageHeader, PageShell, Section } from "@/components/ui/page";
import { ProvenanceTag, VerdictBadge } from "@/components/ui/status";
import { listRecentChaosRuns } from "@/lib/chaos/run-read-model";
import { getRazorpayEnv } from "@/lib/config/razorpay-env";
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

/**
 * The safety boundary, stated from facts this page can actually establish.
 *
 * Nothing here is a fabricated health check. Test Mode is read from the same
 * fail-closed configuration accessor the rest of the product uses; the target
 * is a structural property of the chaos engine; reaching this page at all
 * means the operator passed the access gate; and the run list having been
 * read is itself the evidence that the database is reachable. A green tick
 * that measured nothing would be exactly the decoration this product refuses.
 */
function readTestModeStatus(): "ENFORCED" | "UNAVAILABLE" {
  try {
    getRazorpayEnv();
    return "ENFORCED";
  } catch {
    return "UNAVAILABLE";
  }
}

export default async function ChaosLabPage() {
  const scenarios = listScenarioDtos();

  // A read failure must not render as "no runs" — it is reported below.
  let runs: Awaited<ReturnType<typeof listRecentChaosRuns>> | null = null;
  try {
    runs = await listRecentChaosRuns(20);
  } catch {
    runs = null;
  }

  const testMode = readTestModeStatus();

  return (
    <PageShell wide>
      <PageHeader
        eyebrow="Break"
        title="Chaos Lab"
        lede="PayChaos deliberately stresses payment assumptions against the internal Demo Merchant only. It never sends chaos traffic to an external target and never touches Live Mode."
      />

      {/* ---- SAFETY STATUS BAR ------------------------------------------ */}
      <ul
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        data-testid="chaos-safety-bar"
      >
        {(
          [
            [
              "Payment mode",
              testMode === "ENFORCED" ? "Razorpay Test Mode" : "Unavailable",
              testMode === "ENFORCED",
            ],
            ["Target", "Demo Merchant only", true],
            [
              "Evidence store",
              runs === null ? "Unreadable" : "Reachable",
              runs !== null,
            ],
            ["Operator", "Authorized session", true],
          ] as const
        ).map(([label, value, ok]) => (
          <li
            key={label}
            className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3"
          >
            <span
              aria-hidden="true"
              className={
                ok
                  ? "h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--status-pass)]"
                  : "h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--status-fail)]"
              }
            />
            <span className="min-w-0">
              <span className="block text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {label}
              </span>
              <span className="block truncate text-[13px] font-medium text-foreground">
                {value}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <Section
        title="Reliability test suite"
        description="The four mandatory P0 scenarios. Each attacks a specific assumption a real payment integration is expected to hold."
      >
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_0_rgb(0_0_0/0.03)]">
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
        {runs === null ? (
          // A read failure is not an empty history. Saying "no runs" because
          // a SELECT failed is a false statement about someone's evidence.
          <Card tone="danger" data-testid="runs-unavailable">
            <p className="text-sm font-medium text-card-foreground">
              Run history unavailable.
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The chaos run history could not be read. This is a read failure,
              not an absence of runs — nothing is shown rather than something
              misleading. Reload to retry.
            </p>
          </Card>
        ) : runs.length === 0 ? (
          <Card data-testid="no-runs">
            <p className="text-sm font-medium text-card-foreground">
              No chaos runs yet.
            </p>
            <p className="mt-2 max-w-[60ch] text-sm leading-6 text-muted-foreground">
              Run one of the four mandatory P0 scenarios above to test the Demo
              Merchant under controlled payment failure conditions. Nothing here
              implies the integration is healthy — it implies nothing has been
              tested.
            </p>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-[0_1px_2px_0_rgb(0_0_0/0.03)]">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left">
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
