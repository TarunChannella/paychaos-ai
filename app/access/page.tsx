"use client";

/**
 * Phase 2G readiness — minimal operator access-gate login screen.
 *
 * `middleware.ts` redirects an unauthenticated request for a protected path
 * here (with `?next=<original path>`). Submits the operator's token to
 * `POST /api/access/login`; on success, navigates to `next` (or
 * `/demo-merchant` by default). Deliberately not protected by
 * `middleware.ts` itself — this IS how a session gets created.
 *
 * No dashboard, no account system — a single token field, matching
 * docs/SECURITY.md's "No user record is required" P0 access-gate model.
 *
 * PHASE 5B — HONEST TRANSITION FEEDBACK. Authentication semantics are
 * unchanged; only what the operator SEES changed. Previously the success path
 * called `router.push()` and never cleared `isSubmitting`, so the button read
 * "Verifying…" for the entire soft navigation while the destination server
 * component made its Supabase round-trips. The session was already valid — it
 * simply looked stuck, which reads like a failure and invites a second submit.
 *
 * The fix distinguishes the two phases the operator is actually in:
 * "Verifying…" while the token is being checked, then "Signing in…" once it
 * has been ACCEPTED and navigation is under way. `router.replace` is used so
 * the browser Back button does not return to a login screen the operator has
 * already passed.
 *
 * DOUBLE SUBMIT IS STILL IMPOSSIBLE. The form is disabled from the first
 * submit until either an error is shown or navigation completes, and an
 * in-flight guard rejects a duplicate submit even if a key event slips past
 * the disabled attribute.
 */
import { type FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const GENERIC_ERROR_MESSAGE =
  "Could not verify the access token. Please try again.";

type Phase = "idle" | "verifying" | "redirecting";

function resolveNextPath(): string {
  if (typeof window === "undefined") return "/demo-merchant";
  const next = new URLSearchParams(window.location.search).get("next");
  // Only ever navigate to an internal path — never follow an absolute/
  // protocol-relative URL from a query parameter (open-redirect guard).
  return next && next.startsWith("/") && !next.startsWith("//")
    ? next
    : "/demo-merchant";
}

export default function AccessLoginPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  /** Belt-and-braces against a duplicate submit racing the disabled state. */
  const inFlight = useRef(false);

  const isBusy = phase !== "idle";

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
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        setError(GENERIC_ERROR_MESSAGE);
        setPhase("idle");
        inFlight.current = false;
        return;
      }

      // The session cookie is set by the response above, so from here the
      // operator IS authenticated. Say so, rather than continuing to claim
      // we are still verifying them.
      setPhase("redirecting");
      router.replace(resolveNextPath());
      router.refresh();
    } catch {
      setError(GENERIC_ERROR_MESSAGE);
      setPhase("idle");
      inFlight.current = false;
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-6 px-6 py-24">
      <h1 className="text-center text-2xl font-semibold tracking-tight text-foreground">
        PayChaos AI — Operator Access
      </h1>
      <p className="text-center text-sm text-muted-foreground">
        This deployment is protected. Enter the operator access token to
        continue.
      </p>

      <form
        onSubmit={handleSubmit}
        className="flex w-full flex-col gap-3"
        data-testid="access-login-form"
      >
        <label htmlFor="access-token" className="sr-only">
          Operator access token
        </label>
        <input
          id="access-token"
          name="access-token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          disabled={isBusy}
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : "access-token-error"}
          placeholder="Access token"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          data-testid="access-token-input"
        />
        <button
          type="submit"
          disabled={isBusy || token.trim().length === 0}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          data-testid="access-token-submit"
        >
          {phase === "verifying"
            ? "Verifying…"
            : phase === "redirecting"
              ? "Signing in…"
              : "Continue"}
        </button>

        {/* Announced to assistive tech without stealing focus. */}
        <p
          aria-live="polite"
          className="text-center text-xs text-muted-foreground"
          data-testid="access-token-status"
        >
          {phase === "redirecting"
            ? "Access token accepted. Opening the console…"
            : ""}
        </p>

        {error && (
          <p
            id="access-token-error"
            role="alert"
            className="text-center text-sm text-destructive"
            data-testid="access-token-error"
          >
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
