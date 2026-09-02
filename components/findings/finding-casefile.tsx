import { RegressionAction } from "@/components/findings/regression-action";
import { Card, FieldLabel, Identifier, Section } from "@/components/ui/page";
import {
  LifecycleBadge,
  ProvenanceTag,
  VerdictBadge,
} from "@/components/ui/status";

import type {
  FindingCasefile,
  RegressionComparison,
  RegressionComparisonRow,
} from "@/lib/findings/casefile-read";

/**
 * Phase 5 UI — the Phase 4 half of a Finding: diagnosis, recommended fix and
 * the regression before/after proof.
 *
 * PRESENTATION ONLY. Everything here was decided and persisted by Phases 4C,
 * 4D and 4E. No classification, no recommendation lookup, no regression
 * evaluation, no scoring.
 *
 * NO AI CLAIM. Phase 4H has not been implemented. The current classifier is
 * deterministic expert logic, so the heading is "Evidence-Based Diagnosis"
 * and the authority line says diagnosis explains evidence — it does not claim
 * a model produced it. Calling this "AI Diagnosis" today would be a false
 * statement about the implementation.
 *
 * ABSENCE IS RENDERED AS ABSENCE. An undiagnosed finding reads "Not yet
 * diagnosed", never an empty root-cause card and never a reassuring phrase.
 *
 * HISTORY IS NEVER REWRITTEN. The original failing evaluation stays visible
 * beside the regression outcome, explicitly labelled historical. "Fix
 * verified" comes only from a persisted RESOLVED status.
 */

function ResultRow({ row }: { readonly row: RegressionComparisonRow }) {
  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-bold text-card-foreground">
          {row.invariantId}
        </span>
        <VerdictBadge verdict={row.result} />
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          {row.severity}
        </span>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{row.reason}</p>
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
      {/* ---- 03. EVIDENCE-BASED DIAGNOSIS ------------------------------ */}
      <Section
        step={3}
        title="Evidence-Based Diagnosis"
        data-testid="finding-diagnosis"
      >
        <Card>
          {casefile.diagnosis === null ? (
            <p
              className="text-sm leading-6 text-muted-foreground"
              data-testid="finding-diagnosis-absent"
            >
              Not yet diagnosed. No root cause has been recorded for this
              finding — this is an absence of analysis, not a clean result.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <FieldLabel>Likely root cause</FieldLabel>
                <span
                  className="font-mono text-sm font-bold text-card-foreground"
                  data-testid="finding-diagnosis-code"
                >
                  {casefile.diagnosis.code}
                </span>
                <ProvenanceTag
                  label={casefile.diagnosis.strength.replace(/_/g, " ")}
                  data-testid="finding-diagnosis-strength"
                />
              </div>
              <p
                className="text-sm leading-6 text-card-foreground"
                data-testid="finding-diagnosis-summary"
              >
                {casefile.diagnosis.summary}
              </p>
            </div>
          )}

          <p
            className="mt-4 border-t border-border pt-3 text-xs leading-5 text-muted-foreground"
            data-testid="finding-diagnosis-boundary"
          >
            Payment truth and invariant results are deterministic. Diagnosis
            explains verified evidence and never determines payment state.
          </p>
        </Card>
      </Section>

      {/* ---- 04. RECOMMENDED FIX --------------------------------------- */}
      <Section
        step={4}
        title="Recommended Fix"
        data-testid="finding-recommendation"
      >
        <Card>
          {casefile.recommendation === null ? (
            <p
              className="text-sm leading-6 text-muted-foreground"
              data-testid="finding-recommendation-absent"
            >
              No recommendation has been recorded for this finding.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <span
                className="font-mono text-sm font-bold text-card-foreground"
                data-testid="finding-recommendation-code"
              >
                {casefile.recommendation.code}
              </span>
              <p
                className="text-sm leading-6 text-card-foreground"
                data-testid="finding-recommendation-text"
              >
                {casefile.recommendation.text}
              </p>
              <p className="border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
                PayChaos does not modify your code. This is a recommended change
                for your team to apply, then verify with a regression test.
              </p>
            </div>
          )}
        </Card>
      </Section>

      {/* ---- 05. REGRESSION PROOF -------------------------------------- */}
      <Section
        step={5}
        title="Regression Proof"
        description="PayChaos does not only find the failure. It re-runs the same scenario and records whether the fix actually held."
        data-testid="finding-regression"
      >
        <Card>
          {casefile.regressionRuns.length === 0 ? (
            <p
              className="text-sm leading-6 text-muted-foreground"
              data-testid="finding-regression-absent"
            >
              No regression test has been run for this finding yet.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <LifecycleBadge
                  status={casefile.regressionRuns[0]!.status}
                  data-testid="finding-regression-status"
                />
                <Identifier value={casefile.regressionRuns[0]!.id} />
              </div>

              {comparison === null ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  No comparable evidence has been persisted for this regression
                  yet.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-2">
                  <div className="bg-card p-4" data-testid="regression-before">
                    <div className="flex flex-wrap items-center gap-2">
                      <FieldLabel>Before fix</FieldLabel>
                      <ProvenanceTag label="Historical" />
                    </div>
                    <ul className="mt-3 flex flex-col gap-2">
                      {comparison.before === null ? (
                        <li className="text-xs text-muted-foreground">
                          The original evaluation could not be read.
                        </li>
                      ) : (
                        <ResultRow row={comparison.before} />
                      )}
                    </ul>
                  </div>

                  <div className="bg-card p-4" data-testid="regression-after">
                    <div className="flex flex-wrap items-center gap-2">
                      <FieldLabel>After fix — regression run</FieldLabel>
                    </div>
                    <ul className="mt-3 flex flex-col gap-2">
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

              <p className="text-xs leading-5 text-muted-foreground">
                The original failure is preserved. A regression adds new
                evidence beside it — it never rewrites a historical result.
              </p>
            </div>
          )}

          {/* P4-AC-06: a regression is startable from the finding itself. */}
          <RegressionAction
            findingId={casefile.findingId}
            activeRegressionRunId={activeRegressionRunId}
          />
        </Card>
      </Section>
    </>
  );
}
