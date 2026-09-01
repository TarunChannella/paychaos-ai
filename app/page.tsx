import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { listFindings } from "@/lib/findings/list-read";
import { getCurrentGoLiveReadiness } from "@/lib/readiness/service";

import type { FindingListRow } from "@/lib/findings/list-read";
import type { GoLiveReadinessReadModel } from "@/lib/readiness/service";

/**
 * Phase 5B — the Overview.
 *
 * IT ANSWERS FOUR QUESTIONS IN TEN SECONDS: is this integration ready, what
 * is the Reliability Score, which mandatory scenario is unhealthy, and what
 * should be looked at first.
 *
 * EVERY NUMBER IS DERIVED. The score, the readiness verdict and the four
 * scenario states come from the frozen RELIABILITY-V1 / GO-LIVE-READINESS-V1
 * read model, recalculated on every request. Nothing on this page is
 * hard-coded, cached or estimated — the score is whatever the current
 * evidence produces, and it changes when the evidence changes.
 *
 * READ FAILURE IS NEVER A HEALTHY DASHBOARD. If the evidence cannot be read,
 * this page says so. It does not render 0, does not render 100, does not show
 * an empty findings list and does not show a reassuring verdict. A dashboard
 * that turns an outage into "all clear" is worse than no dashboard.
 *
 * NO INVENTED AGGREGATES. There is no uptime figure, no trend line, no
 * success-rate percentage and no "last updated" clock, because none of those
 * is backed by a real measurement.
 */
export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  READY: "default",
  "NEEDS ATTENTION": "secondary",
  "NOT READY": "destructive",
};

const SCENARIO_TITLE: Record<string, string> = {
  C01: "Duplicate Webhook Delivery",
  C03: "Invalid Webhook Signature",
  C07: "Payment Succeeds but Client Confirmation Is Lost",
  C11: "Failed Payment Must Never Mark Order Paid",
};

const STATE_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  PASS: "default",
  FAIL: "destructive",
  UNKNOWN: "outline",
  BLOCKED: "outline",
  ERROR: "destructive",
  NOT_RUN: "outline",
};

export default async function OverviewPage() {
  let model: GoLiveReadinessReadModel | null = null;
  try {
    model = await getCurrentGoLiveReadiness();
  } catch {
    model = null;
  }

  // Findings are additive context. Their failure must not blank the score.
  let findings: readonly FindingListRow[] | null = null;
  try {
    findings = await listFindings();
  } catch {
    findings = null;
  }

  const unresolvedHighRisk =
    findings?.filter(
      (row) =>
        (row.severity === "CRITICAL" || row.severity === "HIGH") &&
        row.status !== "RESOLVED",
    ) ?? [];

  const breakdown = model?.reliability.score.scenarioBreakdown ?? [];
  const passing = breakdown.filter((entry) => entry.state === "PASS").length;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          PayChaos AI
        </h1>
        <p className="text-sm font-medium text-muted-foreground">
          Autonomous Payment Reliability Engineer
        </p>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Test payment integrations before failures reach production.
        </p>
      </header>

      {model === null ? (
        <section
          className="rounded-lg border border-destructive/40 bg-card p-6"
          data-testid="overview-unavailable"
        >
          <p className="text-sm font-medium text-card-foreground">
            Reliability evidence unavailable.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            No score or readiness verdict is shown because the required evidence
            could not be read. This is a read failure, not a healthy
            integration.
          </p>
        </section>
      ) : (
        <>
          {/* ---------------------------------------------------------- */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div
              className="flex flex-col gap-1 rounded-lg border border-border bg-card p-5"
              data-testid="overview-score"
            >
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Reliability Score
              </span>
              <span className="text-4xl font-semibold tabular-nums text-card-foreground">
                {model.reliability.score.score}
                <span className="text-lg text-muted-foreground"> / 100</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {model.reliability.score.algorithmVersion} · deterministic,
                recalculated from persisted evidence
              </span>
            </div>

            <div
              className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5"
              data-testid="overview-readiness"
            >
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Go-Live Readiness
              </span>
              <Badge
                variant={STATUS_VARIANT[model.readiness.status] ?? "outline"}
                className="w-fit text-base"
                data-testid="overview-readiness-status"
              >
                {model.readiness.status}
              </Badge>
              <Link
                href="/reliability"
                className="text-xs underline hover:no-underline"
              >
                See why →
              </Link>
            </div>
          </section>

          {/* ---------------------------------------------------------- */}
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                Required P0 scenarios
              </h2>
              <span
                className="text-xs text-muted-foreground"
                data-testid="overview-scenarios-passing"
              >
                {passing} of {breakdown.length} passing
              </span>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[40rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left">
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      Scenario
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      State
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      Deduction
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      Evidence
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((entry) => (
                    <tr
                      key={entry.scenarioId}
                      className="border-b border-border last:border-0"
                      data-testid={`overview-scenario-${entry.scenarioId}`}
                    >
                      <td className="px-4 py-3 align-top">
                        <span className="font-mono text-xs font-semibold">
                          {entry.scenarioId}
                        </span>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {SCENARIO_TITLE[entry.scenarioId] ?? ""}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Badge
                          variant={STATE_VARIANT[entry.state] ?? "outline"}
                          className="text-xs"
                          data-testid={`overview-state-${entry.scenarioId}`}
                        >
                          {entry.state}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 align-top tabular-nums text-muted-foreground">
                        −{entry.deduction}
                      </td>
                      <td className="px-4 py-3 align-top text-xs">
                        {entry.selectedRunId === null ? (
                          <span className="text-muted-foreground">
                            No eligible run
                          </span>
                        ) : (
                          <Link
                            href={`/chaos/runs/${entry.selectedRunId}`}
                            className="underline hover:no-underline"
                          >
                            View run
                          </Link>
                        )}
                        {entry.provenanceLabel !== null && (
                          <div className="mt-0.5 text-muted-foreground">
                            {entry.provenanceLabel}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* ------------------------------------------------------------ */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          What to investigate first
        </h2>

        {findings === null ? (
          <p
            className="rounded-lg border border-destructive/40 bg-card p-4 text-sm text-muted-foreground"
            data-testid="overview-findings-unavailable"
          >
            The findings could not be read. This is a read failure — not
            confirmation that there are none.
          </p>
        ) : unresolvedHighRisk.length === 0 ? (
          <p
            className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground"
            data-testid="overview-findings-clear"
          >
            No unresolved critical or high finding is currently recorded.
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="overview-findings">
            {unresolvedHighRisk.slice(0, 5).map((row) => (
              <li
                key={row.findingId}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4"
              >
                <Badge variant="destructive" className="text-xs">
                  {row.severity}
                </Badge>
                <Link
                  href={`/chaos/findings/invariant-results/${row.invariantResultId}`}
                  className="text-sm underline hover:no-underline"
                >
                  {row.title}
                </Link>
                <span className="font-mono text-xs text-muted-foreground">
                  {row.scenarioId ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        )}

        <Link href="/findings" className="text-xs underline hover:no-underline">
          View all findings →
        </Link>
      </section>
    </div>
  );
}
