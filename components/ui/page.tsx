import { cn } from "@/lib/utils";

/**
 * Phase 5 UI — shared page primitives.
 *
 * ONE TYPE SCALE, ONE SPACING RHYTHM. Before this existed, every screen chose
 * its own heading size and gap, which is why the product read as a set of
 * separate pages rather than one console. These are deliberately small and
 * unopinionated: layout scaffolding, not a component framework.
 *
 * COMPACT, NOT MARKETING. Page titles are 26px, not 48px. This is operations
 * tooling — density and legibility beat scale.
 */

/** Standard page frame. `wide` suits tables; the default suits reading. */
export function PageShell({
  children,
  wide = false,
  className,
}: {
  readonly children: React.ReactNode;
  readonly wide?: boolean;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        // Gutters follow the spacing rhythm: 16 / 24 / 32 as the viewport
        // grows. Content stops at 1440px so an ultra-wide monitor does not
        // stretch a reading column to an unreadable line length.
        "mx-auto flex w-full flex-col gap-8 px-4 py-8 sm:px-6 md:gap-10 md:py-10 xl:px-8",
        wide ? "max-w-[1440px]" : "max-w-4xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Page header: eyebrow, title, optional lede and trailing actions. */
export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly lede?: string;
  readonly actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow !== undefined && (
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {eyebrow}
          </span>
        )}
        <h1 className="text-[26px] font-semibold leading-9 tracking-[-0.02em] text-foreground sm:text-[30px] sm:leading-10">
          {title}
        </h1>
        {lede !== undefined && (
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            {lede}
          </p>
        )}
      </div>
      {actions !== undefined && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

/**
 * A titled section.
 *
 * `step` renders the narrative index used by the Finding investigation story,
 * which is what turns six equal cards into a sequence a reader can follow.
 */
export function Section({
  title,
  step,
  description,
  actions,
  children,
  className,
  "data-testid": testId,
}: {
  readonly title: string;
  readonly step?: number;
  readonly description?: string;
  readonly actions?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly "data-testid"?: string;
}) {
  return (
    <section
      className={cn("flex flex-col gap-3", className)}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2.5">
          {step !== undefined && (
            <span
              aria-hidden="true"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted/60 font-mono text-[11px] font-bold text-muted-foreground"
            >
              {String(step).padStart(2, "0")}
            </span>
          )}
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-foreground">
            {title}
          </h2>
        </div>
        {actions}
      </div>
      {description !== undefined && (
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      )}
      {children}
    </section>
  );
}

/** Bordered surface. `tone` marks a failure surface without shouting. */
export function Card({
  children,
  tone = "default",
  className,
  "data-testid": testId,
}: {
  readonly children: React.ReactNode;
  readonly tone?: "default" | "danger" | "muted";
  readonly className?: string;
  readonly "data-testid"?: string;
}) {
  return (
    <div
      className={cn(
        // 16px radius and a soft, cool shadow — present enough to separate a
        // card from the ground, far short of making every container float.
        "rounded-2xl border p-5 shadow-[0_8px_30px_rgb(15_23_42/0.055)]",
        tone === "danger"
          ? "border-destructive/40 bg-card"
          : tone === "muted"
            ? "border-border bg-muted/40 shadow-none"
            : "border-border bg-card",
        className,
      )}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

/**
 * Shared control surface for page-level actions.
 *
 * WHY A CLASS HELPER AND NOT A COMPONENT. These classes are applied to both
 * `<Link>` and `<button>` across the console; a wrapper component would force
 * one of the two into a polymorphic `as` prop for no gain. The point is simply
 * that PRIMARY and SECONDARY now look different — previously every action was
 * an identical outlined control, so no screen expressed which action the
 * operator was actually meant to take.
 */
export function actionClassName(
  variant: "primary" | "secondary" = "secondary",
  className?: string,
): string {
  return cn(
    // 10px radius, not a pill: this is an engineering console, and a pill
    // reads as marketing. Touch target stays comfortable on a phone.
    "inline-flex min-h-[40px] items-center justify-center gap-2 rounded-[10px] px-4 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
    variant === "primary"
      ? "bg-primary text-primary-foreground shadow-sm hover:bg-[var(--primary-hover)]"
      : "border border-border bg-card text-foreground hover:border-border-strong hover:bg-accent hover:text-accent-foreground",
    className,
  );
}

/** A small uppercase field label. */
export function FieldLabel({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
      {children}
    </span>
  );
}

/** Monospace identifier — always secondary to the thing it identifies. */
export function Identifier({
  value,
  className,
}: {
  readonly value: string;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "font-mono text-xs break-all text-muted-foreground",
        className,
      )}
    >
      {value}
    </span>
  );
}
