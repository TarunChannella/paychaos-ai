import { FieldLabel } from "@/components/ui/page";
import { SeverityBadge, VerdictBadge } from "@/components/ui/status";

/**
 * Phase 5 UI — the Money Invariant verdict.
 *
 * THE PRODUCT'S CENTRAL CLAIM, GIVEN ITS OWN TREATMENT. A money invariant is
 * the one thing PayChaos asserts with authority, so it is rendered as a
 * verdict block rather than as another row of key/value text.
 *
 * EXPECTED AND OBSERVED ARE VERBATIM. Both are the persisted summaries. They
 * are NOT parsed into "1" and "2": no deterministic numeric field exists
 * behind that prose, and inventing structure the backend never produced is
 * exactly the kind of fabrication this project refuses. The comparison is the
 * point; the shape of the values is whatever the engine actually recorded.
 *
 * AUTHORITY IS STATED. `DETERMINISTIC` is not decoration — it is the
 * distinction between this block and everything advisory below it on the
 * page.
 */
export function InvariantVerdict({
  invariantId,
  invariantName,
  severity,
  result,
  expectedSummary,
  observedSummary,
  reason,
  evaluatedAt,
}: {
  readonly invariantId: string;
  readonly invariantName?: string | null;
  readonly severity: string;
  readonly result: string;
  readonly expectedSummary: string;
  readonly observedSummary: string;
  readonly reason?: string | null;
  readonly evaluatedAt?: string | null;
}) {
  return (
    <div
      className="overflow-hidden rounded-lg border border-border bg-card"
      data-testid="invariant-verdict"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/40 px-5 py-3">
        <span
          className="font-mono text-sm font-bold tracking-tight text-foreground"
          data-testid="invariant-verdict-id"
        >
          {invariantId}
        </span>
        {invariantName != null && (
          <span className="min-w-0 flex-1 text-sm text-muted-foreground">
            {invariantName}
          </span>
        )}
        <SeverityBadge severity={severity} />
        <VerdictBadge verdict={result} data-testid="invariant-verdict-result" />
      </div>

      <div className="grid grid-cols-1 divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
        <div className="flex flex-col gap-1.5 p-5">
          <FieldLabel>Expected</FieldLabel>
          <p
            className="text-sm leading-6 text-card-foreground"
            data-testid="invariant-verdict-expected"
          >
            {expectedSummary}
          </p>
        </div>
        <div className="flex flex-col gap-1.5 p-5">
          <FieldLabel>Observed</FieldLabel>
          <p
            className="text-sm leading-6 text-card-foreground"
            data-testid="invariant-verdict-observed"
          >
            {observedSummary}
          </p>
        </div>
      </div>

      {reason != null && reason.length > 0 && (
        <div className="border-t border-border px-5 py-4">
          <FieldLabel>Reason</FieldLabel>
          <p
            className="mt-1.5 text-sm leading-6 text-muted-foreground"
            data-testid="invariant-verdict-reason"
          >
            {reason}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-5 py-2.5">
        <span
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground"
          data-testid="invariant-verdict-authority"
        >
          Authority
          <span className="rounded-sm border border-dashed border-border px-1.5 py-0.5 font-semibold text-foreground">
            Deterministic
          </span>
        </span>
        {evaluatedAt != null && (
          <span className="font-mono text-[11px] text-muted-foreground">
            Evaluated {evaluatedAt}
          </span>
        )}
      </div>
    </div>
  );
}
