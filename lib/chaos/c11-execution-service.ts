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

// ============================================================================
// PHASE 3D-E — C11-A GENUINE RAZORPAY TEST MODE FAILED-PAYMENT OBSERVATION
// ============================================================================
// Everything below this line is an ADDITIVE Phase 3D-E extension for C11-A
// (docs/CHAOS_SCENARIOS.md Section 23, Mechanism A). Nothing above this line
// is modified — C11-B's `executeC11RealWebhookReplay` and its behavior are
// byte-for-byte unchanged.
//
// C11-A is PURE OBSERVATION: no fault primitive, no Checkout interception,
// no client-confirmation suppression, no replay, no TEST_FIXTURE runtime
// path, no synthetic/forged webhook, no new payment-processing
// implementation. This module's only writes are to `chaos_runs`, through the
// narrow C11-A-specific `lib/chaos/run-repository.ts` lifecycle helpers.
// Merchant/payment/webhook/event_processing_attempt state is READ ONLY from
// this module (via `lib/chaos/c11-observation-repository.ts`).
//
// IMPORTANT ARCHITECTURE REFINEMENT (the single most important point in this
// extension): reconciliation NEVER gates `COMPLETED` vs `FAILED` on whether
// the observed merchant state looks "safe" (order not PAID, zero
// fulfilments, etc). Once authoritative `payment.failed` evidence is fully
// resolved and the required merchant-state reads succeed, the run
// completes — even if the observed state were unexpectedly PAID/FULFILLED/
// captured/fulfilment_count > 0. `NOT_YET_CONVERGED` means "authoritative
// evidence has not fully arrived/processed yet", never "merchant state
// violates the safety condition". Phase 3D gathers evidence; Phase 3F alone
// judges PASS/FAIL (INV-003/INV-004/INV-011).
import {
  readC11AObservedMerchantState,
  resolveC11AFailureObservationEvidence,
  type C11AObservationEvidence,
  type C11AObservationResolution,
} from "@/lib/chaos/c11-observation-repository";
import { getOrderBaseline, isFreshBaseline } from "@/lib/chaos/repository";
import {
  blockPendingC11ARunForPreSec007,
  completeRunningC11ARunWithEvidence,
  failRunningC11ARunExecution,
  startPendingC11ARunAtomically,
} from "@/lib/chaos/run-repository";
import { getRazorpayEnv } from "@/lib/config/razorpay-env";
import { getRazorpayWebhookSecret } from "@/lib/config/razorpay-webhook-env";

const SAFE_C11A_PRE_SEC_007_BLOCK_REASON =
  "Required server secrets for Razorpay Test Mode Checkout and webhook verification were unavailable.";
const SAFE_C11A_AMBIGUOUS_EVIDENCE_REASON =
  "Chaos observation could not converge because more than one candidate failure record was found.";
const SAFE_C11A_EVIDENCE_RESOLUTION_FAILURE_REASON =
  "Chaos observation failed before authoritative failure evidence could be resolved.";
const SAFE_C11A_POST_STATE_FAILURE_REASON =
  "Chaos observation completed evidence resolution, but the resulting merchant state could not be independently verified.";
const SAFE_C11A_CANCEL_REASON =
  "The C11-A observation was explicitly cancelled by the operator.";

/**
 * `true` only for a chaos_run C11-A is actually allowed to start — every
 * field independently re-checked against the durably persisted row, never
 * assumed from caller intent (this task's Section 3 disambiguation from
 * C11-B).
 */
function isEligiblePendingC11ARun(run: ChaosRunRow): run is ChaosRunRow & {
  scenario_id: "C11";
  status: "PENDING";
  fault_type: null;
  data_classification: "RECORDED_TEST_EVIDENCE";
  order_id: string;
} {
  return (
    run.scenario_id === "C11" &&
    run.status === "PENDING" &&
    run.fault_type === null &&
    run.data_classification === "RECORDED_TEST_EVIDENCE" &&
    run.order_id !== null &&
    run.source_webhook_event_id === null &&
    run.payment_id === null &&
    run.payment_attempt_id === null
  );
}

