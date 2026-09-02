import Link from "next/link";

import { ProvenanceTag, VerdictBadge } from "@/components/ui/status";

import type { ReliabilityScenarioBreakdown } from "@/lib/reliability/types";

/**
 * Phase 5 UI — the four mandatory P0 scenarios as a reliability test suite.
 *
 * A SUITE, NOT A DASHBOARD. Four oversized cards read as decoration; dense
 * rows read as a test suite an engineer can scan. Each row states what
 * assumption the scenario tests, because "C07" means nothing to a reader who
 * has not memorised the catalogue.
 *
 * EVERY VALUE IS PERSISTED. State, deduction, selected run and provenance all
 * come from the frozen `RELIABILITY-V1` breakdown. Nothing is recomputed and
 * nothing is inferred — a scenario with no eligible run says exactly that.
 *
 * C03 IS NEVER DRESSED UP. Its provenance label comes from the engine, which
 * reports it as a controlled PayChaos simulation. This component cannot
 * override that, and the provenance tag is visually incapable of reading as a
 * verdict.
 */

/** What each mandatory scenario actually asserts, in one line. */
const ASSERTS: Record<
  string,
  { readonly name: string; readonly asserts: string }
> = {
  C01: {
    name: "Duplicate Webhook Delivery",
    asserts:
      "The same event delivered twice must not execute the effect twice.",
  },
  C03: {
    name: "Invalid Webhook Signature",
    asserts: "A forged signature must cause zero business mutation.",
  },
  C07: {
    name: "Payment Succeeds, Client Confirmation Lost",
    asserts:
      "A captured payment must still reconcile when the browser never returns.",
  },
  C11: {
    name: "Failed Payment Safety",
    asserts: "A failed payment must never mark an order paid.",
  },
};

export function ScenarioMatrix({
  breakdown,
  "data-testid": testId = "scenario-matrix",
}: {
  readonly breakdown: readonly ReliabilityScenarioBreakdown[];
  readonly "data-testid"?: string;
}) {
  return (
    <div
      className="overflow-x-auto rounded-lg border border-border"
      data-testid={testId}
    >
      <table className="w-full min-w-[44rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left">
            <th
              scope="col"
              className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Scenario
            </th>
            <th
              scope="col"
              className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Result
            </th>
            <th
              scope="col"
              className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Score impact
            </th>
            <th
              scope="col"
              className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Evidence
            </th>
          </tr>
        </thead>
        <tbody>
          {breakdown.map((entry) => {
            const meta = ASSERTS[entry.scenarioId];
            return (
              <tr
                key={entry.scenarioId}
                className="border-b border-border last:border-0 align-top hover:bg-accent/30"
                data-testid={`overview-scenario-${entry.scenarioId}`}
              >
                <td className="px-4 py-3">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs font-bold text-foreground">
                      {entry.scenarioId}
                    </span>
                    <span className="text-sm font-medium text-card-foreground">
                      {meta?.name ?? ""}
                    </span>
                  </div>
                  {meta !== undefined && (
                    <p className="mt-0.5 max-w-md text-xs leading-5 text-muted-foreground">
                      {meta.asserts}
                    </p>
                  )}
                </td>

                <td className="px-4 py-3">
                  <VerdictBadge
                    verdict={entry.state}
                    data-testid={`overview-state-${entry.scenarioId}`}
                  />
                </td>

                <td className="px-4 py-3 tabular-nums text-sm text-muted-foreground">
                  {entry.deduction === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    `−${entry.deduction}`
                  )}
                </td>

                <td className="px-4 py-3">
                  {entry.selectedRunId === null ? (
                    <span className="text-xs text-muted-foreground">
                      No eligible run
                    </span>
                  ) : (
                    <Link
                      href={`/chaos/runs/${entry.selectedRunId}`}
                      className="text-xs underline underline-offset-4 hover:no-underline"
                    >
                      View run
                    </Link>
                  )}
                  {entry.provenanceLabel !== null && (
                    <div className="mt-1">
                      <ProvenanceTag label={entry.provenanceLabel} />
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
