import Link from "next/link";
import { notFound } from "next/navigation";

import { EvidenceRail } from "@/components/chaos/evidence-rail";
import { ProvenanceBadge } from "@/components/chaos/provenance-badge";
import { Badge } from "@/components/ui/badge";
import { getChaosRunDetail } from "@/lib/chaos/run-read-model";
import { assembleChaosRunEvidence } from "@/lib/evidence/chaos-evidence-service";
import { buildEvidenceTimeline } from "@/lib/evidence/timeline-model";
import type { FindingSummary } from "@/lib/findings/run-findings-read";

import { RunActions } from "./run-actions";

/**
 * Phase 3H — chaos run detail: status, invariant results, evidence timeline
 * and findings (docs/PHASE_PLAN.md Section 7.13).
 *
 * FACT/EVIDENCE ONLY (CLAUDE.md Section 12). Everything on this screen is a
 * projection of a persisted row. This page evaluates nothing, re-runs nothing
 * and infers nothing — there is no diagnosis or recommendation surface here,
 * because Phase 4 owns those and inventing one would be a fabricated claim.
 */
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stamp(iso: string | null): string {
  return iso ?? "—";
}

/** PASS/FAIL/UNKNOWN each get their own treatment; UNKNOWN is never upgraded. */
function resultVariant(
  result: "PASS" | "FAIL" | "UNKNOWN",
): "default" | "destructive" | "outline" {
  if (result === "FAIL") return "destructive";
  if (result === "PASS") return "default";
  return "outline";
}

export default async function ChaosRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;

  // Reject a malformed id before it reaches the database.
  if (!UUID_PATTERN.test(runId)) {
    notFound();
  }

  const detail = await getChaosRunDetail(runId);
  if (detail === null) {
    notFound();
  }

  // The evidence bundle can legitimately be absent for a run that never
  // executed. That is a factual state, not an error — the timeline section
  // says so rather than rendering an empty list that implies "nothing happened".
  const bundle = await assembleChaosRunEvidence(runId);
  const findings: FindingSummary[] = detail.invariantResults
    .map((result) => result.finding)
    .filter((finding): finding is FindingSummary => finding !== null);

  const timeline =
    bundle === null
      ? null
      : buildEvidenceTimeline(bundle, detail.invariantResults, findings);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-16">
      <Link
        href="/chaos"
        className="text-xs text-muted-foreground hover:underline"
      >
        ← Back to Chaos Lab
      </Link>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-lg font-semibold text-foreground">
            {detail.scenarioId}
          </span>
          <Badge variant="outline">{detail.status}</Badge>
          <ProvenanceBadge storedValue={detail.dataClassification} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Chaos run
        </h1>
        <p className="font-mono text-xs text-muted-foreground">{detail.id}</p>
      </header>

      {/* Controls are derived from the persisted row only — never from what
          the operator clicked a moment ago. C11's mechanism comes from the
          same correlation the frozen repository uses to separate A from B. */}
      <RunActions
        runId={detail.id}
        scenarioId={detail.scenarioId}
        status={detail.status}
        hasSourceWebhook={detail.correlations.sourceWebhookEventId !== null}
        hasOrder={detail.correlations.orderId !== null}
        isBlocked={detail.isBlocked}
        hasInvariantResults={detail.invariantResults.length > 0}
      />

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-card-foreground">
          Run state
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Outcome</dt>
            <dd className="text-card-foreground">
              {detail.outcome ?? "Not yet determined"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Fault type</dt>
            <dd className="text-card-foreground">{detail.faultType ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Started</dt>
            <dd className="text-card-foreground">{stamp(detail.startedAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Completed</dt>
            <dd className="text-card-foreground">
              {stamp(detail.completedAt)}
            </dd>
          </div>
        </dl>

        {detail.isBlocked && (
          <div
            className="mt-4 rounded-md border border-border p-3"
            data-testid="blocked-notice"
          >
            <p className="text-xs font-medium text-card-foreground">
              This run was blocked before it executed.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              A blocked run is a safety outcome, not a payment failure and not
              an invariant FAIL.
              {detail.failedPrecheckId
                ? ` Failed precheck: ${detail.failedPrecheckId}.`
                : ""}
              {detail.executionBlockCode
                ? ` Block code: ${detail.executionBlockCode}.`
                : ""}
            </p>
            {detail.errorMessageRedacted && (
              <p className="mt-1 text-xs text-muted-foreground">
                {detail.errorMessageRedacted}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">
          Invariant results
        </h2>

        {detail.invariantResults.length === 0 ? (
          <p
            className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground"
            data-testid="no-invariant-results"
          >
            No invariant has been evaluated for this run yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {detail.invariantResults.map((result) => (
              <li
                key={result.id}
                className="rounded-lg border border-border bg-card p-5"
                data-testid="invariant-result"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-card-foreground">
                    {result.invariantId}
                  </span>
                  <Badge variant={resultVariant(result.result)}>
                    {result.result}
                  </Badge>
                  <Badge variant="outline">{result.severity}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {result.invariantName ?? "Uncatalogued invariant"}
                  </span>
                </div>

                <dl className="mt-3 flex flex-col gap-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Expected</dt>
                    <dd className="text-card-foreground">
                      {result.expectedSummary}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Observed</dt>
                    <dd className="text-card-foreground">
                      {result.observedSummary}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Reason</dt>
                    <dd className="text-card-foreground">{result.reason}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Evaluated</dt>
                    <dd className="text-card-foreground">
                      {result.evaluatedAt}
                    </dd>
                  </div>
                </dl>

                {result.evidenceRefs.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs text-muted-foreground">Evidence</p>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {result.evidenceRefs.map((ref) => (
                        <li
                          key={`${ref.kind}:${ref.id}`}
                          className="font-mono text-xs text-muted-foreground"
                        >
                          {ref.kind} · {ref.id}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.finding !== null ? (
                  <div
                    className="mt-4 rounded-md border border-destructive/40 p-3"
                    data-testid="finding-detail"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-card-foreground">
                        Finding
                      </span>
                      <Badge variant="outline">{result.finding.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-card-foreground">
                      {result.finding.title}
                    </p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {result.finding.findingId} · created{" "}
                      {result.finding.createdAt}
                    </p>
                    <Link
                      href={`/chaos/findings/invariant-results/${result.id}`}
                      className="mt-2 inline-block text-xs underline hover:no-underline"
                      data-testid="inspect-finding"
                    >
                      Inspect Finding →
                    </Link>
                  </div>
                ) : (
                  result.result === "FAIL" && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      No Finding has been generated for this FAIL yet.
                    </p>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">
          Evidence timeline
        </h2>

        {timeline === null ? (
          <p
            className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground"
            data-testid="no-timeline"
          >
            No evidence bundle exists for this run. Nothing is inferred in its
            place.
          </p>
        ) : (
          <EvidenceRail timeline={timeline} />
        )}
      </section>
    </div>
  );
}
