/**
 * Phase 3D-B (correction round) — server-only orchestration for C07
 * (Payment Succeeds but Client Confirmation Is Lost), fault_type
 * `DROP_CLIENT_CONFIRMATION` (docs/CHAOS_SCENARIOS.md Section 19).
 *
 * C07 proves that merchant correctness does not depend on the browser
 * success callback. This module's four responsibilities:
 *
 *   - `armC07ClientConfirmationDrop(chaosRunId)` — atomically arms an
 *     eligible PENDING C07 run;
 *   - `checkAndSuppressC07ClientConfirmation(input)` — called from
 *     `app/demo-merchant/actions.ts`'s `verifyCheckoutAction` to decide
 *     whether a real Checkout success callback must be suppressed;
 *   - `reconcileC07ClientConfirmationDrop(chaosRunId)` — completes the run
 *     only once authoritative webhook-driven convergence is proven;
 *   - `cancelRunningC07Fault(chaosRunId)` — explicit operator cancellation.
 *
 * ============================================================================
 * CORRECTION ROUND — BLOCKER 1: AUTHENTICATED FIRST CONSUME
 * ============================================================================
 * The prior round transitioned `fault_state.consumed` false->true based
 * only on the `paymentAttemptId`/order relationship — it never verified
 * that the browser's Checkout fields (`razorpayOrderId`, `razorpaySignature`)
 * actually authenticate a genuine Checkout success response. A caller who
 * merely knew a `paymentAttemptId` could submit bogus Checkout fields,
 * cause `consumed=true`, and let a later genuine webhook complete
 * reconciliation even though no genuine confirmation was ever intercepted.
 *
 * `checkAndSuppressC07ClientConfirmation` now receives the SAME Checkout
 * fields `verifyCheckoutAction` already receives from the browser
 * (`paymentAttemptId`, `razorpayPaymentId`, `razorpayOrderId`,
 * `razorpaySignature` — never a chaos run id, fault switch, or scenario
 * field) and, for the FIRST unconsumed active fault, independently:
 *   1. resolves the trusted persisted payment attempt;
 *   2. requires it to already carry a trusted `razorpay_order_id`;
 *   3. requires the browser's `razorpayOrderId` to equal that trusted value
 *      (the same rule `lib/demo-merchant/service.ts`'s
 *      `verifyCheckoutAndPersistPayment` already enforces);
 *   4. verifies the Checkout HMAC via the frozen, reused
 *      `verifyCheckoutSignature` (`lib/razorpay/checkout-verification.ts`)
 *      — never a reimplementation, never logged, never persisted.
 * Only once all four succeed does `consumed` ever become `true`. This
 * authenticates that the fault trigger is genuine WITHOUT persisting
 * Checkout evidence and WITHOUT making the browser authoritative over
 * money state — `verifyCheckoutAndPersistPayment` is never called for a
 * suppressed confirmation; the webhook remains the sole authority for
 * final merchant/payment convergence.
 *
 * An invalid candidate confirmation (missing trusted order id, order
 * mismatch, invalid signature, or the verifier's own configuration
 * unavailable) never consumes the fault, never calls
 * `verifyCheckoutAndPersistPayment`, and never persists any evidence — it
 * returns a safe, narrow `REJECTED_INVALID_CONFIRMATION` result.
 *
 * ============================================================================
 * CORRECTION ROUND — BLOCKER 3: EXACT FAULT_STATE / PROVENANCE
 * ============================================================================
 * Every persisted `fault_state` this module reads is validated through the
 * ONE pure `parseExactC07FaultState` validator (`lib/chaos/c07-repository.ts`)
 * — an extra key or a non-boolean `consumed` fails closed: never treated as
 * active, never suppresses, never reconciles.
 *
 * ============================================================================
 * CORRECTION ROUND — BLOCKER 4: DURABLE TERMINAL STATE IS AUTHORITATIVE
 * ============================================================================
 * Completion and cancellation now independently re-validate the EXACT
 * returned durable row (id, scenario, fault type, classification, order,
 * status, outcome, evidence FKs, fault_state, timestamps,
 * failed_precheck_id/execution_block_code) before ever reporting
 * `COMPLETED`/`CANCELLED` — matching the same principle already applied to
 * PRE-SEC-007 BLOCKED handling and to C03's correction round. A throw,
 * `null`, lost race, or wrong shape reports a distinct
 * `COMPLETION_PERSISTENCE_FAILED`/`CANCEL_PERSISTENCE_FAILED` instead. Both
 * persistence calls are now wrapped in a narrow try/catch (final correction
 * round, Blocker B) so a repository throw maps to the same safe typed
 * failure rather than propagating unhandled — never re-mutating the durable
 * row to compensate. The earlier authoritative-evidence READ inside
 * reconciliation is deliberately NOT wrapped this way — a transient read
 * failure must keep propagating and leave the run RUNNING.
 *
 * ============================================================================
 * FINAL CORRECTION ROUND — BLOCKER A: CANCELLATION IS ATOMIC WITH PRE-STATE
 * ============================================================================
 * The prior round validated the pre-cancel `fault_state` and the post-
 * cancel returned row separately, leaving a race: a genuine consume could
 * flip `fault_state` between the read and the cancel `UPDATE`, and the
 * `UPDATE` (scoped only on id/order/scenario/fault/status) could still
 * terminalize the run while silently preserving the new `consumed` value —
 * only being caught by the post-hoc shape check, by which point the run had
 * already been (incorrectly) terminalized. The repository's cancel
 * mutation now takes the caller's server-validated `expectedConsumed`
 * boolean and builds `{armed: true, consumed: expectedConsumed}` itself,
 * requiring EXACT equality against the persisted `fault_state` as part of
 * the SAME atomic conditional `UPDATE` — never a caller-supplied JSON
 * object, never `.contains()`. A losing race now correctly matches zero
 * rows rather than silently terminalizing a run whose fault was actually
 * consumed by someone else first.
 *
 * This module NEVER: calls the Razorpay API or any HTTP/network endpoint;
 * invokes the public webhook route; imports `verifyCheckoutAction` or
 * `verifyCheckoutAndPersistPayment`; writes to `orders`, `payment_attempts`,
 * `payments`, `fulfilments`, `webhook_events`, or
 * `event_processing_attempts`. The only production writes performed by C07
 * chaos code are to `chaos_runs`.
 */
