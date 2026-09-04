"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  isLockedStatus,
  isUnavailableStatus,
  UNAVAILABLE_MESSAGE,
  useDemoUnlock,
} from "@/components/access/use-demo-unlock";
import type { C01IdempotencyProfile } from "@/lib/demo-profile/service";

/**
 * Phase 5 — the operator control for the controlled C01 Demo Merchant
 * profile (docs/DEMO_PLAN.md Section 9, docs/CHAOS_SCENARIOS.md Section 43).
 *
 * IT HIDES NOTHING. docs/DEMO_PLAN.md Section 9 is explicit: "The application
 * must never hide the fact that the vulnerable path exists specifically for
 * reliability testing." So the current mode is stated plainly at every scroll
 * position of this panel, the vulnerable state is visually obvious, and the
 * copy says exactly which path is affected. It is deliberately NOT alarming:
 * this is a controlled test behaviour, not an incident, and dressing it as a
 * warning siren would misrepresent what an operator is looking at.
 *
 * IT NEVER BLAMES RAZORPAY. The wording attributes the behaviour to the
 * PayChaos Demo Merchant, because that is whose code is wrong. Razorpay
 * delivering a webhook twice is normal, correct provider behaviour that a
 * merchant is required to tolerate — the defect being demonstrated is the
 * merchant's, and saying otherwise would be a false claim about a third
 * party.
 *
 * IT IS NOT AUTHORITATIVE. This component sends a request; the server
 * decides. The vulnerable behaviour itself is gated inside
 * `process_webhook_payment_event`, which reads the persisted profile
 * directly, so a tampered client cannot enable anything by lying about
 * state. The mode shown here is the mode the server last reported.
 */

const VULNERABLE: C01IdempotencyProfile = "VULNERABLE_IDEMPOTENCY";
const SAFE: C01IdempotencyProfile = "SAFE";

type Phase = "idle" | "running" | "error";

export function C01ProfilePanel({
  initialProfile,
  initialUnavailable = false,
}: {
  /** The server-rendered current mode, or null when it could not be read. */
  readonly initialProfile: C01IdempotencyProfile | null;
  /** True when the profile read failed, so the panel says so honestly. */
  readonly initialUnavailable?: boolean;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState<C01IdempotencyProfile | null>(
    initialProfile,
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const { requestUnlock, unlockDialog } = useDemoUnlock();

  const isBusy = phase === "running";
  const isVulnerable = profile === VULNERABLE;
  const target: C01IdempotencyProfile = isVulnerable ? SAFE : VULNERABLE;

  async function applyProfile(next: C01IdempotencyProfile) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase("running");
    setMessage(null);

    try {
      const response = await fetch("/api/demo/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: next }),
      });

      // Offer the code and resume the change the operator asked for, exactly
      // as every other protected control in the product does.
      if (isLockedStatus(response.status)) {
        inFlight.current = false;
        setPhase("idle");
        requestUnlock(() => void applyProfile(next));
        return;
      }
      if (isUnavailableStatus(response.status)) {
        setPhase("error");
        setMessage(UNAVAILABLE_MESSAGE);
        inFlight.current = false;
        return;
      }
      if (response.status === 403) {
        setPhase("error");
        setMessage(
          "Controlled test behavior is available in Razorpay Test Mode only.",
        );
        inFlight.current = false;
        return;
      }
      if (!response.ok) {
        setPhase("error");
        setMessage(
          "The controlled test profile could not be changed. The Demo " +
            "Merchant is still using its previous behavior.",
        );
        inFlight.current = false;
        return;
      }

      setProfile(next);
      setPhase("idle");
      inFlight.current = false;
      // The C01 scenario page and the run detail both describe this mode.
      router.refresh();
    } catch {
      setPhase("error");
      setMessage("The controlled test profile could not be changed.");
      inFlight.current = false;
    }
  }

  return (
    <section
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5"
      data-testid="c01-profile-panel"
    >
      {unlockDialog}

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Demo / test behavior
        </p>
        <h2 className="mt-1 text-sm font-semibold text-card-foreground">
          Controlled C01 vulnerability
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          PayChaos-controlled Demo Merchant test behavior. It changes how the
          Demo Merchant handles a duplicate business effect during a C01
          controlled replay, so the duplicate-delivery protection can be
          demonstrated failing and then proven fixed.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          This is a defect in the PayChaos Demo Merchant, deliberately enabled
          for reliability testing. It is not a defect in Razorpay, and it does
          not change webhook signature verification, payment processing, or any
          other scenario.
        </p>
      </div>

      {/* Current mode. Stated as a fact, with the vulnerable state visually
          distinct so it is never mistaken for the default at a glance. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Current mode:</span>
        {initialUnavailable && profile === null ? (
          <span
            className="inline-flex items-center rounded-md border border-border bg-muted px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
            data-testid="c01-profile-mode"
          >
            UNAVAILABLE
          </span>
        ) : (
          <span
            className={
              isVulnerable
                ? "inline-flex items-center gap-1.5 rounded-md border border-amber-400/60 bg-amber-50 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-800 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-300"
                : "inline-flex items-center gap-1.5 rounded-md border border-emerald-400/60 bg-emerald-50 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-950/40 dark:text-emerald-300"
            }
            data-testid="c01-profile-mode"
          >
            <span
              aria-hidden="true"
              className={
                isVulnerable
                  ? "h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                  : "h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
              }
            />
            {profile ?? SAFE}
          </span>
        )}
      </div>

      {/* The active-state explanation, shown only while vulnerable. Calm,
          specific, and scoped — an operator must be able to read exactly what
          is and is not affected. */}
      {isVulnerable && (
        <p
          className="rounded-md border border-amber-400/50 bg-amber-50/70 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-400/25 dark:bg-amber-950/30 dark:text-amber-200"
          data-testid="c01-profile-active-notice"
        >
          Controlled test behavior is enabled for the C01 PayChaos replay path
          only. Razorpay Test Mode only. Normal webhook handling, payment
          processing, and the C03, C07 and C11 scenarios are unaffected. A Demo
          Reset returns this to SAFE.
        </p>
      )}

      <div>
        <button
          type="button"
          onClick={() => void applyProfile(target)}
          disabled={isBusy || (initialUnavailable && profile === null)}
          className={
            isVulnerable
              ? "inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              : "inline-flex items-center justify-center rounded-md border border-amber-500/60 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60"
          }
          data-testid="c01-profile-submit"
        >
          {isBusy
            ? "Applying…"
            : isVulnerable
              ? "Use Safe Idempotency Profile"
              : "Enable C01 Vulnerable Profile"}
        </button>
      </div>

      {message !== null && (
        <p
          role="alert"
          aria-live="polite"
          className="text-sm text-destructive"
          data-testid="c01-profile-message"
        >
          {message}
        </p>
      )}
    </section>
  );
}
