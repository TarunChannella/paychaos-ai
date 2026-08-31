import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EvidencePackServiceError } from "@/lib/diagnosis/evidence-pack-service";
import { recommendFinding } from "@/lib/diagnosis/recommendation-service";
import { createFindingFromInvariantResult } from "@/lib/findings/service";
import { getSupabaseServerClient } from "@/lib/supabase/server";

import { getAnonClientForTest } from "./helpers";

/**
 * Phase 4D-R2 — proves the REAL end-to-end diagnosis + recommendation path
 * against the live Supabase project:
 *
 *   persisted FAIL invariant result
 *     -> frozen Phase 3G finding service
 *       -> Phase 4C trusted diagnosis (evidence -> signals -> root cause)
 *         -> Phase 4A-R2 evidence pack
 *           -> Phase 4D-R1 pure recommendation catalogue
 *             -> Phase 4D-R2 guarded recommendation persistence
 *
 * TWO WRITES, ONE ROW, SEVEN FIELDS. Diagnosis writes three columns plus
 * `updated_at`; the recommendation writes three more plus `updated_at`. Every
 * row COUNT across the nine authoritative tables must be unchanged, and the
 * correlated invariant result and chaos run must be field-for-field identical.
 *
 * SAFETY. Every mutated row is test-owned and created by this file: one
 * `SYNTHETIC_DEMO` C03 chaos run, one `FAIL` invariant result, and the Finding
 * the frozen Phase 3G service derives from it. No Razorpay call, no
 * `REAL_RAZORPAY_WEBHOOK` row, and no fabricated C03 verification or mutation
 * fact — so the honest outcome is `RC-016` / `INVESTIGATE-EVIDENCE-GAP`, and
 * this file proves that abstention is DURABLE rather than dressed up.
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
] as const;

type Census = Record<string, number | null>;
type Row = Record<string, unknown>;

const createdChaosRunIds: string[] = [];
const createdInvariantResultIds: string[] = [];
const createdFindingIds: string[] = [];

let baselineCensus: Census = {};
let operationBefore: Census = {};
let operationAfter: Census = {};

let chaosRunId = "";
let invariantResultId = "";
let findingId = "";

let findingBefore: Row | null = null;
let findingAfterFirst: Row | null = null;
let resultBefore: Row | null = null;
let runBefore: Row | null = null;

const FINDING_COLUMNS =
  "id, invariant_result_id, status, title, diagnosis_code, diagnosis_strength, diagnosis_summary, recommendation_code, recommendation_text, diagnosed_at, resolved_at, created_at, updated_at";
const RESULT_COLUMNS =
  "id, invariant_id, invariant_version, order_id, payment_attempt_id, payment_id, chaos_run_id, result, severity, expected_summary, observed_summary, reason, evidence_refs, evaluated_at";
const RUN_COLUMNS =
  "id, scenario_id, status, outcome, fault_type, data_classification, order_id, payment_attempt_id, payment_id, source_webhook_event_id, failed_precheck_id, execution_block_code, started_at, completed_at";

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

async function readRow(
  table: "findings" | "invariant_results" | "chaos_runs",
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

beforeAll(async () => {
  baselineCensus = await census();

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
  chaosRunId = run!.id;
  createdChaosRunIds.push(chaosRunId);

  const { data: result, error: resultError } = await client
    .from("invariant_results")
    .insert({
      invariant_id: "INV-005",
      invariant_version: "1",
      order_id: null,
      payment_attempt_id: null,
      payment_id: null,
      chaos_run_id: chaosRunId,
      result: "FAIL",
      severity: "CRITICAL",
      expected_summary:
        "A rejected signature must cause zero business mutation.",
      observed_summary:
        "Test-owned SYNTHETIC_DEMO fixture for Phase 4D recommendation persistence.",
      reason: "Test-owned deterministic fixture. Not a real evaluation.",
      evidence_refs: [{ kind: "CHAOS_RUN", id: chaosRunId }],
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
}, 120_000);

afterAll(async () => {
  // Exact UUIDs only, children before parents.
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

  const finalCensus = await census();
  expect(finalCensus).toEqual(baselineCensus);

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
}, 120_000);

describe("Phase 4D-R2 — real Supabase recommendation persistence", () => {
  let first: Awaited<ReturnType<typeof recommendFinding>>;

  it("1: the finding starts completely fresh", async () => {
    findingBefore = await readRow("findings", FINDING_COLUMNS, findingId);
    expect(findingBefore).not.toBeNull();

    expect(findingBefore!.status).toBe("OPEN");
    for (const column of [
      "diagnosis_code",
      "diagnosis_strength",
      "diagnosis_summary",
      "recommendation_code",
      "recommendation_text",
      "diagnosed_at",
      "resolved_at",
    ] as const) {
      expect(findingBefore![column], column).toBeNull();
    }
  });

  it("2: the real trusted flow diagnoses and recommends in one call", async () => {
    resultBefore = await readRow(
      "invariant_results",
      RESULT_COLUMNS,
      invariantResultId,
    );
    runBefore = await readRow("chaos_runs", RUN_COLUMNS, chaosRunId);
    operationBefore = await census();

    first = await recommendFinding(findingId);

    operationAfter = await census();

    // Trusted diagnosis, derived server-side.
    expect(first.diagnosis.classification.selected.code).toBe("RC-016");
    expect(first.diagnosis.classification.selected.strength).toBe(
      "INSUFFICIENT_EVIDENCE",
    );
    expect(first.diagnosis.classification.ruleVersion).toBe("DIAG-RULES-V1");
    expect(first.diagnosis.classification.outputSource).toBe(
      "DETERMINISTIC_RULES",
    );
    expect(first.diagnosis.persistence.kind).toBe("DIAGNOSED");

    // Deterministic recommendation.
    expect(first.recommendation.recommendation.code).toBe(
      "INVESTIGATE-EVIDENCE-GAP",
    );
    expect(first.recommendation.catalogueVersion).toBe(
      "RECOMMENDATION-CATALOGUE-V1",
    );
    expect(first.recommendation.templateVersion).toBe("TEMPLATE-V1");
    expect(first.recommendation.outputSource).toBe("DETERMINISTIC_CATALOGUE");
    expect(first.persistence.kind).toBe("RECOMMENDED");
  });

  it("3: exactly the seven Phase 4 advisory fields changed", async () => {
    findingAfterFirst = await readRow("findings", FINDING_COLUMNS, findingId);
    expect(findingAfterFirst).not.toBeNull();

    expect(findingAfterFirst!.diagnosis_code).toBe("RC-016");
    expect(findingAfterFirst!.diagnosis_strength).toBe("INSUFFICIENT_EVIDENCE");
    expect(findingAfterFirst!.diagnosis_summary).toBe(
      first.recommendation.explanation.diagnosisSummary,
    );
    expect(findingAfterFirst!.recommendation_code).toBe(
      "INVESTIGATE-EVIDENCE-GAP",
    );
    expect(findingAfterFirst!.recommendation_text).toBe(
      first.recommendation.recommendation.text,
    );
    // Phase 4C's timestamp survives the Phase 4D write untouched.
    expect(findingAfterFirst!.diagnosed_at).toBe(
      first.diagnosis.persistence.diagnosedAt,
    );
    // Phase 4D owns the final updated_at.
    expect(findingAfterFirst!.updated_at).toBe(first.persistence.updatedAt);
    expect(findingAfterFirst!.updated_at).not.toBe(findingBefore!.updated_at);

    // Everything else on the row is byte-for-byte unchanged.
    for (const column of [
      "id",
      "invariant_result_id",
      "status",
      "title",
      "resolved_at",
      "created_at",
    ] as const) {
      expect(findingAfterFirst![column], column).toEqual(
        findingBefore![column],
      );
    }
    // The Phase 4E lifecycle boundary.
    expect(findingAfterFirst!.status).toBe("OPEN");
    expect(findingAfterFirst!.resolved_at).toBeNull();
  });

  it("4: no row was created or destroyed in any authoritative table", () => {
    expect(operationAfter).toEqual(operationBefore);
    for (const table of CENSUS_TABLES) {
      expect(operationAfter[table], table).toBe(operationBefore[table]);
    }
  });

  it("5: the invariant result and chaos run are field-for-field unchanged", async () => {
    const resultAfter = await readRow(
      "invariant_results",
      RESULT_COLUMNS,
      invariantResultId,
    );
    const runAfter = await readRow("chaos_runs", RUN_COLUMNS, chaosRunId);

    expect(resultAfter).toEqual(resultBefore);
    expect(runAfter).toEqual(runBefore);
    expect(resultAfter!.result).toBe("FAIL");
    expect(runAfter!.data_classification).toBe("SYNTHETIC_DEMO");
  });

  it("6: a repeated call is fully idempotent across both stages", async () => {
    const before = await census();

    const second = await recommendFinding(findingId);

    expect(second.diagnosis.persistence.kind).toBe("ALREADY_DIAGNOSED");
    expect(second.persistence.kind).toBe("ALREADY_RECOMMENDED");
    expect(second.recommendation).toEqual(first.recommendation);
    expect(second.diagnosis.persistence.diagnosedAt).toBe(
      first.diagnosis.persistence.diagnosedAt,
    );
    expect(second.persistence.updatedAt).toBe(first.persistence.updatedAt);

    const findingAfterSecond = await readRow(
      "findings",
      FINDING_COLUMNS,
      findingId,
    );
    expect(findingAfterSecond).toEqual(findingAfterFirst);
    expect(await census()).toEqual(before);
  });

  it("7: no secret, raw payload or later-phase field reaches the result", () => {
    const serialized = JSON.stringify(first);

    for (const forbidden of [
      "fault_config",
      "fault_state",
      "raw_payload_redacted",
      "raw_body_sha256",
      "normalized_event",
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
      "service_role",
      "eyJ",
      "x-razorpay-signature",
      "razorpay_signature",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    for (const forbidden of [
      "regression_runs",
      "regressionRunId",
      "reliabilityScore",
      "readiness",
      "goLive",
      "STILL_FAILING",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    expect(serialized).not.toMatch(/[A-Fa-f0-9]{40,}/);
  });

  it("8: an absent finding is an upstream error, never an abstention fallback", async () => {
    const before = await census();
    const missingId = randomUUID();

    await expect(recommendFinding(missingId)).rejects.toBeInstanceOf(
      EvidencePackServiceError,
    );
    await expect(recommendFinding(missingId)).rejects.toMatchObject({
      code: "EVIDENCE_PACK_FINDING_NOT_FOUND",
    });

    expect(await census()).toEqual(before);
  });

  it("9: an invalid identifier is rejected safely and writes nothing", async () => {
    const before = await census();

    await expect(recommendFinding("not-a-uuid")).rejects.toMatchObject({
      code: "EVIDENCE_PACK_FINDING_ID_INVALID",
    });

    expect(await census()).toEqual(before);
  });

  it("10: an unprivileged client cannot write a recommendation onto the finding", async () => {
    // RLS is enabled on `findings` and every privilege is revoked from anon,
    // so a browser-position writer must be denied. This proves the advisory
    // columns are server-authoritative, not merely conventionally so.
    const anon = getAnonClientForTest();

    const { error } = await anon
      .from("findings")
      .update({ recommendation_code: "FIX-WEBHOOK-AUTH" })
      .eq("id", findingId);

    const stillCorrect = await readRow("findings", FINDING_COLUMNS, findingId);
    expect(stillCorrect!.recommendation_code).toBe("INVESTIGATE-EVIDENCE-GAP");
    expect(stillCorrect).toEqual(findingAfterFirst);
    if (error === null) {
      // No error means the update matched no row under RLS.
      expect(stillCorrect!.recommendation_code).not.toBe("FIX-WEBHOOK-AUTH");
    }
  });

  it("11: an unprivileged client cannot even read the finding row", async () => {
    const anon = getAnonClientForTest();
    const { data, error } = await anon
      .from("findings")
      .select("id, recommendation_code")
      .eq("id", findingId);

    if (error === null) {
      expect(data ?? []).toEqual([]);
    } else {
      expect(error).not.toBeNull();
    }
  });
});
