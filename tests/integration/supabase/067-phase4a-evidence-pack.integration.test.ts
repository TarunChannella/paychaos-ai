import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assembleDiagnosisEvidencePackForFinding } from "@/lib/diagnosis/evidence-pack-service";
import { EvidencePackServiceError } from "@/lib/diagnosis/evidence-pack-service";
import { createFindingFromInvariantResult } from "@/lib/findings/service";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Phase 4A-R2 — proves the REAL server-side Evidence Pack path against the
 * live Supabase project:
 *
 *   persisted FAIL invariant result
 *     -> frozen Phase 3G finding service
 *       -> Phase 4A-R2 orchestration service
 *         -> frozen Phase 3E evidence assembler
 *           -> Phase 4A-R1 pure builder
 *             -> DiagnosisEvidencePackV1
 *
 * THE OPERATION IS READ-ONLY AND THIS FILE PROVES IT. A full census of every
 * authoritative Phase 1-3 table is captured immediately before and
 * immediately after the Evidence Pack call, and the exact fixture rows are
 * re-read and compared field by field. Fixture setup and teardown legitimately
 * write — that is separate from, and bracketed around, the operation under
 * test.
 *
 * SAFETY. Every mutated row is test-owned and created by this file: one
 * `SYNTHETIC_DEMO` C03 chaos run, one `FAIL` invariant result, and the finding
 * the frozen Phase 3G service derives from it. It runs no chaos scenario,
 * makes no payment, contacts no Razorpay surface, and creates no `orders`,
 * `payment_attempts`, `payments`, `fulfilments`, `webhook_events` or
 * `event_processing_attempts` row.
 *
 * NO FABRICATED PROVIDER EVIDENCE. C03 is chosen precisely because it is
 * subject-free: its three merchant correlations are truthfully NULL and it
 * needs no `REAL_RAZORPAY_WEBHOOK` row to exist. The fixture is classified
 * `SYNTHETIC_DEMO` throughout and is never presented as genuine merchant
 * performance.
 *
 * Cleanup deletes exact IDs only, children before parents, and the final
 * census is compared against the baseline taken before any fixture existed.
 */

const client = getSupabaseServerClient();

/** Every authoritative Phase 1-3 table the operation must leave untouched. */
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
let resultBefore: Row | null = null;
let runBefore: Row | null = null;

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
  // The column list is a runtime string, so Supabase cannot infer the row
  // shape and widens the result. The `error` assertion above has already
  // established this is a real row, so the widening is narrowed here.
  return (data as unknown as Row | null) ?? null;
}

const FINDING_COLUMNS =
  "id, invariant_result_id, status, title, diagnosis_code, diagnosis_strength, diagnosis_summary, recommendation_code, recommendation_text, diagnosed_at, resolved_at, created_at, updated_at";
const RESULT_COLUMNS =
  "id, invariant_id, invariant_version, order_id, payment_attempt_id, payment_id, chaos_run_id, result, severity, expected_summary, observed_summary, reason, evidence_refs, evaluated_at";
const RUN_COLUMNS =
  "id, scenario_id, status, outcome, fault_type, data_classification, order_id, payment_attempt_id, payment_id, source_webhook_event_id, failed_precheck_id, execution_block_code, started_at, completed_at";

beforeAll(async () => {
  // A — baseline, before any fixture row exists.
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
        "Test-owned SYNTHETIC_DEMO fixture for Phase 4A evidence pack assembly.",
      reason: "Test-owned deterministic fixture. Not a real evaluation.",
      evidence_refs: [{ kind: "CHAOS_RUN", id: chaosRunId }],
    })
    .select("id")
    .single();
  expect(resultError).toBeNull();
  invariantResultId = result!.id;
  createdInvariantResultIds.push(invariantResultId);

  // The finding is created through the FROZEN production path, not inserted.
  const created = await createFindingFromInvariantResult(invariantResultId);
  expect(created.kind).toBe("CREATED");
  if (created.kind !== "CREATED") throw new Error("expected CREATED");
  findingId = created.finding.id;
  createdFindingIds.push(findingId);
}, 120_000);

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

  // J — the database is back exactly where it started.
  const finalCensus = await census();
  expect(finalCensus).toEqual(baselineCensus);
}, 120_000);

