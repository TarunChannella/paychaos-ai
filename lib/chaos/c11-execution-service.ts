/**
 * Phase 3D-D — server-only orchestration for C11-B's controlled
 * `REAL_WEBHOOK_EVENT` replay execution (docs/CHAOS_SCENARIOS.md Section 23
 * "P0 SCENARIO C11" — "Failed Payment Must Never Mark Order Paid").
 *
 * `executeC11RealWebhookReplay(chaosRunId)` is the single trusted entry
 * point, mirroring `lib/chaos/replay-service.ts`'s `executeC01Replay`
 * pattern exactly, narrowed to C11's `payment.failed` semantics. Its ONLY
 * input is an internal `chaos_runs.id` — never a URL, host, endpoint,
 * target, script, SQL, fault string, replay count, authorization boolean,
 * raw webhook body, or Razorpay credential. Its sequence:
 *
 *   1. load the persisted chaos_run (PRE-SEC-011 — a run must already exist
 *      durably before it may ever execute, satisfied by Phase 3B's
 *      `chaos_runs` table itself);
 *   2. require it to be an eligible C11/no-fault-primitive/
 *      RECORDED_TEST_EVIDENCE PENDING run with a source correlation field
 *      present;
 *   3. independently re-resolve the ONE authoritative `payment.failed`
 *      source evidence via `lib/chaos/replay-repository.ts`'s
 *      `resolveAuthoritativeC11ReplaySource` (never trust anything cached
 *      on the run row beyond its own ID fields — never assume the evidence
 *      that made this run PENDING is still resolvable now);
 *   4. PRE-SEC-007: C11-B's internal replay requires no additional
 *      mechanism-specific Razorpay secret — the event was already
 *      authenticated when the canonical evidence was created;
 *   5. atomically claim PENDING -> RUNNING (never execute otherwise);
 *   6. create exactly `C11_REPLAY_ATTEMPT_COUNT` (1) new `PAYCHAOS_REPLAY`
 *      processing attempt, copying the original attempt's `normalized_event`
 *      VERBATIM (never recomputed, never reloaded from the Phase 3D-C JSON
 *      fixture), and run it through the existing, unmodified
 *      `processMerchantWebhookEvent` — never a second/duplicated merchant
 *      processor implementation;
 *   7. read (never gate business-outcome on) the correlated merchant
 *      post-state as deterministic evidence — a genuine technical read
 *      failure is a `FAILED`/`ERROR` execution outcome, but the CONTENT of
 *      a successful read never itself decides `COMPLETED` vs `FAILED`:
 *      Phase 3D never assigns invariant PASS/FAIL — that is Phase 3F's job
 *      (docs/MONEY_INVARIANTS.md INV-003/INV-004/INV-011);
 *   8. mark the run `COMPLETED`/`UNKNOWN` on success, or `FAILED`/`ERROR` on
 *      any technical execution failure after `RUNNING` was claimed.
 *
 * PRE-SEC-010 (operator/session authorization) is NOT this module's
 * concern — it is enforced by the untrusted HTTP boundary
 * (`app/api/chaos/runs/[runId]/execute-c11-b/route.ts`) before this function
 * is ever called, exactly like `lib/chaos/replay-service.ts`'s
 * `executeC01Replay`.
 *
 * This module NEVER: calls the Razorpay API or any HTTP/network endpoint
 * (no `fetch`, no `http.request`/`https.request`, no `axios`, no arbitrary
 * URL/host); inserts or updates `webhook_events`; calls
 * `record_webhook_duplicate_delivery`; imports `verifyCheckoutAction` or
 * `verifyCheckoutAndPersistPayment` (C11-B does not depend on browser
 * Checkout); loads `tests/fixtures/razorpay/payment-failed-test-mode.fixture.json`
 * or any other TEST_FIXTURE content at runtime. `C01_REPLAY_ATTEMPT_COUNT`
 * is never imported or reused here — `C11_REPLAY_ATTEMPT_COUNT` is its own,
 * independently declared, fixed constant (this task's Section 6): C01
 * deliberately tests duplicate-delivery handling (2 replays); C11-B tests
 * failed-payment safety and requires exactly 1.
 */