import "server-only";

import { getOrderBaseline, isFreshBaseline } from "@/lib/chaos/repository";
import {
  isExactArmedConsumedFaultState,
  isExactArmedUnconsumedFaultState,
  parseExactC07FaultState,
  resolveActiveArmedC07FaultForOrder,
  resolveC07ConvergenceEvidence,
  resolveTrustedPaymentAttemptForC07,
  type C07ExactFaultState,
  type ChaosRunRow,
} from "@/lib/chaos/c07-repository";
import {
  blockPendingC07RunForPreSec007,
  cancelRunningC07Fault as cancelRunningC07FaultRepo,
  completeRunningC07RunWithEvidence,
  consumeC07ClientConfirmationDrop,
  getChaosRunById,
  startPendingC07RunAtomically,
} from "@/lib/chaos/run-repository";
import { getRazorpayEnv } from "@/lib/config/razorpay-env";
import { getRazorpayWebhookSecret } from "@/lib/config/razorpay-webhook-env";
import { verifyCheckoutSignature } from "@/lib/razorpay/checkout-verification";
import { logEvent } from "@/lib/security/logger";

const SAFE_PRE_SEC_007_BLOCK_REASON =
  "Required server secrets for Razorpay Test Mode Checkout and webhook verification were unavailable.";
const SAFE_CANCEL_REASON =
  "The C07 fault was explicitly cancelled by the operator.";

function isEligiblePendingC07Run(run: ChaosRunRow): boolean {
  return (
    run.scenario_id === "C07" &&
    run.status === "PENDING" &&
    run.fault_type === "DROP_CLIENT_CONFIRMATION" &&
    run.data_classification === "RECORDED_TEST_EVIDENCE" &&
    run.order_id !== null
  );
}