/** Never claim BLOCKED unless the durable returned row proves the exact execution-time BLOCKED shape. */
function isValidC11APreSec007BlockedShape(
  row: ChaosRunRow,
  chaosRunId: string,
): boolean {
  return (
    row.id === chaosRunId &&
    row.scenario_id === "C11" &&
    row.fault_type === null &&
    row.data_classification === "RECORDED_TEST_EVIDENCE" &&
    row.status === "COMPLETED" &&
    row.outcome === "BLOCKED" &&
    row.failed_precheck_id === null &&
    row.execution_block_code === "PRE-SEC-007" &&
    row.started_at === null &&
    row.completed_at !== null
  );
}

/** The exact fixed shape this module will ever accept as proof of a genuine RUNNING/observing transition. */
function isValidObservingShape(
  row: ChaosRunRow,
  chaosRunId: string,
  expectedOrderId: string,
): boolean {
  return (
    row.id === chaosRunId &&
    row.scenario_id === "C11" &&
    row.fault_type === null &&
    row.data_classification === "RECORDED_TEST_EVIDENCE" &&
    row.status === "RUNNING" &&
    row.order_id === expectedOrderId &&
    row.started_at !== null &&
    row.source_webhook_event_id === null
  );
}

export type C11AStartResult =
  | { readonly kind: "OBSERVING"; readonly chaosRunId: string }
  | { readonly kind: "BLOCKED_PRE_SEC_007"; readonly chaosRunId: string }
  | { readonly kind: "BLOCK_PERSISTENCE_FAILED"; readonly chaosRunId: string }
  | {
      readonly kind: "NOT_STARTABLE";
      readonly reasonCategory:
        | "RUN_NOT_FOUND"
        | "RUN_NOT_ELIGIBLE"
        | "BASELINE_NOT_FRESH"
        | "ALREADY_STARTED_OR_NOT_PENDING"
        | "START_PERSISTENCE_UNVERIFIED";
    };

/**
 * Starts C11-A's pure observation lifecycle for one already-persisted
 * PENDING chaos run (this task's Section 12). Never creates the merchant
 * order or fabricates any evidence — the run must already carry a
 * genuinely resolved `order_id` from the real production `createChaosRun`
 * path (this task's Section 2, frozen). Sequence: load run -> verify exact
 * C11-A PENDING shape -> verify trusted order baseline remains fresh ->
 * verify PRE-SEC-007 configuration -> atomically claim PENDING -> RUNNING ->
 * independently validate the returned durable row.
 */
