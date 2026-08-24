/**
 * Phase 2D — server-only Razorpay webhook secret configuration.
 *
 * Deliberately a SEPARATE module from `lib/config/razorpay-env.ts`, and
 * deliberately NOT called from `instrumentation.ts`'s eager startup
 * validation. `RAZORPAY_WEBHOOK_SECRET` is only required once the webhook
 * route actually receives a request — the application must not
 * unnecessarily fail to start merely because the webhook secret has not
 * yet been manually configured (this task's Section 7). The webhook trust
 * path therefore validates its own secret lazily, on first use.
 *
 * Requirements (this task's Section 7, docs/RAZORPAY_GUIDE.md Section 15):
 *   - server-only;
 *   - at least 32 characters (PayChaos policy — docs/RAZORPAY_GUIDE.md
 *     Section 15: "be at least 32 random characters for PayChaos");
 *   - must not equal `RAZORPAY_KEY_SECRET` (docs/RAZORPAY_GUIDE.md
 *     "Mistake 12": "Using the API Key Secret as webhook secret").
 *
 * Fails closed (throws `EnvValidationError`, never including the supplied
 * value) on any violation — the caller (`lib/razorpay/webhook-verification.ts`)
 * must let that propagate rather than treating a configuration failure as
 * an ordinary "signature did not match" result.
 */
import "server-only";

import { EnvValidationError, requireNonEmptyString } from "./env-validation";

const MIN_WEBHOOK_SECRET_LENGTH = 32;

/**
 * Pure loader. Accepts an explicit `source` (defaulting to `process.env`)
 * so tests can inject obviously-fake secrets without needing real
 * credentials.
 */
export function loadRazorpayWebhookSecret(
  source: Record<string, string | undefined> = process.env,
): string {
  const secret = requireNonEmptyString(
    "RAZORPAY_WEBHOOK_SECRET",
    source.RAZORPAY_WEBHOOK_SECRET,
  );

  if (secret.length < MIN_WEBHOOK_SECRET_LENGTH) {
    throw new EnvValidationError(
      "RAZORPAY_WEBHOOK_SECRET",
      `Environment variable RAZORPAY_WEBHOOK_SECRET must be at least ${MIN_WEBHOOK_SECRET_LENGTH} characters`,
    );
  }

  // RAZORPAY_KEY_SECRET is required at application startup
  // (lib/config/razorpay-env.ts, instrumentation.ts) and is therefore
  // already present by the time any request reaches the webhook route in
  // a running server — but this module is intentionally decoupled from
  // that eager validation, so the comparison stays defensive rather than
  // assuming it.
  const apiKeySecret = source.RAZORPAY_KEY_SECRET;
  if (apiKeySecret !== undefined && secret === apiKeySecret) {
    throw new EnvValidationError(
      "RAZORPAY_WEBHOOK_SECRET",
      "Environment variable RAZORPAY_WEBHOOK_SECRET must not equal RAZORPAY_KEY_SECRET",
    );
  }

  return secret;
}

let cachedWebhookSecret: string | undefined;

/**
 * Validated accessor for server-only webhook-verification code. Validation
 * runs lazily on first access (not at module import time, and not at
 * application startup) so a not-yet-configured webhook secret never
 * prevents the rest of the application from starting. A failed validation
 * is not cached, so a later call (e.g. after the developer sets the
 * variable and restarts) re-validates fresh.
 */
export function getRazorpayWebhookSecret(): string {
  if (!cachedWebhookSecret) {
    cachedWebhookSecret = loadRazorpayWebhookSecret();
  }
  return cachedWebhookSecret;
}
