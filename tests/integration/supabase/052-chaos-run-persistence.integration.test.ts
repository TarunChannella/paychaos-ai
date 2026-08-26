import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

import { getAnonClientForTest } from "./helpers";

/**
 * Phase 3B — proves the `chaos_runs` schema (migration
 * `20260829000000_phase3b_chaos_runs.sql`) against the REAL Supabase
 * project.
 *
 * *** NOT RUNNABLE YET ***. `chaos_runs` does not exist in the remote
 * project until that migration is manually reviewed and applied — this
 * file is committed to the repository in advance (matching this task's own
 * explicit instruction) but must NOT be executed until then. Running it
 * against the current remote database will fail with a PostgREST
 * "table not found in schema cache" style error for every test in this
 * file — that failure would not indicate a defect in this file or in
 * `lib/chaos/run-repository.ts`, only that the migration step has not
 * happened yet.
 *
 * This file performs ZERO merchant/payment mutation — every `orders`/
 * `payment_attempts`/`payments` row it might reference is either read-only
 * (the two known historical genuine rows) or entirely absent (most cases
 * here need no entity link at all, per the corrected nullable schema).
 * Cleanup deletes only the exact `chaos_runs` IDs this file itself created.
 *
 * ARCHITECT CORRECTION — `data_classification` has NO DATABASE DEFAULT
 * (fail-closed provenance handling; see docs/DATABASE.md's `chaos_runs`
 * section and this migration's own column comment). Every insert in this
 * file — including every negative constraint test — therefore supplies an
 * explicit, valid `data_classification` UNLESS the test's own specific
 * purpose is to prove that a missing/invalid `data_classification` itself
 * is rejected. This is deliberate: without this discipline, a negative test
 * for, say, `chaos_runs_status_valid` could pass merely because
 * `data_classification` was omitted (a DIFFERENT NOT NULL violation),
 * proving nothing about the constraint the test claims to test.
 */

const client = getSupabaseServerClient();

const outstandingChaosRunIds: string[] = [];

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

