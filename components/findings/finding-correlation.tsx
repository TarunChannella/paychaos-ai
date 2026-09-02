import { Card, FieldLabel } from "@/components/ui/page";

import { correlateFindings } from "@/lib/findings/grouping";

import type { GroupableFinding } from "@/lib/findings/grouping";

/**
 * Phase 4H-2 — deterministic finding correlation, rendered.
 *
 * PRESENTATION ONLY. The grouping is computed by the pure
 * `correlateFindings`, which counts exact matches on a persisted key. This
 * component adds no rule, no ordering and no arithmetic of its own.
 *
 * IT REFUSES TO SHOW A TREND IT CANNOT SUPPORT. Below the minimum row count
 * it renders exactly one honest sentence and nothing else. There is no chart,
 * no percentage, no sparkline and no "0 correlations found" — a dataset too
 * small to analyse is reported as such, not dressed up as a clean result.
 *
 * NO COUNTS THAT ARE NOT REAL. Every number shown is the literal size of a
 * group of findings that share a persisted value.
 */

const KEY_LABEL: Record<string, string> = {
  diagnosisCode: "Same root cause",
  invariantId: "Same invariant",
  scenarioId: "Same scenario",
};

export function FindingCorrelation({
  findings,
}: {
  readonly findings: readonly GroupableFinding[];
}) {
  const correlation = correlateFindings(findings);

  return (
    <Card data-testid="finding-correlation">
      <FieldLabel>Correlation</FieldLabel>

      {!correlation.sufficient ? (
        <p
          className="mt-2 text-sm leading-6 text-muted-foreground"
          data-testid="finding-correlation-insufficient"
        >
          Not enough diagnosed finding history for meaningful correlation.
        </p>
      ) : correlation.groups.length === 0 ? (
        <p
          className="mt-2 text-sm leading-6 text-muted-foreground"
          data-testid="finding-correlation-none"
        >
          No two findings currently share a root cause, invariant or scenario.
        </p>
      ) : (
        <ul
          className="mt-3 flex flex-col gap-2"
          data-testid="finding-correlation-groups"
        >
          {correlation.groups.map((group) => (
            <li
              key={`${group.key}-${group.value}`}
              className="flex flex-wrap items-baseline gap-2 text-sm"
            >
              <span className="text-muted-foreground">
                {KEY_LABEL[group.key] ?? group.key}
              </span>
              <span className="font-mono text-xs font-bold text-card-foreground">
                {group.value}
              </span>
              <span className="text-muted-foreground">
                — {group.count} findings
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
        Exact-match grouping over persisted findings. No clustering, no
        inference and no percentages — two findings are related here only if
        they literally share a recorded value.
      </p>
    </Card>
  );
}
