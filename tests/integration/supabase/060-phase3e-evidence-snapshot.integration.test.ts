import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { createPendingChaosRun } from "@/lib/chaos/run-repository";
import { insertReplayProcessingAttempt } from "@/lib/chaos/replay-repository";
import {
  MerchantProcessingError,
  processMerchantWebhookEvent,
} from "@/lib/events/processor";
import {
  captureMerchantStateSnapshotForProcessingAttempt,
  getProcessingSnapshotEligibility,
  persistProcessingStateAfter,
  persistProcessingStateBefore,
} from "@/lib/evidence/evidence-repository";
import { buildMerchantStateSnapshot } from "@/lib/evidence/merchant-state-snapshot";

import { taggedValue, trackAttempt, trackOrder } from "./helpers";

/**
 * Phase 3E-A — proves the evidence-snapshot SCHEMA/CONSTRAINT/SET-ONCE/
 * PROCESSOR-INSTRUMENTATION MECHANICS (migration
 * `20260901000000_phase3e_evidence_snapshots.sql`) against the REAL Supabase
 * project.
 *
 * *** NOT RUNNABLE YET ***. That migration has NOT been manually applied to
 * the remote project — every test in this file will fail with a PostgREST
 * "column event_processing_attempts.state_before does not exist" style error
 * until the developer applies it manually after architect review. That
 * failure is expected and must be reported honestly, not hidden, not skipped
 * and not worked around: Claude does not apply this migration.
 *
 * ============================================================================
 * PROVENANCE DISCIPLINE — identical to 053/057/058/059, read those files'
 * own module doc comments first if unfamiliar. Three distinct layers, never
 * conflated:
 * ============================================================================
 *
 *   1. This file's own `chaos_runs` rows are ALWAYS `data_classification =
 *      SYNTHETIC_DEMO` — never `RECORDED_TEST_EVIDENCE`. This file never
 *      calls `createChaosRun`/`runChaosPrecheck` or any production
 *      positive-path execution service (`executeC01Replay`,
 *      `executeC11RealWebhookReplay`, `startC11AFailureObservation`, the C03
 *      or C07 services, or any chaos HTTP route) — only the
 *      repository-level `createPendingChaosRun` plus the exact repository/
 *      processor functions under direct test.
 *   2. `normalized_event.sourceKind = REAL_RAZORPAY_WEBHOOK` describes the
 *      provenance the merchant-processing transaction requires of the
 *      underlying evidence; it is not a claim that this test execution is a
 *      genuine provider delivery.
 *   3. `webhook_events.source_kind = REAL_RAZORPAY_WEBHOOK` on the rows this
 *      file inserts is a SYNTHETIC CANONICAL COMPATIBILITY ROW, required
 *      only because the schema accepts no other literal for that column. NOT
 *      genuine provider evidence. Deleted unconditionally in `afterAll`.
 *
 * This file NEVER claims a genuine positive chaos-scenario execution, and
 * never claims genuine Razorpay delivery evidence.
 * `tests/unit/supabase/060-phase3e-evidence-snapshot-provenance-guard.test.ts`
 * statically enforces the rules above.
 *
 * ============================================================================
 * HISTORICAL EVIDENCE IS READ-ONLY HERE
 * ============================================================================
 *
 * Phase 3D's manually-verified `chaos_runs`/`event_processing_attempts`
 * evidence already living in this project must never be mutated or deleted
 * by this suite. `beforeAll` records every PRE-EXISTING
 * `event_processing_attempts` row's id plus its `state_before`/`state_after`
 * values, and `afterAll` re-reads them and asserts byte-identical values —
 * an independent proof, not an assumption, that nothing this file did
 * touched historical evidence.
 */

const client = getSupabaseServerClient();

const outstandingAttemptIds: string[] = [];
const outstandingChaosRunIds: string[] = [];
const outstandingWebhookEventIds: string[] = [];
const outstandingPaymentIds: string[] = [];
const outstandingFulfilmentOrderIds: string[] = [];
const outstandingPaymentAttemptIds: string[] = [];
const outstandingOrderIds: string[] = [];

