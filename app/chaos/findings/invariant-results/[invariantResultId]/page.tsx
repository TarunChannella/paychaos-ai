import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { getFindingDetailByInvariantResultId } from "@/lib/findings/service";

/**
 * Phase 3H Round 2B — the inspectable Finding evidence screen.
 *
 * IT CONSUMES THE FROZEN PHASE 3G READ MODEL AND NOTHING ELSE.
 * `getFindingDetailByInvariantResultId` already performs the finding →
 * invariant_result join and returns one safe object. This page renders that
 * object. It issues no query of its own, so there is no second join
 * implementation that could drift from the authoritative one.
 *
 * WHY THE URL CARRIES AN invariantResultId. The frozen read model is keyed by
 * `invariant_result_id`, because that is what a Finding uniquely reports. A
 * route parameter named `findingId` that actually held an invariant result id
 * would be a small lie in the address bar, and this project has spent a lot of
 * effort not telling small lies about identifiers.
 *
 * NOTHING IS COPIED. Severity, expected, observed, reason and evidence
 * references are read live from the immutable invariant result through the
 * join — never from a duplicate stored on the finding.
 *
 * NO PHASE 4 SURFACE. Diagnosis, root cause, recommendation, regression,
 * reliability score and go-live readiness are absent — not blank, not
 * placeholder cards, absent. Those columns exist in the database and are NULL
 * after Phase 3G; rendering an empty "Likely root cause" panel would imply the
 * product has an opinion it has not formed.
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

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-16">
      <Link
        href={
          detail.correlations.chaosRunId !== null
            ? `/chaos/runs/${detail.correlations.chaosRunId}`
            : "/chaos"
        }
        className="text-xs text-muted-foreground hover:underline"
        data-testid="back-to-run"
      >
        ← Back to chaos run
      </Link>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" data-testid="finding-status">
            {detail.status}
          </Badge>
          <Badge variant="outline">{detail.invariant.severity}</Badge>
          <span className="font-mono text-xs text-muted-foreground">
            {detail.invariant.invariantId}
          </span>
        </div>
        <h1
          className="text-2xl font-semibold tracking-tight text-foreground"
          data-testid="finding-title"
        >
          {detail.title}
        </h1>
        <p className="font-mono text-xs text-muted-foreground">
          Finding {detail.findingId}
        </p>
      </header>

      {/* FACT / EVIDENCE — everything below is a persisted deterministic
          verdict, not an inference (CLAUDE.md Section 12). */}
      <section
        className="rounded-lg border border-border bg-card p-5"
        data-testid="finding-evidence"
      >
        <h2 className="text-sm font-semibold text-card-foreground">
          Deterministic invariant evidence
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Read from the persisted invariant result. Nothing here is inferred.
        </p>

        <dl className="mt-4 flex flex-col gap-4 text-xs">
          <div>
            <dt className="text-muted-foreground">Expected</dt>
            <dd className="text-card-foreground" data-testid="finding-expected">
              {detail.invariant.expectedSummary}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Observed</dt>
            <dd className="text-card-foreground" data-testid="finding-observed">
              {detail.invariant.observedSummary}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Reason</dt>
            <dd className="text-card-foreground" data-testid="finding-reason">
              {detail.invariant.reason}
            </dd>
          </div>
        </dl>

        <dl className="mt-4 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Invariant version</dt>
            <dd className="text-card-foreground">
              {detail.invariant.invariantVersion}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Evaluated at</dt>
            <dd className="font-mono text-card-foreground">
              {detail.invariant.evaluatedAt}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Finding created</dt>
            <dd className="font-mono text-card-foreground">
              {detail.createdAt}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Invariant result</dt>
            <dd className="font-mono text-card-foreground">
              {detail.invariantResultId}
            </dd>
          </div>
        </dl>
      </section>

      <section
        className="rounded-lg border border-border bg-card p-5"
        data-testid="finding-evidence-refs"
      >
        <h2 className="text-sm font-semibold text-card-foreground">
          Evidence references
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          References to records that already exist. No payload, signature or
          customer data is stored or shown here.
        </p>

        {detail.invariant.evidenceRefs.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            This evaluation recorded no evidence references.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {detail.invariant.evidenceRefs.map((ref) => (
              <li
                key={`${ref.kind}:${ref.id}`}
                className="flex flex-wrap items-center gap-2 text-xs"
              >
                <Badge variant="outline">
                  {REF_LABELS[ref.kind] ?? ref.kind}
                </Badge>
                <span className="font-mono text-muted-foreground">
                  {ref.id}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-card-foreground">
          Correlations
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          {(
            [
              ["Chaos run", detail.correlations.chaosRunId],
              ["Order", detail.correlations.orderId],
              ["Payment attempt", detail.correlations.paymentAttemptId],
              ["Payment", detail.correlations.paymentId],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-mono text-card-foreground">{value ?? "—"}</dd>
            </div>
          ))}
        </dl>

        {detail.correlations.chaosRunId !== null && (
          <Link
            href={`/chaos/runs/${detail.correlations.chaosRunId}`}
            className="mt-4 inline-block text-xs underline hover:no-underline"
            data-testid="view-run-timeline"
          >
            View run evidence timeline →
          </Link>
        )}
      </section>
    </div>
  );
}
