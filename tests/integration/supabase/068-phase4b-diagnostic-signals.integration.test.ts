import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DIAGNOSTIC_SIGNAL_CODES,
  DIAGNOSTIC_SIGNAL_VERSION,
  extractDiagnosticSignals,
} from "@/lib/diagnosis/diagnostic-signals";
import { assembleDiagnosticSignalsForFinding } from "@/lib/diagnosis/diagnostic-signals-service";
import {
  assembleDiagnosisEvidencePackForFinding,
  EvidencePackServiceError,
} from "@/lib/diagnosis/evidence-pack-service";
import { captureMerchantStateSnapshotForProcessingAttempt } from "@/lib/evidence/evidence-repository";
import { createFindingFromInvariantResult } from "@/lib/findings/service";
import { getSupabaseServerClient } from "@/lib/supabase/server";

import {
  certifiedFulfilmentPresent,
  CERTIFIED_FULFILMENT_ABSENT,
} from "./certified-baseline";

/**
 * Phase 4B-R2 — proves the REAL server-side diagnostic signal path against the
 * live Supabase project:
 *
 *   persisted FAIL invariant result
 *     -> frozen Phase 3G finding service
 *       -> Phase 4A-R2 evidence pack orchestration
 *         -> Phase 4B-R1 pure signal extractor
 *           -> DiagnosticSignalSetV1
 *
 * THE OPERATION IS READ-ONLY AND THIS FILE PROVES IT. A full census of every
 * authoritative Phase 1-3 table is captured immediately before and immediately
 * after the signal call, and the exact fixture rows are re-read and compared
 * field by field. Fixture setup and teardown legitimately write — that is
 * separate from, and bracketed around, the operation under test.
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
 * behaviour. No C03 verification fact is invented to force a dramatic
 * `PRESENT` signal — a minimal fixture yields honest `UNKNOWN`, and that is
 * the correct result rather than a weakness of the test.
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
        "Test-owned SYNTHETIC_DEMO fixture for Phase 4B diagnostic signal extraction.",
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
  // L — children before parents; every FK is RESTRICT. Exact IDs only: never
  // by scenario, classification, status, date or any other predicate.
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

  // M/N — the database is back exactly where it started.
  const finalCensus = await census();
  expect(finalCensus).toEqual(baselineCensus);
}, 120_000);

describe("Phase 4B-R2 — real Supabase diagnostic signal extraction", () => {
  let signals: Awaited<ReturnType<typeof assembleDiagnosticSignalsForFinding>>;

  it("1: the signal operation performs ZERO database mutation", async () => {
    // C — census immediately before the operation.
    operationBefore = await census();

    // D/E/F — snapshot the exact fixture rows.
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

    // G — the operation under test.
    signals = await assembleDiagnosticSignalsForFinding(findingId);

    // H/J — census immediately after, compared table by table.
    operationAfter = await census();
    expect(operationAfter).toEqual(operationBefore);
  });

  it("2: the finding row is unchanged and no advisory diagnosis column was populated", async () => {
    // I/K — the exact row, re-read and compared field by field.
    const after = await readRow("findings", FINDING_COLUMNS, findingId);
    expect(after).toEqual(findingBefore);

    // Deriving a signal must never begin diagnosing. These belong to 4C/4D.
    expect(after!.diagnosis_code).toBeNull();
    expect(after!.diagnosis_strength).toBeNull();
    expect(after!.diagnosis_summary).toBeNull();
    expect(after!.recommendation_code).toBeNull();
    expect(after!.recommendation_text).toBeNull();
    expect(after!.diagnosed_at).toBeNull();
    expect(after!.status).toBe("OPEN");
  });

  it("3: the invariant result and chaos run are unchanged and stay authoritative", async () => {
    const resultAfter = await readRow(
      "invariant_results",
      RESULT_COLUMNS,
      invariantResultId,
    );
    const runAfter = await readRow("chaos_runs", RUN_COLUMNS, chaosRunId);
    expect(resultAfter).toEqual(resultBefore);
    expect(runAfter).toEqual(runBefore);
    // An advisory signal set cannot alter the deterministic verdict.
    expect(resultAfter!.result).toBe("FAIL");
    expect(runAfter!.data_classification).toBe("SYNTHETIC_DEMO");
  });

  it("4: the signal set identifies exactly the persisted finding and result", () => {
    expect(signals.version).toBe(DIAGNOSTIC_SIGNAL_VERSION);
    expect(signals.findingId).toBe(findingId);
    expect(signals.invariantResultId).toBe(invariantResultId);
  });

  it("5: exactly thirteen signals appear in the frozen vocabulary order", () => {
    expect(signals.signals).toHaveLength(13);
    expect(signals.signals.map((signal) => signal.code)).toEqual([
      ...DIAGNOSTIC_SIGNAL_CODES,
    ]);
  });

  it("6: every state is one of the three approved values", () => {
    for (const signal of signals.signals) {
      expect(["PRESENT", "ABSENT", "UNKNOWN"], signal.code).toContain(
        signal.state,
      );
    }
  });

  it("7: absent structured C03 evidence stays honestly UNKNOWN, never fabricated", () => {
    const byCode = new Map(
      signals.signals.map((signal) => [signal.code, signal]),
    );
    // This minimal fixture ran no C03 verification and captured no processing,
    // so the scenario signal must report that it cannot be established.
    expect(byCode.get("INVALID_SIGNATURE_MUTATED_STATE")!.state).toBe(
      "UNKNOWN",
    );
    expect(byCode.get("CLIENT_CONFIRMATION_MISSING")!.state).toBe("UNKNOWN");
    expect(byCode.get("DUPLICATE_FULFILMENTS")!.state).toBe("UNKNOWN");
    // A subject-free run has no order identity, so no order-state claim is
    // possible either.
    expect(byCode.get("CAPTURE_EXISTS_ORDER_NOT_PAID")!.state).toBe("UNKNOWN");
  });

  it("8: the service result equals the direct approved composition", async () => {
    const before = await census();
    const pack = await assembleDiagnosisEvidencePackForFinding(findingId);
    const composed = extractDiagnosticSignals(pack);

    expect(signals).toEqual(composed);
    // Reading the pack directly writes nothing either.
    expect(await census()).toEqual(before);
  });

  it("9: a repeated call returns a deep-equal set and still mutates nothing", async () => {
    const before = await census();
    const again = await assembleDiagnosticSignalsForFinding(findingId);
    const after = await census();

    expect(again).toEqual(signals);
    expect(after).toEqual(before);
  });

  it("10: no root cause, strength, recommendation, regression, score or readiness field appears", () => {
    const serialized = JSON.stringify(signals);
    for (const forbidden of [
      "RC-0",
      "rootCause",
      "root_cause",
      "diagnosisCode",
      "diagnosis_code",
      "diagnosisStrength",
      "diagnosis_strength",
      "diagnosisSummary",
      "STRONG_EVIDENCE",
      "PARTIAL_EVIDENCE",
      "INSUFFICIENT_EVIDENCE",
      "evidenceStrength",
      "recommendation",
      "regression",
      "reliabilityScore",
      "readiness",
      "goLive",
      "confidence",
      "probability",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it("11: no secret, raw payload, signature value or out-of-scope column reaches the output", () => {
    const serialized = JSON.stringify(signals);

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

  it("12: a genuinely absent finding produces a service error, not an empty signal set", async () => {
    const before = await census();
    const missingId = randomUUID();

    await expect(
      assembleDiagnosticSignalsForFinding(missingId),
    ).rejects.toBeInstanceOf(EvidencePackServiceError);
    await expect(
      assembleDiagnosticSignalsForFinding(missingId),
    ).rejects.toMatchObject({ code: "EVIDENCE_PACK_FINDING_NOT_FOUND" });

    // A failed lookup writes nothing.
    expect(await census()).toEqual(before);
  });

  it("13: an invalid identifier is rejected safely and writes nothing", async () => {
    const before = await census();

    await expect(
      assembleDiagnosticSignalsForFinding("not-a-uuid"),
    ).rejects.toMatchObject({ code: "EVIDENCE_PACK_FINDING_ID_INVALID" });

    expect(await census()).toEqual(before);
  });

  it("14: the operation-before and operation-after censuses match on every table", () => {
    for (const table of CENSUS_TABLES) {
      expect(operationAfter[table], table).toBe(operationBefore[table]);
    }
  });
});

/**
 * Phase 4B-R1 added `fulfilments.idempotency_key` to the real Phase 3 safe
 * projection. Its unit tests proved historical compatibility (a snapshot
 * captured before the column was projected stays `null`, never reconstructed);
 * this proves the other half against the live database — that a genuinely
 * persisted key is projected through the approved read path, exactly.
 *
 * This is deliberately READ-ONLY against existing certified rows rather than a
 * new fixture. Building a snapshot-readable fulfilment would require an
 * `event_processing_attempts` row, and BOTH source kinds that table permits
 * require a non-null `webhook_event_id` — while `webhook_events.source_kind`
 * is CHECK-fixed to `REAL_RAZORPAY_WEBHOOK`. Constructing that chain would
 * mean fabricating a provider webhook row, which is forbidden. Reading
 * certified data costs nothing and fabricates nothing.
 */
