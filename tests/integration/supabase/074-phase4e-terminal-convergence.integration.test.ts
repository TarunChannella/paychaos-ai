import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFindingFromInvariantResult } from "@/lib/findings/service";
import { getInvariantDefinition } from "@/lib/invariants/registry";
import { listRegressionRunsForFinding } from "@/lib/regression/repository";
import { startRegression } from "@/lib/regression/service";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Phase 4E-R3-B — pre-start convergence must use the STORED verdict.
 *
 * THE FAILURE THIS PINS. A Finding whose newest conclusive regression is
 * already terminal could never start another regression once an invariant
 * version had been incremented. Convergence re-ran `completeRegression` on the
 * historical attempt, which re-evaluated its old chaos run under the CURRENT
 * catalogue and produced a different verdict for the same evidence.
 * `persistInvariantResult` then correctly refused to rewrite the immutable
 * `(chaos_run_id, invariant_id)` row (docs/MONEY_INVARIANTS.md §49), so the
 * start failed with `PRIOR_CONVERGENCE_FAILED` — permanently, for every
 * future attempt. It was observed for real: the C11-A Finding whose run holds
 * `INV-011/v1 FAIL` after INV-011 moved to v2.
 *
 * A terminal regression row IS the durable verdict — the run, the evaluation
 * and the finalization all happened before it was written — so convergence
 * needs its stored status and nothing else.
 *
 * WHY C03. The only P0 scenario that is fully internal: no Razorpay call, no
 * Checkout, no browser, no source webhook and no order. The whole loop can
 * therefore be proven automatically without fabricating provider evidence.
 *
 * HONEST FIXTURES. Every row here is test-owned and labelled `SYNTHETIC_DEMO`.
 * They stand in for a historical failure so the LIFECYCLE can be exercised. No
 * Razorpay call is made and no `REAL_RAZORPAY_WEBHOOK` row is created.
 *
 * The preserved manual C07/C11 evidence is never read for mutation and never
 * touched. Cleanup deletes exact IDs only, children before parents.
 */

const client = getSupabaseServerClient();

/**
 * A version string the frozen catalogue does not currently define, standing in
 * for "evaluated under semantics that have since been superseded". This is the
 * exact condition `isEquivalentPersistedResult` rejects, and therefore the
 * exact condition that used to make convergence throw.
 */
const SUPERSEDED_VERSION = "0";

const SYNTHETIC_NOTE =
  "Test-owned SYNTHETIC_DEMO fixture for Phase 4E terminal-convergence verification. Not a real evaluation.";

const createdRegressionIds: string[] = [];
const createdFindingIds: string[] = [];
const createdInvariantResultIds: string[] = [];
const createdChaosRunIds: string[] = [];

let originalChaosRunId = "";
let historicalChaosRunId = "";
let originalResultId = "";
let historicalResultId = "";
let findingId = "";
let priorRegressionId = "";

type Row = Record<string, unknown>;

/** The historical run's persisted results, in a deterministic order. */
async function historicalResults(): Promise<Row[]> {
  const { data, error } = await client
    .from("invariant_results")
    .select(
      "id, invariant_id, invariant_version, result, severity, expected_summary, observed_summary, reason, evidence_refs, evaluated_at",
    )
    .eq("chaos_run_id", historicalChaosRunId)
    .order("invariant_id", { ascending: true });
  expect(error).toBeNull();
  return (data ?? []) as unknown as Row[];
}

