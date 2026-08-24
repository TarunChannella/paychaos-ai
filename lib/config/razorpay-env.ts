/**
 * Phase 2A — server-only Razorpay Test Mode configuration.
 *
 * Holds `RAZORPAY_KEY_SECRET`, a critical secret used by later Phase 2
 * work for Razorpay API authentication and Checkout signature verification
 * (docs/RAZORPAY_GUIDE.md Section 49/50). It must never be imported from
 * client/browser code.
 *
 * The `server-only` package makes that a structural guarantee rather than
 * a naming convention (same pattern as lib/config/server-env.ts): importing
 * this module from a module that ends up in a client bundle fails at build
 * time, not just by review discipline.
 *
 * This module only validates and exposes configuration values. It does not
 * call the Razorpay API and does not construct an SDK/HTTP client — that is
 * later Phase 2 work (Phase 2B+).
 */
import "server-only";

import {
  requireExactValue,
  requireNonEmptyString,
  requirePrefixedString,
} from "./env-validation";

const RAZORPAY_TEST_MODE_VALUE = "test";
const RAZORPAY_TEST_KEY_ID_PREFIX = "rzp_test_";

export interface RazorpayEnv {
  readonly mode: "test";
  readonly keyId: string;
  readonly keySecret: string;
}

/**
 * Pure loader. Accepts an explicit `source` (defaulting to `process.env`)
 * so tests can inject obviously-fake values (e.g. a `rzp_test_...` Key ID
 * and an arbitrary non-empty fake Key Secret) without needing real
 * credentials.
 *
 * Fails closed (docs/SECURITY.md Section 19 Controls 1–2, RZP-CRED-003):
 *   - `RAZORPAY_MODE` must be present and equal exactly `"test"`;
 *   - `RAZORPAY_KEY_ID` must be present and start with `rzp_test_` — this
 *     also rejects a `rzp_live_` Key ID, since it does not share that
 *     prefix;
 *   - `RAZORPAY_KEY_SECRET` must be present and non-empty.
 *
 * The thrown error never includes the supplied value.
 */
export function loadRazorpayEnv(
  source: Record<string, string | undefined> = process.env,
): RazorpayEnv {
  requireExactValue(
    "RAZORPAY_MODE",
    source.RAZORPAY_MODE,
    RAZORPAY_TEST_MODE_VALUE,
  );

  const keyId = requirePrefixedString(
    "RAZORPAY_KEY_ID",
    source.RAZORPAY_KEY_ID,
    RAZORPAY_TEST_KEY_ID_PREFIX,
  );

  const keySecret = requireNonEmptyString(
    "RAZORPAY_KEY_SECRET",
    source.RAZORPAY_KEY_SECRET,
  );

  return {
    mode: RAZORPAY_TEST_MODE_VALUE,
    keyId,
    keySecret,
  };
}

let cachedRazorpayEnv: RazorpayEnv | undefined;

/**
 * Validated singleton for server-only application code. Validation runs
 * lazily on first access, not at module import time.
 */
export function getRazorpayEnv(): RazorpayEnv {
  if (!cachedRazorpayEnv) {
    cachedRazorpayEnv = loadRazorpayEnv();
  }
  return cachedRazorpayEnv;
}