/** id -> JSON of `{ state_before, state_after }` for every row that existed BEFORE this file ran. */
const preExistingAttemptEvidence = new Map<string, string>();

function fakeSha256Hex(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

interface SyntheticCapturedFixture {
  orderId: string;
  paymentAttemptId: string;
  paymentId: string;
  webhookEventId: string;
  originalProcessingAttemptId: string;
  razorpayEventId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  amountSubunits: number;
  normalizedEvent: Record<string, unknown>;
}

/**
 * Builds one complete, self-consistent SYNTHETIC "healthy captured payment"
 * fixture — order -> payment_attempt -> payments -> webhook_events
 * (`payment.captured`) -> the ORIGINAL `event_processing_attempts` row — and
 * returns it WITHOUT processing it, so each test can decide when (and
 * whether) the processor runs.
 *
 * Never genuine Razorpay evidence: see the module doc comment above.
 */
async function createSyntheticCapturedFixture(
  label: string,
): Promise<SyntheticCapturedFixture> {
  const amountSubunits = 75_000;
  const razorpayOrderId = taggedValue(`${label}-order`);
  const razorpayPaymentId = taggedValue(`${label}-payment`);

  const { data: order, error: orderError } = await client
    .from("orders")
    .insert({
      amount_subunits: amountSubunits,
      currency: "INR",
      payment_status: "UNPAID",
      business_status: "OPEN",
    })
    .select()
    .single();
  expect(orderError).toBeNull();
  const orderId = order!.id;
  trackOrder(orderId);
  outstandingOrderIds.push(orderId);
  outstandingFulfilmentOrderIds.push(orderId);

  const { data: attempt, error: attemptError } = await client
    .from("payment_attempts")
    .insert({
      order_id: orderId,
      attempt_no: 1,
      amount_subunits: amountSubunits,
      currency: "INR",
      razorpay_receipt: taggedValue(`${label}-receipt`),
      razorpay_order_id: razorpayOrderId,
    })
    .select()
    .single();
  expect(attemptError).toBeNull();
  const paymentAttemptId = attempt!.id;
  trackAttempt(paymentAttemptId);
  outstandingPaymentAttemptIds.push(paymentAttemptId);

  const { data: payment, error: paymentError } = await client
    .from("payments")
    .insert({
      payment_attempt_id: paymentAttemptId,
      razorpay_payment_id: razorpayPaymentId,
      amount_subunits: amountSubunits,
      currency: "INR",
    })
    .select()
    .single();
  expect(paymentError).toBeNull();
  const paymentId = payment!.id;
  outstandingPaymentIds.push(paymentId);

  const razorpayEventId = taggedValue(`${label}-event`);
  const { data: webhookEvent, error: webhookError } = await client
    .from("webhook_events")
    .insert({
      razorpay_event_id: razorpayEventId,
      event_type: "payment.captured",
      signature_verified: true,
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      payment_attempt_id: paymentAttemptId,
      payment_id: paymentId,
      amount_subunits: amountSubunits,
      currency: "INR",
      razorpay_payment_status: "captured",
      raw_body_sha256: fakeSha256Hex(`${label}-${randomUUID()}`),
      raw_payload_redacted: { event: "payment.captured", synthetic: true },
    })
    .select()
    .single();
  expect(webhookError).toBeNull();
  const webhookEventId = webhookEvent!.id;
  outstandingWebhookEventIds.push(webhookEventId);

  const normalizedEvent: Record<string, unknown> = {
    sourceKind: "REAL_RAZORPAY_WEBHOOK",
    eventType: "payment.captured",
    kind: "payment.captured",
    razorpayOrderId,
    razorpayPaymentId,
    amountSubunits,
    currency: "INR",
    razorpayPaymentStatus: "captured",
  };

  const { data: originalAttempt, error: originalAttemptError } = await client
    .from("event_processing_attempts")
    .insert({
      webhook_event_id: webhookEventId,
      payment_attempt_id: paymentAttemptId,
      payment_id: paymentId,
      source_kind: "REAL_RAZORPAY_WEBHOOK",
      is_duplicate_delivery: false,
      status: "PENDING",
      normalized_event: normalizedEvent,
    })
    .select()
    .single();
  expect(originalAttemptError).toBeNull();
  const originalProcessingAttemptId = originalAttempt!.id;
  outstandingAttemptIds.push(originalProcessingAttemptId);

  return {
    orderId,
    paymentAttemptId,
    paymentId,
    webhookEventId,
    originalProcessingAttemptId,
    razorpayEventId,
    razorpayOrderId,
    razorpayPaymentId,
    amountSubunits,
    normalizedEvent,
  };
}

/** Mechanics-only chaos_run audit row — ALWAYS SYNTHETIC_DEMO, never the production creation path. */
async function createSyntheticMechanicsChaosRun(
  fixture: SyntheticCapturedFixture,
): Promise<string> {
  const chaosRun = await createPendingChaosRun({
    scenarioId: "C01",
    faultType: "REPLAY_EVENT",
    dataClassification: "SYNTHETIC_DEMO",
    orderId: fixture.orderId,
    paymentAttemptId: fixture.paymentAttemptId,
    paymentId: fixture.paymentId,
    sourceWebhookEventId: fixture.webhookEventId,
  });
  expect(chaosRun.data_classification).toBe("SYNTHETIC_DEMO");
  outstandingChaosRunIds.push(chaosRun.id);
  return chaosRun.id;
}

async function readAttemptEvidence(attemptId: string): Promise<{
  state_before: Record<string, unknown> | null;
  state_after: Record<string, unknown> | null;
  status: string;
}> {
  const { data, error } = await client
    .from("event_processing_attempts")
    .select("state_before, state_after, status")
    .eq("id", attemptId)
    .single();
  expect(error).toBeNull();
  return {
    state_before: data!.state_before,
    state_after: data!.state_after,
    status: data!.status,
  };
}

beforeAll(async () => {
  const { data, error } = await client
    .from("event_processing_attempts")
    .select("id, state_before, state_after");
  expect(error).toBeNull();
  for (const row of data ?? []) {
    preExistingAttemptEvidence.set(
      row.id,
      JSON.stringify({
        state_before: row.state_before ?? null,
        state_after: row.state_after ?? null,
      }),
    );
  }
}, 60_000);

describe("Phase 3E-A — the evidence-snapshot columns and their CHECK constraints exist", () => {
  it("state_before and state_after are selectable columns on event_processing_attempts, defaulting to NULL", async () => {
    const fixture = await createSyntheticCapturedFixture("evi-columns");
    const row = await readAttemptEvidence(fixture.originalProcessingAttemptId);
    expect(row.state_before).toBeNull();
    expect(row.state_after).toBeNull();
  });

  it("a JSON OBJECT is accepted in both columns", async () => {
    const fixture = await createSyntheticCapturedFixture("evi-object-ok");
    const { error } = await client
      .from("event_processing_attempts")
      .update({
        state_before: { version: 1, order: null },
        state_after: { version: 1, order: null },
      })
      .eq("id", fixture.originalProcessingAttemptId);
    expect(error).toBeNull();

    const row = await readAttemptEvidence(fixture.originalProcessingAttemptId);
    expect(row.state_before).toEqual({ version: 1, order: null });
    expect(row.state_after).toEqual({ version: 1, order: null });
  });

  it("a scalar or array snapshot is REJECTED by the database (23514), not merely discouraged in TypeScript", async () => {
    const fixture = await createSyntheticCapturedFixture("evi-object-check");

    for (const invalid of [42, "a string", true, [1, 2, 3]]) {
      const before = await client
        .from("event_processing_attempts")
        .update({
          state_before: invalid as unknown as Record<string, unknown>,
        })
        .eq("id", fixture.originalProcessingAttemptId);
      expect(before.error).not.toBeNull();
      expect(before.error?.code).toBe("23514");

      const after = await client
        .from("event_processing_attempts")
        .update({
          state_after: invalid as unknown as Record<string, unknown>,
        })
        .eq("id", fixture.originalProcessingAttemptId);
      expect(after.error).not.toBeNull();
      expect(after.error?.code).toBe("23514");
    }

    // Nothing was written by any rejected attempt.
    const row = await readAttemptEvidence(fixture.originalProcessingAttemptId);
    expect(row.state_before).toBeNull();
    expect(row.state_after).toBeNull();
  });
});

describe("Phase 3E-A — set-once semantics against real Postgres", () => {
  it("persistProcessingStateBefore writes once, then reports ALREADY_CAPTURED and PRESERVES the original historical snapshot", async () => {
    const fixture = await createSyntheticCapturedFixture("evi-set-once-before");

    const first = await captureMerchantStateSnapshotForProcessingAttempt(
      fixture.originalProcessingAttemptId,
    );
    const firstResult = await persistProcessingStateBefore(
      fixture.originalProcessingAttemptId,
      first,
    );
    expect(firstResult.outcome).toBe("CAPTURED");
    const durable = firstResult.snapshot;

    // A DIFFERENT snapshot value must not be able to overwrite it.
    const different = buildMerchantStateSnapshot({
      order: null,
      paymentAttempt: null,
      payment: null,
      fulfilments: null,
    });
    const secondResult = await persistProcessingStateBefore(
      fixture.originalProcessingAttemptId,
      different,
    );
    expect(secondResult.outcome).toBe("ALREADY_CAPTURED");
    expect(secondResult.snapshot).toEqual(durable);

    const row = await readAttemptEvidence(fixture.originalProcessingAttemptId);
    expect(row.state_before).toEqual(durable);
  });

  it("persistProcessingStateAfter writes once, then reports ALREADY_CAPTURED and PRESERVES the original historical snapshot", async () => {
    const fixture = await createSyntheticCapturedFixture("evi-set-once-after");

    const snapshot = await captureMerchantStateSnapshotForProcessingAttempt(
      fixture.originalProcessingAttemptId,
    );
    const firstResult = await persistProcessingStateAfter(
      fixture.originalProcessingAttemptId,
      snapshot,
    );
    expect(firstResult.outcome).toBe("CAPTURED");

    const secondResult = await persistProcessingStateAfter(
      fixture.originalProcessingAttemptId,
      buildMerchantStateSnapshot({
        order: null,
        paymentAttempt: null,
        payment: null,
        fulfilments: null,
      }),
    );
    expect(secondResult.outcome).toBe("ALREADY_CAPTURED");
    expect(secondResult.snapshot).toEqual(firstResult.snapshot);
  });

  it("a persist against an unknown processing-attempt id reports ATTEMPT_NOT_FOUND and writes nothing", async () => {
    const snapshot = buildMerchantStateSnapshot({
      order: null,
      paymentAttempt: null,
      payment: null,
      fulfilments: null,
    });
    const result = await persistProcessingStateBefore(randomUUID(), snapshot);
    expect(result).toEqual({ outcome: "ATTEMPT_NOT_FOUND", snapshot: null });
  });
});

describe("Phase 3E-A — processing-lifecycle eligibility against the real schema", () => {
  it("a freshly-created PENDING attempt is ELIGIBLE_PENDING; the same attempt once terminal is NOT_ELIGIBLE_TERMINAL", async () => {
    const fixture = await createSyntheticCapturedFixture("evi-eligibility");

    await expect(
      getProcessingSnapshotEligibility(fixture.originalProcessingAttemptId),
    ).resolves.toEqual({ kind: "ELIGIBLE_PENDING", status: "PENDING" });

    await processMerchantWebhookEvent(fixture.originalProcessingAttemptId);

    await expect(
      getProcessingSnapshotEligibility(fixture.originalProcessingAttemptId),
    ).resolves.toEqual({
      kind: "NOT_ELIGIBLE_TERMINAL",
      status: "SUCCEEDED",
    });
  });

  it("an unknown attempt id is ATTEMPT_NOT_FOUND", async () => {
    await expect(
      getProcessingSnapshotEligibility(randomUUID()),
    ).resolves.toEqual({ kind: "ATTEMPT_NOT_FOUND" });
  });
});

describe("Phase 3E-A — captureMerchantStateSnapshotForProcessingAttempt against the real schema", () => {
  it("projects the correlated order/payment attempt/payment/fulfilments using the real column names", async () => {
    const fixture = await createSyntheticCapturedFixture("evi-capture-shape");

    const snapshot = await captureMerchantStateSnapshotForProcessingAttempt(
      fixture.originalProcessingAttemptId,
    );

    expect(snapshot.version).toBe(1);
    expect(snapshot.order?.id).toBe(fixture.orderId);
    expect(snapshot.order?.paymentStatus).toBe("UNPAID");
    expect(snapshot.order?.businessStatus).toBe("OPEN");
    expect(snapshot.order?.amountSubunits).toBe(fixture.amountSubunits);
    expect(snapshot.order?.currency).toBe("INR");
    expect(snapshot.paymentAttempt?.id).toBe(fixture.paymentAttemptId);
    expect(snapshot.paymentAttempt?.razorpayOrderId).toBe(
      fixture.razorpayOrderId,
    );
    expect(snapshot.payment?.id).toBe(fixture.paymentId);
    expect(snapshot.payment?.razorpayPaymentId).toBe(fixture.razorpayPaymentId);
    // No fulfilment has been created yet — a genuine, resolved zero.
    expect(snapshot.fulfilments).toEqual([]);
  });
});

describe("Phase 3E-A — processor instrumentation persists BEFORE and AFTER, and leaves merchant processing unchanged", () => {
  it("a successful REAL_RAZORPAY_WEBHOOK processing attempt ends with both snapshots persisted, and they differ exactly as the merchant state changed", async () => {
    const fixture = await createSyntheticCapturedFixture("evi-processor");

    const result = await processMerchantWebhookEvent(
      fixture.originalProcessingAttemptId,
    );

    // The frozen Phase 2F processing result is unchanged.
    expect(result.outcome).toBe("processed");
    expect(result.orderId).toBe(fixture.orderId);
    expect(result.paymentId).toBe(fixture.paymentId);
    expect(result.fulfilmentId).not.toBeNull();

    const row = await readAttemptEvidence(fixture.originalProcessingAttemptId);
    expect(row.status).toBe("SUCCEEDED");
    expect(row.state_before).not.toBeNull();
    expect(row.state_after).not.toBeNull();

    const before = row.state_before as Record<string, unknown>;
    const after = row.state_after as Record<string, unknown>;
    expect(before.version).toBe(1);
    expect(after.version).toBe(1);

    const beforeOrder = before.order as Record<string, unknown>;
    const afterOrder = after.order as Record<string, unknown>;
    expect(beforeOrder.paymentStatus).toBe("UNPAID");
    expect(beforeOrder.businessStatus).toBe("OPEN");
    expect(afterOrder.paymentStatus).toBe("PAID");
    expect(afterOrder.businessStatus).toBe("FULFILLED");

    // This is the whole point of the columns: the historical BEFORE state is
    // no longer derivable from the current, now-mutated order row.
    expect(before.fulfilments).toEqual([]);
    expect(after.fulfilments).toHaveLength(1);

    // And the current merchant state is exactly what Phase 2F always produced.
    const { data: order } = await client
      .from("orders")
      .select("payment_status, business_status")
      .eq("id", fixture.orderId)
      .single();
    expect(order?.payment_status).toBe("PAID");
    expect(order?.business_status).toBe("FULFILLED");

    const { data: fulfilments } = await client
      .from("fulfilments")
      .select("id")
      .eq("order_id", fixture.orderId);
    expect(fulfilments).toHaveLength(1);
  });

  it("a PAYCHAOS_REPLAY attempt gains its own snapshots, and NEVER mutates the original attempt's historical snapshots", async () => {
    const fixture = await createSyntheticCapturedFixture("evi-replay");
    await processMerchantWebhookEvent(fixture.originalProcessingAttemptId);
    const originalEvidence = await readAttemptEvidence(
      fixture.originalProcessingAttemptId,
    );
    expect(originalEvidence.state_before).not.toBeNull();
    expect(originalEvidence.state_after).not.toBeNull();

    const chaosRunId = await createSyntheticMechanicsChaosRun(fixture);
    const replayAttempt = await insertReplayProcessingAttempt({
      chaosRunId,
      webhookEventId: fixture.webhookEventId,
      paymentAttemptId: fixture.paymentAttemptId,
      paymentId: fixture.paymentId,
      normalizedEvent: fixture.normalizedEvent,
    });
    outstandingAttemptIds.push(replayAttempt.id);

    const replayResult = await processMerchantWebhookEvent(replayAttempt.id);
    expect(["processed", "already_processed"]).toContain(replayResult.outcome);

    const replayEvidence = await readAttemptEvidence(replayAttempt.id);
    expect(replayEvidence.state_before).not.toBeNull();
    expect(replayEvidence.state_after).not.toBeNull();
    // The replay saw an ALREADY-PAID order — its BEFORE state is genuinely
    // different from the original attempt's BEFORE state.
    expect(
      (replayEvidence.state_before as Record<string, unknown>).order,
    ).toMatchObject({ paymentStatus: "PAID" });

    // The original attempt's evidence is byte-identical to what it was
    // before the replay ran.
    const originalAfterReplay = await readAttemptEvidence(
      fixture.originalProcessingAttemptId,
    );
    expect(originalAfterReplay.state_before).toEqual(
      originalEvidence.state_before,
    );
    expect(originalAfterReplay.state_after).toEqual(
      originalEvidence.state_after,
    );

    // Replay provenance is untouched by snapshotting.
    const { data: persisted } = await client
      .from("event_processing_attempts")
      .select("source_kind, chaos_run_id, is_duplicate_delivery")
      .eq("id", replayAttempt.id)
      .single();
    expect(persisted?.source_kind).toBe("PAYCHAOS_REPLAY");
    expect(persisted?.chaos_run_id).toBe(chaosRunId);
    expect(persisted?.is_duplicate_delivery).toBe(false);

    // The canonical webhook row is untouched: still exactly one, still no
    // duplicate-delivery increment.
    const { data: webhookRows } = await client
      .from("webhook_events")
      .select("id, duplicate_delivery_count")
      .eq("razorpay_event_id", fixture.razorpayEventId);
    expect(webhookRows).toHaveLength(1);
    expect(webhookRows?.[0]?.duplicate_delivery_count).toBe(0);
  });

  it("NO BACKFILL (B): a test-owned terminal SUCCEEDED attempt whose snapshots are deliberately NULL is NOT retroactively filled in by an idempotent re-entry", async () => {
    // Build a fixture and process it so the merchant state genuinely reaches
    // PAID/FULFILLED, then deliberately clear its snapshots to reproduce the
    // shape of every pre-Phase-3E historical row: terminal status, NULL
    // evidence.
    const fixture = await createSyntheticCapturedFixture("evi-no-backfill");
    await processMerchantWebhookEvent(fixture.originalProcessingAttemptId);

    const { error: clearError } = await client
      .from("event_processing_attempts")
      .update({ state_before: null, state_after: null })
      .eq("id", fixture.originalProcessingAttemptId);
    expect(clearError).toBeNull();

    const cleared = await readAttemptEvidence(
      fixture.originalProcessingAttemptId,
    );
    expect(cleared.status).toBe("SUCCEEDED");
    expect(cleared.state_before).toBeNull();
    expect(cleared.state_after).toBeNull();

    // Re-enter the frozen processor exactly as a later caller would. The
    // merchant state is now PAID/FULFILLED — if the instrumentation captured
    // anything here it would be TODAY's state masquerading as the state
    // around the ORIGINAL processing.
    const reentry = await processMerchantWebhookEvent(
      fixture.originalProcessingAttemptId,
    );
    expect(reentry.outcome).toBe("already_processed");

    const afterReentry = await readAttemptEvidence(
      fixture.originalProcessingAttemptId,
    );
    expect(afterReentry.state_before).toBeNull();
    expect(afterReentry.state_after).toBeNull();
  });

  it("NO BACKFILL (C): a test-owned non-runnable terminal attempt (FAILED) is not backfilled by an attempted re-entry", async () => {
    const fixture = await createSyntheticCapturedFixture("evi-no-backfill-f");

    // Force the attempt terminal WITHOUT ever processing it, so both
    // snapshots are legitimately NULL and the frozen RPC will reject it with
    // PROCESSING_ATTEMPT_NOT_READY.
    const { error: failError } = await client
      .from("event_processing_attempts")
      .update({ status: "FAILED", finished_at: new Date().toISOString() })
      .eq("id", fixture.originalProcessingAttemptId);
    expect(failError).toBeNull();

    const before = await readAttemptEvidence(
      fixture.originalProcessingAttemptId,
    );
    expect(before.status).toBe("FAILED");
    expect(before.state_before).toBeNull();
    expect(before.state_after).toBeNull();

    let caught: unknown = null;
    try {
      await processMerchantWebhookEvent(fixture.originalProcessingAttemptId);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MerchantProcessingError);
    expect((caught as MerchantProcessingError).code).toBe(
      "PROCESSING_ATTEMPT_NOT_READY",
    );

    const after = await readAttemptEvidence(
      fixture.originalProcessingAttemptId,
    );
    expect(after.state_before).toBeNull();
    expect(after.state_after).toBeNull();
  });

  it("NO BACKFILL: the guarded state_before UPDATE itself refuses a terminal row — persistProcessingStateBefore reports NOT_ELIGIBLE against real Postgres", async () => {
    const fixture = await createSyntheticCapturedFixture("evi-not-eligible");
    const { error: succeedError } = await client
      .from("event_processing_attempts")
      .update({ status: "SUCCEEDED", finished_at: new Date().toISOString() })
      .eq("id", fixture.originalProcessingAttemptId);
    expect(succeedError).toBeNull();

    const snapshot = await captureMerchantStateSnapshotForProcessingAttempt(
      fixture.originalProcessingAttemptId,
    );
    const result = await persistProcessingStateBefore(
      fixture.originalProcessingAttemptId,
      snapshot,
    );
    expect(result).toEqual({ outcome: "NOT_ELIGIBLE", snapshot: null });

    const row = await readAttemptEvidence(fixture.originalProcessingAttemptId);
    expect(row.state_before).toBeNull();
  });

  it("re-processing an already-SUCCEEDED attempt does not rewrite its historical snapshots", async () => {
    const fixture = await createSyntheticCapturedFixture("evi-reprocess");
    await processMerchantWebhookEvent(fixture.originalProcessingAttemptId);
    const firstEvidence = await readAttemptEvidence(
      fixture.originalProcessingAttemptId,
    );

    // A second processor call on the same attempt: whatever the frozen
    // processing gate decides, the snapshots must not change.
    try {
      await processMerchantWebhookEvent(fixture.originalProcessingAttemptId);
    } catch {
      // A PROCESSING_ATTEMPT_NOT_READY rejection is an acceptable frozen
      // outcome here — this test is about snapshot immutability, not about
      // the gate's decision.
    }

    const secondEvidence = await readAttemptEvidence(
      fixture.originalProcessingAttemptId,
    );
    expect(secondEvidence.state_before).toEqual(firstEvidence.state_before);
    expect(secondEvidence.state_after).toEqual(firstEvidence.state_after);
  });
});

afterAll(async () => {
  // Exact-ID-scoped cleanup only — never a broad delete. Child-before-parent
  // order, mirroring 053's fully-corrected FK graph:
  //   fulfilments -> event_processing_attempts -> chaos_runs ->
  //   webhook_events -> payments -> payment_attempts -> orders
  const cleanupErrors: string[] = [];

  async function deleteChunked(
    table:
      | "event_processing_attempts"
      | "chaos_runs"
      | "webhook_events"
      | "payments"
      | "payment_attempts"
      | "orders",
    ids: string[],
  ): Promise<void> {
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      if (chunk.length === 0) continue;
      const { error } = await client.from(table).delete().in("id", chunk);
      if (error) {
        cleanupErrors.push(
          `delete ${table} (${chunk.length} id(s)) failed: [${error.code}] ${error.message}`,
        );
      }
    }
  }

  const deletedFulfilmentIds: string[] = [];
  for (const orderId of outstandingFulfilmentOrderIds) {
    const { data, error } = await client
      .from("fulfilments")
      .delete()
      .eq("order_id", orderId)
      .select("id");
    if (error) {
      cleanupErrors.push(
        `delete fulfilments for order ${orderId} failed: [${error.code}] ${error.message}`,
      );
    }
    for (const row of data ?? []) deletedFulfilmentIds.push(row.id);
  }

  await deleteChunked("event_processing_attempts", outstandingAttemptIds);
  await deleteChunked("chaos_runs", outstandingChaosRunIds);
  await deleteChunked("webhook_events", outstandingWebhookEventIds);
  await deleteChunked("payments", outstandingPaymentIds);
  await deleteChunked("payment_attempts", outstandingPaymentAttemptIds);
  await deleteChunked("orders", outstandingOrderIds);

  expect(cleanupErrors).toEqual([]);

  async function assertNoRowsRemain(
    table:
      | "event_processing_attempts"
      | "chaos_runs"
      | "webhook_events"
      | "payments"
      | "payment_attempts"
      | "orders"
      | "fulfilments",
    ids: string[],
  ): Promise<void> {
    const { count } = await client
      .from(table)
      .select("id", { count: "exact", head: true })
      .in("id", ids.length ? ids : [randomUUID()]);
    expect(count).toBe(0);
  }

  await assertNoRowsRemain("fulfilments", deletedFulfilmentIds);
  await assertNoRowsRemain("event_processing_attempts", outstandingAttemptIds);
  await assertNoRowsRemain("chaos_runs", outstandingChaosRunIds);
  await assertNoRowsRemain("webhook_events", outstandingWebhookEventIds);
  await assertNoRowsRemain("payments", outstandingPaymentIds);
  await assertNoRowsRemain("payment_attempts", outstandingPaymentAttemptIds);
  await assertNoRowsRemain("orders", outstandingOrderIds);

  // Independent proof that no PRE-EXISTING (Phase 3D manual-verification)
  // processing attempt's evidence was mutated or deleted by this file.
  const { data: survivors, error: survivorError } = await client
    .from("event_processing_attempts")
    .select("id, state_before, state_after");
  expect(survivorError).toBeNull();
  const survivorEvidence = new Map<string, string>();
  for (const row of survivors ?? []) {
    survivorEvidence.set(
      row.id,
      JSON.stringify({
        state_before: row.state_before ?? null,
        state_after: row.state_after ?? null,
      }),
    );
  }
  for (const [id, evidence] of preExistingAttemptEvidence) {
    expect(survivorEvidence.has(id)).toBe(true);
    expect(survivorEvidence.get(id)).toBe(evidence);
  }
}, 180_000);
