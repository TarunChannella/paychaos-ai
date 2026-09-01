"use client";

/**
 * Phase 5B — the console error boundary.
 *
 * IT NEVER GUESSES A CAUSE. The thrown error's text could carry a database
 * message, so it is not rendered. What the operator needs to know is stated
 * plainly instead: this screen failed to load, and that is NOT a statement
 * about their integration's health.
 *
 * RETRY IS OFFERED. Most failures here are a transient read, so `reset()` is
 * the correct first action rather than a dead end.
 */
export default function ConsoleError({ reset }: { reset: () => void }) {
  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 px-6 py-16"
      data-testid="route-error"
    >
      <h1 className="text-lg font-semibold text-foreground">
        This screen could not be loaded.
      </h1>
      <p className="text-sm text-muted-foreground">
        The evidence behind this page could not be read. This is a failure to
        load — it is not a result, and it says nothing about whether your
        integration is healthy. No score, verdict or finding count is shown
        rather than showing one that might be wrong.
      </p>
      <button
        type="button"
        onClick={reset}
        className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="route-error-retry"
      >
        Try again
      </button>
    </div>
  );
}
