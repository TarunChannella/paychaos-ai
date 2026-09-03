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
 * BUILT FOR SMALL SIZES. A squircle tile, one gradient, one sheen and two
 * strokes — nothing that turns to mush at 16px in a browser tab. The
 * dimensionality is a single soft highlight and a hairline inner edge rather
 * than a bevel or a drop shadow, both of which smear when scaled down.
 *
 * IT CARRIES ITS OWN COLOUR. Unlike the first version this does not inherit
 * `currentColor`: a product mark should look the same everywhere, and the
 * blue-to-teal face is the identity. It is an inline SVG, so there is no
 * asset to fetch, nothing to go stale on a CDN and nothing to break on
 * Vercel.
 */
export function LogoMark({
  className,
  title = "PayChaos AI",
}: {
  readonly className?: string;
  readonly title?: string;
}) {
  // Ids must be unique per instance if this ever renders twice on one page.
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label={title}
      className={cn("h-8 w-8", className)}
    >
      <defs>
        <linearGradient id="pc-mark-face" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="55%" stopColor="#2563EB" />
          <stop offset="100%" stopColor="#22819A" />
        </linearGradient>
        {/* The highlight is what gives the tile its slight dimensionality —
            a single soft sheen across the top-left, not a glossy bevel. */}
        <linearGradient id="pc-mark-sheen" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* The tile. A squircle rather than a circle so the mark still reads as
          a product icon at 16px in a browser tab. */}
      <rect
        x="0"
        y="0"
        width="32"
        height="32"
        rx="9"
        fill="url(#pc-mark-face)"
      />
      <rect
        x="0"
        y="0"
        width="32"
        height="32"
        rx="9"
        fill="url(#pc-mark-sheen)"
      />
      {/* A hairline inner edge: reads as depth without a drop shadow, which
          would smear at small sizes. */}
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="8.5"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.22"
      />

      {/* THE IDEA, unchanged from the original mark: a payment signal that is
          deliberately BROKEN, then recovers into a verification tick. The gap
          is drawn, not implied — an unbroken line would describe monitoring,
          not chaos engineering. */}
      <g
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 19.5h2.6l2.2-5.2 1.7 3.4" />
        <path d="M15.4 21l3 3 7.2-11" strokeOpacity="0.96" />
      </g>
    </svg>
  );
}

/**
 * The full lockup: mark, product name, and an optional descriptor.
 *
 * `subtitle` is off by default; the access screen turns it on, where the
 * product has to introduce itself to someone who may never have seen it.
 *
 * `size="lg"` is the sidebar's product identity: a larger mark and a
 * two-line descriptor, so the rail opens with a real SaaS lockup rather than
 * a favicon with a word next to it. The default stays exactly as it was so
 * the access screen is untouched by this variant existing.
 */
export function LogoLockup({
  subtitle = false,
  size = "sm",
  className,
}: {
  readonly subtitle?: boolean;
  readonly size?: "sm" | "lg";
  readonly className?: string;
}) {
  const large = size === "lg";

  return (
    <span
      className={cn(
        "flex",
        large
          ? "items-center gap-2.5 md:items-start md:gap-3"
          : "items-center gap-2.5",
        className,
      )}
    >
      {/* The mark carries its own tile now, so it is rendered directly. A
          wrapper with a background would draw a second tile behind it. The
          soft shadow is the only dimensionality added here. */}
      <LogoMark
        className={cn(
          "shrink-0 rounded-[9px] shadow-[0_2px_8px_rgb(37_99_235/0.28)]",
          large ? "h-8 w-8 md:h-[38px] md:w-[38px]" : "h-8 w-8",
        )}
      />
      <span className="flex min-w-0 flex-col leading-none">
        <span
          className={cn(
            "font-semibold tracking-tight text-foreground",
            large ? "text-[15px] md:text-[17px]" : "text-[15px]",
          )}
        >
          PayChaos
          <span className="ml-1 text-[var(--primary)]">AI</span>
        </span>
        {subtitle &&
          (large ? (
            // ONE element, reflowed — never a second hidden copy. The
            // descriptor is suppressed on the mobile strip, where it would
            // push real content down, and set on two lines on the desktop
            // rail, where truncating it to "Autonomous Payment Reliability…"
            // would read as a tooltip rather than a positioning statement.
            <span className="mt-1.5 hidden text-[11px] font-medium leading-[1.35] tracking-wide text-muted-foreground md:block">
              Autonomous Payment
              <br />
              Reliability Engineer
            </span>
          ) : (
            <span className="mt-1 truncate text-[11px] font-medium tracking-wide text-muted-foreground">
              Autonomous Payment Reliability Engineer
            </span>
          ))}
      </span>
    </span>
  );
}
