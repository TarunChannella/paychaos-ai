import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  cancelRunningC07Fault as cancelRunningC07FaultRepo,
  completeRunningC07RunWithEvidence,
  consumeC07ClientConfirmationDrop,
  createPendingChaosRun,
} from "@/lib/chaos/run-repository";
import {
  armC07ClientConfirmationDrop,
  cancelRunningC07Fault,
  reconcileC07ClientConfirmationDrop,
} from "@/lib/chaos/c07-execution-service";
import { resolveActiveArmedC07FaultForOrder } from "@/lib/chaos/c07-repository";

/**
 * Phase 3D-B — proves C07's MECHANICS against the REAL Supabase project
 * (the Phase 3D-0 concurrency index and Phase 3D-A schema this depends on
 * are already applied/frozen).
 *
 * This file deliberately does NOT fabricate a successful `REAL_RAZORPAY_
 * WEBHOOK` row merely to make reconciliation converge — doing so would
 * undermine the exact property C07 exists to prove. It covers only the
 * mechanics that do not require a real external Checkout (this task's
 * Section 22). The authentic external C07 success story — a real Razorpay
 * Test Mode payment, suppressed client confirmation, genuine webhook
 * convergence — remains a later mandatory manual verification step.
 *
 * Every `orders`/`chaos_runs` row this file creates is exact-ID tracked and
 * deleted in `afterAll`, child (chaos_runs) before parent (orders) —
 * `chaos_runs.order_id` is `ON DELETE RESTRICT`.
 */

const client = getSupabaseServerClient();

const outstandingChaosRunIds: string[] = [];
const outstandingOrderIds: string[] = [];

async function insertFreshOrder(): Promise<string> {
  const { data, error } = await client
    .from("orders")
    .insert({ amount_subunits: 50000, currency: "INR" })
    .select("id")
    .single();
  expect(error).toBeNull();
  expect(data).not.toBeNull();
  const id = data!.id;
  outstandingOrderIds.push(id);
  return id;
}

async function insertEligiblePendingC07Run(orderId: string): Promise<string> {
  const run = await createPendingChaosRun({
    scenarioId: "C07",
    faultType: "DROP_CLIENT_CONFIRMATION",
    dataClassification: "RECORDED_TEST_EVIDENCE",
    orderId,
  });
  outstandingChaosRunIds.push(run.id);
  return run.id;
}

describe("Phase 3D-B — C07 arm mechanics (real Supabase)", () => {
  it("an eligible PENDING C07 run atomically arms with the exact fixed fault_state", async () => {
    const orderId = await insertFreshOrder();
    const chaosRunId = await insertEligiblePendingC07Run(orderId);

    const result = await armC07ClientConfirmationDrop(chaosRunId);

    expect(result).toEqual({ kind: "ARMED", chaosRunId });

    const { data: runRow } = await client
      .from("chaos_runs")
      .select("*")
      .eq("id", chaosRunId)
      .single();
    expect(runRow?.status).toBe("RUNNING");
    expect(runRow?.started_at).not.toBeNull();
    expect(runRow?.fault_state).toEqual({ armed: true, consumed: false });
  });

  it("two concurrent arm attempts for the SAME order: exactly one wins, the loser is reported ALREADY_ARMED_FOR_ORDER or a non-eligible race outcome", async () => {
    const orderId = await insertFreshOrder();
    const firstRunId = await insertEligiblePendingC07Run(orderId);
    const secondRunId = await insertEligiblePendingC07Run(orderId);

    const [first, second] = await Promise.all([
      armC07ClientConfirmationDrop(firstRunId),
      armC07ClientConfirmationDrop(secondRunId),
    ]);

    const kinds = [first.kind, second.kind];
    expect(kinds.filter((k) => k === "ARMED")).toHaveLength(1);
    const loser = first.kind === "ARMED" ? second : first;
    expect(loser.kind).toBe("NOT_STARTABLE");

    const { data: runningRows } = await client
      .from("chaos_runs")
      .select("id")
      .eq("order_id", orderId)
      .eq("status", "RUNNING");
    expect(runningRows).toHaveLength(1);
  });

  it("different orders can arm independently", async () => {
    const orderIdA = await insertFreshOrder();
    const orderIdB = await insertFreshOrder();
    const runIdA = await insertEligiblePendingC07Run(orderIdA);
    const runIdB = await insertEligiblePendingC07Run(orderIdB);

    const [resultA, resultB] = await Promise.all([
      armC07ClientConfirmationDrop(runIdA),
      armC07ClientConfirmationDrop(runIdB),
    ]);

    expect(resultA).toEqual({ kind: "ARMED", chaosRunId: runIdA });
    expect(resultB).toEqual({ kind: "ARMED", chaosRunId: runIdB });
  });
});