import "server-only";

import {
  insertReplayProcessingAttempt,
  resolveAuthoritativeC11ReplaySource,
} from "@/lib/chaos/replay-repository";
import {
  completeRunningC11BRunUnknown,
  failRunningC11BRunExecution,
  getChaosRunById,
  startPendingC11BRunAtomically,
  type ChaosRunRow,
} from "@/lib/chaos/run-repository";
import {
  MerchantProcessingError,
  processMerchantWebhookEvent,
} from "@/lib/events/processor";
import { markEventProcessingAttemptFailedIfNotFinal } from "@/lib/webhooks/event-processing-repository";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/security/logger";

/**
 * Fixed, server-owned replay count for C11-B (this task's Section 6 "Fixed
 * Replay Count"). Never accepted from a request body, query parameter,
 * environment variable, or any other caller input.
 */
export const C11_REPLAY_ATTEMPT_COUNT = 1;

export type C11ReplayServiceResult =
  | {
      readonly kind: "COMPLETED";
      readonly chaosRunId: string;
      readonly replayAttemptCount: number;
    }
  | {
      readonly kind: "NOT_STARTABLE";
      readonly reasonCategory:
        | "RUN_NOT_FOUND"
        | "RUN_NOT_ELIGIBLE"
        | "SOURCE_EVIDENCE_UNRESOLVED"
        | "ALREADY_STARTED_OR_NOT_PENDING";
    }
  | {
      readonly kind: "FAILED";
      readonly chaosRunId: string;
      readonly reasonCategory:
        | "EXECUTION_FAILED"
        | "POST_STATE_VERIFICATION_FAILED"
        | "COMPLETION_PERSISTENCE_FAILED";
    };

const SAFE_EXECUTION_FAILURE_REASON =
  "Chaos replay execution failed before the intended scenario could complete.";
const SAFE_POST_STATE_FAILURE_REASON =
  "Chaos replay execution completed, but the resulting merchant state could not be independently verified.";
const SAFE_FINALIZATION_FAILURE_REASON =
  "Chaos replay execution completed, but the final run state could not be persisted.";

/** Same safe-error-derivation convention as `lib/chaos/replay-service.ts` — never a raw database error, never a signature, never a secret. */
function deriveSafeReplayProcessorFailure(err: unknown): {
  readonly code: string;
  readonly message: string;
} {
  if (err instanceof MerchantProcessingError) {
    return { code: err.code, message: err.message };
  }
  return {
    code: "PROCESSING_TRANSACTION_FAILED",
    message: "Merchant processing failed.",
  };
}

/**
 * `true` only for a chaos_run C11-B is actually allowed to execute — every
 * field independently re-checked against the durably persisted row, never
 * assumed from caller intent. `fault_type` must be `null`: C11 has no fault
 * primitive of its own (`lib/chaos/registry.ts` — `allowedFaultTypes: []`).
 */
function isEligibleC11BPendingRun(run: ChaosRunRow): run is ChaosRunRow & {
  scenario_id: "C11";
  status: "PENDING";
  fault_type: null;
  data_classification: "RECORDED_TEST_EVIDENCE";
  source_webhook_event_id: string;
} {
  return (
    run.scenario_id === "C11" &&
    run.status === "PENDING" &&
    run.fault_type === null &&
    run.data_classification === "RECORDED_TEST_EVIDENCE" &&
    run.source_webhook_event_id !== null
  );
}

