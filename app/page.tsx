import { Badge } from "@/components/ui/badge";

// Phase 1A application shell.
//
// This proves Next.js renders, Tailwind CSS applies, and the shadcn/ui
// foundation (Badge) works end to end. It intentionally contains no
// Demo Merchant screen and no dashboard — those arrive in later Phase 1
// sub-phases (1D/1E) and are out of scope for the 1A tooling foundation.
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
    </div>
  );
}
