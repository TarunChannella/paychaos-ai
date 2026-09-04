/**
 * Phase 5 — the controlled C01 Demo Merchant test-behaviour profile.
 *
 * WHY THIS MODULE EXISTS. docs/DEMO_PLAN.md Section 9 and
 * docs/CHAOS_SCENARIOS.md Section 43 require an operator-controlled
 * vulnerable Demo Merchant profile so the frozen primary demonstration
 * (docs/CHAOS_SCENARIOS.md Section 44) can show a REAL deterministic
 * failure rather than a narrated one. This is the server-side read/write
 * boundary for that profile.
 *
 * THE DATABASE IS AUTHORITATIVE, NOT THIS MODULE AND NOT THE UI. The
 * vulnerable behaviour itself lives inside `process_webhook_payment_event`
 * and reads `demo_merchant_profile` directly, so flipping a client-side
 * toggle can never change merchant behaviour on its own. This module only
 * persists the operator's choice and reports it back for display.
 *
 * TEST MODE IS ENFORCED HERE AS WELL AS STRUCTURALLY. The application
 * already refuses to boot unless `RAZORPAY_MODE=test` and `RAZORPAY_KEY_ID`
 * carries the `rzp_test_` prefix (`instrumentation.ts` ->
 * `lib/config/razorpay-env.ts`), so a live-key process cannot reach this
 * code at all. `assertTestMode()` below is a second, explicit,
 * defence-in-depth check at the exact point the profile changes, so the
 * Test-Mode requirement is stated where a reader looks for it rather than
 * only being implied three modules away.
 *
 * Never logs the profile value together with any credential, and reads no
 * secret of any kind.
 */
import "server-only";

import { getRazorpayEnv } from "@/lib/config/razorpay-env";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The two approved profiles. `SAFE` is the default and the only state a
 * fresh or freshly reset system is ever in.
 */
export const C01_IDEMPOTENCY_PROFILES = Object.freeze([
  "SAFE",
  "VULNERABLE_IDEMPOTENCY",
] as const);

export type C01IdempotencyProfile = (typeof C01_IDEMPOTENCY_PROFILES)[number];

export const DEFAULT_C01_IDEMPOTENCY_PROFILE: C01IdempotencyProfile = "SAFE";

/** The singleton table and its fixed primary key. */
export const DEMO_PROFILE_TABLE = "demo_merchant_profile";
const SINGLETON_ID = true;

export type DemoProfileFailureReason =
  | "PROFILE_TABLE_UNAVAILABLE"
  | "PROFILE_NOT_PERMITTED"
  | "PROFILE_INVALID_VALUE"
  | "PROFILE_NOT_TEST_MODE"
  | "PROFILE_READ_FAILED"
  | "PROFILE_WRITE_FAILED";

export interface DemoProfileResult {
  readonly ok: boolean;
  readonly profile: C01IdempotencyProfile | null;
  readonly failureReason: DemoProfileFailureReason | null;
}

/**
 * A narrowing type guard, used at both the API boundary (untrusted request
 * body) and when reading the column back (untrusted only in the sense that
 * the type system cannot prove the CHECK constraint).
 */
export function isC01IdempotencyProfile(
  value: unknown,
): value is C01IdempotencyProfile {
  return (
    typeof value === "string" &&
    (C01_IDEMPOTENCY_PROFILES as readonly string[]).includes(value)
  );
}

function failed(reason: DemoProfileFailureReason): DemoProfileResult {
  return { ok: false, profile: null, failureReason: reason };
}

function succeeded(profile: C01IdempotencyProfile): DemoProfileResult {
  return { ok: true, profile, failureReason: null };
}

/**
 * Maps a PostgREST error to a stable internal reason. Deliberately mirrors
 * `lib/demo-reset/service.ts`'s `classify`: the message, details and hint
 * are never surfaced, only the shape of the failure.
 */
function classify(
  error: { code?: string | null },
  fallback: DemoProfileFailureReason,
): DemoProfileFailureReason {
  const code = typeof error.code === "string" ? error.code : "";
  // 42P01 undefined_table — the migration has not been applied.
  if (code === "42P01") return "PROFILE_TABLE_UNAVAILABLE";
  // 42501 insufficient_privilege / RLS refusal.
  if (code === "42501") return "PROFILE_NOT_PERMITTED";
  // 23514 check_violation — a value outside the approved two.
  if (code === "23514") return "PROFILE_INVALID_VALUE";
  return fallback;
}

/**
 * Razorpay Test Mode is a precondition for changing the profile at all.
 *
 * `getRazorpayEnv()` throws when the configuration is not Test Mode, and its
 * `mode` is the literal type `"test"` — so the equality check below is
 * belt-and-braces against a future widening of that type rather than a
 * condition that can fail today. Both layers are intentional: the point of
 * this function is that the Test-Mode requirement is impossible to remove
 * accidentally without a test noticing.
 */
function isTestMode(): boolean {
  try {
    return getRazorpayEnv().mode === "test";
  } catch {
    return false;
  }
}

/**
 * Reads the current profile. A read failure returns a failure result rather
 * than defaulting to `SAFE`: quietly reporting SAFE when the real state is
 * unknown would tell an operator the demo merchant is healthy on no
 * evidence, which is the precise class of false claim this product exists
 * to eliminate.
 */
export async function readC01IdempotencyProfile(): Promise<DemoProfileResult> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from(DEMO_PROFILE_TABLE)
    .select("c01_idempotency_profile")
    .eq("id", SINGLETON_ID)
    .maybeSingle();

  if (error) return failed(classify(error, "PROFILE_READ_FAILED"));

  // No row at all means the migration's seed insert did not run. That is a
  // deployment problem, not a SAFE merchant.
  if (data === null) return failed("PROFILE_TABLE_UNAVAILABLE");

  const value = (data as { c01_idempotency_profile?: unknown })
    .c01_idempotency_profile;
  if (!isC01IdempotencyProfile(value)) return failed("PROFILE_READ_FAILED");

  return succeeded(value);
}

/**
 * Persists a new profile.
 *
 * Authorization is NOT performed here — it belongs to the route, which owns
 * the session cookie and the existing Demo Access Code contract
 * (`app/api/demo/profile/route.ts`). Keeping it there means there is exactly
 * one authorization mechanism in the product rather than two that can drift.
 */
export async function setC01IdempotencyProfile(
  profile: C01IdempotencyProfile,
): Promise<DemoProfileResult> {
  if (!isC01IdempotencyProfile(profile)) {
    return failed("PROFILE_INVALID_VALUE");
  }

  if (!isTestMode()) {
    return failed("PROFILE_NOT_TEST_MODE");
  }

  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from(DEMO_PROFILE_TABLE)
    .update({
      c01_idempotency_profile: profile,
      updated_at: new Date().toISOString(),
    })
    .eq("id", SINGLETON_ID)
    .select("c01_idempotency_profile")
    .maybeSingle();

  if (error) return failed(classify(error, "PROFILE_WRITE_FAILED"));
  if (data === null) return failed("PROFILE_TABLE_UNAVAILABLE");

  const value = (data as { c01_idempotency_profile?: unknown })
    .c01_idempotency_profile;
  if (!isC01IdempotencyProfile(value)) return failed("PROFILE_WRITE_FAILED");

  return succeeded(value);
}