/** Never claim BLOCKED unless the durable returned row proves the exact execution-time BLOCKED shape. */
function isValidPreSec007BlockedShape(
  row: ChaosRunRow,
  chaosRunId: string,
): boolean {
  return (
    row.id === chaosRunId &&
    row.scenario_id === "C07" &&
    row.fault_type === "DROP_CLIENT_CONFIRMATION" &&
    row.data_classification === "RECORDED_TEST_EVIDENCE" &&
    row.status === "COMPLETED" &&
    row.outcome === "BLOCKED" &&
    row.failed_precheck_id === null &&
    row.execution_block_code === "PRE-SEC-007" &&
    row.started_at === null &&
    row.completed_at !== null
  );
}

/** The exact fixed shape this module will ever accept as proof of a genuine ARMED transition. */
function isValidArmedShape(
  row: ChaosRunRow,
  chaosRunId: string,
  expectedOrderId: string,
): boolean {
  return (
    row.id === chaosRunId &&
    row.scenario_id === "C07" &&
    row.fault_type === "DROP_CLIENT_CONFIRMATION" &&
    row.data_classification === "RECORDED_TEST_EVIDENCE" &&
    row.status === "RUNNING" &&
    row.order_id === expectedOrderId &&
    row.started_at !== null &&
    isExactArmedUnconsumedFaultState(row.fault_state)
  );
}

export type C07ArmResult =
  | { readonly kind: "ARMED"; readonly chaosRunId: string }
  | { readonly kind: "BLOCKED_PRE_SEC_007"; readonly chaosRunId: string }
  | { readonly kind: "BLOCK_PERSISTENCE_FAILED"; readonly chaosRunId: string }
  | {
      readonly kind: "NOT_STARTABLE";
      readonly reasonCategory:
        | "RUN_NOT_FOUND"
        | "RUN_NOT_ELIGIBLE"
        | "BASELINE_NOT_FRESH"
        | "ALREADY_ARMED_FOR_ORDER"
        | "ALREADY_STARTED_OR_NOT_PENDING"
        | "ARM_PERSISTENCE_UNVERIFIED";
    };

/**
 * Arms C07's client-confirmation-drop fault for one already-persisted
 * PENDING chaos run. Never creates the merchant order, fabricates a
 * payment attempt, or fabricates a webhook — the run must already carry a
 * genuinely resolved `order_id` from the real production `createChaosRun`
 * path.
 */
export async function armC07ClientConfirmationDrop(
  chaosRunId: string,
): Promise<C07ArmResult> {
  const run = await getChaosRunById(chaosRunId);
  if (!run) {
    return { kind: "NOT_STARTABLE", reasonCategory: "RUN_NOT_FOUND" };
  }

  if (!isEligiblePendingC07Run(run)) {
    return { kind: "NOT_STARTABLE", reasonCategory: "RUN_NOT_ELIGIBLE" };
  }

  const orderId = run.order_id as string;
  const baseline = await getOrderBaseline(orderId);
  if (!baseline || !isFreshBaseline(baseline)) {
    return { kind: "NOT_STARTABLE", reasonCategory: "BASELINE_NOT_FRESH" };
  }

  // PRE-SEC-007: required server secrets exist for Razorpay Test Mode
  // Checkout AND webhook verification. Neither returned value is ever
  // read/used beyond whether this call throws.
  try {
    getRazorpayEnv();
    getRazorpayWebhookSecret();
  } catch {
    let blockedRun: ChaosRunRow | null = null;
    try {
      blockedRun = await blockPendingC07RunForPreSec007(
        chaosRunId,
        SAFE_PRE_SEC_007_BLOCK_REASON,
      );
    } catch (err) {
      logEvent("chaos_c07_pre_sec_007_block_persistence_failed", {
        chaos_run_id: chaosRunId,
        error_name: err instanceof Error ? err.name : "UnknownError",
      });
      return { kind: "BLOCK_PERSISTENCE_FAILED", chaosRunId };
    }

    if (!blockedRun || !isValidPreSec007BlockedShape(blockedRun, chaosRunId)) {
      logEvent("chaos_c07_pre_sec_007_block_persistence_failed", {
        chaos_run_id: chaosRunId,
      });
      return { kind: "BLOCK_PERSISTENCE_FAILED", chaosRunId };
    }

    return { kind: "BLOCKED_PRE_SEC_007", chaosRunId };
  }

  const claimed = await startPendingC07RunAtomically(chaosRunId);

  if (claimed.kind === "ALREADY_ARMED_FOR_ORDER") {
    return { kind: "NOT_STARTABLE", reasonCategory: "ALREADY_ARMED_FOR_ORDER" };
  }
  if (claimed.kind === "NOT_ELIGIBLE") {
    return {
      kind: "NOT_STARTABLE",
      reasonCategory: "ALREADY_STARTED_OR_NOT_PENDING",
    };
  }

  if (!isValidArmedShape(claimed.run, chaosRunId, orderId)) {
    logEvent("chaos_c07_arm_persistence_unverified", {
      chaos_run_id: chaosRunId,
    });
    return {
      kind: "NOT_STARTABLE",
      reasonCategory: "ARM_PERSISTENCE_UNVERIFIED",
    };
  }

  return { kind: "ARMED", chaosRunId };
}

