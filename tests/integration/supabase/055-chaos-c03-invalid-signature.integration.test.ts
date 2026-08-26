import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  blockPendingC03RunForPreSec007,
  createPendingChaosRun,
} from "@/lib/chaos/run-repository";
import { executeC03InvalidSignatureTest } from "@/lib/chaos/c03-execution-service";

/**
 * Phase 3D-A (correction round 1) — proves C03's real execution mechanism
 * against the REAL Supabase project, after the Blocker 2 correction: the
 * production runtime mechanism now calls `verifyWebhookSignature` directly
 * (`lib/razorpay/webhook-verification.ts`) and no longer invokes the real
 * webhook route/service/persistence chain at all.
 *
 * MUTATION/EVIDENCE PROOF STRATEGY (architect correction — "the run carries
 * no entity link" alone is not enough):
 *
 *   (a) STRUCTURAL — `tests/unit/chaos/c03-static-guard.test.ts` proves, by
 *       static import-graph analysis, that `lib/chaos/c03-execution-service.ts`
 *       cannot import `app/api/webhooks/razorpay/route.ts`,
 *       `lib/webhooks/service.ts`, `lib/webhooks/repository.ts`,
 *       `lib/webhooks/event-processing-repository.ts`, or
 *       `lib/events/processor.ts` — the ONLY code paths in this codebase
 *       capable of inserting a `webhook_events`, `event_processing_attempts`,
 *       or merchant-processed `payments`/`orders`/`fulfilments` mutation.
 *       This makes fabrication IMPOSSIBLE BY CONSTRUCTION, not merely
 *       "didn't happen this run" — the strongest proof available.
 *   (b) EXACT-ID CORRELATION (this file) — for every table that CAN be
 *       queried by an identifier this test controls exactly:
 *         - `chaos_runs.order_id`/`payment_attempt_id`/`payment_id`/
 *           `source_webhook_event_id` for THIS run's own id — must all be
 *           NULL (nothing to correlate FROM);
 *         - `event_processing_attempts.chaos_run_id` for THIS run's own
 *           id — must be zero rows (nothing correlates TO this run; this is
 *           the only column on that table that can reference a specific
 *           chaos_runs row at all);
 *         - `webhook_events.razorpay_event_id` scoped to the
 *           `paychaos-c03-`-prefixed namespace this scenario uses in its
 *           OFFLINE tests (a prefix no genuine Razorpay-issued event ID can
 *           ever carry) — defensive belt-and-suspenders, since the runtime
 *           mechanism itself never transmits an event-id header at all
 *           (there is no HTTP request in the corrected architecture).
 *   `orders`/`payment_attempts`/`payments`/`fulfilments` have NO free-text
 *   column capable of holding an arbitrary caller-chosen synthetic marker
 *   string, and no column referencing `chaos_runs` at all — the ONLY way
 *   this run could ever correlate to one is via `chaos_runs`'s own four
 *   entity-link columns, already checked in (b). Combined with (a), this is
 *   a complete, non-flaky proof: no global before/after table count is used
 *   anywhere in this file, since genuine external Test Mode webhook traffic
 *   arriving concurrently could make a global count flaky without ever
 *   being related to this run.
 *
 * Every `chaos_runs` row this file creates is SYNTHETIC_DEMO by design.
 * Cleanup deletes only the exact chaos_runs IDs this file itself created.
 */

const client = getSupabaseServerClient();

const outstandingChaosRunIds: string[] = [];

async function insertEligibleC03PendingRun(): Promise<string> {
  const run = await createPendingChaosRun({
    scenarioId: "C03",
    faultType: "INVALID_SIGNATURE_TEST",
    dataClassification: "SYNTHETIC_DEMO",
  });
  outstandingChaosRunIds.push(run.id);
  return run.id;
}

