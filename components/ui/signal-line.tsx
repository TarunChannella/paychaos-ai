import { cn } from "@/lib/utils";

/**
 * PayChaos AI — the Evidence Signal Line.
 *
 * THE PRODUCT'S ONE RECOGNISABLE MOTIF, and it earns its place by explaining
 * something rather than decorating something. A payment reliability claim is
 * only as good as the chain behind it, so the chain is drawn:
 *
 *   Razorpay event → webhook → chaos → invariant → finding → regression
 *
 * EVERY STEP STATES ITS OWN TRUTH SOURCE. A step's tone says what KIND of
 * thing it is — verified evidence, a PayChaos replay, a failure, a passing
 * regression — using the same semantics as the rest of the product. A replay
 * must never render in the colour reserved for a real Razorpay delivery, and
 * the label carries that meaning in words as well as colour.
 *
 * IT INVENTS NOTHING. It renders the steps it is handed. A step with no
 * evidence is shown as pending, not quietly omitted: an incomplete chain is
 * the honest picture when the chain really is incomplete.
 */

export type SignalTone =
  "verified" | "replay" | "simulation" | "fail" | "pass" | "pending";

export interface SignalStep {
  /** Human meaning first — this is what a reader actually needs. */
  readonly label: string;
  /** Optional supporting line: a state, a count, a short factual detail. */
  readonly detail?: string;
  readonly tone: SignalTone;
}

const DOT: Record<SignalTone, string> = {
  verified: "border-[var(--provenance-real)] bg-[var(--provenance-real)]",
  replay: "border-[var(--provenance-replay)] bg-[var(--provenance-replay)]",
  simulation:
    "border-[var(--provenance-simulation)] bg-[var(--provenance-simulation)]",
  fail: "border-[var(--status-fail)] bg-[var(--status-fail)]",
  pass: "border-[var(--status-pass)] bg-[var(--status-pass)]",
  pending: "border-border-strong bg-background",
};

/** The connector INTO a step takes that step's colour, so the line reads. */
const CONNECTOR: Record<SignalTone, string> = {
  verified: "bg-[var(--provenance-real)]/35",
  replay: "bg-[var(--provenance-replay)]/35",
  simulation: "bg-[var(--provenance-simulation)]/35",
  fail: "bg-[var(--status-fail)]/35",
  pass: "bg-[var(--status-pass)]/35",
  pending: "bg-border-strong/50",
};

/** The word a reader sees, so meaning never depends on the colour alone. */
const TONE_LABEL: Record<SignalTone, string> = {
  verified: "Verified Razorpay evidence",
  replay: "PayChaos replay",
  simulation: "PayChaos simulation",
  fail: "Failure",
  pass: "Passed",
  pending: "Not yet recorded",
};

export function SignalLine({
  steps,
  className,
  "data-testid": testId,
}: {
  readonly steps: readonly SignalStep[];
  readonly className?: string;
  readonly "data-testid"?: string;
}) {
  if (steps.length === 0) return null;

  return (
    <ol
      className={cn("flex flex-col", className)}
      data-testid={testId}
      aria-label="Evidence chain"
    >
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;

        return (
          <li key={`${step.label}-${index}`} className="flex gap-3">
            {/* Rail: the dot for this step, and the line down to the next. */}
            <div className="flex flex-col items-center" aria-hidden="true">
              <span
                className={cn(
                  "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2",
                  DOT[step.tone],
                )}
              />
              {!isLast && (
                <span
                  className={cn("mt-1 w-px flex-1", CONNECTOR[step.tone])}
                />
              )}
            </div>

            <div className={cn("min-w-0 flex-1", isLast ? "pb-0" : "pb-5")}>
              <p className="text-[13.5px] font-medium leading-5 text-foreground">
                {step.label}
              </p>
              {step.detail !== undefined && (
                <p className="mt-0.5 break-words text-[12px] leading-5 text-muted-foreground">
                  {step.detail}
                </p>
              )}
              {/* The tone in words. Screen readers and greyscale get the same
                  information the colour carries. */}
              <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.09em] text-subtle-foreground">
                {TONE_LABEL[step.tone]}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
