import { createHash, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

import { getAnonClientForTest, taggedValue, testOrderInsert } from "./helpers";

/**
 * Phase 2F — proves the additive migration
 * (20260828000000_phase2f_merchant_processing.sql) against the REAL
 * Supabase project: `fulfilments.payment_id` /
 * `fulfilments.trigger_processing_attempt_id`, and the
 * `process_webhook_payment_event` transactional RPC. Every ID used here is
 * a synthetic, tagged placeholder — never a real Razorpay identifier — and
 * no real HMAC verification, Checkout flow, or Razorpay API call happens
 * anywhere in this file. Every `event_processing_attempts` row this file
 * creates directly (bypassing `lib/webhooks/service.ts`) uses
 * `source_kind = 'REAL_RAZORPAY_WEBHOOK'` only because that is the only
 * value the Phase 2 CHECK constraint currently allows — it does NOT mean a
 * real Razorpay webhook was received; this is synthetic database evidence,
 * consistent with docs/DATABASE.md Section 32/this task's Section 32.
 *
 * IMPORTANT: this file will fail with "column ... does not exist" /
 * "function ... does not exist" until the developer manually applies
 * 20260828000000_phase2f_merchant_processing.sql against the real Supabase
 * project — this is expected and must be reported honestly, not hidden or
 * auto-applied. Claude does not apply this migration.
 *
 * "authenticated" RPC-denial (this task's Section 37 item 40) is not
 * separately exercised here: this application has no Supabase Auth user
 * accounts anywhere (single-workspace app, custom cookie access gate — see
 * docs/SECURITY.md), so there is no way to construct a genuine
 * `authenticated`-role Supabase session in this test suite, exactly like
 * every prior Phase 2 integration file's "anon only" RLS-denial coverage.
 * The migration-level structural test
 * (tests/unit/supabase/migration.test.ts, "anon/authenticated are never
 * granted execute") independently proves `authenticated` is never granted
 * EXECUTE at the SQL level.
 */
function fakeSha256Hex(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

const client = getSupabaseServerClient();

const outstandingFulfilmentIds: string[] = [];
const outstandingProcessingAttemptIds: string[] = [];
const outstandingWebhookEventIds: string[] = [];
const outstandingPaymentIds: string[] = [];
const outstandingAttemptIds: string[] = [];
const outstandingOrderIds: string[] = [];

async function createOrder(
  amountSubunits: number,
): Promise<{ id: string; currency: string }> {
  const { data, error } = await client
    .from("orders")
    .insert(testOrderInsert(amountSubunits))
    .select()
    .single();
  expect(error).toBeNull();
  if (!data) throw new Error("expected orders insert to return a row");
  outstandingOrderIds.push(data.id);
  return { id: data.id, currency: data.currency };
}

async function createAttempt(
  orderId: string,
  amountSubunits: number,
  currency: string,
  razorpayOrderId: string,
): Promise<string> {
  const { data, error } = await client
    .from("payment_attempts")
    .insert({
      order_id: orderId,
      attempt_no: 1,
      amount_subunits: amountSubunits,
      currency,
      status: "CHECKOUT_IN_PROGRESS",
      razorpay_receipt: taggedValue("attempt"),
      razorpay_order_id: razorpayOrderId,
      razorpay_order_status: "created",
    })
    .select()
    .single();
  expect(error).toBeNull();
  if (!data)
    throw new Error("expected payment_attempts insert to return a row");
  outstandingAttemptIds.push(data.id);
  return data.id;
}

async function createPayment(
  paymentAttemptId: string,
  razorpayPaymentId: string,
  amountSubunits: number,
  currency: string,
): Promise<string> {
  const { data, error } = await client
    .from("payments")
    .insert({
      payment_attempt_id: paymentAttemptId,
      razorpay_payment_id: razorpayPaymentId,
      amount_subunits: amountSubunits,
      currency,
      checkout_signature_verified: false,
    })
    .select()
    .single();
  expect(error).toBeNull();
  if (!data) throw new Error("expected payments insert to return a row");
  outstandingPaymentIds.push(data.id);
  return data.id;
}

/**
 * Phase 2F architect-review correction (Finding B) — the canonical webhook
 * cross-check inside `process_webhook_payment_event` now compares a
 * processing attempt's normalized event against the DERIVED correlation
 * columns on its canonical `webhook_events` row
 * (`razorpay_order_id`/`razorpay_payment_id`/`payment_attempt_id`/
 * `payment_id`/`amount_subunits`/`currency`/`razorpay_payment_status`). In
 * real production traffic those columns are populated by
 * `lib/webhooks/repository.ts`'s `updateWebhookEventDerivedFields` before
 * this RPC ever runs (`lib/webhooks/service.ts`'s
 * `correlateNormalizeAndPersist`) — so every synthetic webhook_events row
 * this test file builds must carry the SAME derived evidence its
 * corresponding normalized event/processing attempt carries, or the new
 * cross-check will (correctly) reject it. This helper accepts that full
 * derived-field set explicitly instead of leaving it NULL, exactly
 * mirroring what a real correlated webhook_events row looks like.
 */
interface WebhookEventDerivedFields {
  readonly razorpayOrderId: string | null;
  readonly razorpayPaymentId: string | null;
  readonly paymentAttemptId: string | null;
  readonly paymentId: string | null;
  readonly amountSubunits: number | null;
  readonly currency: string | null;
  readonly razorpayPaymentStatus: string | null;
}

async function createWebhookEvent(
  eventType: string,
  label: string,
  derived: WebhookEventDerivedFields,
): Promise<string> {
  const { data, error } = await client
    .from("webhook_events")
    .insert({
      razorpay_event_id: taggedValue(label),
      event_type: eventType,
      signature_verified: true,
      raw_body_sha256: fakeSha256Hex(`${label}-${randomUUID()}`),
      raw_payload_redacted: { event: eventType },
      razorpay_order_id: derived.razorpayOrderId,
      razorpay_payment_id: derived.razorpayPaymentId,
      payment_attempt_id: derived.paymentAttemptId,
      payment_id: derived.paymentId,
      amount_subunits: derived.amountSubunits,
      currency: derived.currency,
      razorpay_payment_status: derived.razorpayPaymentStatus,
    })
    .select()
    .single();
  expect(error).toBeNull();
  if (!data) throw new Error("expected webhook_events insert to return a row");
  outstandingWebhookEventIds.push(data.id);
  return data.id;
}

function normalizedCaptured(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  amountSubunits: number;
  currency: string;
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    sourceKind: "REAL_RAZORPAY_WEBHOOK",
    razorpayEventId: taggedValue("evt"),
    eventType: "payment.captured",
    providerCreatedAt: null,
    kind: "payment.captured",
    razorpayOrderId: input.razorpayOrderId,
    razorpayPaymentId: input.razorpayPaymentId,
    amountSubunits: input.amountSubunits,
    currency: input.currency,
    razorpayPaymentStatus: "captured",
  };
}

function normalizedFailed(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  amountSubunits: number;
  currency: string;
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    sourceKind: "REAL_RAZORPAY_WEBHOOK",
    razorpayEventId: taggedValue("evt"),
    eventType: "payment.failed",
    providerCreatedAt: null,
    kind: "payment.failed",
    razorpayOrderId: input.razorpayOrderId,
    razorpayPaymentId: input.razorpayPaymentId,
    amountSubunits: input.amountSubunits,
    currency: input.currency,
    razorpayPaymentStatus: "failed",
    errorCode: "BAD_REQUEST_ERROR",
    errorSource: "customer",
    errorStep: "payment_authentication",
    errorReason: "payment_failed",
  };
}

function normalizedOrderPaid(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  amountSubunits: number;
  currency: string;
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    sourceKind: "REAL_RAZORPAY_WEBHOOK",
    razorpayEventId: taggedValue("evt"),
    eventType: "order.paid",
    providerCreatedAt: null,
    kind: "order.paid",
    razorpayOrderId: input.razorpayOrderId,
    razorpayPaymentId: input.razorpayPaymentId,
    amountSubunits: input.amountSubunits,
    currency: input.currency,
  };
}

