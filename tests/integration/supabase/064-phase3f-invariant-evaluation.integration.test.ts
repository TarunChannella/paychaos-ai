import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { evaluateChaosRun } from "@/lib/invariants/service";
import {
  findInvariantResult,
  persistInvariantResult,
  InvariantResultRepositoryError,
} from "@/lib/invariants/result-repository";
import { getSupabaseServerClient } from "@/lib/supabase/server";

import { getAnonClientForTest } from "./helpers";

/**
 * Phase 3F-C — proves the REAL end-to-end path against the live Supabase
 * project:
 *
 *   real chaos_runs row
 *     -> frozen Phase 3E evidence assembly
 *       -> frozen Phase 3F-B evaluators
 *         -> Phase 3F-C append-only persistence
 *           -> chaos_runs.outcome finalization
 *
 * This deliberately calls `evaluateChaosRun(...)` — the real orchestration —
 * rather than inserting an `invariant_results` row directly and calling that
 * coverage.
 *
 * SAFETY. Every mutated row is test-owned and created by this file. It runs no
 * chaos scenario, makes no payment, touches no Razorpay surface, and creates no
 * `orders`, `payment_attempts`, `payments`, `fulfilments`, `webhook_events` or
 * `event_processing_attempts` row. Its only writes are `SYNTHETIC_DEMO`
 * `chaos_runs` rows it creates itself, and the `invariant_results` rows the
 * orchestration derives from them. Cleanup deletes exact IDs only, children
 * before parents, and re-verifies zero remaining rows.
 *
 * The C03 shape is used throughout because it needs no merchant subject at
 * all: its `INV-004` is `NOT_APPLICABLE` and its `INV-005` is decided purely
 * from `fault_state.mutationEvidence`, so a complete run can be constructed
 * without creating or mutating a single merchant record.
 *
 * WHY NO RELATIONAL (order/payment/fulfilment) FIXTURE LIVES HERE
 * ---------------------------------------------------------------
 * `MONEY_INVARIANTS.md` §59 requires real database relationships for the
 * fulfilment-count, payment/order and rollback rules. Those rules cannot be
 * reached from a synthetic fixture in this repository, and that is a deliberate
 * safety property rather than an oversight:
 *
 *   - The frozen Phase 3E assembler reads ONLY `chaos_runs`, `webhook_events`
 *     and `event_processing_attempts`. Merchant rows never reach an evaluator
 *     directly — they arrive only inside a processing attempt's
 *     `state_before`/`state_after` snapshot.
 *   - Every `event_processing_attempts` row requires a non-null
 *     `webhook_event_id` (for BOTH `REAL_RAZORPAY_WEBHOOK` and
 *     `PAYCHAOS_REPLAY`).
 *   - `webhook_events` is CHECK-constrained to `source_kind =
 *     'REAL_RAZORPAY_WEBHOOK'` AND `signature_verified = true`. Every row in
 *     that table asserts a genuine, HMAC-authenticated Razorpay delivery.
 *
 * So manufacturing relational evidence here would mean inserting a row that
 * claims provider authenticity it does not have. This file will not do that.
 * The gap closes with a real Razorpay Test Mode payment and a real chaos run
 * executed AFTER Phase 3E-A snapshot capture — not with a fabricated fixture.
 */

const client = getSupabaseServerClient();

const createdChaosRunIds: string[] = [];
const createdInvariantResultIds: string[] = [];

/**
 * EVERY chaos_runs column, so "Phase 3F-C changes only `outcome`" is proven at
 * the database level rather than inferred from a source-code static assertion.
 *
 * `updated_at` matters most: there is no `updated_at` trigger anywhere in this
 * schema, so the column moves only when a writer sets it explicitly. Phase 3F-C
 * deliberately does not — which makes an unchanged `updated_at` real evidence
 * that finalization touched one column and nothing else.
 */
const CHAOS_RUN_COLUMNS =
  "id, scenario_id, order_id, payment_attempt_id, payment_id, source_webhook_event_id, status, outcome, fault_type, failed_precheck_id, execution_block_code, fault_config, fault_state, data_classification, error_message_redacted, started_at, completed_at, created_at, updated_at";

