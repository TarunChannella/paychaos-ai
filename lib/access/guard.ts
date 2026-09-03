import "server-only";

import { cookies } from "next/headers";

import { ACCESS_SESSION_COOKIE_NAME, verifySessionToken } from "./session";
import { getAccessGateEnv } from "@/lib/config/access-env";

/**
 * Phase 5 — the interactive-demo authorization check for SERVER ACTIONS.
 *
 * WHY THIS EXISTS. Read-only pages are public so a Buildathon reviewer can
 * explore the product without a code. Making a page public, however, must not
 * make the things it can DO public — and Next.js routes a Server Action POST
 * through the page's own URL, so the four Demo Merchant actions were relying
 * entirely on the middleware that used to guard `/demo-merchant`.
 *
 * Opening that page without gating the actions first would have published
 * order creation, Razorpay order creation, Checkout preparation and Checkout
 * verification to anyone with the URL. This module is what makes the page
 * safe to open: authorization moves from "you cannot look at this" to "you
 * cannot change anything", enforced where the change actually happens.
 *
 * THE SERVER IS AUTHORITATIVE. A dialog that hides a button is a courtesy to
 * the operator, never a control. Every mutating entry point calls this, and
 * a direct POST from a script reaches exactly the same check.
 *
 * IT FAILS CLOSED. An enabled-but-misconfigured gate denies rather than
 * falling open, matching the middleware and every protected API route. The
 * caller receives only a coarse decision — never the configuration detail
 * behind it.
 */

export type InteractiveAccessDecision =
  /** A valid signed session is present, or the gate is disabled by config. */
  | "granted"
  /** No valid session. The caller should offer the unlock dialog. */
  | "denied"
  /** The gate is enabled but its configuration is unusable. */
  | "misconfigured";

/**
 * Whether the current request may perform a state-changing demo action.
 *
 * Reads only the signed session cookie. It never reads, returns or logs the
 * access code itself, and it never reports WHICH part of the configuration is
 * wrong — both would turn an authorization check into an oracle.
 */
export async function checkInteractiveAccess(): Promise<InteractiveAccessDecision> {
  let env;
  try {
    env = getAccessGateEnv();
  } catch {
    return "misconfigured";
  }

  // `disabled` is the documented default for trusted local development. It is
  // a deployment responsibility to enable the gate in public environments;
  // this code cannot detect that on its own and must not pretend to.
  if (env.mode === "disabled") return "granted";

  const store = await cookies();
  const cookie = store.get(ACCESS_SESSION_COOKIE_NAME)?.value;
  if (cookie === undefined) return "denied";

  // `sessionSecret` is guaranteed non-null when the mode is "enabled".
  return verifySessionToken(env.sessionSecret as string, cookie)
    ? "granted"
    : "denied";
}

/** The stable reason a caller may surface. Never configuration detail. */
export const INTERACTIVE_ACCESS_LOCKED = "INTERACTIVE_ACCESS_LOCKED" as const;
export const INTERACTIVE_ACCESS_UNAVAILABLE =
  "INTERACTIVE_ACCESS_UNAVAILABLE" as const;

/** Operator-facing copy. Deliberately says nothing about configuration. */
export const INTERACTIVE_ACCESS_LOCKED_MESSAGE =
  "Interactive actions require the Demo Access Code.";
export const INTERACTIVE_ACCESS_UNAVAILABLE_MESSAGE =
  "Interactive demo access is currently unavailable.";