export async function startC11AFailureObservation(
  chaosRunId: string,
): Promise<C11AStartResult> {
  const run = await getChaosRunById(chaosRunId);
  if (!run) {
    return { kind: "NOT_STARTABLE", reasonCategory: "RUN_NOT_FOUND" };
  }

  if (!isEligiblePendingC11ARun(run)) {
    return { kind: "NOT_STARTABLE", reasonCategory: "RUN_NOT_ELIGIBLE" };
  }

  const orderId = run.order_id;

  // This task's Section 11 — re-read the trusted order baseline
  // immediately before claiming RUNNING; a run may sit PENDING for a while
  // after createChaosRun. If it is no longer fresh, do not start
  // observation, do not alter merchant state, do not invent a PRECHECK
  // result — follow the same execution-time eligibility-failure semantics
  // C07's arm function uses.
  const baseline = await getOrderBaseline(orderId);
  if (!baseline || !isFreshBaseline(baseline)) {
    return { kind: "NOT_STARTABLE", reasonCategory: "BASELINE_NOT_FRESH" };
  }

  // PRE-SEC-007: required server secrets exist for the Razorpay Test Mode
  // Checkout AND webhook path C11-A's observation depends on later (this
  // task's Section 10, mirroring C07's arm discipline exactly). Neither
  // returned value is ever read/used beyond whether this call throws.
  try {
    getRazorpayEnv();
    getRazorpayWebhookSecret();
  } catch {
    let blockedRun: ChaosRunRow | null = null;
    try {
      blockedRun = await blockPendingC11ARunForPreSec007(
        chaosRunId,
        SAFE_C11A_PRE_SEC_007_BLOCK_REASON,
      );
    } catch (err) {
      logEvent("chaos_c11a_pre_sec_007_block_persistence_failed", {
        chaos_run_id: chaosRunId,
        error_name: err instanceof Error ? err.name : "UnknownError",
      });
      return { kind: "BLOCK_PERSISTENCE_FAILED", chaosRunId };
    }

    if (
      !blockedRun ||
      !isValidC11APreSec007BlockedShape(blockedRun, chaosRunId)
    ) {
      logEvent("chaos_c11a_pre_sec_007_block_persistence_failed", {
        chaos_run_id: chaosRunId,
      });
      return { kind: "BLOCK_PERSISTENCE_FAILED", chaosRunId };
    }

    return { kind: "BLOCKED_PRE_SEC_007", chaosRunId };
  }

  const claimed = await startPendingC11ARunAtomically(chaosRunId);
  if (!claimed) {
    return {
      kind: "NOT_STARTABLE",
      reasonCategory: "ALREADY_STARTED_OR_NOT_PENDING",
    };
  }

  if (!isValidObservingShape(claimed, chaosRunId, orderId)) {
    logEvent("chaos_c11a_start_persistence_unverified", {
      chaos_run_id: chaosRunId,
    });
    return {
      kind: "NOT_STARTABLE",
      reasonCategory: "START_PERSISTENCE_UNVERIFIED",
    };
  }

  return { kind: "OBSERVING", chaosRunId };
}

/** Exact durable completion proof — independently validates every required fact on the returned row before a caller may ever report `COMPLETED`. */
function isValidCompletedC11AShape(
  row: ChaosRunRow,
  chaosRunId: string,
  expectedOrderId: string,
  evidence: C11AObservationEvidence,
): boolean {
  return (
    row.id === chaosRunId &&
    row.scenario_id === "C11" &&
    row.fault_type === null &&
    row.data_classification === "RECORDED_TEST_EVIDENCE" &&
    row.order_id === expectedOrderId &&
    row.status === "COMPLETED" &&
    row.outcome === "UNKNOWN" &&
    row.payment_attempt_id === evidence.paymentAttemptId &&
    row.payment_id === evidence.paymentId &&
    row.source_webhook_event_id === evidence.webhookEventId &&
    row.started_at !== null &&
    row.completed_at !== null &&
    row.failed_precheck_id === null &&
    row.execution_block_code === null
  );
}

/**
 * Architect correction round 1 (Phase 3D-E) — exact durable technical-
 * failure proof. Independently validates every required fact on the row
 * returned from `failRunningC11ARunExecution` before a caller may ever
 * report `FAILED`. Verified persisted state is authoritative in this
 * codebase: a service result must never claim `FAILED` merely because the
 * failure-update function was called and did not throw. `payment_attempt_id`/
 * `payment_id` must still be `null` here — C11-A only ever attaches those
 * evidence FKs via `completeRunningC11ARunWithEvidence` on a successful
 * `COMPLETED` reconciliation, which a technical-failure path (by
 * definition) never reached.
 */
function isValidFailedC11AShape(
  row: ChaosRunRow,
  chaosRunId: string,
  expectedOrderId: string,
): boolean {
  return (
    row.id === chaosRunId &&
    row.scenario_id === "C11" &&
    row.fault_type === null &&
    row.data_classification === "RECORDED_TEST_EVIDENCE" &&
    row.order_id === expectedOrderId &&
    row.status === "FAILED" &&
    row.outcome === "ERROR" &&
    row.started_at !== null &&
    row.completed_at !== null &&
    row.failed_precheck_id === null &&
    row.execution_block_code === null &&
    row.source_webhook_event_id === null &&
    row.payment_attempt_id === null &&
    row.payment_id === null &&
    row.error_message_redacted !== null
  );
}

