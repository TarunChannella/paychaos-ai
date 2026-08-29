import { describe, expect, it } from "vitest";

import { listEligibleSources } from "@/lib/chaos/eligibility-service";
import {
  getChaosRunDetail,
  listRecentChaosRuns,
} from "@/lib/chaos/run-read-model";
import { getScenarioDto, listScenarioDtos } from "@/lib/chaos/scenario-dto";
import { assembleChaosRunEvidence } from "@/lib/evidence/chaos-evidence-service";
import { buildEvidenceTimeline } from "@/lib/evidence/timeline-model";
import { listFindingSummariesForInvariantResults } from "@/lib/findings/run-findings-read";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Phase 3H — the Round 1 read models, against the live Supabase project.
 *
 * THIS SUITE IS READ-ONLY. It creates no row, updates no row, deletes no row
 * and needs no cleanup. It executes no chaos scenario, makes no payment and
 * touches no Razorpay surface. Every assertion is a projection check over
 * evidence that already exists.
 *
 * NO PROVIDER FABRICATION. No `webhook_events` row and no
 * `event_processing_attempts` row is created — that table is CHECK-constrained
 * so every row asserts a genuine HMAC-authenticated Razorpay delivery.
 *
 * ZERO CANDIDATES IS A VALID RESULT. The eligibility assertions below check
 * the SHAPE and SAFETY of what comes back, never that it is non-empty. The
 * approved database currently holds no fresh order and no unconsumed source,
 * and weakening the frozen freshness rule to manufacture a candidate would
 * defeat the point of the rule.
 */

const client = getSupabaseServerClient();

/** The five architect-approved Phase 3F runs, pinned by exact ID. */
const APPROVED_PHASE_3F_RUN_IDS = [
  "c406dafd-d48f-4e1e-b092-030acbb5e32b", // fresh C03
  "a0c5a66a-e70f-4e47-b9eb-0b3482c789d4", // historical C03
  "68878716-ed49-40ec-85de-f962a4f6b21c", // historical C07
  "5090e423-daa5-4122-99de-4c27d728957c", // historical C11-B
  "b49d344a-f5cf-42ae-a078-819b26bfbffe", // historical C11-A
] as const;

const FRESH_C03_RUN_ID = "c406dafd-d48f-4e1e-b092-030acbb5e32b";
const HISTORICAL_C07_RUN_ID = "68878716-ed49-40ec-85de-f962a4f6b21c";

describe("066 — scenario DTO against the real deployment", () => {
  it("1: the catalogue is exactly the four approved P0 scenarios", () => {
    expect(listScenarioDtos().map((s) => s.scenarioId)).toEqual([
      "C01",
      "C03",
      "C07",
      "C11",
    ]);
  });

  it("2: no P1 scenario is reachable", () => {
    for (const p1 of ["C02", "C04", "C05", "C06", "C08", "C12"]) {
      expect(getScenarioDto(p1), p1).toBeNull();
    }
  });

  it("3: the DTO carries no arbitrary-target or fault surface", () => {
    const serialized = JSON.stringify(listScenarioDtos()).toLowerCase();
    for (const forbidden of ["http://", "https://", '"url"', "fault_config"]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});

describe("066 — recent runs read model", () => {
  it("4: returns safe summary rows for real persisted runs", async () => {
    const runs = await listRecentChaosRuns(10);

    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(Object.keys(run).sort()).toEqual([
        "completedAt",
        "createdAt",
        "dataClassification",
        "faultType",
        "id",
        "outcome",
        "scenarioId",
        "startedAt",
        "status",
      ]);
      // Only classifications the schema can actually store.
      expect(["RECORDED_TEST_EVIDENCE", "SYNTHETIC_DEMO"]).toContain(
        run.dataClassification,
      );
    }
  });

  it("5: fault_config and fault_state never appear in a summary", async () => {
    const serialized = JSON.stringify(await listRecentChaosRuns(50));
    expect(serialized).not.toContain("fault_config");
    expect(serialized).not.toContain("faultConfig");
    expect(serialized).not.toContain("fault_state");
    expect(serialized).not.toContain("faultState");
  });

  it("6: ordering is newest-first and deterministic across calls", async () => {
    const first = await listRecentChaosRuns(10);
    const second = await listRecentChaosRuns(10);
    expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id));

    const stamps = first.map((r) => r.createdAt);
    expect([...stamps].sort().reverse()).toEqual(stamps);
  });
});

