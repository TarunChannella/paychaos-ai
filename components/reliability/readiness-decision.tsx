import Link from "next/link";

import { Card, FieldLabel } from "@/components/ui/page";
import { DecisionStatus } from "@/components/ui/status";

import type { GoLiveReadinessV1 } from "@/lib/readiness/types";

/**
 * Phase 5 UI — the go-live decision, as a decision.
 *
 * WHY THIS EXISTS. Readiness was previously a small badge sitting beside the
 * score, which made the single most consequential statement in the product
 * look like a tag. This gives it the weight it earns and, crucially, always
 * shows WHY: a verdict with no visible reasoning is exactly what this project
 * refuses to ship.
 *
 * IT DECIDES NOTHING. The status, every reason and their precedence were all
 * settled by the frozen `GO-LIVE-READINESS-V1` evaluator. This renders them.
 *
 * BLOCKING BEATS ATTENTION, VISIBLY. Blocking reasons are listed first and
 * marked as blocking, because that is the precedence the engine applies.
 *
 * NOT A CERTIFICATION. The frozen disclaimer is rendered from the model, so
 * no screen can paraphrase it into something weaker.
 */
export function ReadinessDecision({
  readiness,
  score,
  href = "/reliability",
  statusTestId = "readiness-decision-status",
}: {
  readonly readiness: GoLiveReadinessV1;
  readonly score: number;
  readonly href?: string;
  /**
   * The status testid. Defaulted rather than hard-coded because the
   * Reliability page renders BOTH this panel and the frozen gate checklist,
   * and two elements sharing `readiness-status` would make every strict
   * locator ambiguous.
   */
  readonly statusTestId?: string;
}) {
  const { status, blockingReasons, attentionReasons } = readiness;

  // The first thing an operator should act on, chosen by the engine's own
  // precedence rather than by this component.
  const primary = blockingReasons[0] ?? attentionReasons[0] ?? null;

  return (
    <Card
      tone={status === "NOT READY" ? "danger" : "default"}
      className="flex flex-col gap-6"
      data-testid="readiness-decision"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2.5">
          <FieldLabel>Go-Live Readiness</FieldLabel>
          <DecisionStatus status={status} data-testid={statusTestId} />
        </div>

        <div className="flex flex-col items-end gap-1">
          <FieldLabel>Reliability Score</FieldLabel>
          <span
            className="text-5xl font-semibold leading-none tabular-nums tracking-[-0.03em] text-foreground"
            data-testid="readiness-decision-score"
          >
            {score}
            <span className="text-base font-normal text-muted-foreground">
              {" "}
              / 100
            </span>
          </span>
        </div>
      </div>

      {primary !== null && (
        <div className="flex flex-col gap-1.5" data-testid="readiness-primary">
          <FieldLabel>
            {blockingReasons.length > 0 ? "Blocking" : "Needs attention"}
          </FieldLabel>
          <p className="text-sm leading-6 text-card-foreground">
            {primary.subject === null
              ? primary.text
              : `${primary.subject} — ${primary.text}`}
          </p>
          {blockingReasons.length + attentionReasons.length > 1 && (
            <p className="text-xs text-muted-foreground">
              +{blockingReasons.length + attentionReasons.length - 1} more
              {blockingReasons.length > 1 ? " blocking / " : " "}
              reason
              {blockingReasons.length + attentionReasons.length > 2 ? "s" : ""}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Link
          href={href}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="readiness-decision-cta"
        >
          See why →
        </Link>
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          {readiness.version}
        </span>
      </div>

      <p
        className="text-xs leading-5 text-muted-foreground"
        data-testid="readiness-decision-disclaimer"
      >
        {readiness.disclaimer}
      </p>
    </Card>
  );
}
