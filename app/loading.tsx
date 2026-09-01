/**
 * Phase 5B — the global route-transition fallback.
 *
 * WHY IT MATTERS HERE. Every console screen is a server component that reads
 * persisted evidence, so a cold navigation genuinely takes time. Without a
 * fallback the App Router simply holds the previous screen, which reads as a
 * frozen application — the exact confusion the Operator Access "Verifying…"
 * report described.
 *
 * IT ASSERTS NOTHING. A skeleton shows that data is ON ITS WAY. It never
 * renders a zero, a score, a verdict or an empty list, because a placeholder
 * that looks like a result is a lie the moment it is wrong.
 */
export default function Loading() {
  return (
    <div
      className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10"
      data-testid="route-loading"
    >
      <span className="sr-only" role="status">
        Loading…
      </span>
      <div className="h-7 w-56 animate-pulse rounded-md bg-muted" />
      <div className="h-4 w-80 animate-pulse rounded-md bg-muted" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="h-28 animate-pulse rounded-lg bg-muted" />
        <div className="h-28 animate-pulse rounded-lg bg-muted" />
      </div>
      <div className="h-48 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