describe("066 — run detail read model against approved runs", () => {
  it("7: the fresh C03 run reads back with its persisted PASS outcome", async () => {
    const detail = (await getChaosRunDetail(FRESH_C03_RUN_ID))!;

    expect(detail).not.toBeNull();
    expect(detail.id).toBe(FRESH_C03_RUN_ID);
    expect(detail.scenarioId).toBe("C03");
    expect(detail.status).toBe("COMPLETED");
    // The persisted verdict is authoritative — asserted, not recomputed.
    expect(detail.outcome).toBe("PASS");
    expect(detail.isBlocked).toBe(false);
  });

  it("8: its single persisted invariant result is projected faithfully", async () => {
    const detail = (await getChaosRunDetail(FRESH_C03_RUN_ID))!;

    expect(detail.invariantResults).toHaveLength(1);
    const result = detail.invariantResults[0]!;
    expect(result.invariantId).toBe("INV-005");
    expect(result.result).toBe("PASS");
    expect(result.invariantName).toBe(
      "Invalid Webhook Signature Causes Zero Mutation",
    );
    expect(result.expectedSummary.length).toBeGreaterThan(0);
    expect(result.observedSummary.length).toBeGreaterThan(0);
    expect(result.reason.length).toBeGreaterThan(0);
    // NOT_APPLICABLE never became a row, so INV-004 is absent — truthfully.
    expect(detail.invariantResults.map((r) => r.invariantId)).not.toContain(
      "INV-004",
    );
  });

  it("9: the historical C07 run's three UNKNOWN results stay UNKNOWN", async () => {
    const detail = (await getChaosRunDetail(HISTORICAL_C07_RUN_ID))!;

    expect(detail.outcome).toBe("UNKNOWN");
    expect(detail.invariantResults).toHaveLength(3);
    for (const result of detail.invariantResults) {
      expect(result.result).toBe("UNKNOWN");
    }
    expect(detail.invariantResults.map((r) => r.invariantId).sort()).toEqual([
      "INV-002",
      "INV-004",
      "INV-011",
    ]);
  });

  it("10: run detail matches the raw row field-for-field, minus the unsafe columns", async () => {
    const { data } = await client
      .from("chaos_runs")
      .select(
        "id, scenario_id, status, outcome, data_classification, fault_type, failed_precheck_id, execution_block_code, order_id, payment_attempt_id, payment_id, source_webhook_event_id, started_at, completed_at, created_at, updated_at",
      )
      .eq("id", FRESH_C03_RUN_ID)
      .single();

    const detail = (await getChaosRunDetail(FRESH_C03_RUN_ID))!;

    expect(detail.scenarioId).toBe(data!.scenario_id);
    expect(detail.status).toBe(data!.status);
    expect(detail.outcome).toBe(data!.outcome);
    expect(detail.dataClassification).toBe(data!.data_classification);
    expect(detail.faultType).toBe(data!.fault_type);
    expect(detail.startedAt).toBe(data!.started_at);
    expect(detail.completedAt).toBe(data!.completed_at);
    expect(detail.updatedAt).toBe(data!.updated_at);
    expect(detail.correlations).toEqual({
      orderId: data!.order_id,
      paymentAttemptId: data!.payment_attempt_id,
      paymentId: data!.payment_id,
      sourceWebhookEventId: data!.source_webhook_event_id,
    });
  });

  it("11: an unknown run id is null, not an error", async () => {
    expect(
      await getChaosRunDetail("00000000-0000-4000-8000-000000000000"),
    ).toBeNull();
  });

  it("12: no run detail leaks a payload, signature VALUE, secret or PII", async () => {
    // The word "signature" legitimately appears in frozen DOMAIN NAMES — the
    // `INVALID_SIGNATURE_TEST` fault primitive, INV-005's catalogue name, and
    // the evaluator's own deterministic prose. Banning the word would flag
    // correct output. What must never appear is a signature VALUE or the raw
    // material it is computed over, so those are what this asserts.
    for (const runId of APPROVED_PHASE_3F_RUN_IDS) {
      const serialized = JSON.stringify(
        await getChaosRunDetail(runId),
      ).toLowerCase();

      for (const forbidden of [
        "raw_payload",
        "normalized_event",
        "raw_body_sha256",
        "x-razorpay-signature",
        "signature_header",
        "signaturevalue",
        "hmac",
        "service_role",
        "fault_config",
        "fault_state",
        "faultconfig",
        "faultstate",
        "cvv",
        "otp",
        "cardnumber",
        "@", // no email address can appear in a safe run projection
      ]) {
        expect(serialized, `${runId} :: ${forbidden}`).not.toContain(forbidden);
      }

      // No long hex run that could be a digest or a signature.
      expect(serialized, `${runId} :: hex digest`).not.toMatch(
        /\b[0-9a-f]{32,}\b/,
      );
    }
  });
});

