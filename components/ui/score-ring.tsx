import { cn } from "@/lib/utils";

/**
 * PayChaos AI — the Reliability Score ring.
 *
 * THE SCORE IS THE PRODUCT'S HEADLINE NUMBER, so it gets the one genuinely
 * expressive visual in the application. Everything else stays flat and
 * technical on purpose; this is where the eye is meant to land.
 *
 * IT RENDERS ONLY WHAT IT IS GIVEN. The ring is a pure function of `score`.
 * It computes no reliability, applies no threshold of its own, and cannot
 * disagree with the deterministic RELIABILITY-V1 arithmetic upstream — it is
 * a presentation of a number, not a second opinion about it.
 *
 * NEVER COLOUR ALONE. The arc's colour follows the readiness tone, but the
 * number, its label and the surrounding copy carry the same meaning in text,
 * so the ring survives greyscale, colour-blindness and a projector.
 *
 * NO FABRICATED PRECISION. There is no needle, no gradient scale and no
 * decimal: the score is an integer out of 100 and is drawn as exactly that.
 */

type ScoreTone = "pass" | "warn" | "fail" | "neutral";

/** Arc colour per tone — the same semantics the status system uses. */
const ARC: Record<ScoreTone, string> = {
  pass: "var(--status-pass)",
  warn: "var(--status-warn)",
  fail: "var(--status-fail)",
  neutral: "var(--primary)",
};

export function ScoreRing({
  score,
  tone = "neutral",
  label = "Reliability Score",
  caption,
  size = 168,
  className,
  "data-testid": testId,
}: {
  /** 0-100, server-derived. Clamped only to keep the arc drawable. */
  readonly score: number;
  readonly tone?: ScoreTone;
  readonly label?: string;
  readonly caption?: string;
  readonly size?: number;
  readonly className?: string;
  readonly "data-testid"?: string;
}) {
  // Clamping is a DRAWING concern, not a scoring one: an out-of-range value
  // would otherwise render an arc longer than the circle. The number shown
  // below is the value as given, so a nonsensical score stays visible rather
  // than being silently corrected into something plausible.
  const drawable = Math.max(
    0,
    Math.min(100, Number.isFinite(score) ? score : 0),
  );

  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (drawable / 100) * circumference;

  return (
    <div
      className={cn("flex flex-col items-center gap-3", className)}
      data-testid={testId}
    >
      <div
        className="relative"
        style={{ width: size, height: size }}
        role="img"
        aria-label={`${label}: ${score} out of 100`}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden="true"
          className="-rotate-90"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--ring-track)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={ARC[tone]}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference - filled}`}
            // A restrained transition, so a regression moving the score reads
            // as a change rather than a redraw. No pulse, no loop.
            style={{ transition: "stroke-dasharray 320ms ease-out" }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[40px] font-semibold leading-none tabular-nums tracking-[-0.03em] text-foreground">
            {score}
          </span>
          <span className="mt-1 text-[11px] font-medium text-muted-foreground">
            out of 100
          </span>
        </div>
      </div>

      <div className="text-center">
        <p className="text-[13px] font-semibold text-foreground">{label}</p>
        {caption !== undefined && (
          <p className="mt-0.5 max-w-[22rem] text-[12px] leading-5 text-muted-foreground">
            {caption}
          </p>
        )}
      </div>
    </div>
  );
}