describe("Phase 4B-R1 — real fulfilment idempotency-key projection", () => {
  it("15: the approved snapshot path projects the exact persisted idempotency key", async (ctx) => {
    // Probed inline rather than at module scope: this is the only test in
    // the file with this precondition, so one query beats one per file.
    if (!(await certifiedFulfilmentPresent()))
      ctx.skip(CERTIFIED_FULFILMENT_ABSENT);
    const before = await census();

    const { data: rows, error } = await client
      .from("fulfilments")
      .select("id, order_id, trigger_processing_attempt_id, idempotency_key")
      .not("trigger_processing_attempt_id", "is", null)
      .order("id", { ascending: true })
      .limit(10);
    expect(error).toBeNull();

    // This proof reads certified Phase 2/3 evidence that already exists in the
    // project. If the database legitimately holds no such row, the projection
    // cannot be proven here and must not be silently reported as proven.
    expect(
      rows?.length ?? 0,
      "no certified fulfilment row with a trigger attempt exists to prove the projection against",
    ).toBeGreaterThan(0);

    let proven = 0;
    for (const row of rows!) {
      const persistedKey = row.idempotency_key;
      const attemptId = row.trigger_processing_attempt_id;
      if (typeof persistedKey !== "string" || typeof attemptId !== "string") {
        continue;
      }

      // The REAL approved read path — the same function the chaos engine uses.
      const snapshot =
        await captureMerchantStateSnapshotForProcessingAttempt(attemptId);
      const projected = snapshot.fulfilments?.find(
        (fulfilment) => fulfilment.id === row.id,
      );
      if (projected === undefined) continue;

      // Exact equality with the persisted value. Never reconstructed, never
      // derived from orderId, never defaulted.
      expect(projected.idempotencyKey, row.id).toBe(persistedKey);
      expect(projected.orderId).toBe(row.order_id);
      proven += 1;
    }

    expect(
      proven,
      "no certified fulfilment resolved through the approved snapshot path",
    ).toBeGreaterThan(0);

    // Reading evidence never changes it.
    expect(await census()).toEqual(before);
  }, 120_000);
});
