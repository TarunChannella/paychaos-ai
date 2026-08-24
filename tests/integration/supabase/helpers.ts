/**
 * Phase 1C-B — shared helpers/state for the real-network Supabase
 * integration suite (tests/integration/supabase/*.integration.test.ts).
 *
 * This suite is NOT part of the offline unit suite: vitest.config.ts only
 * includes tests/unit/**, so `npm run test` never loads this file or opens
 * a network connection. It runs only via
 * `npm run test:integration:supabase`, which uses
 * vitest.integration.config.ts.
 *
 * That config sets `isolate: false` + `fileParallelism: false` +
 * `poolOptions.threads.singleThread: true` specifically so this module is
 * imported ONCE per suite run and its module-level state (TEST_RUN_TAG,
 * the created-ID ledgers) is shared across every *.integration.test.ts
 * file, in the same fixed sequential order every time (numeric filename
 * prefixes). This lets:
 *   - every row this suite creates share one unique tag
 *     (`razorpay_receipt` for payment_attempts, `idempotency_key` for the
 *     orphan-only fulfilments check);
 *   - a final "end state" test file independently re-verify — via a real
 *     service-role SELECT, not just trusting earlier assertions — that
 *     every row this run created has actually been deleted.
 *
 * This is a deliberate, integration-suite-only relaxation of Vitest's
 * default per-file isolation. It is never used for the offline unit suite.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getClientEnv } from "@/lib/config/client-env";
import type { Database } from "@/lib/supabase/types";

/**
 * Stable prefix shared by every value `taggedValue()` has ever produced,
 * across every run of this suite — NOT specific to the current process
 * (that's `TEST_RUN_TAG` below, which is this same prefix plus a per-run
 * UUID). Used by the final-state suite (Phase 2B test-gate correction) to
 * detect a `payment_attempts` leak from ANY past run, not merely the
 * current one, while never matching real application data: no receipt
 * this application's own Razorpay integration generates can start with
 * this prefix — `lib/demo-merchant/service.ts`'s `generateRazorpayReceipt`
 * always produces a `pc_...`-prefixed value, a disjoint namespace.
 */
export const TEST_DATA_RECEIPT_PREFIX = "integration-test-";

/**
 * One unique tag for this entire suite run/process. Never printed/logged
 * beyond being embedded in ordinary non-secret identifiers (receipts,
 * idempotency keys) that are themselves safe to log.
 */
export const TEST_RUN_TAG = `${TEST_DATA_RECEIPT_PREFIX}${randomUUID()}`;

/** Builds a unique, tagged `razorpay_receipt` / `idempotency_key` value. */
export function taggedValue(label: string): string {
  return `${TEST_RUN_TAG}-${label}-${randomUUID()}`;
}

// Append-only ledgers: every ID this suite successfully creates is pushed
// here and NEVER removed, even after that row is deleted by the file that
// created it. The final end-state test file uses these to independently
// prove — via a real SELECT — that none of them still exist.
export const allCreatedOrderIds: string[] = [];
export const allCreatedAttemptIds: string[] = [];

export function trackOrder(id: string): void {
  allCreatedOrderIds.push(id);
}

export function trackAttempt(id: string): void {
  allCreatedAttemptIds.push(id);
}

let cachedAnonClient: SupabaseClient<Database> | undefined;

/**
 * Test-only unprivileged Supabase client, built from ONLY the client-safe
 * NEXT_PUBLIC_* variables (never the service-role key) via the existing
 * validated `getClientEnv()` accessor. Used exclusively to prove RLS/grant
 * denial from the same untrusted position a browser would occupy (Task 7).
 * Production application code never constructs a client this way outside
 * an actual browser context.
 */
export function getAnonClientForTest(): SupabaseClient<Database> {
  if (!cachedAnonClient) {
    const { supabaseUrl, supabaseAnonKey } = getClientEnv();
    cachedAnonClient = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cachedAnonClient;
}

/** Minimal valid `orders` insert payload for this suite (amount > 0, INR). */
export function testOrderInsert(
  amountSubunits: number,
): Database["public"]["Tables"]["orders"]["Insert"] {
  return {
    amount_subunits: amountSubunits,
    currency: "INR",
    payment_status: "UNPAID",
    business_status: "OPEN",
  };
}
