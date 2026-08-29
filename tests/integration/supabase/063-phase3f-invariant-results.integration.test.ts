import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

import { getAnonClientForTest, testOrderInsert, trackOrder } from "./helpers";

/**
 * Phase 3F-A — proves the `invariant_results` schema (migration
 * `20260902000000_phase3f_invariant_results.sql`) against the REAL Supabase
 * project.
 *
 * *** NOT RUNNABLE YET ***. `invariant_results` does not exist in the remote
 * project until that migration is manually reviewed and applied. This file
 * is committed in advance (matching this task's explicit instruction) but
 * must NOT be executed until then. Running it against the current remote
 * database fails with a PostgREST "table not found in schema cache" style
 * error for every test here — that failure indicates only that the manual
 * migration step has not happened yet, NOT a defect in this file or in
 * `lib/invariants/`. That expected failure must never be worked around,
 * suppressed, or reported as a passing gate.
 *
 * SCOPE. This file proves SCHEMA ONLY. Phase 3F-A ships no evaluator, so
 * nothing here evaluates an invariant, computes a verdict from evidence, or
 * asserts that any particular PASS/FAIL/UNKNOWN is CORRECT. Every `result`
 * value below is a hand-written literal used to exercise a database
 * constraint — never a claim about real payment truth.
 *
 * SUBJECT ANCHOR (architect blocker 3F-A-01). Each of the four correlations
 * is individually nullable, but `invariant_results_subject_present` requires
 * at least ONE to be non-null. All-four-`NULL` is an orphan authoritative
 * verdict and is rejected. C03's real shape is
 * `order_id`/`payment_attempt_id`/`payment_id` `NULL` with `chaos_run_id`
 * NON-NULL — the chaos run IS C03's subject anchor, not an optional extra.
 *
 * SAFETY. Zero Razorpay, zero chaos execution, zero replay. This file
 * creates no `payment_attempts`, `payments`, `fulfilments`, `webhook_events`
 * or `event_processing_attempts` row. Its only non-`invariant_results`
 * writes are two throwaway `SYNTHETIC_DEMO` chaos runs and ONE test-owned
 * `orders` row (built with the suite's existing `testOrderInsert` helper and
 * tracked via `trackOrder`, exactly as every other file in this suite does)
 * so the non-chaos baseline subject anchor can be proven against a REAL
 * foreign key rather than only statically. No genuine merchant row is read
 * for mutation or modified. Cleanup deletes only the exact IDs this file
 * created, children before parents, then re-verifies zero remaining rows
 * with independent SELECTs.
 */

const client = getSupabaseServerClient();

type InvariantResultInsert =
  Database["public"]["Tables"]["invariant_results"]["Insert"];

const createdInvariantResultIds: string[] = [];
const createdChaosRunIds: string[] = [];
const createdOrderIds: string[] = [];

/** Two chaos runs and one order owned by this file, created in `beforeAll`. */
let chaosRunA = "";
let chaosRunB = "";
let baselineOrderId = "";

/**
 * The explicit, safe projection of every pre-existing `chaos_runs` row,
 * captured BEFORE this file writes anything and re-read in `afterAll` for a
 * deep-equality comparison (architect blocker 3F-A-02).
 *
 * Column allowlist only — no secret, no raw payload, no signature. This is
 * held in test memory and never written to a file.
 */
const HISTORICAL_CHAOS_RUN_COLUMNS =
  "id, scenario_id, status, outcome, fault_type, data_classification, order_id, payment_attempt_id, payment_id, source_webhook_event_id, fault_state, execution_block_code, failed_precheck_id, started_at, completed_at, created_at";

/**
 * `updated_at` is deliberately EXCLUDED. Nothing in this file touches a
 * historical chaos run, so it should not change — but excluding it means the
 * comparison below cannot pass merely because a timestamp happened to match,
 * and cannot fail for a reason unrelated to the evidence content this guard
 * exists to protect.
 */
const PROCESSING_ATTEMPT_COLUMNS = "id, state_before, state_after";

type Row = Record<string, unknown>;

let historicalChaosRunsBefore: Row[] = [];
let historicalChaosRunIds = new Set<string>();
let processingAttemptsBefore: Row[] = [];

