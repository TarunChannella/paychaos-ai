import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { captureC03MutationSnapshot } from "@/lib/chaos/c03-mutation-snapshot-repository";
import { loadChaosRunEvidenceSource } from "@/lib/evidence/chaos-evidence-repository";
import { assembleChaosRunEvidence } from "@/lib/evidence/chaos-evidence-service";

import { taggedValue, trackAttempt, trackOrder } from "./helpers";

/**
 * Phase 3F EVIDENCE-COMPATIBILITY CORRECTION — proves the two new evidence
 * surfaces against the REAL Supabase project:
 *
 *   1. the C03 mutation snapshot (`lib/chaos/c03-mutation-snapshot.ts`,
 *      `lib/chaos/c03-mutation-snapshot-repository.ts`), which supplies the
 *      before/after inputs docs/MONEY_INVARIANTS.md INV-005 §6 requires;
 *   2. the trusted webhook money projection and the AUTHORITATIVE CAPTURE
 *      SEARCH added to `lib/evidence/chaos-evidence-repository.ts` /
 *      `lib/evidence/chaos-run-evidence.ts`, which supply INV-008 §8's
 *      webhook clause and INV-003/INV-004/INV-010's captured-payment basis.
 *
 * This correction introduces NO migration and NO new table, so this file is
 * runnable immediately against the already-applied Phase 3E-A schema.
 *
 * ============================================================================
 * PROVENANCE DISCIPLINE — identical to 053/057/058/059/060/061
 * ============================================================================
 *
 *   1. Every `chaos_runs` row this file creates is `data_classification =
 *      SYNTHETIC_DEMO`. This file never calls `createChaosRun`/
 *      `runChaosPrecheck`, never calls a production chaos EXECUTION service,
 *      and never invokes a chaos HTTP route.
 *   2. `webhook_events.source_kind = REAL_RAZORPAY_WEBHOOK` on the rows this
 *      file inserts is a SYNTHETIC CANONICAL COMPATIBILITY VALUE, required
 *      only because the schema's CHECK constraint accepts no other literal.
 *      It is NOT genuine provider evidence and must never be described as
 *      such.
 *   3. No Razorpay API call, no Razorpay Dashboard action and no real payment
 *      is involved anywhere in this file.
 *
 * ============================================================================
 * NO INVARIANT VERDICT IS ASSERTED ANYWHERE
 * ============================================================================
 *
 * Every assertion is about FACTS: which rows exist, how they correlate, what
 * provenance they carry, and which factual inputs are present or missing.
 * Nothing here asserts a money PASS/FAIL — this layer assigns none.
 *
 * ============================================================================
 * HISTORICAL EVIDENCE IS READ-ONLY HERE
 * ============================================================================
 *
 * The Phase 3D manually-verified C03/C07/C11 evidence already living in this
 * project must never be mutated. `beforeAll` records every PRE-EXISTING
 * `chaos_runs.fault_state` and every `event_processing_attempts`
 * `state_before`/`state_after` BEFORE creating anything, and `afterAll`
 * re-reads them and asserts byte-identical values — an independent proof that
 * nothing was backfilled or rewritten, not an assumption.
 */

const client = getSupabaseServerClient();

const outstandingAttemptIds: string[] = [];
const outstandingChaosRunIds: string[] = [];
const outstandingWebhookEventIds: string[] = [];
const outstandingPaymentIds: string[] = [];
const outstandingPaymentAttemptIds: string[] = [];
const outstandingOrderIds: string[] = [];

/** id -> JSON of `{ state_before, state_after }` for every attempt that existed BEFORE this file ran. */
const preExistingAttemptEvidence = new Map<string, string>();
/** id -> JSON of `fault_state` for every chaos run that existed BEFORE this file ran. */
const preExistingChaosRunFaultState = new Map<string, string>();

