import { RegressionAction } from "@/components/findings/regression-action";
import { Badge } from "@/components/ui/badge";

import type {
  FindingCasefile,
  RegressionComparison,
  RegressionComparisonRow,
} from "@/lib/findings/casefile-read";

/**
 * Phase 5B — the Phase 4 half of a Finding: diagnosis, recommended fix and
 * regression before/after.
 *
 * PRESENTATION ONLY. Everything rendered here was decided and persisted by
 * Phases 4C, 4D and 4E. This component performs no classification, no
 * recommendation lookup, no regression evaluation and no scoring.
 *
 * ABSENCE IS RENDERED AS ABSENCE. A Finding with no diagnosis shows "Not yet
 * diagnosed", never an empty "Likely root cause" card and never a reassuring
 * phrase. An undiagnosed money-invariant failure is not a diagnosed-clean one.
 *
 * THE DETERMINISM BOUNDARY IS ALWAYS VISIBLE. The diagnosis panel states that
 * payment truth and invariant results are deterministic and that the
 * explanation is advisory. The current classifier is deterministic expert
 * logic, so nothing here implies a runtime model decided anything.
 *
 * THE ACTION IS AN ADAPTER. The regression control posts to the frozen Phase
 * 4E routes and re-reads this server-derived casefile; it decides nothing.
 *
 * HISTORY IS NEVER REWRITTEN. The original failing evaluation stays visible
 * beside the regression outcome. "FIX VERIFIED" appears only for a persisted
 * RESOLVED regression; every other lifecycle state is shown as itself.
 */

const STRENGTH_LABEL: Record<string, string> = {
  STRONG_EVIDENCE: "Strong evidence",
  PARTIAL_EVIDENCE: "Partial evidence",
  INSUFFICIENT_EVIDENCE: "Insufficient evidence",
};

const STRENGTH_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  STRONG_EVIDENCE: "default",
  PARTIAL_EVIDENCE: "secondary",
  INSUFFICIENT_EVIDENCE: "outline",
};

/** Amber-family states never borrow the green of a pass. */
const REGRESSION_LABEL: Record<string, string> = {
  PENDING: "Pending",
  RUNNING: "Running",
  RESOLVED: "Fix verified",
  STILL_FAILING: "Still failing",
  ERROR: "Error",
};

const REGRESSION_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  PENDING: "outline",
  RUNNING: "secondary",
  RESOLVED: "default",
  STILL_FAILING: "destructive",
  ERROR: "destructive",
};

const RESULT_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  PASS: "default",
  FAIL: "destructive",
  UNKNOWN: "outline",
};

function ResultRow({ row }: { readonly row: RegressionComparisonRow }) {
  return (
    <li className="flex flex-col gap-1 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold text-card-foreground">
          {row.invariantId}
        </span>
        <Badge
          variant={RESULT_VARIANT[row.result] ?? "outline"}
          className="text-xs"
        >
          {row.result}
        </Badge>
        <span className="text-xs text-muted-foreground">{row.severity}</span>
      </div>
      <p className="text-xs text-muted-foreground">{row.reason}</p>
    </li>
  );
}