/**
 * Persists a C11-A technical reconciliation failure and independently
 * verifies the durable result — the single choke point every technical
 * reconciliation failure path in `reconcileC11AFailedPaymentObservation`
 * routes through (architect correction round 1, Sections 3-6). Returns
 * `true` only when `failRunningC11ARunExecution` both succeeded and its
 * returned row is independently proven to be the exact expected
 * `FAILED`/`ERROR` shape via `isValidFailedC11AShape`. Returns `false` for
 * a thrown persistence error, a `null` return (no matching row — e.g. the
 * run was concurrently cancelled/mutated), or an unexpected returned
 * shape — in every `false` case the caller must report
 * `FAILURE_PERSISTENCE_FAILED`, never `FAILED`. Never exposes the raw
 * persistence error to any caller.
 */
async function persistAndVerifyC11ATechnicalFailure(
  chaosRunId: string,
  expectedOrderId: string,
  safeReason: string,
): Promise<boolean> {
  let row: ChaosRunRow | null;
  try {
    row = await failRunningC11ARunExecution(chaosRunId, safeReason);
  } catch {
    return false;
  }
  return (
    row !== null && isValidFailedC11AShape(row, chaosRunId, expectedOrderId)
  );
}

export type C11AReconcileResult =
  | { readonly kind: "COMPLETED"; readonly chaosRunId: string }
  | { readonly kind: "NOT_YET_CONVERGED"; readonly chaosRunId: string }
  | {
      readonly kind: "NOT_RECONCILABLE";
      readonly reasonCategory: "RUN_NOT_FOUND" | "RUN_NOT_ELIGIBLE";
    }
  | {
      readonly kind: "FAILED";
      readonly chaosRunId: string;
      readonly reasonCategory:
        | "AMBIGUOUS_EVIDENCE"
        | "EVIDENCE_RESOLUTION_FAILED"
        | "POST_STATE_VERIFICATION_FAILED";
    }
  | {
      readonly kind: "FAILURE_PERSISTENCE_FAILED";
      readonly chaosRunId: string;
    }
  | {
      readonly kind: "COMPLETION_PERSISTENCE_FAILED";
      readonly chaosRunId: string;
    };

/**
 * Reconciles a RUNNING C11-A observation against authoritative provider
 * evidence (this task's Section 13). A stateless CHECK NOW — never sleeps,
 * polls internally, uses timers, holds a request open, or creates a
 * background job (this task's Section 17). Safe to call repeatedly before
 * convergence: every call before genuine evidence exists mutates NOTHING
 * and returns `NOT_YET_CONVERGED`.
 *
 * Flow: load run -> verify exact eligible RUNNING C11-A shape -> call the
 * read-only observation resolver -> if evidence has not arrived yet, return
 * `NOT_YET_CONVERGED` with zero mutation; if evidence is ambiguous or a
 * genuine technical read failure occurs, attempt to terminalize
 * `FAILED`/`ERROR` and return `FAILED` ONLY once
 * `persistAndVerifyC11ATechnicalFailure` independently proves the durable
 * row actually reached that exact shape — a thrown/`null`/wrongly-shaped
 * persistence result instead returns `FAILURE_PERSISTENCE_FAILED`, never a
 * fabricated `FAILED` (architect correction round 1: verified persisted
 * state is authoritative — this function must never claim `FAILED` merely
 * because the failure-update call was made); if evidence resolves uniquely,
 * collect merchant post-state read-only (never gating on its content) and
 * complete `RUNNING -> COMPLETED`/`UNKNOWN`, independently re-validating
 * the returned durable row before ever reporting `COMPLETED`.
 */
