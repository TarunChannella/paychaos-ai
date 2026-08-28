import { createHash, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { extractProviderCreatedAt } from "@/lib/webhooks/redaction";
import { normalizeRazorpayEvent } from "@/lib/events/normalization";
import {
  insertReplayProcessingAttempt,
  resolveAuthoritativeC11ReplaySource,
} from "@/lib/chaos/replay-repository";
import { createPendingChaosRun } from "@/lib/chaos/run-repository";
import { processMerchantWebhookEvent } from "@/lib/events/processor";

import { taggedValue, trackAttempt, trackOrder } from "./helpers";
import fixture from "../../fixtures/razorpay/payment-failed-test-mode.fixture.json";

/**
 * Phase 3D-D — proves the NEW `resolveAuthoritativeC11ReplaySource` resolver
 * (lib/chaos/replay-repository.ts) and the C11-B `PAYCHAOS_REPLAY` mechanics
 * it feeds against the REAL Supabase project, using the same captured C11
 * `payment.failed` business/error semantics
 * (tests/fixtures/razorpay/payment-failed-test-mode.fixture.json — same
 * file `057-chaos-c11-payment-failed-fixture.integration.test.ts` reads,
 * used here only as a source of authentic amount/currency/error-field
 * VALUES, never as runtime TEST_FIXTURE evidence).
 *
 * ============================================================================
 * PROVENANCE DISCIPLINE — identical to 053/057, read those files' own module
 * doc comments first if unfamiliar. Three distinct layers, never conflated:
 * ============================================================================
 *
 *   1. `event_processing_attempts.source_kind = PAYCHAOS_REPLAY` — THIS
 *      TEST'S OWN EXECUTION provenance for the replay attempt it creates.
 *   2. `normalized_event.sourceKind = REAL_RAZORPAY_WEBHOOK` — describes the
 *      provenance of the underlying captured evidence (the frozen,
 *      unmodified `normalizeRazorpayEvent` unconditionally stamps this
 *      literal; not a claim this test execution is genuine).
 *   3. `webhook_events.source_kind = REAL_RAZORPAY_WEBHOOK` on the row this
 *      file inserts — a SYNTHETIC CANONICAL COMPATIBILITY ROW, required
 *      only because the schema accepts no other literal for that column.
 *      NOT genuine provider evidence. Deleted unconditionally in `afterAll`.
 *
 * The ORIGINAL `event_processing_attempts` row this file creates (before any
 * replay) is `source_kind = REAL_RAZORPAY_WEBHOOK` — this is ALSO a
 * synthetic mechanics row, run through the real, unmodified
 * `processMerchantWebhookEvent` purely to reach genuine SUCCEEDED/
 * PROCESSED state (the exact precondition `resolveAuthoritativeC11ReplaySource`
 * requires), never to claim it was a real provider delivery.
 *
 * This file's `chaos_runs` row is ALWAYS `data_classification =
 * SYNTHETIC_DEMO` — never `RECORDED_TEST_EVIDENCE`. This file imports
 * NOTHING from `lib/chaos/c11-execution-service.ts` and calls NEITHER
 * `executeC11RealWebhookReplay` NOR `executeC01Replay` NOR
 * `runChaosPrecheck` NOR (the entry-point) `createChaosRun` from
 * `lib/chaos/run-service.ts` — `createPendingChaosRun` is the same
 * repository-level helper 053/057 already use for their own mechanics runs.
 * `tests/unit/supabase/058-chaos-c11-real-webhook-replay-provenance-guard.test.ts`
 * statically enforces all of the above.
 *
 * The genuine positive claim — that a REAL Razorpay Test Mode
 * `payment.failed` event was received, verified, and safely processed — is
 * separately proven by the real, untouched canonical row this fixture was
 * captured from (`webhook_events.id = e0df759e-bbde-45c3-aa80-a5a2d6b61be9`).
 * This file never mutates that row; the final read-only describe block below
 * optionally rechecks it and never fails this suite merely because it is
 * absent from a future Supabase project.
 *
 * The claim "the C11-B production service
 * (`executeC11RealWebhookReplay`/the `POST /api/chaos/runs/{runId}/execute-c11-b`
 * route) successfully replayed the AUTHENTIC captured evidence at
 * webhook_event_id e0df759e-bbde-45c3-aa80-a5a2d6b61be9" is NOT proven by
 * this file and remains a Phase 3D-D MANUAL VERIFICATION gate, to be
 * performed later by the architect against that exact real event — never
 * automated here.
 */

const client = getSupabaseServerClient();

const outstandingWebhookEventIds: string[] = [];
const outstandingAttemptIds: string[] = [];
const outstandingChaosRunIds: string[] = [];
const outstandingPaymentIds: string[] = [];
const outstandingPaymentAttemptIds: string[] = [];
const outstandingOrderIds: string[] = [];

function fakeSha256Hex(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

describe("Phase 3D-D — resolveAuthoritativeC11ReplaySource + PAYCHAOS_REPLAY mechanics (real Supabase, SYNTHETIC_DEMO chaos_run — NOT a genuine provider delivery claim)", () => {
  it("resolves the ONE authoritative SUCCEEDED REAL_RAZORPAY_WEBHOOK source, and the replay derived from it converges to identical failed/non-PAID/zero-fulfilment state, with the normalized_event copied verbatim", async () => {
    const amountSubunits = fixture.payload.payment.amount;
    const currency = fixture.payload.payment.currency;
    const razorpayOrderId = taggedValue("c11-replay-order");
    const razorpayPaymentId = taggedValue("c11-replay-payment");
    const razorpayEventId = taggedValue("c11-replay-event");

    // ------------------------------------------------------------------
    // Isolated synthetic merchant baseline.
    // ------------------------------------------------------------------
    const { data: order, error: orderError } = await client
      .from("orders")
      .insert({
        amount_subunits: amountSubunits,
        currency,
        payment_status: "UNPAID",
        business_status: "OPEN",
      })
      .select()
      .single();
    expect(orderError).toBeNull();
    const orderId = order!.id;
    trackOrder(orderId);
    outstandingOrderIds.push(orderId);

    const { data: attempt, error: attemptError } = await client
      .from("payment_attempts")
      .insert({
        order_id: orderId,
        attempt_no: 1,
        amount_subunits: amountSubunits,
        currency,
        razorpay_receipt: taggedValue("c11-replay-receipt"),
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
        currency,
      })
      .select()
      .single();
    expect(paymentError).toBeNull();
    const paymentId = payment!.id;
    outstandingPaymentIds.push(paymentId);

    // ------------------------------------------------------------------
    // SYNTHETIC CANONICAL COMPATIBILITY webhook_events row (provenance
    // layer 3). `processing_status` starts at its schema default
    // (`RECEIVED`) — it only reaches `PROCESSED` below via the real RPC,
    // exactly the precondition the resolver requires, never hand-set here.
    // ------------------------------------------------------------------
    const safeEvidence = {
      ...fixture.payload,
      payment: {
        ...fixture.payload.payment,
        id: razorpayPaymentId,
        order_id: razorpayOrderId,
      },
    };

    const { data: webhookEvent, error: webhookError } = await client
      .from("webhook_events")
      .insert({
        razorpay_event_id: razorpayEventId,
        event_type: "payment.failed",
        signature_verified: true,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        payment_attempt_id: paymentAttemptId,
        payment_id: paymentId,
        amount_subunits: amountSubunits,
        currency,
        razorpay_payment_status: "failed",
        raw_body_sha256: fakeSha256Hex(`c11-replay-${randomUUID()}`),
        raw_payload_redacted: safeEvidence,
      })
      .select()
      .single();
    expect(webhookError).toBeNull();
    const webhookEventId = webhookEvent!.id;
    outstandingWebhookEventIds.push(webhookEventId);

    // ------------------------------------------------------------------
    // Real, unmodified normalizer — deterministic normalization of the
    // fixture-derived semantics.
    // ------------------------------------------------------------------
    const providerCreatedAt = extractProviderCreatedAt(fixture.payload);
    const normalizationResult = normalizeRazorpayEvent({
      razorpayEventId,
      eventType: "payment.failed",
      providerCreatedAt,
      safeEvidence,
    });
    expect(normalizationResult.outcome).toBe("normalized");
    if (normalizationResult.outcome !== "normalized") {
      throw new Error("expected normalized");
    }

    // ------------------------------------------------------------------
    // ORIGINAL REAL_RAZORPAY_WEBHOOK attempt, run through the real,
    // unmodified processMerchantWebhookEvent to reach genuine SUCCEEDED
    // status AND drive webhook_events.processing_status to PROCESSED (the
    // RPC's own unconditional side effect — see module doc comment).
    // ------------------------------------------------------------------
    const { data: originalAttempt, error: originalAttemptError } = await client
      .from("event_processing_attempts")
      .insert({
        webhook_event_id: webhookEventId,
        payment_attempt_id: paymentAttemptId,
        payment_id: paymentId,
        source_kind: "REAL_RAZORPAY_WEBHOOK",
        is_duplicate_delivery: false,
        status: "PENDING",
        normalized_event: normalizationResult.event as unknown as Record<
          string,
          unknown
        >,
      })
      .select()
      .single();
    expect(originalAttemptError).toBeNull();
    const originalAttemptId = originalAttempt!.id;
    outstandingAttemptIds.push(originalAttemptId);

    const originalResult = await processMerchantWebhookEvent(originalAttemptId);
    expect(originalResult.outcome).toBe("processed");
    expect(originalResult.fulfilmentId).toBeNull();

    const { data: webhookAfterOriginal } = await client
      .from("webhook_events")
      .select("processing_status")
      .eq("id", webhookEventId)
      .single();
    expect(webhookAfterOriginal?.processing_status).toBe("PROCESSED");

    // ------------------------------------------------------------------
    // Mechanics-only SYNTHETIC_DEMO chaos_run — repository-level
    // createPendingChaosRun (never runChaosPrecheck/createChaosRun),
    // exactly mirroring 053/057's established pattern. scenario_id=C11,
    // fault_type=null (C11 has no fault primitive).
    // ------------------------------------------------------------------
    const chaosRun = await createPendingChaosRun({
      scenarioId: "C11",
      faultType: null,
      dataClassification: "SYNTHETIC_DEMO",
      orderId,
      paymentAttemptId,
      paymentId,
      sourceWebhookEventId: webhookEventId,
    });
    const chaosRunId = chaosRun.id;
    outstandingChaosRunIds.push(chaosRunId);
    expect(chaosRun.data_classification).toBe("SYNTHETIC_DEMO");

    // ------------------------------------------------------------------
    // THE NEW RESOLVER, against real Postgres. Must find exactly the
    // ORIGINAL attempt above, and must return the normalized_event
    // VERBATIM (byte-identical), never recomputed.
    // ------------------------------------------------------------------
    const resolved = await resolveAuthoritativeC11ReplaySource({
      sourceWebhookEventId: webhookEventId,
      paymentAttemptId,
      paymentId,
    });
    expect(resolved).not.toBeNull();
    expect(resolved?.processingAttemptId).toBe(originalAttemptId);
    expect(resolved?.webhookEventId).toBe(webhookEventId);
    expect(resolved?.paymentAttemptId).toBe(paymentAttemptId);
    expect(resolved?.paymentId).toBe(paymentId);
    expect(resolved?.normalizedEvent).toEqual(normalizationResult.event);

    // ------------------------------------------------------------------
    // EXACTLY ONE PAYCHAOS_REPLAY attempt, built from the RESOLVED source
    // (never re-derived from the fixture/normalizer directly) — this is
    // the exact mechanics `executeC11RealWebhookReplay` itself performs,
    // proven here at the repository/processor level only.
    // ------------------------------------------------------------------
    const replayAttempt = await insertReplayProcessingAttempt({
      chaosRunId,
      webhookEventId: resolved!.webhookEventId,
      paymentAttemptId: resolved!.paymentAttemptId,
      paymentId: resolved!.paymentId,
      normalizedEvent: resolved!.normalizedEvent,
    });
    outstandingAttemptIds.push(replayAttempt.id);

    const replayResult = await processMerchantWebhookEvent(replayAttempt.id);
    expect(["processed", "already_processed"]).toContain(replayResult.outcome);
    expect(replayResult.fulfilmentId).toBeNull();

    // ------------------------------------------------------------------
    // Provenance assertions.
    // ------------------------------------------------------------------
    const { data: persistedReplay } = await client
      .from("event_processing_attempts")
      .select(
        "source_kind, chaos_run_id, is_duplicate_delivery, status, normalized_event",
      )
      .eq("id", replayAttempt.id)
      .single();
    expect(persistedReplay?.source_kind).toBe("PAYCHAOS_REPLAY");
    expect(persistedReplay?.chaos_run_id).toBe(chaosRunId);
    expect(persistedReplay?.is_duplicate_delivery).toBe(false);
    expect(persistedReplay?.status).toBe("SUCCEEDED");
    expect(persistedReplay?.normalized_event).toEqual(
      normalizationResult.event,
    );

    const { data: allAttemptsForRun } = await client
      .from("event_processing_attempts")
      .select("id")
      .eq("chaos_run_id", chaosRunId);
    expect(allAttemptsForRun).toHaveLength(1);

    const { data: originalAfterReplay } = await client
      .from("event_processing_attempts")
      .select("source_kind, chaos_run_id, status")
      .eq("id", originalAttemptId)
      .single();
    expect(originalAfterReplay?.source_kind).toBe("REAL_RAZORPAY_WEBHOOK");
    expect(originalAfterReplay?.chaos_run_id).toBeNull();
    expect(originalAfterReplay?.status).toBe("SUCCEEDED");

    // ------------------------------------------------------------------
    // Required business post-conditions — unchanged by the replay
    // (idempotent), matching C11's safety guarantee.
    // ------------------------------------------------------------------
    const { data: persistedPayment } = await client
      .from("payments")
      .select("razorpay_payment_status, failed_at, captured_at")
      .eq("id", paymentId)
      .single();
    expect(persistedPayment?.razorpay_payment_status).toBe("failed");
    expect(persistedPayment?.failed_at).not.toBeNull();
    expect(persistedPayment?.captured_at).toBeNull();

    const { data: persistedPaymentAttempt } = await client
      .from("payment_attempts")
      .select("status")
      .eq("id", paymentAttemptId)
      .single();
    expect(persistedPaymentAttempt?.status).toBe("FAILED_OBSERVED");

    const { data: persistedOrder } = await client
      .from("orders")
      .select("payment_status, business_status")
      .eq("id", orderId)
      .single();
    expect(persistedOrder?.payment_status).toBe("FAILED_OBSERVED");
    expect(persistedOrder?.business_status).toBe("OPEN");

    const { data: fulfilments } = await client
      .from("fulfilments")
      .select("id")
      .eq("order_id", orderId);
    expect(fulfilments).toHaveLength(0);

    const { data: webhookRows } = await client
      .from("webhook_events")
      .select("id, duplicate_delivery_count")
      .eq("razorpay_event_id", razorpayEventId);
    expect(webhookRows).toHaveLength(1);
    expect(webhookRows?.[0]?.duplicate_delivery_count).toBe(0);
  });

  it("returns null (fail-closed) when the correlated webhook_events row has not yet reached processing_status=PROCESSED — a real-DB proof the unit-mock precondition matches actual schema behavior", async () => {
    const amountSubunits = fixture.payload.payment.amount;
    const currency = fixture.payload.payment.currency;
    const razorpayOrderId = taggedValue("c11-replay-unprocessed-order");
    const razorpayPaymentId = taggedValue("c11-replay-unprocessed-payment");
    const razorpayEventId = taggedValue("c11-replay-unprocessed-event");

    const { data: order, error: orderError } = await client
      .from("orders")
      .insert({
        amount_subunits: amountSubunits,
        currency,
        payment_status: "UNPAID",
        business_status: "OPEN",
      })
      .select()
      .single();
    expect(orderError).toBeNull();
    const orderId = order!.id;
    trackOrder(orderId);
    outstandingOrderIds.push(orderId);

    const { data: attempt, error: attemptError } = await client
      .from("payment_attempts")
      .insert({
        order_id: orderId,
        attempt_no: 1,
        amount_subunits: amountSubunits,
        currency,
        razorpay_receipt: taggedValue("c11-replay-unprocessed-receipt"),
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
        currency,
      })
      .select()
      .single();
    expect(paymentError).toBeNull();
    const paymentId = payment!.id;
    outstandingPaymentIds.push(paymentId);

    // Left at its schema default processing_status=RECEIVED — deliberately
    // never processed, so the resolver's PROCESSED precondition genuinely
    // fails against real Postgres.
    const { data: webhookEvent, error: webhookError } = await client
      .from("webhook_events")
      .insert({
        razorpay_event_id: razorpayEventId,
        event_type: "payment.failed",
        signature_verified: true,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        payment_attempt_id: paymentAttemptId,
        payment_id: paymentId,
        amount_subunits: amountSubunits,
        currency,
        razorpay_payment_status: "failed",
        raw_body_sha256: fakeSha256Hex(
          `c11-replay-unprocessed-${randomUUID()}`,
        ),
        raw_payload_redacted: { event: "payment.failed", synthetic: true },
      })
      .select()
      .single();
    expect(webhookError).toBeNull();
    const webhookEventId = webhookEvent!.id;
    outstandingWebhookEventIds.push(webhookEventId);
    expect(webhookEvent!.processing_status).toBe("RECEIVED");

    const resolved = await resolveAuthoritativeC11ReplaySource({
      sourceWebhookEventId: webhookEventId,
      paymentAttemptId,
      paymentId,
    });
    expect(resolved).toBeNull();
  });
});

describe("Phase 3D-D — genuine captured source event (optional, read-only recheck only — never a hard dependency)", () => {
  it("if present, the genuine source webhook_events row this fixture was derived from is unchanged — this test never mutates it and never fails merely because it is absent from this Supabase project", async () => {
    const { data: sourceEvent, error } = await client
      .from("webhook_events")
      .select(
        "id, event_type, source_kind, signature_verified, processing_status",
      )
      .eq("id", "e0df759e-bbde-45c3-aa80-a5a2d6b61be9")
      .maybeSingle();
    expect(error).toBeNull();
    if (sourceEvent) {
      expect(sourceEvent.event_type).toBe("payment.failed");
      expect(sourceEvent.source_kind).toBe("REAL_RAZORPAY_WEBHOOK");
      expect(sourceEvent.signature_verified).toBe(true);
      expect(sourceEvent.processing_status).toBe("PROCESSED");
    }
  });
});

afterAll(async () => {
  // Exact-ID-scoped cleanup only — never a broad delete. Child-before-parent
  // order, mirroring 053/057's fully-corrected FK graph:
  //   event_processing_attempts -> chaos_runs -> webhook_events -> payments
  //   -> payment_attempts -> orders
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

  await deleteChunked("event_processing_attempts", outstandingAttemptIds);
  await deleteChunked("chaos_runs", outstandingChaosRunIds);
  await deleteChunked("webhook_events", outstandingWebhookEventIds);
  await deleteChunked("payments", outstandingPaymentIds);
  await deleteChunked("payment_attempts", outstandingPaymentAttemptIds);
  await deleteChunked("orders", outstandingOrderIds);

  expect(cleanupErrors).toEqual([]);

  // Independent post-cleanup zero-row proof for ALL SIX owned resource
  // sets. Exact tracked IDs only; a randomUUID() fallback when a set is
  // empty guarantees the `.in(...)` filter can never accidentally match a
  // real, unrelated row (including the genuine source event
  // e0df759e-bbde-45c3-aa80-a5a2d6b61be9, which this file never deletes
  // and is never among these tracked ID arrays).
  async function assertNoRowsRemain(
    table:
      | "event_processing_attempts"
      | "chaos_runs"
      | "webhook_events"
      | "payments"
      | "payment_attempts"
      | "orders",
    ids: string[],
  ): Promise<void> {
    const { count } = await client
      .from(table)
      .select("id", { count: "exact", head: true })
      .in("id", ids.length ? ids : [randomUUID()]);
    expect(count).toBe(0);
  }

  await assertNoRowsRemain("event_processing_attempts", outstandingAttemptIds);
  await assertNoRowsRemain("chaos_runs", outstandingChaosRunIds);
  await assertNoRowsRemain("webhook_events", outstandingWebhookEventIds);
  await assertNoRowsRemain("payments", outstandingPaymentIds);
  await assertNoRowsRemain("payment_attempts", outstandingPaymentAttemptIds);
  await assertNoRowsRemain("orders", outstandingOrderIds);
}, 120_000);
