import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { diagnoseFinding } from "@/lib/diagnosis/root-cause-service";
import { EvidencePackServiceError } from "@/lib/diagnosis/evidence-pack-service";
import { createFindingFromInvariantResult } from "@/lib/findings/service";
import { getSupabaseServerClient } from "@/lib/supabase/server";

import { getAnonClientForTest } from "./helpers";

/**
 * Phase 4C-R2 — proves the REAL server-side diagnosis path against the live
 * Supabase project:
 *
 *   persisted FAIL invariant result
 *     -> frozen Phase 3G finding service
 *       -> Phase 4A-R2 evidence pack orchestration
 *         -> Phase 4B-R1 pure signal extractor
 *           -> Phase 4C-R1 pure root-cause classifier
 *             -> Phase 4C-R2 guarded diagnosis persistence
 *
 * THIS IS THE FIRST WRITE IN THE DIAGNOSIS CHAIN, so the proof is narrower
 * than the earlier zero-mutation suites: exactly one Finding row may change,
 * and only in its four advisory diagnosis columns. Every row COUNT across the
 * nine authoritative tables must be unchanged, and the correlated invariant
 * result and chaos run must be field-for-field identical.
 *
 * SAFETY. Every mutated row is test-owned and created by this file: one
 * `SYNTHETIC_DEMO` C03 chaos run, one `FAIL` invariant result, and the
 * Finding the frozen Phase 3G service derives from it. It runs no chaos
 * scenario, makes no payment, contacts no Razorpay surface, and creates no
 * `orders`, `payment_attempts`, `payments`, `fulfilments`, `webhook_events`
 * or `event_processing_attempts` row.
 *
 * NO FABRICATED PROVIDER EVIDENCE. C03 is subject-free: its three merchant
 * correlations are truthfully NULL and it needs no `REAL_RAZORPAY_WEBHOOK`
 * row. No C03 verification fact and no mutation fact is invented, so the
 * fixture classifies honestly as `RC-016` / `INSUFFICIENT_EVIDENCE`. That is
 * the expected result, not a weakness: the invariant failure is proven and
 * the root cause is not, and this file proves that distinction is DURABLE.
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
let finalCensus: Census = {};

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
        "Test-owned SYNTHETIC_DEMO fixture for Phase 4C diagnosis persistence.",
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
  // Exact UUIDs only, children before parents. Never by scenario,
  // classification, status, timestamp or any other predicate.
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

  finalCensus = await census();
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

describe("Phase 4C-R2 — real Supabase diagnosis persistence", () => {
  let first: Awaited<ReturnType<typeof diagnoseFinding>>;

  it("1: the finding starts undiagnosed, with every advisory field NULL", async () => {
    findingBefore = await readRow("findings", FINDING_COLUMNS, findingId);
    expect(findingBefore).not.toBeNull();

    expect(findingBefore!.status).toBe("OPEN");
    expect(findingBefore!.diagnosis_code).toBeNull();
    expect(findingBefore!.diagnosis_strength).toBeNull();
    expect(findingBefore!.diagnosis_summary).toBeNull();
    expect(findingBefore!.recommendation_code).toBeNull();
    expect(findingBefore!.recommendation_text).toBeNull();
    expect(findingBefore!.diagnosed_at).toBeNull();
    expect(findingBefore!.resolved_at).toBeNull();
  });

  it("2: the real diagnosis persists RC-016 / INSUFFICIENT_EVIDENCE", async () => {
    resultBefore = await readRow(
      "invariant_results",
      RESULT_COLUMNS,
      invariantResultId,
    );
    runBefore = await readRow("chaos_runs", RUN_COLUMNS, chaosRunId);
    operationBefore = await census();

    first = await diagnoseFinding(findingId);

    operationAfter = await census();

    expect(first.classification.selected.code).toBe("RC-016");
    expect(first.classification.selected.strength).toBe(
      "INSUFFICIENT_EVIDENCE",
    );
    expect(first.classification.outputSource).toBe("DETERMINISTIC_RULES");
    expect(first.classification.ruleVersion).toBe("DIAG-RULES-V1");
    expect(first.classification.findingId).toBe(findingId);
    expect(first.classification.invariantResultId).toBe(invariantResultId);
    expect(first.persistence.kind).toBe("DIAGNOSED");
    expect(first.persistence.diagnosedAt).not.toBeNull();
  });

  it("3: exactly the four advisory columns changed on the finding", async () => {
    findingAfterFirst = await readRow("findings", FINDING_COLUMNS, findingId);
    expect(findingAfterFirst).not.toBeNull();

    expect(findingAfterFirst!.diagnosis_code).toBe("RC-016");
    expect(findingAfterFirst!.diagnosis_strength).toBe("INSUFFICIENT_EVIDENCE");
    expect(findingAfterFirst!.diagnosed_at).not.toBeNull();
    expect(findingAfterFirst!.diagnosed_at).toBe(first.persistence.diagnosedAt);
    expect(findingAfterFirst!.updated_at).toBe(first.persistence.updatedAt);
    expect(findingAfterFirst!.updated_at).not.toBe(findingBefore!.updated_at);

    // Everything else on the row is byte-for-byte unchanged.
    for (const column of [
      "id",
      "invariant_result_id",
      "status",
      "title",
      "diagnosis_summary",
      "recommendation_code",
      "recommendation_text",
      "resolved_at",
      "created_at",
    ] as const) {
      expect(findingAfterFirst![column], column).toEqual(
        findingBefore![column],
      );
    }

    // The 4D boundary, stated as assertions rather than intent.
    expect(findingAfterFirst!.diagnosis_summary).toBeNull();
    expect(findingAfterFirst!.recommendation_code).toBeNull();
    expect(findingAfterFirst!.recommendation_text).toBeNull();
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

    // Diagnosis is advisory: the authoritative verdict cannot move.
    expect(resultAfter).toEqual(resultBefore);
    expect(runAfter).toEqual(runBefore);
    expect(resultAfter!.result).toBe("FAIL");
    expect(runAfter!.data_classification).toBe("SYNTHETIC_DEMO");
  });

  it("6: a repeated diagnosis is ALREADY_DIAGNOSED and writes nothing", async () => {
    const before = await census();

    const second = await diagnoseFinding(findingId);

    expect(second.persistence.kind).toBe("ALREADY_DIAGNOSED");
    expect(second.classification).toEqual(first.classification);
    // The ORIGINAL timestamps survive: no second write happened.
    expect(second.persistence.diagnosedAt).toBe(first.persistence.diagnosedAt);
    expect(second.persistence.updatedAt).toBe(first.persistence.updatedAt);

    const findingAfterSecond = await readRow(
      "findings",
      FINDING_COLUMNS,
      findingId,
    );
    expect(findingAfterSecond).toEqual(findingAfterFirst);
    expect(await census()).toEqual(before);
  });

  it("7: no secret, raw payload or diagnosis prose reaches the result", () => {
    const serialized = JSON.stringify(first);

    for (const forbidden of [
      "fault_config",
      "faultConfig",
      "fault_state",
      "faultState",
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
      "recommendation",
      "reliabilityScore",
      "readiness",
      "goLive",
      "regressionRun",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    expect(serialized).not.toMatch(/[A-Fa-f0-9]{40,}/);
  });

  it("8: an absent finding is an evidence-pack error, never an RC-016 write", async () => {
    const before = await census();
    const missingId = randomUUID();

    await expect(diagnoseFinding(missingId)).rejects.toBeInstanceOf(
      EvidencePackServiceError,
    );
    await expect(diagnoseFinding(missingId)).rejects.toMatchObject({
      code: "EVIDENCE_PACK_FINDING_NOT_FOUND",
    });

    expect(await census()).toEqual(before);
  });

  it("9: an invalid identifier is rejected safely and writes nothing", async () => {
    const before = await census();

    await expect(diagnoseFinding("not-a-uuid")).rejects.toMatchObject({
      code: "EVIDENCE_PACK_FINDING_ID_INVALID",
    });

    expect(await census()).toEqual(before);
  });

  it("10: an unprivileged client cannot write a diagnosis onto the finding", async () => {
    // RLS is enabled on `findings` and every privilege is revoked from anon,
    // so a browser-position writer must be denied. This proves the diagnosis
    // columns are server-authoritative, not merely conventionally so.
    const anon = getAnonClientForTest();

    const { error } = await anon
      .from("findings")
      .update({ diagnosis_code: "RC-003" })
      .eq("id", findingId);

    // Either an explicit denial, or a silent no-op under RLS. Both are
    // acceptable; a successful write is not.
    const stillCorrect = await readRow("findings", FINDING_COLUMNS, findingId);
    expect(stillCorrect!.diagnosis_code).toBe("RC-016");
    expect(stillCorrect).toEqual(findingAfterFirst);
    if (error === null) {
      // No error means the update matched no row under RLS.
      expect(stillCorrect!.diagnosis_code).not.toBe("RC-003");
    }
  });

  it("11: an unprivileged client cannot even read the finding row", async () => {
    const anon = getAnonClientForTest();
    const { data, error } = await anon
      .from("findings")
      .select("id, diagnosis_code")
      .eq("id", findingId);

    // Denied outright, or an empty result set. Never the row.
    if (error === null) {
      expect(data ?? []).toEqual([]);
    } else {
      expect(error).not.toBeNull();
    }
  });
});