describe("Phase 3D-B — consume mechanics (real Supabase)", () => {
  it("the first consume flips false->true exactly once; duplicate/concurrent attempts remain safe", async () => {
    const orderId = await insertFreshOrder();
    const chaosRunId = await insertEligiblePendingC07Run(orderId);
    await armC07ClientConfirmationDrop(chaosRunId);

    const [consumeA, consumeB] = await Promise.all([
      consumeC07ClientConfirmationDrop(chaosRunId),
      consumeC07ClientConfirmationDrop(chaosRunId),
    ]);
    const successes = [consumeA, consumeB].filter((r) => r !== null);
    expect(successes).toHaveLength(1);

    const { data: runRow } = await client
      .from("chaos_runs")
      .select("fault_state")
      .eq("id", chaosRunId)
      .single();
    expect(runRow?.fault_state).toEqual({ armed: true, consumed: true });

    // A third, later attempt is still safely a no-op (already consumed).
    const thirdAttempt = await consumeC07ClientConfirmationDrop(chaosRunId);
    expect(thirdAttempt).toBeNull();
  });

  it("RUNNING + armed + consumed=true remains suppression-active", async () => {
    const orderId = await insertFreshOrder();
    const chaosRunId = await insertEligiblePendingC07Run(orderId);
    await armC07ClientConfirmationDrop(chaosRunId);
    await consumeC07ClientConfirmationDrop(chaosRunId);

    const activeFault = await resolveActiveArmedC07FaultForOrder(orderId);
    expect(activeFault?.id).toBe(chaosRunId);
  });
});

describe("Phase 3D-B — reconciliation mechanics (real Supabase, no fabricated evidence)", () => {
  it("a fresh run without real provider evidence reconciles NOT_YET_CONVERGED", async () => {
    const orderId = await insertFreshOrder();
    const chaosRunId = await insertEligiblePendingC07Run(orderId);
    await armC07ClientConfirmationDrop(chaosRunId);
    await consumeC07ClientConfirmationDrop(chaosRunId);

    const result = await reconcileC07ClientConfirmationDrop(chaosRunId);

    expect(result).toEqual({ kind: "NOT_YET_CONVERGED", chaosRunId });

    const { data: runRow } = await client
      .from("chaos_runs")
      .select("status")
      .eq("id", chaosRunId)
      .single();
    expect(runRow?.status).toBe("RUNNING");
  });

  it("reconciliation before consumption returns FAULT_NOT_CONSUMED and never completes", async () => {
    const orderId = await insertFreshOrder();
    const chaosRunId = await insertEligiblePendingC07Run(orderId);
    await armC07ClientConfirmationDrop(chaosRunId);
    // Deliberately NOT consumed yet.

    const result = await reconcileC07ClientConfirmationDrop(chaosRunId);

    expect(result).toEqual({ kind: "FAULT_NOT_CONSUMED", chaosRunId });
  });

  it("consumed=false can never complete at the database level, even given fabricated evidence FKs directly against the repository function", async () => {
    const orderId = await insertFreshOrder();
    const chaosRunId = await insertEligiblePendingC07Run(orderId);
    await armC07ClientConfirmationDrop(chaosRunId);
    // Deliberately NOT consumed — the repository's own
    // `.contains("fault_state", {armed:true, consumed:true})` guard must
    // reject this at the database level regardless of what evidence FKs
    // are supplied.

    const attemptedCompletion = await completeRunningC07RunWithEvidence(
      chaosRunId,
      orderId,
      {
        paymentAttemptId: randomUUID(),
        paymentId: randomUUID(),
        sourceWebhookEventId: randomUUID(),
      },
    );

    expect(attemptedCompletion).toBeNull();

    const { data: runRow } = await client
      .from("chaos_runs")
      .select("status, payment_attempt_id")
      .eq("id", chaosRunId)
      .single();
    expect(runRow?.status).toBe("RUNNING");
    expect(runRow?.payment_attempt_id).toBeNull();
  });
});