async function createProcessingAttempt(input: {
  webhookEventId: string;
  paymentAttemptId: string;
  paymentId: string | null;
  normalizedEvent: Record<string, unknown>;
  status?: Database["public"]["Tables"]["event_processing_attempts"]["Row"]["status"];
}): Promise<string> {
  const { data, error } = await client
    .from("event_processing_attempts")
    .insert({
      webhook_event_id: input.webhookEventId,
      payment_attempt_id: input.paymentAttemptId,
      payment_id: input.paymentId,
      source_kind: "REAL_RAZORPAY_WEBHOOK",
      is_duplicate_delivery: false,
      status: input.status ?? "PENDING",
      normalized_event: input.normalizedEvent,
    })
    .select()
    .single();
  expect(error).toBeNull();
  if (!data)
    throw new Error(
      "expected event_processing_attempts insert to return a row",
    );
  outstandingProcessingAttemptIds.push(data.id);
  return data.id;
}

interface CaptureScenario {
  orderId: string;
  attemptId: string;
  paymentId: string;
  webhookEventId: string;
  processingAttemptId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  amountSubunits: number;
  currency: string;
}

/** Builds a fully valid, self-consistent order -> attempt -> payment -> webhook_event -> PENDING processing-attempt chain, ready for payment.captured processing. */
async function buildCaptureScenario(
  amountSubunits = 50_000,
): Promise<CaptureScenario> {
  const order = await createOrder(amountSubunits);
  const razorpayOrderId = taggedValue("order");
  const razorpayPaymentId = taggedValue("payment");
  const attemptId = await createAttempt(
    order.id,
    amountSubunits,
    order.currency,
    razorpayOrderId,
  );
  const paymentId = await createPayment(
    attemptId,
    razorpayPaymentId,
    amountSubunits,
    order.currency,
  );
  const webhookEventId = await createWebhookEvent(
    "payment.captured",
    "capture-scenario",
    {
      razorpayOrderId,
      razorpayPaymentId,
      paymentAttemptId: attemptId,
      paymentId,
      amountSubunits,
      currency: order.currency,
      razorpayPaymentStatus: "captured",
    },
  );
  const processingAttemptId = await createProcessingAttempt({
    webhookEventId,
    paymentAttemptId: attemptId,
    paymentId,
    normalizedEvent: normalizedCaptured({
      razorpayOrderId,
      razorpayPaymentId,
      amountSubunits,
      currency: order.currency,
    }),
  });
  return {
    orderId: order.id,
    attemptId,
    paymentId,
    webhookEventId,
    processingAttemptId,
    razorpayOrderId,
    razorpayPaymentId,
    amountSubunits,
    currency: order.currency,
  };
}

/**
 * Builds a fresh, dedicated `payment.failed` webhook event correlated to an
 * existing capture scenario's order/attempt/payment. A genuine Razorpay
 * `payment.failed` observation and a later/earlier `payment.captured`
 * observation for the same underlying payment are always TWO SEPARATE
 * Razorpay webhook deliveries (different `razorpay_event_id`, different
 * `event_type`) — each gets its own canonical `webhook_events` row in
 * reality, never a shared one. Tests that exercise "failed then captured"
 * or "captured then a stale failed" convergence must therefore give the
 * failed observation its OWN webhook_events row (this task's Finding B
 * cross-check would otherwise correctly reject reusing the capture
 * scenario's own `payment.captured`-typed webhook_events row for a
 * `payment.failed` processing attempt).
 */
async function createFailedWebhookEventForScenario(
  scenario: CaptureScenario,
  label: string,
): Promise<string> {
  return createWebhookEvent("payment.failed", label, {
    razorpayOrderId: scenario.razorpayOrderId,
    razorpayPaymentId: scenario.razorpayPaymentId,
    paymentAttemptId: scenario.attemptId,
    paymentId: scenario.paymentId,
    amountSubunits: scenario.amountSubunits,
    currency: scenario.currency,
    razorpayPaymentStatus: "failed",
  });
}

async function fulfilmentForOrder(
  orderId: string,
): Promise<Database["public"]["Tables"]["fulfilments"]["Row"] | null> {
  const { data, error } = await client
    .from("fulfilments")
    .select("*")
    .eq("idempotency_key", `FULFIL_ORDER:${orderId}`)
    .maybeSingle();
  expect(error).toBeNull();
  return data;
}

describe("Phase 2F — fulfilments schema (real Supabase)", () => {
  // 36/37: fulfilments.payment_id / trigger_processing_attempt_id exist.
  it("a fulfilment row can be inserted with payment_id and trigger_processing_attempt_id, and both persist", async () => {
    const scenario = await buildCaptureScenario();
    const { data, error } = await client
      .from("fulfilments")
      .insert({
        order_id: scenario.orderId,
        payment_id: scenario.paymentId,
        trigger_processing_attempt_id: scenario.processingAttemptId,
        effect_type: "FULFIL_ORDER",
        idempotency_key: taggedValue("manual-fulfilment"),
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    outstandingFulfilmentIds.push(data!.id);
    expect(data!.payment_id).toBe(scenario.paymentId);
    expect(data!.trigger_processing_attempt_id).toBe(
      scenario.processingAttemptId,
    );
  });

  it("fulfilments.payment_id is NOT NULL — omitting it is rejected", async () => {
    const scenario = await buildCaptureScenario();
    const { error } = await client
      .from("fulfilments")
      .insert({
        order_id: scenario.orderId,
        trigger_processing_attempt_id: scenario.processingAttemptId,
        effect_type: "FULFIL_ORDER",
        idempotency_key: taggedValue("missing-payment-id"),
      } as Database["public"]["Tables"]["fulfilments"]["Insert"])
      .select()
      .single();
    expect(error).not.toBeNull();
  });

  it("fulfilments.payment_id FK rejects a nonexistent payment (23503)", async () => {
    const scenario = await buildCaptureScenario();
    const { error } = await client
      .from("fulfilments")
      .insert({
        order_id: scenario.orderId,
        payment_id: randomUUID(),
        effect_type: "FULFIL_ORDER",
        idempotency_key: taggedValue("orphan-payment-fk"),
      })
      .select()
      .single();
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23503");
  });
});

describe("Phase 2F — process_webhook_payment_event RPC privileges (real Supabase)", () => {
  // 38: service_role can execute.
  it("service_role can execute the RPC", async () => {
    const scenario = await buildCaptureScenario();
    const { data, error } = await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: scenario.processingAttemptId,
    });
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    const fulfilment = await fulfilmentForOrder(scenario.orderId);
    if (fulfilment) outstandingFulfilmentIds.push(fulfilment.id);
  });

  // 39: anon cannot execute.
  it("anon cannot execute the RPC", async () => {
    const anon = getAnonClientForTest();
    const { data, error } = await anon.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: randomUUID(),
    });
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("nonexistent processing attempt is rejected (PROCESSING_ATTEMPT_NOT_FOUND)", async () => {
    const { data, error } = await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: randomUUID(),
    });
    expect(error).not.toBeNull();
    expect(data).toBeNull();
    expect(error?.message).toMatch(/PROCESSING_ATTEMPT_NOT_FOUND/);
  });

  it("an invalid processing source (source_kind mismatch is impossible via CHECK; a null webhook_event_id on a REAL_RAZORPAY_WEBHOOK row is impossible via CHECK too) is structurally prevented at insert time — proven instead via a TEST_FIXTURE-shaped rejection is N/A; this asserts the CHECK constraint itself rejects the attempt", async () => {
    // event_processing_attempts_real_webhook_requires_event CHECK already
    // prevents constructing this invalid state at all (Phase 2E migration)
    // — confirming that guarantee here rather than duplicating it.
    const scenario = await buildCaptureScenario();
    const { error } = await client
      .from("event_processing_attempts")
      .insert({
        webhook_event_id: null,
        payment_attempt_id: scenario.attemptId,
        payment_id: scenario.paymentId,
        source_kind: "REAL_RAZORPAY_WEBHOOK",
        status: "PENDING",
        normalized_event: {},
      })
      .select()
      .single();
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
  });
});

