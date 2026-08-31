import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as advanceRoute } from "@/app/api/regressions/[regressionRunId]/advance/route";
import { POST as startRoute } from "@/app/api/findings/[findingId]/regressions/route";
import { createFindingFromInvariantResult } from "@/lib/findings/service";
import { listRegressionRunsForFinding } from "@/lib/regression/repository";
import { getSupabaseServerClient } from "@/lib/supabase/server";

import type { ChaosRunStatus } from "@/lib/supabase/types";

/**
 * Phase 4E-R3-A — the regression API against the live Supabase project.
 *
 * Invokes the ACTUAL route handlers with real `NextRequest` objects and real
 * route params. The central assertions deliberately do NOT call
 * `startRegression` directly: the point is to prove the adapter plus the
 * frozen R2 service together, exactly as an operator would reach them.
 *
 * WHY C03. It is the only P0 scenario that is fully internal: no Razorpay API
 * call, no Checkout, no browser, no source webhook, no order. Every other
 * scenario needs genuine provider evidence, which this file never fabricates.
 *
 * HONEST FIXTURES. The original failing run and its invariant result are
 * test-owned and labelled `SYNTHETIC_DEMO`. They stand in for a historical
 * failure so the API and lifecycle can be exercised — the unit under test is
 * Phase 4E, not the reproduction of a real provider incident. No Razorpay
 * call is made and no `REAL_RAZORPAY_WEBHOOK` row is created anywhere here.
 *
 * The access gate is whatever the environment configures; when it is enabled
 * these calls would be refused, so this suite asserts the domain outcome only
 * when the route actually reached the service.
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

let startedRegressionRunId = "";
let startedChaosRunId = "";

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

/** Calls the REAL start route handler exactly as Next.js would. */
async function callStartApi(id: string, body?: unknown) {
  const { NextRequest } = await import("next/server");
  const request = new NextRequest(
    `http://localhost/api/findings/${id}/regressions`,
    {
      method: "POST",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
  );
  return startRoute(request, { params: Promise.resolve({ findingId: id }) });
}

/** Calls the REAL advance route handler exactly as Next.js would. */
async function callAdvanceApi(id: string) {
  const { NextRequest } = await import("next/server");
  const request = new NextRequest(
    `http://localhost/api/regressions/${id}/advance`,
    { method: "POST" },
  );
  return advanceRoute(request, {
    params: Promise.resolve({ regressionRunId: id }),
  });
}

async function trackRegressionArtifacts(chaosRunId: string): Promise<void> {
  createdChaosRunIds.push(chaosRunId);
  const { data } = await client
    .from("invariant_results")
    .select("id")
    .eq("chaos_run_id", chaosRunId);
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
        "Test-owned SYNTHETIC_DEMO fixture for the Phase 4E regression API.",
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

describe("Phase 4E-R3-A — the API rejects bad input without side effects", () => {
  it("1: an unknown body key is a 400 and creates nothing", async () => {
    const before = await census();

    const response = await callStartApi(findingId, {
      freshOrderId: randomUUID(),
      scenarioId: "C01",
    });

    expect(response.status).toBe(400);
    expect(await census()).toEqual(before);
  });

  it("2: a malformed finding id is a 400 and creates nothing", async () => {
    const before = await census();

    const response = await callStartApi("not-a-uuid");

    expect(response.status).toBe(400);
    expect(await census()).toEqual(before);
  });
});

describe("Phase 4E-R3-A — the API drives a real regression", () => {
  let payload: Record<string, unknown>;

  it("3: the original Finding and its FAIL exist before anything runs", async () => {
    findingBefore = await readRow("findings", FINDING_COLUMNS, findingId);
    originalResultBefore = await readRow(
      "invariant_results",
      RESULT_COLUMNS,
      originalResultId,
    );

    expect(findingBefore!.status).toBe("OPEN");
    expect(originalResultBefore!.result).toBe("FAIL");
    expect(originalResultBefore!.invariant_id).toBe("INV-005");
  });

  it("4: POST to the start route succeeds and returns a safe result", async () => {
    const response = await callStartApi(findingId, {});
    payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.kind).toBe("COMPLETED");
    expect(payload.findingId).toBe(findingId);

    startedRegressionRunId = payload.regressionRunId as string;
    startedChaosRunId = payload.chaosRunId as string;
    createdRegressionIds.push(startedRegressionRunId);
    await trackRegressionArtifacts(startedChaosRunId);
  }, 120_000);

  it("5: the returned regression exists and links Finding to the new run", async () => {
    const regression = await readRow(
      "regression_runs",
      "id, finding_id, chaos_run_id, status, started_at, completed_at",
      startedRegressionRunId,
    );
    expect(regression).not.toBeNull();
    expect(regression!.finding_id).toBe(findingId);
    expect(regression!.chaos_run_id).toBe(startedChaosRunId);
    expect(regression!.status).toBe(payload.regressionStatus);
  });

  it("6: a NEW C03 chaos run was created, distinct from the original", async () => {
    expect(startedChaosRunId).not.toBe(originalChaosRunId);

    const newRun = await readRow(
      "chaos_runs",
      "id, scenario_id, status, fault_type",
      startedChaosRunId,
    );
    expect(newRun!.scenario_id).toBe("C03");
    expect(payload.scenarioId).toBe("C03");
    // Only the frozen safety gate plus a real execution reaches COMPLETED.
    expect(newRun!.status).toBe("COMPLETED");
    expect(newRun!.fault_type).toBe("INVALID_SIGNATURE_TEST");
  });

  it("7: the frozen evaluator produced NEW invariant results", async () => {
    const { data } = await client
      .from("invariant_results")
      .select("id, invariant_id")
      .eq("chaos_run_id", startedChaosRunId);

    const rows = (data ?? []) as { id: string; invariant_id: string }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(["INV-004", "INV-005"]).toContain(row.invariant_id);
      expect(row.id).not.toBe(originalResultId);
    }
    // The Finding's own invariant must genuinely have been re-evaluated.
    expect(rows.some((r) => r.invariant_id === "INV-005")).toBe(true);
  });

  it("8: the original FAIL is unchanged, field for field", async () => {
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
      .eq("chaos_run_id", startedChaosRunId);
    const newIds = ((data ?? []) as { id: string }[]).map((r) => r.id);

    const { count } = await client
      .from("findings")
      .select("id", { count: "exact", head: true })
      .in("invariant_result_id", newIds);
    expect(count).toBe(0);
  });

  it("10: the Finding moved only if the real evaluation earned it", async () => {
    const after = await readRow("findings", FINDING_COLUMNS, findingId);

    if (payload.regressionStatus === "RESOLVED") {
      expect(after!.status).toBe("RESOLVED");
      expect(after!.resolved_at).not.toBeNull();
    } else if (payload.regressionStatus === "STILL_FAILING") {
      expect(after!.status).toBe("STILL_FAILING");
      expect(after!.resolved_at).toBeNull();
    } else {
      // An inconclusive verdict must leave the Finding exactly as it was.
      expect(after!.status).toBe(findingBefore!.status);
      expect(after!.resolved_at).toEqual(findingBefore!.resolved_at);
    }
  });

  it("11: diagnosis and recommendation fields were never touched", async () => {
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

  it("12: the response body carries no secret or database wording", () => {
    const serialized = JSON.stringify(payload);
    for (const forbidden of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "RAZORPAY",
      "service_role",
      "eyJ",
      "PGRST",
      "constraint",
      "stack",
      "http",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4E-R3-A — advancing a terminal regression converges idempotently", () => {
  it("13: POST to advance changes nothing on an already-finished attempt", async () => {
    const regressionBefore = await readRow(
      "regression_runs",
      "id, finding_id, chaos_run_id, status, started_at, completed_at",
      startedRegressionRunId,
    );
    const findingBeforeAdvance = await readRow(
      "findings",
      FINDING_COLUMNS,
      findingId,
    );
    const historyBefore = await listRegressionRunsForFinding(findingId);
    const censusBefore = await census();

    const response = await callAdvanceApi(startedRegressionRunId);
    const advancePayload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(advancePayload.regressionRunId).toBe(startedRegressionRunId);

    // No new chaos run, no new regression row, nothing rewritten.
    expect(await census()).toEqual(censusBefore);
    expect(
      await readRow(
        "regression_runs",
        "id, finding_id, chaos_run_id, status, started_at, completed_at",
        startedRegressionRunId,
      ),
    ).toEqual(regressionBefore);
    expect(await readRow("findings", FINDING_COLUMNS, findingId)).toEqual(
      findingBeforeAdvance,
    );
    expect(await listRegressionRunsForFinding(findingId)).toEqual(
      historyBefore,
    );
  }, 120_000);

  it("14: an unknown regression id is a safe not-found", async () => {
    const before = await census();

    const response = await callAdvanceApi(randomUUID());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Regression not found." });
    expect(await census()).toEqual(before);
  });
});