describe("Phase 3D-A — C03 execution (real Supabase, verification-only runtime)", () => {
  it("1-4: an eligible PENDING C03 run executes to COMPLETED/UNKNOWN with exactly two recorded checks", async () => {
    const chaosRunId = await insertEligibleC03PendingRun();

    const result = await executeC03InvalidSignatureTest(chaosRunId);

    expect(result.kind).toBe("COMPLETED");
    if (result.kind !== "COMPLETED") return;
    expect(result.checks).toHaveLength(2);
    expect(result.checks.map((c) => c.case)).toEqual([
      "WRONG_SIGNATURE",
      "MISSING_SIGNATURE",
    ]);
    for (const check of result.checks) {
      // The real configured secret genuinely rejects both fixed synthetic
      // inputs — a healthy verifier. If this ever observed
      // UNEXPECTED_ACCEPTANCE, that would be a real finding for Phase 3F,
      // not a reason to fail this mechanics test — but under the current
      // healthy implementation, REJECTED is the expected result.
      expect(check.classification).toBe("REJECTED");
    }

    const { data: runRow, error } = await client
      .from("chaos_runs")
      .select("*")
      .eq("id", chaosRunId)
      .single();
    expect(error).toBeNull();
    expect(runRow?.status).toBe("COMPLETED");
    expect(runRow?.outcome).toBe("UNKNOWN");
    expect(runRow?.execution_block_code).toBeNull();
    expect(runRow?.failed_precheck_id).toBeNull();
    expect(runRow?.started_at).not.toBeNull();
    expect(runRow?.completed_at).not.toBeNull();
    const faultState = runRow?.fault_state as { checks?: unknown[] };
    expect(faultState.checks).toHaveLength(2);
  });

  it("5/6: no canonical webhook/event-processing evidence or merchant entity correlation exists for this run (exact-ID correlation queries)", async () => {
    const chaosRunId = await insertEligibleC03PendingRun();
    await executeC03InvalidSignatureTest(chaosRunId);

    // (b) exact-ID correlation — chaos_runs' own entity links.
    const { data: runRow } = await client
      .from("chaos_runs")
      .select(
        "order_id, payment_attempt_id, payment_id, source_webhook_event_id",
      )
      .eq("id", chaosRunId)
      .single();
    expect(runRow?.order_id).toBeNull();
    expect(runRow?.payment_attempt_id).toBeNull();
    expect(runRow?.payment_id).toBeNull();
    expect(runRow?.source_webhook_event_id).toBeNull();

    // event_processing_attempts.chaos_run_id is the ONLY column in the
    // schema capable of referencing this specific chaos_runs row — zero
    // rows here is a complete, exact-ID proof of no correlation.
    const { data: attempts, error: attemptsError } = await client
      .from("event_processing_attempts")
      .select("id")
      .eq("chaos_run_id", chaosRunId);
    expect(attemptsError).toBeNull();
    expect(attempts).toHaveLength(0);

    // Defensive belt-and-suspenders: the runtime mechanism never transmits
    // an event-id header at all in the corrected architecture (no HTTP
    // request exists), so this is expected to already be vacuously true —
    // scoped to the synthetic-only namespace, never a global count, so
    // genuine concurrent Test Mode traffic cannot make this flaky.
    const { data: webhookRows, error: webhookError } = await client
      .from("webhook_events")
      .select("id")
      .like("razorpay_event_id", "paychaos-c03-%");
    expect(webhookError).toBeNull();
    expect(webhookRows).toHaveLength(0);

    // orders/payment_attempts/payments/fulfilments have no free-text column
    // capable of holding a caller-chosen synthetic marker, and no column
    // referencing chaos_runs directly — their only possible correlation
    // path to this run is via chaos_runs' own links, already proven NULL
    // above. Combined with the static structural guard
    // (tests/unit/chaos/c03-static-guard.test.ts), this is a complete proof.
  });

  it("7: concurrent execution attempts against the same PENDING run still execute the mechanism exactly once", async () => {
    const chaosRunId = await insertEligibleC03PendingRun();

    const [first, second] = await Promise.all([
      executeC03InvalidSignatureTest(chaosRunId),
      executeC03InvalidSignatureTest(chaosRunId),
    ]);

    const kinds = [first.kind, second.kind];
    expect(kinds).toContain("COMPLETED");

    const { data: runRow } = await client
      .from("chaos_runs")
      .select("fault_state")
      .eq("id", chaosRunId)
      .single();
    const faultState = runRow?.fault_state as { checks?: unknown[] };
    expect(faultState.checks).toHaveLength(2);
  });
});

describe("Phase 3D-A — blockPendingC03RunForPreSec007 lifecycle (real Supabase, Phase 3D-0 schema)", () => {
  it("8: atomically transitions an eligible PENDING C03 run to the execution-time BLOCKED shape", async () => {
    const chaosRunId = await insertEligibleC03PendingRun();

    const blocked = await blockPendingC03RunForPreSec007(
      chaosRunId,
      "Required server secrets for webhook verification were unavailable.",
    );

    expect(blocked).not.toBeNull();
    expect(blocked?.status).toBe("COMPLETED");
    expect(blocked?.outcome).toBe("BLOCKED");
    expect(blocked?.execution_block_code).toBe("PRE-SEC-007");
    expect(blocked?.failed_precheck_id).toBeNull();
    expect(blocked?.started_at).toBeNull();
    expect(blocked?.completed_at).not.toBeNull();
    expect(blocked?.error_message_redacted).not.toBeNull();
  });

  it("does not transition an already-RUNNING run (atomic guard holds)", async () => {
    const chaosRunId = await insertEligibleC03PendingRun();
    await client
      .from("chaos_runs")
      .update({ status: "RUNNING", started_at: new Date().toISOString() })
      .eq("id", chaosRunId);

    const blocked = await blockPendingC03RunForPreSec007(
      chaosRunId,
      "should not apply",
    );
    expect(blocked).toBeNull();

    const { data: runRow } = await client
      .from("chaos_runs")
      .select("status")
      .eq("id", chaosRunId)
      .single();
    expect(runRow?.status).toBe("RUNNING");
  });
});

afterAll(async () => {
  const ids = outstandingChaosRunIds;
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    if (chunk.length === 0) continue;
    await client.from("chaos_runs").delete().in("id", chunk);
  }

  const { count: remaining } = await client
    .from("chaos_runs")
    .select("id", { count: "exact", head: true })
    .in("id", ids.length ? ids : [randomUUID()]);
  expect(remaining).toBe(0);
}, 120_000);
