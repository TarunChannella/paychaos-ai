import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Phase 5B — the deterministic administrative Demo Reset.
 *
 * WHAT IT IS. The single documented operation that returns the controlled
 * Demo Merchant to a known empty runtime state between demonstrations
 * (docs/DEMO_PLAN.md Section 73, docs/TESTING.md "Demo Reset",
 * docs/DATABASE.md Section 39). `invariant_results` retains its `DELETE`
 * privilege for `service_role` *solely* so this operation can exist.
 *
 * IT IS NOT A GENERIC DELETE ENDPOINT. The table list is a frozen constant in
 * this module. No caller — route, UI or test — can name a table, supply a
 * predicate, widen the scope or change the order. There is deliberately no
 * `resetTable(name)` and no parameter of any kind: the only thing a caller
 * can do is run exactly this, or nothing.
 *
 * ORDER IS A CORRECTNESS PROPERTY. Deletion runs child-before-parent so
 * foreign keys are never violated mid-reset. The order is the one the
 * documentation specifies and is asserted by test, not left to chance.
 *
 * IT PRESERVES EVERYTHING THAT IS NOT RUNTIME DATA. No schema change, no
 * migration change, no RLS change, no environment value, no Razorpay
 * configuration and no source-controlled fixture is touched. It issues
 * `DELETE` and nothing else — no `DROP`, no `TRUNCATE`, no `ALTER`, no SQL
 * string, no RPC.
 *
 * A PARTIAL RESET IS REPORTED, NOT HIDDEN. If one table fails the operation
 * stops and returns which step failed, with the tables already cleared. A
 * reset that silently half-succeeded would leave a demo in a state nobody
 * can reason about.
 */

/**
 * The runtime/demo tables, child-before-parent.
 *
 * Frozen. Adding a table here is a documentation-level decision, not an
 * implementation detail.
 */
export const DEMO_RESET_TABLES = Object.freeze([
  "regression_runs",
  "findings",
  "invariant_results",
  "event_processing_attempts",
  "chaos_runs",
  "webhook_events",
  "fulfilments",
  "payments",
  "payment_attempts",
  "orders",
] as const);

export type DemoResetTable = (typeof DEMO_RESET_TABLES)[number];

export interface DemoResetResult {
  readonly ok: boolean;
  /** Tables successfully cleared, in the order they were cleared. */
  readonly clearedTables: readonly DemoResetTable[];
  /** The table whose delete failed, when `ok` is false. */
  readonly failedTable: DemoResetTable | null;
}

/**
 * Clears every documented runtime/demo table, in dependency-safe order.
 *
 * Takes no arguments by design: there is no scope for a caller to influence.
 */
export async function runDemoReset(): Promise<DemoResetResult> {
  const client = getSupabaseServerClient();
  const clearedTables: DemoResetTable[] = [];

  for (const table of DEMO_RESET_TABLES) {
    // `.delete()` requires a filter, so this matches every row by asserting
    // the primary key is present — the deliberate, readable "all rows of
    // exactly this table" form. It is not a caller-supplied predicate.
    const { error } = await client.from(table).delete().not("id", "is", null);

    if (error !== null) {
      // Stop at the first failure: continuing would delete parents whose
      // children still exist, or report a clean reset that did not happen.
      // The raw database message is never forwarded.
      return { ok: false, clearedTables, failedTable: table };
    }
    clearedTables.push(table);
  }

  return { ok: true, clearedTables, failedTable: null };
}
