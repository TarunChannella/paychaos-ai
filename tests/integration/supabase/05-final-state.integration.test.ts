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
 *   - no `fulfilments` row traces back (via `payment_id` ->
 *     `payments.payment_attempt_id` -> `payment_attempts.razorpay_receipt`)
 *     to a test-tagged `payment_attempts` row (the same
 *     `TEST_DATA_RECEIPT_PREFIX` marker used above) — detects a leaked
 *     TEST-OWNED fulfilment without asserting the whole table is empty.
 *
 * **Architect correction (Phase 3A regression-gate correction)**: this file
 * previously asserted a global `fulfilments` count of exactly 0, on the
 * Phase 1/2B-era assumption that "no Phase 1/2B code path ever inserts a
 * fulfilments row, real or test". That assumption stopped being true the
 * moment Phase 2F shipped `process_webhook_payment_event` — the RPC whose
 * entire purpose is to insert exactly one fulfilment on a genuinely
 * successful capture. The current architect-approved Phase 2G system
 * legitimately and permanently retains one real fulfilment row (the
 * documented proof of Phase 2F's exactly-once business-effect idempotency
 * against a real provider — `handoffs/PHASE-2-HANDOFF.md` Section 3411).
 * That row must never be deleted, excluded by hardcoded ID, or assumed to be
 * the only genuine fulfilment that will ever exist. The correct invariant is
 * the same shape as the orders/payment_attempts checks above: THIS RUN
 * leaves no TEST-OWNED fulfilment behind, not that the table is globally
 * empty of every fulfilment, genuine or synthetic.
 *
 * Legitimate non-test application data (e.g. the developer's real manual
 * Razorpay order/attempt/fulfilment) is explicitly NOT required to be absent
 * by any assertion in this file, and this file never reads, deletes,
 * updates, or otherwise touches it.
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

  it("no fulfilment leaked by this integration suite remains — detected by tracing payment_id -> payment_attempts.razorpay_receipt back to the shared test-run receipt prefix, never by asserting the whole table is empty (architect correction: genuine Phase 2G evidence may legitimately and permanently exist here)", async () => {
    const { data: fulfilments, error: fulfilmentsError } = await client
      .from("fulfilments")
      .select("id, payment_id");
    expect(fulfilmentsError).toBeNull();
    if (!fulfilments || fulfilments.length === 0) return;

    const { data: payments, error: paymentsError } = await client
      .from("payments")
      .select("id, payment_attempt_id")
      .in(
        "id",
        fulfilments.map((f) => f.payment_id),
      );
    expect(paymentsError).toBeNull();

    const attemptIds = (payments ?? [])
      .map((p) => p.payment_attempt_id)
      .filter((id): id is string => id !== null);
    if (attemptIds.length === 0) return;

    const { data: testTaggedAttempts, error: attemptsError } = await client
      .from("payment_attempts")
      .select("id")
      .in("id", attemptIds)
      .like("razorpay_receipt", `${TEST_DATA_RECEIPT_PREFIX}%`);
    expect(attemptsError).toBeNull();

    // A non-empty result here means some fulfilment in the table correlates
    // to a payment_attempts row this suite itself tagged — a genuine leak,
    // not the permanent genuine Phase 2G evidence (whose real Razorpay
    // receipt can never match this prefix — see helpers.ts).
    expect(testTaggedAttempts ?? []).toEqual([]);
  });
});