describe("Phase 2F — payment.captured (real Supabase)", () => {
  it("41-54: a fresh, valid payment.captured attempt captures the payment, marks the attempt CAPTURED, marks the order PAID/FULFILLED, creates exactly one fulfilment, and marks processing/webhook state SUCCEEDED/PROCESSED", async () => {
    const scenario = await buildCaptureScenario();

    const { data: rpcResult, error } = await client.rpc(
      "process_webhook_payment_event",
      { p_processing_attempt_id: scenario.processingAttemptId },
    );
    expect(error).toBeNull();
    const result = rpcResult as Record<string, unknown>;
    expect(result.outcome).toBe("processed");
    expect(result.order_id).toBe(scenario.orderId);
    expect(result.payment_id).toBe(scenario.paymentId);
    expect(result.fulfilment_id).toEqual(expect.any(String));

    const { data: payment } = await client
      .from("payments")
      .select("*")
      .eq("id", scenario.paymentId)
      .single();
    expect(payment?.razorpay_payment_status).toBe("captured");
    expect(payment?.captured_at).not.toBeNull();

    const { data: attempt } = await client
      .from("payment_attempts")
      .select("*")
      .eq("id", scenario.attemptId)
      .single();
    expect(attempt?.status).toBe("CAPTURED");

    const { data: order } = await client
      .from("orders")
      .select("*")
      .eq("id", scenario.orderId)
      .single();
    expect(order?.payment_status).toBe("PAID");
    expect(order?.business_status).toBe("FULFILLED");

    const fulfilment = await fulfilmentForOrder(scenario.orderId);
    expect(fulfilment).not.toBeNull();
    outstandingFulfilmentIds.push(fulfilment!.id);
    expect(fulfilment!.payment_id).toBe(scenario.paymentId);
    expect(fulfilment!.trigger_processing_attempt_id).toBe(
      scenario.processingAttemptId,
    );
    expect(fulfilment!.idempotency_key).toBe(
      `FULFIL_ORDER:${scenario.orderId}`,
    );

    const { count: fulfilmentCount } = await client
      .from("fulfilments")
      .select("id", { count: "exact", head: true })
      .eq("order_id", scenario.orderId);
    expect(fulfilmentCount).toBe(1);

    const { data: processingAttempt } = await client
      .from("event_processing_attempts")
      .select("*")
      .eq("id", scenario.processingAttemptId)
      .single();
    expect(processingAttempt?.status).toBe("SUCCEEDED");
    expect(processingAttempt?.finished_at).not.toBeNull();

    const { data: webhookEvent } = await client
      .from("webhook_events")
      .select("*")
      .eq("id", scenario.webhookEventId)
      .single();
    expect(webhookEvent?.processing_status).toBe("PROCESSED");
    expect(webhookEvent?.processed_at).not.toBeNull();
  });

  it("55-56: calling the RPC again for the SAME SUCCEEDED attempt changes no business count; fulfilment remains exactly one", async () => {
    const scenario = await buildCaptureScenario();
    await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: scenario.processingAttemptId,
    });
    const fulfilmentBefore = await fulfilmentForOrder(scenario.orderId);
    if (fulfilmentBefore) outstandingFulfilmentIds.push(fulfilmentBefore.id);

    const { data: rpcResult, error } = await client.rpc(
      "process_webhook_payment_event",
      { p_processing_attempt_id: scenario.processingAttemptId },
    );
    expect(error).toBeNull();
    expect((rpcResult as Record<string, unknown>).outcome).toBe(
      "already_processed",
    );

    const { count } = await client
      .from("fulfilments")
      .select("id", { count: "exact", head: true })
      .eq("order_id", scenario.orderId);
    expect(count).toBe(1);
  });

  it("57: concurrent processor calls for the SAME attempt produce exactly one fulfilment", async () => {
    const scenario = await buildCaptureScenario();
    const CONCURRENCY = 5;

    await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        client.rpc("process_webhook_payment_event", {
          p_processing_attempt_id: scenario.processingAttemptId,
        }),
      ),
    );

    const fulfilment = await fulfilmentForOrder(scenario.orderId);
    expect(fulfilment).not.toBeNull();
    outstandingFulfilmentIds.push(fulfilment!.id);

    const { count } = await client
      .from("fulfilments")
      .select("id", { count: "exact", head: true })
      .eq("order_id", scenario.orderId);
    expect(count).toBe(1);
  });

  it("58: two SEPARATE valid capture processing attempts for the same order still produce at most one fulfilment", async () => {
    const scenario = await buildCaptureScenario();
    // A second, independent processing attempt for the SAME already-valid
    // webhook_event/payment/attempt chain (e.g. representing a webhook
    // retry flow creating a fresh PENDING row after an earlier unrelated
    // failure) — same underlying evidence, different attempt row.
    const secondAttemptId = await createProcessingAttempt({
      webhookEventId: scenario.webhookEventId,
      paymentAttemptId: scenario.attemptId,
      paymentId: scenario.paymentId,
      normalizedEvent: normalizedCaptured({
        razorpayOrderId: scenario.razorpayOrderId,
        razorpayPaymentId: scenario.razorpayPaymentId,
        amountSubunits: scenario.amountSubunits,
        currency: scenario.currency,
      }),
    });

    await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: scenario.processingAttemptId,
    });
    const { data: secondResult, error: secondError } = await client.rpc(
      "process_webhook_payment_event",
      { p_processing_attempt_id: secondAttemptId },
    );
    expect(secondError).toBeNull();
    expect((secondResult as Record<string, unknown>).outcome).toBe("processed");

    const fulfilment = await fulfilmentForOrder(scenario.orderId);
    expect(fulfilment).not.toBeNull();
    outstandingFulfilmentIds.push(fulfilment!.id);
    // The second attempt's own trigger id must NOT overwrite the
    // already-resolved fulfilment's original trigger.
    expect(fulfilment!.trigger_processing_attempt_id).toBe(
      scenario.processingAttemptId,
    );

    const { count } = await client
      .from("fulfilments")
      .select("id", { count: "exact", head: true })
      .eq("order_id", scenario.orderId);
    expect(count).toBe(1);
  });
});

describe("Phase 2F — payment.failed (real Supabase)", () => {
  it("59-64: payment.failed produces FAILED_OBSERVED when not captured, sets failed_at, creates no fulfilment, keeps business_status OPEN, and marks processing/webhook state SUCCEEDED/PROCESSED", async () => {
    const amountSubunits = 40_000;
    const order = await createOrder(amountSubunits);
    const razorpayOrderId = taggedValue("order");
    const razorpayPaymentId = taggedValue("payment");
    const attemptId = await createAttempt(
      order.id,
      amountSubunits,
      order.currency,
      razorpayOrderId,
    );
    const paymentId = await createPayment(
      attemptId,
      razorpayPaymentId,
      amountSubunits,
      order.currency,
    );
    const webhookEventId = await createWebhookEvent(
      "payment.failed",
      "failed-scenario",
      {
        razorpayOrderId,
        razorpayPaymentId,
        paymentAttemptId: attemptId,
        paymentId,
        amountSubunits,
        currency: order.currency,
        razorpayPaymentStatus: "failed",
      },
    );
    const processingAttemptId = await createProcessingAttempt({
      webhookEventId,
      paymentAttemptId: attemptId,
      paymentId,
      normalizedEvent: normalizedFailed({
        razorpayOrderId,
        razorpayPaymentId,
        amountSubunits,
        currency: order.currency,
      }),
    });

    const { data: rpcResult, error } = await client.rpc(
      "process_webhook_payment_event",
      { p_processing_attempt_id: processingAttemptId },
    );
    expect(error).toBeNull();
    expect((rpcResult as Record<string, unknown>).outcome).toBe("processed");

    const { data: payment } = await client
      .from("payments")
      .select("*")
      .eq("id", paymentId)
      .single();
    expect(payment?.razorpay_payment_status).toBe("failed");
    expect(payment?.failed_at).not.toBeNull();
    expect(payment?.error_code).toBe("BAD_REQUEST_ERROR");

    const { data: order2 } = await client
      .from("orders")
      .select("*")
      .eq("id", order.id)
      .single();
    expect(order2?.payment_status).toBe("FAILED_OBSERVED");
    expect(order2?.business_status).toBe("OPEN");

    const fulfilment = await fulfilmentForOrder(order.id);
    expect(fulfilment).toBeNull();

    const { data: processingAttempt } = await client
      .from("event_processing_attempts")
      .select("*")
      .eq("id", processingAttemptId)
      .single();
    expect(processingAttempt?.status).toBe("SUCCEEDED");

    const { data: webhookEvent } = await client
      .from("webhook_events")
      .select("*")
      .eq("id", webhookEventId)
      .single();
    expect(webhookEvent?.processing_status).toBe("PROCESSED");
  });
});