describe("Phase 3D-B — correction round hardening: exact-shape/classification fail-closed (real Supabase, Section 21)", () => {
  it("a malformed extra-key fault_state fails both the active-fault lookup and the exact-equality consume mutation", async () => {
    const orderId = await insertFreshOrder();
    const chaosRunId = await insertEligiblePendingC07Run(orderId);
    await armC07ClientConfirmationDrop(chaosRunId);

    // Directly corrupt the persisted fault_state to carry an extra key,
    // bypassing every repository helper — simulating a row that could only
    // exist through a bug or direct database tampering.
    const { error: corruptError } = await client
      .from("chaos_runs")
      .update({ fault_state: { armed: true, consumed: false, extra: "x" } })
      .eq("id", chaosRunId);
    expect(corruptError).toBeNull();

    // The active-fault lookup must fail closed — a malformed shape is
    // never treated as an active, suppression-eligible fault.
    const activeFault = await resolveActiveArmedC07FaultForOrder(orderId);
    expect(activeFault).toBeNull();

    // The exact-equality consume mutation must also fail closed at the
    // database level: {armed:true,consumed:false,extra:"x"} does not equal
    // {armed:true,consumed:false}, so the WHERE clause matches zero rows.
    const consumeResult = await consumeC07ClientConfirmationDrop(chaosRunId);
    expect(consumeResult).toBeNull();

    const { data: runRow } = await client
      .from("chaos_runs")
      .select("fault_state")
      .eq("id", chaosRunId)
      .single();
    expect(runRow?.fault_state).toEqual({
      armed: true,
      consumed: false,
      extra: "x",
    });
  });

  it("resolveActiveArmedC07FaultForOrder is scoped to data_classification=RECORDED_TEST_EVIDENCE — a reclassified row is never treated as active", async () => {
    const orderId = await insertFreshOrder();
    const chaosRunId = await insertEligiblePendingC07Run(orderId);
    await armC07ClientConfirmationDrop(chaosRunId);

    const { error: reclassifyError } = await client
      .from("chaos_runs")
      .update({ data_classification: "SYNTHETIC_DEMO" })
      .eq("id", chaosRunId);
    expect(reclassifyError).toBeNull();

    const activeFault = await resolveActiveArmedC07FaultForOrder(orderId);
    expect(activeFault).toBeNull();
  });

  it("reconciliation of a RUNNING C07 row with a malformed fault_state reports NOT_RECONCILABLE, never COMPLETED", async () => {
    const orderId = await insertFreshOrder();
    const chaosRunId = await insertEligiblePendingC07Run(orderId);
    await armC07ClientConfirmationDrop(chaosRunId);

    const { error: corruptError } = await client
      .from("chaos_runs")
      .update({ fault_state: { armed: true, consumed: true, extra: 1 } })
      .eq("id", chaosRunId);
    expect(corruptError).toBeNull();

    const result = await reconcileC07ClientConfirmationDrop(chaosRunId);
    expect(result).toEqual({
      kind: "NOT_RECONCILABLE",
      reasonCategory: "RUN_NOT_ELIGIBLE",
    });

    const { data: runRow } = await client
      .from("chaos_runs")
      .select("status")
      .eq("id", chaosRunId)
      .single();
    expect(runRow?.status).toBe("RUNNING");
  });

  it("cancellation of a RUNNING C07 row with a malformed pre-cancel fault_state reports NOT_CANCELLABLE, never CANCELLED, and leaves the row untouched", async () => {
    const orderId = await insertFreshOrder();
    const chaosRunId = await insertEligiblePendingC07Run(orderId);
    await armC07ClientConfirmationDrop(chaosRunId);

    const { error: corruptError } = await client
      .from("chaos_runs")
      .update({ fault_state: { armed: true, consumed: false, rogue: true } })
      .eq("id", chaosRunId);
    expect(corruptError).toBeNull();

    const cancelResult = await cancelRunningC07Fault(chaosRunId);
    expect(cancelResult).toEqual({
      kind: "NOT_CANCELLABLE",
      reasonCategory: "RUN_NOT_ELIGIBLE",
    });

    const { data: runRow } = await client
      .from("chaos_runs")
      .select("status, fault_state")
      .eq("id", chaosRunId)
      .single();
    expect(runRow?.status).toBe("RUNNING");
    expect(runRow?.fault_state).toEqual({
      armed: true,
      consumed: false,
      rogue: true,
    });
  });
});

