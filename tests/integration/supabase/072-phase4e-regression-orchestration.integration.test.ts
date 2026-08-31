import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFindingFromInvariantResult } from "@/lib/findings/service";
import { listRegressionRunsForFinding } from "@/lib/regression/repository";
import { completeRegression, startRegression } from "@/lib/regression/service";
import { getSupabaseServerClient } from "@/lib/supabase/server";

import { getAnonClientForTest } from "./helpers";

import type { ChaosRunStatus } from "@/lib/supabase/types";

/**
 * Phase 4E-R2 — the whole regression loop, against the live Supabase project.
 *
 * ```text
 * original Finding (INV-005 FAIL, C03)
 *   -> startRegression
 *     -> the frozen safety gate creates a NEW C03 chaos run
 *       -> regression_runs links Finding -> new run
 *         -> the frozen C03 execution service runs
 *           -> the frozen evaluator produces NEW invariant results
 *             -> the frozen R1 decision
 *               -> regression terminalized, then the Finding lifecycle
 * ```
 *
 * WHY C03. It is the only P0 scenario that is fully internal: no Razorpay API
 * call, no Checkout, no browser, no source webhook, and no order. That makes
 * it the one scenario whose complete regression loop can be proven
 * automatically without fabricating provider evidence. C01, C07, C11-A and
 * C11-B are covered by unit tests and belong to manual verification.
 *
 * HONEST FIXTURES. The original failing run and its invariant result are
 * test-owned and labelled `SYNTHETIC_DEMO`. They stand in for a historical
 * failure so the LIFECYCLE can be exercised — the unit under test is Phase 4E,
 * not the reproduction of a real provider incident. No Razorpay call is made
 * and no `REAL_RAZORPAY_WEBHOOK` row is created anywhere in this file.
 *
 * Cleanup deletes exact IDs only, children before parents, and the final
 * census is compared against the baseline taken before any fixture existed.
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
type Row = Record<string, unknown>;

const createdRegressionIds: string[] = [];
const createdChaosRunIds: string[] = [];
const createdInvariantResultIds: string[] = [];
const createdFindingIds: string[] = [];

let baselineCensus: Census = {};
let pendingBaseline: number | null = null;
let runningBaseline: number | null = null;

let findingId = "";
let originalChaosRunId = "";
let originalResultId = "";

let originalResultBefore: Row | null = null;
let findingBefore: Row | null = null;
let firstRegressionRunId = "";
let firstNewChaosRunId = "";
let firstResolvedAt: string | null = null;

const FINDING_COLUMNS =
  "id, invariant_result_id, status, title, diagnosis_code, diagnosis_strength, diagnosis_summary, recommendation_code, recommendation_text, diagnosed_at, resolved_at, created_at, updated_at";
const RESULT_COLUMNS =
  "id, invariant_id, invariant_version, order_id, payment_attempt_id, payment_id, chaos_run_id, result, severity, expected_summary, observed_summary, reason, evidence_refs, evaluated_at";

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

async function chaosRunCount(status: ChaosRunStatus): Promise<number | null> {
  const { count } = await client
    .from("chaos_runs")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  return count ?? null;
}

async function readRow(
  table: "findings" | "invariant_results" | "chaos_runs" | "regression_runs",
  columns: string,
  id: string,
): Promise<Row | null> {
  const { data, error } = await client
    .from(table)
    .select(columns)
    .eq("id", id)
    .maybeSingle();
  expect(error, table).toBeNull();
  return (data as unknown as Row | null) ?? null;
}

/** Every chaos run and invariant result the regression itself creates. */
async function trackRegressionArtifacts(newChaosRunId: string): Promise<void> {
  createdChaosRunIds.push(newChaosRunId);
  const { data } = await client
    .from("invariant_results")
    .select("id")
    .eq("chaos_run_id", newChaosRunId);
  for (const row of (data ?? []) as { id: string }[]) {
    createdInvariantResultIds.push(row.id);
  }
}