describe("Phase 2F — convergence (real Supabase)", () => {
  it("65-67: failed then captured converges to CAPTURED/PAID/FULFILLED with exactly one fulfilment", async () => {
    const scenario = await buildCaptureScenario();

    const failedWebhookEventId = await createFailedWebhookEventForScenario(
      scenario,
      "convergence-failed-then-captured",
    );
    const failedAttemptId = await createProcessingAttempt({
      webhookEventId: failedWebhookEventId,
      paymentAttemptId: scenario.attemptId,
      paymentId: scenario.paymentId,
      normalizedEvent: normalizedFailed({
        razorpayOrderId: scenario.razorpayOrderId,
        razorpayPaymentId: scenario.razorpayPaymentId,
        amountSubunits: scenario.amountSubunits,
        currency: scenario.currency,
      }),
    });
    await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: failedAttemptId,
    });

    await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: scenario.processingAttemptId,
    });

    const { data: payment } = await client
      .from("payments")
      .select("*")
      .eq("id", scenario.paymentId)
      .single();
    expect(payment?.razorpay_payment_status).toBe("captured");

    const { data: order } = await client
      .from("orders")
      .select("*")
      .eq("id", scenario.orderId)
      .single();
    expect(order?.payment_status).toBe("PAID");
    expect(order?.business_status).toBe("FULFILLED");

    const fulfilment = await fulfilmentForOrder(scenario.orderId);
    expect(fulfilment).not.toBeNull();
    outstandingFulfilmentIds.push(fulfilment!.id);
    const { count } = await client
      .from("fulfilments")
      .select("id", { count: "exact", head: true })
      .eq("order_id", scenario.orderId);
    expect(count).toBe(1);
  });

  it("captured then a STALE failed never regresses CAPTURED/PAID/FULFILLED", async () => {
    const scenario = await buildCaptureScenario();
    await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: scenario.processingAttemptId,
    });
    const fulfilmentAfterCapture = await fulfilmentForOrder(scenario.orderId);
    if (fulfilmentAfterCapture)
      outstandingFulfilmentIds.push(fulfilmentAfterCapture.id);

    const staleFailedWebhookEventId = await createFailedWebhookEventForScenario(
      scenario,
      "convergence-stale-failed",
    );
    const staleFailedAttemptId = await createProcessingAttempt({
      webhookEventId: staleFailedWebhookEventId,
      paymentAttemptId: scenario.attemptId,
      paymentId: scenario.paymentId,
      normalizedEvent: normalizedFailed({
        razorpayOrderId: scenario.razorpayOrderId,
        razorpayPaymentId: scenario.razorpayPaymentId,
        amountSubunits: scenario.amountSubunits,
        currency: scenario.currency,
      }),
    });
    const { data: rpcResult, error } = await client.rpc(
      "process_webhook_payment_event",
      { p_processing_attempt_id: staleFailedAttemptId },
    );
    expect(error).toBeNull();
    expect((rpcResult as Record<string, unknown>).outcome).toBe("processed");

    const { data: payment } = await client
      .from("payments")
      .select("*")
      .eq("id", scenario.paymentId)
      .single();
    expect(payment?.razorpay_payment_status).toBe("captured");
    expect(payment?.captured_at).not.toBeNull();

    const { data: attempt } = await client
      .from("payment_attempts")
      .select("*")
      .eq("id", scenario.attemptId)
      .single();
    expect(attempt?.status).toBe("CAPTURED");

    const { data: order } = await client
      .from("orders")
      .select("*")
      .eq("id", scenario.orderId)
      .single();
    expect(order?.payment_status).toBe("PAID");
    expect(order?.business_status).toBe("FULFILLED");

    const { count } = await client
      .from("fulfilments")
      .select("id", { count: "exact", head: true })
      .eq("order_id", scenario.orderId);
    expect(count).toBe(1);
  });
});

