import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFindingFromInvariantResult } from "@/lib/findings/service";
import {
  finalizeRegressionError,
  finalizeRegressionResolved,
  finalizeRegressionStillFailing,
  findActiveRegressionForFinding,
  insertPendingRegressionRun,
  listRegressionRunsForFinding,
  startPendingRegressionRun,
} from "@/lib/regression/repository";
import { getSupabaseServerClient } from "@/lib/supabase/server";

import { getAnonClientForTest } from "./helpers";

/**
 * Phase 4E-R1 — the `regression_runs` foundation, against the live Supabase
 * project.
 *
 * REQUIRES THE PHASE 4E MIGRATION. This suite is written in the R1 round but
 * cannot run until `20260904000000_phase4e_regression_runs.sql` has been
 * architect-reviewed and applied. Until then it fails at the first query,
 * which is the honest signal that the schema is not there yet — not something
 * to be worked around.
 *
 * SCOPE. Schema, constraints, the active-regression concurrency boundary, the
 * guarded lifecycle transitions, and RLS. It executes NO chaos, evaluates no
 * invariant, and mutates no Finding lifecycle — R2 owns all of that.
 *
 * SAFETY. Every row is test-owned and created here: one `SYNTHETIC_DEMO` C03
 * chaos run per regression fixture, one `FAIL` invariant result, and the
 * Finding the frozen Phase 3G service derives from it. No Razorpay call, no
 * `REAL_RAZORPAY_WEBHOOK` row, no fabricated provider evidence. Cleanup
 * deletes exact IDs only, children before parents, and the final census is
 * compared against the baseline taken before any fixture existed.
 */

const client = getSupabaseServerClient();

const CENSUS_TABLES = [
  "orders",
  "payment_attempts",
  "payments",
  "fulfilments",
  "webhook_events",
  "event_processing_attempts",
  "chaos_runs",
  "invariant_results",
  "findings",
  "regression_runs",
] as const;

type Census = Record<string, number | null>;

const createdRegressionIds: string[] = [];
const createdChaosRunIds: string[] = [];
const createdInvariantResultIds: string[] = [];
const createdFindingIds: string[] = [];

let baselineCensus: Census = {};

let findingId = "";
let originalChaosRunId = "";
let invariantResultId = "";

/** Chaos runs created purely to be re-test targets for a regression row. */
let regressionRunTargetA = "";
let regressionRunTargetB = "";
let regressionRunTargetC = "";

async function census(): Promise<Census> {
  const counts: Census = {};
  for (const table of CENSUS_TABLES) {
    const { count, error } = await client
      .from(table)
      .select("id", { count: "exact", head: true });
    expect(error, table).toBeNull();
    counts[table] = count ?? null;
  }
  return counts;
}

/** Creates a test-owned SYNTHETIC_DEMO C03 chaos run and tracks it. */
async function createChaosRunFixture(): Promise<string> {
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
  baselineCensus = await census();

  originalChaosRunId = await createChaosRunFixture();

  const { data: result, error: resultError } = await client
    .from("invariant_results")
    .insert({
      invariant_id: "INV-005",
      invariant_version: "1",
      order_id: null,
      payment_attempt_id: null,
      payment_id: null,
      chaos_run_id: originalChaosRunId,
      result: "FAIL",
      severity: "CRITICAL",
      expected_summary:
        "A rejected signature must cause zero business mutation.",
      observed_summary:
        "Test-owned SYNTHETIC_DEMO fixture for Phase 4E regression foundation.",
      reason: "Test-owned deterministic fixture. Not a real evaluation.",
      evidence_refs: [{ kind: "CHAOS_RUN", id: originalChaosRunId }],
    })
    .select("id")
    .single();
  expect(resultError).toBeNull();
  invariantResultId = result!.id;
  createdInvariantResultIds.push(invariantResultId);

  const created = await createFindingFromInvariantResult(invariantResultId);
  expect(created.kind).toBe("CREATED");
  if (created.kind !== "CREATED") throw new Error("expected CREATED");
  findingId = created.finding.id;
  createdFindingIds.push(findingId);

  // Three further chaos runs, each a distinct re-test target.
  regressionRunTargetA = await createChaosRunFixture();
  regressionRunTargetB = await createChaosRunFixture();
  regressionRunTargetC = await createChaosRunFixture();
}, 180_000);

afterAll(async () => {
  // Exact UUIDs only, children before parents.
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
    const { count } = await client
      .from(table)
      .select("id", { count: "exact", head: true })
      .in("id", ids.length ? ids : [randomUUID()]);
    expect(count, table).toBe(0);
  }

  expect(await census()).toEqual(baselineCensus);

  const { count: pendingCount } = await client
    .from("chaos_runs")
    .select("id", { count: "exact", head: true })
    .eq("status", "PENDING");
  const { count: runningCount } = await client
    .from("chaos_runs")
    .select("id", { count: "exact", head: true })
    .eq("status", "RUNNING");
  expect(pendingCount).toBe(0);
  expect(runningCount).toBe(0);
}, 180_000);