beforeAll(async () => {
  baselineCensus = await census();
  pendingBaseline = await chaosRunCount("PENDING");
  runningBaseline = await chaosRunCount("RUNNING");

  const now = new Date().toISOString();
  const { data: run, error: runError } = await client
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
  expect(runError).toBeNull();
  originalChaosRunId = run!.id;
  createdChaosRunIds.push(originalChaosRunId);

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
        "Test-owned SYNTHETIC_DEMO fixture for Phase 4E regression orchestration.",
      reason: "Test-owned deterministic fixture. Not a real evaluation.",
      evidence_refs: [{ kind: "CHAOS_RUN", id: originalChaosRunId }],
    })
    .select("id")
    .single();
  expect(resultError).toBeNull();
  originalResultId = result!.id;
  createdInvariantResultIds.push(originalResultId);

  const created = await createFindingFromInvariantResult(originalResultId);
  expect(created.kind).toBe("CREATED");
  if (created.kind !== "CREATED") throw new Error("expected CREATED");
  findingId = created.finding.id;
  createdFindingIds.push(findingId);
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
  expect(await chaosRunCount("PENDING")).toBe(pendingBaseline);
  expect(await chaosRunCount("RUNNING")).toBe(runningBaseline);
}, 180_000);

describe("Phase 4E-R2 — the original failure", () => {
  it("1: the original Finding exists and is OPEN", async () => {
    findingBefore = await readRow("findings", FINDING_COLUMNS, findingId);
    expect(findingBefore).not.toBeNull();
    expect(findingBefore!.status).toBe("OPEN");
    expect(findingBefore!.resolved_at).toBeNull();
  });

  it("2: the original invariant result is a FAIL on the original run", async () => {
    originalResultBefore = await readRow(
      "invariant_results",
      RESULT_COLUMNS,
      originalResultId,
    );
    expect(originalResultBefore!.result).toBe("FAIL");
    expect(originalResultBefore!.invariant_id).toBe("INV-005");
    expect(originalResultBefore!.chaos_run_id).toBe(originalChaosRunId);
  });
});

describe("Phase 4E-R2 — the regression loop", () => {
  let outcome: Awaited<ReturnType<typeof startRegression>>;

  it("3: the service accepts the existing Finding and runs the loop", async () => {
    outcome = await startRegression({ findingId });

    expect(outcome.kind).toBe("COMPLETED");
    if (outcome.kind !== "COMPLETED") throw new Error("expected COMPLETED");
    firstRegressionRunId = outcome.attempt.regressionRunId;
    firstNewChaosRunId = outcome.attempt.chaosRunId;
    createdRegressionIds.push(firstRegressionRunId);
    await trackRegressionArtifacts(firstNewChaosRunId);
  }, 120_000);

  it("4: a NEW chaos run was created, distinct from the original", async () => {
    expect(firstNewChaosRunId).not.toBe(originalChaosRunId);
    const newRun = await readRow(
      "chaos_runs",
      "id, scenario_id, status, outcome, fault_type",
      firstNewChaosRunId,
    );
    expect(newRun).not.toBeNull();
    // REG-002: the SAME original scenario, re-derived from persisted evidence.
    expect(newRun!.scenario_id).toBe("C03");
    // The frozen safety gate produced it: a run only reaches COMPLETED by
    // passing the precheck and then executing through the C03 service.
    expect(newRun!.status).toBe("COMPLETED");
    expect(newRun!.fault_type).toBe("INVALID_SIGNATURE_TEST");
  });

  it("5: regression_runs links the Finding to that new run", async () => {
    const regression = await readRow(
      "regression_runs",
      "id, finding_id, chaos_run_id, status, started_at, completed_at",
      firstRegressionRunId,
    );
    expect(regression!.finding_id).toBe(findingId);
    expect(regression!.chaos_run_id).toBe(firstNewChaosRunId);
    expect(regression!.started_at).not.toBeNull();
    expect(regression!.completed_at).not.toBeNull();
  });

  it("6: the frozen evaluator produced NEW invariant results for the new run", async () => {
    const { data } = await client
      .from("invariant_results")
      .select("id, invariant_id, result, chaos_run_id")
      .eq("chaos_run_id", firstNewChaosRunId);

    const rows = (data ?? []) as {
      id: string;
      invariant_id: string;
      result: string;
    }[];
    expect(rows.length).toBeGreaterThan(0);

    // Every persisted result belongs to C03's authoritative required set,
    // which the frozen registry — not this test — decides. The set is a
    // SUBSET, not an equality: the frozen evaluator reports a
    // `NOT_APPLICABLE` invariant truthfully and stores no row for it, so a
    // required invariant that did not apply to this run legitimately has no
    // result. Asserting equality would be asserting a behaviour the frozen
    // evaluator deliberately does not have.
    const persisted = new Set(rows.map((r) => r.invariant_id));
    for (const invariantId of persisted) {
      expect(["INV-004", "INV-005"]).toContain(invariantId);
    }
    // The Finding's OWN invariant must have been genuinely re-evaluated —
    // without it the regression could never legitimately resolve.
    expect(persisted.has("INV-005")).toBe(true);

    for (const row of rows) {
      expect(row.id).not.toBe(originalResultId);
    }
  });

  it("7: the regression and the Finding agree on the verdict", async () => {
    if (outcome.kind !== "COMPLETED") throw new Error("expected COMPLETED");
    const regression = await readRow(
      "regression_runs",
      "id, status",
      firstRegressionRunId,
    );
    expect(regression!.status).toBe(outcome.regressionStatus);

    const finding = await readRow("findings", FINDING_COLUMNS, findingId);
    if (outcome.regressionStatus === "RESOLVED") {
      expect(finding!.status).toBe("RESOLVED");
      expect(finding!.resolved_at).not.toBeNull();
      firstResolvedAt = finding!.resolved_at as string;
    } else {
      // Never asserted as a pass: if the real current C03 evaluation did not
      // satisfy the frozen rule, the Finding must NOT have been resolved.
      expect(finding!.status).not.toBe("RESOLVED");
      expect(finding!.resolved_at).toBeNull();
    }
  });
});

