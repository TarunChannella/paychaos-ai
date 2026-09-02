import Link from "next/link";
import { notFound } from "next/navigation";

import { FindingCasefilePanel } from "@/components/findings/finding-casefile";
import { InvariantVerdict } from "@/components/findings/invariant-verdict";
import {
  Card,
  FieldLabel,
  Identifier,
  PageShell,
  Section,
} from "@/components/ui/page";
import { LifecycleBadge, SeverityBadge } from "@/components/ui/status";
import {
  getFindingCasefile,
  getRegressionComparison,
} from "@/lib/findings/casefile-read";
import { getFindingDetailByInvariantResultId } from "@/lib/findings/service";

import type {
  FindingCasefile,
  RegressionComparison,
} from "@/lib/findings/casefile-read";

/**
 * The Finding investigation screen — the most important surface in PayChaos.
 *
 * IT TELLS ONE STORY, IN ORDER:
 *   01 What broke      — the deterministic money-invariant verdict
 *   02 Verified evidence — the records that prove it
 *   03 Evidence-Based Diagnosis
 *   04 Recommended Fix
 *   05 Regression Proof
 *
 * The numbering is not decoration: before it, this page was six bordered
 * cards of identical weight, and a reader had no way to know which one was
 * the finding and which was commentary.
 *
 * IT CONSUMES THE FROZEN PHASE 3G READ MODEL AND NOTHING ELSE for evidence.
 * `getFindingDetailByInvariantResultId` already performs the finding →
 * invariant_result join and returns one safe object, so there is no second
 * join implementation that could drift from the authoritative one.
 *
 * WHY THE URL CARRIES AN invariantResultId. The frozen read model is keyed by
 * `invariant_result_id`, because that is what a Finding uniquely reports. A
 * route parameter named `findingId` that actually held an invariant result id
 * would be a small lie in the address bar, and this project has spent a lot of
 * effort not telling small lies about identifiers.
 *
 * THE CASEFILE IS OPTIONAL, THE EVIDENCE IS NOT. If the Phase 4 read fails,
 * this page still renders the authoritative expected/observed evidence and
 * omits the casefile — a diagnosis outage must never blank out a real
 * money-invariant failure.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Evidence-reference kinds render as a plain factual type label. */
const REF_LABELS: Record<string, string> = {
  ORDER: "Order",
  PAYMENT_ATTEMPT: "Payment attempt",
  PAYMENT: "Payment",
  FULFILMENT: "Fulfilment",
  WEBHOOK_EVENT: "Webhook event",
  EVENT_PROCESSING_ATTEMPT: "Processing attempt",
  CHAOS_RUN: "Chaos run",
};

export const dynamic = "force-dynamic";