describe("Phase 3D-B — explicit cancellation (real Supabase)", () => {
  it("explicit cancel transitions to FAILED/ERROR and releases the one-active-fault-per-order slot", async () => {
    const orderId = await insertFreshOrder();
    const firstRunId = await insertEligiblePendingC07Run(orderId);
    await armC07ClientConfirmationDrop(firstRunId);

    const cancelResult = await cancelRunningC07Fault(firstRunId);
    expect(cancelResult).toEqual({ kind: "CANCELLED", chaosRunId: firstRunId });

    const { data: cancelledRow } = await client
      .from("chaos_runs")
      .select("status, outcome")
      .eq("id", firstRunId)
      .single();
    expect(cancelledRow?.status).toBe("FAILED");
    expect(cancelledRow?.outcome).toBe("ERROR");

    // A later PENDING C07 run for the SAME order may now arm — the slot
    // was released because the prior run is no longer RUNNING.
    const secondRunId = await insertEligiblePendingC07Run(orderId);
    const secondArm = await armC07ClientConfirmationDrop(secondRunId);
    expect(secondArm).toEqual({ kind: "ARMED", chaosRunId: secondRunId });

    // The suppression lookup no longer matches the cancelled run.
    const activeFault = await resolveActiveArmedC07FaultForOrder(orderId);
    expect(activeFault?.id).toBe(secondRunId);
  });

  it("Blocker A (final correction round): a stale expectedConsumed snapshot cannot terminalize a run whose fault_state has since changed", async () => {
    const orderId = await insertFreshOrder();
    const chaosRunId = await insertEligiblePendingC07Run(orderId);
    await armC07ClientConfirmationDrop(chaosRunId);

    // Capture the pre-consume expected state a cancel caller would have
    // read at this point in time (consumed=false).
    const staleExpectedConsumed = false;

    // A genuine confirmation consumes the fault before the (simulated)
    // stale cancel attempt below reaches the database.
    const consumed = await consumeC07ClientConfirmationDrop(chaosRunId);
    expect(consumed).not.toBeNull();

    // The stale, now-incorrect expectation is used directly against the
    // LOW-LEVEL repository function — proving the repository's own atomic
    // predicate (not merely the service layer) rejects it.
    const staleCancelAttempt = await cancelRunningC07FaultRepo(
      chaosRunId,
      orderId,
      staleExpectedConsumed,
      "stale cancel attempt",
    );
    expect(staleCancelAttempt).toBeNull();

    const { data: afterStaleAttempt } = await client
      .from("chaos_runs")
      .select("status, fault_state")
      .eq("id", chaosRunId)
      .single();
    expect(afterStaleAttempt?.status).toBe("RUNNING");
    expect(afterStaleAttempt?.fault_state).toEqual({
      armed: true,
      consumed: true,
    });

    // A legitimate cancellation — through the service, which reads the
    // CURRENT state itself rather than relying on a stale snapshot —
    // succeeds normally against the now-true consumed value.
    const legitimateCancel = await cancelRunningC07Fault(chaosRunId);
    expect(legitimateCancel).toEqual({ kind: "CANCELLED", chaosRunId });

    const { data: finalRow } = await client
      .from("chaos_runs")
      .select("status, outcome, fault_state")
      .eq("id", chaosRunId)
      .single();
    expect(finalRow?.status).toBe("FAILED");
    expect(finalRow?.outcome).toBe("ERROR");
    expect(finalRow?.fault_state).toEqual({ armed: true, consumed: true });
  });
});