export async function reconcileC11AFailedPaymentObservation(
  chaosRunId: string,
): Promise<C11AReconcileResult> {
  const run = await getChaosRunById(chaosRunId);
  if (!run) {
    return { kind: "NOT_RECONCILABLE", reasonCategory: "RUN_NOT_FOUND" };
  }

  const isEligibleRunningC11A =
    run.scenario_id === "C11" &&
    run.status === "RUNNING" &&
    run.fault_type === null &&
    run.data_classification === "RECORDED_TEST_EVIDENCE" &&
    run.order_id !== null &&
    run.source_webhook_event_id === null;

  if (!isEligibleRunningC11A) {
    return { kind: "NOT_RECONCILABLE", reasonCategory: "RUN_NOT_ELIGIBLE" };
  }

  const orderId = run.order_id as string;
  // `started_at` is guaranteed non-null for a genuinely RUNNING row (every
  // RUNNING transition in this module sets it atomically alongside status).
  const runStartedAt = run.started_at as string;

  let resolution: C11AObservationResolution;
  try {
    resolution = await resolveC11AFailureObservationEvidence(
      orderId,
      runStartedAt,
    );
  } catch (err) {
    logEvent("chaos_c11a_evidence_resolution_failed", {
      chaos_run_id: chaosRunId,
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    const persisted = await persistAndVerifyC11ATechnicalFailure(
      chaosRunId,
      orderId,
      SAFE_C11A_EVIDENCE_RESOLUTION_FAILURE_REASON,
    );
    if (!persisted) {
      logEvent("chaos_c11a_failure_persistence_unverified", {
        chaos_run_id: chaosRunId,
        reason_category: "EVIDENCE_RESOLUTION_FAILED",
      });
      return { kind: "FAILURE_PERSISTENCE_FAILED", chaosRunId };
    }
    return {
      kind: "FAILED",
      chaosRunId,
      reasonCategory: "EVIDENCE_RESOLUTION_FAILED",
    };
  }

  if (resolution.kind === "NOT_YET_CONVERGED") {
    return { kind: "NOT_YET_CONVERGED", chaosRunId };
  }

  if (resolution.kind === "AMBIGUOUS") {
    logEvent("chaos_c11a_ambiguous_evidence", { chaos_run_id: chaosRunId });
    const persisted = await persistAndVerifyC11ATechnicalFailure(
      chaosRunId,
      orderId,
      SAFE_C11A_AMBIGUOUS_EVIDENCE_REASON,
    );
    if (!persisted) {
      logEvent("chaos_c11a_failure_persistence_unverified", {
        chaos_run_id: chaosRunId,
        reason_category: "AMBIGUOUS_EVIDENCE",
      });
      return { kind: "FAILURE_PERSISTENCE_FAILED", chaosRunId };
    }
    return {
      kind: "FAILED",
      chaosRunId,
      reasonCategory: "AMBIGUOUS_EVIDENCE",
    };
  }

  // resolution.kind === "RESOLVED" — collect observed merchant state
  // read-only. Its CONTENT never gates COMPLETED vs FAILED (architect
  // refinement, module doc comment) — only a genuine read failure does.
  const evidence = resolution.evidence;
  try {
    await readC11AObservedMerchantState(
      orderId,
      evidence.paymentAttemptId,
      evidence.paymentId,
    );
  } catch (err) {
    logEvent("chaos_c11a_post_state_verification_failed", {
      chaos_run_id: chaosRunId,
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    const persisted = await persistAndVerifyC11ATechnicalFailure(
      chaosRunId,
      orderId,
      SAFE_C11A_POST_STATE_FAILURE_REASON,
    );
    if (!persisted) {
      logEvent("chaos_c11a_failure_persistence_unverified", {
        chaos_run_id: chaosRunId,
        reason_category: "POST_STATE_VERIFICATION_FAILED",
      });
      return { kind: "FAILURE_PERSISTENCE_FAILED", chaosRunId };
    }
    return {
      kind: "FAILED",
      chaosRunId,
      reasonCategory: "POST_STATE_VERIFICATION_FAILED",
    };
  }

  let completed: ChaosRunRow | null;
  try {
    completed = await completeRunningC11ARunWithEvidence(chaosRunId, orderId, {
      paymentAttemptId: evidence.paymentAttemptId,
      paymentId: evidence.paymentId,
      sourceWebhookEventId: evidence.webhookEventId,
    });
  } catch (err) {
    logEvent("chaos_c11a_completion_persistence_failed", {
      chaos_run_id: chaosRunId,
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    return { kind: "COMPLETION_PERSISTENCE_FAILED", chaosRunId };
  }

  if (
    !completed ||
    !isValidCompletedC11AShape(completed, chaosRunId, orderId, evidence)
  ) {
    logEvent("chaos_c11a_completion_persistence_failed", {
      chaos_run_id: chaosRunId,
    });
    return { kind: "COMPLETION_PERSISTENCE_FAILED", chaosRunId };
  }

  return { kind: "COMPLETED", chaosRunId };
}

/** Exact durable cancellation proof — independently re-validates every required fact on the returned row before ever reporting `CANCELLED`. */
function isValidCancelledC11AShape(
  row: ChaosRunRow,
  chaosRunId: string,
): boolean {
  return (
    row.id === chaosRunId &&
    row.scenario_id === "C11" &&
    row.fault_type === null &&
    row.data_classification === "RECORDED_TEST_EVIDENCE" &&
    row.status === "FAILED" &&
    row.outcome === "ERROR" &&
    row.completed_at !== null &&
    row.started_at !== null &&
    row.failed_precheck_id === null &&
    row.execution_block_code === null &&
    row.error_message_redacted !== null
  );
}

export type C11ACancelResult =
  | { readonly kind: "CANCELLED"; readonly chaosRunId: string }
  | {
      readonly kind: "NOT_CANCELLABLE";
      readonly reasonCategory:
        "RUN_NOT_FOUND" | "RUN_NOT_ELIGIBLE" | "RUN_NOT_RUNNING";
    }
  | {
      readonly kind: "CANCEL_PERSISTENCE_FAILED";
      readonly chaosRunId: string;
    };

/**
 * Explicit, operator-initiated-only cancellation of a RUNNING C11-A
 * observation (this task's Section 16 — required because a genuine external
 * Razorpay Test Mode payment is performed manually, so the operator needs a
 * safe way to abandon a RUNNING observation if the payment is never
 * performed or suitable evidence cannot be produced). `RUNNING ->
 * FAILED`/`ERROR` with a fixed safe reason. Never deletes the run, never
 * mutates merchant/payment/webhook evidence, never converts to `BLOCKED`
 * after `RUNNING`. Reuses the same `failRunningC11ARunExecution` repository
 * primitive as a genuine technical reconciliation failure — the distinct
 * fixed reason string and this function's own eligibility/logging keep the
 * two conceptually and observably separate.
 */
export async function cancelRunningC11AObservation(
  chaosRunId: string,
): Promise<C11ACancelResult> {
  const run = await getChaosRunById(chaosRunId);
  if (!run) {
    return { kind: "NOT_CANCELLABLE", reasonCategory: "RUN_NOT_FOUND" };
  }

  const isEligibleC11A =
    run.scenario_id === "C11" &&
    run.fault_type === null &&
    run.data_classification === "RECORDED_TEST_EVIDENCE" &&
    run.order_id !== null &&
    run.source_webhook_event_id === null;

  if (!isEligibleC11A) {
    return { kind: "NOT_CANCELLABLE", reasonCategory: "RUN_NOT_ELIGIBLE" };
  }

  if (run.status !== "RUNNING") {
    return { kind: "NOT_CANCELLABLE", reasonCategory: "RUN_NOT_RUNNING" };
  }

  let cancelled: ChaosRunRow | null;
  try {
    cancelled = await failRunningC11ARunExecution(
      chaosRunId,
      SAFE_C11A_CANCEL_REASON,
    );
  } catch (err) {
    logEvent("chaos_c11a_cancel_persistence_failed_or_unverified", {
      chaos_run_id: chaosRunId,
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    return { kind: "CANCEL_PERSISTENCE_FAILED", chaosRunId };
  }

  if (!cancelled || !isValidCancelledC11AShape(cancelled, chaosRunId)) {
    logEvent("chaos_c11a_cancel_persistence_failed_or_unverified", {
      chaos_run_id: chaosRunId,
    });
    return { kind: "CANCEL_PERSISTENCE_FAILED", chaosRunId };
  }

  return { kind: "CANCELLED", chaosRunId };
}
