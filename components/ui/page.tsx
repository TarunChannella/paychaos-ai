import { cn } from "@/lib/utils";

/**
 * Phase 5 UI — shared page primitives.
 *
 * ONE TYPE SCALE, ONE SPACING RHYTHM. Before this existed, every screen chose
 * its own heading size and gap, which is why the product read as a set of
 * separate pages rather than one console. These are deliberately small and
 * unopinionated: layout scaffolding, not a component framework.
 *
 * COMPACT, NOT MARKETING. Page titles are 24px, not 48px. This is operations
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
        "mx-auto flex w-full flex-col gap-8 px-6 py-8",
        wide ? "max-w-6xl" : "max-w-4xl",
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
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {eyebrow}
          </span>
        )}
        <h1 className="text-2xl font-semibold leading-8 tracking-tight text-foreground">
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
              className="font-mono text-xs font-semibold text-muted-foreground"
            >
              {String(step).padStart(2, "0")}
            </span>
          )}
          <h2 className="text-base font-semibold tracking-tight text-foreground">
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
        "rounded-lg border p-5",
        tone === "danger"
          ? "border-destructive/40 bg-card"
          : tone === "muted"
            ? "border-border bg-muted/30"
            : "border-border bg-card",
        className,
      )}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

/** A small uppercase field label. */
export function FieldLabel({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
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
