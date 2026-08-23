import { describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";

import {
  TEST_RUN_TAG,
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
 * This does not perform cleanup itself — every earlier file cleans up its
 * own rows via try/finally (with an afterAll defensive fallback). This
 * file independently RE-VERIFIES, via real service-role SELECTs, that:
 *   - every order/payment_attempt ID this run ever created (the
 *     append-only ledgers in helpers.ts) is actually gone;
 *   - no payment_attempts row tagged with this run's receipt prefix
 *     remains, independent of the local ID ledger;
 *   - the orders and payment_attempts tables are fully empty (the
 *     developer-confirmed pre-existing baseline for this project was 0
 *     rows in all three Phase 1 tables, and nothing else should be
 *     writing to this project concurrently);
 *   - fulfilments count is exactly 0 (Phase 1 must never persist a
 *     fulfilments row, regardless of this run).
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

  it("no payment_attempts row tagged with this run's receipt prefix remains", async () => {
    const { data, error } = await client
      .from("payment_attempts")
      .select("id")
      .like("razorpay_receipt", `${TEST_RUN_TAG}%`);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("orders table is fully empty after this suite", async () => {
    const { count, error } = await client
      .from("orders")
      .select("id", { count: "exact", head: true });
    expect(error).toBeNull();
    expect(count).toBe(0);
  });

  it("payment_attempts table is fully empty after this suite", async () => {
    const { count, error } = await client
      .from("payment_attempts")
      .select("id", { count: "exact", head: true });
    expect(error).toBeNull();
    expect(count).toBe(0);
  });

  it("fulfilments count is exactly 0 (Phase 1 must never persist a fulfilment row)", async () => {
    const { count, error } = await client
      .from("fulfilments")
      .select("id", { count: "exact", head: true });
    expect(error).toBeNull();
    expect(count).toBe(0);
  });
});
