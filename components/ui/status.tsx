import { cn } from "@/lib/utils";

/**
 * Phase 5 UI — the one semantic status system.
 *
 * FIVE TIERS THAT MUST NOT LOOK ALIKE. A go-live DECISION, an invariant
 * VERDICT, a finding SEVERITY, a regression LIFECYCLE state and a
 * PROVENANCE label are five different kinds of claim. Rendering them as one
 * interchangeable pill is how an operator ends up reading "SYNTHETIC TEST" as
 * though it were "PASS".
 *
 * PROVENANCE IS DELIBERATELY NOT A BADGE. It is a mono, uppercase, dashed
 * tag — a different visual language from every verdict in the product, so a
 * truth-source label can never be mistaken for a result.
 *
 * NEVER COLOUR ALONE. Every state carries a glyph and its own text, so the
 * meaning survives greyscale, colour-blindness and a projector. Because that
 * glyph is part of the rendered text, the RAW value is also published as
 * `data-value` — so a caller or a test reads the semantic state directly
 * instead of scraping decoration out of `textContent`.
 *
 * IT DECIDES NOTHING. These components map a server-authoritative string to a
 * visual treatment. An unknown value falls back to the neutral treatment and
 * renders its own text verbatim rather than being silently reclassified —
 * guessing would be exactly the failure mode this system exists to prevent.
 */

type Tone = "pass" | "fail" | "warn" | "info" | "neutral";

/** Semantic colour, applied identically wherever a tone appears. */
const TONE: Record<Tone, string> = {
  pass: "border-emerald-600/30 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-950/40 dark:text-emerald-300",
  fail: "border-red-600/30 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-950/40 dark:text-red-300",
  warn: "border-amber-600/30 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-300",
  info: "border-blue-600/30 bg-blue-50 text-blue-700 dark:border-blue-400/30 dark:bg-blue-950/40 dark:text-blue-300",
  neutral: "border-border bg-muted text-muted-foreground dark:bg-muted/50",
};

/** Text glyphs, not an icon dependency. */
const GLYPH: Record<Tone, string> = {
  pass: "✓",
  fail: "✕",
  warn: "!",
  info: "•",
  neutral: "–",
};

// ============================================================================
// A. DECISION — READY / NEEDS ATTENTION / NOT READY
// ============================================================================

const DECISION_TONE: Record<string, Tone> = {
  READY: "pass",
  "NEEDS ATTENTION": "warn",
  "NOT READY": "fail",
};

/**
 * The go-live decision. Deliberately larger and heavier than any other
 * status: it is the single most consequential statement the product makes.
 */
export function DecisionStatus({
  status,
  className,
  "data-testid": testId,
}: {
  readonly status: string;
  readonly className?: string;
  readonly "data-testid"?: string;
}) {
  const tone = DECISION_TONE[status] ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-base font-semibold tracking-tight",
        TONE[tone],
        className,
      )}
      data-testid={testId}
      data-tone={tone}
      data-value={status}
    >
      <span aria-hidden="true" className="text-lg leading-none">
        {GLYPH[tone]}
      </span>
      {status}
    </span>
  );
}

// ============================================================================
// B. VERDICT — PASS / FAIL / UNKNOWN / BLOCKED / ERROR / NOT RUN
// ============================================================================

const VERDICT_TONE: Record<string, Tone> = {
  PASS: "pass",
  FAIL: "fail",
  UNKNOWN: "warn",
  BLOCKED: "warn",
  ERROR: "fail",
  NOT_RUN: "neutral",
  "NOT RUN": "neutral",
};

/** An invariant or scenario result. UNKNOWN is amber — never green. */
export function VerdictBadge({
  verdict,
  className,
  "data-testid": testId,
}: {
  readonly verdict: string;
  readonly className?: string;
  readonly "data-testid"?: string;
}) {
  const tone = VERDICT_TONE[verdict] ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
        TONE[tone],
        className,
      )}
      data-testid={testId}
      data-tone={tone}
      data-value={verdict}
    >
      <span aria-hidden="true">{GLYPH[tone]}</span>
      {verdict.replace("_", " ")}
    </span>
  );
}

// ============================================================================
// C. SEVERITY — CRITICAL / HIGH / MEDIUM / LOW
// ============================================================================

const SEVERITY_TONE: Record<string, Tone> = {
  CRITICAL: "fail",
  HIGH: "fail",
  MEDIUM: "warn",
  LOW: "neutral",
};

/** Left-accented, so severity scans down a table column at a glance. */
export function SeverityBadge({
  severity,
  className,
  "data-testid": testId,
}: {
  readonly severity: string;
  readonly className?: string;
  readonly "data-testid"?: string;
}) {
  const tone = SEVERITY_TONE[severity] ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border-l-[3px] border-y border-r px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
        tone === "fail"
          ? "border-l-red-600 dark:border-l-red-400"
          : tone === "warn"
            ? "border-l-amber-600 dark:border-l-amber-400"
            : "border-l-muted-foreground/40",
        TONE[tone],
        className,
      )}
      data-testid={testId}
      data-tone={tone}
    >
      {severity}
    </span>
  );
}

// ============================================================================
// D. LIFECYCLE — RESOLVED / STILL FAILING / PENDING / RUNNING / ERROR
// ============================================================================

const LIFECYCLE: Record<
  string,
  { readonly label: string; readonly tone: Tone }
> = {
  RESOLVED: { label: "Fix verified", tone: "pass" },
  STILL_FAILING: { label: "Still failing", tone: "fail" },
  PENDING: { label: "Pending", tone: "neutral" },
  RUNNING: { label: "Running", tone: "info" },
  ERROR: { label: "Error", tone: "fail" },
  OPEN: { label: "Open", tone: "fail" },
};

/**
 * A regression or finding lifecycle state.
 *
 * "Fix verified" is reachable ONLY from a persisted `RESOLVED`. Every other
 * state renders as itself; none of them borrows the language of a pass.
 */
export function LifecycleBadge({
  status,
  className,
  "data-testid": testId,
}: {
  readonly status: string;
  readonly className?: string;
  readonly "data-testid"?: string;
}) {
  const entry = LIFECYCLE[status];
  const tone = entry?.tone ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        TONE[tone],
        className,
      )}
      data-testid={testId}
      data-tone={tone}
    >
      {entry?.label ?? status.replace("_", " ")}
    </span>
  );
}

// ============================================================================
// E. PROVENANCE / AUTHORITY
// ============================================================================

/**
 * Where a claim came from — never whether it passed.
 *
 * Visually separated from every badge above: mono, uppercase, dashed border,
 * no glyph, no semantic colour. An operator must never read a truth-source
 * label as a result.
 */
export function ProvenanceTag({
  label,
  className,
  "data-testid": testId,
}: {
  readonly label: string;
  readonly className?: string;
  readonly "data-testid"?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border border-dashed border-border px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground",
        className,
      )}
      data-testid={testId}
      data-kind="provenance"
    >
      {label}
    </span>
  );
}
