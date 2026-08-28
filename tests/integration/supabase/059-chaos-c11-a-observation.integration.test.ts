import { createHash, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { extractProviderCreatedAt } from "@/lib/webhooks/redaction";
import { normalizeRazorpayEvent } from "@/lib/events/normalization";
import {
  resolveC11AFailureObservationEvidence,
  readC11AObservedMerchantState,
} from "@/lib/chaos/c11-observation-repository";
import {
  createPendingChaosRun,
  startPendingC11ARunAtomically,
} from "@/lib/chaos/run-repository";

import { taggedValue, trackAttempt, trackOrder } from "./helpers";
import fixture from "../../fixtures/razorpay/payment-failed-test-mode.fixture.json";

/**
 * Phase 3D-E — proves `resolveC11AFailureObservationEvidence` /
 * `readC11AObservedMerchantState` (lib/chaos/c11-observation-repository.ts)
 * and the C11-A `startPendingC11ARunAtomically` lifecycle disambiguation
 * against the REAL Supabase project, using the same captured C11
 * `payment.failed` business/error semantics
 * (tests/fixtures/razorpay/payment-failed-test-mode.fixture.json — same
 * file `057`/`058` read, used here only as a source of authentic amount/
 * currency/error-field VALUES, never as runtime TEST_FIXTURE evidence).
 *
 * ============================================================================
 * PROVENANCE DISCIPLINE — identical to 053/057/058, read those files' own
 * module doc comments first if unfamiliar. Three distinct layers, never
 * conflated:
 * ============================================================================
 *
 *   1. This file's own `chaos_runs` rows are ALWAYS `data_classification =
 *      SYNTHETIC_DEMO` — never `RECORDED_TEST_EVIDENCE`. This file never
 *      calls `createChaosRun`/`runChaosPrecheck`/`startC11AFailureObservation`
 *      (the real production positive-path entry points) — only the
 *      repository-level `createPendingChaosRun` (053/057/058's own
 *      established pattern) and the lifecycle function under direct test,
 *      `startPendingC11ARunAtomically`.
 *   2. `normalized_event.sourceKind = REAL_RAZORPAY_WEBHOOK` — describes the
 *      provenance of the underlying captured evidence (the frozen,
 *      unmodified `normalizeRazorpayEvent` unconditionally stamps this
 *      literal; not a claim this test execution is genuine).
 *   3. `webhook_events.source_kind = REAL_RAZORPAY_WEBHOOK` on the row(s)
 *      this file inserts — a SYNTHETIC CANONICAL COMPATIBILITY ROW, required
 *      only because the schema accepts no other literal for that column.
 *      NOT genuine provider evidence. Deleted unconditionally in `afterAll`.
 *
 * This file NEVER claims a genuine positive C11-A production execution —
 * that is a later MANUAL VERIFICATION gate (this task's Section 27) using a
 * fresh Demo Merchant order and a real Razorpay Test Mode failure, never
 * automated here. `tests/unit/supabase/059-chaos-c11-a-observation-provenance-guard.test.ts`
 * statically enforces the rules above.
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

/** Builds one isolated synthetic order/payment_attempt/payment triple. */
async function createSyntheticBaseline(label: string) {
  const amountSubunits = fixture.payload.payment.amount;
  const currency = fixture.payload.payment.currency;
  const razorpayOrderId = taggedValue(`${label}-order`);
  const razorpayPaymentId = taggedValue(`${label}-payment`);

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
      currency,
      razorpay_payment_status: "failed",
      failed_at: new Date().toISOString(),
    })
    .select()
    .single();
  expect(paymentError).toBeNull();
  const paymentId = payment!.id;
  outstandingPaymentIds.push(paymentId);

  return { orderId, paymentAttemptId, paymentId, amountSubunits, currency };
}

/** Builds one synthetic canonical `payment.failed` webhook_events row, with configurable overrides for negative-path tests. */
async function createSyntheticWebhookEvent(
  label: string,
  paymentAttemptId: string,
  paymentId: string,
  amountSubunits: number,
  currency: string,
  overrides: Record<string, unknown> = {},
) {
  const razorpayEventId = taggedValue(`${label}-event`);
  const safeEvidence = {
    ...fixture.payload,
    payment: {
      ...fixture.payload.payment,
      id: taggedValue(`${label}-rzp-payment`),
    },
  };

  const { data: webhookEvent, error: webhookError } = await client
    .from("webhook_events")
    .insert({
      razorpay_event_id: razorpayEventId,
      event_type: "payment.failed",
      signature_verified: true,
      payment_attempt_id: paymentAttemptId,
      payment_id: paymentId,
      amount_subunits: amountSubunits,
      currency,
      razorpay_payment_status: "failed",
      raw_body_sha256: fakeSha256Hex(`${label}-${randomUUID()}`),
      raw_payload_redacted: safeEvidence,
      processing_status: "PROCESSED",
      received_at: new Date().toISOString(),
      ...overrides,
    })
    .select()
    .single();
  expect(webhookError).toBeNull();
  const webhookEventId = webhookEvent!.id;
  outstandingWebhookEventIds.push(webhookEventId);
  return { webhookEventId, safeEvidence, razorpayEventId };
}

