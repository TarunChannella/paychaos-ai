import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createFindingFromInvariantResult,
  generateFindingsForChaosRun,
  getFindingDetailByInvariantResultId,
} from "@/lib/findings/service";
import { findFindingByInvariantResultId } from "@/lib/findings/repository";
import { getSupabaseServerClient } from "@/lib/supabase/server";

import { getAnonClientForTest } from "./helpers";

/**
 * Phase 3G — proves the REAL Finding path against the live Supabase project:
 *
 *   persisted invariant_results.result = 'FAIL'
 *     -> Phase 3G finding service
 *       -> one OPEN findings row
 *         -> Finding Detail read model, resolved through the invariant result
 *
 * This deliberately calls the REAL service rather than inserting a `findings`
 * row directly and calling that coverage.
 *
 * SAFETY. Every mutated row is test-owned and created by this file: one
 * `SYNTHETIC_DEMO` chaos run, three `invariant_results` rows it inserts
 * itself (one FAIL, one PASS, one UNKNOWN), and the `findings` the service
 * derives from them. It runs no chaos scenario, makes no payment, touches no
 * Razorpay surface, and creates no `orders`, `payment_attempts`, `payments`,
 * `fulfilments`, `webhook_events` or `event_processing_attempts` row.
 *
 * NO FABRICATED PROVIDER EVIDENCE. No `REAL_RAZORPAY_WEBHOOK` row is created
 * — none is needed. The fixture is shaped as C03/INV-005, whose three
 * merchant correlations are TRUTHFULLY NULL: C03 touches no order, payment
 * attempt or payment at all, so the rows anchor to `chaos_run_id` alone,
 * exactly as the frozen Phase 3F-A subject-anchor rule intends. Every
 * `evidence_refs` entry points at this file's own chaos run.
 *
 * The eleven authoritative Phase 3F results and the five approved chaos runs
 * are never read for mutation, never altered and never deleted.
 *
 * Cleanup deletes exact IDs only, children before parents
 * (findings -> invariant_results -> chaos_runs, all FK RESTRICT), and
 * re-verifies zero remaining rows independently.
 */

const client = getSupabaseServerClient();

const createdChaosRunIds: string[] = [];
const createdInvariantResultIds: string[] = [];
const createdFindingIds: string[] = [];

const FINDING_COLUMNS =
  "id, invariant_result_id, status, title, diagnosis_code, diagnosis_strength, diagnosis_summary, recommendation_code, recommendation_text, diagnosed_at, resolved_at, created_at, updated_at";

const INV_005_TITLE =
  "INV-005 — Invalid Webhook Signature Causes Zero Mutation";

/**
 * The five chaos runs whose invariant results the architect approved and
 * froze in Phase 3F. Pinned by exact ID on purpose.
 *
 * The alternative — "every invariant result that is not one of mine" — is
 * only true of today's database. It would turn green into red the first time
 * a Phase 4 regression, a manual verification chain or another suite
 * legitimately persisted an invariant result elsewhere. Naming the five runs
 * asserts the property that actually matters: THESE eleven authoritative
 * rows are untouched and carry no finding.
 *
 * This file only ever READS them.
 */
const APPROVED_PHASE_3F_RUN_IDS = [
  "c406dafd-d48f-4e1e-b092-030acbb5e32b", // fresh C03
  "a0c5a66a-e70f-4e47-b9eb-0b3482c789d4", // historical C03
  "68878716-ed49-40ec-85de-f962a4f6b21c", // historical C07
  "5090e423-daa5-4122-99de-4c27d728957c", // historical C11-B
  "b49d344a-f5cf-42ae-a078-819b26bfbffe", // historical C11-A
] as const;

type Row = Record<string, unknown>;

let preExistingFindingIds = new Set<string>();
let chaosRunId = "";
let failResultId = "";
let passResultId = "";
let unknownResultId = "";

