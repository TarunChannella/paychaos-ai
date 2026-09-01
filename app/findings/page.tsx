import Link from "next/link";

import { Badge } from "@/components/ui/badge";
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

const SEVERITY_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  CRITICAL: "destructive",
  HIGH: "destructive",
  MEDIUM: "secondary",
  LOW: "outline",
};

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  OPEN: "destructive",
  STILL_FAILING: "destructive",
  RESOLVED: "default",
};

const REGRESSION_LABEL: Record<string, string> = {
  PENDING: "Pending",
  RUNNING: "Running",
  RESOLVED: "Fix verified",
  STILL_FAILING: "Still failing",
  ERROR: "Error",
};

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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Findings
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every deterministic money-invariant failure PayChaos has detected,
          most severe first. A finding is created only from a persisted
          invariant evaluation — never from a model, a heuristic or a guess.
        </p>
      </header>

      {rows === null ? (
        <section
          className="rounded-lg border border-destructive/40 bg-card p-6"
          data-testid="findings-unavailable"
        >
          <p className="text-sm font-medium text-card-foreground">
            Findings unavailable.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            The findings could not be read. This is a read failure, not an
            absence of findings — nothing is shown rather than something
            misleading.
          </p>
        </section>
      ) : rows.length === 0 ? (
        <section
          className="rounded-lg border border-border bg-card p-6"
          data-testid="findings-empty"
        >
          <p className="text-sm font-medium text-card-foreground">
            No findings recorded.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            No chaos run has produced a money-invariant failure yet. Run a
            scenario from the Chaos Lab to exercise the merchant.
          </p>
          <Link
            href="/chaos"
            className="mt-4 inline-block text-sm underline hover:no-underline"
          >
            Open Chaos Lab →
          </Link>
        </section>
      ) : (
        <>
          <div
            className="flex flex-wrap items-center gap-3 text-sm"
            data-testid="findings-summary"
          >
            <span className="text-muted-foreground">
              {rows.length} finding{rows.length === 1 ? "" : "s"}
            </span>
            {criticalOrHigh > 0 && (
              <Badge
                variant="destructive"
                data-testid="findings-critical-count"
              >
                {criticalOrHigh} unresolved critical / high
              </Badge>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Severity
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Finding
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Scenario
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Invariant
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Regression
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.findingId}
                    className="border-b border-border last:border-0 hover:bg-accent/40"
                    data-testid={`finding-row-${row.findingId}`}
                  >
                    <td className="px-4 py-3 align-top">
                      <Badge
                        variant={SEVERITY_VARIANT[row.severity] ?? "outline"}
                        className="text-xs"
                      >
                        {row.severity}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Link
                        href={`/chaos/findings/invariant-results/${row.invariantResultId}`}
                        className="underline hover:no-underline"
                      >
                        {row.title}
                      </Link>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Detected {row.detectedAt}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top font-mono text-xs">
                      {row.scenarioId ?? "—"}
                    </td>
                    <td className="px-4 py-3 align-top font-mono text-xs">
                      {row.invariantId}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Badge
                        variant={STATUS_VARIANT[row.status] ?? "outline"}
                        className="text-xs"
                      >
                        {row.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                      {row.regressionStatus === null
                        ? "Not re-tested"
                        : (REGRESSION_LABEL[row.regressionStatus] ??
                          row.regressionStatus)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
