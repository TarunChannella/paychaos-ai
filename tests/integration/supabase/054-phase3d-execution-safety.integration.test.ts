import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

import { testOrderInsert, trackOrder } from "./helpers";

/**
 * Phase 3D-0 — proves the execution-block audit + C07 concurrency SCHEMA
 * (migration `20260831000000_phase3d_execution_safety.sql`) against the
 * REAL Supabase project.
 *
 * *** NOT RUNNABLE YET ***. This migration has not been manually applied to
 * the remote project — every test in this file will fail with a
 * PostgREST "column ... does not exist" / constraint-not-found style error
 * until that manual application happens. That failure is expected and must
 * be reported honestly, not hidden or worked around.
 *
 * This file tests SCHEMA/CONSTRAINT/INDEX behavior only. It does not
 * execute a chaos mechanism, does not call any C03/C07/C11 service or
 * repository function, and does not import lib/chaos/run-repository.ts's
 * lifecycle-transition helpers — every row here is inserted/updated
 * directly against `chaos_runs` via the service-role client, exactly the
 * same style tests/integration/supabase/052-chaos-run-persistence
 * .integration.test.ts already uses for Phase 3B's own constraint proofs.
 *
 * Cleanup discipline (this task's Section 7): this file owns every row it
 * creates. `chaos_runs` rows are deleted before the `orders` rows they
 * reference (chaos_runs.order_id is ON DELETE RESTRICT), by exact ID only —
 * never a broad delete. Final zero-row assertions re-verify via a real
 * SELECT, not merely by trusting earlier assertions.
 */

const client = getSupabaseServerClient();

const outstandingChaosRunIds: string[] = [];
const outstandingOrderIds: string[] = [];

async function insertChaosRun(
  row: Database["public"]["Tables"]["chaos_runs"]["Insert"],
): Promise<{ id: string } | null> {
  const { data, error } = await client
    .from("chaos_runs")
    .insert(row)
    .select("id")
    .single();
  if (data) {
    outstandingChaosRunIds.push(data.id);
  }
  return error ? null : data;
}

/**
 * PostgREST/Supabase-js surfaces the raw Postgres error as
 * `{ code, message, details, hint }` — `code` is the stable 5-character
 * SQLSTATE (23514 = check_violation, 23505 = unique_violation; the same
 * codes already asserted throughout this suite, e.g.
 * tests/integration/supabase/03-constraints.integration.test.ts,
 * 048-webhook-events, 049-event-processing-attempts). Postgres's own
 * `message` for both violation types names the constraint/index verbatim
 * (e.g. `violates check constraint "chaos_runs_blocked_state_consistent"` /
 * `violates unique constraint "chaos_runs_one_active_c07_fault_per_order_idx"`)
 * — asserting a `.toContain()` on that name is a stable, non-fragile check
 * (it does not depend on the surrounding human-readable sentence), unlike
 * asserting the full message text.
 */
type PostgrestLikeError = {
  code?: string;
  message?: string;
  details?: string | null;
} | null;

function expectCheckViolation(
  error: PostgrestLikeError,
  constraintName: string,
): void {
  expect(error).not.toBeNull();
  expect(error?.code).toBe("23514");
  const haystack = `${error?.message ?? ""} ${error?.details ?? ""}`;
  expect(haystack).toContain(constraintName);
}

function expectUniqueViolation(
  error: PostgrestLikeError,
  indexOrConstraintName: string,
): void {
  expect(error).not.toBeNull();
  expect(error?.code).toBe("23505");
  const haystack = `${error?.message ?? ""} ${error?.details ?? ""}`;
  expect(haystack).toContain(indexOrConstraintName);
}

async function insertTestOrder(): Promise<string> {
  const { data, error } = await client
    .from("orders")
    .insert(testOrderInsert(50000))
    .select("id")
    .single();
  expect(error).toBeNull();
  expect(data).not.toBeNull();
  const id = data!.id;
  outstandingOrderIds.push(id);
  trackOrder(id);
  return id;
}

