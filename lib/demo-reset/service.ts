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
 *
 * A FAILURE MUST BE DIAGNOSABLE. The first version of this module discarded
 * the Supabase error entirely and returned a bare failure. When the deployed
 * site then failed, the operator had no way to tell an unreachable function
 * from a genuine constraint violation — the same opaque red box for causes
 * with completely different remedies. The error is still NEVER forwarded to
 * the browser, but it is now CLASSIFIED into a small closed set of stable
 * reasons the server can log.
 *
 * The classification matters most for `RESET_FUNCTION_UNAVAILABLE`. The
 * application reaches the database through PostgREST, which serves RPCs from
 * a CACHED schema; direct SQL does not. A function that exists and works in
 * the SQL editor can still be invisible to the API until that cache reloads,
 * which looks exactly like "the reset is broken" while the database is fine.
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

/**
 * Why a reset did not apply — a closed set of OUR OWN identifiers.
 *
 * Never a database message. These exist so the server log can distinguish
 * causes whose remedies differ completely; the browser sees none of them.
 */
export type DemoResetFailureReason =
  /** PostgREST cannot see the function: migration unapplied, or stale cache. */
  | "RESET_FUNCTION_UNAVAILABLE"
  /** The credential may not execute it — a grant problem, not a data problem. */
  | "RESET_NOT_PERMITTED"
  /** A foreign key refused a delete: the order would be wrong again. */
  | "RESET_CONSTRAINT_VIOLATION"
  /** Anything else. */
  | "RESET_FAILED";

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
  /**
   * SERVER-SIDE DIAGNOSTIC ONLY. Null on success. The route may log this;
   * it must never appear in an HTTP response body.
   */
  readonly failureReason: DemoResetFailureReason | null;
  /**
   * SERVER-SIDE DIAGNOSTIC ONLY. The provider's own stable error code, e.g.
   * "PGRST301" or "57014" — verbatim, because that identifier is exactly
   * what makes an unrecognised failure searchable.
   *
   * Deliberately ONLY `error.code`. `message`, `details` and `hint` are
   * discarded at this boundary: they are prose written by the database and
   * routinely quote table names, column names, constraint names and even
   * row values. A code is an identifier; the rest is content.
   *
   * Like `failureReason`, this must never appear in an HTTP response body —
   * it describes deployment state to anyone who can reach the endpoint.
   */
  readonly providerErrorCode: string | null;
}

/**
 * Accepts a provider error code only if it is plausibly an identifier.
 *
 * Defensive because the value crosses a trust boundary into a log line: a
 * non-string, or something long enough to be a message rather than a code,
 * is dropped entirely rather than truncated into something misleading.
 */
const MAX_PROVIDER_CODE_LENGTH = 32;

function safeProviderCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_PROVIDER_CODE_LENGTH) return null;
  return trimmed;
}

function failed(
  reason: DemoResetFailureReason,
  providerErrorCode: string | null = null,
): DemoResetResult {
  return {
    ok: false,
    resetApplied: false,
    deletedCounts: null,
    failureReason: reason,
    providerErrorCode,
  };
}

/**
 * Maps a Supabase/PostgREST error onto one of our own reasons.
 *
 * Only the stable `code` is inspected — never the human-readable message,
 * which can carry table, column and constraint detail.
 */
function classify(error: { code?: string | null }): DemoResetFailureReason {
  switch (error.code ?? "") {
    // PGRST202: no function matching the request was found in the exposed
    // schema. 42883: PostgreSQL's own undefined_function.
    case "PGRST202":
    case "42883":
      return "RESET_FUNCTION_UNAVAILABLE";
    // 42501 insufficient_privilege.
    case "42501":
      return "RESET_NOT_PERMITTED";
    // 23503 foreign_key_violation — a deletion-order regression.
    case "23503":
      return "RESET_CONSTRAINT_VIOLATION";
    default:
      return "RESET_FAILED";
  }
}

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
  // Only our own classification of its stable code survives this boundary.
  if (error !== null) {
    // Only the code survives this boundary. `error.message`, `error.details`
    // and `error.hint` are never read, so they cannot reach a log line.
    return failed(
      classify(error),
      safeProviderCode((error as { code?: unknown }).code),
    );
  }

  // SUCCESS IS DECIDED BY THE ABSENCE OF AN ERROR, AND BY NOTHING ELSE.
  // In particular an unreadable or unexpected count payload must never be
  // downgraded to a failure: the transaction has already committed by then,
  // so reporting failure would tell the operator the database is untouched
  // when it has in fact been reset — the most damaging lie this surface
  // could tell. `deletedCounts` is reporting detail, not the verdict.
  return {
    ok: true,
    resetApplied: true,
    deletedCounts: readCounts(data),
    failureReason: null,
    providerErrorCode: null,
  };
}
