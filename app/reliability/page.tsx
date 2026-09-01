import Link from "next/link";

import { ReadinessOverview } from "@/components/reliability/readiness-overview";
import { ReliabilityOverview } from "@/components/reliability/reliability-overview";
import { Badge } from "@/components/ui/badge";
import { getCurrentGoLiveReadiness } from "@/lib/readiness/service";

import type { GoLiveReadinessReadModel } from "@/lib/readiness/service";

/**
 * Phase 4F-R3 — the operator Reliability Score page (P4-AC-10/11/12).
 *
 * SERVER COMPONENT. It calls the trusted service directly rather than fetching
 * its own HTTP API: the browser never reaches Supabase, never receives a
 * service-role credential, and no needless network hop or second auth check is
 * introduced. `GET /api/reliability` and this page are two adapters over the
 * same service, not layers of each other.
 *
 * ALWAYS FRESH. The score is derived on demand, so a cached snapshot would
 * show an operator a stale verdict — exactly the thing that must never be
 * stale here. Same reasoning, same mechanism as the Chaos Lab page.
 *
 * FAILURE IS NOT A SCORE. If the evidence cannot be read, this page says so.
 * It never renders 0, never renders 40, and never renders four NOT_RUN rows
 * from an outage: a fabricated number is worse than an honest gap.
 */
export const dynamic = "force-dynamic";

export default async function ReliabilityPage() {
  // One call: the readiness service composes the frozen 4F reliability read
  // model and returns it unmodified alongside the assessment, so the page
  // makes no second read and no second score calculation.
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
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="flex flex-col items-center gap-3 text-center">
        <Badge variant="outline" className="text-sm">
          Razorpay Test Mode
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          PayChaos AI — Reliability Score
        </h1>
        <p className="max-w-xl text-balance text-sm text-muted-foreground">
          A deterministic score over the four mandatory P0 chaos scenarios, and
          the Go-Live Readiness assessment derived from it. No AI, no estimate
          and nothing stored — both are recalculated from the database every
          time this page is opened.
        </p>
      </header>

      {model === null ? (
        <section
          className="rounded-lg border border-destructive/40 bg-card p-6 text-center"
          data-testid="reliability-unavailable"
        >
          <p className="text-sm font-medium text-card-foreground">
            Reliability data unavailable.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            No score or readiness assessment was calculated because the required
            evidence could not be read. This is a read failure, not an absence
            of evidence — nothing is shown rather than something misleading.
          </p>
        </section>
      ) : (
        <>
          <ReliabilityOverview model={model.reliability} />
          <ReadinessOverview readiness={model.readiness} />
        </>
      )}

      <footer className="flex justify-center">
        <Link
          href="/chaos"
          className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          Back to Chaos Lab
        </Link>
      </footer>
    </div>
  );
}