describe("Phase 3D-0 — execution_block_code CHECK constraints (real Supabase)", () => {
  it("A: PRE-SEC-007 BLOCKED shape is accepted — status=COMPLETED, outcome=BLOCKED, execution_block_code=PRE-SEC-007, failed_precheck_id=NULL", async () => {
    const result = await insertChaosRun({
      scenario_id: "C03",
      status: "COMPLETED",
      outcome: "BLOCKED",
      failed_precheck_id: null,
      execution_block_code: "PRE-SEC-007",
      error_message_redacted: "Required server secrets were unavailable.",
      started_at: null,
      completed_at: new Date().toISOString(),
      data_classification: "SYNTHETIC_DEMO",
    } as Database["public"]["Tables"]["chaos_runs"]["Insert"]);
    expect(result).not.toBeNull();
    if (!result) return;

    const { data } = await client
      .from("chaos_runs")
      .select("*")
      .eq("id", result.id)
      .single();
    expect(data?.outcome).toBe("BLOCKED");
    expect(data?.execution_block_code).toBe("PRE-SEC-007");
    expect(data?.failed_precheck_id).toBeNull();
  });

  it("B: the traditional Phase 3A BLOCKED shape (failed_precheck_id set, execution_block_code NULL) is still accepted unchanged", async () => {
    const result = await insertChaosRun({
      scenario_id: "C03",
      status: "COMPLETED",
      outcome: "BLOCKED",
      failed_precheck_id: "PRECHECK-09",
      execution_block_code: null,
      error_message_redacted: "safe reason",
      started_at: null,
      completed_at: new Date().toISOString(),
      data_classification: "SYNTHETIC_DEMO",
    });
    expect(result).not.toBeNull();
    if (!result) return;

    const { data } = await client
      .from("chaos_runs")
      .select("*")
      .eq("id", result.id)
      .single();
    expect(data?.outcome).toBe("BLOCKED");
    expect(data?.failed_precheck_id).toBe("PRECHECK-09");
    expect(data?.execution_block_code).toBeNull();
  });

  it("C: a BLOCKED row with BOTH failed_precheck_id and execution_block_code set fails chaos_runs_blocked_state_consistent specifically (23514) — execution_block_code itself is a valid value (PRE-SEC-007) and status/outcome/error/timestamps otherwise satisfy the constraint, isolating the XOR violation", async () => {
    const { error } = await client
      .from("chaos_runs")
      .insert({
        scenario_id: "C03",
        status: "COMPLETED",
        outcome: "BLOCKED",
        failed_precheck_id: "PRECHECK-09",
        execution_block_code: "PRE-SEC-007",
        error_message_redacted: "safe reason",
        started_at: null,
        completed_at: new Date().toISOString(),
        data_classification: "SYNTHETIC_DEMO",
      } as Database["public"]["Tables"]["chaos_runs"]["Insert"])
      .select()
      .single();
    expectCheckViolation(error, "chaos_runs_blocked_state_consistent");
  });

  it("D: a BLOCKED row with NEITHER failed_precheck_id nor execution_block_code set fails chaos_runs_blocked_state_consistent specifically (23514) — execution_block_code_valid and pending_state_consistent are not implicated (status is COMPLETED, execution_block_code is NULL, a universally valid value)", async () => {
    const { error } = await client
      .from("chaos_runs")
      .insert({
        scenario_id: "C03",
        status: "COMPLETED",
        outcome: "BLOCKED",
        failed_precheck_id: null,
        execution_block_code: null,
        error_message_redacted: "safe reason",
        started_at: null,
        completed_at: new Date().toISOString(),
        data_classification: "SYNTHETIC_DEMO",
      } as Database["public"]["Tables"]["chaos_runs"]["Insert"])
      .select()
      .single();
    expectCheckViolation(error, "chaos_runs_blocked_state_consistent");
  });

  it("E: a non-BLOCKED outcome carrying execution_block_code fails chaos_runs_blocked_state_consistent specifically (23514) — status is COMPLETED (not PENDING, so pending_state_consistent is not implicated) and execution_block_code itself is the valid PRE-SEC-007 value (so execution_block_code_valid is not implicated)", async () => {
    const { error } = await client
      .from("chaos_runs")
      .insert({
        scenario_id: "C03",
        status: "COMPLETED",
        outcome: "PASS",
        failed_precheck_id: null,
        execution_block_code: "PRE-SEC-007",
        data_classification: "SYNTHETIC_DEMO",
      } as Database["public"]["Tables"]["chaos_runs"]["Insert"])
      .select()
      .single();
    expectCheckViolation(error, "chaos_runs_blocked_state_consistent");
  });

  it("F: a PENDING row carrying execution_block_code is rejected (23514) by the PENDING/BLOCKED consistency rule — status=PENDING forces outcome IS DISTINCT FROM 'BLOCKED' to be true (outcome is NULL here), so chaos_runs_blocked_state_consistent's own non-BLOCKED branch (which also requires execution_block_code IS NULL) is violated at the same time as chaos_runs_pending_state_consistent; the two constraints encode the identical requirement for this exact row shape (status=PENDING can never satisfy the BLOCKED branch, which requires status=COMPLETED), so which one Postgres reports first is implementation-defined and this test deliberately accepts either name rather than asserting a fragile ordering", async () => {
    const { error } = await client
      .from("chaos_runs")
      .insert({
        scenario_id: "C03",
        status: "PENDING",
        execution_block_code: "PRE-SEC-007",
        data_classification: "SYNTHETIC_DEMO",
      } as Database["public"]["Tables"]["chaos_runs"]["Insert"])
      .select()
      .single();
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
    const haystack = `${error?.message ?? ""} ${error?.details ?? ""}`;
    expect(haystack).toMatch(
      /chaos_runs_pending_state_consistent|chaos_runs_blocked_state_consistent/,
    );
  });

  it("G: an invalid execution_block_code value fails chaos_runs_execution_block_code_valid specifically (23514) — no PRE-SEC-010/011/other value is ever accepted; the row otherwise satisfies chaos_runs_blocked_state_consistent (failed_precheck_id NULL, execution_block_code non-null, so the constraint's XOR branch is satisfied), isolating the value-list violation", async () => {
    const { error } = await client
      .from("chaos_runs")
      .insert({
        scenario_id: "C03",
        status: "COMPLETED",
        outcome: "BLOCKED",
        failed_precheck_id: null,
        execution_block_code: "PRE-SEC-010",
        error_message_redacted: "safe reason",
        started_at: null,
        completed_at: new Date().toISOString(),
        data_classification: "SYNTHETIC_DEMO",
      } as unknown as Database["public"]["Tables"]["chaos_runs"]["Insert"])
      .select()
      .single();
    expectCheckViolation(error, "chaos_runs_execution_block_code_valid");
  });
});