async function insertSyntheticC03Run(): Promise<string> {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("chaos_runs")
    .insert({
      scenario_id: "C03",
      status: "COMPLETED",
      outcome: "FAIL",
      fault_type: "INVALID_SIGNATURE_TEST",
      data_classification: "SYNTHETIC_DEMO",
      started_at: now,
      completed_at: now,
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  const id = data!.id;
  createdChaosRunIds.push(id);
  return id;
}

beforeAll(async () => {
  // --- The Finding's own original failure, at the CURRENT version. --------
  originalChaosRunId = await insertSyntheticC03Run();

  const { data: original, error: originalError } = await client
    .from("invariant_results")
    .insert({
      invariant_id: "INV-005",
      invariant_version: "1",
      chaos_run_id: originalChaosRunId,
      result: "FAIL",
      severity: "CRITICAL",
      expected_summary:
        "A rejected signature must cause zero business mutation.",
      observed_summary: SYNTHETIC_NOTE,
      reason: SYNTHETIC_NOTE,
      evidence_refs: [{ kind: "CHAOS_RUN", id: originalChaosRunId }],
    })
    .select("id")
    .single();
  expect(originalError).toBeNull();
  originalResultId = original!.id;
  createdInvariantResultIds.push(originalResultId);

  const created = await createFindingFromInvariantResult(originalResultId);
  expect(created.kind).toBe("CREATED");
  if (created.kind !== "CREATED") throw new Error("expected CREATED");
  findingId = created.finding.id;
  createdFindingIds.push(findingId);

  // --- A previous, already-TERMINAL regression over a SUPERSEDED run. -----
  historicalChaosRunId = await insertSyntheticC03Run();

  const { data: historical, error: historicalError } = await client
    .from("invariant_results")
    .insert({
      invariant_id: "INV-005",
      invariant_version: SUPERSEDED_VERSION,
      chaos_run_id: historicalChaosRunId,
      result: "FAIL",
      severity: "CRITICAL",
      expected_summary: "Evaluated under superseded semantics.",
      observed_summary: SYNTHETIC_NOTE,
      reason: SYNTHETIC_NOTE,
      evidence_refs: [{ kind: "CHAOS_RUN", id: historicalChaosRunId }],
    })
    .select("id")
    .single();
  expect(historicalError).toBeNull();
  historicalResultId = historical!.id;
  createdInvariantResultIds.push(historicalResultId);

  const terminalAt = new Date().toISOString();
  const { data: prior, error: priorError } = await client
    .from("regression_runs")
    .insert({
      finding_id: findingId,
      chaos_run_id: historicalChaosRunId,
      status: "STILL_FAILING",
      started_at: terminalAt,
      completed_at: terminalAt,
    })
    .select("id")
    .single();
  expect(priorError).toBeNull();
  priorRegressionId = prior!.id;
  createdRegressionIds.push(priorRegressionId);
}, 180_000);

afterAll(async () => {
  // Exact UUIDs only, children before parents. Never by scenario, status,
  // classification, date or any other predicate.
  if (createdRegressionIds.length > 0) {
    await client
      .from("regression_runs")
      .delete()
      .in("id", createdRegressionIds);
  }
  if (createdFindingIds.length > 0) {
    await client.from("findings").delete().in("id", createdFindingIds);
  }
  if (createdInvariantResultIds.length > 0) {
    await client
      .from("invariant_results")
      .delete()
      .in("id", createdInvariantResultIds);
  }
  if (createdChaosRunIds.length > 0) {
    await client.from("chaos_runs").delete().in("id", createdChaosRunIds);
  }

  for (const [table, ids] of [
    ["regression_runs", createdRegressionIds],
    ["findings", createdFindingIds],
    ["invariant_results", createdInvariantResultIds],
    ["chaos_runs", createdChaosRunIds],
  ] as const) {
    if (ids.length === 0) continue;
    const { count } = await client
      .from(table)
      .select("id", { count: "exact", head: true })
      .in("id", ids);
    expect(count, `${table} leaked`).toBe(0);
  }
}, 180_000);

describe("074 — the historical trap is genuinely present", () => {
  it("1: the previous attempt is terminal and its run's result is at a superseded version", async () => {
    const { data: prior } = await client
      .from("regression_runs")
      .select("id, finding_id, chaos_run_id, status")
      .eq("id", priorRegressionId)
      .maybeSingle();

    expect(prior).toMatchObject({
      finding_id: findingId,
      chaos_run_id: historicalChaosRunId,
      status: "STILL_FAILING",
    });

    // The stored version no longer matches the catalogue, so re-evaluating
    // this run today would produce a non-equivalent result and
    // `persistInvariantResult` would raise INVARIANT_RESULT_INTEGRITY_CONFLICT
    // rather than rewrite the immutable row. That is the trap.
    const rows = await historicalResults();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.invariant_version).toBe(SUPERSEDED_VERSION);
    expect(getInvariantDefinition("INV-005")!.version).not.toBe(
      SUPERSEDED_VERSION,
    );
  });
});

describe("074 — convergence uses the stored verdict", () => {
  let beforeResults: Row[] = [];
  let newRegressionId = "";
  let newChaosRunId = "";

  it("2: a new regression starts despite the superseded historical evidence", async () => {
    beforeResults = await historicalResults();

    const result = await startRegression({ findingId });

    // Before the fix this was NOT_STARTED / PRIOR_CONVERGENCE_FAILED.
    expect(result.kind).not.toBe("NOT_STARTED");
    if (!("attempt" in result)) throw new Error("expected an attempt");
    newRegressionId = result.attempt.regressionRunId;
    newChaosRunId = result.attempt.chaosRunId;
    createdRegressionIds.push(newRegressionId);
    createdChaosRunIds.push(newChaosRunId);
    expect(result.attempt.scenarioId).toBe("C03");
  }, 180_000);

  it("3: the historical run's invariant results are byte-for-byte unchanged", async () => {
    // No insert, no rewrite, no new row for the old (chaos_run_id,
    // invariant_id) pair — convergence never went near it.
    expect(await historicalResults()).toEqual(beforeResults);
  });

  it("4: the historical regression row itself is untouched", async () => {
    const { data } = await client
      .from("regression_runs")
      .select("id, status, chaos_run_id")
      .eq("id", priorRegressionId)
      .maybeSingle();

    expect(data).toMatchObject({
      status: "STILL_FAILING",
      chaos_run_id: historicalChaosRunId,
    });
  });

  it("5: the new attempt owns its own new chaos run and regression row", async () => {
    expect(newChaosRunId).not.toBe(historicalChaosRunId);
    expect(newChaosRunId).not.toBe(originalChaosRunId);
    expect(newRegressionId).not.toBe(priorRegressionId);

    const { data: run } = await client
      .from("chaos_runs")
      .select("id, scenario_id, data_classification")
      .eq("id", newChaosRunId)
      .maybeSingle();
    // C03 is always SYNTHETIC_DEMO by the frozen rule in
    // lib/chaos/run-service.ts: it fabricates its own invalid signature
    // internally, so it is a controlled simulation and never recorded
    // provider evidence.
    expect(run).toMatchObject({
      scenario_id: "C03",
      data_classification: "SYNTHETIC_DEMO",
    });

    // Its results are its own; the historical run still has exactly one.
    const { data: newResults } = await client
      .from("invariant_results")
      .select("id, invariant_version")
      .eq("chaos_run_id", newChaosRunId);
    for (const row of newResults ?? []) {
      createdInvariantResultIds.push(row.id as string);
      // Newly written evidence always carries a CURRENT catalogue version.
      expect(row.invariant_version).not.toBe(SUPERSEDED_VERSION);
    }
  });

  it("6: the finding's history holds both attempts, newest first", async () => {
    const history = await listRegressionRunsForFinding(findingId);
    const ids = history.map((entry) => entry.id);
    expect(ids).toContain(priorRegressionId);
    expect(ids).toContain(newRegressionId);
    expect(ids.indexOf(newRegressionId)).toBeLessThan(
      ids.indexOf(priorRegressionId),
    );
  });

  it("7: the finding carries a real lifecycle status, never left OPEN by accident", async () => {
    const { data } = await client
      .from("findings")
      .select("id, status, resolved_at")
      .eq("id", findingId)
      .maybeSingle();

    // Either the converged prior verdict or the new attempt's own verdict —
    // both are conclusive. What must never happen is the start being refused.
    expect(["RESOLVED", "STILL_FAILING"]).toContain(
      (data as unknown as { status: string }).status,
    );
  });
});
