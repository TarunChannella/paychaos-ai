"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Phase 5B — the operator control for the documented Demo Reset.
 *
 * DESTRUCTIVE, SO INTENT IS EXPLICIT. The action is irreversible, so a single
 * misplaced click must not be able to trigger it: the operator types the word
 * RESET before the button becomes usable. That is deliberately more friction
 * than a confirm dialog, because this clears every chaos run, finding,
 * invariant result and payment record the demo has accumulated.
 *
 * IT CHOOSES NOTHING. The request carries no body. The table list, the order
 * and the scope live entirely in `lib/demo-reset/service.ts`; this component
 * cannot widen them.
 *
 * NO DOUBLE SUBMIT. The button disables on the first click and an in-flight
 * ref rejects a duplicate even if a key event races the disabled attribute.
 *
 * FAILURE IS SHOWN AS FAILURE. A partial reset names the table that failed
 * rather than reporting success — an operator who believes the demo is clean
 * when it is not will misread everything they see next.
 */

const CONFIRM_WORD = "RESET";

type Phase = "idle" | "running" | "done" | "error";

export function DemoResetPanel() {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  const isArmed = confirmation.trim().toUpperCase() === CONFIRM_WORD;
  const isBusy = phase === "running";

  async function handleReset() {
    if (inFlight.current || !isArmed) return;
    inFlight.current = true;
    setPhase("running");
    setMessage(null);

    try {
      const response = await fetch("/api/demo/reset", { method: "POST" });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const failedTable =
          body !== null &&
          typeof body === "object" &&
          "failedTable" in body &&
          typeof (body as { failedTable: unknown }).failedTable === "string"
            ? (body as { failedTable: string }).failedTable
            : null;
        setPhase("error");
        setMessage(
          failedTable === null
            ? "The demo reset did not complete. No further tables were cleared."
            : `The demo reset stopped at "${failedTable}". Earlier tables were cleared; later ones were not.`,
        );
        inFlight.current = false;
        return;
      }

      const cleared =
        body !== null &&
        typeof body === "object" &&
        "clearedTables" in body &&
        Array.isArray((body as { clearedTables: unknown }).clearedTables)
          ? (body as { clearedTables: unknown[] }).clearedTables.length
          : 0;

      setPhase("done");
      setMessage(
        `Demo reset complete. ${cleared} runtime tables were cleared. Schema, migrations, RLS and configuration were not touched.`,
      );
      setConfirmation("");
      inFlight.current = false;
      // Every derived screen (score, readiness, findings) is now stale.
      router.refresh();
    } catch {
      setPhase("error");
      setMessage("The demo reset could not be performed.");
      inFlight.current = false;
    }
  }

  return (
    <section
      className="flex flex-col gap-4 rounded-lg border border-destructive/40 bg-card p-5"
      data-testid="demo-reset-panel"
    >
      <div>
        <h2 className="text-sm font-semibold text-card-foreground">
          Demo Reset
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Returns the controlled Demo Merchant to a known empty state by
          clearing every runtime record: regression runs, findings, invariant
          results, processing attempts, chaos runs, webhook events, fulfilments,
          payments, payment attempts and orders.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Database schema, migration history, RLS policies, environment values,
          Razorpay configuration and source-controlled fixtures are preserved.
          This cannot be undone.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor="demo-reset-confirm" className="sr-only">
          Type {CONFIRM_WORD} to confirm
        </label>
        <input
          id="demo-reset-confirm"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          disabled={isBusy}
          placeholder={`Type ${CONFIRM_WORD} to confirm`}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:max-w-xs"
          data-testid="demo-reset-confirm"
        />
        <button
          type="button"
          onClick={handleReset}
          disabled={!isArmed || isBusy}
          className="inline-flex items-center justify-center rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          data-testid="demo-reset-submit"
        >
          {isBusy ? "Resetting…" : "Reset demo data"}
        </button>
      </div>

      {message !== null && (
        <p
          role={phase === "error" ? "alert" : "status"}
          aria-live="polite"
          className={
            phase === "error"
              ? "text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
          data-testid="demo-reset-message"
        >
          {message}
        </p>
      )}
    </section>
  );
}
