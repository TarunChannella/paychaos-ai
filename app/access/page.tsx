"use client";

/**
 * Phase 2G readiness — minimal operator access-gate login screen.
 *
 * `middleware.ts` redirects an unauthenticated request for `/demo-merchant`
 * here (with `?next=<original path>`). Submits the operator's token to
 * `POST /api/access/login`; on success, navigates to `next` (or
 * `/demo-merchant` by default). Deliberately not protected by
 * `middleware.ts` itself — this IS how a session gets created.
 *
 * No dashboard, no account system — a single token field, matching
 * docs/SECURITY.md's "No user record is required" P0 access-gate model.
 */
import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const GENERIC_ERROR_MESSAGE =
  "Could not verify the access token. Please try again.";

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
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/access/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        setError(GENERIC_ERROR_MESSAGE);
        setIsSubmitting(false);
        return;
      }

      router.push(resolveNextPath());
      router.refresh();
    } catch {
      setError(GENERIC_ERROR_MESSAGE);
      setIsSubmitting(false);
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
        <input
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Access token"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          data-testid="access-token-input"
        />
        <button
          type="submit"
          disabled={isSubmitting || token.trim().length === 0}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          data-testid="access-token-submit"
        >
          {isSubmitting ? "Verifying…" : "Continue"}
        </button>
        {error && (
          <p
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