describe("Phase 4E-R2 — history is preserved", () => {
  it("8: the original invariant result is unchanged, field for field", async () => {
    const after = await readRow(
      "invariant_results",
      RESULT_COLUMNS,
      originalResultId,
    );
    expect(after).toEqual(originalResultBefore);
    expect(after!.result).toBe("FAIL");
  });

  it("9: no second Finding was generated for the new results", async () => {
    const { data } = await client
      .from("invariant_results")
      .select("id")
      .eq("chaos_run_id", firstNewChaosRunId);
    const newResultIds = ((data ?? []) as { id: string }[]).map((r) => r.id);

    const { count } = await client
      .from("findings")
      .select("id", { count: "exact", head: true })
      .in("invariant_result_id", newResultIds);
    expect(count).toBe(0);
  });

  it("10: the diagnosis and recommendation fields were never touched", async () => {
    const after = await readRow("findings", FINDING_COLUMNS, findingId);
    for (const column of [
      "invariant_result_id",
      "title",
      "diagnosis_code",
      "diagnosis_strength",
      "diagnosis_summary",
      "recommendation_code",
      "recommendation_text",
      "diagnosed_at",
      "created_at",
    ] as const) {
      expect(after![column], column).toEqual(findingBefore![column]);
    }
  });
});

describe("Phase 4E-R2 — re-testing a resolved Finding", () => {
  let second: Awaited<ReturnType<typeof startRegression>>;

  it("11: a terminal first attempt allows a second regression", async () => {
    second = await startRegression({ findingId });

    expect(second.kind).toBe("COMPLETED");
    if (second.kind !== "COMPLETED") throw new Error("expected COMPLETED");
    createdRegressionIds.push(second.attempt.regressionRunId);
    await trackRegressionArtifacts(second.attempt.chaosRunId);

    expect(second.attempt.regressionRunId).not.toBe(firstRegressionRunId);
    expect(second.attempt.chaosRunId).not.toBe(firstNewChaosRunId);
    expect(second.attempt.chaosRunId).not.toBe(originalChaosRunId);
  }, 120_000);

  it("12: a repeated pass preserves the ORIGINAL resolved_at", async () => {
    if (second.kind !== "COMPLETED") throw new Error("expected COMPLETED");
    const finding = await readRow("findings", FINDING_COLUMNS, findingId);

    if (second.regressionStatus === "RESOLVED" && firstResolvedAt !== null) {
      expect(finding!.status).toBe("RESOLVED");
      // The moment the defect was first proven fixed is a historical fact.
      expect(finding!.resolved_at).toBe(firstResolvedAt);
    } else if (second.regressionStatus === "STILL_FAILING") {
      expect(finding!.status).toBe("STILL_FAILING");
      expect(finding!.resolved_at).toBeNull();
    }
  });

  it("13: both attempts are retained, each against its own new chaos run", async () => {
    const history = await listRegressionRunsForFinding(findingId);
    expect(history).toHaveLength(2);

    const runIds = history.map((entry) => entry.chaosRunId);
    expect(new Set(runIds).size).toBe(2);
    expect(runIds).not.toContain(originalChaosRunId);
    for (const entry of history) {
      expect(entry.findingId).toBe(findingId);
      expect(["RESOLVED", "STILL_FAILING", "ERROR"]).toContain(entry.status);
      expect(entry.completedAt).not.toBeNull();
    }
  });

  it("14: the original failing run and its result still exist", async () => {
    const original = await readRow(
      "chaos_runs",
      "id, scenario_id, outcome",
      originalChaosRunId,
    );
    expect(original).not.toBeNull();
    expect(original!.outcome).toBe("FAIL");

    const result = await readRow(
      "invariant_results",
      RESULT_COLUMNS,
      originalResultId,
    );
    expect(result).toEqual(originalResultBefore);
  });
});