/** Known approved historical runs, asserted present only if they existed at `beforeAll`. */
const KNOWN_HISTORICAL_RUN_IDS = {
  C03: "a0c5a66a-e70f-4e47-b9eb-0b3482c789d4",
  C07: "68878716-ed49-40ec-85de-f962a4f6b21c",
  "C11-B": "5090e423-daa5-4122-99de-4c27d728957c",
  "C11-A": "b49d344a-f5cf-42ae-a078-819b26bfbffe",
} as const;

function sortById(rows: Row[]): Row[] {
  return [...rows].sort((a, b) =>
    String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0,
  );
}

/**
 * A complete, valid row anchored to the test-owned baseline ORDER.
 *
 * Anchoring the generic constraint tests to an order rather than a chaos run
 * is deliberate: the partial unique index applies only when `chaos_run_id IS
 * NOT NULL`, so order-anchored rows may repeat the same `invariant_id`
 * freely and each negative test below can change exactly ONE field. A
 * rejection is then attributable only to the constraint the test names —
 * never incidentally to the subject-anchor rule or the unique index.
 */
function validRow(
  overrides: Partial<InvariantResultInsert> = {},
): InvariantResultInsert {
  return {
    invariant_id: "INV-005",
    result: "UNKNOWN",
    severity: "CRITICAL",
    expected_summary: "expected condition (schema test literal)",
    observed_summary: "observed condition (schema test literal)",
    reason: "Phase 3F-A schema test — not a real evaluation.",
    order_id: baselineOrderId,
    ...overrides,
  };
}

async function insertResult(
  row: InvariantResultInsert,
): Promise<{ data: Row | null; error: unknown }> {
  const { data, error } = await client
    .from("invariant_results")
    .insert(row)
    .select()
    .single();
  if (data) createdInvariantResultIds.push(data.id as string);
  return { data: data as Row | null, error };
}

beforeAll(async () => {
  // ---- Historical snapshot, taken BEFORE this file creates anything. ----
  const { data: runsBefore, error: runsError } = await client
    .from("chaos_runs")
    .select(HISTORICAL_CHAOS_RUN_COLUMNS);
  expect(runsError).toBeNull();
  historicalChaosRunsBefore = sortById((runsBefore ?? []) as Row[]);
  historicalChaosRunIds = new Set(
    historicalChaosRunsBefore.map((row) => String(row.id)),
  );

  const { data: attemptsBefore, error: attemptsError } = await client
    .from("event_processing_attempts")
    .select(PROCESSING_ATTEMPT_COLUMNS);
  expect(attemptsError).toBeNull();
  processingAttemptsBefore = sortById((attemptsBefore ?? []) as Row[]);

  // ---- Test-owned fixtures. ----
  for (const slot of ["A", "B"] as const) {
    const { data, error } = await client
      .from("chaos_runs")
      .insert({ scenario_id: "C03", data_classification: "SYNTHETIC_DEMO" })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    createdChaosRunIds.push(data!.id);
    if (slot === "A") chaosRunA = data!.id;
    else chaosRunB = data!.id;
  }

  const { data: order, error: orderError } = await client
    .from("orders")
    .insert(testOrderInsert(15000))
    .select("id")
    .single();
  expect(orderError).toBeNull();
  expect(order).not.toBeNull();
  baselineOrderId = order!.id;
  createdOrderIds.push(order!.id);
  trackOrder(order!.id);
}, 120_000);