/** Builds one synthetic original `event_processing_attempts` row, `status=SUCCEEDED`, using the real normalizer for an authentic shape. */
async function createSyntheticOriginalAttempt(
  webhookEventId: string,
  paymentAttemptId: string,
  paymentId: string,
  razorpayEventId: string,
  safeEvidence: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
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

  const { data: attempt, error: attemptError } = await client
    .from("event_processing_attempts")
    .insert({
      webhook_event_id: webhookEventId,
      payment_attempt_id: paymentAttemptId,
      payment_id: paymentId,
      source_kind: "REAL_RAZORPAY_WEBHOOK",
      is_duplicate_delivery: false,
      status: "SUCCEEDED",
      normalized_event: normalizationResult.event as unknown as Record<
        string,
        unknown
      >,
      ...overrides,
    })
    .select()
    .single();
  expect(attemptError).toBeNull();
  const attemptId = attempt!.id;
  outstandingAttemptIds.push(attemptId);
  return attemptId;
}

describe("Phase 3D-E — resolveC11AFailureObservationEvidence mechanics (real Supabase, SYNTHETIC_DEMO chaos_run — NOT a genuine provider delivery claim)", () => {
  it("resolves RESOLVED with the exact webhookEventId/paymentAttemptId/paymentId when every layer matches and received_at is at/after runStartedAt", async () => {
    const runStartedAt = new Date(Date.now() - 60_000).toISOString();
    const { orderId, paymentAttemptId, paymentId, amountSubunits, currency } =
      await createSyntheticBaseline("c11a-resolve");
    const { webhookEventId, safeEvidence, razorpayEventId } =
      await createSyntheticWebhookEvent(
        "c11a-resolve",
        paymentAttemptId,
        paymentId,
        amountSubunits,
        currency,
        { received_at: new Date().toISOString() },
      );
    await createSyntheticOriginalAttempt(
      webhookEventId,
      paymentAttemptId,
      paymentId,
      razorpayEventId,
      safeEvidence,
    );

    // Mechanics-only SYNTHETIC_DEMO chaos_run audit row — never the
    // production createChaosRun/runChaosPrecheck path.
    const chaosRun = await createPendingChaosRun({
      scenarioId: "C11",
      faultType: null,
      dataClassification: "SYNTHETIC_DEMO",
      orderId,
    });
    outstandingChaosRunIds.push(chaosRun.id);
    expect(chaosRun.data_classification).toBe("SYNTHETIC_DEMO");

    const result = await resolveC11AFailureObservationEvidence(
      orderId,
      runStartedAt,
    );
    expect(result).toEqual({
      kind: "RESOLVED",
      evidence: {
        webhookEventId,
        paymentAttemptId,
        paymentId,
      },
    });

    // readC11AObservedMerchantState must succeed (read-only, real schema).
    await expect(
      readC11AObservedMerchantState(orderId, paymentAttemptId, paymentId),
    ).resolves.toBeUndefined();
  });

  it("returns NOT_YET_CONVERGED (real-DB proof) when the correlated webhook_events row has not yet reached processing_status=PROCESSED", async () => {
    const runStartedAt = new Date(Date.now() - 60_000).toISOString();
    const { orderId, paymentAttemptId, paymentId, amountSubunits, currency } =
      await createSyntheticBaseline("c11a-unprocessed");
    // Left at RECEIVED (never overridden to PROCESSED).
    await createSyntheticWebhookEvent(
      "c11a-unprocessed",
      paymentAttemptId,
      paymentId,
      amountSubunits,
      currency,
      { processing_status: "RECEIVED" },
    );

    const result = await resolveC11AFailureObservationEvidence(
      orderId,
      runStartedAt,
    );
    expect(result).toEqual({ kind: "NOT_YET_CONVERGED" });
  });

  it("returns NOT_YET_CONVERGED (real-DB proof of the timestamp bound) when the webhook event's received_at is BEFORE the run's own started_at", async () => {
    const { orderId, paymentAttemptId, paymentId, amountSubunits, currency } =
      await createSyntheticBaseline("c11a-stale-received");
    const staleReceivedAt = new Date(Date.now() - 3_600_000).toISOString(); // 1h ago
    const runStartedAt = new Date().toISOString(); // now — after the stale event
    await createSyntheticWebhookEvent(
      "c11a-stale-received",
      paymentAttemptId,
      paymentId,
      amountSubunits,
      currency,
      { received_at: staleReceivedAt, processing_status: "PROCESSED" },
    );

    const result = await resolveC11AFailureObservationEvidence(
      orderId,
      runStartedAt,
    );
    expect(result).toEqual({ kind: "NOT_YET_CONVERGED" });
  });

  it("returns AMBIGUOUS (real-DB proof, fail closed) when more than one original processing attempt satisfies the exact correlation", async () => {
    const runStartedAt = new Date(Date.now() - 60_000).toISOString();
    const { orderId, paymentAttemptId, paymentId, amountSubunits, currency } =
      await createSyntheticBaseline("c11a-ambiguous");
    const { webhookEventId, safeEvidence, razorpayEventId } =
      await createSyntheticWebhookEvent(
        "c11a-ambiguous",
        paymentAttemptId,
        paymentId,
        amountSubunits,
        currency,
      );
    await createSyntheticOriginalAttempt(
      webhookEventId,
      paymentAttemptId,
      paymentId,
      razorpayEventId,
      safeEvidence,
    );
    // A second, equally-suitable original attempt for the SAME webhook
    // event — this must never happen from the real processor (which is
    // itself idempotent), but the resolver must fail closed regardless of
    // how such a row came to exist.
    await createSyntheticOriginalAttempt(
      webhookEventId,
      paymentAttemptId,
      paymentId,
      razorpayEventId,
      safeEvidence,
    );

    const result = await resolveC11AFailureObservationEvidence(
      orderId,
      runStartedAt,
    );
    expect(result).toEqual({ kind: "AMBIGUOUS" });
  });
});

