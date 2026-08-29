import Link from "next/link";

import { Badge } from "@/components/ui/badge";

// Phase 1A application shell + Phase 1E navigation.
//
// This proves Next.js renders, Tailwind CSS applies, and the shadcn/ui
// foundation (Badge) works end to end. It intentionally contains no
// dashboard — that arrives in a later phase. The single Link below is the
// Phase 1E entry point into the Demo Merchant screen (docs instructions
// Section 15: "Simple link/button from `/` to `/demo-merchant`. No full
// dashboard.").
export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-background px-6 py-24 text-center">
      <Badge variant="outline" className="text-sm">
        Razorpay Test Mode
      </Badge>

      <h1 className="text-4xl font-semibold tracking-tight text-foreground">
        PayChaos AI
      </h1>

      <p className="max-w-md text-balance text-base text-muted-foreground">
        Autonomous Payment Reliability Engineer — Razorpay AI Buildathon, Open
        Track.
      </p>

      <p className="max-w-md text-balance text-sm text-muted-foreground">
        All payment behavior demonstrated by this project runs exclusively
        against Razorpay Test Mode. No real money or Live Mode credentials are
        ever used.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/demo-merchant"
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Open Demo Merchant
        </Link>

        {/* Phase 3H entry point into the Chaos Lab. */}
        <Link
          href="/chaos"
          className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          Open Chaos Lab
        </Link>
      </div>
    </div>
  );
}