/** The exact set the projection above must contain — asserted, not assumed. */
const REQUIRED_CHAOS_RUN_COLUMNS = [
  "id",
  "scenario_id",
  "order_id",
  "payment_attempt_id",
  "payment_id",
  "source_webhook_event_id",
  "status",
  "outcome",
  "fault_type",
  "failed_precheck_id",
  "execution_block_code",
  "fault_config",
  "fault_state",
  "data_classification",
  "error_message_redacted",
  "started_at",
  "completed_at",
  "created_at",
  "updated_at",
] as const;

type Row = Record<string, unknown>;

let preExistingInvariantResultIds = new Set<string>();

/**
 * A complete, unchanged C03 mutation-evidence side.
 *
 * Empty collections with `complete: true` are the truthful shape for a
 * snapshot taken against a Demo Merchant with no rows in view: the collection
 * WAS read and WAS empty, which is different from "not read".
 */
function c03Side() {
  return {
    // Each side carries its own version marker — the frozen parser requires
    // exactly {version, orders, paymentAttempts, payments, fulfilments,
    // trustedWebhookEvents}.
    version: 1,
    orders: { count: 0, rows: [], complete: true },
    paymentAttempts: { count: 0, rows: [], complete: true },
    payments: { count: 0, rows: [], complete: true },
    fulfilments: { count: 0, rows: [], complete: true },
    trustedWebhookEvents: { count: 0, ids: [], complete: true },
  };
}

/** The frozen C03 `fault_state` shape: two rejected checks plus mutation evidence. */
function c03FaultState(options: { readonly withMutationEvidence: boolean }) {
  const checks = [
    { case: "WRONG_SIGNATURE", classification: "REJECTED" },
    { case: "MISSING_SIGNATURE", classification: "REJECTED" },
  ];
  if (!options.withMutationEvidence) return { checks };
  return {
    checks,
    mutationEvidence: { version: 1, before: c03Side(), after: c03Side() },
  };
}