describe("Phase 2F — order.paid (real Supabase)", () => {
  it("68-71: order.paid before capture does not fulfil, does not fabricate captured payment evidence, sets razorpay_order_status paid, and processing succeeds", async () => {
    const amountSubunits = 30_000;
    const order = await createOrder(amountSubunits);
    const razorpayOrderId = taggedValue("order");
    const attemptId = await createAttempt(
      order.id,
      amountSubunits,
      order.currency,
      razorpayOrderId,
    );
    const webhookEventId = await createWebhookEvent(
      "order.paid",
      "order-paid-before-capture",
      {
        razorpayOrderId,
        razorpayPaymentId: null,
        paymentAttemptId: attemptId,
        paymentId: null,
        amountSubunits,
        currency: order.currency,
        razorpayPaymentStatus: null,
      },
    );
    const processingAttemptId = await createProcessingAttempt({
      webhookEventId,
      paymentAttemptId: attemptId,
      paymentId: null,
      normalizedEvent: normalizedOrderPaid({
        razorpayOrderId,
        razorpayPaymentId: null,
        amountSubunits,
        currency: order.currency,
      }),
    });

    const { data: rpcResult, error } = await client.rpc(
      "process_webhook_payment_event",
      { p_processing_attempt_id: processingAttemptId },
    );
    expect(error).toBeNull();
    expect((rpcResult as Record<string, unknown>).outcome).toBe("processed");

    const { data: attempt } = await client
      .from("payment_attempts")
      .select("*")
      .eq("id", attemptId)
      .single();
    expect(attempt?.razorpay_order_status).toBe("paid");
    expect(attempt?.status).not.toBe("CAPTURED");

    const { data: orderRow } = await client
      .from("orders")
      .select("*")
      .eq("id", order.id)
      .single();
    expect(orderRow?.payment_status).toBe("UNPAID");
    expect(orderRow?.business_status).toBe("OPEN");

    // No payments row was fabricated by order.paid.
    const { count: paymentsCount } = await client
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("payment_attempt_id", attemptId);
    expect(paymentsCount).toBe(0);

    const fulfilment = await fulfilmentForOrder(order.id);
    expect(fulfilment).toBeNull();
  });

  it("72-73: order.paid before capture, then a later payment.captured fulfils once; capture then order.paid remains one fulfilment", async () => {
    const scenario = await buildCaptureScenario();

    // order.paid before capture is a SEPARATE Razorpay webhook delivery
    // from the payment.captured evidence `scenario` already carries — give
    // it its own dedicated webhook_events row (same reasoning as
    // createFailedWebhookEventForScenario above; Finding B's cross-check
    // would otherwise reject reusing a payment.captured-typed row for an
    // order.paid processing attempt).
    const orderPaidWebhookEventId = await createWebhookEvent(
      "order.paid",
      "order-paid-before-later-capture",
      {
        razorpayOrderId: scenario.razorpayOrderId,
        razorpayPaymentId: null,
        paymentAttemptId: scenario.attemptId,
        paymentId: null,
        amountSubunits: scenario.amountSubunits,
        currency: scenario.currency,
        razorpayPaymentStatus: null,
      },
    );
    const orderPaidAttemptId = await createProcessingAttempt({
      webhookEventId: orderPaidWebhookEventId,
      paymentAttemptId: scenario.attemptId,
      paymentId: null,
      normalizedEvent: normalizedOrderPaid({
        razorpayOrderId: scenario.razorpayOrderId,
        razorpayPaymentId: null,
        amountSubunits: scenario.amountSubunits,
        currency: scenario.currency,
      }),
    });
    await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: orderPaidAttemptId,
    });

    await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: scenario.processingAttemptId,
    });

    const fulfilmentAfterCapture = await fulfilmentForOrder(scenario.orderId);
    expect(fulfilmentAfterCapture).not.toBeNull();
    outstandingFulfilmentIds.push(fulfilmentAfterCapture!.id);

    // capture then order.paid (a second, later, separately-delivered
    // order.paid webhook event that now also carries the payment id) —
    // remains exactly one fulfilment. Own dedicated webhook_events row,
    // same reasoning as above.
    const laterOrderPaidWebhookEventId = await createWebhookEvent(
      "order.paid",
      "order-paid-after-capture",
      {
        razorpayOrderId: scenario.razorpayOrderId,
        razorpayPaymentId: scenario.razorpayPaymentId,
        paymentAttemptId: scenario.attemptId,
        paymentId: scenario.paymentId,
        amountSubunits: scenario.amountSubunits,
        currency: scenario.currency,
        razorpayPaymentStatus: null,
      },
    );
    const laterOrderPaidAttemptId = await createProcessingAttempt({
      webhookEventId: laterOrderPaidWebhookEventId,
      paymentAttemptId: scenario.attemptId,
      paymentId: scenario.paymentId,
      normalizedEvent: normalizedOrderPaid({
        razorpayOrderId: scenario.razorpayOrderId,
        razorpayPaymentId: scenario.razorpayPaymentId,
        amountSubunits: scenario.amountSubunits,
        currency: scenario.currency,
      }),
    });
    const { data: laterResult, error: laterError } = await client.rpc(
      "process_webhook_payment_event",
      { p_processing_attempt_id: laterOrderPaidAttemptId },
    );
    expect(laterError).toBeNull();
    expect((laterResult as Record<string, unknown>).outcome).toBe("processed");

    const { count } = await client
      .from("fulfilments")
      .select("id", { count: "exact", head: true })
      .eq("order_id", scenario.orderId);
    expect(count).toBe(1);

    const { data: order } = await client
      .from("orders")
      .select("*")
      .eq("id", scenario.orderId)
      .single();
    expect(order?.payment_status).toBe("PAID");
    expect(order?.business_status).toBe("FULFILLED");
  });
});

describe("Phase 2F — safety / fail-closed (real Supabase)", () => {
  it("74-75: amount mismatch rejects processing and leaves zero merchant/business mutation", async () => {
    const scenario = await buildCaptureScenario();
    const mismatchedAttemptId = await createProcessingAttempt({
      webhookEventId: scenario.webhookEventId,
      paymentAttemptId: scenario.attemptId,
      paymentId: scenario.paymentId,
      normalizedEvent: normalizedCaptured({
        razorpayOrderId: scenario.razorpayOrderId,
        razorpayPaymentId: scenario.razorpayPaymentId,
        amountSubunits: scenario.amountSubunits + 1,
        currency: scenario.currency,
      }),
    });

    const { data, error } = await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: mismatchedAttemptId,
    });
    expect(error).not.toBeNull();
    expect(data).toBeNull();
    expect(error?.message).toMatch(/PROCESSING_AMOUNT_MISMATCH/);

    const { data: order } = await client
      .from("orders")
      .select("*")
      .eq("id", scenario.orderId)
      .single();
    expect(order?.payment_status).toBe("UNPAID");
    expect(order?.business_status).toBe("OPEN");

    const { data: payment } = await client
      .from("payments")
      .select("*")
      .eq("id", scenario.paymentId)
      .single();
    expect(payment?.razorpay_payment_status).toBeNull();
    expect(payment?.captured_at).toBeNull();

    const fulfilment = await fulfilmentForOrder(scenario.orderId);
    expect(fulfilment).toBeNull();

    const { data: attemptRow } = await client
      .from("event_processing_attempts")
      .select("*")
      .eq("id", mismatchedAttemptId)
      .single();
    // The RPC call itself failed BEFORE any commit — the row remains
    // whatever it was before this call (PENDING); application code (not
    // this direct RPC test) is responsible for the conditional FAILED
    // mark, per lib/webhooks/event-processing-repository.ts.
    expect(attemptRow?.status).toBe("PENDING");
  });

  it("76: currency mismatch rejects processing", async () => {
    const scenario = await buildCaptureScenario();
    const mismatchedAttemptId = await createProcessingAttempt({
      webhookEventId: scenario.webhookEventId,
      paymentAttemptId: scenario.attemptId,
      paymentId: scenario.paymentId,
      normalizedEvent: normalizedCaptured({
        razorpayOrderId: scenario.razorpayOrderId,
        razorpayPaymentId: scenario.razorpayPaymentId,
        amountSubunits: scenario.amountSubunits,
        currency: "USD",
      }),
    });

    const { error } = await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: mismatchedAttemptId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/PROCESSING_CURRENCY_MISMATCH/);
  });

  it("77-78: wrong payment/order relationship rejects processing with no fulfilment", async () => {
    const scenarioA = await buildCaptureScenario();
    const scenarioB = await buildCaptureScenario();

    // Attempt referencing scenario B's payment attempt, but a normalized
    // event carrying scenario A's razorpayOrderId — a genuine relationship
    // mismatch.
    const mismatchedAttemptId = await createProcessingAttempt({
      webhookEventId: scenarioB.webhookEventId,
      paymentAttemptId: scenarioB.attemptId,
      paymentId: scenarioB.paymentId,
      normalizedEvent: normalizedCaptured({
        razorpayOrderId: scenarioA.razorpayOrderId,
        razorpayPaymentId: scenarioB.razorpayPaymentId,
        amountSubunits: scenarioB.amountSubunits,
        currency: scenarioB.currency,
      }),
    });

    const { error } = await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: mismatchedAttemptId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/PROCESSING_CORRELATION_INVALID/);

    const fulfilmentA = await fulfilmentForOrder(scenarioA.orderId);
    const fulfilmentB = await fulfilmentForOrder(scenarioB.orderId);
    expect(fulfilmentA).toBeNull();
    expect(fulfilmentB).toBeNull();
  });

  it("79: an invalid processing source is rejected (PENDING attempt whose webhook_event_id points to a row that was deleted is impossible via FK RESTRICT — instead this proves a HELD/FAILED/SKIPPED_DUPLICATE attempt is rejected as not-ready)", async () => {
    const scenario = await buildCaptureScenario();
    const heldAttemptId = await createProcessingAttempt({
      webhookEventId: scenario.webhookEventId,
      paymentAttemptId: scenario.attemptId,
      paymentId: scenario.paymentId,
      normalizedEvent: normalizedCaptured({
        razorpayOrderId: scenario.razorpayOrderId,
        razorpayPaymentId: scenario.razorpayPaymentId,
        amountSubunits: scenario.amountSubunits,
        currency: scenario.currency,
      }),
      status: "HELD",
    });

    const { error } = await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: heldAttemptId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/PROCESSING_ATTEMPT_NOT_READY/);

    const fulfilment = await fulfilmentForOrder(scenario.orderId);
    expect(fulfilment).toBeNull();
  });

  it("80: nonexistent processing attempt is rejected", async () => {
    const { error } = await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: randomUUID(),
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/PROCESSING_ATTEMPT_NOT_FOUND/);
  });
});

