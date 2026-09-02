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

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  {[
                    "Severity",
                    "Finding",
                    "Scenario",
                    "Invariant",
                    "Status",
                    "Regression",
                  ].map((heading) => (
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
                {rows.map((row) => (
                  <tr
                    key={row.findingId}
                    className="border-b border-border align-top last:border-0 hover:bg-accent/30"
                    data-testid={`finding-row-${row.findingId}`}
                  >
                    <td className="px-4 py-3">
                      <SeverityBadge severity={row.severity} />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/chaos/findings/invariant-results/${row.invariantResultId}`}
                        className="text-sm font-medium text-card-foreground underline-offset-4 hover:underline"
                      >
                        {row.title}
                      </Link>
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        Detected {row.detectedAt}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {row.scenarioId ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {row.invariantId}
                    </td>
                    <td className="px-4 py-3">
                      <LifecycleBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3">
                      {row.regressionStatus === null ? (
                        <span className="text-xs text-muted-foreground">
                          Not re-tested
                        </span>
                      ) : (
                        <LifecycleBadge status={row.regressionStatus} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </PageShell>
  );
}