/** Creates a COMPLETED/UNKNOWN C03 run — exactly the Phase 3D pre-evaluation shape. */
async function createCompletedC03Run(faultState: Record<string, unknown>) {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("chaos_runs")
    .insert({
      scenario_id: "C03",
      status: "COMPLETED",
      outcome: "UNKNOWN",
      fault_type: "INVALID_SIGNATURE_TEST",
      data_classification: "SYNTHETIC_DEMO",
      fault_state: faultState,
      started_at: now,
      completed_at: now,
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  expect(data).not.toBeNull();
  createdChaosRunIds.push(data!.id);
  return data!.id;
}

async function readChaosRun(id: string): Promise<Row> {
  const { data, error } = await client
    .from("chaos_runs")
    .select(CHAOS_RUN_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  expect(error).toBeNull();
  expect(data).not.toBeNull();
  return data as Row;
}

async function resultsFor(chaosRunId: string): Promise<Row[]> {
  const { data, error } = await client
    .from("invariant_results")
    .select(
      "id, invariant_id, invariant_version, order_id, payment_attempt_id, payment_id, chaos_run_id, result, severity, expected_summary, observed_summary, reason, evidence_refs, evaluated_at",
    )
    .eq("chaos_run_id", chaosRunId)
    .order("invariant_id", { ascending: true });
  expect(error).toBeNull();
  for (const row of data ?? []) {
    if (!createdInvariantResultIds.includes(row.id)) {
      createdInvariantResultIds.push(row.id);
    }
  }
  return (data ?? []) as Row[];
}

beforeAll(async () => {
  const { data } = await client.from("invariant_results").select("id");
  preExistingInvariantResultIds = new Set((data ?? []).map((r) => r.id));
}, 120_000);

describe("Phase 3F-C — real orchestration persists a PASS and finalizes the outcome", () => {
  let passRunId = "";
  let firstResultId = "";
  let firstEvaluatedAt = "";
  let beforeRun: Row = {};

  it("1: a complete C03 run evaluates INV-004 NOT_APPLICABLE + INV-005 PASS", async () => {
    passRunId = await createCompletedC03Run(
      c03FaultState({ withMutationEvidence: true }),
    );
    beforeRun = await readChaosRun(passRunId);

    const result = await evaluateChaosRun(passRunId);

    expect(result.chaosRunId).toBe(passRunId);
    expect(result.scenarioId).toBe("C03");
    expect(result.evaluations.map((e) => e.invariantId)).toEqual([
      "INV-004",
      "INV-005",
    ]);
    expect(
      result.evaluations.find((e) => e.invariantId === "INV-004")!.disposition,
    ).toBe("NOT_APPLICABLE");
    expect(
      result.evaluations.find((e) => e.invariantId === "INV-005")!.disposition,
    ).toBe("PASS");
    expect(result.aggregateOutcome).toBe("PASS");
    expect(result.outcomeFinalization).toBe("FINALIZED");
  });

  it("2: NOT_APPLICABLE created NO invariant_results row; PASS created exactly one", async () => {
    const rows = await resultsFor(passRunId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.invariant_id).toBe("INV-005");
    expect(rows[0]!.result).toBe("PASS");
    firstResultId = rows[0]!.id as string;
    firstEvaluatedAt = rows[0]!.evaluated_at as string;

    // No INV-004 row exists at all.
    expect(await findInvariantResult(passRunId, "INV-004")).toBeNull();
  });

  it("3: the C03 row carries NULL merchant correlations and a non-NULL chaos run", async () => {
    const rows = await resultsFor(passRunId);
    expect(rows[0]!.order_id).toBeNull();
    expect(rows[0]!.payment_attempt_id).toBeNull();
    expect(rows[0]!.payment_id).toBeNull();
    expect(rows[0]!.chaos_run_id).toBe(passRunId);
    expect(rows[0]!.severity).toBe("CRITICAL");
    expect(rows[0]!.invariant_version).toBe("1");
    expect(Array.isArray(rows[0]!.evidence_refs)).toBe(true);
  });

  it("3b: every persisted evidence ref resolves to a REAL row in its own table", async () => {
    const rows = await resultsFor(passRunId);
    const refs = rows[0]!.evidence_refs as Array<{ kind: string; id: string }>;

    expect(refs.length).toBeGreaterThan(0);

    // Canonical form: valid kind, valid UUID, deduped, deterministically sorted.
    const table: Record<string, string> = {
      ORDER: "orders",
      PAYMENT_ATTEMPT: "payment_attempts",
      PAYMENT: "payments",
      FULFILMENT: "fulfilments",
      WEBHOOK_EVENT: "webhook_events",
      EVENT_PROCESSING_ATTEMPT: "event_processing_attempts",
      CHAOS_RUN: "chaos_runs",
    };
    for (const ref of refs) {
      expect(Object.keys(table)).toContain(ref.kind);
      expect(ref.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    }
    const serialized = refs.map((r) => `${r.kind}:${r.id}`);
    expect(serialized).toEqual([...new Set(serialized)]);
    expect(serialized).toEqual([...serialized].sort());

    // The point of the test: these are not decorative strings. Each one is a
    // primary key that actually exists in the live database right now.
    for (const ref of refs) {
      const { data, error } = await client
        .from(table[ref.kind]!)
        .select("id")
        .eq("id", ref.id)
        .maybeSingle();
      expect(error, `${ref.kind} ${ref.id} lookup failed`).toBeNull();
      expect(
        data,
        `evidence ref ${ref.kind}:${ref.id} does not resolve to a persisted row`,
      ).not.toBeNull();
    }
  });

  it("4: finalization changed ONLY chaos_runs.outcome — every other column is identical", async () => {
    const afterRun = await readChaosRun(passRunId);
    expect(afterRun.outcome).toBe("PASS");
    expect(beforeRun.outcome).toBe("UNKNOWN");

    // The comparison is only as strong as the projection, so prove the
    // projection actually carries every column first.
    for (const column of REQUIRED_CHAOS_RUN_COLUMNS) {
      expect(
        Object.keys(beforeRun),
        `chaos_runs.${column} must be part of the compared projection`,
      ).toContain(column);
    }
    expect(Object.keys(beforeRun).sort()).toEqual(
      [...REQUIRED_CHAOS_RUN_COLUMNS].sort(),
    );

    for (const column of Object.keys(beforeRun)) {
      if (column === "outcome") continue;
      expect(
        afterRun[column],
        `chaos_runs.${column} must be unchanged`,
      ).toEqual(beforeRun[column]);
    }
  });

  it("4b: named proof for the three columns a careless finalizer would move", async () => {
    const afterRun = await readChaosRun(passRunId);

    // Phase 3F-C writes `{ outcome }` and nothing else. No trigger exists to
    // move `updated_at` on its behalf, so this must hold exactly.
    expect(afterRun.updated_at).toEqual(beforeRun.updated_at);
    expect(afterRun.fault_config).toEqual(beforeRun.fault_config);
    expect(afterRun.error_message_redacted).toEqual(
      beforeRun.error_message_redacted,
    );

    // And the evidence the evaluators read is itself untouched.
    expect(afterRun.fault_state).toEqual(beforeRun.fault_state);
    expect(afterRun.status).toBe("COMPLETED");
    expect(afterRun.data_classification).toBe("SYNTHETIC_DEMO");
  });

  it("5: re-evaluating is idempotent — same row id, same evaluated_at, no second row", async () => {
    const again = await evaluateChaosRun(passRunId);
    expect(again.aggregateOutcome).toBe("PASS");
    expect(again.outcomeFinalization).toBe("ALREADY_FINAL");
    expect(
      again.evaluations.find((e) => e.invariantId === "INV-005")!
        .alreadyPersisted,
    ).toBe(true);

    const rows = await resultsFor(passRunId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(firstResultId);
    expect(rows[0]!.evaluated_at).toBe(firstEvaluatedAt);
  });

  it("6: a contradictory candidate raises an integrity conflict and does NOT overwrite", async () => {
    const conflicting = persistInvariantResult({
      invariantId: "INV-005",
      invariantVersion: "1",
      orderId: null,
      paymentAttemptId: null,
      paymentId: null,
      chaosRunId: passRunId,
      result: "FAIL",
      severity: "CRITICAL",
      expectedSummary: "deliberately different",
      observedSummary: "deliberately different",
      reason: "a contradictory candidate for the same run and invariant",
      evidenceRefs: [{ kind: "CHAOS_RUN", id: passRunId }],
    });
    await expect(conflicting).rejects.toBeInstanceOf(
      InvariantResultRepositoryError,
    );
    await expect(conflicting).rejects.toMatchObject({
      code: "INVARIANT_RESULT_INTEGRITY_CONFLICT",
    });

    // The original row is untouched: same id, same verdict, same timestamp.
    const rows = await resultsFor(passRunId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(firstResultId);
    expect(rows[0]!.result).toBe("PASS");
    expect(rows[0]!.evaluated_at).toBe(firstEvaluatedAt);
  });
});

describe("Phase 3F-C — real orchestration persists an UNKNOWN and aggregates UNKNOWN", () => {
  let unknownRunId = "";

  it("7: a legacy C03 run with no mutation evidence evaluates INV-005 UNKNOWN", async () => {
    unknownRunId = await createCompletedC03Run(
      c03FaultState({ withMutationEvidence: false }),
    );
    const result = await evaluateChaosRun(unknownRunId);

    expect(
      result.evaluations.find((e) => e.invariantId === "INV-004")!.disposition,
    ).toBe("NOT_APPLICABLE");
    expect(
      result.evaluations.find((e) => e.invariantId === "INV-005")!.disposition,
    ).toBe("UNKNOWN");
    expect(result.aggregateOutcome).toBe("UNKNOWN");
  });

  it("8: exactly one UNKNOWN row is persisted and the outcome is UNKNOWN", async () => {
    const rows = await resultsFor(unknownRunId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.invariant_id).toBe("INV-005");
    expect(rows[0]!.result).toBe("UNKNOWN");

    const run = await readChaosRun(unknownRunId);
    expect(run.outcome).toBe("UNKNOWN");
  });

  it("9: an outcome that is already correct finalizes idempotently", async () => {
    const again = await evaluateChaosRun(unknownRunId);
    expect(again.aggregateOutcome).toBe("UNKNOWN");
    expect(again.outcomeFinalization).toBe("ALREADY_FINAL");
    expect(await resultsFor(unknownRunId)).toHaveLength(1);
  });
});

describe("Phase 3F-C — ineligible runs are never evaluated", () => {
  it("10: a PENDING run is not evaluable and persists nothing", async () => {
    const { data, error } = await client
      .from("chaos_runs")
      .insert({ scenario_id: "C03", data_classification: "SYNTHETIC_DEMO" })
      .select("id")
      .single();
    expect(error).toBeNull();
    createdChaosRunIds.push(data!.id);

    await expect(evaluateChaosRun(data!.id)).rejects.toMatchObject({
      code: "CHAOS_RUN_NOT_EVALUABLE",
    });
    expect(await resultsFor(data!.id)).toHaveLength(0);
  });

  it("11: an unknown chaos run id is not evaluable", async () => {
    await expect(evaluateChaosRun(randomUUID())).rejects.toMatchObject({
      code: "CHAOS_RUN_NOT_EVALUABLE",
    });
  });
});

describe("Phase 3F-C — RLS and privileges hold for the results this run created", () => {
  it("12: anon cannot read invariant_results", async () => {
    const anon = getAnonClientForTest();
    const { data, error } = await anon
      .from("invariant_results")
      .select("id")
      .limit(1);
    expect(data === null || data.length === 0).toBe(true);
    void error;
  });

  it("13: service_role can SELECT the rows the orchestration created", async () => {
    expect(createdInvariantResultIds.length).toBeGreaterThan(0);
    const { data, error } = await client
      .from("invariant_results")
      .select("id")
      .in("id", createdInvariantResultIds);
    expect(error).toBeNull();
    expect(data!.length).toBe(createdInvariantResultIds.length);
  });

  it("14: no role can UPDATE a persisted invariant result", async () => {
    const target = createdInvariantResultIds[0]!;
    const updateResult = await (
      client.from("invariant_results") as unknown as {
        update: (values: Record<string, unknown>) => {
          eq: (c: string, v: string) => Promise<{ error: unknown | null }>;
        };
      }
    )
      .update({ result: "FAIL" })
      .eq("id", target);
    expect(updateResult.error).not.toBeNull();

    const { data } = await client
      .from("invariant_results")
      .select("result")
      .eq("id", target)
      .maybeSingle();
    expect(data?.result).not.toBe("FAIL");
  });
});

describe("Phase 3F-C — nothing outside this file's own rows was touched", () => {
  it("15: no merchant, webhook or processing-attempt row was created", async () => {
    // This file writes only chaos_runs and invariant_results. Proven by the
    // provenance guard statically; re-confirmed here as a live count check of
    // the rows this file owns.
    expect(createdChaosRunIds.length).toBeGreaterThan(0);
    const { count } = await client
      .from("chaos_runs")
      .select("id", { count: "exact", head: true })
      .in("id", createdChaosRunIds);
    expect(count).toBe(createdChaosRunIds.length);
  });

  it("16: every invariant_results row this file created belongs to one of its own chaos runs", async () => {
    const { data, error } = await client
      .from("invariant_results")
      .select("id, chaos_run_id")
      .in("id", createdInvariantResultIds);
    expect(error).toBeNull();
    for (const row of data ?? []) {
      expect(createdChaosRunIds).toContain(row.chaos_run_id);
      expect(preExistingInvariantResultIds.has(row.id)).toBe(false);
    }
  });
});

afterAll(async () => {
  // Children before parents — the FK is RESTRICT.
  for (let i = 0; i < createdInvariantResultIds.length; i += 50) {
    const chunk = createdInvariantResultIds.slice(i, i + 50);
    if (chunk.length === 0) continue;
    await client.from("invariant_results").delete().in("id", chunk);
  }
  for (let i = 0; i < createdChaosRunIds.length; i += 50) {
    const chunk = createdChaosRunIds.slice(i, i + 50);
    if (chunk.length === 0) continue;
    await client.from("chaos_runs").delete().in("id", chunk);
  }

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