export default async function FindingDetailPage({
  params,
}: {
  params: Promise<{ invariantResultId: string }>;
}) {
  const { invariantResultId } = await params;

  if (!UUID_PATTERN.test(invariantResultId)) {
    notFound();
  }

  // ONLY genuine absence becomes a 404.
  //
  // The frozen Phase 3G service distinguishes several failures, and they mean
  // very different things to an operator:
  //
  //   FINDING_NOT_FOUND        — no Finding exists for this invariant result.
  //                              A real 404.
  //   FINDING_READ_FAILED      — the database could not be read. The Finding
  //                              may well exist.
  //   FINDING_INTEGRITY_CONFLICT — the invariant result this Finding reports
  //                              could not be read. Something is wrong.
  //
  // Catching all three and rendering "not found" would tell an operator that a
  // reliability issue does not exist because a SELECT failed — the same
  // read-failure-is-not-emptiness rule the Round 1 read models already follow.
  // Anything that is not genuine absence is therefore re-thrown to Next's
  // normal server error handling, which shows a generic error page and never
  // renders the underlying message.
  let detail;
  try {
    detail = await getFindingDetailByInvariantResultId(invariantResultId);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "FINDING_NOT_FOUND"
    ) {
      notFound();
    }
    throw error;
  }

  // The Phase 4 casefile is additive. A failure here must not remove the
  // authoritative Phase 3 evidence below, so it degrades to "not shown".
  let casefile: FindingCasefile | null = null;
  let comparison: RegressionComparison | null = null;
  try {
    casefile = await getFindingCasefile(detail.findingId);
    if (casefile !== null) {
      comparison = await getRegressionComparison(
        detail.findingId,
        detail.invariantResultId,
      );
    }
  } catch {
    casefile = null;
    comparison = null;
  }

  return (
    <PageShell wide>
      {/* ---- HEADER ----------------------------------------------------- */}
      <div className="flex flex-col gap-3">
        <Link
          href={
            detail.correlations.chaosRunId === null
              ? "/findings"
              : `/chaos/runs/${detail.correlations.chaosRunId}`
          }
          className="w-fit text-xs text-muted-foreground underline-offset-4 hover:underline"
          data-testid="back-to-run"
        >
          ← Back to chaos run
        </Link>

        <div className="flex flex-wrap items-center gap-2.5">
          <SeverityBadge severity={detail.invariant.severity} />
          <LifecycleBadge status={detail.status} data-testid="finding-status" />
        </div>

        <h1
          className="text-2xl font-semibold leading-8 tracking-tight text-foreground"
          data-testid="finding-title"
        >
          {detail.title}
        </h1>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            Finding <Identifier value={detail.findingId} />
          </span>
          <span>Detected {detail.createdAt}</span>
        </div>
      </div>

      {/* ---- 01. WHAT BROKE --------------------------------------------- */}
      <Section
        step={1}
        title="What broke"
        description="A deterministic money invariant was evaluated against persisted evidence. This verdict is authoritative — nothing below it can change it."
        data-testid="finding-evidence"
      >
        <InvariantVerdict
          invariantId={detail.invariant.invariantId}
          severity={detail.invariant.severity}
          result="FAIL"
          expectedSummary={detail.invariant.expectedSummary}
          observedSummary={detail.invariant.observedSummary}
          reason={detail.invariant.reason}
          evaluatedAt={detail.invariant.evaluatedAt}
        />
      </Section>

      {/* ---- 02. VERIFIED EVIDENCE -------------------------------------- */}
      <Section
        step={2}
        title="Verified evidence"
        description="References to records that already exist. No payload, signature or customer data is stored or shown here."
        data-testid="finding-evidence-refs"
      >
        <Card>
          {detail.invariant.evidenceRefs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No evidence references were recorded for this evaluation.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {detail.invariant.evidenceRefs.map((ref) => (
                <li
                  key={`${ref.kind}-${ref.id}`}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2 first:pt-0 last:pb-0"
                >
                  <span className="text-sm text-card-foreground">
                    {REF_LABELS[ref.kind] ?? ref.kind}
                  </span>
                  <Identifier value={ref.id} />
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 border-t border-border pt-4">
            <FieldLabel>Correlations</FieldLabel>
            <dl className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
              {(
                [
                  ["Chaos run", detail.correlations.chaosRunId],
                  ["Order", detail.correlations.orderId],
                  ["Payment attempt", detail.correlations.paymentAttemptId],
                  ["Payment", detail.correlations.paymentId],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex flex-col gap-0.5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd>
                    {value === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Identifier value={value} />
                    )}
                  </dd>
                </div>
              ))}
            </dl>

            {detail.correlations.chaosRunId !== null && (
              <Link
                href={`/chaos/runs/${detail.correlations.chaosRunId}`}
                className="mt-4 inline-block text-xs underline underline-offset-4 hover:no-underline"
                data-testid="view-run-timeline"
              >
                View run evidence timeline →
              </Link>
            )}
          </div>
        </Card>
      </Section>

      {/* ---- 03 / 04 / 05 ----------------------------------------------- */}
      {casefile !== null && (
        <FindingCasefilePanel casefile={casefile} comparison={comparison} />
      )}
    </PageShell>
  );
}
