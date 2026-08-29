import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { insertReplayProcessingAttempt } from "@/lib/chaos/replay-repository";
import { processMerchantWebhookEvent } from "@/lib/events/processor";
import { assembleChaosRunEvidence } from "@/lib/evidence/chaos-evidence-service";
import { loadChaosRunEvidenceSource } from "@/lib/evidence/chaos-evidence-repository";

import { taggedValue, trackAttempt, trackOrder } from "./helpers";

/**
 * Phase 3E-B — proves the READ-ONLY per-chaos-run EVIDENCE ASSEMBLY
 * MECHANICS (`lib/evidence/chaos-evidence-repository.ts`,
 * `lib/evidence/chaos-evidence-service.ts`,
 * `lib/evidence/chaos-run-evidence.ts`) against the REAL Supabase project.
 *
 * Phase 3E-B introduces NO migration and NO new table, so this file is
 * runnable immediately against the already-applied Phase 3E-A schema.
 *
 * ============================================================================
 * PROVENANCE DISCIPLINE — identical to 053/057/058/059/060, read those files'
 * own module doc comments first if unfamiliar. Three distinct layers, never
 * conflated:
 * ============================================================================
 *
 *   1. This file's own `chaos_runs` rows are ALWAYS `data_classification =
 *      SYNTHETIC_DEMO` — never `RECORDED_TEST_EVIDENCE`. This file never
 *      calls `createChaosRun`/`runChaosPrecheck` or any production
 *      positive-path chaos execution service (`executeC01Replay`,
 *      `executeC03InvalidSignatureTest`, `armC07ClientConfirmationDrop`,
 *      `reconcileC07ClientConfirmationDrop`, `executeC11RealWebhookReplay`,
 *      `startC11AFailureObservation`, `reconcileC11AFailedPaymentObservation`)
 *      and never invokes a chaos HTTP route. Its `chaos_runs` rows are
 *      inserted directly as test-owned mechanics fixtures.
 *   2. `normalized_event.sourceKind = REAL_RAZORPAY_WEBHOOK` describes the
 *      provenance the merchant-processing transaction requires of the
 *      underlying evidence; it is not a claim that this test execution is a
 *      genuine provider delivery.
 *   3. `webhook_events.source_kind = REAL_RAZORPAY_WEBHOOK` and the ORIGINAL
 *      `event_processing_attempts.source_kind = REAL_RAZORPAY_WEBHOOK` on the
 *      rows this file inserts are SYNTHETIC CANONICAL COMPATIBILITY ROWS,
 *      required only because the schema accepts no other literal for those
 *      columns, and run through the real unmodified
 *      `processMerchantWebhookEvent` purely to reach a genuine SUCCEEDED
 *      state with genuine persisted `MerchantStateSnapshotV1` evidence.
 *      They are NOT genuine provider evidence and must never be described as
 *      such. Deleted unconditionally in `afterAll`.
 *
 * This file NEVER claims a genuine positive chaos-scenario execution, and
 * never claims genuine Razorpay delivery evidence. It is SYNTHETIC
 * REAL-DATABASE MECHANICS VERIFICATION.
 * `tests/unit/supabase/061-phase3e-chaos-evidence-provenance-guard.test.ts`
 * statically enforces the rules above.
 *
 * ============================================================================
 * HISTORICAL EVIDENCE IS READ-ONLY HERE
 * ============================================================================
 *
 * Phase 3D's manually-verified `chaos_runs`/`event_processing_attempts`
 * evidence already living in this project must never be mutated or deleted by
 * this suite. `beforeAll` records every PRE-EXISTING
 * `event_processing_attempts` row's id plus its `state_before`/`state_after`
 * values BEFORE creating anything, and `afterAll` re-reads them and asserts
 * byte-identical values — an independent proof, not an assumption.
 *
 * ============================================================================
 * NO INVARIANT VERDICT IS ASSERTED ANYWHERE
 * ============================================================================
 *
 * Every assertion below is about FACTS: which rows exist, how they correlate,
 * what provenance they carry, which snapshots were durably captured, and
 * which factual inputs are missing. Nothing here asserts a money PASS/FAIL —
 * Phase 3E-B assigns none.
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

type SyntheticEventType = "payment.captured" | "payment.failed";

interface SyntheticFixture {
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
 * Builds one complete, self-consistent SYNTHETIC merchant fixture — order ->
 * payment_attempt -> payments -> webhook_events -> the ORIGINAL
 * `event_processing_attempts` row — and drives that original attempt through
 * the real, unmodified `processMerchantWebhookEvent` so it reaches genuine
 * SUCCEEDED status with genuine persisted `state_before`/`state_after`
 * snapshots. Never genuine Razorpay evidence: see the module doc comment.
 */