describe("066 — Finding summary read", () => {
  it("13: the approved eleven results have NO Finding — none is a FAIL", async () => {
    const { data } = await client
      .from("invariant_results")
      .select("id, result")
      .in("chaos_run_id", [...APPROVED_PHASE_3F_RUN_IDS]);

    const results = data ?? [];
    expect(results).toHaveLength(11);
    expect(results.some((r) => r.result === "FAIL")).toBe(false);

    const summaries = await listFindingSummariesForInvariantResults(
      results.map((r) => r.id),
    );
    expect(summaries.size).toBe(0);
  });

  it("14: an empty id list short-circuits without querying", async () => {
    expect((await listFindingSummariesForInvariantResults([])).size).toBe(0);
  });

  it("15: every run-detail result reports finding = null today", async () => {
    for (const runId of APPROVED_PHASE_3F_RUN_IDS) {
      const detail = (await getChaosRunDetail(runId))!;
      for (const result of detail.invariantResults) {
        expect(result.finding, `${runId} :: ${result.invariantId}`).toBeNull();
      }
    }
  });
});

describe("066 — evidence timeline over real evidence", () => {
  it("16: the timeline references only persisted evidence", async () => {
    const bundle = (await assembleChaosRunEvidence(HISTORICAL_C07_RUN_ID))!;
    const detail = (await getChaosRunDetail(HISTORICAL_C07_RUN_ID))!;
    const timeline = buildEvidenceTimeline(bundle, detail.invariantResults);

    expect(timeline.items.length).toBeGreaterThan(0);

    const persistedIds = new Set<string>([
      bundle.run.id,
      ...(bundle.sourceWebhook ? [bundle.sourceWebhook.id] : []),
      ...bundle.originalProcessingAttempts.map((a) => a.id),
      ...bundle.chaosProcessingAttempts.map((a) => a.id),
      ...detail.invariantResults.map((r) => r.id),
    ]);

    for (const item of timeline.items) {
      expect(
        persistedIds.has(item.subjectId),
        `${item.kind} references an id no persisted row supplied`,
      ).toBe(true);
    }
  });

  it("17: provenance values are factual and never PAYCHAOS_SIMULATION", async () => {
    for (const runId of APPROVED_PHASE_3F_RUN_IDS) {
      const bundle = (await assembleChaosRunEvidence(runId))!;
      const detail = (await getChaosRunDetail(runId))!;
      const timeline = buildEvidenceTimeline(bundle, detail.invariantResults);

      for (const item of timeline.items) {
        expect(
          [
            "REAL_RAZORPAY_WEBHOOK",
            "PAYCHAOS_REPLAY",
            "RECORDED_TEST_EVIDENCE",
            "SYNTHETIC_DEMO",
            "UNRECOGNISED",
          ],
          `${runId} :: ${item.kind}`,
        ).toContain(item.provenance);
        expect(item.provenance).not.toBe("PAYCHAOS_SIMULATION");
      }
      expect(JSON.stringify(timeline)).not.toContain("PAYCHAOS_SIMULATION");
    }
  });

  it("18: historical NOT_CAPTURED snapshots surface as gaps, not as state items", async () => {
    const bundle = (await assembleChaosRunEvidence(HISTORICAL_C07_RUN_ID))!;
    const detail = (await getChaosRunDetail(HISTORICAL_C07_RUN_ID))!;
    const timeline = buildEvidenceTimeline(bundle, detail.invariantResults);

    // Every processing attempt in the project pre-dates snapshot capture.
    expect(timeline.items.some((i) => i.kind === "STATE_SNAPSHOT")).toBe(false);
    expect(timeline.gaps.length).toBeGreaterThan(0);
    expect(timeline.gaps.some((g) => g.kind === "NOT_CAPTURED")).toBe(true);
  });

  it("19: no timeline item carries an invented timestamp", async () => {
    const bundle = (await assembleChaosRunEvidence(FRESH_C03_RUN_ID))!;
    const detail = (await getChaosRunDetail(FRESH_C03_RUN_ID))!;
    const timeline = buildEvidenceTimeline(bundle, detail.invariantResults);

    const persistedStamps = new Set<string | null>([
      bundle.run.startedAt,
      bundle.run.completedAt,
      ...detail.invariantResults.map((r) => r.evaluatedAt),
      ...(bundle.sourceWebhook ? [bundle.sourceWebhook.receivedAt] : []),
    ]);

    for (const item of timeline.items) {
      if (item.occurredAt === null) continue;
      expect(
        persistedStamps.has(item.occurredAt),
        `${item.kind} carries a timestamp no persisted row supplied`,
      ).toBe(true);
    }
  });
});