describe("Phase 3D-B — no merchant mutation / no canonical webhook fabrication (real Supabase)", () => {
  it("arming, consuming, and cancelling a C07 fault creates zero event_processing_attempts, payments, or fulfilments rows", async () => {
    const orderId = await insertFreshOrder();
    const chaosRunId = await insertEligiblePendingC07Run(orderId);
    await armC07ClientConfirmationDrop(chaosRunId);
    await consumeC07ClientConfirmationDrop(chaosRunId);
    await cancelRunningC07Fault(chaosRunId);

    const { data: attempts, error: attemptsError } = await client
      .from("event_processing_attempts")
      .select("id")
      .eq("chaos_run_id", chaosRunId);
    expect(attemptsError).toBeNull();
    expect(attempts).toHaveLength(0);

    const { data: payments, error: paymentsError } = await client
      .from("payments")
      .select("id, payment_attempt_id");
    expect(paymentsError).toBeNull();
    // No payment this file created can exist since no payment_attempts row
    // was ever created for this order by this test.
    const { data: attemptsForOrder } = await client
      .from("payment_attempts")
      .select("id")
      .eq("order_id", orderId);
    expect(attemptsForOrder).toHaveLength(0);
    void payments;

    const { data: fulfilments, error: fulfilmentsError } = await client
      .from("fulfilments")
      .select("id")
      .eq("order_id", orderId);
    expect(fulfilmentsError).toBeNull();
    expect(fulfilments).toHaveLength(0);

    const { data: webhookRows, error: webhookError } = await client
      .from("webhook_events")
      .select("id")
      .like("razorpay_event_id", "paychaos-c07-%");
    expect(webhookError).toBeNull();
    expect(webhookRows).toHaveLength(0);

    const { data: orderRow } = await client
      .from("orders")
      .select("payment_status, business_status")
      .eq("id", orderId)
      .single();
    expect(orderRow?.payment_status).toBe("UNPAID");
    expect(orderRow?.business_status).toBe("OPEN");
  });
});

afterAll(async () => {
  // Child (chaos_runs) before parent (orders) — chaos_runs.order_id is ON
  // DELETE RESTRICT. Exact-ID-scoped deletes only.
  const chaosRunIds = outstandingChaosRunIds;
  for (let i = 0; i < chaosRunIds.length; i += 50) {
    const chunk = chaosRunIds.slice(i, i + 50);
    if (chunk.length === 0) continue;
    await client.from("chaos_runs").delete().in("id", chunk);
  }

  const orderIds = outstandingOrderIds;
  for (let i = 0; i < orderIds.length; i += 50) {
    const chunk = orderIds.slice(i, i + 50);
    if (chunk.length === 0) continue;
    await client.from("orders").delete().in("id", chunk);
  }

  const { count: remainingChaosRuns } = await client
    .from("chaos_runs")
    .select("id", { count: "exact", head: true })
    .in("id", chaosRunIds.length ? chaosRunIds : [randomUUID()]);
  expect(remainingChaosRuns).toBe(0);

  const { count: remainingOrders } = await client
    .from("orders")
    .select("id", { count: "exact", head: true })
    .in("id", orderIds.length ? orderIds : [randomUUID()]);
  expect(remainingOrders).toBe(0);
}, 120_000);
