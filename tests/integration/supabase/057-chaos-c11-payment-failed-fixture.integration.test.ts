import { createHash, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { extractProviderCreatedAt } from "@/lib/webhooks/redaction";
import { normalizeRazorpayEvent } from "@/lib/events/normalization";
import { insertReplayProcessingAttempt } from "@/lib/chaos/replay-repository";
import { createPendingChaosRun } from "@/lib/chaos/run-repository";
import { processMerchantWebhookEvent } from "@/lib/events/processor";

import { taggedValue, trackAttempt, trackOrder } from "./helpers";
import fixture from "../../fixtures/razorpay/payment-failed-test-mode.fixture.json";

/**
 * Phase 3D-C — proves the frozen production `payment.failed` merchant
 * processor MECHANICS against the REAL Supabase project, using the captured,
 * sanitized C11 TEST_FIXTURE
 * (tests/fixtures/razorpay/payment-failed-test-mode.fixture.json) as the
 * source of the payment.failed business/error semantics.
 *
 * ============================================================================
 * ARCHITECT CORRECTION — EXECUTION PROVENANCE (this file previously violated
 * this rule and was rewritten; read this before adding any test here)
 * ============================================================================
 *
 * This file follows the EXACT provenance discipline already established by
 * `053-chaos-replay-execution.integration.test.ts` for C01 mechanics — read
 * that file's own module doc comment first. Three DISTINCT provenance
 * layers, never conflated:
 *
 *   1. `event_processing_attempts.source_kind = PAYCHAOS_REPLAY` — THIS
 *      TEST'S OWN EXECUTION provenance. This is the only processing attempt
 *      this file ever creates; it is never `REAL_RAZORPAY_WEBHOOK`.
 *   2. `normalized_event.sourceKind = REAL_RAZORPAY_WEBHOOK` — describes the
 *      provenance of the underlying captured EVIDENCE the fixture was
 *      derived from (the frozen, unmodified `normalizeRazorpayEvent`
 *      unconditionally stamps this literal on every output; it is not
 *      rewritten here, and is not a claim this test execution is genuine).
 *   3. `webhook_events.source_kind = REAL_RAZORPAY_WEBHOOK` on the row this
 *      file inserts — a SYNTHETIC CANONICAL COMPATIBILITY ROW, required
 *      only because the frozen schema currently accepts no other literal
 *      for that column (see docs/DATABASE.md's "Column/Value Phasing
 *      Note") — NOT genuine provider evidence. It exists solely inside this
 *      file's isolated test setup, is deleted unconditionally in `afterAll`,
 *      is never visible to any UI/demo/reliability-score path, and is never
 *      used as evidence for `PRECHECK_PASSED` or a positive real-provider
 *      claim.
 *
 * The mechanics `chaos_runs` row this file creates is ALWAYS
 * `data_classification = SYNTHETIC_DEMO` — never `RECORDED_TEST_EVIDENCE`.
 * This file imports NOTHING from a C11 execution service (none exists yet —
 * that is Phase 3D-D), and calls NEITHER `runChaosPrecheck` NOR
 * `createChaosRun`. `tests/unit/supabase/
 * 057-chaos-c11-fixture-provenance-guard.test.ts` statically enforces all of
 * the above so this file cannot silently regress into a dishonest claim.
 *
 * The genuine positive provenance claim — that a REAL Razorpay Test Mode
 * `payment.failed` event was received, verified, and safely processed — is
 * separately, already proven by the real, untouched canonical row this
 * fixture was captured from: `webhook_events.id =
 * e0df759e-bbde-45c3-aa80-a5a2d6b61be9`. This file never MUTATES that row —
 * the final describe block below performs an OPTIONAL, read-only recheck of
 * it (a SELECT only, never an UPDATE/INSERT/DELETE), and does not fail this
 * suite merely because that historical row is absent from whatever Supabase
 * project this suite happens to run against in the future (this test
 * environment's own project is not guaranteed to retain it forever, and the
 * authentic-source verification itself was already independently performed,
 * read-only, and is recorded in the fixture's own metadata and in
 * handoffs/PHASE-3D-C-HANDOFF.md).
 *
 * Business/error semantics used below (amount, currency, status,
 * error_code/source/step/reason) are copied from the fixture file, never
 * invented. Provider IDs are replaced with fresh per-run-unique tagged
 * values (never the fixture file's own fixed
 * `pay_fixture_c11_failed_001`/`order_fixture_c11_failed_001` literals,
 * which stay reserved for the offline unit test where no database
 * uniqueness constraint applies) to satisfy the database's own
 * `UNIQUE(razorpay_order_id)`/`UNIQUE(razorpay_payment_id)` constraints
 * (supabase/migrations/20260824000000_phase2b_payment_attempts_razorpay_correlation.sql,
 * 20260825000000_phase2c_payments.sql).
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

describe("Phase 3D-C — C11 payment.failed fixture processor mechanics (real Supabase, SYNTHETIC_DEMO chaos_run + PAYCHAOS_REPLAY attempt — NOT a genuine provider delivery claim)", () => {
  it("exactly one PAYCHAOS_REPLAY attempt, sourced from the fixture's authentic captured semantics, processes deterministically to failed/non-PAID with zero fulfilments", async () => {
    const amountSubunits = fixture.payload.payment.amount;
    const currency = fixture.payload.payment.currency;
    const razorpayOrderId = taggedValue("c11-fixture-order");
    const razorpayPaymentId = taggedValue("c11-fixture-payment");
    const razorpayEventId = taggedValue("c11-fixture-event");

    // ------------------------------------------------------------------
    // Isolated synthetic merchant baseline: order -> payment_attempt ->
    // payments (unresolved status yet).
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
        razorpay_receipt: taggedValue("c11-fixture-receipt"),
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
    // SYNTHETIC CANONICAL COMPATIBILITY webhook_events row — required only
    // because the frozen schema accepts no other source_kind literal (see
    // module doc comment, layer 3). NOT genuine provider evidence.
    // signature_verified=true is set ONLY to satisfy the frozen processor's
    // mechanics admission requirement, never a claim of a real signature.
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
        raw_body_sha256: fakeSha256Hex(`c11-fixture-${randomUUID()}`),
        raw_payload_redacted: safeEvidence,
      })
      .select()
      .single();
    expect(webhookError).toBeNull();
    const webhookEventId = webhookEvent!.id;
    outstandingWebhookEventIds.push(webhookEventId);

    // ------------------------------------------------------------------
    // Mechanics-only SYNTHETIC_DEMO chaos_run — the exact established 053
    // pattern (createPendingChaosRun, left PENDING — never transitioned;
    // event_processing_attempts.chaos_run_id is a plain FK reference with
    // no status requirement, matching 053's own createSyntheticMechanicsChaosRun).
    // scenario_id=C11, fault_type=null (C11 has no fault primitive — this
    // task's registry contract, lib/chaos/registry.ts).
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
    // Real, unmodified normalizer — proves deterministic normalization
    // using the fixture-derived safeEvidence just persisted. Its output's
    // sourceKind reads REAL_RAZORPAY_WEBHOOK — provenance layer 2, see
    // module doc comment; this is never this test's own execution
    // provenance, which is established separately below (layer 1).
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
    expect(normalizationResult.event).toMatchObject({
      kind: "payment.failed",
      sourceKind: "REAL_RAZORPAY_WEBHOOK",
      razorpayPaymentStatus: "failed",
      errorCode: fixture.payload.payment.error_code,
      errorSource: fixture.payload.payment.error_source,
      errorStep: fixture.payload.payment.error_step,
      errorReason: fixture.payload.payment.error_reason,
      amountSubunits,
      currency,
    });

    // ------------------------------------------------------------------
    // EXACTLY ONE PAYCHAOS_REPLAY attempt (provenance layer 1 — this
    // test's own execution provenance) + the real, unmodified
    // processMerchantWebhookEvent. No chaos execution service, no
    // runChaosPrecheck, no createChaosRun anywhere in this file.
    // ------------------------------------------------------------------
    const processingAttempt = await insertReplayProcessingAttempt({
      chaosRunId,
      webhookEventId,
      paymentAttemptId,
      paymentId,
      normalizedEvent: normalizationResult.event as unknown as Record<
        string,
        unknown
      >,
    });
    outstandingAttemptIds.push(processingAttempt.id);

    const result = await processMerchantWebhookEvent(processingAttempt.id);
    expect(result.outcome).toBe("processed");
    expect(result.fulfilmentId).toBeNull();

    // ------------------------------------------------------------------
    // Provenance assertions (this task's Section 6).
    // ------------------------------------------------------------------
    const { data: persistedAttempt } = await client
      .from("event_processing_attempts")
      .select("source_kind, chaos_run_id, is_duplicate_delivery, status")
      .eq("id", processingAttempt.id)
      .single();
    expect(persistedAttempt?.source_kind).toBe("PAYCHAOS_REPLAY");
    expect(persistedAttempt?.chaos_run_id).toBe(chaosRunId);
    expect(persistedAttempt?.is_duplicate_delivery).toBe(false);
    expect(persistedAttempt?.status).toBe("SUCCEEDED");

    // Exactly one replay attempt exists for this mechanics run/event — no
    // second replay was ever created.
    const { data: allAttemptsForRun } = await client
      .from("event_processing_attempts")
      .select("id")
      .eq("chaos_run_id", chaosRunId);
    expect(allAttemptsForRun).toHaveLength(1);

    // ------------------------------------------------------------------
    // Required business post-conditions (this task's Section 6).
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
});

describe("Phase 3D-C — genuine captured source event (optional, read-only recheck only — never a hard dependency)", () => {
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
  // order, mirroring 053's fully-corrected FK graph:
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
  // sets (architect requirement) — never just the three that happened to
  // be checked before. Exact tracked IDs only; a `randomUUID()` fallback
  // when a set is empty guarantees the `.in(...)` filter can never
  // accidentally match a real, unrelated row (including the genuine
  // source event e0df759e-bbde-45c3-aa80-a5a2d6b61be9, which this file
  // never deletes and is never among these tracked ID arrays).
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
