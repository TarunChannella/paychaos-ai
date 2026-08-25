/**
 * Phase 2G readiness — server-only operator access-gate configuration.
 *
 * Implements docs/SECURITY.md Section 17 ("P0 Access Gate") /
 * docs/ARCHITECTURE.md ADR-A16 / docs/PHASE_PLAN.md Section 6.4 item 2
 * ("minimal single-workspace operator access gate for any public
 * payment-enabled deployment").
 *
 * Deliberately mirrors `lib/config/razorpay-webhook-env.ts`'s structure and
 * lazy-validation philosophy, NOT `lib/config/razorpay-env.ts`'s eager
 * startup validation: `PAYCHAOS_ACCESS_GATE` must be safe to leave entirely
 * unset for trusted local development (docs/SECURITY.md "The access gate
 * may be disabled only for trusted local development") without blocking
 * `npm run dev`/existing tests/e2e — exactly like `RAZORPAY_WEBHOOK_SECRET`
 * is not required until the webhook route actually receives a request. This
 * module is therefore NOT called from `instrumentation.ts`.
 *
 * Contract:
 *   - `PAYCHAOS_ACCESS_GATE` unset, empty, or exactly `"disabled"` ->
 *     gate disabled (mode `"disabled"`, no token/secret required or read).
 *   - `PAYCHAOS_ACCESS_GATE === "enabled"` -> gate active; both
 *     `PAYCHAOS_ACCESS_TOKEN` (a high-entropy operator token) and
 *     `PAYCHAOS_SESSION_SECRET` (the HMAC key for signed session cookies,
 *     `lib/access/session.ts`) become required, minimum-length, and
 *     mutually distinct — fails closed otherwise.
 *   - any other `PAYCHAOS_ACCESS_GATE` value (a typo like `"true"`/`"1"`) is
 *     REJECTED rather than silently treated as either state — an
 *     unrecognized value must never be interpreted as "disabled" (that
 *     would silently leave a publicly deployed instance open) or as
 *     "enabled" (that would silently start requiring login nobody
 *     configured).
 *
 * Never logs or includes a supplied token/secret value in a thrown error
 * (docs/SECURITY.md ENV-007), matching every other module in
 * `lib/config/`.
 */
import "server-only";

import { EnvValidationError, requireNonEmptyString } from "./env-validation";

export type AccessGateMode = "enabled" | "disabled";

export interface AccessGateEnv {
  readonly mode: AccessGateMode;
  /** Non-null only when `mode === "enabled"`. */
  readonly accessToken: string | null;
  /** Non-null only when `mode === "enabled"`. */
  readonly sessionSecret: string | null;
}

/**
 * PayChaos policy minimums — "high-entropy" per docs/SECURITY.md's
 * recommended model. Not a real cryptographic bound (no library enforces
 * actual entropy here, matching `RAZORPAY_WEBHOOK_SECRET`'s existing
 * length-only policy), but rejects obviously-too-short/guessable values.
 */
const MIN_ACCESS_TOKEN_LENGTH = 20;
const MIN_SESSION_SECRET_LENGTH = 32;

function parseAccessGateMode(value: string | undefined): AccessGateMode {
  if (value === undefined || value.trim().length === 0) {
    return "disabled";
  }
  if (value === "disabled") {
    return "disabled";
  }
  if (value === "enabled") {
    return "enabled";
  }
  throw new EnvValidationError(
    "PAYCHAOS_ACCESS_GATE",
    'Environment variable PAYCHAOS_ACCESS_GATE must be "enabled", "disabled", or unset (treated as "disabled")',
  );
}

/**
 * Pure loader. Accepts an explicit `source` (defaulting to `process.env`)
 * so tests can inject obviously-fake values without needing a real
 * deployment secret — same pattern as every other `lib/config/*.ts` loader.
 */
export function loadAccessGateEnv(
  source: Record<string, string | undefined> = process.env,
): AccessGateEnv {
  const mode = parseAccessGateMode(source.PAYCHAOS_ACCESS_GATE);

  if (mode === "disabled") {
    return { mode, accessToken: null, sessionSecret: null };
  }

  const accessToken = requireNonEmptyString(
    "PAYCHAOS_ACCESS_TOKEN",
    source.PAYCHAOS_ACCESS_TOKEN,
  );
  if (accessToken.length < MIN_ACCESS_TOKEN_LENGTH) {
    throw new EnvValidationError(
      "PAYCHAOS_ACCESS_TOKEN",
      `Environment variable PAYCHAOS_ACCESS_TOKEN must be at least ${MIN_ACCESS_TOKEN_LENGTH} characters`,
    );
  }

  const sessionSecret = requireNonEmptyString(
    "PAYCHAOS_SESSION_SECRET",
    source.PAYCHAOS_SESSION_SECRET,
  );
  if (sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new EnvValidationError(
      "PAYCHAOS_SESSION_SECRET",
      `Environment variable PAYCHAOS_SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters`,
    );
  }

  if (accessToken === sessionSecret) {
    throw new EnvValidationError(
      "PAYCHAOS_SESSION_SECRET",
      "Environment variable PAYCHAOS_SESSION_SECRET must not equal PAYCHAOS_ACCESS_TOKEN",
    );
  }

  return { mode, accessToken, sessionSecret };
}

let cachedAccessGateEnv: AccessGateEnv | undefined;

/**
 * Validated accessor for server-only access-gate code
 * (`lib/access/session.ts`, `middleware.ts`,
 * `app/api/access/login/route.ts`). Validation runs lazily on first access
 * (not at module import time, and not at application startup via
 * `instrumentation.ts`) so an unconfigured gate never prevents local
 * development from starting. A failed validation is not cached, so a later
 * call (e.g. after the developer sets the variables and restarts) re-
 * validates fresh — same pattern as `getRazorpayWebhookSecret()`.
 */
export function getAccessGateEnv(): AccessGateEnv {
  if (!cachedAccessGateEnv) {
    cachedAccessGateEnv = loadAccessGateEnv();
  }
  return cachedAccessGateEnv;
}
