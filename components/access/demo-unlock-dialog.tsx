"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";

/**
 * PayChaos AI — the interactive-demo unlock dialog.
 *
 * WHAT IT IS FOR. Reading the product is public. The moment a visitor tries to
 * CHANGE the controlled Test Mode environment, they need the Demo Access Code
 * — and being bounced to a separate login page mid-action loses both their
 * place and their intent. This asks in context, once per session.
 *
 * IT IS NOT THE SECURITY BOUNDARY. It cannot be: it runs in the browser. Every
 * mutating Server Action and API route performs its own server-side session
 * check, so a visitor who never opens this dialog and posts directly is
 * refused by the same code that refuses everyone else. This dialog exists so
 * an authorized reviewer is not made to guess why a button did nothing.
 *
 * THE CODE NEVER LIVES HERE. It is typed, POSTed to the existing
 * `/api/access/login` endpoint, and forgotten. It is never held in component
 * state beyond the keystroke, never written to storage, never placed in a URL
 * and never logged. The server replies with a signed HttpOnly cookie the
 * browser cannot read.
 */

const GENERIC_ERROR = "Invalid Demo Access Code.";
const UNAVAILABLE_ERROR = "Interactive demo access is currently unavailable.";

type Phase = "idle" | "verifying";

export function DemoUnlockDialog({
  open,
  onClose,
  onUnlocked,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Called after a session is established, so the caller can continue. */
  readonly onUnlocked: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const inFlight = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the field when the dialog opens: the visitor asked for this by
  // clicking, so the next keystroke should go where they expect.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    inFlight.current = true;
    setError(null);
    setPhase("verifying");

    try {
      const response = await fetch("/api/access/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: code }),
      });

      if (!response.ok) {
        // 503 means the gate is enabled but unusable. The visitor is told the
        // feature is unavailable, never what is wrong with the configuration.
        setError(response.status === 503 ? UNAVAILABLE_ERROR : GENERIC_ERROR);
        setPhase("idle");
        inFlight.current = false;
        return;
      }

      // The session now lives in an HttpOnly cookie. Nothing about the code
      // is retained here.
      setCode("");
      setPhase("idle");
      inFlight.current = false;
      onUnlocked();
    } catch {
      setError(GENERIC_ERROR);
      setPhase("idle");
      inFlight.current = false;
    }
  }

  const isBusy = phase === "verifying";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/45 p-4 backdrop-blur-[2px] sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="demo-unlock-title"
      data-testid="demo-unlock-dialog"
    >
      {/* Clicking the backdrop dismisses, matching every dialog convention. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        tabIndex={-1}
      />

      <div className="relative w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl">
        <h2
          id="demo-unlock-title"
          className="text-[17px] font-semibold tracking-tight text-foreground"
        >
          Unlock Interactive Demo
        </h2>
        <p className="mt-2 text-[13.5px] leading-6 text-muted-foreground">
          Interactive actions modify this controlled Razorpay Test Mode
          environment. Enter the Demo Access Code supplied with the Buildathon
          submission.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
          <label
            htmlFor="demo-access-code"
            className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
          >
            Demo Access Code
          </label>
          <input
            ref={inputRef}
            id="demo-access-code"
            name="demo-access-code"
            type="password"
            autoComplete="off"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={isBusy}
            aria-invalid={error !== null}
            aria-describedby={error === null ? undefined : "demo-unlock-error"}
            className="w-full rounded-[10px] border border-border bg-card px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            data-testid="demo-unlock-input"
          />

          {error !== null && (
            <p
              id="demo-unlock-error"
              role="alert"
              className="text-[13px] text-destructive"
              data-testid="demo-unlock-error"
            >
              {error}
            </p>
          )}

          <div className="mt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isBusy}
              className="inline-flex min-h-[40px] items-center justify-center rounded-[10px] border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isBusy || code.trim().length === 0}
              className="inline-flex min-h-[40px] items-center justify-center rounded-[10px] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-[var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              data-testid="demo-unlock-submit"
            >
              {isBusy ? "Unlocking…" : "Unlock Demo"}
            </button>
          </div>
        </form>

        <p className="mt-4 border-t border-border pt-3 text-[12px] text-muted-foreground">
          Razorpay Test Mode only · No real money is used
        </p>
      </div>
    </div>
  );
}