/** A test-owned SYNTHETIC_DEMO chaos run — the only subject these rows need. */
async function createChaosRun(): Promise<string> {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("chaos_runs")
    .insert({
      scenario_id: "C03",
      status: "COMPLETED",
      outcome: "UNKNOWN",
      fault_type: "INVALID_SIGNATURE_TEST",
      data_classification: "SYNTHETIC_DEMO",
      started_at: now,
      completed_at: now,
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  createdChaosRunIds.push(data!.id);
  return data!.id;
}

/**
 * Inserts one test-owned invariant result directly.
 *
 * Direct insertion is legitimate here: the unit under test is the Finding
 * engine, not the evaluator. The evaluator-to-result path is already proven
 * end-to-end by `064`, and no FAIL result exists in the project to reuse.
 */
async function createInvariantResult(
  invariantId: string,
  result: "FAIL" | "PASS" | "UNKNOWN",
): Promise<string> {
  const { data, error } = await client
    .from("invariant_results")
    .insert({
      invariant_id: invariantId as "INV-005",
      invariant_version: "1",
      order_id: null,
      payment_attempt_id: null,
      payment_id: null,
      chaos_run_id: chaosRunId,
      result,
      severity: "CRITICAL",
      expected_summary:
        "A rejected signature must cause zero business mutation.",
      observed_summary: `Test-owned ${result} fixture for Phase 3G finding generation.`,
      reason: "Test-owned deterministic fixture. Not a real evaluation.",
      evidence_refs: [{ kind: "CHAOS_RUN", id: chaosRunId }],
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  createdInvariantResultIds.push(data!.id);
  return data!.id;
}

async function readFinding(invariantResultId: string): Promise<Row | null> {
  const { data, error } = await client
    .from("findings")
    .select(FINDING_COLUMNS)
    .eq("invariant_result_id", invariantResultId)
    .maybeSingle();
  expect(error).toBeNull();
  if (data && !createdFindingIds.includes(data.id)) {
    createdFindingIds.push(data.id);
  }
  return (data as Row) ?? null;
}

beforeAll(async () => {
  const { data } = await client.from("findings").select("id");
  preExistingFindingIds = new Set((data ?? []).map((r) => r.id));

  chaosRunId = await createChaosRun();
  failResultId = await createInvariantResult("INV-005", "FAIL");
  passResultId = await createInvariantResult("INV-004", "PASS");
  unknownResultId = await createInvariantResult("INV-011", "UNKNOWN");
}, 120_000);

describe("Phase 3G — a persisted FAIL produces exactly one OPEN finding", () => {
  let findingId = "";
  let createdAt = "";
  let updatedAt = "";

  it("1: the real service creates one finding from the FAIL result", async () => {
    const result = await createFindingFromInvariantResult(failResultId);

    expect(result.kind).toBe("CREATED");
    expect(result.kind === "CREATED" && result.finding.status).toBe("OPEN");
    expect(result.kind === "CREATED" && result.finding.title).toBe(
      INV_005_TITLE,
    );
  });

  it("2: exactly one row exists, with the exact FK and the deterministic title", async () => {
    const row = (await readFinding(failResultId))!;
    expect(row).not.toBeNull();
    expect(row.invariant_result_id).toBe(failResultId);
    expect(row.status).toBe("OPEN");
    expect(row.title).toBe(INV_005_TITLE);

    findingId = row.id as string;
    createdAt = row.created_at as string;
    updatedAt = row.updated_at as string;

    const { count } = await client
      .from("findings")
      .select("id", { count: "exact", head: true })
      .eq("invariant_result_id", failResultId);
    expect(count).toBe(1);
  });

  it("3: every diagnosis, recommendation and resolution column is NULL", async () => {
    const row = (await readFinding(failResultId))!;
    for (const column of [
      "diagnosis_code",
      "diagnosis_strength",
      "diagnosis_summary",
      "recommendation_code",
      "recommendation_text",
      "diagnosed_at",
      "resolved_at",
    ]) {
      expect(
        row[column],
        `findings.${column} must be NULL after Phase 3G`,
      ).toBeNull();
    }
  });

  it("4: regenerating returns the SAME finding — same id, created_at and updated_at", async () => {
    const again = await createFindingFromInvariantResult(failResultId);

    expect(again.kind).toBe("ALREADY_PRESENT");
    expect(again.kind === "ALREADY_PRESENT" && again.finding.id).toBe(
      findingId,
    );

    const row = (await readFinding(failResultId))!;
    expect(row.id).toBe(findingId);
    expect(row.created_at).toBe(createdAt);
    // Phase 3G performs no UPDATE, so even updated_at must not move.
    expect(row.updated_at).toBe(updatedAt);
  });

  it("5: a third generation still creates no duplicate", async () => {
    await createFindingFromInvariantResult(failResultId);
    const { count } = await client
      .from("findings")
      .select("id", { count: "exact", head: true })
      .eq("invariant_result_id", failResultId);
    expect(count).toBe(1);
  });

  it("6: the live UNIQUE index rejects a second finding for the same result", async () => {
    const { error } = await client.from("findings").insert({
      invariant_result_id: failResultId,
      title: "a deliberately different second finding",
    });
    expect(error).not.toBeNull();

    const { count } = await client
      .from("findings")
      .select("id", { count: "exact", head: true })
      .eq("invariant_result_id", failResultId);
    expect(count).toBe(1);
  });

  it("7: the FK rejects a finding for an invariant result that does not exist", async () => {
    const { error } = await client.from("findings").insert({
      invariant_result_id: randomUUID(),
      title: "orphan",
    });
    expect(error).not.toBeNull();
  });
});

describe("Phase 3G — PASS and UNKNOWN never produce a finding", () => {
  it("8: a persisted PASS returns NO_FINDING_REQUIRED and writes nothing", async () => {
    const result = await createFindingFromInvariantResult(passResultId);

    expect(result.kind).toBe("NO_FINDING_REQUIRED");
    expect(await findFindingByInvariantResultId(passResultId)).toBeNull();
    expect(await readFinding(passResultId)).toBeNull();
  });

  it("9: a persisted UNKNOWN returns NO_FINDING_REQUIRED and writes nothing", async () => {
    const result = await createFindingFromInvariantResult(unknownResultId);

    expect(result.kind).toBe("NO_FINDING_REQUIRED");
    expect(result.kind === "NO_FINDING_REQUIRED" && result.result).toBe(
      "UNKNOWN",
    );
    expect(await readFinding(unknownResultId)).toBeNull();
  });

  it("10: an unknown invariant result id is a safe typed error, not a finding", async () => {
    await expect(
      createFindingFromInvariantResult(randomUUID()),
    ).rejects.toMatchObject({ code: "FINDING_INVARIANT_RESULT_NOT_FOUND" });
  });
});

describe("Phase 3G — run-level generation over real persisted results", () => {
  it("11: the run yields exactly one finding for its single FAIL", async () => {
    const summary = await generateFindingsForChaosRun(chaosRunId);

    expect(summary.chaosRunId).toBe(chaosRunId);
    expect(summary.evaluatedResultCount).toBe(3);
    expect(summary.failedResultCount).toBe(1);
    expect(summary.findings).toHaveLength(1);
    expect(summary.findings[0]!.invariantResultId).toBe(failResultId);
    expect(summary.findings[0]!.kind).toBe("ALREADY_PRESENT");
    expect(summary.skipped.map((s) => s.result).sort()).toEqual([
      "PASS",
      "UNKNOWN",
    ]);
  });

  it("12: rerunning the generator creates no duplicate anywhere in the run", async () => {
    const first = await generateFindingsForChaosRun(chaosRunId);
    const second = await generateFindingsForChaosRun(chaosRunId);

    expect(first.findings.map((f) => f.findingId)).toEqual(
      second.findings.map((f) => f.findingId),
    );

    const { count } = await client
      .from("findings")
      .select("id", { count: "exact", head: true })
      .in("invariant_result_id", createdInvariantResultIds);
    expect(count).toBe(1);
  });

  it("13: a chaos run with no persisted results yields zeros, not an error", async () => {
    const emptyRunId = await createChaosRun();
    const summary = await generateFindingsForChaosRun(emptyRunId);

    expect(summary.evaluatedResultCount).toBe(0);
    expect(summary.failedResultCount).toBe(0);
    expect(summary.findings).toHaveLength(0);
  });
});

describe("Phase 3G — evidence traceability through the invariant result", () => {
  it("14: the read model returns the finding plus the LINKED invariant facts", async () => {
    const detail = await getFindingDetailByInvariantResultId(failResultId);

    expect(detail.invariantResultId).toBe(failResultId);
    expect(detail.status).toBe("OPEN");
    expect(detail.title).toBe(INV_005_TITLE);

    expect(detail.invariant.invariantId).toBe("INV-005");
    expect(detail.invariant.invariantVersion).toBe("1");
    expect(detail.invariant.severity).toBe("CRITICAL");
    expect(detail.invariant.expectedSummary.length).toBeGreaterThan(0);
    expect(detail.invariant.observedSummary.length).toBeGreaterThan(0);
    expect(detail.invariant.reason.length).toBeGreaterThan(0);
    expect(detail.invariant.evaluatedAt.length).toBeGreaterThan(0);
  });

  it("15: those facts match the persisted invariant result exactly — not a copy", async () => {
    const { data } = await client
      .from("invariant_results")
      .select(
        "invariant_id, invariant_version, severity, expected_summary, observed_summary, reason, evaluated_at, evidence_refs, chaos_run_id, order_id, payment_attempt_id, payment_id",
      )
      .eq("id", failResultId)
      .single();

    const detail = await getFindingDetailByInvariantResultId(failResultId);

    expect(detail.invariant.severity).toBe(data!.severity);
    expect(detail.invariant.expectedSummary).toBe(data!.expected_summary);
    expect(detail.invariant.observedSummary).toBe(data!.observed_summary);
    expect(detail.invariant.reason).toBe(data!.reason);
    expect(detail.invariant.evaluatedAt).toBe(data!.evaluated_at);
    expect(detail.invariant.evidenceRefs).toEqual(data!.evidence_refs);
    expect(detail.correlations).toEqual({
      chaosRunId: data!.chaos_run_id,
      orderId: data!.order_id,
      paymentAttemptId: data!.payment_attempt_id,
      paymentId: data!.payment_id,
    });
  });

  it("16: every evidence ref resolves to a row that really exists", async () => {
    const detail = await getFindingDetailByInvariantResultId(failResultId);

    expect(detail.invariant.evidenceRefs.length).toBeGreaterThan(0);
    const table: Record<string, string> = {
      ORDER: "orders",
      PAYMENT_ATTEMPT: "payment_attempts",
      PAYMENT: "payments",
      FULFILMENT: "fulfilments",
      WEBHOOK_EVENT: "webhook_events",
      EVENT_PROCESSING_ATTEMPT: "event_processing_attempts",
      CHAOS_RUN: "chaos_runs",
    };
    for (const ref of detail.invariant.evidenceRefs) {
      const { data, error } = await client
        .from(table[ref.kind]!)
        .select("id")
        .eq("id", ref.id)
        .maybeSingle();
      expect(error).toBeNull();
      expect(data, `${ref.kind}:${ref.id} does not resolve`).not.toBeNull();
    }
  });

  it("17: the findings row itself duplicates NO authoritative invariant column", async () => {
    const row = (await readFinding(failResultId))!;
    for (const forbidden of [
      "severity",
      "expected_summary",
      "observed_summary",
      "reason",
      "evidence_refs",
      "chaos_run_id",
      "order_id",
      "payment_attempt_id",
      "payment_id",
    ]) {
      expect(row, `findings must not carry ${forbidden}`).not.toHaveProperty(
        forbidden,
      );
    }
  });
});

describe("Phase 3G — RLS and privileges", () => {
  it("18: anon cannot read findings", async () => {
    const anon = getAnonClientForTest();
    const { data, error } = await anon.from("findings").select("id").limit(1);
    expect(data === null || data.length === 0).toBe(true);
    void error;
  });

  it("19: anon cannot insert a finding", async () => {
    const anon = getAnonClientForTest();
    const { error } = await anon
      .from("findings")
      .insert({ invariant_result_id: failResultId, title: "anon attempt" });
    expect(error).not.toBeNull();
  });

  it("20: service_role can SELECT the rows this file created", async () => {
    expect(createdFindingIds.length).toBeGreaterThan(0);
    const { data, error } = await client
      .from("findings")
      .select("id")
      .in("id", createdFindingIds);
    expect(error).toBeNull();
    expect(data!.length).toBe(createdFindingIds.length);
  });
});

describe("Phase 3G — nothing outside this file's own rows was touched", () => {
  it("21: every finding this file created belongs to one of its own invariant results", async () => {
    const { data, error } = await client
      .from("findings")
      .select("id, invariant_result_id")
      .in("id", createdFindingIds);
    expect(error).toBeNull();
    for (const row of data ?? []) {
      expect(createdInvariantResultIds).toContain(row.invariant_result_id);
      expect(preExistingFindingIds.has(row.id)).toBe(false);
    }
  });

  it("22: the eleven authoritative Phase 3F results still have no finding", async () => {
    // Scoped to the five APPROVED run IDs, never to "every row that is not
    // mine". The negative form would silently break the moment a Phase 4
    // regression, a manual verification chain or another test legitimately
    // added an invariant result anywhere else in the project.
    const { data, error } = await client
      .from("invariant_results")
      .select("id, chaos_run_id, result")
      .in("chaos_run_id", APPROVED_PHASE_3F_RUN_IDS);
    expect(error).toBeNull();

    const authoritative = data ?? [];
    expect(authoritative).toHaveLength(11);

    const tally = authoritative.reduce<Record<string, number>>((acc, row) => {
      acc[row.result] = (acc[row.result] ?? 0) + 1;
      return acc;
    }, {});
    expect(tally).toEqual({ PASS: 1, UNKNOWN: 10 });
    expect(authoritative.some((r) => r.result === "FAIL")).toBe(false);

    // None of them is this file's — these rows are read, never touched, and
    // cleanup can therefore never reach them.
    for (const row of authoritative) {
      expect(createdInvariantResultIds).not.toContain(row.id);
    }
    for (const runId of APPROVED_PHASE_3F_RUN_IDS) {
      expect(createdChaosRunIds).not.toContain(runId);
    }

    // Phase 3G created nothing for them: they are PASS/UNKNOWN, never FAIL.
    const { count } = await client
      .from("findings")
      .select("id", { count: "exact", head: true })
      .in(
        "invariant_result_id",
        authoritative.map((r) => r.id),
      );
    expect(count).toBe(0);
  });
});

afterAll(async () => {
  // Children before parents — every FK is RESTRICT.
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

  const { count: remainingFindings } = await client
    .from("findings")
    .select("id", { count: "exact", head: true })
    .in("id", createdFindingIds.length ? createdFindingIds : [randomUUID()]);
  expect(remainingFindings).toBe(0);

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
}, 120_000);
