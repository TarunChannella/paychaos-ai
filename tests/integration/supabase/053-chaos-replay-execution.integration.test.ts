import { createHash, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import {
  completeRunningC01RunUnknown,
  createPendingChaosRun,
  startPendingC01RunAtomically,
} from "@/lib/chaos/run-repository";
import { insertReplayProcessingAttempt } from "@/lib/chaos/replay-repository";
import {
  MerchantProcessingError,
  processMerchantWebhookEvent,
} from "@/lib/events/processor";
import { markEventProcessingAttemptFailedIfNotFinal } from "@/lib/webhooks/event-processing-repository";

import { taggedValue, trackAttempt, trackOrder } from "./helpers";

/**
 * Phase 3C — proves the controlled C01 replay engine's SCHEMA/CONSTRAINT/
 * PROCESSOR MECHANICS (migration `20260830000000_phase3c_controlled_replay.sql`)
 * against the REAL Supabase project.
 *
 * *** NOT RUNNABLE YET ***. This migration has not been manually applied to
 * the remote project — every test in this file will fail with a
 * PostgREST "column ... does not exist" / "function ... does not exist"
 * style error (the widened `source_kind` CHECK, `chaos_run_id` column, and
 * the revised `process_webhook_payment_event` admission gate all require
 * it) until that manual application happens. That failure is expected and
 * must be reported honestly, not hidden or worked around — Claude does not
 * apply this migration.
 *
 * ============================================================================
 * CRITICAL PROVENANCE RULE (architect correction — this file previously
 * violated it and was rewritten; read this before adding any test here)
 * ============================================================================
 *
 * `webhook_events` is the canonical PROVIDER-EVIDENCE table. Every
 * `webhook_events`/`event_processing_attempts` row THIS FILE creates is a
 * SYNTHETIC, test-owned fixture — never a genuine Razorpay Test Mode
 * delivery. Setting `source_kind = REAL_RAZORPAY_WEBHOOK` /
 * `signature_verified = true` on such a synthetic row is fine for proving
 * schema/constraint/processor MECHANICS (the same established pattern
 * `049-event-processing-attempts.integration.test.ts` already uses
 * throughout).
 *
 * What is NOT fine, and what this file must never do again: use one of
 * these synthetic canonical rows to satisfy the PRODUCTION application's
 * authentic-evidence requirement by creating a `chaos_runs` row classified
 * `data_classification = RECORDED_TEST_EVIDENCE` and then invoking the
 * production positive-path service, `lib/chaos/replay-service.ts`'s
 * `executeC01Replay(...)`, against it. A test comment saying "synthetic"
 * does not make the persisted canonical row semantically synthetic —
 * `RECORDED_TEST_EVIDENCE` is a truth claim the database and every reader
 * of it (diagnosis, reliability score, demo) trusts literally.
 *
 * Therefore:
 *   - EVERY `chaos_runs` row this file creates uses
 *     `data_classification: "SYNTHETIC_DEMO"` — see
 *     `createSyntheticMechanicsChaosRun` below, which hardcodes this and
 *     accepts no override.
 *   - This file does NOT import or call `executeC01Replay` anywhere (a
 *     static guard in `tests/unit/supabase/053-chaos-replay-provenance-guard.test.ts`
 *     enforces this so the mistake cannot silently return).
 *   - Every test below that needs a `PAYCHAOS_REPLAY` processing attempt
 *     creates and processes it DIRECTLY — `insertReplayProcessingAttempt`
 *     (the same repository function `executeC01Replay` itself calls) then
 *     `processMerchantWebhookEvent` (the same processor function) — proving
 *     the exact same SQL/processor mechanics `executeC01Replay` relies on,
 *     without ever claiming the source evidence was genuine.
 *
 * ============================================================================
 * DEFERRED TO MANUAL VERIFICATION — do not automate this here
 * ============================================================================
 *
 * The claim "the C01 production service (`executeC01Replay`/the
 * `POST /api/chaos/runs/{runId}/replay` route) successfully replayed
 * AUTHENTIC Razorpay Test Mode evidence" is NOT proven by this file and must
 * never be automated by fabricating a `RECORDED_TEST_EVIDENCE` chaos_run
 * from a synthetic fixture. It remains a Phase 3C MANUAL VERIFICATION gate,
 * to be performed later using a dedicated, freshly created genuine Razorpay
 * Test Mode payment/webhook (never reusing a synthetic canonical row, and
 * never reusing/mutating the historical Phase 2G evidence read only by the
 * describe block below). That manual gate must prove, in order:
 *   1. a real canonical webhook_events row exists (genuine Test Mode
 *      delivery, source_kind=REAL_RAZORPAY_WEBHOOK, signature_verified=true);
 *   2. C01's Phase 3A precheck returns PRECHECK_PASSED for it;
 *   3. Phase 3B's `createChaosRun` persists a PENDING chaos_runs row with
 *      data_classification=RECORDED_TEST_EVIDENCE;
 *   4. invoking the authenticated replay route/service against that run id
 *      creates exactly 2 PAYCHAOS_REPLAY event_processing_attempts rows;
 *   5. the canonical webhook_events row count for that event stays 1;
 *   6. duplicate_delivery_count remains unchanged;
 *   7. exactly one fulfilment exists for the order;
 *   8. the chaos_runs row reaches status=COMPLETED, outcome=UNKNOWN.
 * This must be recorded in the Phase 3C handoff once performed — it is not
 * performed as part of writing or reviewing this file.
 *
 * Every row this file itself creates is tracked and deleted in `afterAll`
 * by exact ID only — never a broad delete.
 */

const client = getSupabaseServerClient();

const outstandingChaosRunIds: string[] = [];
const outstandingAttemptIds: string[] = [];
const outstandingWebhookEventIds: string[] = [];
const outstandingPaymentIds: string[] = [];
const outstandingFulfilmentOrderIds: string[] = [];
// Architect correction — 053 previously assumed `orders`/`payment_attempts`
// were cleaned up by a "shared integration-suite final-state convention".
// That assumption was wrong: `05-final-state.integration.test.ts` only
// VERIFIES (via `allCreatedOrderIds`/`allCreatedAttemptIds`) that every
// tracked id is already gone — it never deletes anything itself
// (`tests/integration/supabase/helpers.ts`'s own doc comment: ids are
// tracked "even after that row is deleted BY THE FILE THAT CREATED IT").
// Every other file in this suite (02/03/04/046/047/049) deletes its own
// created `orders`/`payment_attempts` directly. 053 must do the same —
// these two LOCAL ledgers (distinct from the shared, never-cleared
// `trackOrder`/`trackAttempt` ledgers this file still also calls, purely
// for 05-final-state's independent double-check) are what 053's own
// `afterAll` cleanup below actually deletes by exact id.
const outstandingOrderIds: string[] = [];
const outstandingPaymentAttemptIds: string[] = [];

function fakeSha256Hex(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

/**
 * Builds one complete, self-consistent SYNTHETIC "healthy captured payment"
 * fixture: order -> payment_attempt -> payments -> webhook_events (P0
 * `payment.captured`, `REAL_RAZORPAY_WEBHOOK`, `signature_verified: true`)
 * -> the ORIGINAL `event_processing_attempts` row, then runs it through the
 * REAL, unmodified `processMerchantWebhookEvent` so the order/payment/
 * fulfilment reach genuine PAID/CAPTURED/FULFILLED state exactly the way a
 * real webhook delivery would.
 *
 * NEVER genuine Razorpay evidence (see module doc comment above) — this
 * fixture exists ONLY to give the PAYCHAOS_REPLAY mechanics tests below a
 * SUCCEEDED original attempt + a correlated order/payment/webhook to copy
 * from. It must never be passed to `executeC01Replay` (not imported by this
 * file at all) and its correlated `chaos_runs` row (see
 * `createSyntheticMechanicsChaosRun`) must never be classified
 * `RECORDED_TEST_EVIDENCE`.
 */
async function createSyntheticCapturedFixture(label: string): Promise<{
  orderId: string;
  paymentAttemptId: string;
  paymentId: string;
  webhookEventId: string;
  originalProcessingAttemptId: string;
  razorpayEventId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  amountSubunits: number;
}> {
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
  outstandingFulfilmentOrderIds.push(orderId);
  outstandingOrderIds.push(orderId);

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

  const normalizedEvent = {
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

  // Real, unmodified processor call — establishes genuine PAID/CAPTURED/
  // FULFILLED state, exactly as a real webhook delivery would.
  const result = await processMerchantWebhookEvent(originalProcessingAttemptId);
  expect(result.outcome).toBe("processed");
  expect(result.fulfilmentId).not.toBeNull();

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
  };
}

/**
 * Creates a `chaos_runs` row correlated to a synthetic fixture, ALWAYS
 * classified `SYNTHETIC_DEMO` — this is the architect-corrected replacement
 * for the previous helper, which incorrectly hardcoded
 * `RECORDED_TEST_EVIDENCE`. No caller may override this. A row created here
 * exists ONLY to satisfy `event_processing_attempts.chaos_run_id`'s NOT NULL
 * FK requirement for `PAYCHAOS_REPLAY` mechanics tests — it must never be
 * passed to `executeC01Replay` (not imported by this file), which this
 * codebase's own eligibility check would in any case immediately reject as
 * `RUN_NOT_ELIGIBLE` for any non-`RECORDED_TEST_EVIDENCE` C01 run.
 */
async function createSyntheticMechanicsChaosRun(
  fixture: Pick<
    Awaited<ReturnType<typeof createSyntheticCapturedFixture>>,
    "orderId" | "paymentAttemptId" | "paymentId" | "webhookEventId"
  >,
): Promise<string> {
  const run = await createPendingChaosRun({
    scenarioId: "C01",
    faultType: "REPLAY_EVENT",
    dataClassification: "SYNTHETIC_DEMO",
    orderId: fixture.orderId,
    paymentAttemptId: fixture.paymentAttemptId,
    paymentId: fixture.paymentId,
    sourceWebhookEventId: fixture.webhookEventId,
  });
  outstandingChaosRunIds.push(run.id);
  return run.id;
}

describe("Phase 3C — event_processing_attempts source_kind/provenance (real Supabase, SYNTHETIC_DEMO fixtures)", () => {
  it("accepts a PAYCHAOS_REPLAY row with required provenance (webhook_event_id + chaos_run_id, is_duplicate_delivery=false)", async () => {
    const fixture = await createSyntheticCapturedFixture("provenance-ok");
    const chaosRunId = await createSyntheticMechanicsChaosRun(fixture);

    const { data, error } = await client
      .from("event_processing_attempts")
      .insert({
        webhook_event_id: fixture.webhookEventId,
        payment_attempt_id: fixture.paymentAttemptId,
        payment_id: fixture.paymentId,
        chaos_run_id: chaosRunId,
        source_kind: "PAYCHAOS_REPLAY",
        is_duplicate_delivery: false,
        status: "PENDING",
        normalized_event: { eventType: "payment.captured" },
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    if (data) outstandingAttemptIds.push(data.id);
  });

  it("rejects PAYCHAOS_REPLAY without chaos_run_id (23514)", async () => {
    const fixture = await createSyntheticCapturedFixture("provenance-no-run");

    const { data, error } = await client
      .from("event_processing_attempts")
      .insert({
        webhook_event_id: fixture.webhookEventId,
        source_kind: "PAYCHAOS_REPLAY",
        is_duplicate_delivery: false,
        status: "PENDING",
        normalized_event: { eventType: "payment.captured" },
      } as unknown as Database["public"]["Tables"]["event_processing_attempts"]["Insert"])
      .select()
      .single();

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
    expect(data).toBeNull();
  });

  it("rejects PAYCHAOS_REPLAY without webhook_event_id (23514)", async () => {
    const fixture = await createSyntheticCapturedFixture(
      "provenance-no-webhook",
    );
    const chaosRunId = await createSyntheticMechanicsChaosRun(fixture);

    const { data, error } = await client
      .from("event_processing_attempts")
      .insert({
        chaos_run_id: chaosRunId,
        source_kind: "PAYCHAOS_REPLAY",
        is_duplicate_delivery: false,
        status: "PENDING",
        normalized_event: { eventType: "payment.captured" },
      } as unknown as Database["public"]["Tables"]["event_processing_attempts"]["Insert"])
      .select()
      .single();

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
    expect(data).toBeNull();
  });

  it("rejects PAYCHAOS_REPLAY with is_duplicate_delivery=true (23514) — a replay is never a genuine duplicate delivery", async () => {
    const fixture = await createSyntheticCapturedFixture("provenance-dup-flag");
    const chaosRunId = await createSyntheticMechanicsChaosRun(fixture);

    const { data, error } = await client
      .from("event_processing_attempts")
      .insert({
        webhook_event_id: fixture.webhookEventId,
        chaos_run_id: chaosRunId,
        source_kind: "PAYCHAOS_REPLAY",
        is_duplicate_delivery: true,
        status: "PENDING",
        normalized_event: { eventType: "payment.captured" },
      })
      .select()
      .single();

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
    expect(data).toBeNull();
  });

  it("rejects the still-unsupported PAYCHAOS_SIMULATION value (23514)", async () => {
    const fixture = await createSyntheticCapturedFixture("sim-rejected");
    const chaosRunId = await createSyntheticMechanicsChaosRun(fixture);

    const { data, error } = await client
      .from("event_processing_attempts")
      .insert({
        webhook_event_id: fixture.webhookEventId,
        chaos_run_id: chaosRunId,
        source_kind: "PAYCHAOS_SIMULATION" as "REAL_RAZORPAY_WEBHOOK",
        is_duplicate_delivery: false,
        status: "PENDING",
        normalized_event: { eventType: "payment.captured" },
      })
      .select()
      .single();

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
    expect(data).toBeNull();
  });

  it("rejects the still-unsupported TEST_FIXTURE value (23514)", async () => {
    const fixture = await createSyntheticCapturedFixture("fixture-rejected");

    const { data, error } = await client
      .from("event_processing_attempts")
      .insert({
        webhook_event_id: fixture.webhookEventId,
        source_kind: "TEST_FIXTURE" as "REAL_RAZORPAY_WEBHOOK",
        is_duplicate_delivery: false,
        status: "PENDING",
        normalized_event: { eventType: "payment.captured" },
      })
      .select()
      .single();

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
    expect(data).toBeNull();
  });
});

describe("Phase 3C — PAYCHAOS_REPLAY processor/RPC mechanics (real Supabase, SYNTHETIC_DEMO chaos_run — mechanics only, NOT an authentic C01 replay claim)", () => {
  it("a PAYCHAOS_REPLAY attempt processed through the existing, unmodified processMerchantWebhookEvent succeeds, preserves normalized_event.sourceKind=REAL_RAZORPAY_WEBHOOK, and never increases the canonical webhook_events row count or duplicate_delivery_count", async () => {
    const fixture = await createSyntheticCapturedFixture(
      "mechanics-single-replay",
    );
    const chaosRunId = await createSyntheticMechanicsChaosRun(fixture);

    const replayAttempt = await insertReplayProcessingAttempt({
      chaosRunId,
      webhookEventId: fixture.webhookEventId,
      paymentAttemptId: fixture.paymentAttemptId,
      paymentId: fixture.paymentId,
      normalizedEvent: {
        sourceKind: "REAL_RAZORPAY_WEBHOOK",
        eventType: "payment.captured",
        kind: "payment.captured",
        razorpayOrderId: fixture.razorpayOrderId,
        razorpayPaymentId: fixture.razorpayPaymentId,
        amountSubunits: fixture.amountSubunits,
        currency: "INR",
        razorpayPaymentStatus: "captured",
      },
    });
    outstandingAttemptIds.push(replayAttempt.id);

    const result = await processMerchantWebhookEvent(replayAttempt.id);
    expect(["processed", "already_processed"]).toContain(result.outcome);

    const { data: persisted } = await client
      .from("event_processing_attempts")
      .select("*")
      .eq("id", replayAttempt.id)
      .single();
    expect(persisted?.source_kind).toBe("PAYCHAOS_REPLAY");
    expect(persisted?.chaos_run_id).toBe(chaosRunId);
    expect(persisted?.is_duplicate_delivery).toBe(false);
    expect(persisted?.status).toBe("SUCCEEDED");
    expect(
      (persisted?.normalized_event as Record<string, unknown>).sourceKind,
    ).toBe("REAL_RAZORPAY_WEBHOOK");

    const { data: webhookRows } = await client
      .from("webhook_events")
      .select("id, duplicate_delivery_count")
      .eq("razorpay_event_id", fixture.razorpayEventId);
    expect(webhookRows).toHaveLength(1);
    expect(webhookRows?.[0]?.duplicate_delivery_count).toBe(0);
  });

  it("two independent PAYCHAOS_REPLAY attempts against the same original evidence converge to exactly one fulfilment, and the original REAL_RAZORPAY_WEBHOOK attempt remains unchanged", async () => {
    const fixture = await createSyntheticCapturedFixture(
      "mechanics-double-replay",
    );
    const chaosRunId = await createSyntheticMechanicsChaosRun(fixture);

    const normalizedEvent = {
      sourceKind: "REAL_RAZORPAY_WEBHOOK",
      eventType: "payment.captured",
      kind: "payment.captured",
      razorpayOrderId: fixture.razorpayOrderId,
      razorpayPaymentId: fixture.razorpayPaymentId,
      amountSubunits: fixture.amountSubunits,
      currency: "INR",
      razorpayPaymentStatus: "captured",
    };

    const replayA = await insertReplayProcessingAttempt({
      chaosRunId,
      webhookEventId: fixture.webhookEventId,
      paymentAttemptId: fixture.paymentAttemptId,
      paymentId: fixture.paymentId,
      normalizedEvent,
    });
    outstandingAttemptIds.push(replayA.id);
    const replayB = await insertReplayProcessingAttempt({
      chaosRunId,
      webhookEventId: fixture.webhookEventId,
      paymentAttemptId: fixture.paymentAttemptId,
      paymentId: fixture.paymentId,
      normalizedEvent,
    });
    outstandingAttemptIds.push(replayB.id);

    await processMerchantWebhookEvent(replayA.id);
    await processMerchantWebhookEvent(replayB.id);

    const { data: fulfilments } = await client
      .from("fulfilments")
      .select("id")
      .eq("order_id", fixture.orderId);
    expect(fulfilments).toHaveLength(1);

    const { data: order } = await client
      .from("orders")
      .select("payment_status, business_status")
      .eq("id", fixture.orderId)
      .single();
    expect(order?.payment_status).toBe("PAID");
    expect(order?.business_status).toBe("FULFILLED");

    const { data: originalAttempt } = await client
      .from("event_processing_attempts")
      .select("*")
      .eq("id", fixture.originalProcessingAttemptId)
      .single();
    expect(originalAttempt?.source_kind).toBe("REAL_RAZORPAY_WEBHOOK");
    expect(originalAttempt?.chaos_run_id).toBeNull();
    expect(originalAttempt?.status).toBe("SUCCEEDED");
  });
});

describe("Phase 3C — chaos_run atomic lifecycle (real Supabase, SYNTHETIC_DEMO — repository-level atomicity mechanics only)", () => {
  it("double-start race: two concurrent atomic-start calls on the SAME PENDING run — exactly one wins", async () => {
    const fixture = await createSyntheticCapturedFixture("race");
    const chaosRunId = await createSyntheticMechanicsChaosRun(fixture);

    const [first, second] = await Promise.all([
      startPendingC01RunAtomically(chaosRunId),
      startPendingC01RunAtomically(chaosRunId),
    ]);

    const winners = [first, second].filter((r) => r !== null);
    expect(winners).toHaveLength(1);

    // Clean up: bring the run to a terminal state so afterAll's delete is
    // not blocked by any future FK, and independently confirm exactly one
    // RUNNING transition landed.
    const completed = await completeRunningC01RunUnknown(chaosRunId);
    expect(completed).not.toBeNull();
  });
});

describe("Phase 3C — FAILED replay processing-attempt audit (real Supabase, SYNTHETIC_DEMO — mechanics only)", () => {
  it("a PAYCHAOS_REPLAY attempt that fails processor validation is durably marked FAILED with a safe deterministic code/message via the existing markEventProcessingAttemptFailedIfNotFinal — never a raw Postgres detail", async () => {
    const fixture = await createSyntheticCapturedFixture(
      "mechanics-failure-audit",
    );
    const chaosRunId = await createSyntheticMechanicsChaosRun(fixture);

    // Deliberately mismatched amount so process_webhook_payment_event
    // raises PROCESSING_AMOUNT_MISMATCH — the same safe failure family
    // lib/chaos/replay-service.ts's Finding 2 fix persists via this exact
    // existing helper.
    const replayAttempt = await insertReplayProcessingAttempt({
      chaosRunId,
      webhookEventId: fixture.webhookEventId,
      paymentAttemptId: fixture.paymentAttemptId,
      paymentId: fixture.paymentId,
      normalizedEvent: {
        sourceKind: "REAL_RAZORPAY_WEBHOOK",
        eventType: "payment.captured",
        kind: "payment.captured",
        razorpayOrderId: fixture.razorpayOrderId,
        razorpayPaymentId: fixture.razorpayPaymentId,
        amountSubunits: fixture.amountSubunits + 1,
        currency: "INR",
        razorpayPaymentStatus: "captured",
      },
    });
    outstandingAttemptIds.push(replayAttempt.id);

    let caught: unknown = null;
    try {
      await processMerchantWebhookEvent(replayAttempt.id);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MerchantProcessingError);
    const safeCode = (caught as MerchantProcessingError).code;
    const safeMessage = (caught as MerchantProcessingError).message;
    expect(safeCode).toBe("PROCESSING_AMOUNT_MISMATCH");

    await markEventProcessingAttemptFailedIfNotFinal(
      replayAttempt.id,
      safeCode,
      safeMessage,
    );

    const { data: persisted } = await client
      .from("event_processing_attempts")
      .select("status, error_code, error_message_redacted")
      .eq("id", replayAttempt.id)
      .single();
    expect(persisted?.status).toBe("FAILED");
    expect(persisted?.error_code).toBe("PROCESSING_AMOUNT_MISMATCH");
    expect(persisted?.error_message_redacted).toBe(safeMessage);
    expect(persisted?.error_message_redacted).not.toMatch(
      /postgres|pg_|relation|amount_subunits disagree/i,
    );
  });
});

describe("Phase 3C — historical real Phase 2 evidence remains unchanged (read-only confirmation only)", () => {
  it("the known real Phase 2G order/payment are untouched by this file's mechanics tests", async () => {
    const { data: order } = await client
      .from("orders")
      .select("*")
      .eq("id", "cdc8c3fc-d78c-4cd9-837d-c41f5cc04a72")
      .maybeSingle();
    if (order) {
      expect(["UNPAID", "PENDING", "FAILED_OBSERVED", "PAID"]).toContain(
        order.payment_status,
      );
    }

    const { data: payment } = await client
      .from("payments")
      .select("*")
      .eq("razorpay_payment_id", "pay_TU0xvTbsJiOqPI")
      .maybeSingle();
    expect(payment === null || typeof payment.id === "string").toBe(true);
  });
});

afterAll(async () => {
  // Exact-ID-scoped cleanup only — never a broad delete.
  //
  // Architect correction — cleanup ORDER bug (two rounds): the real FK
  // graph is
  //   fulfilments.order_id                        -> orders            (RESTRICT)
  //   fulfilments.payment_id                       -> payments          (RESTRICT)
  //   fulfilments.trigger_processing_attempt_id    -> event_processing_attempts (RESTRICT)
  //   event_processing_attempts.webhook_event_id   -> webhook_events    (RESTRICT)
  //   event_processing_attempts.payment_attempt_id -> payment_attempts  (RESTRICT)
  //   event_processing_attempts.payment_id         -> payments          (RESTRICT)
  //   event_processing_attempts.chaos_run_id       -> chaos_runs        (RESTRICT, Phase 3C)
  //   chaos_runs.order_id/payment_attempt_id/payment_id/source_webhook_event_id
  //                                                 -> orders/payment_attempts/payments/webhook_events (all RESTRICT)
  //   webhook_events.payment_attempt_id             -> payment_attempts  (RESTRICT)
  //   webhook_events.payment_id                     -> payments          (RESTRICT)   [Phase 2D — the edge missed in round 1]
  //   payments.payment_attempt_id                  -> payment_attempts  (RESTRICT)
  //
  // Round 1 fix: `createSyntheticCapturedFixture`'s call to the REAL
  // processor always creates a `fulfilments` row whose
  // `trigger_processing_attempt_id` is the ORIGINAL (REAL_RAZORPAY_WEBHOOK)
  // processing attempt's id, so `fulfilments` MUST be deleted before
  // `event_processing_attempts`, and `event_processing_attempts` (the
  // child of `chaos_runs` via `chaos_run_id`) MUST be deleted before
  // `chaos_runs`.
  //
  // Round 2 fix: `webhook_events.payment_id` ALSO references `payments`
  // (Phase 2D — every synthetic webhook fixture this file creates carries
  // its own correlated `payment_id`), which round 1 missed — it deleted
  // `payments` BEFORE `webhook_events`, so the second real run's `payments`
  // delete failed with `[23503] ... violates foreign key constraint
  // "webhook_events_payment_id_fkey"`, leaving `payments` (and everything
  // still referencing it) undeleted while `webhook_events` had ALREADY
  // been deleted successfully by the time that failure was recorded.
  // `webhook_events` is therefore a CHILD of `payments` here, not a
  // parent, and must be deleted before it.
  //
  // Round 3 fix (this correction): 053 also previously assumed
  // `orders`/`payment_attempts` were cleaned up by a "shared
  // integration-suite final-state convention". That convention does not
  // exist — `05-final-state.integration.test.ts` only VERIFIES (via the
  // `allCreatedOrderIds`/`allCreatedAttemptIds` ledgers) that every tracked
  // id is already gone; it never deletes anything (see
  // `tests/integration/supabase/helpers.ts`'s own doc comment: ids are
  // tracked "even after that row is deleted BY THE FILE THAT CREATED IT").
  // Every other file in this suite (02/03/04/046/047/049) deletes its own
  // created `orders`/`payment_attempts` directly. Leaving 053's own orders
  // behind was also directly responsible for
  // `045-demo-merchant-service.integration.test.ts` failing separately: a
  // leaked order that reached `business_status = FULFILLED` (via the real
  // processor) had its `fulfilments` row correctly deleted by step 1 above
  // but was never deleted itself, so `listDemoMerchantOrders` later
  // encountered a domain-invariant-violating "FULFILLED order with zero
  // fulfilments" row and correctly refused it. `payment_attempts` and
  // `orders` are additionally referenced by `payments`/`webhook_events`/
  // `event_processing_attempts`/`chaos_runs` (all cleared by steps 1-5) and
  // by each other (`payment_attempts.order_id -> orders`), so they must be
  // deleted LAST, in that order. Fully corrected child-before-parent order:
  //   fulfilments -> event_processing_attempts -> chaos_runs ->
  //   webhook_events -> payments -> payment_attempts -> orders
  //
  // Every delete's error is now collected immediately (never silently
  // ignored) and asserted at the end with full per-table context, so a
  // failure is diagnosable directly from the failure message instead of
  // only being inferred from a mismatched final count. Postgres/PostgREST
  // delete errors here are constraint/code diagnostics only (e.g. FK
  // violation codes) — never a secret, matching how `error?.code` is
  // already asserted directly elsewhere in this suite (e.g.
  // `049-event-processing-attempts.integration.test.ts`).
  const cleanupErrors: string[] = [];

  async function deleteChunked(
    table:
      | "event_processing_attempts"
      | "chaos_runs"
      | "fulfilments"
      | "payments"
      | "webhook_events"
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

  async function deleteFulfilmentsByOrderId(orderIds: string[]): Promise<void> {
    for (const orderId of orderIds) {
      const { error } = await client
        .from("fulfilments")
        .delete()
        .eq("order_id", orderId);
      if (error) {
        cleanupErrors.push(
          `delete fulfilments for order_id=${orderId} failed: [${error.code}] ${error.message}`,
        );
      }
    }
  }

  // 1. fulfilments — leaf table nothing else references; must go before
  // event_processing_attempts/payments/orders, which it references.
  await deleteFulfilmentsByOrderId(outstandingFulfilmentOrderIds);
  // 2. event_processing_attempts — child of chaos_runs (chaos_run_id); must
  // go before chaos_runs, and after fulfilments (which references it).
  await deleteChunked("event_processing_attempts", outstandingAttemptIds);
  // 3. chaos_runs — now unreferenced (step 2 removed the only referencing
  // rows this file created).
  await deleteChunked("chaos_runs", outstandingChaosRunIds);
  // 4. webhook_events — child of payments (webhook_events.payment_id
  // RESTRICT, Phase 2D — the edge round 1 missed) and of payment_attempts;
  // event_processing_attempts/chaos_runs (the only tables that could
  // reference IT) are both clear after steps 2-3, so it is safe to delete
  // now, and it MUST be deleted before payments below.
  await deleteChunked("webhook_events", outstandingWebhookEventIds);
  // 5. payments — now unreferenced (fulfilments/event_processing_attempts/
  // chaos_runs/webhook_events, every table that could reference it, are
  // all clear).
  await deleteChunked("payments", outstandingPaymentIds);
  // 6. payment_attempts — architect correction: 053 owns these rows (it
  // created them) and must delete them itself, exactly like every other
  // file in this suite (02/03/04/046/047/049) — there is no shared
  // "final-state cleans this up" convention; 05-final-state only verifies
  // via the ledger that this run's tracked ids are already gone. Now
  // unreferenced: payments/webhook_events/event_processing_attempts/
  // chaos_runs, every table that could reference it, are all clear.
  await deleteChunked("payment_attempts", outstandingPaymentAttemptIds);
  // 7. orders — now unreferenced: fulfilments/chaos_runs (cleared above)
  // and payment_attempts (cleared in step 6), every table that could
  // reference it, are all clear.
  await deleteChunked("orders", outstandingOrderIds);

  expect(cleanupErrors).toEqual([]);

  const { count: remainingAttempts } = await client
    .from("event_processing_attempts")
    .select("id", { count: "exact", head: true })
    .in(
      "id",
      outstandingAttemptIds.length ? outstandingAttemptIds : [randomUUID()],
    );
  expect(remainingAttempts).toBe(0);

  const { count: remainingRuns } = await client
    .from("chaos_runs")
    .select("id", { count: "exact", head: true })
    .in(
      "id",
      outstandingChaosRunIds.length ? outstandingChaosRunIds : [randomUUID()],
    );
  expect(remainingRuns).toBe(0);

  const { count: remainingPaymentAttempts } = await client
    .from("payment_attempts")
    .select("id", { count: "exact", head: true })
    .in(
      "id",
      outstandingPaymentAttemptIds.length
        ? outstandingPaymentAttemptIds
        : [randomUUID()],
    );
  expect(remainingPaymentAttempts).toBe(0);

  const { count: remainingOrders } = await client
    .from("orders")
    .select("id", { count: "exact", head: true })
    .in(
      "id",
      outstandingOrderIds.length ? outstandingOrderIds : [randomUUID()],
    );
  expect(remainingOrders).toBe(0);
}, 120_000);