/**
 * Read-only post-replay merchant-state evidence collection (this task's
 * Section 11 "C11 Business Safety Post-Conditions"). Deliberately never
 * gates `COMPLETED` vs `FAILED` on the CONTENT of what it reads — only a
 * genuine technical read failure (thrown here) is treated as an execution
 * failure by the caller. This function never derives or returns an
 * invariant PASS/FAIL judgment; Phase 3F alone evaluates
 * INV-003/INV-004/INV-011. Reads `orders`/`payment_attempts`/`payments`/
 * `fulfilments` only — never writes to any of them.
 */
async function readC11PostReplayMerchantState(
  orderId: string,
  paymentAttemptId: string,
  paymentId: string | null,
): Promise<void> {
  const client = getSupabaseServerClient();

  const { error: orderError } = await client
    .from("orders")
    .select("payment_status, business_status")
    .eq("id", orderId)
    .single();
  if (orderError) {
    throw new Error("C11_POST_STATE_ORDER_READ_FAILED");
  }

  const { error: attemptError } = await client
    .from("payment_attempts")
    .select("status")
    .eq("id", paymentAttemptId)
    .single();
  if (attemptError) {
    throw new Error("C11_POST_STATE_ATTEMPT_READ_FAILED");
  }

  if (paymentId) {
    const { error: paymentError } = await client
      .from("payments")
      .select("razorpay_payment_status, captured_at")
      .eq("id", paymentId)
      .single();
    if (paymentError) {
      throw new Error("C11_POST_STATE_PAYMENT_READ_FAILED");
    }
  }

  const { error: fulfilmentError } = await client
    .from("fulfilments")
    .select("id")
    .eq("order_id", orderId);
  if (fulfilmentError) {
    throw new Error("C11_POST_STATE_FULFILMENT_READ_FAILED");
  }
}

/**
 * Executes C11-B's controlled real-webhook-evidence replay for one
 * already-persisted PENDING chaos run. See module doc comment for the full
 * sequence. Never throws for an ordinary "not eligible to run right now"
 * condition — those are `NOT_STARTABLE` results. A genuine infrastructure
 * failure reading the run or resolving source evidence (BEFORE the atomic
 * RUNNING claim, so nothing needs to be marked FAILED) propagates as an
 * exception; the caller (the untrusted route boundary) maps it to a safe
 * generic response.
 */