describe("Phase 3D-0 — C07 one-active-fault-per-order concurrency (real Supabase)", () => {
  it("H: two PENDING C07 runs for the SAME order — the first transitions to RUNNING, the second fails chaos_runs_one_active_c07_fault_per_order_idx specifically (23505)", async () => {
    const orderId = await insertTestOrder();

    const first = await insertChaosRun({
      scenario_id: "C07",
      fault_type: "DROP_CLIENT_CONFIRMATION",
      order_id: orderId,
      status: "PENDING",
      data_classification: "SYNTHETIC_DEMO",
    });
    const second = await insertChaosRun({
      scenario_id: "C07",
      fault_type: "DROP_CLIENT_CONFIRMATION",
      order_id: orderId,
      status: "PENDING",
      data_classification: "SYNTHETIC_DEMO",
    });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) return;

    const { error: firstRunningError } = await client
      .from("chaos_runs")
      .update({ status: "RUNNING", started_at: new Date().toISOString() })
      .eq("id", first.id);
    expect(firstRunningError).toBeNull();

    const { error: secondRunningError } = await client
      .from("chaos_runs")
      .update({ status: "RUNNING", started_at: new Date().toISOString() })
      .eq("id", second.id);
    expectUniqueViolation(
      secondRunningError,
      "chaos_runs_one_active_c07_fault_per_order_idx",
    );

    const { data: secondAfter } = await client
      .from("chaos_runs")
      .select("status")
      .eq("id", second.id)
      .single();
    expect(secondAfter?.status).toBe("PENDING");
  });

  it("I: two RUNNING C07 runs for TWO DIFFERENT orders are both allowed (per-order isolation, not a global switch)", async () => {
    const orderIdA = await insertTestOrder();
    const orderIdB = await insertTestOrder();

    const runA = await insertChaosRun({
      scenario_id: "C07",
      fault_type: "DROP_CLIENT_CONFIRMATION",
      order_id: orderIdA,
      status: "PENDING",
      data_classification: "SYNTHETIC_DEMO",
    });
    const runB = await insertChaosRun({
      scenario_id: "C07",
      fault_type: "DROP_CLIENT_CONFIRMATION",
      order_id: orderIdB,
      status: "PENDING",
      data_classification: "SYNTHETIC_DEMO",
    });
    expect(runA).not.toBeNull();
    expect(runB).not.toBeNull();
    if (!runA || !runB) return;

    const { error: errorA } = await client
      .from("chaos_runs")
      .update({ status: "RUNNING", started_at: new Date().toISOString() })
      .eq("id", runA.id);
    const { error: errorB } = await client
      .from("chaos_runs")
      .update({ status: "RUNNING", started_at: new Date().toISOString() })
      .eq("id", runB.id);
    expect(errorA).toBeNull();
    expect(errorB).toBeNull();

    const { data } = await client
      .from("chaos_runs")
      .select("id, status")
      .in("id", [runA.id, runB.id]);
    expect(data?.every((row) => row.status === "RUNNING")).toBe(true);
  });

  it("J: once the first same-order run leaves RUNNING (terminal state), a second run for that order may become RUNNING", async () => {
    const orderId = await insertTestOrder();

    const first = await insertChaosRun({
      scenario_id: "C07",
      fault_type: "DROP_CLIENT_CONFIRMATION",
      order_id: orderId,
      status: "PENDING",
      data_classification: "SYNTHETIC_DEMO",
    });
    const second = await insertChaosRun({
      scenario_id: "C07",
      fault_type: "DROP_CLIENT_CONFIRMATION",
      order_id: orderId,
      status: "PENDING",
      data_classification: "SYNTHETIC_DEMO",
    });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) return;

    const { error: firstRunningError } = await client
      .from("chaos_runs")
      .update({ status: "RUNNING", started_at: new Date().toISOString() })
      .eq("id", first.id);
    expect(firstRunningError).toBeNull();

    // Release: move the first run to a terminal COMPLETED/UNKNOWN state —
    // the index predicate no longer counts it once status <> 'RUNNING'.
    const { error: releaseError } = await client
      .from("chaos_runs")
      .update({
        status: "COMPLETED",
        outcome: "UNKNOWN",
        completed_at: new Date().toISOString(),
      })
      .eq("id", first.id);
    expect(releaseError).toBeNull();

    const { error: secondRunningError } = await client
      .from("chaos_runs")
      .update({ status: "RUNNING", started_at: new Date().toISOString() })
      .eq("id", second.id);
    expect(secondRunningError).toBeNull();

    const { data: secondAfter } = await client
      .from("chaos_runs")
      .select("status")
      .eq("id", second.id)
      .single();
    expect(secondAfter?.status).toBe("RUNNING");
  });
});

afterAll(async () => {
  // FK-safe child->parent cleanup: chaos_runs (child, ON DELETE RESTRICT on
  // order_id) before orders (parent). Exact-ID-scoped only.
  const chaosRunIds = outstandingChaosRunIds;
  for (let i = 0; i < chaosRunIds.length; i += 50) {
    const chunk = chaosRunIds.slice(i, i + 50);
    if (chunk.length === 0) continue;
    await client.from("chaos_runs").delete().in("id", chunk);
  }

  const orderIds = outstandingOrderIds;
  for (let i = 0; i < orderIds.length; i += 50) {
    const chunk = orderIds.slice(i, i + 50);
    if (chunk.length === 0) continue;
    await client.from("orders").delete().in("id", chunk);
  }

  const { count: remainingChaosRuns } = await client
    .from("chaos_runs")
    .select("id", { count: "exact", head: true })
    .in("id", chaosRunIds.length ? chaosRunIds : [randomUUID()]);
  expect(remainingChaosRuns).toBe(0);

  const { count: remainingOrders } = await client
    .from("orders")
    .select("id", { count: "exact", head: true })
    .in("id", orderIds.length ? orderIds : [randomUUID()]);
  expect(remainingOrders).toBe(0);
}, 120_000);