describe("Phase 4E-R1 — schema", () => {
  it("1: the regression_runs table exists and is readable by the server", async () => {
    const { error } = await client
      .from("regression_runs")
      .select(
        "id, finding_id, chaos_run_id, status, started_at, completed_at, created_at",
      )
      .limit(1);
    expect(error).toBeNull();
  });
});

/**
 * Both foreign-key probes run BEFORE any regression row exists.
 *
 * PostgreSQL enforces unique indexes during the insert itself but foreign keys
 * afterwards, as AFTER triggers. So an insert made while this finding already
 * has an active regression is refused by `regression_runs_active_finding_uniq`
 * before the chaos-run FK is ever reached — a correct rejection, but for the
 * wrong reason to prove a foreign key. Probing first, with no regression row
 * in existence, leaves the foreign key as the only constraint that can fire.
 */
describe("Phase 4E-R1 — foreign keys", () => {
  it("2: a regression for a nonexistent finding is rejected by the FK", async () => {
    await expect(
      insertPendingRegressionRun({
        findingId: randomUUID(),
        chaosRunId: regressionRunTargetB,
      }),
    ).rejects.toMatchObject({ code: "REGRESSION_INSERT_FAILED" });
  });

  it("3: a regression for a nonexistent chaos run is rejected by the FK", async () => {
    await expect(
      insertPendingRegressionRun({
        findingId,
        chaosRunId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "REGRESSION_INSERT_FAILED" });
  });
});

describe("Phase 4E-R1 — insert and uniqueness", () => {
  it("4: an insert supplies two columns and the database supplies the rest", async () => {
    const run = await insertPendingRegressionRun({
      findingId,
      chaosRunId: regressionRunTargetA,
    });
    createdRegressionIds.push(run.id);

    expect(run.findingId).toBe(findingId);
    expect(run.chaosRunId).toBe(regressionRunTargetA);
    expect(run.status).toBe("PENDING");
    expect(run.startedAt).toBeNull();
    expect(run.completedAt).toBeNull();
    expect(run.createdAt).not.toBeNull();
  });

  it("5: one chaos run can back at most one regression", async () => {
    // The first regression already claimed regressionRunTargetA. Reusing it
    // must be refused even though this is a different insertion attempt.
    await expect(
      insertPendingRegressionRun({
        findingId,
        chaosRunId: regressionRunTargetA,
      }),
    ).rejects.toMatchObject({ code: "REGRESSION_INSERT_FAILED" });
  });

  it("6: a second ACTIVE regression for the same finding is refused", async () => {
    // The partial unique index is the authority for the race.
    await expect(
      insertPendingRegressionRun({
        findingId,
        chaosRunId: regressionRunTargetB,
      }),
    ).rejects.toMatchObject({ code: "REGRESSION_ACTIVE_RUN_CONFLICT" });
  });

  it("7: an invalid status is rejected by the CHECK", async () => {
    const first = createdRegressionIds[0]!;
    const { error } = await client
      .from("regression_runs")
      // A deliberate direct write, bypassing the repository, to prove the
      // DATABASE refuses the value rather than only the application.
      .update({ status: "COMPLETED" as never })
      .eq("id", first);
    expect(error).not.toBeNull();
  });
});

describe("Phase 4E-R1 — lifecycle", () => {
  it("8: the active lookup finds the PENDING regression", async () => {
    const active = await findActiveRegressionForFinding(findingId);
    expect(active?.id).toBe(createdRegressionIds[0]);
    expect(active?.status).toBe("PENDING");
  });

  it("9: PENDING -> RUNNING is guarded and idempotent", async () => {
    const id = createdRegressionIds[0]!;
    const startedAt = new Date().toISOString();

    const first = await startPendingRegressionRun({
      regressionRunId: id,
      startedAt,
    });
    expect(first.kind).toBe("TRANSITIONED");
    expect(first.run.status).toBe("RUNNING");
    expect(first.run.startedAt).not.toBeNull();

    const again = await startPendingRegressionRun({
      regressionRunId: id,
      startedAt: new Date().toISOString(),
    });
    expect(again.kind).toBe("ALREADY");
    expect(again.run.startedAt).toBe(first.run.startedAt);
  });

  it("10: a RUNNING regression is still active", async () => {
    const active = await findActiveRegressionForFinding(findingId);
    expect(active?.status).toBe("RUNNING");
  });

  it("11: RUNNING -> STILL_FAILING is guarded and idempotent", async () => {
    const id = createdRegressionIds[0]!;
    const completedAt = new Date().toISOString();

    const first = await finalizeRegressionStillFailing({
      regressionRunId: id,
      completedAt,
    });
    expect(first.kind).toBe("TRANSITIONED");
    expect(first.run.status).toBe("STILL_FAILING");

    const again = await finalizeRegressionStillFailing({
      regressionRunId: id,
      completedAt: new Date().toISOString(),
    });
    expect(again.kind).toBe("ALREADY");
    expect(again.run.completedAt).toBe(first.run.completedAt);
  });

  it("12: a conclusive verdict is never overwritten", async () => {
    const id = createdRegressionIds[0]!;
    await expect(
      finalizeRegressionResolved({
        regressionRunId: id,
        completedAt: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ code: "REGRESSION_STATE_CONFLICT" });
    await expect(
      finalizeRegressionError({
        regressionRunId: id,
        completedAt: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ code: "REGRESSION_STATE_CONFLICT" });
  });

  it("13: a terminal regression releases the active slot", async () => {
    expect(await findActiveRegressionForFinding(findingId)).toBeNull();

    // A finding may be re-tested as many times as it needs to be.
    const second = await insertPendingRegressionRun({
      findingId,
      chaosRunId: regressionRunTargetB,
    });
    createdRegressionIds.push(second.id);
    expect(second.status).toBe("PENDING");
  });

  it("14: PENDING -> ERROR is allowed and leaves started_at NULL", async () => {
    const id = createdRegressionIds[1]!;
    const result = await finalizeRegressionError({
      regressionRunId: id,
      completedAt: new Date().toISOString(),
    });
    expect(result.kind).toBe("TRANSITIONED");
    expect(result.run.status).toBe("ERROR");
    expect(result.run.startedAt).toBeNull();
    expect(result.run.completedAt).not.toBeNull();
  });

  it("15: RESOLVED requires a regression that actually ran", async () => {
    const third = await insertPendingRegressionRun({
      findingId,
      chaosRunId: regressionRunTargetC,
    });
    createdRegressionIds.push(third.id);

    await expect(
      finalizeRegressionResolved({
        regressionRunId: third.id,
        completedAt: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ code: "REGRESSION_STATE_CONFLICT" });

    await startPendingRegressionRun({
      regressionRunId: third.id,
      startedAt: new Date().toISOString(),
    });
    const resolved = await finalizeRegressionResolved({
      regressionRunId: third.id,
      completedAt: new Date().toISOString(),
    });
    expect(resolved.run.status).toBe("RESOLVED");
    expect(resolved.run.startedAt).not.toBeNull();
  });

  it("16: the finding's regression history holds all three attempts", async () => {
    const history = await listRegressionRunsForFinding(findingId);
    expect(history).toHaveLength(3);
    expect(new Set(history.map((run) => run.status))).toEqual(
      new Set(["STILL_FAILING", "ERROR", "RESOLVED"]),
    );
    for (const run of history) {
      expect(run.findingId).toBe(findingId);
    }
  });
});

describe("Phase 4E-R1 — original evidence is untouched", () => {
  it("17: the finding lifecycle was never modified by R1", async () => {
    const { data, error } = await client
      .from("findings")
      .select("id, status, resolved_at")
      .eq("id", findingId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data!.status).toBe("OPEN");
    expect(data!.resolved_at).toBeNull();
  });

  it("18: the original invariant result is unchanged and still FAIL", async () => {
    const { data, error } = await client
      .from("invariant_results")
      .select("id, result, chaos_run_id")
      .eq("id", invariantResultId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data!.result).toBe("FAIL");
    expect(data!.chaos_run_id).toBe(originalChaosRunId);
  });
});

describe("Phase 4E-R1 — RLS", () => {
  it("19: an anonymous client cannot read regression rows", async () => {
    const anon = getAnonClientForTest();
    const { data, error } = await anon
      .from("regression_runs")
      .select("id, finding_id, status");

    if (error === null) {
      expect(data ?? []).toEqual([]);
    } else {
      expect(error).not.toBeNull();
    }
  });

  it("20: an anonymous client cannot insert a regression", async () => {
    const anon = getAnonClientForTest();
    const { data, error } = await anon
      .from("regression_runs")
      .insert({ finding_id: findingId, chaos_run_id: originalChaosRunId })
      .select("id");

    const succeeded = error === null && (data ?? []).length > 0;
    expect(succeeded).toBe(false);
  });

  it("21: an anonymous client cannot change a regression's verdict", async () => {
    const anon = getAnonClientForTest();
    const target = createdRegressionIds[0]!;

    const { data, error } = await anon
      .from("regression_runs")
      .update({ status: "RESOLVED" })
      .eq("id", target)
      .select("id");

    const succeeded = error === null && (data ?? []).length > 0;
    expect(succeeded).toBe(false);

    const { data: stillCorrect } = await client
      .from("regression_runs")
      .select("status")
      .eq("id", target)
      .maybeSingle();
    expect(stillCorrect!.status).toBe("STILL_FAILING");
  });
});