export interface C07CheckoutConfirmationInput {
  readonly paymentAttemptId: string;
  readonly razorpayPaymentId: string;
  readonly razorpayOrderId: string;
  readonly razorpaySignature: string;
}

export type C07InvalidConfirmationReasonCategory =
  | "TRUSTED_RAZORPAY_ORDER_MISSING"
  | "ORDER_MISMATCH"
  | "SIGNATURE_INVALID"
  | "VERIFICATION_UNAVAILABLE";

export type C07SuppressionResult =
  | { readonly kind: "SUPPRESSED"; readonly chaosRunId: string }
  | { readonly kind: "NOT_SUPPRESSED" }
  | {
      readonly kind: "REJECTED_INVALID_CONFIRMATION";
      readonly reasonCategory: C07InvalidConfirmationReasonCategory;
    };

/**
 * Called from `app/demo-merchant/actions.ts`'s `verifyCheckoutAction`
 * before any real Checkout verification. Receives the SAME Checkout fields
 * the browser already submits to `verifyCheckoutAction` — never a chaos
 * run id, fault switch, scenario id, or "authorized" boolean.
 *
 * See module doc comment ("BLOCKER 1") for the full authenticated-consume
 * design. Consume semantics (architect retry correction, preserved):
 * `consumed=true` already established suppresses immediately, without
 * re-verification or another mutation — only the FIRST (`consumed=false`)
 * candidate is authenticated. A losing race on the atomic consume re-reads
 * the active fault: still RUNNING + exactly armed -> still suppressed; no
 * longer active (an explicit cancel raced in) -> NOT_SUPPRESSED.
 */