function fakeSha256Hex(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

interface CaptureFixture {
  orderId: string;
  paymentAttemptId: string;
  paymentId: string;
  razorpayPaymentId: string;
  amountSubunits: number;
}

/** Creates a self-consistent SYNTHETIC order -> attempt -> payment chain. */
async function createMerchantChain(label: string): Promise<CaptureFixture> {
  const amountSubunits = 75_000;
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
  trackOrder(order!.id);
  outstandingOrderIds.push(order!.id);

  const { data: attempt, error: attemptError } = await client
    .from("payment_attempts")
    .insert({
      order_id: order!.id,
      attempt_no: 1,
      amount_subunits: amountSubunits,
      currency: "INR",
      razorpay_receipt: taggedValue(`${label}-receipt`),
      razorpay_order_id: taggedValue(`${label}-order`),
    })
    .select()
    .single();
  expect(attemptError).toBeNull();
  trackAttempt(attempt!.id);
  outstandingPaymentAttemptIds.push(attempt!.id);

  const { data: payment, error: paymentError } = await client
    .from("payments")
    .insert({
      payment_attempt_id: attempt!.id,
      razorpay_payment_id: razorpayPaymentId,
      amount_subunits: amountSubunits,
      currency: "INR",
    })
    .select()
    .single();
  expect(paymentError).toBeNull();
  outstandingPaymentIds.push(payment!.id);

  return {
    orderId: order!.id,
    paymentAttemptId: attempt!.id,
    paymentId: payment!.id,
    razorpayPaymentId,
    amountSubunits,
  };
}

interface WebhookInput {
  label: string;
  eventType: "payment.captured" | "payment.failed";
  razorpayPaymentId: string | null;
  paymentAttemptId: string | null;
  paymentId: string | null;
  amountSubunits: number | null;
  currency: string | null;
}

async function createWebhookEvent(input: WebhookInput): Promise<string> {
  const { data, error } = await client
    .from("webhook_events")
    .insert({
      razorpay_event_id: taggedValue(`${input.label}-event`),
      event_type: input.eventType,
      signature_verified: true,
      razorpay_payment_id: input.razorpayPaymentId,
      payment_attempt_id: input.paymentAttemptId,
      payment_id: input.paymentId,
      amount_subunits: input.amountSubunits,
      currency: input.currency,
      raw_body_sha256: fakeSha256Hex(`${input.label}-${randomUUID()}`),
      raw_payload_redacted: { event: input.eventType, synthetic: true },
    })
    .select()
    .single();
  expect(error).toBeNull();
  outstandingWebhookEventIds.push(data!.id);
  return data!.id;
}

async function createSyntheticChaosRun(input: {
  scenarioId: "C01" | "C03" | "C07" | "C11";
  faultType: "REPLAY_EVENT" | "INVALID_SIGNATURE_TEST" | null;
  faultState: Record<string, unknown>;
  orderId?: string | null;
  paymentAttemptId?: string | null;
  paymentId?: string | null;
  sourceWebhookEventId?: string | null;
}): Promise<string> {
  const { data, error } = await client
    .from("chaos_runs")
    .insert({
      scenario_id: input.scenarioId,
      order_id: input.orderId ?? null,
      payment_attempt_id: input.paymentAttemptId ?? null,
      payment_id: input.paymentId ?? null,
      source_webhook_event_id: input.sourceWebhookEventId ?? null,
      status: "COMPLETED",
      outcome: "UNKNOWN",
      fault_type: input.faultType,
      failed_precheck_id: null,
      execution_block_code: null,
      fault_config: {},
      fault_state: input.faultState,
      data_classification: "SYNTHETIC_DEMO",
      error_message_redacted: null,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .select()
    .single();
  expect(error).toBeNull();
  expect(data!.data_classification).toBe("SYNTHETIC_DEMO");
  outstandingChaosRunIds.push(data!.id);
  return data!.id;
}

beforeAll(async () => {
  const { data: attempts, error: attemptsError } = await client
    .from("event_processing_attempts")
    .select("id, state_before, state_after");
  expect(attemptsError).toBeNull();
  for (const row of attempts ?? []) {
    preExistingAttemptEvidence.set(
      row.id,
      JSON.stringify({
        state_before: row.state_before,
        state_after: row.state_after,
      }),
    );
  }

  const { data: runs, error: runsError } = await client
    .from("chaos_runs")
    .select("id, fault_state");
  expect(runsError).toBeNull();
  for (const row of runs ?? []) {
    preExistingChaosRunFaultState.set(row.id, JSON.stringify(row.fault_state));
  }
});

describe("062-A: C03 mutation snapshot against the real database", () => {
  it("A1: captures a well-formed, versioned snapshot of all five INV-005 tables", async () => {
    const snapshot = await captureC03MutationSnapshot();

    expect(snapshot.version).toBe(1);
    for (const collection of [
      snapshot.orders,
      snapshot.paymentAttempts,
      snapshot.payments,
      snapshot.fulfilments,
    ]) {
      expect(collection).not.toBeNull();
      expect(typeof collection!.count).toBe("number");
      expect(Number.isInteger(collection!.count)).toBe(true);
      expect(typeof collection!.complete).toBe("boolean");
      expect(Array.isArray(collection!.rows)).toBe(true);
    }
    expect(snapshot.trustedWebhookEvents).not.toBeNull();
    expect(Array.isArray(snapshot.trustedWebhookEvents!.ids)).toBe(true);
  });

  it("A2: rows are deterministically ordered by internal UUID", async () => {
    const snapshot = await captureC03MutationSnapshot();
    const ids = snapshot.orders!.rows.map((r) => r.id);
    expect(ids).toEqual([...ids].sort());
    const webhookIds = snapshot.trustedWebhookEvents!.ids;
    expect(webhookIds).toEqual([...webhookIds].sort());
  });

  it("A3: capturing twice with no intervening write yields a deep-equal snapshot", async () => {
    const first = await captureC03MutationSnapshot();
    const second = await captureC03MutationSnapshot();
    expect(second).toEqual(first);
  });

  it("A4: the capture itself performs ZERO business mutation", async () => {
    async function countsNow() {
      const tables = [
        "orders",
        "payment_attempts",
        "payments",
        "fulfilments",
        "webhook_events",
        "event_processing_attempts",
        "chaos_runs",
      ] as const;
      const out: Record<string, number | null> = {};
      for (const table of tables) {
        const { count } = await client
          .from(table)
          .select("id", { count: "exact", head: true });
        out[table] = count ?? null;
      }
      return out;
    }

    const before = await countsNow();
    await captureC03MutationSnapshot();
    await captureC03MutationSnapshot();
    const after = await countsNow();

    expect(after).toEqual(before);
  });

  it("A5: a real business-state change IS detectable between two captures, with the row count unchanged", async () => {
    const fixture = await createMerchantChain("c03-mutation");

    const before = await captureC03MutationSnapshot();
    const beforeOrder = before.orders!.rows.find(
      (r) => r.id === fixture.orderId,
    );
    expect(beforeOrder?.paymentStatus).toBe("UNPAID");

    // Mutate ONLY this test's own order — never demo or historical evidence.
    const { error } = await client
      .from("orders")
      .update({ payment_status: "PENDING" })
      .eq("id", fixture.orderId);
    expect(error).toBeNull();

    const after = await captureC03MutationSnapshot();
    const afterOrder = after.orders!.rows.find((r) => r.id === fixture.orderId);
    expect(afterOrder?.paymentStatus).toBe("PENDING");

    // The row COUNT is identical — a count-only snapshot would have missed
    // this entirely, which is exactly why full row-state is recorded.
    expect(after.orders!.count).toBe(before.orders!.count);
  });

  it("A6: the snapshot carries no payload, signature, secret, PII or idempotency key", async () => {
    const snapshot = await captureC03MutationSnapshot();
    const json = JSON.stringify(snapshot).toLowerCase();
    for (const needle of [
      "raw_payload",
      "rawpayload",
      "raw_body",
      "rawbody",
      "normalized_event",
      "normalizedevent",
      "signature_value",
      "secret",
      "idempotency",
      "cvv",
      "otp",
      "@",
    ]) {
      expect(json).not.toContain(needle);
    }
  });
});

describe("062-B: C03 evidence assembly — corrected vs historical shape", () => {
  it("B1: a C03 run carrying mutationEvidence exposes it as validated evidence with no missing-evidence gap", async () => {
    const snapshot = await captureC03MutationSnapshot();
    const serializedSide = JSON.parse(
      JSON.stringify({
        version: 1,
        orders: snapshot.orders,
        paymentAttempts: snapshot.paymentAttempts,
        payments: snapshot.payments,
        fulfilments: snapshot.fulfilments,
        trustedWebhookEvents: snapshot.trustedWebhookEvents,
      }),
    );

    const runId = await createSyntheticChaosRun({
      scenarioId: "C03",
      faultType: "INVALID_SIGNATURE_TEST",
      faultState: {
        checks: [
          { case: "WRONG_SIGNATURE", classification: "REJECTED" },
          { case: "MISSING_SIGNATURE", classification: "REJECTED" },
        ],
        mutationEvidence: {
          version: 1,
          before: serializedSide,
          after: serializedSide,
        },
      },
    });

    const bundle = await assembleChaosRunEvidence(runId);
    expect(bundle).not.toBeNull();
    const scenario = bundle!.scenarioEvidence as {
      scenarioId: string;
      mutationEvidence: unknown;
    };
    expect(scenario.scenarioId).toBe("C03");
    expect(scenario.mutationEvidence).not.toBeNull();
    expect(bundle!.gaps.map((g) => g.code)).not.toContain(
      "MISSING_C03_MUTATION_EVIDENCE",
    );
    expect(bundle!.gaps.map((g) => g.code)).not.toContain(
      "INVALID_C03_MUTATION_EVIDENCE",
    );
    // Still no verdict anywhere.
    expect(JSON.stringify(bundle)).not.toContain('"FAIL"');
  });

  it("B2: a LEGACY checks-only C03 run stays truthfully missing — never reconstructed from today's state", async () => {
    const runId = await createSyntheticChaosRun({
      scenarioId: "C03",
      faultType: "INVALID_SIGNATURE_TEST",
      faultState: {
        checks: [
          { case: "WRONG_SIGNATURE", classification: "REJECTED" },
          { case: "MISSING_SIGNATURE", classification: "REJECTED" },
        ],
      },
    });

    const bundle = await assembleChaosRunEvidence(runId);
    const scenario = bundle!.scenarioEvidence as {
      mutationEvidence: unknown;
      verificationChecks: unknown;
    };
    expect(scenario.mutationEvidence).toBeNull();
    expect(scenario.verificationChecks).not.toBeNull();
    expect(bundle!.gaps.map((g) => g.code)).toContain(
      "MISSING_C03_MUTATION_EVIDENCE",
    );

    // Independent proof of no backfill: the durable row is still legacy.
    const { data } = await client
      .from("chaos_runs")
      .select("fault_state")
      .eq("id", runId)
      .single();
    expect(Object.keys(data!.fault_state as object)).toEqual(["checks"]);
  });
});

describe("062-C: trusted webhook money projection (INV-008)", () => {
  it("C1: amount_subunits and currency are projected exactly from the persisted columns", async () => {
    const fixture = await createMerchantChain("inv008");
    const webhookId = await createWebhookEvent({
      label: "inv008-captured",
      eventType: "payment.captured",
      razorpayPaymentId: fixture.razorpayPaymentId,
      paymentAttemptId: fixture.paymentAttemptId,
      paymentId: fixture.paymentId,
      amountSubunits: fixture.amountSubunits,
      currency: "INR",
    });
    const runId = await createSyntheticChaosRun({
      scenarioId: "C01",
      faultType: "REPLAY_EVENT",
      faultState: {},
      orderId: fixture.orderId,
      paymentAttemptId: fixture.paymentAttemptId,
      paymentId: fixture.paymentId,
      sourceWebhookEventId: webhookId,
    });

    const bundle = await assembleChaosRunEvidence(runId);
    expect(bundle!.sourceWebhook!.amountSubunits).toBe(75_000);
    expect(bundle!.sourceWebhook!.currency).toBe("INR");
    expect(bundle!.sourceWebhook!.razorpayPaymentId).toBe(
      fixture.razorpayPaymentId,
    );
    expect(Number.isInteger(bundle!.sourceWebhook!.amountSubunits)).toBe(true);
  });

  it("C2: NULL money columns are preserved as null, never defaulted", async () => {
    const fixture = await createMerchantChain("inv008-null");
    const webhookId = await createWebhookEvent({
      label: "inv008-null-captured",
      eventType: "payment.captured",
      razorpayPaymentId: fixture.razorpayPaymentId,
      paymentAttemptId: fixture.paymentAttemptId,
      paymentId: fixture.paymentId,
      amountSubunits: null,
      currency: null,
    });
    const runId = await createSyntheticChaosRun({
      scenarioId: "C01",
      faultType: "REPLAY_EVENT",
      faultState: {},
      orderId: fixture.orderId,
      paymentAttemptId: fixture.paymentAttemptId,
      paymentId: fixture.paymentId,
      sourceWebhookEventId: webhookId,
    });

    const bundle = await assembleChaosRunEvidence(runId);
    expect(bundle!.sourceWebhook!.amountSubunits).toBeNull();
    expect(bundle!.sourceWebhook!.currency).toBeNull();
  });

  it("C3: no normalized_event or raw payload reaches the assembled bundle", async () => {
    const fixture = await createMerchantChain("inv008-leak");
    const webhookId = await createWebhookEvent({
      label: "inv008-leak-captured",
      eventType: "payment.captured",
      razorpayPaymentId: fixture.razorpayPaymentId,
      paymentAttemptId: fixture.paymentAttemptId,
      paymentId: fixture.paymentId,
      amountSubunits: fixture.amountSubunits,
      currency: "INR",
    });
    const runId = await createSyntheticChaosRun({
      scenarioId: "C01",
      faultType: "REPLAY_EVENT",
      faultState: {},
      orderId: fixture.orderId,
      paymentAttemptId: fixture.paymentAttemptId,
      paymentId: fixture.paymentId,
      sourceWebhookEventId: webhookId,
    });

    const json = JSON.stringify(await assembleChaosRunEvidence(runId));
    expect(json).not.toContain("normalizedEvent");
    expect(json).not.toContain("normalized_event");
    expect(json).not.toContain("raw_payload_redacted");
    expect(json).not.toContain("rawBodySha256");
  });
});

describe("062-D: authoritative capture search against the real database", () => {
  /** Builds a C11-shaped run whose SOURCE is `payment.failed` for the given payment. */
  async function makeFailedSourceRun(fixture: CaptureFixture, label: string) {
    const failedWebhookId = await createWebhookEvent({
      label: `${label}-failed`,
      eventType: "payment.failed",
      razorpayPaymentId: fixture.razorpayPaymentId,
      paymentAttemptId: fixture.paymentAttemptId,
      paymentId: fixture.paymentId,
      amountSubunits: fixture.amountSubunits,
      currency: "INR",
    });
    const runId = await createSyntheticChaosRun({
      scenarioId: "C11",
      faultType: null,
      faultState: {},
      orderId: fixture.orderId,
      paymentAttemptId: fixture.paymentAttemptId,
      paymentId: fixture.paymentId,
      sourceWebhookEventId: failedWebhookId,
    });
    return { runId, failedWebhookId };
  }

  it("D1: zero capture events for the exact trusted identity resolves NONE_OBSERVED with no gap", async () => {
    const fixture = await createMerchantChain("cap-none");
    const { runId, failedWebhookId } = await makeFailedSourceRun(
      fixture,
      "cap-none",
    );

    const bundle = await assembleChaosRunEvidence(runId);
    expect(bundle!.authoritativeCapture.kind).toBe("NONE_OBSERVED");
    expect(bundle!.authoritativeCaptureWebhook).toBeNull();
    // The failure source is untouched and still the source webhook.
    expect(bundle!.sourceWebhook!.id).toBe(failedWebhookId);
    expect(bundle!.sourceWebhook!.eventType).toBe("payment.failed");
    const codes = bundle!.gaps.map((g) => g.code);
    expect(codes).not.toContain("INCOMPLETE_CAPTURE_SEARCH");
    expect(codes).not.toContain("MISSING_CAPTURE_SEARCH_SUBJECT");
  });

  it("D2: exactly one verified capture correlated to the internal payment resolves EXACTLY_ONE", async () => {
    const fixture = await createMerchantChain("cap-one");
    const { runId } = await makeFailedSourceRun(fixture, "cap-one");
    const captureId = await createWebhookEvent({
      label: "cap-one-captured",
      eventType: "payment.captured",
      razorpayPaymentId: fixture.razorpayPaymentId,
      paymentAttemptId: fixture.paymentAttemptId,
      paymentId: fixture.paymentId,
      amountSubunits: fixture.amountSubunits,
      currency: "INR",
    });

    const bundle = await assembleChaosRunEvidence(runId);
    expect(bundle!.authoritativeCapture.kind).toBe("EXACTLY_ONE");
    expect(bundle!.authoritativeCaptureWebhook!.id).toBe(captureId);
    expect(bundle!.authoritativeCaptureWebhook!.eventType).toBe(
      "payment.captured",
    );
    // The payment.failed source is NOT replaced by the capture evidence.
    expect(bundle!.sourceWebhook!.eventType).toBe("payment.failed");
    expect(bundle!.sourceWebhook!.id).not.toBe(captureId);
    // The capture webhook is referenced so it stays traceable.
    expect(
      bundle!.evidenceRefs.some(
        (r) => r.kind === "WEBHOOK_EVENT" && r.id === captureId,
      ),
    ).toBe(true);
  });

  it("D3: a provider-identity match with NO internal correlation stays VISIBLE and never becomes a false NONE_OBSERVED", async () => {
    const fixture = await createMerchantChain("cap-uncorrelated");
    const { runId } = await makeFailedSourceRun(fixture, "cap-uncorrelated");
    // A genuine capture event whose internal `payment_id` correlation is
    // missing — exactly the row an internal-FK-only search would have missed,
    // producing a false "no capture exists" and a false INV-003 finding.
    const captureId = await createWebhookEvent({
      label: "cap-uncorrelated-captured",
      eventType: "payment.captured",
      razorpayPaymentId: fixture.razorpayPaymentId,
      paymentAttemptId: null,
      paymentId: null,
      amountSubunits: fixture.amountSubunits,
      currency: "INR",
    });

    const bundle = await assembleChaosRunEvidence(runId);
    expect(bundle!.authoritativeCapture.kind).toBe(
      "INCOMPLETE_INTERNAL_CORRELATION",
    );
    expect(bundle!.authoritativeCapture.kind).not.toBe("NONE_OBSERVED");
    expect(bundle!.authoritativeCaptureWebhook!.id).toBe(captureId);
    expect(bundle!.gaps.map((g) => g.code)).toContain(
      "INCOMPLETE_CAPTURE_INTERNAL_CORRELATION",
    );
  });

  it("D4: two verified capture candidates resolve AMBIGUOUS — never latest-wins", async () => {
    const fixture = await createMerchantChain("cap-ambiguous");
    const { runId } = await makeFailedSourceRun(fixture, "cap-ambiguous");
    const firstId = await createWebhookEvent({
      label: "cap-ambiguous-a",
      eventType: "payment.captured",
      razorpayPaymentId: fixture.razorpayPaymentId,
      paymentAttemptId: fixture.paymentAttemptId,
      paymentId: fixture.paymentId,
      amountSubunits: fixture.amountSubunits,
      currency: "INR",
    });
    const secondId = await createWebhookEvent({
      label: "cap-ambiguous-b",
      eventType: "payment.captured",
      razorpayPaymentId: fixture.razorpayPaymentId,
      paymentAttemptId: fixture.paymentAttemptId,
      paymentId: fixture.paymentId,
      amountSubunits: fixture.amountSubunits,
      currency: "INR",
    });

    const bundle = await assembleChaosRunEvidence(runId);
    expect(bundle!.authoritativeCapture.kind).toBe("AMBIGUOUS");
    expect(bundle!.authoritativeCaptureWebhook).toBeNull();
    expect(bundle!.gaps.map((g) => g.code)).toContain(
      "AMBIGUOUS_AUTHORITATIVE_CAPTURE_WEBHOOK",
    );
    const refIds = bundle!.evidenceRefs
      .filter((r) => r.kind === "WEBHOOK_EVENT")
      .map((r) => r.id);
    expect(refIds).toContain(firstId);
    expect(refIds).toContain(secondId);
  });

  it("D5: the search uses the EXACT trusted provider identity — a different payment's capture never matches", async () => {
    const subject = await createMerchantChain("cap-exact-subject");
    const other = await createMerchantChain("cap-exact-other");
    const { runId } = await makeFailedSourceRun(subject, "cap-exact");

    // A capture for a DIFFERENT payment must not be picked up.
    await createWebhookEvent({
      label: "cap-exact-other-captured",
      eventType: "payment.captured",
      razorpayPaymentId: other.razorpayPaymentId,
      paymentAttemptId: other.paymentAttemptId,
      paymentId: other.paymentId,
      amountSubunits: other.amountSubunits,
      currency: "INR",
    });

    const bundle = await assembleChaosRunEvidence(runId);
    expect(bundle!.authoritativeCapture.kind).toBe("NONE_OBSERVED");
    expect(bundle!.authoritativeCaptureWebhook).toBeNull();
  });

  it("D6: a run with no trusted provider identity never reports a negative capture result", async () => {
    const fixture = await createMerchantChain("cap-incomplete");
    // A source webhook whose normalized provider identity is missing.
    const webhookId = await createWebhookEvent({
      label: "cap-incomplete-failed",
      eventType: "payment.failed",
      razorpayPaymentId: null,
      paymentAttemptId: fixture.paymentAttemptId,
      paymentId: fixture.paymentId,
      amountSubunits: fixture.amountSubunits,
      currency: "INR",
    });
    const runId = await createSyntheticChaosRun({
      scenarioId: "C11",
      faultType: null,
      faultState: {},
      orderId: fixture.orderId,
      paymentAttemptId: fixture.paymentAttemptId,
      paymentId: fixture.paymentId,
      sourceWebhookEventId: webhookId,
    });

    const bundle = await assembleChaosRunEvidence(runId);
    expect(bundle!.authoritativeCapture.kind).toBe("SEARCH_INCOMPLETE");
    expect(bundle!.authoritativeCapture.kind).not.toBe("NONE_OBSERVED");
    expect(bundle!.gaps.map((g) => g.code)).toContain(
      "INCOMPLETE_CAPTURE_SEARCH",
    );
  });

  it("D7: only REAL_RAZORPAY_WEBHOOK canonical rows can ever be capture evidence — PAYCHAOS_REPLAY is rejected by the schema itself", async () => {
    // Two independent layers reject replay provenance on `webhook_events`:
    //
    //   1. the generated Supabase type narrows `source_kind` to the single
    //      literal "REAL_RAZORPAY_WEBHOOK", so the assignment below does not
    //      typecheck without a deliberate cast (kept, so a future widening of
    //      the type would surface here rather than silently passing);
    //   2. the `webhook_events_source_kind_valid` CHECK constraint, proven
    //      below against the real database.
    //
    // A PAYCHAOS_REPLAY therefore can never be relabelled as provider capture
    // evidence, even by a buggy writer.
    const { error } = await client.from("webhook_events").insert({
      razorpay_event_id: taggedValue("replay-provenance-probe"),
      event_type: "payment.captured",
      source_kind: "PAYCHAOS_REPLAY" as unknown as "REAL_RAZORPAY_WEBHOOK",
      signature_verified: true,
      raw_body_sha256: fakeSha256Hex(`replay-probe-${randomUUID()}`),
      raw_payload_redacted: {},
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/source_kind/i);
  });

  it("D8: a C03 run has no capture subject and emits no capture gap", async () => {
    const runId = await createSyntheticChaosRun({
      scenarioId: "C03",
      faultType: "INVALID_SIGNATURE_TEST",
      faultState: {
        checks: [
          { case: "WRONG_SIGNATURE", classification: "REJECTED" },
          { case: "MISSING_SIGNATURE", classification: "REJECTED" },
        ],
      },
    });
    const bundle = await assembleChaosRunEvidence(runId);
    expect(bundle!.authoritativeCapture.kind).toBe("NO_SUBJECT");
    expect(bundle!.gaps.map((g) => g.code)).not.toContain(
      "MISSING_CAPTURE_SEARCH_SUBJECT",
    );
  });

  it("D9: a run with no source webhook issues NO capture read at all", async () => {
    const fixture = await createMerchantChain("cap-no-source");
    const runId = await createSyntheticChaosRun({
      scenarioId: "C11",
      faultType: null,
      faultState: {},
      orderId: fixture.orderId,
      paymentAttemptId: fixture.paymentAttemptId,
      paymentId: fixture.paymentId,
      sourceWebhookEventId: null,
    });

    const source = await loadChaosRunEvidenceSource(runId);
    expect(source!.captureProviderSearchPerformed).toBe(false);
    expect(source!.captureCandidates).toEqual([]);
    expect(source!.captureSubjectRazorpayPaymentId).toBeNull();

    const bundle = await assembleChaosRunEvidence(runId);
    expect(bundle!.authoritativeCapture.kind).toBe("SEARCH_INCOMPLETE");
  });
});

afterAll(async () => {
  // Exact-ID-scoped cleanup only — never a broad delete. Child-before-parent
  // order: event_processing_attempts -> chaos_runs -> webhook_events ->
  // payments -> payment_attempts -> orders. This file creates no fulfilments.
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

  // ==========================================================================
  // Independent proof that NO historical evidence was mutated or backfilled.
  // ==========================================================================
  const { data: attempts } = await client
    .from("event_processing_attempts")
    .select("id, state_before, state_after");
  for (const row of attempts ?? []) {
    const original = preExistingAttemptEvidence.get(row.id);
    if (original === undefined) continue;
    expect(
      JSON.stringify({
        state_before: row.state_before,
        state_after: row.state_after,
      }),
    ).toBe(original);
  }

  const { data: runs } = await client
    .from("chaos_runs")
    .select("id, fault_state");
  for (const row of runs ?? []) {
    const original = preExistingChaosRunFaultState.get(row.id);
    if (original === undefined) continue;
    // The already-approved historical C03/C07/C11 fault_state must be
    // byte-identical — no mutationEvidence was backfilled into any of them.
    expect(JSON.stringify(row.fault_state)).toBe(original);
  }
});
