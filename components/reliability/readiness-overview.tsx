import { Badge } from "@/components/ui/badge";

import type {
  GoLiveReadinessV1,
  ReadinessGateState,
  ReadinessStatus,
} from "@/lib/readiness/types";

/**
 * Phase 4G — the Go-Live Readiness panel.
 *
 * PRESENTATION ONLY. It takes an already-evaluated `GoLiveReadinessV1` and
 * renders it. No fetch, no Supabase, no readiness rules, no score arithmetic,
 * no client state: the status and every reason were decided by
 * `lib/readiness/readiness.ts`, and this component may not re-derive them.
 *
 * IT SHOWS WHY (P4-AC-13). Blocking reasons, attention reasons and the full
 * gate checklist are all rendered, so an operator can see exactly what stands
 * between the project and READY rather than being handed a bare verdict.
 *
 * HONEST ABOUT WHAT IS UNVERIFIED. An `UNKNOWN` gate reads "Not verified by
 * the current runtime evidence" — never "FAILED", which would invent a
 * problem, and never "PASS", which would invent an assurance.
 *
 * NOT A CERTIFICATION (P4-AC-14). The mandatory disclaimer is always visible
 * and comes from the frozen constant, so no screen can paraphrase it into
 * something weaker. Nothing here says approved, certified, guaranteed or safe
 * for production.
 */

/** Only READY gets the solid treatment; nothing is styled as reassurance. */
const STATUS_VARIANT: Record<
  ReadinessStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  READY: "default",
  "NEEDS ATTENTION": "secondary",
  "NOT READY": "destructive",
};

const STATUS_SUMMARY: Record<ReadinessStatus, string> = {
  READY:
    "Every required readiness gate passed on current evidence. This remains an engineering assessment, not an approval.",
  "NEEDS ATTENTION":
    "Nothing is blocking, but at least one prerequisite is unmet or unverified, so READY cannot truthfully be claimed yet.",
  "NOT READY":
    "At least one blocking condition is present. Blocking conditions always take precedence over everything else below.",
};

/** Deterministic wording per gate state. */
const GATE_LABEL: Record<ReadinessGateState, string> = {
  PASS: "PASS",
  FAIL: "FAILED",
  UNKNOWN: "Not verified by the current runtime evidence",
};

const GATE_VARIANT: Record<
  ReadinessGateState,
  "default" | "secondary" | "outline" | "destructive"
> = {
  PASS: "default",
  FAIL: "destructive",
  UNKNOWN: "outline",
};

export function ReadinessOverview({
  readiness,
}: {
  readonly readiness: GoLiveReadinessV1;
}) {
  const { status, blockingReasons, attentionReasons, gates } = readiness;

  return (
    <section
      className="flex flex-col gap-6 rounded-lg border border-border bg-card p-6"
      data-testid="readiness-overview"
    >
      <header className="flex flex-col items-center gap-2 text-center">
        <p className="text-sm text-muted-foreground">Go-Live Readiness</p>
        <Badge
          variant={STATUS_VARIANT[status]}
          className="text-base"
          data-testid="readiness-status"
        >
          {status}
        </Badge>
        <p
          className="max-w-xl text-balance text-sm text-muted-foreground"
          data-testid="readiness-summary"
        >
          {STATUS_SUMMARY[status]}
        </p>
        <Badge variant="outline" data-testid="readiness-version">
          {readiness.version}
        </Badge>
      </header>

      {blockingReasons.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="readiness-blocking">
          <h3 className="text-sm font-semibold text-foreground">
            Blocking reasons
          </h3>
          <ul className="flex flex-col gap-1">
            {blockingReasons.map((reason, index) => (
              <li
                key={`${reason.code}-${reason.subject ?? index}`}
                className="text-sm text-card-foreground"
                data-testid={`readiness-blocking-${reason.code}`}
              >
                {reason.subject === null
                  ? reason.text
                  : `${reason.subject} — ${reason.text}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {attentionReasons.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="readiness-attention">
          <h3 className="text-sm font-semibold text-foreground">
            Attention reasons
          </h3>
          <ul className="flex flex-col gap-1">
            {attentionReasons.map((reason, index) => (
              <li
                key={`${reason.code}-${reason.subject ?? index}`}
                className="text-sm text-card-foreground"
                data-testid={`readiness-attention-${reason.code}`}
              >
                {reason.subject === null
                  ? reason.text
                  : `${reason.subject} — ${reason.text}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2" data-testid="readiness-gates">
        <h3 className="text-sm font-semibold text-foreground">
          Gate checklist
        </h3>
        <ul className="flex flex-col gap-2">
          {gates.map((gate) => (
            <li
              key={gate.gateId}
              className="flex flex-col gap-1 rounded-md border border-border p-3"
              data-testid={`readiness-gate-${gate.gateId}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-semibold text-card-foreground">
                  {gate.gateId}
                </span>
                <Badge variant={GATE_VARIANT[gate.state]} className="text-xs">
                  {GATE_LABEL[gate.state]}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{gate.detail}</p>
            </li>
          ))}
        </ul>
      </div>

      <p
        className="border-t border-border pt-4 text-xs text-muted-foreground"
        data-testid="readiness-disclaimer"
      >
        {readiness.disclaimer}
      </p>
    </section>
  );
}