describe("Phase 2F — atomicity (real Supabase)", () => {
  it("a rejected transaction leaves no impossible partial state: order stays UNPAID with zero fulfilment, or (never both) a fulfilment with the order unpaid", async () => {
    const scenario = await buildCaptureScenario();
    // A deliberately invalid amount forces the RPC to reject AFTER
    // correlation has already succeeded, proving the whole transaction
    // (including anything before the rejection point) rolls back together
    // — not merely "no code path even attempted a mutation".
    const invalidAttemptId = await createProcessingAttempt({
      webhookEventId: scenario.webhookEventId,
      paymentAttemptId: scenario.attemptId,
      paymentId: scenario.paymentId,
      normalizedEvent: normalizedCaptured({
        razorpayOrderId: scenario.razorpayOrderId,
        razorpayPaymentId: scenario.razorpayPaymentId,
        amountSubunits: scenario.amountSubunits + 500,
        currency: scenario.currency,
      }),
    });

    const { error } = await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: invalidAttemptId,
    });
    expect(error).not.toBeNull();

    const { data: order } = await client
      .from("orders")
      .select("*")
      .eq("id", scenario.orderId)
      .single();
    const fulfilment = await fulfilmentForOrder(scenario.orderId);

    const impossibleState =
      (order?.payment_status === "PAID" && fulfilment === null) ||
      (order?.payment_status !== "PAID" && fulfilment !== null);
    expect(impossibleState).toBe(false);
    expect(order?.payment_status).toBe("UNPAID");
    expect(fulfilment).toBeNull();

    const { data: payment } = await client
      .from("payments")
      .select("*")
      .eq("id", scenario.paymentId)
      .single();
    expect(payment?.razorpay_payment_status).toBeNull();

    const { data: attempt } = await client
      .from("payment_attempts")
      .select("*")
      .eq("id", scenario.attemptId)
      .single();
    expect(attempt?.status).not.toBe("CAPTURED");
  });
});

describe("Phase 2F — concurrency (real Supabase, Finding A)", () => {
  it("concurrent payment.captured and payment.failed against the SAME payment converge to CAPTURED — failure never wins regardless of race timing", async () => {
    const scenario = await buildCaptureScenario();

    // A SEPARATE, dedicated payment.failed webhook delivery/processing
    // attempt against the SAME underlying payment_attempt/payment as
    // `scenario`'s own payment.captured evidence — the exact "two
    // DIFFERENT processing attempts referencing the same payment" race
    // shape Finding A's SELECT ... FOR UPDATE locking must serialize.
    const failedWebhookEventId = await createFailedWebhookEventForScenario(
      scenario,
      "concurrency-failed",
    );
    const failedAttemptId = await createProcessingAttempt({
      webhookEventId: failedWebhookEventId,
      paymentAttemptId: scenario.attemptId,
      paymentId: scenario.paymentId,
      normalizedEvent: normalizedFailed({
        razorpayOrderId: scenario.razorpayOrderId,
        razorpayPaymentId: scenario.razorpayPaymentId,
        amountSubunits: scenario.amountSubunits,
        currency: scenario.currency,
      }),
    });

    // Fire both RPC calls genuinely concurrently — no sleeps, no awaited
    // sequencing between them. Whichever call's SELECT ... FOR UPDATE
    // (Finding A lock order: event_processing_attempts -> webhook_events ->
    // payment_attempts -> orders -> payments) acquires the payment row
    // lock first commits its decision; the second blocks on that lock and
    // then re-reads the NOW-current payment row before deciding, so the
    // outcome must be deterministic and order-independent: captured always
    // wins.
    const [capturedResult, failedResult] = await Promise.all([
      client.rpc("process_webhook_payment_event", {
        p_processing_attempt_id: scenario.processingAttemptId,
      }),
      client.rpc("process_webhook_payment_event", {
        p_processing_attempt_id: failedAttemptId,
      }),
    ]);

    // Both calls must complete without error — a payment.failed call that
    // loses the race to a payment.captured call is a safe no-op, never a
    // rejected transaction.
    expect(capturedResult.error).toBeNull();
    expect(failedResult.error).toBeNull();

    const { data: payment } = await client
      .from("payments")
      .select("*")
      .eq("id", scenario.paymentId)
      .single();
    expect(payment?.razorpay_payment_status).toBe("captured");
    expect(payment?.captured_at).not.toBeNull();

    const { data: attempt } = await client
      .from("payment_attempts")
      .select("*")
      .eq("id", scenario.attemptId)
      .single();
    expect(attempt?.status).toBe("CAPTURED");

    const { data: order } = await client
      .from("orders")
      .select("*")
      .eq("id", scenario.orderId)
      .single();
    expect(order?.payment_status).toBe("PAID");
    expect(order?.business_status).toBe("FULFILLED");

    const fulfilment = await fulfilmentForOrder(scenario.orderId);
    expect(fulfilment).not.toBeNull();
    outstandingFulfilmentIds.push(fulfilment!.id);

    const { count } = await client
      .from("fulfilments")
      .select("id", { count: "exact", head: true })
      .eq("order_id", scenario.orderId);
    expect(count).toBe(1);
  });

  it("the same race run in the OPPOSITE Promise.all order still converges to CAPTURED (order-independence, not a lucky ordering)", async () => {
    const scenario = await buildCaptureScenario();
    const failedWebhookEventId = await createFailedWebhookEventForScenario(
      scenario,
      "concurrency-failed-reversed",
    );
    const failedAttemptId = await createProcessingAttempt({
      webhookEventId: failedWebhookEventId,
      paymentAttemptId: scenario.attemptId,
      paymentId: scenario.paymentId,
      normalizedEvent: normalizedFailed({
        razorpayOrderId: scenario.razorpayOrderId,
        razorpayPaymentId: scenario.razorpayPaymentId,
        amountSubunits: scenario.amountSubunits,
        currency: scenario.currency,
      }),
    });

    const [failedResult, capturedResult] = await Promise.all([
      client.rpc("process_webhook_payment_event", {
        p_processing_attempt_id: failedAttemptId,
      }),
      client.rpc("process_webhook_payment_event", {
        p_processing_attempt_id: scenario.processingAttemptId,
      }),
    ]);
    expect(failedResult.error).toBeNull();
    expect(capturedResult.error).toBeNull();

    const { data: payment } = await client
      .from("payments")
      .select("*")
      .eq("id", scenario.paymentId)
      .single();
    expect(payment?.razorpay_payment_status).toBe("captured");
    expect(payment?.captured_at).not.toBeNull();

    const fulfilment = await fulfilmentForOrder(scenario.orderId);
    if (fulfilment) outstandingFulfilmentIds.push(fulfilment.id);

    const { count } = await client
      .from("fulfilments")
      .select("id", { count: "exact", head: true })
      .eq("order_id", scenario.orderId);
    expect(count).toBe(1);
  });
});

