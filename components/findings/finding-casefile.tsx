import { DiagnoseAction } from "@/components/findings/diagnose-action";
import { RegressionAction } from "@/components/findings/regression-action";
import { Card, FieldLabel, Identifier, Section } from "@/components/ui/page";
import {
  LifecycleBadge,
  ProvenanceTag,
  VerdictBadge,
} from "@/components/ui/status";

import {
  buildExplanation,
  buildRegressionGuidance,
} from "@/lib/diagnosis/explanation-templates";

import type { EvidenceStrength } from "@/lib/diagnosis/explanation-templates";
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
 * THE AUTHORITY BOUNDARY IS PERMANENT. The approved statement is that payment
 * truth and invariant results are DETERMINISTIC and that the intelligence
 * layer only EXPLAINS verified evidence — it never determines payment state.
 * That is a statement about authority, not about implementation: it holds
 * whether the explanation comes from today's deterministic rules or from a
 * later model.
 *
 * NO FALSE MODEL CLAIM. Phase 4H ships no runtime LLM, so the heading stays
 * "Evidence-Based Diagnosis" and no surface labels the current rules "AI
 * Diagnosis", "AI Reasoning", "Agent Reasoning" or "AI Root Cause".
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
  invariantId,
  scenarioId,
}: {
  readonly casefile: FindingCasefile;
  readonly comparison: RegressionComparison | null;
  readonly invariantId: string;
  readonly scenarioId: string | null;
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

              {/* 4H-1: deterministic explanation, composed only from the
                  persisted code, strength and invariant. */}
              {(() => {
                const explanation = buildExplanation({
                  diagnosisCode: casefile.diagnosis.code,
                  strength: casefile.diagnosis.strength as EvidenceStrength,
                  diagnosisSummary: casefile.diagnosis.summary,
                  invariantId,
                  scenarioId,
                  recommendationCode: casefile.recommendation?.code ?? null,
                });
                return (
                  <dl
                    className="flex flex-col gap-2.5 border-t border-border pt-3"
                    data-testid="finding-explanation"
                  >
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        What this means
                      </dt>
                      <dd className="mt-0.5 text-sm leading-6 text-card-foreground">
                        {explanation.impactStatement}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Evidence strength
                      </dt>
                      <dd className="mt-0.5 text-sm leading-6 text-muted-foreground">
                        {explanation.confidenceStatement}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Limitations
                      </dt>
                      <dd className="mt-0.5 text-sm leading-6 text-muted-foreground">
                        {explanation.limitationStatement}
                      </dd>
                    </div>
                  </dl>
                );
              })()}
            </div>
          )}

          <div className="mt-4 border-t border-border pt-3">
            <DiagnoseAction
              findingId={casefile.findingId}
              alreadyDiagnosed={casefile.diagnosis !== null}
            />
          </div>

          <p
            className="mt-4 border-t border-border pt-3 text-xs leading-5 text-muted-foreground"
            data-testid="finding-diagnosis-boundary"
          >
            Payment truth and invariant results are deterministic. AI explains
            verified evidence. Diagnosis never determines payment state.
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

          {/* 4H-3: developer-facing guidance, composed from the persisted
              invariant, scenario and recommendation. Text only — it never
              generates or executes code, and the Phase 4E engine remains the
              only thing that can decide a regression verdict. */}
          {(() => {
            const guidance = buildRegressionGuidance({
              invariantId,
              scenarioId,
              recommendationCode: casefile.recommendation?.code ?? null,
            });
            return (
              <dl
                className="mt-1 flex flex-col gap-2 rounded-md border border-dashed border-border p-4"
                data-testid="regression-guidance"
              >
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    What a passing regression proves
                  </dt>
                  <dd className="mt-0.5 text-xs leading-5 text-card-foreground">
                    {guidance.objective}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Invariant to prove
                  </dt>
                  <dd className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    {guidance.invariantToProve}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Behaviour to eliminate
                  </dt>
                  <dd className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    {guidance.behaviourToEliminate}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Expected final state
                  </dt>
                  <dd className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    {guidance.expectedFinalState}
                  </dd>
                </div>
              </dl>
            );
          })()}

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