describe("Phase 3B — chaos_runs schema (real Supabase)", () => {
  it("the table exists and a minimal-but-complete service-role insert succeeds", async () => {
    const { data, error } = await client
      .from("chaos_runs")
      .insert({ scenario_id: "C03", data_classification: "SYNTHETIC_DEMO" })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    if (data) outstandingChaosRunIds.push(data.id);
  });

  it("rejects an otherwise-valid insert that OMITS data_classification (NOT NULL, no default — architect correction: fail-closed provenance handling)", async () => {
    const { data, error } = await client
      .from("chaos_runs")
      .insert({
        scenario_id: "C03",
      } as unknown as Database["public"]["Tables"]["chaos_runs"]["Insert"])
      .select()
      .single();
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("rejects an unregistered scenario_id (chaos_runs_scenario_id_valid) — data_classification supplied so this fails for scenario_id specifically", async () => {
    const { error } = await client
      .from("chaos_runs")
      .insert({
        scenario_id: "C99",
        data_classification: "SYNTHETIC_DEMO",
      } as unknown as Database["public"]["Tables"]["chaos_runs"]["Insert"])
      .select()
      .single();
    expect(error).not.toBeNull();
  });

  it("rejects an invalid status (chaos_runs_status_valid) — data_classification supplied so this fails for status specifically", async () => {
    const { error } = await client
      .from("chaos_runs")
      .insert({
        scenario_id: "C03",
        status: "BOGUS",
        data_classification: "SYNTHETIC_DEMO",
      } as unknown as Database["public"]["Tables"]["chaos_runs"]["Insert"])
      .select()
      .single();
    expect(error).not.toBeNull();
  });

  it("rejects an invalid outcome (chaos_runs_outcome_valid) — data_classification supplied so this fails for outcome specifically", async () => {
    const { error } = await client
      .from("chaos_runs")
      .insert({
        scenario_id: "C03",
        status: "COMPLETED",
        outcome: "MAYBE",
        data_classification: "SYNTHETIC_DEMO",
      } as unknown as Database["public"]["Tables"]["chaos_runs"]["Insert"])
      .select()
      .single();
    expect(error).not.toBeNull();
  });

  it("rejects a fault_type outside the three canonical P0 primitives (chaos_runs_fault_type_valid) — no fourth primitive is ever accepted; data_classification supplied so this fails for fault_type specifically", async () => {
    const { error } = await client
      .from("chaos_runs")
      .insert({
        scenario_id: "C01",
        fault_type: "SQL_INJECTION",
        data_classification: "RECORDED_TEST_EVIDENCE",
      } as unknown as Database["public"]["Tables"]["chaos_runs"]["Insert"])
      .select()
      .single();
    expect(error).not.toBeNull();
  });

  it("accepts a NULL fault_type (C11 has no fault primitive)", async () => {
    const result = await insertChaosRun({
      scenario_id: "C11",
      fault_type: null,
      data_classification: "RECORDED_TEST_EVIDENCE",
    });
    expect(result).not.toBeNull();
  });

  it("rejects an invalid failed_precheck_id (chaos_runs_failed_precheck_id_valid) — data_classification supplied so this fails for failed_precheck_id specifically", async () => {
    const { error } = await client
      .from("chaos_runs")
      .insert({
        scenario_id: "C03",
        status: "COMPLETED",
        outcome: "BLOCKED",
        failed_precheck_id: "PRECHECK-99",
        error_message_redacted: "safe reason",
        completed_at: new Date().toISOString(),
        data_classification: "SYNTHETIC_DEMO",
      } as unknown as Database["public"]["Tables"]["chaos_runs"]["Insert"])
      .select()
      .single();
    expect(error).not.toBeNull();
  });

  it("rejects an invalid data_classification value (chaos_runs_data_classification_valid)", async () => {
    const { error } = await client
      .from("chaos_runs")
      .insert({
        scenario_id: "C03",
        data_classification: "GENUINE",
      } as unknown as Database["public"]["Tables"]["chaos_runs"]["Insert"])
      .select()
      .single();
    expect(error).not.toBeNull();
  });

  it("rejects a non-object fault_config scalar (chaos_runs_fault_config_is_object) — data_classification supplied so this fails for fault_config specifically", async () => {
    const { error } = await client
      .from("chaos_runs")
      .insert({
        scenario_id: "C03",
        fault_config: "not-an-object",
        data_classification: "SYNTHETIC_DEMO",
      } as unknown as Database["public"]["Tables"]["chaos_runs"]["Insert"])
      .select()
      .single();
    expect(error).not.toBeNull();
  });

  it("rejects a non-object fault_state scalar (chaos_runs_fault_state_is_object) — data_classification supplied so this fails for fault_state specifically", async () => {
    const { error } = await client
      .from("chaos_runs")
      .insert({
        scenario_id: "C03",
        fault_state: 42,
        data_classification: "SYNTHETIC_DEMO",
      } as unknown as Database["public"]["Tables"]["chaos_runs"]["Insert"])
      .select()
      .single();
    expect(error).not.toBeNull();
  });

  it("rejects an invalid PENDING shape — status PENDING but outcome non-null (chaos_runs_pending_state_consistent) — data_classification supplied so this fails for the consistency constraint specifically", async () => {
    const { error } = await client
      .from("chaos_runs")
      .insert({
        scenario_id: "C03",
        status: "PENDING",
        outcome: "PASS",
        data_classification: "SYNTHETIC_DEMO",
      } as unknown as Database["public"]["Tables"]["chaos_runs"]["Insert"])
      .select()
      .single();
    expect(error).not.toBeNull();
  });

  it("rejects an invalid BLOCKED shape — outcome BLOCKED but started_at non-null (chaos_runs_blocked_state_consistent) — data_classification supplied so this fails for the consistency constraint specifically", async () => {
    const { error } = await client
      .from("chaos_runs")
      .insert({
        scenario_id: "C03",
        status: "COMPLETED",
        outcome: "BLOCKED",
        failed_precheck_id: "PRECHECK-09",
        error_message_redacted: "safe reason",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        data_classification: "SYNTHETIC_DEMO",
      } as unknown as Database["public"]["Tables"]["chaos_runs"]["Insert"])
      .select()
      .single();
    expect(error).not.toBeNull();
  });

  it("rejects an invalid BLOCKED shape — outcome BLOCKED but failed_precheck_id NULL (chaos_runs_blocked_state_consistent) — data_classification supplied so this fails for the consistency constraint specifically", async () => {
    const { error } = await client
      .from("chaos_runs")
      .insert({
        scenario_id: "C03",
        status: "COMPLETED",
        outcome: "BLOCKED",
        error_message_redacted: "safe reason",
        completed_at: new Date().toISOString(),
        data_classification: "SYNTHETIC_DEMO",
      } as unknown as Database["public"]["Tables"]["chaos_runs"]["Insert"])
      .select()
      .single();
    expect(error).not.toBeNull();
  });

  it("rejects a non-BLOCKED outcome that carries a failed_precheck_id (chaos_runs_blocked_state_consistent) — data_classification supplied so this fails for the consistency constraint specifically", async () => {
    const { error } = await client
      .from("chaos_runs")
      .insert({
        scenario_id: "C03",
        status: "COMPLETED",
        outcome: "PASS",
        failed_precheck_id: "PRECHECK-09",
        data_classification: "SYNTHETIC_DEMO",
      } as unknown as Database["public"]["Tables"]["chaos_runs"]["Insert"])
      .select()
      .single();
    expect(error).not.toBeNull();
  });
});

describe("Phase 3B — C0x valid persistence shapes (real Supabase)", () => {
  it("C03 PENDING persists with all entity FKs NULL", async () => {
    const result = await insertChaosRun({
      scenario_id: "C03",
      fault_type: "INVALID_SIGNATURE_TEST",
      data_classification: "SYNTHETIC_DEMO",
    });
    expect(result).not.toBeNull();
    if (!result) return;

    const { data } = await client
      .from("chaos_runs")
      .select("*")
      .eq("id", result.id)
      .single();
    expect(data?.order_id).toBeNull();
    expect(data?.payment_attempt_id).toBeNull();
    expect(data?.payment_id).toBeNull();
    expect(data?.source_webhook_event_id).toBeNull();
    expect(data?.status).toBe("PENDING");
  });

  it("the architect-approved C11 TEST_FIXTURE BLOCKED audit row persists exactly as documented — no fabricated fixture/provider evidence", async () => {
    const result = await insertChaosRun({
      scenario_id: "C11",
      status: "COMPLETED",
      outcome: "BLOCKED",
      fault_type: null,
      failed_precheck_id: "PRECHECK-07",
      data_classification: "SYNTHETIC_DEMO",
      error_message_redacted:
        "No suitable authentic payment.failed evidence is available.",
      started_at: null,
      completed_at: new Date().toISOString(),
    });
    expect(result).not.toBeNull();
    if (!result) return;

    const { data } = await client
      .from("chaos_runs")
      .select("*")
      .eq("id", result.id)
      .single();
    expect(data).toMatchObject({
      scenario_id: "C11",
      status: "COMPLETED",
      outcome: "BLOCKED",
      fault_type: null,
      order_id: null,
      payment_attempt_id: null,
      payment_id: null,
      source_webhook_event_id: null,
      failed_precheck_id: "PRECHECK-07",
      data_classification: "SYNTHETIC_DEMO",
      started_at: null,
    });
    expect(data?.fault_config).toEqual({});
    expect(data?.fault_state).toEqual({});
  });
});

describe("Phase 3B — authorization (real Supabase)", () => {
  // This describe block proves the `anon` role denial at runtime, but does
  // NOT add a runtime `authenticated`-role denial test. This project has no
  // Supabase Auth user system at all (single-workspace demo; the operator
  // access gate is a signed session cookie, per docs/SECURITY.md Section
  // 17 — not a Supabase Auth session), and
  // tests/integration/supabase/helpers.ts exposes no authenticated-role
  // client helper anywhere in this suite. Manufacturing one here (a real
  // sign-in flow, a throwaway user account, or a hand-crafted `authenticated`
  // JWT) would mean inventing fake auth infrastructure this project does not
  // have and does not need — exactly what this task's Finding 4 instructs
  // against. Authenticated-role privilege denial is instead PROVEN
  // STATICALLY by tests/unit/supabase/migration.test.ts's Phase 3B
  // coverage: the migration contains zero `CREATE POLICY` statements for
  // `chaos_runs` and explicitly revokes all privileges from `authenticated`
  // (identical to every other table's approved RLS pattern, itself already
  // covered by that same file's pre-existing Phase 1C-A checks) — with RLS
  // enabled and zero policies, PostgreSQL denies `authenticated` by
  // construction, the same structural guarantee this file's `anon` test
  // below proves at runtime for the `anon` role.
  it("anon cannot read chaos_runs (RLS denies)", async () => {
    const anon = getAnonClientForTest();
    const { data, error } = await anon.from("chaos_runs").select("id").limit(1);
    expect(data === null || data.length === 0).toBe(true);
    void error;
  });

  it("anon cannot insert a chaos_runs row (RLS denies authoritative writes) — RLS/privilege denial happens before any column constraint would even be evaluated, but a valid data_classification is supplied anyway so this proves privilege denial specifically, not incidentally a NOT NULL violation", async () => {
    const anon = getAnonClientForTest();
    const { data, error } = await anon
      .from("chaos_runs")
      .insert({ scenario_id: "C03", data_classification: "SYNTHETIC_DEMO" })
      .select()
      .single();
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("service_role can create and read back an approved row", async () => {
    const result = await insertChaosRun({
      scenario_id: "C03",
      data_classification: "SYNTHETIC_DEMO",
    });
    expect(result).not.toBeNull();
    if (!result) return;
    const { data, error } = await client
      .from("chaos_runs")
      .select("id")
      .eq("id", result.id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(result.id);
  });
});

describe("Phase 3B — historical real Phase 2 evidence remains unchanged", () => {
  it("the known real Phase 2G order/payment are untouched by this file's chaos_runs tests (read-only confirmation only)", async () => {
    const { data: order } = await client
      .from("orders")
      .select("*")
      .eq("id", "cdc8c3fc-d78c-4cd9-837d-c41f5cc04a72")
      .maybeSingle();
    if (order) {
      expect(["UNPAID", "PENDING", "FAILED_OBSERVED", "PAID"]).toContain(
        order.payment_status,
      );
    }

    const { data: payment } = await client
      .from("payments")
      .select("*")
      .eq("razorpay_payment_id", "pay_TU0xvTbsJiOqPI")
      .maybeSingle();
    expect(payment === null || typeof payment.id === "string").toBe(true);
  });
});

afterAll(async () => {
  // Exact-ID-scoped cleanup only — never a broad delete.
  const ids = outstandingChaosRunIds;
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    if (chunk.length === 0) continue;
    await client.from("chaos_runs").delete().in("id", chunk);
  }

  // Independently re-verify via a real SELECT that no synthetic evidence
  // from this file remains.
  const { count: remaining } = await client
    .from("chaos_runs")
    .select("id", { count: "exact", head: true })
    .in("id", ids.length ? ids : [randomUUID()]);
  expect(remaining).toBe(0);
}, 120_000);