describe("Phase 4A-R2 — real Supabase evidence pack assembly", () => {
  let pack: Awaited<ReturnType<typeof assembleDiagnosisEvidencePackForFinding>>;

  it("1: the evidence pack operation performs ZERO database mutation", async () => {
    // C — census immediately before the operation.
    operationBefore = await census();

    // D — snapshot the exact fixture rows.
    findingBefore = await readRow("findings", FINDING_COLUMNS, findingId);
    resultBefore = await readRow(
      "invariant_results",
      RESULT_COLUMNS,
      invariantResultId,
    );
    runBefore = await readRow("chaos_runs", RUN_COLUMNS, chaosRunId);
    expect(findingBefore).not.toBeNull();
    expect(resultBefore).not.toBeNull();
    expect(runBefore).not.toBeNull();

    // E — the operation under test.
    pack = await assembleDiagnosisEvidencePackForFinding(findingId);

    // F/G — census immediately after, compared table by table.
    operationAfter = await census();
    expect(operationAfter).toEqual(operationBefore);
  });

  it("2: the finding row is byte-for-byte unchanged, including the Phase 4 columns", async () => {
    const after = await readRow("findings", FINDING_COLUMNS, findingId);
    expect(after).toEqual(findingBefore);
    // Assembling evidence must never begin diagnosing.
    expect(after!.diagnosis_code).toBeNull();
    expect(after!.diagnosis_strength).toBeNull();
    expect(after!.diagnosis_summary).toBeNull();
    expect(after!.recommendation_code).toBeNull();
    expect(after!.recommendation_text).toBeNull();
    expect(after!.diagnosed_at).toBeNull();
    expect(after!.status).toBe("OPEN");
  });

  it("3: the invariant result and chaos run are unchanged", async () => {
    const resultAfter = await readRow(
      "invariant_results",
      RESULT_COLUMNS,
      invariantResultId,
    );
    const runAfter = await readRow("chaos_runs", RUN_COLUMNS, chaosRunId);
    expect(resultAfter).toEqual(resultBefore);
    expect(runAfter).toEqual(runBefore);
    expect(resultAfter!.result).toBe("FAIL");
  });

  it("4: the pack identifies exactly the persisted finding and result", () => {
    expect(pack.version).toBe(1);
    expect(pack.finding.findingId).toBe(findingId);
    expect(pack.finding.invariantResultId).toBe(invariantResultId);
    expect(pack.finding.status).toBe("OPEN");
    expect(pack.invariant.invariantId).toBe("INV-005");
    expect(pack.invariant.invariantVersion).toBe("1");
    expect(pack.invariant.result).toBe("FAIL");
    expect(pack.invariant.severity).toBe("CRITICAL");
  });

  it("5: scenario context and SYNTHETIC_DEMO classification are truthful", () => {
    expect(pack.correlations.chaosRunId).toBe(chaosRunId);
    expect(pack.scenario).not.toBeNull();
    expect(pack.scenario!.scenarioId).toBe("C03");
    expect(pack.scenario!.dataClassification).toBe("SYNTHETIC_DEMO");
    expect(pack.scenario!.faultType).toBe("INVALID_SIGNATURE_TEST");
    expect(pack.scenario!.status).toBe("COMPLETED");
  });

  it("6: C03's subject-free correlations remain null and are never invented", () => {
    expect(pack.correlations.orderId).toBeNull();
    expect(pack.correlations.paymentAttemptId).toBeNull();
    expect(pack.correlations.paymentId).toBeNull();
  });

  it("7: no webhook provenance is fabricated for a run that has none", () => {
    expect(pack.provenance).toBeNull();
    expect(pack.money).toBeNull();
    const codes = pack.gaps.map((gap) => gap.code);
    expect(codes).toContain("SOURCE_WEBHOOK_UNAVAILABLE");
    expect(codes).toContain("MONEY_CONTEXT_UNAVAILABLE");
    // Absence is stated, never rendered as an observed zero.
    expect(pack.processing).toEqual([]);
  });

  it("8: safe C03 scenario evidence is present and no raw fault column is exposed", () => {
    const evidence = pack.scenarioEvidence;
    expect(evidence).not.toBeNull();
    if (evidence?.scenarioId !== "C03") throw new Error("expected C03");

    expect(evidence.sourceWebhookLinked).toBe(false);
    expect(evidence.orderLinked).toBe(false);
    expect(evidence.paymentAttemptLinked).toBe(false);
    expect(evidence.paymentLinked).toBe(false);
    expect(evidence.chaosLinkedProcessingAttemptCount).toBe(0);

    // This fixture run executed no C03 verification, so the frozen assembler
    // reports absence rather than inventing checks — and the pack says so.
    const codes = pack.gaps.map((gap) => gap.code);
    if (evidence.verificationChecks === null) {
      expect(codes).toContain("C03_VERIFICATION_CHECKS_UNAVAILABLE");
    } else {
      expect(evidence.verificationChecks.length).toBeGreaterThan(0);
    }
    if (evidence.merchantFacts === null) {
      expect(codes).toContain("C03_MUTATION_FACTS_UNAVAILABLE");
    }
  });

  it("9: persisted evidence references are preserved verbatim", () => {
    expect(pack.evidenceRefs).toEqual([{ kind: "CHAOS_RUN", id: chaosRunId }]);
    // The chaos run reference resolves from the real assembled bundle.
    const unresolved = pack.gaps.filter(
      (gap) => gap.code === "EVIDENCE_REF_UNRESOLVED",
    );
    expect(unresolved).toEqual([]);
  });

  it("10: no secret, raw payload, raw signature or out-of-scope column reaches the pack", () => {
    const serialized = JSON.stringify(pack);

    for (const forbidden of [
      "fault_config",
      "faultConfig",
      "fault_state",
      "faultState",
      "raw_payload_redacted",
      "rawPayloadRedacted",
      "raw_body_sha256",
      "rawBodySha256",
      "normalized_event",
      "normalizedEvent",
      "error_message_redacted",
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
      "service_role",
      "eyJ",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }

    // The English word "signature" is NOT banned: it appears legitimately in
    // the frozen INV-005 title and in deterministic evaluator prose, and
    // `signatureVerified` is a safe boolean fact. What must never appear is a
    // signature VALUE or the header that carries one.
    for (const forbidden of [
      "x-razorpay-signature",
      "razorpay_signature",
      "razorpaySignature",
      "signatureValue",
      "checkoutSignature",
      "checkout_signature",
    ]) {
      expect(serialized.toLowerCase(), forbidden).not.toContain(
        forbidden.toLowerCase(),
      );
    }

    // No long opaque hex/base64 blob of the shape a digest or token would
    // take. UUIDs are dash-separated and 36 chars, so they cannot match.
    expect(serialized).not.toMatch(/[A-Fa-f0-9]{40,}/);
    expect(serialized).not.toMatch(/[A-Za-z0-9+/]{60,}={0,2}/);
  });

  it("11: no diagnosis, recommendation, score or readiness field appears", () => {
    const serialized = JSON.stringify(pack);
    for (const forbidden of [
      "diagnosisCode",
      "diagnosis_code",
      "diagnosisStrength",
      "diagnosis_strength",
      "recommendationCode",
      "recommendationText",
      "STRONG_EVIDENCE",
      "PARTIAL_EVIDENCE",
      "INSUFFICIENT_EVIDENCE",
      "rootCause",
      "reliabilityScore",
      "readiness",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it("12: a repeated call returns a semantically identical pack and still mutates nothing", async () => {
    const before = await census();
    const again = await assembleDiagnosisEvidencePackForFinding(findingId);
    const after = await census();

    expect(again).toEqual(pack);
    expect(after).toEqual(before);
  });

  it("13: a genuinely absent finding produces a service error, not an empty pack", async () => {
    const before = await census();
    const missingId = randomUUID();

    await expect(
      assembleDiagnosisEvidencePackForFinding(missingId),
    ).rejects.toBeInstanceOf(EvidencePackServiceError);
    await expect(
      assembleDiagnosisEvidencePackForFinding(missingId),
    ).rejects.toMatchObject({ code: "EVIDENCE_PACK_FINDING_NOT_FOUND" });

    // A failed lookup writes nothing.
    expect(await census()).toEqual(before);
  });

  it("14: an invalid identifier is rejected safely and writes nothing", async () => {
    const before = await census();

    await expect(
      assembleDiagnosisEvidencePackForFinding("not-a-uuid"),
    ).rejects.toMatchObject({ code: "EVIDENCE_PACK_FINDING_ID_INVALID" });

    expect(await census()).toEqual(before);
  });

  it("15: the operation-before and operation-after censuses match on every table", () => {
    for (const table of CENSUS_TABLES) {
      expect(operationAfter[table], table).toBe(operationBefore[table]);
    }
  });
});