export async function checkAndSuppressC07ClientConfirmation(
  input: C07CheckoutConfirmationInput,
): Promise<C07SuppressionResult> {
  const attempt = await resolveTrustedPaymentAttemptForC07(
    input.paymentAttemptId,
  );
  if (!attempt) {
    return { kind: "NOT_SUPPRESSED" };
  }

  const activeFault = await resolveActiveArmedC07FaultForOrder(
    attempt.order_id,
  );
  if (!activeFault) {
    // Covers: no active fault, wrong classification (query-scoped), and a
    // malformed fault_state (fails closed inside the resolver itself) —
    // Cases F/H/I all converge here as NOT_SUPPRESSED.
    return { kind: "NOT_SUPPRESSED" };
  }

  const faultState = parseExactC07FaultState(activeFault.fault_state);
  if (!faultState) {
    return { kind: "NOT_SUPPRESSED" };
  }

  if (faultState.consumed === true) {
    // Already authenticated and consumed by a prior genuine confirmation —
    // suppress without another mutation or re-verification (Case C).
    return { kind: "SUPPRESSED", chaosRunId: activeFault.id };
  }

  // consumed === false: this is the FIRST candidate confirmation. It must
  // be authenticated BEFORE consumed becomes true (Blocker 1).
  if (!attempt.razorpay_order_id) {
    return {
      kind: "REJECTED_INVALID_CONFIRMATION",
      reasonCategory: "TRUSTED_RAZORPAY_ORDER_MISSING",
    };
  }

  if (input.razorpayOrderId !== attempt.razorpay_order_id) {
    return {
      kind: "REJECTED_INVALID_CONFIRMATION",
      reasonCategory: "ORDER_MISMATCH",
    };
  }

  let signatureValid: boolean;
  try {
    signatureValid = verifyCheckoutSignature({
      trustedRazorpayOrderId: attempt.razorpay_order_id,
      razorpayPaymentId: input.razorpayPaymentId,
      razorpaySignature: input.razorpaySignature,
    });
  } catch (err) {
    logEvent("chaos_c07_confirmation_verification_unavailable", {
      chaos_run_id: activeFault.id,
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    return {
      kind: "REJECTED_INVALID_CONFIRMATION",
      reasonCategory: "VERIFICATION_UNAVAILABLE",
    };
  }

  if (!signatureValid) {
    return {
      kind: "REJECTED_INVALID_CONFIRMATION",
      reasonCategory: "SIGNATURE_INVALID",
    };
  }

  // Authenticated — perform the atomic consume.
  const consumed = await consumeC07ClientConfirmationDrop(activeFault.id);
  if (consumed) {
    return { kind: "SUPPRESSED", chaosRunId: activeFault.id };
  }

  // Lost the atomic consume race — re-read to decide safely rather than
  // assuming either outcome.
  const reRead = await resolveActiveArmedC07FaultForOrder(attempt.order_id);
  if (reRead && parseExactC07FaultState(reRead.fault_state)) {
    return { kind: "SUPPRESSED", chaosRunId: reRead.id };
  }
  return { kind: "NOT_SUPPRESSED" };
}

export type C07ReconcileResult =
  | { readonly kind: "COMPLETED"; readonly chaosRunId: string }
  | { readonly kind: "NOT_YET_CONVERGED"; readonly chaosRunId: string }
  | { readonly kind: "FAULT_NOT_CONSUMED"; readonly chaosRunId: string }
  | {
      readonly kind: "NOT_RECONCILABLE";
      readonly reasonCategory: "RUN_NOT_FOUND" | "RUN_NOT_ELIGIBLE";
    }
  | {
      readonly kind: "COMPLETION_PERSISTENCE_FAILED";
      readonly chaosRunId: string;
    };

/**
 * Exact durable completion proof (Blocker 4, this task's Section 16).
 * Independently validates every required fact on the returned row before
 * a caller may ever report `COMPLETED`.
 */
function isValidCompletedShape(
  row: ChaosRunRow,
  chaosRunId: string,
  expectedOrderId: string,
  evidence: {
    paymentAttemptId: string;
    paymentId: string;
    webhookEventId: string;
  },
): boolean {
  return (
    row.id === chaosRunId &&
    row.scenario_id === "C07" &&
    row.fault_type === "DROP_CLIENT_CONFIRMATION" &&
    row.data_classification === "RECORDED_TEST_EVIDENCE" &&
    row.order_id === expectedOrderId &&
    row.status === "COMPLETED" &&
    row.outcome === "UNKNOWN" &&
    row.payment_attempt_id === evidence.paymentAttemptId &&
    row.payment_id === evidence.paymentId &&
    row.source_webhook_event_id === evidence.webhookEventId &&
    isExactArmedConsumedFaultState(row.fault_state) &&
    row.started_at !== null &&
    row.completed_at !== null &&
    row.failed_precheck_id === null &&
    row.execution_block_code === null
  );
}

/**
 * Reconciles C07 using persisted, authoritative provider evidence. Read-
 * only with respect to merchant/payment state — it may only ever write the
 * C07 `chaos_runs` row itself, and only once convergence is authoritatively
 * proven and the durable returned row independently re-proves the exact
 * completed shape (Blocker 4). Safe to call repeatedly before convergence.
 *
 * A transient read/reconciliation error propagates as a thrown exception
 * rather than silently disabling the active fault — the run is left
 * RUNNING, and the operator may retry reconciliation or explicitly cancel.
 */
export async function reconcileC07ClientConfirmationDrop(
  chaosRunId: string,
): Promise<C07ReconcileResult> {
  const run = await getChaosRunById(chaosRunId);
  if (!run) {
    return { kind: "NOT_RECONCILABLE", reasonCategory: "RUN_NOT_FOUND" };
  }

  const faultState = parseExactC07FaultState(run.fault_state);
  const isEligibleRunningC07 =
    run.scenario_id === "C07" &&
    run.status === "RUNNING" &&
    run.fault_type === "DROP_CLIENT_CONFIRMATION" &&
    run.data_classification === "RECORDED_TEST_EVIDENCE" &&
    run.order_id !== null &&
    faultState !== null;

  if (!isEligibleRunningC07 || !faultState) {
    return { kind: "NOT_RECONCILABLE", reasonCategory: "RUN_NOT_ELIGIBLE" };
  }

  // The consumed=true gate is mandatory — prevents a fast-arriving webhook
  // from completing the run before PayChaos has actually observed and
  // suppressed the client confirmation.
  if (faultState.consumed !== true) {
    return { kind: "FAULT_NOT_CONSUMED", chaosRunId };
  }

  const orderId = run.order_id as string;

  // Genuine read failures here propagate as exceptions (never silently
  // treated as NOT_YET_CONVERGED, and never disabling the fault).
  const evidence = await resolveC07ConvergenceEvidence(orderId);
  if (!evidence) {
    return { kind: "NOT_YET_CONVERGED", chaosRunId };
  }

  // The persistence call is the only step wrapped here (final correction
  // round, Blocker B) — a repository throw must map to the same safe typed
  // failure as a null/wrong-shape return, never propagate as an unhandled
  // exception. The earlier authoritative-evidence READ above is
  // deliberately NOT wrapped: a transient read failure must keep
  // propagating so the run is left RUNNING and safely retryable, never
  // silently reinterpreted as a persistence failure.
  let completed: ChaosRunRow | null;
  try {
    completed = await completeRunningC07RunWithEvidence(chaosRunId, orderId, {
      paymentAttemptId: evidence.paymentAttemptId,
      paymentId: evidence.paymentId,
      sourceWebhookEventId: evidence.webhookEventId,
    });
  } catch (err) {
    logEvent("chaos_c07_reconcile_completion_persistence_failed", {
      chaos_run_id: chaosRunId,
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    return { kind: "COMPLETION_PERSISTENCE_FAILED", chaosRunId };
  }

  if (
    !completed ||
    !isValidCompletedShape(completed, chaosRunId, orderId, evidence)
  ) {
    logEvent("chaos_c07_reconcile_completion_persistence_failed", {
      chaos_run_id: chaosRunId,
    });
    return { kind: "COMPLETION_PERSISTENCE_FAILED", chaosRunId };
  }

  return { kind: "COMPLETED", chaosRunId };
}

export type C07CancelResult =
  | { readonly kind: "CANCELLED"; readonly chaosRunId: string }
  | {
      readonly kind: "NOT_CANCELLABLE";
      readonly reasonCategory:
        "RUN_NOT_FOUND" | "RUN_NOT_ELIGIBLE" | "RUN_NOT_RUNNING";
    }
  | { readonly kind: "CANCEL_PERSISTENCE_FAILED"; readonly chaosRunId: string };

/**
 * Exact durable cancellation proof (Blocker 4, this task's Section 17;
 * final correction round Blocker A). `preState` is the exact fault_state
 * captured BEFORE the mutation was attempted — the returned row's
 * `fault_state` must be identical to it, or cancellation is not claimed. As
 * of the final correction round this is now defense-in-depth rather than
 * the primary guard: the repository's own conditional `UPDATE` already
 * requires the SAME exact pre-state atomically (as part of its `WHERE`
 * clause, not merely checked afterward), so a concurrent consume racing in
 * underneath this call causes the repository to return `null` (zero rows
 * matched) rather than a row with a surprising `fault_state` — this
 * function's re-check can therefore never actually observe a mismatch in
 * practice, but is kept as a second independent proof.
 */
function isValidCancelledShape(
  row: ChaosRunRow,
  chaosRunId: string,
  expectedOrderId: string,
  preState: C07ExactFaultState,
): boolean {
  const postState = parseExactC07FaultState(row.fault_state);
  return (
    row.id === chaosRunId &&
    row.order_id === expectedOrderId &&
    row.scenario_id === "C07" &&
    row.fault_type === "DROP_CLIENT_CONFIRMATION" &&
    row.data_classification === "RECORDED_TEST_EVIDENCE" &&
    row.status === "FAILED" &&
    row.outcome === "ERROR" &&
    row.completed_at !== null &&
    row.started_at !== null &&
    row.failed_precheck_id === null &&
    row.execution_block_code === null &&
    row.error_message_redacted !== null &&
    postState !== null &&
    postState.armed === preState.armed &&
    postState.consumed === preState.consumed
  );
}

/**
 * Explicit, operator-initiated-only cancellation of a RUNNING C07 fault. A
 * narrow, C07-specific cancel — not a generic cross-scenario cancel
 * function. Requires a genuine eligible RUNNING C07 row with an exact
 * valid `fault_state` BEFORE attempting the mutation. The captured
 * `preState.consumed` is passed to the repository as `expectedConsumed`,
 * which the repository uses to build its OWN atomic exact-state predicate
 * (final correction round, Blocker A) — this function never constructs or
 * passes a raw `fault_state` object itself. Independently re-proves the
 * exact returned row before ever reporting `CANCELLED` (Blocker 4).
 *
 * CASE A (cancel wins the race): the repository's atomic predicate matches,
 * the row terminalizes to `FAILED`/`ERROR`, and a concurrent consume
 * attempt matches zero rows — `CANCELLED` is reported truthfully.
 * CASE B (a genuine consume wins first): `fault_state` changes before this
 * mutation runs, the repository's exact-state predicate no longer matches,
 * the UPDATE matches zero rows, the run remains `RUNNING` with its new
 * fault_state untouched, and this function reports `CANCEL_PERSISTENCE_
 * FAILED` — it never falsely claims cancellation after having actually
 * failed to terminalize the run. The operator may safely retry cancellation
 * against the newly observed state.
 */
export async function cancelRunningC07Fault(
  chaosRunId: string,
): Promise<C07CancelResult> {
  const run = await getChaosRunById(chaosRunId);
  if (!run) {
    return { kind: "NOT_CANCELLABLE", reasonCategory: "RUN_NOT_FOUND" };
  }

  const isEligibleC07 =
    run.scenario_id === "C07" &&
    run.fault_type === "DROP_CLIENT_CONFIRMATION" &&
    run.data_classification === "RECORDED_TEST_EVIDENCE" &&
    run.order_id !== null;

  if (!isEligibleC07) {
    return { kind: "NOT_CANCELLABLE", reasonCategory: "RUN_NOT_ELIGIBLE" };
  }

  if (run.status !== "RUNNING") {
    return { kind: "NOT_CANCELLABLE", reasonCategory: "RUN_NOT_RUNNING" };
  }

  const preState = parseExactC07FaultState(run.fault_state);
  if (!preState) {
    return { kind: "NOT_CANCELLABLE", reasonCategory: "RUN_NOT_ELIGIBLE" };
  }

  const orderId = run.order_id as string;

  // The persistence call is the only step wrapped here (final correction
  // round, Blocker B) — a repository throw must map to the same safe typed
  // failure as a null/wrong-shape return, never propagate as an unhandled
  // exception, and never trigger a compensating re-mutation of the durable
  // row (persisted state remains authoritative as-is).
  let cancelled: ChaosRunRow | null;
  try {
    cancelled = await cancelRunningC07FaultRepo(
      chaosRunId,
      orderId,
      preState.consumed,
      SAFE_CANCEL_REASON,
    );
  } catch (err) {
    logEvent("chaos_c07_cancel_persistence_failed_or_unverified", {
      chaos_run_id: chaosRunId,
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    return { kind: "CANCEL_PERSISTENCE_FAILED", chaosRunId };
  }

  if (
    !cancelled ||
    !isValidCancelledShape(cancelled, chaosRunId, orderId, preState)
  ) {
    logEvent("chaos_c07_cancel_persistence_failed_or_unverified", {
      chaos_run_id: chaosRunId,
    });
    return { kind: "CANCEL_PERSISTENCE_FAILED", chaosRunId };
  }

  return { kind: "CANCELLED", chaosRunId };
}