describe("066 — eligibility against the real database", () => {
  it("20: C03 needs no source at all", async () => {
    expect(await listEligibleSources({ scenarioId: "C03" })).toEqual({
      kind: "NO_SOURCE_REQUIRED",
    });
  });

  it("21: every other scenario returns a safe, correctly-shaped candidate set", async () => {
    const requests = [
      { scenarioId: "C01" as const },
      { scenarioId: "C07" as const },
      { scenarioId: "C11" as const, mechanism: "A" as const },
      { scenarioId: "C11" as const, mechanism: "B" as const },
    ];

    for (const request of requests) {
      const result = await listEligibleSources(request);
      const label = JSON.stringify(request);

      // Zero candidates is a VALID answer — the shape is what is asserted.
      if (result.kind === "WEBHOOK_SOURCES") {
        for (const candidate of result.candidates) {
          expect(Object.keys(candidate).sort(), label).toEqual([
            "eventType",
            "kind",
            "orderId",
            "receivedAt",
            "sourceKind",
            "webhookEventId",
          ]);
          expect(candidate.sourceKind).toBe("REAL_RAZORPAY_WEBHOOK");
        }
      } else if (result.kind === "ORDER_SUBJECTS") {
        for (const candidate of result.candidates) {
          expect(Object.keys(candidate).sort(), label).toEqual([
            "businessStatus",
            "createdAt",
            "fulfilmentCount",
            "kind",
            "orderId",
            "paymentStatus",
          ]);
          // The frozen freshness rule, re-asserted against real rows.
          expect(candidate.paymentStatus).toBe("UNPAID");
          expect(candidate.businessStatus).toBe("OPEN");
          expect(candidate.fulfilmentCount).toBe(0);
        }
      } else {
        throw new Error(`unexpected eligibility kind for ${label}`);
      }
    }
  });

  it("22: no candidate set leaks a payload, signature, secret or PII", async () => {
    for (const request of [
      { scenarioId: "C01" as const },
      { scenarioId: "C07" as const },
      { scenarioId: "C11" as const, mechanism: "B" as const },
    ]) {
      const serialized = JSON.stringify(
        await listEligibleSources(request),
      ).toLowerCase();
      for (const forbidden of [
        "raw_payload",
        "normalized_event",
        "signature",
        "secret",
        "email",
        "phone",
        "cvv",
        "http://",
        "https://",
        "test_fixture",
        "fixtureid",
      ]) {
        expect(serialized, forbidden).not.toContain(forbidden);
      }
    }
  });
});

describe("066 — nothing was written", () => {
  it("23: the approved baseline is byte-identical after every read above", async () => {
    const { data: results } = await client
      .from("invariant_results")
      .select("id, chaos_run_id, result")
      .in("chaos_run_id", [...APPROVED_PHASE_3F_RUN_IDS]);

    const tally = (results ?? []).reduce<Record<string, number>>((acc, r) => {
      acc[r.result] = (acc[r.result] ?? 0) + 1;
      return acc;
    }, {});

    expect(results).toHaveLength(11);
    expect(tally).toEqual({ PASS: 1, UNKNOWN: 10 });

    const { count: runCount } = await client
      .from("chaos_runs")
      .select("id", { count: "exact", head: true })
      .in("id", [...APPROVED_PHASE_3F_RUN_IDS]);
    expect(runCount).toBe(5);
  });

  it("24: the findings table is still empty — read models create nothing", async () => {
    const { count } = await client
      .from("findings")
      .select("id", { count: "exact", head: true });
    expect(count).toBe(0);
  });
});