describe("Phase 4E-R2 — replaying an older completion", () => {
  it("14b: re-completing the FIRST attempt changes nothing", async () => {
    // Both live C03 attempts may legitimately reach the same verdict, so this
    // is supplementary to the deterministic PASS-vs-FAIL unit cases. What it
    // proves against the real database is that replaying an older completed
    // attempt mutates nothing at all.
    const findingBeforeReplay = await readRow(
      "findings",
      FINDING_COLUMNS,
      findingId,
    );
    const firstBefore = await readRow(
      "regression_runs",
      "id, finding_id, chaos_run_id, status, started_at, completed_at",
      firstRegressionRunId,
    );
    const historyBefore = await listRegressionRunsForFinding(findingId);

    await completeRegression(firstRegressionRunId);

    // The older attempt keeps its own verdict and timestamps.
    expect(
      await readRow(
        "regression_runs",
        "id, finding_id, chaos_run_id, status, started_at, completed_at",
        firstRegressionRunId,
      ),
    ).toEqual(firstBefore);

    // The Finding still reflects whatever the LATEST attempt established, and
    // `resolved_at` was not replaced by replaying the older completion.
    expect(await readRow("findings", FINDING_COLUMNS, findingId)).toEqual(
      findingBeforeReplay,
    );

    const historyAfter = await listRegressionRunsForFinding(findingId);
    expect(historyAfter).toHaveLength(2);
    expect(historyAfter).toEqual(historyBefore);
  }, 120_000);
});

describe("Phase 4E-R2 — RLS", () => {
  it("15: an anonymous client cannot change the Finding lifecycle", async () => {
    const anon = getAnonClientForTest();
    const before = await readRow("findings", FINDING_COLUMNS, findingId);

    const { data, error } = await anon
      .from("findings")
      .update({ status: "RESOLVED" })
      .eq("id", findingId)
      .select("id");

    const succeeded = error === null && (data ?? []).length > 0;
    expect(succeeded).toBe(false);
    expect(await readRow("findings", FINDING_COLUMNS, findingId)).toEqual(
      before,
    );
  });

  it("16: an anonymous client cannot start or alter a regression", async () => {
    const anon = getAnonClientForTest();
    const { data, error } = await anon
      .from("regression_runs")
      .update({ status: "RESOLVED" })
      .eq("finding_id", findingId)
      .select("id");

    const succeeded = error === null && (data ?? []).length > 0;
    expect(succeeded).toBe(false);
  });
});
