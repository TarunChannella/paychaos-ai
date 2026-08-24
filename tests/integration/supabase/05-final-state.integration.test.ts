import { describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";

import {
  TEST_DATA_RECEIPT_PREFIX,
  allCreatedAttemptIds,
  allCreatedOrderIds,
} from "./helpers";

/**
 * Phase 1C-B Tasks 8 & 12 — mandatory final cleanup / end-state
 * verification, run LAST (numeric filename prefix + this suite's
 * `fileParallelism: false` / `isolate: false` config keep file execution
 * sequential and share `tests/integration/supabase/helpers.ts` module
 * state across every file).
 *
 * **Phase 2B test-gate correction**: this file previously asserted that
 * the entire `orders`/`payment_attempts` tables were globally empty after
 * the suite. That assumption broke as soon as the developer's first real
 * Razorpay Test Mode manual-verification order and its real failed
 * Attempt #1 began to legitimately persist in the same Supabase project —
 * by explicit instruction, that row must never be deleted, mutated, or
 * otherwise treated as test data by any automated test. This file now
 * proves only that TEST-OWNED data does not leak, never that the tables
 * are empty:
 *
 *   - every order/payment_attempt ID this run's own append-only ledger
 *     tracked is actually gone (`allCreatedOrderIds`/`allCreatedAttemptIds`
 *     — a real service-role SELECT, not just trusting each file's own
 *     cleanup). This is the achievable precision for `orders`: that table
 *     has no test-tagging column of its own, so a ledger of this run's own
 *     IDs is the strongest ownership check available without a schema
 *     change;
 *   - no `payment_attempts` row anywhere carries the stable
 *     `integration-test-` receipt prefix any run of this suite has ever
 *     used (`TEST_DATA_RECEIPT_PREFIX`) — stronger than a ledger check
 *     alone, since it also catches a leak from a *previous* run, not just
 *     this one. This can never false-positive against real application
 *     data: `lib/demo-merchant/service.ts`'s real Razorpay receipt
 *     generator always produces a `pc_...`-prefixed value, a disjoint
 *     namespace from `integration-test-...`;
 *   - `fulfilments` count is exactly 0 — unaffected by this correction.
 *     No Phase 1/2B code path ever inserts a fulfilments row, real or
 *     test, so this remains a true global invariant, not a stale
 *     assumption tied to the absence of manual data.
 *
 * Legitimate non-test application data (e.g. the developer's real manual
 * Razorpay order/attempt) is explicitly NOT required to be absent by any
 * assertion in this file, and this file never reads, deletes, updates, or
 * otherwise touches it.
 *
 * No destructive/broad operation (no TRUNCATE, no unscoped DELETE, no
 * migration/reset) is ever performed by this suite.
 */
describe("Task 8/12 — final end-state verification for this integration run", () => {
  const client = getSupabaseServerClient();

  it("this run actually created and tracked at least one order and one payment_attempt", () => {
    // Sanity check on the ledgers themselves: if this were empty, file
    // execution order broke and the checks below would be vacuously true
    // rather than meaningful. Confirms earlier files really ran first.
    expect(allCreatedOrderIds.length).toBeGreaterThan(0);
    expect(allCreatedAttemptIds.length).toBeGreaterThan(0);
  });

  it("none of this run's created orders remain in the database", async () => {
    if (allCreatedOrderIds.length === 0) return;
    const { data, error } = await client
      .from("orders")
      .select("id")
      .in("id", allCreatedOrderIds);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("none of this run's created payment_attempts remain in the database", async () => {
    if (allCreatedAttemptIds.length === 0) return;
    const { data, error } = await client
      .from("payment_attempts")
      .select("id")
      .in("id", allCreatedAttemptIds);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("no payment_attempts row carrying the stable integration-test receipt prefix remains, from this run or any prior run", async () => {
    const { data, error } = await client
      .from("payment_attempts")
      .select("id")
      .like("razorpay_receipt", `${TEST_DATA_RECEIPT_PREFIX}%`);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("fulfilments count is exactly 0 (Phase 1/2B must never persist a fulfilment row, real or test)", async () => {
    const { count, error } = await client
      .from("fulfilments")
      .select("id", { count: "exact", head: true });
    expect(error).toBeNull();
    expect(count).toBe(0);
  });
});