describe("Phase 3F-A — the subject-anchor rule (architect blocker 3F-A-01)", () => {
  it("1: an insert with ALL FOUR correlations NULL is REJECTED — no orphan authoritative result", async () => {
    const { data, error } = await insertResult(
      validRow({
        order_id: null,
        payment_attempt_id: null,
        payment_id: null,
        chaos_run_id: null,
      }),
    );
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("2: the EXACT C03 shape succeeds — order/attempt/payment all NULL, anchored solely by its chaos run", async () => {
    const { data, error } = await insertResult(
      validRow({
        order_id: null,
        payment_attempt_id: null,
        payment_id: null,
        chaos_run_id: chaosRunA,
      }),
    );
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.order_id).toBeNull();
    expect(data!.payment_attempt_id).toBeNull();
    expect(data!.payment_id).toBeNull();
    expect(data!.chaos_run_id).toBe(chaosRunA);
  });

  it("3: the baseline ORDER shape succeeds — a real order FK with chaos_run_id NULL", async () => {
    const { data, error } = await insertResult(
      validRow({
        invariant_id: "INV-002",
        order_id: baselineOrderId,
        chaos_run_id: null,
      }),
    );
    expect(error).toBeNull();
    expect(data!.order_id).toBe(baselineOrderId);
    expect(data!.chaos_run_id).toBeNull();
  });

  it("4: no individual correlation is NOT NULL — each of the other three may be NULL while one anchor is present", async () => {
    // Order-anchored: the other three NULL.
    const orderAnchored = await insertResult(
      validRow({
        invariant_id: "INV-010",
        order_id: baselineOrderId,
        payment_attempt_id: null,
        payment_id: null,
        chaos_run_id: null,
      }),
    );
    expect(orderAnchored.error).toBeNull();

    // Chaos-anchored: the other three NULL (already covered by test 2, and
    // repeated here against the second run so both anchors are proven
    // independently sufficient).
    const chaosAnchored = await insertResult(
      validRow({
        invariant_id: "INV-010",
        order_id: null,
        payment_attempt_id: null,
        payment_id: null,
        chaos_run_id: chaosRunB,
      }),
    );
    expect(chaosAnchored.error).toBeNull();
  });
});

describe("Phase 3F-A — the table exists and column defaults behave", () => {
  it("5: a UUID primary key is generated and evaluated_at defaults to a server timestamp", async () => {
    const { data, error } = await insertResult(validRow());
    expect(error).toBeNull();
    expect(data!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(typeof data!.evaluated_at).toBe("string");
    expect(Number.isNaN(Date.parse(data!.evaluated_at as string))).toBe(false);
  });

  it("6: invariant_version defaults to '1' when omitted", async () => {
    const { data, error } = await insertResult(validRow());
    expect(error).toBeNull();
    expect(data!.invariant_version).toBe("1");
  });

  it("7: an explicit invariant_version is preserved", async () => {
    const { data, error } = await insertResult(
      validRow({ invariant_version: "2" }),
    );
    expect(error).toBeNull();
    expect(data!.invariant_version).toBe("2");
  });

  it("8: invariant_id is required (NOT NULL)", async () => {
    const row = validRow();
    delete (row as Partial<InvariantResultInsert>).invariant_id;
    const { data, error } = await insertResult(
      row as unknown as InvariantResultInsert,
    );
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("9: expected_summary, observed_summary and reason are each required", async () => {
    for (const column of [
      "expected_summary",
      "observed_summary",
      "reason",
    ] as const) {
      const row = validRow();
      delete (row as Partial<InvariantResultInsert>)[column];
      const { data, error } = await insertResult(
        row as unknown as InvariantResultInsert,
      );
      expect(data).toBeNull();
      expect(error).not.toBeNull();
    }
  });
});

describe("Phase 3F-A — foreign keys are real and RESTRICT deletion", () => {
  it("10: a non-existent order_id is rejected by the real FK", async () => {
    const { data, error } = await insertResult(
      validRow({ order_id: randomUUID() }),
    );
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("11: a non-existent payment_attempt_id is rejected", async () => {
    const { data, error } = await insertResult(
      validRow({ payment_attempt_id: randomUUID() }),
    );
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("12: a non-existent payment_id is rejected", async () => {
    const { data, error } = await insertResult(
      validRow({ payment_id: randomUUID() }),
    );
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("13: a non-existent chaos_run_id is rejected", async () => {
    const { data, error } = await insertResult(
      validRow({ chaos_run_id: randomUUID() }),
    );
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("14: ON DELETE RESTRICT — a chaos_run referenced by an invariant result cannot be deleted", async () => {
    const { data, error } = await insertResult(
      validRow({
        invariant_id: "INV-004",
        order_id: null,
        chaos_run_id: chaosRunB,
      }),
    );
    expect(error).toBeNull();
    expect(data).not.toBeNull();

    const { error: deleteError } = await client
      .from("chaos_runs")
      .delete()
      .eq("id", chaosRunB);
    expect(deleteError).not.toBeNull();

    const { data: stillThere } = await client
      .from("chaos_runs")
      .select("id")
      .eq("id", chaosRunB)
      .maybeSingle();
    expect(stillThere?.id).toBe(chaosRunB);
  });

  it("15: ON DELETE RESTRICT — an order referenced by an invariant result cannot be deleted", async () => {
    const { error: deleteError } = await client
      .from("orders")
      .delete()
      .eq("id", baselineOrderId);
    expect(deleteError).not.toBeNull();

    const { data: stillThere } = await client
      .from("orders")
      .select("id")
      .eq("id", baselineOrderId)
      .maybeSingle();
    expect(stillThere?.id).toBe(baselineOrderId);
  });
});

describe("Phase 3F-A — the result vocabulary is exactly PASS/FAIL/UNKNOWN", () => {
  it("16: PASS, FAIL and UNKNOWN are each accepted", async () => {
    for (const result of ["PASS", "FAIL", "UNKNOWN"] as const) {
      const { data, error } = await insertResult(validRow({ result }));
      expect(error).toBeNull();
      expect(data!.result).toBe(result);
    }
  });

  it("17: NOT_APPLICABLE is REJECTED — it is an in-memory disposition, never payment truth", async () => {
    const { data, error } = await insertResult(
      validRow({ result: "NOT_APPLICABLE" as unknown as "PASS" }),
    );
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("18: ERROR is REJECTED — an evaluator failure must never be storable as a result", async () => {
    const { data, error } = await insertResult(
      validRow({ result: "ERROR" as unknown as "PASS" }),
    );
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("19: arbitrary and near-miss result values are rejected", async () => {
    for (const invalid of ["pass", "Pass", "PASSED", "OK", "BLOCKED", ""]) {
      const { data, error } = await insertResult(
        validRow({ result: invalid as unknown as "PASS" }),
      );
      expect(data).toBeNull();
      expect(error).not.toBeNull();
    }
  });
});

describe("Phase 3F-A — the severity vocabulary is exactly LOW/MEDIUM/HIGH/CRITICAL", () => {
  it("20: all four severities are accepted", async () => {
    for (const severity of ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const) {
      const { data, error } = await insertResult(validRow({ severity }));
      expect(error).toBeNull();
      expect(data!.severity).toBe(severity);
    }
  });

  it("21: INFO, WARNING, title-case and empty severities are rejected", async () => {
    for (const invalid of ["INFO", "WARNING", "Critical", "High", "", "None"]) {
      const { data, error } = await insertResult(
        validRow({ severity: invalid as unknown as "LOW" }),
      );
      expect(data).toBeNull();
      expect(error).not.toBeNull();
    }
  });
});

describe("Phase 3F-A — the invariant_id vocabulary is the twelve P0 IDs", () => {
  it("22: every one of INV-001..INV-012 is accepted", async () => {
    for (let n = 1; n <= 12; n += 1) {
      const invariantId = `INV-${String(n).padStart(3, "0")}`;
      const { data, error } = await insertResult(
        validRow({ invariant_id: invariantId as unknown as "INV-001" }),
      );
      expect(error).toBeNull();
      expect(data!.invariant_id).toBe(invariantId);
    }
  });

  it("23: the P1 IDs INV-013/INV-014 and unknown IDs are rejected", async () => {
    for (const invalid of ["INV-013", "INV-014", "INV-000", "inv-001", "X"]) {
      const { data, error } = await insertResult(
        validRow({ invariant_id: invalid as unknown as "INV-001" }),
      );
      expect(data).toBeNull();
      expect(error).not.toBeNull();
    }
  });
});

describe("Phase 3F-A — evidence_refs shape", () => {
  it("24: defaults to an empty JSON array", async () => {
    const { data, error } = await insertResult(validRow());
    expect(error).toBeNull();
    expect(data!.evidence_refs).toEqual([]);
  });

  it("25: an array of {kind, id} references round-trips exactly", async () => {
    const refs = [
      { kind: "CHAOS_RUN", id: chaosRunA },
      { kind: "EVENT_PROCESSING_ATTEMPT", id: randomUUID() },
    ];
    const { data, error } = await insertResult(
      validRow({ evidence_refs: refs }),
    );
    expect(error).toBeNull();
    expect(data!.evidence_refs).toEqual(refs);
  });

  it("26: a JSON object (not an array) is rejected by the array CHECK", async () => {
    const { data, error } = await insertResult(
      validRow({
        evidence_refs: {
          kind: "CHAOS_RUN",
          id: chaosRunA,
        } as unknown as { kind: string; id: string }[],
      }),
    );
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });
});

describe("Phase 3F-A — the partial unique index protects one-result-per-invariant-per-chaos-run", () => {
  it("27: the SAME invariant on the SAME chaos run cannot be inserted twice", async () => {
    const first = await insertResult(
      validRow({
        invariant_id: "INV-006",
        order_id: null,
        chaos_run_id: chaosRunA,
      }),
    );
    expect(first.error).toBeNull();

    const second = await insertResult(
      validRow({
        invariant_id: "INV-006",
        order_id: null,
        chaos_run_id: chaosRunA,
      }),
    );
    expect(second.data).toBeNull();
    expect(second.error).not.toBeNull();
  });

  it("28: a DIFFERENT invariant on the same chaos run is allowed", async () => {
    const { data, error } = await insertResult(
      validRow({
        invariant_id: "INV-007",
        order_id: null,
        chaos_run_id: chaosRunA,
      }),
    );
    expect(error).toBeNull();
    expect(data!.invariant_id).toBe("INV-007");
  });

  it("29: the SAME invariant on a DIFFERENT chaos run is allowed — historical evaluations are all retained", async () => {
    const { data, error } = await insertResult(
      validRow({
        invariant_id: "INV-006",
        order_id: null,
        chaos_run_id: chaosRunB,
      }),
    );
    expect(error).toBeNull();
    expect(data!.chaos_run_id).toBe(chaosRunB);
  });

  it("30: baseline rows (chaos_run_id NULL) with the SAME invariant are NOT blocked — the index is partial", async () => {
    for (let i = 0; i < 3; i += 1) {
      const { error } = await insertResult(
        validRow({
          invariant_id: "INV-008",
          order_id: baselineOrderId,
          chaos_run_id: null,
        }),
      );
      expect(error).toBeNull();
    }
  });
});

describe("Phase 3F-A — append-only: no role may UPDATE an invariant result", () => {
  it("31: a service_role UPDATE attempt does not rewrite a FAIL into a PASS", async () => {
    const { data, error } = await insertResult(
      validRow({ invariant_id: "INV-009", result: "FAIL" }),
    );
    expect(error).toBeNull();
    const rowId = data!.id as string;

    // The Database type declares `Update: never`, so this cast is required
    // to even attempt the call — which is the point: the attempt must fail
    // at the database, not merely be inconvenient in TypeScript.
    const updateResult = await (
      client.from("invariant_results") as unknown as {
        update: (values: Record<string, unknown>) => {
          eq: (
            column: string,
            value: string,
          ) => Promise<{ error: unknown | null }>;
        };
      }
    )
      .update({ result: "PASS" })
      .eq("id", rowId);
    expect(updateResult.error).not.toBeNull();

    const { data: reread } = await client
      .from("invariant_results")
      .select("result")
      .eq("id", rowId)
      .maybeSingle();
    expect(reread?.result).toBe("FAIL");
  });
});

describe("Phase 3F-A — RLS and privileges", () => {
  it("32: anon cannot read invariant_results", async () => {
    const anon = getAnonClientForTest();
    const { data, error } = await anon
      .from("invariant_results")
      .select("id")
      .limit(1);
    expect(data === null || data.length === 0).toBe(true);
    void error;
  });

  it("33: anon cannot insert an invariant result", async () => {
    const anon = getAnonClientForTest();
    const { data, error } = await anon
      .from("invariant_results")
      .insert(validRow())
      .select()
      .single();
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  // The `authenticated` role's denial is proven STRUCTURALLY — the migration
  // REVOKEs all privileges from it and creates zero policies
  // (tests/unit/supabase/migration.test.ts Phase 3F-A assertion 12). This
  // suite has no authenticated session helper, and creating a user account
  // or altering auth configuration purely to exercise that role would be
  // real infrastructure added for a test. Documented as structurally
  // verified rather than claimed as an authenticated-session integration
  // proof it is not.

  it("34: service_role can select the rows it created", async () => {
    expect(createdInvariantResultIds.length).toBeGreaterThan(0);
    const { data, error } = await client
      .from("invariant_results")
      .select("id")
      .in("id", createdInvariantResultIds);
    expect(error).toBeNull();
    expect(data!.length).toBe(createdInvariantResultIds.length);
  });
});

describe("Phase 3F-A — this file creates no unexpected row", () => {
  it("35: exactly two chaos runs and one order were created; every other chaos run is pre-existing", async () => {
    const { count: chaosRunCount } = await client
      .from("chaos_runs")
      .select("id", { count: "exact", head: true });
    expect(chaosRunCount).toBe(historicalChaosRunsBefore.length + 2);
    expect(createdChaosRunIds).toHaveLength(2);
    expect(createdOrderIds).toHaveLength(1);
  });

  it("36: the four known approved historical runs are still present, if they existed before this file ran", async () => {
    for (const [label, id] of Object.entries(KNOWN_HISTORICAL_RUN_IDS)) {
      if (!historicalChaosRunIds.has(id)) {
        // Absent before the test — nothing to assert about it. Never fail
        // merely because a historical ID was not in this environment.
        continue;
      }
      const { data } = await client
        .from("chaos_runs")
        .select("id, scenario_id")
        .eq("id", id)
        .maybeSingle();
      expect(data, `${label} historical run must still exist`).not.toBeNull();
      expect(data!.id).toBe(id);
    }
  });
});

afterAll(async () => {
  // ---- Exact-ID-scoped cleanup only, children BEFORE parents. ----
  // The FKs are RESTRICT, so deleting a referenced chaos run or order first
  // would fail.
  for (let i = 0; i < createdInvariantResultIds.length; i += 50) {
    const chunk = createdInvariantResultIds.slice(i, i + 50);
    if (chunk.length === 0) continue;
    await client.from("invariant_results").delete().in("id", chunk);
  }

  for (let i = 0; i < createdChaosRunIds.length; i += 50) {
    const chunk = createdChaosRunIds.slice(i, i + 50);
    if (chunk.length === 0) continue;
    await client.from("chaos_runs").delete().in("id", chunk);
  }

  for (let i = 0; i < createdOrderIds.length; i += 50) {
    const chunk = createdOrderIds.slice(i, i + 50);
    if (chunk.length === 0) continue;
    await client.from("orders").delete().in("id", chunk);
  }

  // ---- Independent zero-row re-verification via real SELECTs. ----
  const { count: remainingResults } = await client
    .from("invariant_results")
    .select("id", { count: "exact", head: true })
    .in(
      "id",
      createdInvariantResultIds.length
        ? createdInvariantResultIds
        : [randomUUID()],
    );
  expect(remainingResults).toBe(0);

  const { count: remainingRuns } = await client
    .from("chaos_runs")
    .select("id", { count: "exact", head: true })
    .in("id", createdChaosRunIds.length ? createdChaosRunIds : [randomUUID()]);
  expect(remainingRuns).toBe(0);

  const { count: remainingOrders } = await client
    .from("orders")
    .select("id", { count: "exact", head: true })
    .in("id", createdOrderIds.length ? createdOrderIds : [randomUUID()]);
  expect(remainingOrders).toBe(0);

  // ---- Historical non-mutation: EXACT deep equality (blocker 3F-A-02). ----
  // Re-read the identical explicit projection and compare value-by-value
  // against the `beforeAll` snapshot. This proves no historical
  // C03/C07/C11-B/C11-A run — nor any other pre-existing chaos run — had
  // any allowlisted column changed, including `fault_state`, rather than
  // merely checking that `fault_state` is still an object.
  const { data: runsAfter, error: runsAfterError } = await client
    .from("chaos_runs")
    .select(HISTORICAL_CHAOS_RUN_COLUMNS)
    .in(
      "id",
      historicalChaosRunsBefore.length
        ? historicalChaosRunsBefore.map((row) => String(row.id))
        : [randomUUID()],
    );
  expect(runsAfterError).toBeNull();
  expect(sortById((runsAfter ?? []) as Row[])).toEqual(
    historicalChaosRunsBefore,
  );

  // ---- Processing-snapshot non-mutation, read-only. ----
  // 063 never touches `event_processing_attempts`; this proves it directly
  // rather than relying on that claim. No backfill, no write.
  const { data: attemptsAfter, error: attemptsAfterError } = await client
    .from("event_processing_attempts")
    .select(PROCESSING_ATTEMPT_COLUMNS);
  expect(attemptsAfterError).toBeNull();
  expect(sortById((attemptsAfter ?? []) as Row[])).toEqual(
    processingAttemptsBefore,
  );
}, 120_000);
