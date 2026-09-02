import Link from "next/link";

import { ReadinessDecision } from "@/components/reliability/readiness-decision";
import { ScenarioMatrix } from "@/components/reliability/scenario-matrix";
import { Card, PageShell, Section } from "@/components/ui/page";
import { SeverityBadge } from "@/components/ui/status";
import { listFindings } from "@/lib/findings/list-read";
import { getCurrentGoLiveReadiness } from "@/lib/readiness/service";

import type { FindingListRow } from "@/lib/findings/list-read";
import type { GoLiveReadinessReadModel } from "@/lib/readiness/service";

/**
 * The Overview.
 *
 * IT ANSWERS FOUR QUESTIONS IN TEN SECONDS: are we ready, what is the score,
 * which mandatory scenario is unhealthy, and what should be looked at first.
 * Readiness leads, because "can we ship?" is the question this product
 * exists to answer.
 *
 * EVERY NUMBER IS DERIVED. Score, verdict and the four scenario states come
 * from the frozen RELIABILITY-V1 / GO-LIVE-READINESS-V1 read model,
 * recalculated on every request. Nothing here is hard-coded or cached.
 *
 * READ FAILURE IS NEVER A HEALTHY DASHBOARD. If the evidence cannot be read
 * this page says so. It does not render 0, does not render 100, does not show
 * an empty findings list and does not show a reassuring verdict.
 *
 * NO INVENTED AGGREGATES. No uptime, no trend, no success rate, no "last
 * updated" clock — none of those is backed by a real measurement.
 *
 * NO BATCH RUNNER. There is deliberately no "Run Reliability Suite" action:
 * no such safe operation exists, and C07/C11-A genuinely require external
 * Test Mode actions. The honest primary action is to open the Chaos Lab.
 */
export const dynamic = "force-dynamic";

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
    <PageShell wide>
      <header className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Autonomous Payment Reliability Engineer
        </span>
        <h1 className="text-2xl font-semibold leading-8 tracking-tight text-foreground">
          PayChaos AI
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Test payment integrations before failures reach production. Break the
          integration deliberately, detect money-invariant violations
          deterministically, then prove the fix.
        </p>
      </header>

      {model === null ? (
        <Card tone="danger" data-testid="overview-unavailable">
          <p className="text-sm font-medium text-card-foreground">
            Reliability evidence unavailable.
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            No score or readiness verdict is shown because the required evidence
            could not be read. This is a read failure, not a healthy
            integration.
          </p>
        </Card>
      ) : (
        <>
          {/* The decision leads the page. */}
          <div data-testid="overview-readiness">
            <ReadinessDecision
              readiness={model.readiness}
              score={model.reliability.score.score}
              statusTestId="overview-readiness-status"
            />
          </div>

          <Section
            title="Required P0 scenarios"
            description="The four mandatory payment-failure scenarios that gate go-live."
            actions={
              <span
                className="text-xs text-muted-foreground"
                data-testid="overview-scenarios-passing"
              >
                {passing} of {breakdown.length} passing
              </span>
            }
          >
            <ScenarioMatrix breakdown={breakdown} />
            <p
              className="text-xs text-muted-foreground"
              data-testid="overview-score"
            >
              {model.reliability.score.algorithmVersion} ·{" "}
              {model.reliability.score.score} / 100 · deterministic,
              recalculated from persisted evidence on every load.
            </p>
          </Section>
        </>
      )}

      <Section
        title="What to investigate first"
        actions={
          <Link
            href="/findings"
            className="text-xs underline underline-offset-4 hover:no-underline"
          >
            All findings →
          </Link>
        }
      >
        {findings === null ? (
          <Card tone="danger" data-testid="overview-findings-unavailable">
            <p className="text-sm leading-6 text-muted-foreground">
              The findings could not be read. This is a read failure — not
              confirmation that there are none.
            </p>
          </Card>
        ) : unresolvedHighRisk.length === 0 ? (
          <Card data-testid="overview-findings-clear">
            <p className="text-sm leading-6 text-muted-foreground">
              No unresolved critical or high finding is currently recorded.
            </p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="overview-findings">
            {unresolvedHighRisk.slice(0, 5).map((row) => (
              <li
                key={row.findingId}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 hover:bg-accent/30"
              >
                <SeverityBadge severity={row.severity} />
                <Link
                  href={`/chaos/findings/invariant-results/${row.invariantResultId}`}
                  className="min-w-0 flex-1 text-sm underline underline-offset-4 hover:no-underline"
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
      </Section>

      <div className="flex flex-wrap gap-3 border-t border-border pt-6">
        <Link
          href="/chaos"
          className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="overview-open-chaos"
        >
          Open Chaos Lab
        </Link>
        <Link
          href="/reliability"
          className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Reliability detail
        </Link>
      </div>
    </PageShell>
  );
}