describe("Phase 3D-E — startPendingC11ARunAtomically lifecycle/provenance disambiguation (real Supabase)", () => {
  it("a SYNTHETIC_DEMO C11 PENDING run cannot pass the production C11-A atomic start", async () => {
    const { orderId } = await createSyntheticBaseline("c11a-synthetic-start");
    const chaosRun = await createPendingChaosRun({
      scenarioId: "C11",
      faultType: null,
      dataClassification: "SYNTHETIC_DEMO",
      orderId,
    });
    outstandingChaosRunIds.push(chaosRun.id);

    const result = await startPendingC11ARunAtomically(chaosRun.id);
    expect(result).toBeNull();

    // Confirm it truly never transitioned.
    const { data: stillPending } = await client
      .from("chaos_runs")
      .select("status")
      .eq("id", chaosRun.id)
      .single();
    expect(stillPending?.status).toBe("PENDING");
  });

  it("a C11-B-shaped PENDING row (source_webhook_event_id set) cannot pass the C11-A atomic start", async () => {
    const { orderId, paymentAttemptId, paymentId, amountSubunits, currency } =
      await createSyntheticBaseline("c11a-c11b-shaped");
    const { webhookEventId } = await createSyntheticWebhookEvent(
      "c11a-c11b-shaped",
      paymentAttemptId,
      paymentId,
      amountSubunits,
      currency,
    );

    // A C11-B-shaped PENDING run: RECORDED_TEST_EVIDENCE with
    // source_webhook_event_id/paymentAttemptId/paymentId all resolved —
    // exactly the shape lib/chaos/run-service.ts's C11 Mechanism B path
    // produces.
    const chaosRun = await createPendingChaosRun({
      scenarioId: "C11",
      faultType: null,
      dataClassification: "RECORDED_TEST_EVIDENCE",
      orderId,
      paymentAttemptId,
      paymentId,
      sourceWebhookEventId: webhookEventId,
    });
    outstandingChaosRunIds.push(chaosRun.id);
    expect(chaosRun.source_webhook_event_id).toBe(webhookEventId);

    const result = await startPendingC11ARunAtomically(chaosRun.id);
    expect(result).toBeNull();

    const { data: stillPending } = await client
      .from("chaos_runs")
      .select("status, source_webhook_event_id")
      .eq("id", chaosRun.id)
      .single();
    expect(stillPending?.status).toBe("PENDING");
  });

  it("real-DB proof that data_classification is a genuine database-level guard, not merely a TypeScript-level assumption: a SYNTHETIC_DEMO row is rejected by the same atomic UPDATE ... WHERE data_classification = 'RECORDED_TEST_EVIDENCE' clause C11-A start relies on", async () => {
    // This file never fabricates a positive RECORDED_TEST_EVIDENCE claim
    // (this task's Section 26 "DO NOT create a synthetic positive
    // production C11-A RECORDED_TEST_EVIDENCE claim merely to exercise the
    // runtime service") — so every chaos_run this file creates stays
    // SYNTHETIC_DEMO, and every one of them is therefore expected to be
    // REJECTED by startPendingC11ARunAtomically. This is the deliberate,
    // documented reason this suite proves only the REJECTION path against
    // real Postgres, never the accepted PENDING->RUNNING transition itself
    // (that positive transition is fully proven at the mocked-Supabase
    // unit level — tests/unit/chaos/run-repository.test.ts).
    const { orderId } = await createSyntheticBaseline("c11a-shape-check");
    const chaosRun = await createPendingChaosRun({
      scenarioId: "C11",
      faultType: null,
      dataClassification: "SYNTHETIC_DEMO",
      orderId,
    });
    outstandingChaosRunIds.push(chaosRun.id);

    const result = await startPendingC11ARunAtomically(chaosRun.id);
    expect(result).toBeNull();
  });
});

afterAll(async () => {
  // Exact-ID-scoped cleanup only — never a broad delete. Child-before-parent
  // order, mirroring 053/057/058's fully-corrected FK graph:
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