export async function executeC11RealWebhookReplay(
  chaosRunId: string,
): Promise<C11ReplayServiceResult> {
  const run = await getChaosRunById(chaosRunId);
  if (!run) {
    return { kind: "NOT_STARTABLE", reasonCategory: "RUN_NOT_FOUND" };
  }

  if (!isEligibleC11BPendingRun(run)) {
    return { kind: "NOT_STARTABLE", reasonCategory: "RUN_NOT_ELIGIBLE" };
  }

  // Independently re-resolve the authoritative source — never trust
  // anything beyond the run's own correlation fields, and never assume the
  // evidence that made this run PENDING is still resolvable now.
  const source = await resolveAuthoritativeC11ReplaySource({
    sourceWebhookEventId: run.source_webhook_event_id,
    paymentAttemptId: run.payment_attempt_id,
    paymentId: run.payment_id,
  });
  if (!source) {
    return {
      kind: "NOT_STARTABLE",
      reasonCategory: "SOURCE_EVIDENCE_UNRESOLVED",
    };
  }

  // PRE-SEC-007: nothing to check here by design (see module doc comment).
  // PRE-SEC-011: satisfied — `run` above was loaded from durable storage.

  const claimed = await startPendingC11BRunAtomically(chaosRunId);
  if (!claimed) {
    return {
      kind: "NOT_STARTABLE",
      reasonCategory: "ALREADY_STARTED_OR_NOT_PENDING",
    };
  }

  try {
    const replayAttempt = await insertReplayProcessingAttempt({
      chaosRunId,
      webhookEventId: source.webhookEventId,
      paymentAttemptId: source.paymentAttemptId,
      paymentId: source.paymentId,
      normalizedEvent: source.normalizedEvent,
    });
    try {
      await processMerchantWebhookEvent(replayAttempt.id);
    } catch (processingErr) {
      // The existing Phase 2 `processMerchantWebhookEvent` never persists a
      // FAILED status itself — that responsibility belongs to the caller,
      // exactly like `lib/chaos/replay-service.ts`'s C01 orchestration
      // already does via this same helper.
      const { code, message } = deriveSafeReplayProcessorFailure(processingErr);
      await markEventProcessingAttemptFailedIfNotFinal(
        replayAttempt.id,
        code,
        message,
      ).catch(() => {
        // Best-effort only — never mask the original processing failure
        // about to be rethrown.
      });
      throw processingErr;
    }
  } catch (err) {
    logEvent("chaos_c11b_replay_execution_failed", {
      chaos_run_id: chaosRunId,
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    await failRunningC11BRunExecution(
      chaosRunId,
      SAFE_EXECUTION_FAILURE_REASON,
    ).catch(() => {
      // Best-effort only — never mask the original execution failure this
      // function is about to report.
    });
    return { kind: "FAILED", chaosRunId, reasonCategory: "EXECUTION_FAILED" };
  }

  // Post-replay evidence collection (this task's Section 11). `orderId`/
  // `source.paymentAttemptId` are structurally guaranteed non-null for a
  // genuinely eligible C11-B run (Mechanism B's evidence resolution always
  // links both — `lib/chaos/run-service.ts`'s `resolvePendingRunMetadata`);
  // their unexpected absence here is itself treated as a technical
  // anomaly, never silently skipped.
  if (!claimed.order_id || !source.paymentAttemptId) {
    logEvent("chaos_c11b_post_state_verification_failed", {
      chaos_run_id: chaosRunId,
      error_name: "MissingCorrelationFields",
    });
    await failRunningC11BRunExecution(
      chaosRunId,
      SAFE_POST_STATE_FAILURE_REASON,
    ).catch(() => {});
    return {
      kind: "FAILED",
      chaosRunId,
      reasonCategory: "POST_STATE_VERIFICATION_FAILED",
    };
  }

  try {
    await readC11PostReplayMerchantState(
      claimed.order_id,
      source.paymentAttemptId,
      source.paymentId,
    );
  } catch (err) {
    logEvent("chaos_c11b_post_state_verification_failed", {
      chaos_run_id: chaosRunId,
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    await failRunningC11BRunExecution(
      chaosRunId,
      SAFE_POST_STATE_FAILURE_REASON,
    ).catch(() => {
      // Best-effort only — never mask the safe POST_STATE_VERIFICATION_FAILED
      // result this function is about to return.
    });
    return {
      kind: "FAILED",
      chaosRunId,
      reasonCategory: "POST_STATE_VERIFICATION_FAILED",
    };
  }

  // The replay succeeded and post-state evidence was collected, but the
  // run's own final COMPLETED/UNKNOWN transition might itself fail to
  // persist (a null return) or throw. Either way, the durable chaos_runs
  // row must never be knowingly abandoned as RUNNING — a best-effort
  // FAILED/ERROR finalization is attempted before reporting failure (same
  // discipline as `lib/chaos/replay-service.ts`'s `executeC01Replay`).
  let completed: ChaosRunRow | null;
  try {
    completed = await completeRunningC11BRunUnknown(chaosRunId);
  } catch (err) {
    logEvent("chaos_c11b_completion_persistence_failed", {
      chaos_run_id: chaosRunId,
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    completed = null;
  }

  if (!completed) {
    await failRunningC11BRunExecution(
      chaosRunId,
      SAFE_FINALIZATION_FAILURE_REASON,
    ).catch(() => {
      // Best-effort only — never fabricate a database state if this
      // best-effort call itself fails.
    });
    return {
      kind: "FAILED",
      chaosRunId,
      reasonCategory: "COMPLETION_PERSISTENCE_FAILED",
    };
  }

  return {
    kind: "COMPLETED",
    chaosRunId,
    replayAttemptCount: C11_REPLAY_ATTEMPT_COUNT,
  };
}