export function FindingCasefilePanel({
  casefile,
  comparison,
}: {
  readonly casefile: FindingCasefile;
  readonly comparison: RegressionComparison | null;
}) {
  // ACTIVE means the persisted lifecycle is still open. Only PENDING and
  // RUNNING are active (Phase 4E `ACTIVE_REGRESSION_STATUSES`); a terminal
  // attempt must not suppress starting a new one.
  const latest = casefile.regressionRuns[0];
  const activeRegressionRunId =
    latest !== undefined &&
    (latest.status === "PENDING" || latest.status === "RUNNING")
      ? latest.id
      : null;

  return (
    <>
      {/* ---------------------------------------------------------------- */}
      <section
        className="rounded-lg border border-border bg-card p-5"
        data-testid="finding-diagnosis"
      >
        <h2 className="text-sm font-semibold text-card-foreground">
          Evidence-Based Diagnosis
        </h2>

        {casefile.diagnosis === null ? (
          <p
            className="mt-3 text-sm text-muted-foreground"
            data-testid="finding-diagnosis-absent"
          >
            Not yet diagnosed. No root cause has been recorded for this finding
            — this is an absence of analysis, not a clean result.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="font-mono text-xs font-semibold text-card-foreground"
                data-testid="finding-diagnosis-code"
              >
                {casefile.diagnosis.code}
              </span>
              <Badge
                variant={
                  STRENGTH_VARIANT[casefile.diagnosis.strength] ?? "outline"
                }
                className="text-xs"
                data-testid="finding-diagnosis-strength"
              >
                {STRENGTH_LABEL[casefile.diagnosis.strength] ??
                  casefile.diagnosis.strength}
              </Badge>
            </div>
            <p
              className="text-sm text-card-foreground"
              data-testid="finding-diagnosis-summary"
            >
              {casefile.diagnosis.summary}
            </p>
          </div>
        )}

        <p
          className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground"
          data-testid="finding-diagnosis-boundary"
        >
          Payment truth and invariant results are deterministic. AI explains
          verified evidence.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section
        className="rounded-lg border border-border bg-card p-5"
        data-testid="finding-recommendation"
      >
        <h2 className="text-sm font-semibold text-card-foreground">
          Recommended Fix
        </h2>

        {casefile.recommendation === null ? (
          <p
            className="mt-3 text-sm text-muted-foreground"
            data-testid="finding-recommendation-absent"
          >
            No recommendation has been recorded for this finding.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <span
              className="font-mono text-xs font-semibold text-card-foreground"
              data-testid="finding-recommendation-code"
            >
              {casefile.recommendation.code}
            </span>
            <p
              className="text-sm text-card-foreground"
              data-testid="finding-recommendation-text"
            >
              {casefile.recommendation.text}
            </p>
            <p className="text-xs text-muted-foreground">
              PayChaos does not modify your code. This is a recommended change
              for your team to apply, then verify with a regression test.
            </p>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section
        className="rounded-lg border border-border bg-card p-5"
        data-testid="finding-regression"
      >
        {/* P4-AC-06: a regression is startable from the finding itself. */}
        <h2 className="text-sm font-semibold text-card-foreground">
          Regression — Before vs After
        </h2>

        {casefile.regressionRuns.length === 0 ? (
          <p
            className="mt-3 text-sm text-muted-foreground"
            data-testid="finding-regression-absent"
          >
            No regression test has been run for this finding yet.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  REGRESSION_VARIANT[casefile.regressionRuns[0]!.status] ??
                  "outline"
                }
                data-testid="finding-regression-status"
              >
                {REGRESSION_LABEL[casefile.regressionRuns[0]!.status] ??
                  casefile.regressionRuns[0]!.status}
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">
                {casefile.regressionRuns[0]!.id}
              </span>
            </div>

            {comparison === null ? (
              <p className="text-xs text-muted-foreground">
                No comparable evidence has been persisted for this regression
                yet.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div data-testid="regression-before">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Before — original failure
                  </h3>
                  <ul className="mt-2 flex flex-col gap-2">
                    {comparison.before === null ? (
                      <li className="text-xs text-muted-foreground">
                        The original evaluation could not be read.
                      </li>
                    ) : (
                      <ResultRow row={comparison.before} />
                    )}
                  </ul>
                </div>

                <div data-testid="regression-after">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    After — regression run
                  </h3>
                  <ul className="mt-2 flex flex-col gap-2">
                    {comparison.after.length === 0 ? (
                      <li className="text-xs text-muted-foreground">
                        The regression has not persisted an evaluation yet.
                      </li>
                    ) : (
                      comparison.after.map((row) => (
                        <ResultRow key={row.invariantResultId} row={row} />
                      ))
                    )}
                  </ul>
                </div>
              </div>
            )}

            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              The original failure is preserved. A regression adds new evidence
              beside it — it never rewrites a historical result.
            </p>
          </div>
        )}

        <RegressionAction
          findingId={casefile.findingId}
          activeRegressionRunId={activeRegressionRunId}
        />
      </section>
    </>
  );
}
