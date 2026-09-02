import Link from "next/link";

import { FindingCorrelation } from "@/components/findings/finding-correlation";
import { Card, PageShell, PageHeader } from "@/components/ui/page";
import { LifecycleBadge, SeverityBadge } from "@/components/ui/status";
import { listFindings } from "@/lib/findings/list-read";

import type { FindingListRow } from "@/lib/findings/list-read";

/**
 * Phase 5B — the Findings index.
 *
 * SERVER COMPONENT, ALWAYS FRESH. A cached list of open money-invariant
 * failures would be a stale answer to the one question this page exists to
 * answer.
 *
 * READ FAILURE IS NOT AN EMPTY LIST. If the query fails this page says so.
 * "No findings" is a claim that the merchant's integration currently holds no
 * unresolved failure; saying it because a SELECT failed would be a false
 * statement about someone's payment reliability.
 *
 * NO COUNTS THAT ARE NOT REAL. The severity tallies below are computed from
 * the rows actually rendered, so they cannot disagree with the table.
 */
export const dynamic = "force-dynamic";

export default async function FindingsPage() {
  let rows: readonly FindingListRow[] | null = null;
  try {
    rows = await listFindings();
  } catch {
    rows = null;
  }

  const criticalOrHigh =
    rows?.filter(
      (row) =>
        (row.severity === "CRITICAL" || row.severity === "HIGH") &&
        row.status !== "RESOLVED",
    ).length ?? 0;

  return (
    <PageShell wide>
      <PageHeader
        eyebrow="Detect"
        title="Findings"
        lede="Every deterministic money-invariant failure PayChaos has detected, most severe first. A finding is created only from a persisted invariant evaluation — never from a model, a heuristic or a guess."
        actions={
          rows !== null && rows.length > 0 ? (
            <span
              className="text-xs text-muted-foreground"
              data-testid="findings-summary"
            >
              {rows.length} finding{rows.length === 1 ? "" : "s"}
              {criticalOrHigh > 0 && (
                <span
                  className="ml-2 font-semibold text-destructive"
                  data-testid="findings-critical-count"
                >
                  {criticalOrHigh} unresolved critical / high
                </span>
              )}
            </span>
          ) : undefined
        }
      />

      {rows === null ? (
        <Card tone="danger" data-testid="findings-unavailable">
          <p className="text-sm font-medium text-card-foreground">
            Findings unavailable.
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The findings could not be read. This is a read failure, not an
            absence of findings — nothing is shown rather than something
            misleading.
          </p>
        </Card>
      ) : rows.length === 0 ? (
        <Card data-testid="findings-empty">
          <p className="text-sm font-medium text-card-foreground">
            No findings recorded.
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            No chaos run has produced a money-invariant failure yet. Run a
            scenario from the Chaos Lab to exercise the merchant.
          </p>
          <Link
            href="/chaos"
            className="mt-4 inline-block text-sm underline underline-offset-4 hover:no-underline"
          >
            Open Chaos Lab →
          </Link>
        </Card>
      ) : (
        <>
          {/* 4H-2: exact-match correlation over the rows already loaded
              above. No extra query, no new API. */}
          <FindingCorrelation
            findings={rows.map((row) => ({
              findingId: row.findingId,
              diagnosisCode: row.diagnosisCode,
              invariantId: row.invariantId,
              scenarioId: row.scenarioId,
            }))}
          />

          {/*
            ONE LIST, TWO SHAPES. This is deliberately not a <table> with a
            second card layout beside it: duplicating rows would put every
            `finding-row-*` id in the DOM twice and squeeze a six-column table
            into 375px. The same <li> is a stacked card on a phone and a
            grid row on a laptop, so a finding is never unreadable and never
            rendered twice.
          */}
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_8px_30px_rgb(15_23_42/0.055)]">
            {/* Column headings belong to the desktop grid only. */}
            <div
              aria-hidden="true"
              className="hidden border-b border-border bg-muted/50 px-4 py-2.5 md:grid md:grid-cols-[7rem_minmax(0,1fr)_6rem_7rem_8rem_9rem] md:gap-4"
            >
              {[
                "Severity",
                "Finding",
                "Scenario",
                "Invariant",
                "Status",
                "Regression",
              ].map((heading) => (
                <span
                  key={heading}
                  className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground"
                >
                  {heading}
                </span>
              ))}
            </div>

            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <li
                  key={row.findingId}
                  className="px-4 py-4 transition-colors hover:bg-accent/40 md:grid md:grid-cols-[7rem_minmax(0,1fr)_6rem_7rem_8rem_9rem] md:items-start md:gap-4 md:py-3"
                  data-testid={`finding-row-${row.findingId}`}
                >
                  {/* On mobile the two badges sit together above the title,
                      which is how someone triaging actually reads a list. */}
                  <div className="flex flex-wrap items-center gap-2 md:block">
                    <SeverityBadge severity={row.severity} />
                    <span className="md:hidden">
                      <LifecycleBadge status={row.status} />
                    </span>
                  </div>

                  <div className="mt-2 min-w-0 md:mt-0">
                    <Link
                      href={`/chaos/findings/invariant-results/${row.invariantResultId}`}
                      className="text-[14.5px] font-medium leading-5 text-card-foreground underline-offset-4 hover:underline"
                    >
                      {row.title}
                    </Link>
                    <div className="mt-1 font-mono text-[11px] text-subtle-foreground">
                      Detected {row.detectedAt}
                    </div>
                  </div>

                  {/* Below the title on mobile, these read as labelled facts
                      rather than as orphaned table cells. */}
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 md:contents">
                    <span className="font-mono text-xs text-muted-foreground">
                      <span className="text-subtle-foreground md:hidden">
                        Scenario{" "}
                      </span>
                      {row.scenarioId ?? "—"}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      <span className="text-subtle-foreground md:hidden">
                        Invariant{" "}
                      </span>
                      {row.invariantId}
                    </span>

                    <span className="hidden md:block">
                      <LifecycleBadge status={row.status} />
                    </span>

                    <span className="flex items-center gap-1.5">
                      <span className="text-[11px] text-subtle-foreground md:hidden">
                        Regression
                      </span>
                      {row.regressionStatus === null ? (
                        <span className="text-xs text-muted-foreground">
                          Not re-tested
                        </span>
                      ) : (
                        <LifecycleBadge status={row.regressionStatus} />
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </PageShell>
  );
}