describe("Phase 2F — PROCESSING recovery (real Supabase, Finding C)", () => {
  it("a durably-persisted PROCESSING attempt is safely recoverable — processes through to SUCCEEDED with correct merchant state and exactly one fulfilment", async () => {
    const scenario = await buildCaptureScenario();

    // Simulate a durably-persisted PROCESSING attempt directly (constructed
    // rather than reached via the normal PENDING->PROCESSING transition
    // inside the RPC itself, so this test proves recovery of a row that is
    // ALREADY PROCESSING when the RPC is called, not merely the RPC's own
    // internal transient PROCESSING write). The CHECK constraint on
    // event_processing_attempts.status already permits PROCESSING as a
    // valid value (Phase 2E migration), so this is a legitimately
    // constructible state, not a CHECK-constraint workaround.
    const { error: updateError } = await client
      .from("event_processing_attempts")
      .update({ status: "PROCESSING" })
      .eq("id", scenario.processingAttemptId);
    expect(updateError).toBeNull();

    const { data: beforeCall } = await client
      .from("event_processing_attempts")
      .select("*")
      .eq("id", scenario.processingAttemptId)
      .single();
    expect(beforeCall?.status).toBe("PROCESSING");

    const { data: rpcResult, error } = await client.rpc(
      "process_webhook_payment_event",
      { p_processing_attempt_id: scenario.processingAttemptId },
    );
    expect(error).toBeNull();
    expect((rpcResult as Record<string, unknown>).outcome).toBe("processed");

    const { data: attemptAfter } = await client
      .from("event_processing_attempts")
      .select("*")
      .eq("id", scenario.processingAttemptId)
      .single();
    expect(attemptAfter?.status).toBe("SUCCEEDED");
    expect(attemptAfter?.finished_at).not.toBeNull();

    const { data: payment } = await client
      .from("payments")
      .select("*")
      .eq("id", scenario.paymentId)
      .single();
    expect(payment?.razorpay_payment_status).toBe("captured");

    const { data: order } = await client
      .from("orders")
      .select("*")
      .eq("id", scenario.orderId)
      .single();
    expect(order?.payment_status).toBe("PAID");
    expect(order?.business_status).toBe("FULFILLED");

    const fulfilment = await fulfilmentForOrder(scenario.orderId);
    expect(fulfilment).not.toBeNull();
    outstandingFulfilmentIds.push(fulfilment!.id);

    const { count } = await client
      .from("fulfilments")
      .select("id", { count: "exact", head: true })
      .eq("order_id", scenario.orderId);
    expect(count).toBe(1);
  });

  it("HELD remains rejected as not-ready — non-authoritative, in direct contrast to PROCESSING's recoverability above", async () => {
    const scenario = await buildCaptureScenario();
    const heldAttemptId = await createProcessingAttempt({
      webhookEventId: scenario.webhookEventId,
      paymentAttemptId: scenario.attemptId,
      paymentId: scenario.paymentId,
      normalizedEvent: normalizedCaptured({
        razorpayOrderId: scenario.razorpayOrderId,
        razorpayPaymentId: scenario.razorpayPaymentId,
        amountSubunits: scenario.amountSubunits,
        currency: scenario.currency,
      }),
      status: "HELD",
    });

    const { error } = await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: heldAttemptId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/PROCESSING_ATTEMPT_NOT_READY/);

    const fulfilment = await fulfilmentForOrder(scenario.orderId);
    expect(fulfilment).toBeNull();
  });
});

describe("Phase 2F — fail-closed event contract (real Supabase, Finding B)", () => {
  it("1: wrong normalized sourceKind is rejected with zero mutation (PROCESSING_EVENT_INVALID)", async () => {
    const scenario = await buildCaptureScenario();
    const corrupted: Record<string, unknown> = {
      ...normalizedCaptured({
        razorpayOrderId: scenario.razorpayOrderId,
        razorpayPaymentId: scenario.razorpayPaymentId,
        amountSubunits: scenario.amountSubunits,
        currency: scenario.currency,
      }),
      sourceKind: "PAYCHAOS_REPLAY",
    };
    const attemptId = await createProcessingAttempt({
      webhookEventId: scenario.webhookEventId,
      paymentAttemptId: scenario.attemptId,
      paymentId: scenario.paymentId,
      normalizedEvent: corrupted,
    });

    const { error } = await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: attemptId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/PROCESSING_EVENT_INVALID/);

    const { data: order } = await client
      .from("orders")
      .select("*")
      .eq("id", scenario.orderId)
      .single();
    expect(order?.payment_status).toBe("UNPAID");
    const fulfilment = await fulfilmentForOrder(scenario.orderId);
    expect(fulfilment).toBeNull();
  });

  it("2: missing eventType is rejected with zero mutation (PROCESSING_EVENT_INVALID)", async () => {
    const scenario = await buildCaptureScenario();
    const corrupted: Record<string, unknown> = normalizedCaptured({
      razorpayOrderId: scenario.razorpayOrderId,
      razorpayPaymentId: scenario.razorpayPaymentId,
      amountSubunits: scenario.amountSubunits,
      currency: scenario.currency,
    });
    delete corrupted.eventType;
    const attemptId = await createProcessingAttempt({
      webhookEventId: scenario.webhookEventId,
      paymentAttemptId: scenario.attemptId,
      paymentId: scenario.paymentId,
      normalizedEvent: corrupted,
    });

    const { error } = await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: attemptId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/PROCESSING_EVENT_INVALID/);

    const fulfilment = await fulfilmentForOrder(scenario.orderId);
    expect(fulfilment).toBeNull();
  });

  it("3: eventType != kind is rejected with zero mutation (PROCESSING_EVENT_INVALID)", async () => {
    const scenario = await buildCaptureScenario();
    const corrupted: Record<string, unknown> = {
      ...normalizedCaptured({
        razorpayOrderId: scenario.razorpayOrderId,
        razorpayPaymentId: scenario.razorpayPaymentId,
        amountSubunits: scenario.amountSubunits,
        currency: scenario.currency,
      }),
      eventType: "payment.failed",
      // kind stays "payment.captured" from normalizedCaptured() above — a
      // genuine kind/eventType disagreement.
    };
    const attemptId = await createProcessingAttempt({
      webhookEventId: scenario.webhookEventId,
      paymentAttemptId: scenario.attemptId,
      paymentId: scenario.paymentId,
      normalizedEvent: corrupted,
    });

    const { error } = await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: attemptId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/PROCESSING_EVENT_INVALID/);

    const fulfilment = await fulfilmentForOrder(scenario.orderId);
    expect(fulfilment).toBeNull();
  });

  it("4: unknown/unsupported kind is rejected with zero mutation (PROCESSING_EVENT_INVALID) — never falls through to order.paid authority", async () => {
    const scenario = await buildCaptureScenario();
    const corrupted: Record<string, unknown> = {
      ...normalizedCaptured({
        razorpayOrderId: scenario.razorpayOrderId,
        razorpayPaymentId: scenario.razorpayPaymentId,
        amountSubunits: scenario.amountSubunits,
        currency: scenario.currency,
      }),
      kind: "payment.refunded",
    };
    const attemptId = await createProcessingAttempt({
      webhookEventId: scenario.webhookEventId,
      paymentAttemptId: scenario.attemptId,
      paymentId: scenario.paymentId,
      normalizedEvent: corrupted,
    });

    const { error } = await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: attemptId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/PROCESSING_EVENT_INVALID/);

    // Critically: the payment attempt must NOT have been treated as
    // order.paid evidence — proves there is no catch-all-ELSE-as-order.paid
    // path (Finding B).
    const { data: attemptRow } = await client
      .from("payment_attempts")
      .select("*")
      .eq("id", scenario.attemptId)
      .single();
    expect(attemptRow?.razorpay_order_status).not.toBe("paid");
    const fulfilment = await fulfilmentForOrder(scenario.orderId);
    expect(fulfilment).toBeNull();
  });

  it("5: webhook event_type disagreeing with the normalized eventType is rejected with zero mutation (PROCESSING_CORRELATION_INVALID)", async () => {
    const scenario = await buildCaptureScenario();
    // A dedicated webhook_events row whose event_type is payment.failed,
    // but every OTHER derived field (order/payment/amount/currency)
    // matches scenario — paired with a processing attempt whose normalized
    // event is internally self-consistent (kind == eventType ==
    // payment.captured) but disagrees with THIS webhook row's event_type.
    const mismatchedWebhookEventId = await createWebhookEvent(
      "payment.failed",
      "event-type-mismatch",
      {
        razorpayOrderId: scenario.razorpayOrderId,
        razorpayPaymentId: scenario.razorpayPaymentId,
        paymentAttemptId: scenario.attemptId,
        paymentId: scenario.paymentId,
        amountSubunits: scenario.amountSubunits,
        currency: scenario.currency,
        razorpayPaymentStatus: "failed",
      },
    );
    const attemptId = await createProcessingAttempt({
      webhookEventId: mismatchedWebhookEventId,
      paymentAttemptId: scenario.attemptId,
      paymentId: scenario.paymentId,
      normalizedEvent: normalizedCaptured({
        razorpayOrderId: scenario.razorpayOrderId,
        razorpayPaymentId: scenario.razorpayPaymentId,
        amountSubunits: scenario.amountSubunits,
        currency: scenario.currency,
      }),
    });

    const { error } = await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: attemptId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/PROCESSING_CORRELATION_INVALID/);

    const { data: payment } = await client
      .from("payments")
      .select("*")
      .eq("id", scenario.paymentId)
      .single();
    expect(payment?.razorpay_payment_status).toBeNull();
    const fulfilment = await fulfilmentForOrder(scenario.orderId);
    expect(fulfilment).toBeNull();
  });

  it("6: webhook payment_attempt_id correlation mismatch is rejected with zero mutation (PROCESSING_CORRELATION_INVALID)", async () => {
    const scenarioA = await buildCaptureScenario();
    const scenarioB = await buildCaptureScenario();

    // A webhook_events row whose derived payment_attempt_id points at
    // scenario B's attempt, but the processing attempt itself correlates
    // to scenario A's attempt/payment/normalized evidence.
    const mismatchedWebhookEventId = await createWebhookEvent(
      "payment.captured",
      "payment-attempt-correlation-mismatch",
      {
        razorpayOrderId: scenarioA.razorpayOrderId,
        razorpayPaymentId: scenarioA.razorpayPaymentId,
        paymentAttemptId: scenarioB.attemptId,
        paymentId: scenarioA.paymentId,
        amountSubunits: scenarioA.amountSubunits,
        currency: scenarioA.currency,
        razorpayPaymentStatus: "captured",
      },
    );
    const attemptId = await createProcessingAttempt({
      webhookEventId: mismatchedWebhookEventId,
      paymentAttemptId: scenarioA.attemptId,
      paymentId: scenarioA.paymentId,
      normalizedEvent: normalizedCaptured({
        razorpayOrderId: scenarioA.razorpayOrderId,
        razorpayPaymentId: scenarioA.razorpayPaymentId,
        amountSubunits: scenarioA.amountSubunits,
        currency: scenarioA.currency,
      }),
    });

    const { error } = await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: attemptId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/PROCESSING_CORRELATION_INVALID/);

    const fulfilmentA = await fulfilmentForOrder(scenarioA.orderId);
    const fulfilmentB = await fulfilmentForOrder(scenarioB.orderId);
    expect(fulfilmentA).toBeNull();
    expect(fulfilmentB).toBeNull();
  });

  it("7: webhook payment_id correlation mismatch is rejected with zero mutation (PROCESSING_CORRELATION_INVALID)", async () => {
    const scenarioA = await buildCaptureScenario();
    const scenarioB = await buildCaptureScenario();

    // A webhook_events row whose derived payment_id points at scenario B's
    // payment, but the processing attempt itself correlates to scenario
    // A's payment/attempt/normalized evidence.
    const mismatchedWebhookEventId = await createWebhookEvent(
      "payment.captured",
      "payment-correlation-mismatch",
      {
        razorpayOrderId: scenarioA.razorpayOrderId,
        razorpayPaymentId: scenarioA.razorpayPaymentId,
        paymentAttemptId: scenarioA.attemptId,
        paymentId: scenarioB.paymentId,
        amountSubunits: scenarioA.amountSubunits,
        currency: scenarioA.currency,
        razorpayPaymentStatus: "captured",
      },
    );
    const attemptId = await createProcessingAttempt({
      webhookEventId: mismatchedWebhookEventId,
      paymentAttemptId: scenarioA.attemptId,
      paymentId: scenarioA.paymentId,
      normalizedEvent: normalizedCaptured({
        razorpayOrderId: scenarioA.razorpayOrderId,
        razorpayPaymentId: scenarioA.razorpayPaymentId,
        amountSubunits: scenarioA.amountSubunits,
        currency: scenarioA.currency,
      }),
    });

    const { error } = await client.rpc("process_webhook_payment_event", {
      p_processing_attempt_id: attemptId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/PROCESSING_CORRELATION_INVALID/);

    const fulfilmentA = await fulfilmentForOrder(scenarioA.orderId);
    const fulfilmentB = await fulfilmentForOrder(scenarioB.orderId);
    expect(fulfilmentA).toBeNull();
    expect(fulfilmentB).toBeNull();
  });
});