async function createSyntheticFixture(
  label: string,
  eventType: SyntheticEventType,
): Promise<SyntheticFixture> {
  const amountSubunits = 75_000;
  const razorpayOrderId = taggedValue(`${label}-order`);
  const razorpayPaymentId = taggedValue(`${label}-payment`);
  const razorpayEventId = taggedValue(`${label}-event`);
  const failed = eventType === "payment.failed";

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

  const { data: webhookEvent, error: webhookError } = await client
    .from("webhook_events")
    .insert({
      razorpay_event_id: razorpayEventId,
      event_type: eventType,
      signature_verified: true,
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      payment_attempt_id: paymentAttemptId,
      payment_id: paymentId,
      amount_subunits: amountSubunits,
      currency: "INR",
      razorpay_payment_status: failed ? "failed" : "captured",
      raw_body_sha256: fakeSha256Hex(`${label}-${randomUUID()}`),
      raw_payload_redacted: { event: eventType, synthetic: true },
    })
    .select()
    .single();
  expect(webhookError).toBeNull();
  const webhookEventId = webhookEvent!.id;
  outstandingWebhookEventIds.push(webhookEventId);

  const normalizedEvent: Record<string, unknown> = failed
    ? {
        schemaVersion: 1,
        sourceKind: "REAL_RAZORPAY_WEBHOOK",
        razorpayEventId,
        eventType: "payment.failed",
        providerCreatedAt: null,
        kind: "payment.failed",
        razorpayOrderId,
        razorpayPaymentId,
        amountSubunits,
        currency: "INR",
        razorpayPaymentStatus: "failed",
        errorCode: null,
        errorSource: null,
        errorStep: null,
        errorReason: null,
      }
    : {
        schemaVersion: 1,
        sourceKind: "REAL_RAZORPAY_WEBHOOK",
        razorpayEventId,
        eventType: "payment.captured",
        providerCreatedAt: null,
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

  const processed = await processMerchantWebhookEvent(
    originalProcessingAttemptId,
  );
  expect(processed.outcome).toBe("processed");

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

interface SyntheticChaosRunInput {
  scenarioId: "C01" | "C03" | "C07" | "C11";
  faultType:
    | "REPLAY_EVENT"
    | "INVALID_SIGNATURE_TEST"
    | "DROP_CLIENT_CONFIRMATION"
    | null;
  faultState: Record<string, unknown>;
  fixture: SyntheticFixture | null;
}

/**
 * Inserts one test-owned, COMPLETED/UNKNOWN mechanics `chaos_runs` row.
 * ALWAYS `SYNTHETIC_DEMO` — this file never produces a run that claims
 * `RECORDED_TEST_EVIDENCE`, and never routes through the production
 * creation/precheck/execution path.
 */
async function createSyntheticCompletedChaosRun(
  input: SyntheticChaosRunInput,
): Promise<string> {
  const { data, error } = await client
    .from("chaos_runs")
    .insert({
      scenario_id: input.scenarioId,
      order_id: input.fixture?.orderId ?? null,
      payment_attempt_id: input.fixture?.paymentAttemptId ?? null,
      payment_id: input.fixture?.paymentId ?? null,
      source_webhook_event_id: input.fixture?.webhookEventId ?? null,
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

/** Creates and processes one `PAYCHAOS_REPLAY` attempt linked to a test-owned chaos run. */
async function addSyntheticReplay(
  chaosRunId: string,
  fixture: SyntheticFixture,
): Promise<string> {
  const replay = await insertReplayProcessingAttempt({
    chaosRunId,
    webhookEventId: fixture.webhookEventId,
    paymentAttemptId: fixture.paymentAttemptId,
    paymentId: fixture.paymentId,
    normalizedEvent: fixture.normalizedEvent,
  });
  outstandingAttemptIds.push(replay.id);
  const result = await processMerchantWebhookEvent(replay.id);
  expect(["processed", "already_processed"]).toContain(result.outcome);
  return replay.id;
}

// ---------------------------------------------------------------------------
// Shared fixtures, built once so the determinism and no-write assertions can
// reuse a known-good C01 shape.
// ---------------------------------------------------------------------------
let c01Fixture: SyntheticFixture;
let c01ChaosRunId: string;
let c01ReplayIds: string[] = [];

beforeAll(async () => {
  // Census FIRST — before this file creates a single row.
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

  c01Fixture = await createSyntheticFixture("evi-b-c01", "payment.captured");
  c01ChaosRunId = await createSyntheticCompletedChaosRun({
    scenarioId: "C01",
    faultType: "REPLAY_EVENT",
    faultState: {},
    fixture: c01Fixture,
  });
  c01ReplayIds = [
    await addSyntheticReplay(c01ChaosRunId, c01Fixture),
    await addSyntheticReplay(c01ChaosRunId, c01Fixture),
  ];
}, 180_000);

describe("Phase 3E-B — C01 duplicate-delivery evidence relationships (real Supabase, SYNTHETIC_DEMO mechanics)", () => {
  it("assembles the source, the original REAL attempt, exactly two PAYCHAOS_REPLAY attempts, both persisted V1 snapshots and a canonical event count of one", async () => {
    const bundle = await assembleChaosRunEvidence(c01ChaosRunId);
    expect(bundle).not.toBeNull();

    expect(bundle!.version).toBe(1);
    expect(bundle!.run.id).toBe(c01ChaosRunId);
    expect(bundle!.run.scenarioId).toBe("C01");
    expect(bundle!.run.dataClassification).toBe("SYNTHETIC_DEMO");
    expect(bundle!.requiredInvariantIds).toEqual([
      "INV-001",
      "INV-002",
      "INV-006",
      "INV-007",
    ]);

    expect(bundle!.sourceWebhook?.id).toBe(c01Fixture.webhookEventId);
    expect(bundle!.sourceWebhook?.sourceKind).toBe("REAL_RAZORPAY_WEBHOOK");
    expect(bundle!.sourceWebhook?.signatureVerified).toBe(true);
    expect(bundle!.sourceWebhook?.eventType).toBe("payment.captured");
    expect(bundle!.sourceWebhook?.duplicateDeliveryCount).toBe(0);

    // Exactly one canonical webhook row exists for the source Razorpay event
    // id: a replay never became a new canonical event.
    expect(bundle!.canonicalSourceEventCount).toBe(1);

    expect(bundle!.originalProcessingAttempts).toHaveLength(1);
    expect(bundle!.originalProcessingAttempts[0]!.id).toBe(
      c01Fixture.originalProcessingAttemptId,
    );
    expect(bundle!.originalProcessingAttempts[0]!.sourceKind).toBe(
      "REAL_RAZORPAY_WEBHOOK",
    );
    expect(bundle!.originalProcessingAttempts[0]!.chaosRunId).toBeNull();

    expect(bundle!.chaosProcessingAttempts).toHaveLength(2);
    for (const attempt of bundle!.chaosProcessingAttempts) {
      expect(attempt.sourceKind).toBe("PAYCHAOS_REPLAY");
      expect(attempt.chaosRunId).toBe(c01ChaosRunId);
      expect(attempt.isDuplicateDelivery).toBe(false);
      expect(attempt.stateBefore.kind).toBe("CAPTURED");
      expect(attempt.stateAfter.kind).toBe("CAPTURED");
    }
    expect(bundle!.chaosProcessingAttempts.map((a) => a.id).sort()).toEqual(
      [...c01ReplayIds].sort(),
    );

    expect(bundle!.scenarioEvidence).toEqual({
      scenarioId: "C01",
      expectedReplayAttemptCount: 2,
      observedReplayAttemptCount: 2,
      chaosLinkedProcessingAttemptCount: 2,
      originalProcessingAttemptCount: 1,
      authoritativeOriginalProcessingAttemptId:
        c01Fixture.originalProcessingAttemptId,
    });

    // The canonical source event itself completed processing — the
    // authoritative-source completeness fact.
    expect(bundle!.sourceWebhook?.processingStatus).toBe("PROCESSED");

    // A complete, healthy C01 evidence shape has no factual gaps.
    expect(bundle!.gaps).toEqual([]);
  });

  it("carries genuinely persisted MerchantStateSnapshotV1 evidence whose BEFORE and AFTER differ exactly as the merchant state changed", async () => {
    const bundle = await assembleChaosRunEvidence(c01ChaosRunId);
    const original = bundle!.originalProcessingAttempts[0]!;
    expect(original.stateBefore.kind).toBe("CAPTURED");
    expect(original.stateAfter.kind).toBe("CAPTURED");
    if (
      original.stateBefore.kind !== "CAPTURED" ||
      original.stateAfter.kind !== "CAPTURED"
    ) {
      throw new Error("expected captured snapshots");
    }

    expect(original.stateBefore.snapshot.version).toBe(1);
    expect(original.stateBefore.snapshot.order?.paymentStatus).toBe("UNPAID");
    expect(original.stateBefore.snapshot.order?.businessStatus).toBe("OPEN");
    expect(original.stateBefore.snapshot.fulfilments).toEqual([]);

    expect(original.stateAfter.snapshot.order?.paymentStatus).toBe("PAID");
    expect(original.stateAfter.snapshot.order?.businessStatus).toBe(
      "FULFILLED",
    );
    expect(original.stateAfter.snapshot.fulfilments).toHaveLength(1);
    expect(original.stateAfter.snapshot.order?.amountSubunits).toBe(
      c01Fixture.amountSubunits,
    );
    expect(original.stateAfter.snapshot.order?.currency).toBe("INR");
  });

  it("produces deduplicated, deterministically sorted evidence references carrying only a kind and an internal UUID", async () => {
    const bundle = await assembleChaosRunEvidence(c01ChaosRunId);
    const refs = bundle!.evidenceRefs;

    for (const ref of refs) {
      expect(Object.keys(ref).sort()).toEqual(["id", "kind"]);
      expect(typeof ref.id).toBe("string");
    }
    // Deduplicated.
    const keys = refs.map((r) => `${r.kind} ${r.id}`);
    expect(new Set(keys).size).toBe(keys.length);
    // Deterministically sorted: kind ascending, then id ascending.
    const sorted = [...refs].sort((a, b) =>
      a.kind === b.kind
        ? a.id < b.id
          ? -1
          : a.id > b.id
            ? 1
            : 0
        : a.kind < b.kind
          ? -1
          : 1,
    );
    expect(refs).toEqual(sorted);

    expect(refs).toContainEqual({ kind: "CHAOS_RUN", id: c01ChaosRunId });
    expect(refs).toContainEqual({
      kind: "WEBHOOK_EVENT",
      id: c01Fixture.webhookEventId,
    });
    expect(refs).toContainEqual({ kind: "ORDER", id: c01Fixture.orderId });
    expect(refs).toContainEqual({ kind: "PAYMENT", id: c01Fixture.paymentId });
    expect(refs).toContainEqual({
      kind: "PAYMENT_ATTEMPT",
      id: c01Fixture.paymentAttemptId,
    });
    expect(refs).toContainEqual({
      kind: "PROCESSING_ATTEMPT",
      id: c01Fixture.originalProcessingAttemptId,
    });
    expect(refs.filter((r) => r.kind === "FULFILMENT")).toHaveLength(1);
  });

  it("is deterministic: two assemblies of unchanged data return a deep-equal bundle", async () => {
    const first = await assembleChaosRunEvidence(c01ChaosRunId);
    const second = await assembleChaosRunEvidence(c01ChaosRunId);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("performs ZERO database writes — every row it read is byte-identical afterwards, and no row count changes", async () => {
    async function census() {
      const [runs, attempts, webhooks, fulfilments] = await Promise.all([
        client.from("chaos_runs").select("id", { count: "exact", head: true }),
        client
          .from("event_processing_attempts")
          .select("id", { count: "exact", head: true }),
        client
          .from("webhook_events")
          .select("id", { count: "exact", head: true }),
        client.from("fulfilments").select("id", { count: "exact", head: true }),
      ]);
      return {
        runs: runs.count,
        attempts: attempts.count,
        webhooks: webhooks.count,
        fulfilments: fulfilments.count,
      };
    }

    async function readOwnedRows() {
      const [run, attempts, webhook] = await Promise.all([
        client.from("chaos_runs").select("*").eq("id", c01ChaosRunId).single(),
        client
          .from("event_processing_attempts")
          .select("*")
          .in("id", [c01Fixture.originalProcessingAttemptId, ...c01ReplayIds]),
        client
          .from("webhook_events")
          .select("*")
          .eq("id", c01Fixture.webhookEventId)
          .single(),
      ]);
      const sortedAttempts = [...(attempts.data ?? [])].sort((a, b) =>
        a.id < b.id ? -1 : 1,
      );
      return JSON.stringify({
        run: run.data,
        attempts: sortedAttempts,
        webhook: webhook.data,
      });
    }

    const countsBefore = await census();
    const rowsBefore = await readOwnedRows();

    await assembleChaosRunEvidence(c01ChaosRunId);
    await loadChaosRunEvidenceSource(c01ChaosRunId);

    const countsAfter = await census();
    const rowsAfter = await readOwnedRows();

    expect(countsAfter).toEqual(countsBefore);
    expect(rowsAfter).toBe(rowsBefore);
  });

  it("returns null for an unknown chaos run id, without inventing a bundle", async () => {
    await expect(assembleChaosRunEvidence(randomUUID())).resolves.toBeNull();
  });
});

describe("Phase 3E-B — C03 processor-independent synthetic evidence envelope (real Supabase)", () => {
  it("assembles C03's durable verification checks with no fabricated webhook, processing attempt or merchant snapshot", async () => {
    const chaosRunId = await createSyntheticCompletedChaosRun({
      scenarioId: "C03",
      faultType: "INVALID_SIGNATURE_TEST",
      faultState: {
        checks: [
          { case: "WRONG_SIGNATURE", classification: "REJECTED" },
          { case: "MISSING_SIGNATURE", classification: "REJECTED" },
        ],
      },
      fixture: null,
    });

    const bundle = await assembleChaosRunEvidence(chaosRunId);
    expect(bundle).not.toBeNull();

    expect(bundle!.run.scenarioId).toBe("C03");
    expect(bundle!.run.dataClassification).toBe("SYNTHETIC_DEMO");
    expect(bundle!.run.faultType).toBe("INVALID_SIGNATURE_TEST");
    expect(bundle!.requiredInvariantIds).toEqual(["INV-004", "INV-005"]);

    // Every merchant/provider FK is genuinely NULL, and nothing is invented.
    expect(bundle!.run.orderId).toBeNull();
    expect(bundle!.run.paymentAttemptId).toBeNull();
    expect(bundle!.run.paymentId).toBeNull();
    expect(bundle!.run.sourceWebhookEventId).toBeNull();
    expect(bundle!.sourceWebhook).toBeNull();
    expect(bundle!.canonicalSourceEventCount).toBeNull();
    expect(bundle!.originalProcessingAttempts).toEqual([]);
    expect(bundle!.chaosProcessingAttempts).toEqual([]);

    // This fixture deliberately carries the LEGACY `{checks}` fault_state —
    // the exact shape the already-approved historical C03 run has. The Phase
    // 3F evidence-compatibility correction must report that truthfully:
    // `mutationEvidence: null` plus a MISSING_C03_MUTATION_EVIDENCE gap, and
    // never a snapshot reconstructed from today's merchant state. The
    // CORRECTED `{checks, mutationEvidence}` shape is covered by
    // 062-phase3f-evidence-compatibility.integration.test.ts.
    expect(bundle!.scenarioEvidence).toEqual({
      scenarioId: "C03",
      verificationChecks: [
        { case: "WRONG_SIGNATURE", classification: "REJECTED" },
        { case: "MISSING_SIGNATURE", classification: "REJECTED" },
      ],
      sourceWebhookLinked: false,
      orderLinked: false,
      paymentAttemptLinked: false,
      paymentLinked: false,
      chaosLinkedProcessingAttemptCount: 0,
      mutationEvidence: null,
    });

    expect(bundle!.gaps).toEqual([
      { code: "MISSING_C03_MUTATION_EVIDENCE", subjectId: null },
    ]);
    expect(bundle!.evidenceRefs).toEqual([
      { kind: "CHAOS_RUN", id: chaosRunId },
    ]);

    // No global merchant state was read and presented as a C03 before/after.
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain("stateBefore");
    expect(serialized).not.toContain("stateAfter");
  });

  it("reports a malformed C03 fault_state as a factual gap rather than accepting it", async () => {
    const chaosRunId = await createSyntheticCompletedChaosRun({
      scenarioId: "C03",
      faultType: "INVALID_SIGNATURE_TEST",
      faultState: { checks: [{ case: "WRONG_SIGNATURE" }] },
      fixture: null,
    });

    const bundle = await assembleChaosRunEvidence(chaosRunId);
    expect(bundle!.scenarioEvidence).toMatchObject({
      verificationChecks: null,
    });
    expect(bundle!.gaps.map((g) => g.code)).toContain(
      "MISSING_C03_VERIFICATION_CHECKS",
    );
  });
});

describe("Phase 3E-B — C07 client-confirmation-drop evidence relationships (real Supabase)", () => {
  it("assembles the armed/consumed fault state, the genuine source, the original attempt, its V1 snapshots and zero replays", async () => {
    const fixture = await createSyntheticFixture(
      "evi-b-c07",
      "payment.captured",
    );
    const chaosRunId = await createSyntheticCompletedChaosRun({
      scenarioId: "C07",
      faultType: "DROP_CLIENT_CONFIRMATION",
      faultState: { armed: true, consumed: true },
      fixture,
    });

    const bundle = await assembleChaosRunEvidence(chaosRunId);
    expect(bundle).not.toBeNull();

    expect(bundle!.run.scenarioId).toBe("C07");
    expect(bundle!.run.faultType).toBe("DROP_CLIENT_CONFIRMATION");
    expect(bundle!.requiredInvariantIds).toEqual([
      "INV-002",
      "INV-004",
      "INV-011",
    ]);

    expect(bundle!.sourceWebhook?.sourceKind).toBe("REAL_RAZORPAY_WEBHOOK");
    expect(bundle!.sourceWebhook?.signatureVerified).toBe(true);
    expect(bundle!.originalProcessingAttempts).toHaveLength(1);
    expect(bundle!.originalProcessingAttempts[0]!.stateBefore.kind).toBe(
      "CAPTURED",
    );
    expect(bundle!.originalProcessingAttempts[0]!.stateAfter.kind).toBe(
      "CAPTURED",
    );

    // C07 performs no replay at all.
    expect(bundle!.chaosProcessingAttempts).toEqual([]);
    expect(bundle!.scenarioEvidence).toEqual({
      scenarioId: "C07",
      faultArmed: true,
      faultConsumed: true,
      expectedReplayAttemptCount: 0,
      observedReplayAttemptCount: 0,
      chaosLinkedProcessingAttemptCount: 0,
      originalProcessingAttemptCount: 1,
      authoritativeOriginalProcessingAttemptId:
        fixture.originalProcessingAttemptId,
    });
    expect(bundle!.sourceWebhook?.processingStatus).toBe("PROCESSED");
    expect(bundle!.gaps).toEqual([]);
  });

  it("reports an armed-but-unconsumed C07 fault as a factual gap", async () => {
    const fixture = await createSyntheticFixture(
      "evi-b-c07u",
      "payment.captured",
    );
    const chaosRunId = await createSyntheticCompletedChaosRun({
      scenarioId: "C07",
      faultType: "DROP_CLIENT_CONFIRMATION",
      faultState: { armed: true, consumed: false },
      fixture,
    });

    const bundle = await assembleChaosRunEvidence(chaosRunId);
    expect(bundle!.scenarioEvidence).toMatchObject({
      faultArmed: true,
      faultConsumed: false,
    });
    expect(bundle!.gaps.map((g) => g.code)).toContain("C07_FAULT_NOT_CONSUMED");
  });
});

describe("Phase 3E-B — C11 evidence-shape classification (real Supabase)", () => {
  it("classifies a zero-replay payment.failed shape as A_OBSERVATION", async () => {
    const fixture = await createSyntheticFixture(
      "evi-b-c11a",
      "payment.failed",
    );
    const chaosRunId = await createSyntheticCompletedChaosRun({
      scenarioId: "C11",
      faultType: null,
      faultState: {},
      fixture,
    });

    const bundle = await assembleChaosRunEvidence(chaosRunId);
    expect(bundle).not.toBeNull();

    expect(bundle!.run.scenarioId).toBe("C11");
    expect(bundle!.run.faultType).toBeNull();
    expect(bundle!.requiredInvariantIds).toEqual([
      "INV-003",
      "INV-004",
      "INV-011",
    ]);
    expect(bundle!.sourceWebhook?.eventType).toBe("payment.failed");
    expect(bundle!.sourceWebhook?.sourceKind).toBe("REAL_RAZORPAY_WEBHOOK");
    expect(bundle!.originalProcessingAttempts).toHaveLength(1);
    expect(bundle!.chaosProcessingAttempts).toEqual([]);

    expect(bundle!.scenarioEvidence).toEqual({
      scenarioId: "C11",
      observedShape: "A_OBSERVATION",
      expectedReplayAttemptCount: 0,
      observedReplayAttemptCount: 0,
      chaosLinkedProcessingAttemptCount: 0,
      originalProcessingAttemptCount: 1,
      authoritativeOriginalProcessingAttemptId:
        fixture.originalProcessingAttemptId,
      sourceEventTypeIsPaymentFailed: true,
    });
    expect(bundle!.sourceWebhook?.processingStatus).toBe("PROCESSED");
    expect(bundle!.gaps).toEqual([]);
  });

  it("classifies an exactly-one-PAYCHAOS_REPLAY payment.failed shape as B_REPLAY", async () => {
    const fixture = await createSyntheticFixture(
      "evi-b-c11b",
      "payment.failed",
    );
    const chaosRunId = await createSyntheticCompletedChaosRun({
      scenarioId: "C11",
      faultType: null,
      faultState: {},
      fixture,
    });
    const replayId = await addSyntheticReplay(chaosRunId, fixture);

    const bundle = await assembleChaosRunEvidence(chaosRunId);
    expect(bundle!.chaosProcessingAttempts).toHaveLength(1);
    expect(bundle!.chaosProcessingAttempts[0]!.id).toBe(replayId);
    expect(bundle!.chaosProcessingAttempts[0]!.sourceKind).toBe(
      "PAYCHAOS_REPLAY",
    );
    expect(bundle!.scenarioEvidence).toEqual({
      scenarioId: "C11",
      observedShape: "B_REPLAY",
      expectedReplayAttemptCount: 1,
      observedReplayAttemptCount: 1,
      chaosLinkedProcessingAttemptCount: 1,
      originalProcessingAttemptCount: 1,
      authoritativeOriginalProcessingAttemptId:
        fixture.originalProcessingAttemptId,
      sourceEventTypeIsPaymentFailed: true,
    });
    expect(bundle!.gaps).toEqual([]);
  });
});

describe("Phase 3E-B — evidence-integrity corrections against real Supabase", () => {
  it("accepts a PROCESSED canonical source, and flags a non-PROCESSED one as a factual gap without altering it", async () => {
    const fixture = await createSyntheticFixture(
      "evi-b-srcproc",
      "payment.captured",
    );
    const chaosRunId = await createSyntheticCompletedChaosRun({
      scenarioId: "C01",
      faultType: "REPLAY_EVENT",
      faultState: {},
      fixture,
    });
    await addSyntheticReplay(chaosRunId, fixture);
    await addSyntheticReplay(chaosRunId, fixture);

    // The real merchant-processing transaction drives the canonical event to
    // PROCESSED, which is the authoritative-source completeness condition.
    const processed = await assembleChaosRunEvidence(chaosRunId);
    expect(processed!.sourceWebhook?.processingStatus).toBe("PROCESSED");
    expect(processed!.gaps.map((g) => g.code)).not.toContain(
      "SOURCE_PROCESSING_NOT_PROCESSED",
    );

    // Drive this TEST-OWNED canonical row to each remaining valid literal of
    // `webhook_events_processing_status_valid` and prove the factual gap.
    for (const status of ["RECEIVED", "PROCESSING", "FAILED"] as const) {
      const { error } = await client
        .from("webhook_events")
        .update({ processing_status: status })
        .eq("id", fixture.webhookEventId);
      expect(error).toBeNull();

      const bundle = await assembleChaosRunEvidence(chaosRunId);
      expect(bundle!.gaps).toContainEqual({
        code: "SOURCE_PROCESSING_NOT_PROCESSED",
        subjectId: fixture.webhookEventId,
      });
      // Reported exactly as persisted — assembly never normalises or repairs it.
      expect(bundle!.sourceWebhook?.processingStatus).toBe(status);
    }

    const { data: reread } = await client
      .from("webhook_events")
      .select("processing_status")
      .eq("id", fixture.webhookEventId)
      .single();
    expect(reread?.processing_status).toBe("FAILED");
  });

  it("resolves the SUCCEEDED original as authoritative when a FAILED original also exists, and keeps the failed retry history visible", async () => {
    const fixture = await createSyntheticFixture(
      "evi-b-retry",
      "payment.captured",
    );

    // A second, EARLIER-style provider attempt for the SAME canonical event
    // that ended FAILED. Inserted directly and left terminal: this reproduces
    // ordinary retry history (attempt 1 FAILED, attempt 2 SUCCEEDED), which
    // must NOT be read as ambiguity.
    const { data: failedAttempt, error: failedError } = await client
      .from("event_processing_attempts")
      .insert({
        webhook_event_id: fixture.webhookEventId,
        payment_attempt_id: fixture.paymentAttemptId,
        payment_id: fixture.paymentId,
        source_kind: "REAL_RAZORPAY_WEBHOOK",
        is_duplicate_delivery: false,
        status: "FAILED",
        normalized_event: fixture.normalizedEvent,
        error_code: "PROCESSING_TRANSACTION_FAILED",
        finished_at: new Date().toISOString(),
      })
      .select()
      .single();
    expect(failedError).toBeNull();
    const failedAttemptId = failedAttempt!.id;
    outstandingAttemptIds.push(failedAttemptId);

    const chaosRunId = await createSyntheticCompletedChaosRun({
      scenarioId: "C01",
      faultType: "REPLAY_EVENT",
      faultState: {},
      fixture,
    });
    await addSyntheticReplay(chaosRunId, fixture);
    await addSyntheticReplay(chaosRunId, fixture);

    const bundle = await assembleChaosRunEvidence(chaosRunId);

    // BOTH provider attempts are visible — history is never hidden.
    expect(bundle!.originalProcessingAttempts).toHaveLength(2);
    expect(bundle!.originalProcessingAttempts.map((a) => a.id).sort()).toEqual(
      [fixture.originalProcessingAttemptId, failedAttemptId].sort(),
    );
    expect(
      bundle!.originalProcessingAttempts.map((a) => a.status).sort(),
    ).toEqual(["FAILED", "SUCCEEDED"]);

    // ...and exactly ONE of them is authoritative. This is NOT ambiguous.
    expect(bundle!.scenarioEvidence).toMatchObject({
      originalProcessingAttemptCount: 2,
      authoritativeOriginalProcessingAttemptId:
        fixture.originalProcessingAttemptId,
    });
    const codes = bundle!.gaps.map((g) => g.code);
    expect(codes).not.toContain(
      "AMBIGUOUS_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT",
    );
    expect(codes).not.toContain(
      "MISSING_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT",
    );

    // The FAILED attempt legitimately has no snapshots, which is a factual
    // gap, not a defect.
    expect(bundle!.gaps).toContainEqual({
      code: "MISSING_STATE_BEFORE",
      subjectId: failedAttemptId,
    });
  });

  it("treats two SUCCEEDED non-duplicate originals as ambiguous and names no authoritative attempt", async () => {
    const fixture = await createSyntheticFixture(
      "evi-b-ambig",
      "payment.captured",
    );

    const { data: secondSuccess, error: secondError } = await client
      .from("event_processing_attempts")
      .insert({
        webhook_event_id: fixture.webhookEventId,
        payment_attempt_id: fixture.paymentAttemptId,
        payment_id: fixture.paymentId,
        source_kind: "REAL_RAZORPAY_WEBHOOK",
        is_duplicate_delivery: false,
        status: "SUCCEEDED",
        normalized_event: fixture.normalizedEvent,
        finished_at: new Date().toISOString(),
      })
      .select()
      .single();
    expect(secondError).toBeNull();
    outstandingAttemptIds.push(secondSuccess!.id);

    const chaosRunId = await createSyntheticCompletedChaosRun({
      scenarioId: "C01",
      faultType: "REPLAY_EVENT",
      faultState: {},
      fixture,
    });
    await addSyntheticReplay(chaosRunId, fixture);
    await addSyntheticReplay(chaosRunId, fixture);

    const bundle = await assembleChaosRunEvidence(chaosRunId);
    expect(bundle!.originalProcessingAttempts).toHaveLength(2);
    expect(bundle!.gaps.map((g) => g.code)).toContain(
      "AMBIGUOUS_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT",
    );
    expect(bundle!.scenarioEvidence).toMatchObject({
      authoritativeOriginalProcessingAttemptId: null,
    });
  });

  /**
   * The C03 `UNEXPECTED_DATA_CLASSIFICATION` gap is deliberately NOT proven
   * here. Doing so would require this file to persist a `chaos_runs` row
   * classified `RECORDED_TEST_EVIDENCE`, which would break the provenance
   * rule this suite exists to uphold (every 061-created run is
   * `SYNTHETIC_DEMO`, and no synthetic mechanics row is ever generalised into
   * genuine production provenance). The gap is pure, database-independent
   * logic over an already-read column, and is proven by
   * `tests/unit/evidence/chaos-run-evidence.test.ts` test 81 instead.
   */
});

describe("Phase 3E-B — missing and invalid snapshots become gaps, never reconstructed", () => {
  it("reports a NULL state_before as MISSING_STATE_BEFORE and a malformed state_after as INVALID_STATE_AFTER", async () => {
    const fixture = await createSyntheticFixture(
      "evi-b-gap",
      "payment.captured",
    );
    const chaosRunId = await createSyntheticCompletedChaosRun({
      scenarioId: "C01",
      faultType: "REPLAY_EVENT",
      faultState: {},
      fixture,
    });
    const replayA = await addSyntheticReplay(chaosRunId, fixture);
    const replayB = await addSyntheticReplay(chaosRunId, fixture);

    // Reproduce, on TEST-OWNED rows only, the two shapes Phase 3F must be
    // able to distinguish: an authoritative historical NULL, and a value that
    // is present but is not a valid MerchantStateSnapshotV1.
    const { error: clearError } = await client
      .from("event_processing_attempts")
      .update({ state_before: null })
      .eq("id", replayA);
    expect(clearError).toBeNull();

    const { error: corruptError } = await client
      .from("event_processing_attempts")
      .update({ state_after: { version: 99, order: null } })
      .eq("id", replayB);
    expect(corruptError).toBeNull();

    const bundle = await assembleChaosRunEvidence(chaosRunId);
    expect(bundle!.gaps).toContainEqual({
      code: "MISSING_STATE_BEFORE",
      subjectId: replayA,
    });
    expect(bundle!.gaps).toContainEqual({
      code: "INVALID_STATE_AFTER",
      subjectId: replayB,
    });

    const parsedA = bundle!.chaosProcessingAttempts.find(
      (a) => a.id === replayA,
    );
    const parsedB = bundle!.chaosProcessingAttempts.find(
      (a) => a.id === replayB,
    );
    expect(parsedA!.stateBefore).toEqual({ kind: "NOT_CAPTURED" });
    expect(parsedB!.stateAfter).toEqual({ kind: "INVALID" });

    // Crucially: the order is currently PAID/FULFILLED in the live database,
    // yet NOTHING of that current state was substituted for the missing
    // snapshot.
    const { data: currentOrder } = await client
      .from("orders")
      .select("payment_status, business_status")
      .eq("id", fixture.orderId)
      .single();
    expect(currentOrder?.payment_status).toBe("PAID");
    expect(currentOrder?.business_status).toBe("FULFILLED");
    expect(parsedA!.stateBefore).toEqual({ kind: "NOT_CAPTURED" });

    // The NULL stays NULL in the database — assembly performed no repair.
    const { data: reread } = await client
      .from("event_processing_attempts")
      .select("state_before")
      .eq("id", replayA)
      .single();
    expect(reread?.state_before).toBeNull();
  });
});

afterAll(async () => {
  // Exact-ID-scoped cleanup only — never a broad delete. Child-before-parent
  // order, mirroring 053/060's fully-corrected FK graph:
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
}, 240_000);
