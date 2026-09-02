import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Phase 5 — the deterministic administrative Demo Reset.
 *
 * WHAT IT IS. The single documented operation that returns the controlled
 * Demo Merchant to a known empty runtime state between demonstrations
 * (docs/DEMO_PLAN.md, docs/TESTING.md "Demo Reset", docs/DATABASE.md).
 *
 * IT IS ATOMIC, AND THAT IS THE POINT OF THIS MODULE.
 *
 * This previously issued ten independent Supabase DELETE requests in a loop.
 * A real production reset failed on `event_processing_attempts`, and because
 * each delete was its own request, the ones before it had already committed —
 * leaving the database partially reset, the exact state a reset exists to
 * make impossible. The order was also wrong: `fulfilments` references
 * `event_processing_attempts` ON DELETE RESTRICT, so the delete could never
 * have succeeded while any webhook-produced fulfilment existed.
 *
 * Both faults are now fixed in one place. The whole reset is a single
 * PostgreSQL function (`public.reset_paychaos_demo_runtime`) that deletes the
 * ten tables in verified child-before-parent order inside one transaction. If
 * any delete fails, every earlier delete in the same call rolls back.
 *
 * There is therefore NO partial-success state left to report, and this module
 * deliberately no longer has a `clearedTables` / `failedTable` vocabulary: a
 * shape that can describe a half-finished reset invites code and copy that
 * pretend one is survivable.
 *
 * IT IS NOT A GENERIC DELETE ENDPOINT. `runDemoReset()` takes no arguments
 * and calls one argument-less function. No caller — route, UI or test — can
 * name a table, supply a predicate, widen the scope or change the order. The
 * order now lives in the database function, where it is enforced rather than
 * merely intended.
 *
 * IT PRESERVES EVERYTHING THAT IS NOT RUNTIME DATA. No schema change, no
 * migration change, no RLS change, no environment value and no Razorpay
 * configuration is touched.
 */

/**
 * The runtime/demo tables cleared by the reset, child-before-parent.
 *
 * DOCUMENTATION AND TEST SURFACE ONLY — this constant no longer drives
 * execution. The authoritative order is the statement sequence inside
 * `public.reset_paychaos_demo_runtime()`; the migration test asserts the two
 * agree, so this cannot drift into a comfortable fiction.
 */
export const DEMO_RESET_TABLES = Object.freeze([
  "fulfilments",
  "regression_runs",
  "event_processing_attempts",
  "findings",
  "invariant_results",
  "chaos_runs",
  "webhook_events",
  "payments",
  "payment_attempts",
  "orders",
] as const);

export type DemoResetTable = (typeof DEMO_RESET_TABLES)[number];

/** The database function that performs the whole reset in one transaction. */
export const DEMO_RESET_RPC = "reset_paychaos_demo_runtime";

export interface DemoResetResult {
  readonly ok: boolean;
  /**
   * Whether any row was deleted at all.
   *
   * Always equal to `ok`, and stated explicitly because the caller's job is
   * to tell an operator the truth: on failure NOTHING was applied, not "some
   * of it was". It is a separate field so the route and the UI cannot
   * accidentally imply a partial reset again.
   */
  readonly resetApplied: boolean;
  /** Rows deleted per table on success; null when nothing was applied. */
  readonly deletedCounts: Readonly<Record<string, number>> | null;
}

const FAILED: DemoResetResult = Object.freeze({
  ok: false,
  resetApplied: false,
  deletedCounts: null,
});

/** Coerces the function's jsonb result into plain counts, defensively. */
function readCounts(data: unknown): Record<string, number> | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }
  const counts: Record<string, number> = {};
  for (const [table, value] of Object.entries(
    data as Record<string, unknown>,
  )) {
    if (typeof value === "number" && Number.isFinite(value)) {
      counts[table] = value;
    }
  }
  return counts;
}

/**
 * Clears every documented runtime/demo table in one transaction.
 *
 * Takes no arguments by design: there is no scope for a caller to influence.
 * Either the whole reset applied, or none of it did.
 */
export async function runDemoReset(): Promise<DemoResetResult> {
  const client = getSupabaseServerClient();

  const { data, error } = await client.rpc(DEMO_RESET_RPC);

  // The raw database message is never forwarded — it can carry table,
  // constraint and column detail that does not belong in an HTTP response.
  if (error !== null) return FAILED;

  return {
    ok: true,
    resetApplied: true,
    deletedCounts: readCounts(data),
  };
}