describe("Phase 2F — historical real Phase 2C payment remains unchanged", () => {
  it("the known manually-verified Phase 2C row is untouched by this file's synthetic tests", async () => {
    const { data: order, error } = await client
      .from("orders")
      .select("*")
      .eq("id", "eabed2c4-5d48-4f20-8cc9-67248564648a")
      .maybeSingle();
    expect(error).toBeNull();
    if (order) {
      expect(order.payment_status).toBe("UNPAID");
      expect(order.business_status).toBe("OPEN");
    }

    const { data: payment } = await client
      .from("payments")
      .select("*")
      .eq("razorpay_payment_id", "pay_TTcbVd43PMN79M")
      .maybeSingle();
    if (payment) {
      expect(payment.razorpay_payment_status).toBeNull();
      expect(payment.captured_at).toBeNull();
      expect(payment.failed_at).toBeNull();
    }
  });
});

/**
 * Chunked batch delete, rather than one `DELETE ... WHERE id = $1` network
 * round trip per row. This file's Phase 2F architect-review correction
 * added many more scenarios (concurrency/PROCESSING-recovery/corruption
 * tests, each building a full order->attempt->payment->webhook_event->
 * processing_attempt chain) than the original candidate had, which made
 * the original one-row-per-`await` cleanup loop exceed this suite's
 * 30-second `hookTimeout` (vitest.integration.config.ts) purely on network
 * round-trip count, not on any real defect. `.in("id", chunk)` deletes up
 * to `CHUNK_SIZE` rows per round trip instead.
 */
const CLEANUP_CHUNK_SIZE = 50;

async function batchDelete(
  table:
    | "fulfilments"
    | "event_processing_attempts"
    | "webhook_events"
    | "payments"
    | "payment_attempts"
    | "orders",
  ids: readonly string[],
): Promise<void> {
  for (let i = 0; i < ids.length; i += CLEANUP_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CLEANUP_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    await client.from(table).delete().in("id", chunk);
  }
}

afterAll(async () => {
  // Reverse dependency order — 81-84: cleanup deletes only exact
  // synthetic/tagged rows created by THIS file.
  await batchDelete("fulfilments", outstandingFulfilmentIds);
  await batchDelete(
    "event_processing_attempts",
    outstandingProcessingAttemptIds,
  );
  await batchDelete("webhook_events", outstandingWebhookEventIds);
  await batchDelete("payments", outstandingPaymentIds);
  await batchDelete("payment_attempts", outstandingAttemptIds);
  await batchDelete("orders", outstandingOrderIds);

  // 82-84: independently re-verify via a real SELECT that no synthetic
  // evidence from this file remains.
  const { count: remainingFulfilments } = await client
    .from("fulfilments")
    .select("id", { count: "exact", head: true })
    .in(
      "id",
      outstandingFulfilmentIds.length ? outstandingFulfilmentIds : [""],
    );
  expect(remainingFulfilments).toBe(0);

  const { count: remainingAttempts } = await client
    .from("event_processing_attempts")
    .select("id", { count: "exact", head: true })
    .in(
      "id",
      outstandingProcessingAttemptIds.length
        ? outstandingProcessingAttemptIds
        : [""],
    );
  expect(remainingAttempts).toBe(0);

  const { count: remainingWebhookEvents } = await client
    .from("webhook_events")
    .select("id", { count: "exact", head: true })
    .in(
      "id",
      outstandingWebhookEventIds.length ? outstandingWebhookEventIds : [""],
    );
  expect(remainingWebhookEvents).toBe(0);
}, 120_000);
