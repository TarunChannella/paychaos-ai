import Link from "next/link";

import { ReadinessOverview } from "@/components/reliability/readiness-overview";
import { ReadinessDecision } from "@/components/reliability/readiness-decision";
import { ReliabilityOverview } from "@/components/reliability/reliability-overview";
import { Card, PageShell, Section } from "@/components/ui/page";
import { getCurrentGoLiveReadiness } from "@/lib/readiness/service";

import type { GoLiveReadinessReadModel } from "@/lib/readiness/service";

/**
 * The Reliability decision dashboard.
 *
 * IT LEADS WITH THE DECISION, NOT THE ALGORITHM. Previously the version
 * strings and run UUIDs competed with the score for attention, which made a
 * go-live judgement read as a debug report. The order is now: what is the
 * verdict, what is the score, why, which scenario contributed what, and only
 * then the identifiers and algorithm metadata.
 *
 * SERVER COMPONENT. It calls the trusted service directly rather than
 * fetching its own HTTP API: the browser never reaches Supabase, never
 * receives a service-role credential, and no needless network hop or second
 * auth check is introduced.
 *
 * ALWAYS FRESH. The score is derived on demand, so a cached snapshot would
 * show an operator a stale verdict — exactly the thing that must never be
 * stale here.
 *
 * FAILURE IS NOT A SCORE. If the evidence cannot be read, this page says so.
 * It never renders 0, never renders a number from an outage, and never shows
 * four NOT_RUN rows in place of a real answer.
 *
 * NO CHARTS. There is no persisted score history, so a trend line would be a
 * fabricated one.
 */
export const dynamic = "force-dynamic";

export default async function ReliabilityPage() {
  let model: GoLiveReadinessReadModel | null = null;
  try {
    model = await getCurrentGoLiveReadiness();
  } catch {
    // Deliberately swallow the detail: raw exception text could carry a
    // database message. The distinction that matters — read failure, not
    // empty evidence — is stated below in plain words.
    model = null;
  }

  return (
    <PageShell wide>
      <header className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Ready
        </span>
        <h1 className="text-2xl font-semibold leading-8 tracking-tight text-foreground">
          Go-Live Reliability
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          A deterministic score over the four mandatory P0 chaos scenarios, and
          the Go-Live Readiness assessment derived from it. No AI, no estimate
          and nothing stored — both are recalculated from the database every
          time this page is opened.
        </p>
      </header>

      {model === null ? (
        <Card tone="danger" data-testid="reliability-unavailable">
          <p className="text-sm font-medium text-card-foreground">
            Reliability data unavailable.
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            No score or readiness assessment was calculated because the required
            evidence could not be read. This is a read failure, not an absence
            of evidence — nothing is shown rather than something misleading.
          </p>
        </Card>
      ) : (
        <>
          <ReadinessDecision
            readiness={model.readiness}
            score={model.reliability.score.score}
            href="#readiness-gates"
          />

          {/* The frozen 4F panel carries the per-scenario explanations and
              candidate diagnostics; it is restyled, never re-derived. */}
          <ReliabilityOverview model={model.reliability} />

          <div id="readiness-gates">
            <ReadinessOverview readiness={model.readiness} />
          </div>

          <p
            className="border-t border-border pt-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground"
            data-testid="reliability-algorithm-meta"
          >
            {model.reliability.score.algorithmVersion} ·{" "}
            {model.reliability.score.selectionVersion} · total deduction{" "}
            {model.reliability.score.totalDeduction}
          </p>
        </>
      )}

      <footer className="flex flex-wrap gap-3 border-t border-border pt-6">
        <Link
          href="/chaos"
          className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Back to Chaos Lab
        </Link>
      </footer>
    </PageShell>
  );
}
