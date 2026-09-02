import { cn } from "@/lib/utils";

/**
 * PayChaos AI — original brand mark.
 *
 * THE IDEA. A payment signal travelling left to right that is deliberately
 * BROKEN in the middle, then recovers and resolves upward into a verified
 * tick. That is the product in one glyph: PayChaos injects a controlled
 * failure into a payment flow, detects it, and proves the recovery.
 *
 * The gap is the point — it is drawn, not implied. A mark showing an unbroken
 * line would describe a monitoring tool; this one describes chaos engineering.
 *
 * ORIGINAL AND NON-DERIVATIVE. No Razorpay glyph, colour or letterform is
 * referenced. It is a plain geometric line mark that belongs to this project.
 *
 * BUILT FOR SMALL SIZES. Two strokes, no gradient, no fill detail, generous
 * stroke weight — it stays legible at 16px in a browser tab and at 24px in
 * the sidebar. It inherits `currentColor`, so it works on any surface and in
 * either theme without a second asset.
 */
export function LogoMark({
  className,
  title = "PayChaos AI",
}: {
  readonly className?: string;
  readonly title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={title}
      className={cn("h-6 w-6", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* The signal: steady, then the injected break. */}
      <path d="M2 15h3l2.5-6 2 4" />
      {/* Recovery, resolving upward into the verification tick. */}
      <path d="M13 17l3.5 3.5L22 9" />
    </svg>
  );
}

/**
 * The full lockup: mark, product name, and an optional descriptor.
 *
 * `subtitle` is off by default because the sidebar has no room for it; the
 * access screen turns it on, where the product has to introduce itself to
 * someone who may never have seen it.
 */
export function LogoLockup({
  subtitle = false,
  className,
}: {
  readonly subtitle?: boolean;
  readonly className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
        <LogoMark className="h-[18px] w-[18px]" />
      </span>
      <span className="flex min-w-0 flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-tight text-foreground">
          PayChaos<span className="text-muted-foreground"> AI</span>
        </span>
        {subtitle && (
          <span className="mt-1 truncate text-[11px] font-medium tracking-wide text-muted-foreground">
            Autonomous Payment Reliability Engineer
          </span>
        )}
      </span>
    </span>
  );
}
