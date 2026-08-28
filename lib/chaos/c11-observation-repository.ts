/**
 * Phase 3D-E — server-only, READ-ONLY authoritative evidence resolution for
 * C11-A (docs/CHAOS_SCENARIOS.md Section 23 "P0 SCENARIO C11", Mechanism A —
 * "Generate a genuine Razorpay Test Mode failed payment and process verified
 * failure evidence when supplied by Razorpay").
 *
 * C11-A is PURE OBSERVATION. This module performs ZERO writes to
 * `orders`/`payment_attempts`/`payments`/`fulfilments`/`webhook_events`/
 * `event_processing_attempts` — it only resolves whether a genuine
 * `payment.failed` webhook has already been received and safely processed
 * for the run's order, and, once resolved, reads (never mutates) the
 * correlated merchant state as evidence. The only writes for C11-A happen in
 * `lib/chaos/run-repository.ts`'s C11-A lifecycle functions, against
 * `chaos_runs` alone.
 *
 * ============================================================================
 * WHY THIS DOES NOT REUSE `resolveAuthoritativeC11ReplaySource`
 * ============================================================================
 * docs (this task's Section 7) explicitly permits reusing
 * `lib/chaos/replay-repository.ts`'s `resolveAuthoritativeC11ReplaySource` as
 * a second-stage validator IF doing so does not duplicate validation logic
 * and remains read-only — but also says "Otherwise implement the same
 * validation narrowly inside the observation repository." That resolver
 * collapses "zero candidate processing attempts" and "more than one
 * candidate processing attempt" into the same `null` return (see its own doc
 * comment: "Zero candidates: nothing suitable. More than one: ... fail closed
 * either way"). C11-A's spec (this task's Section 6) requires the OPPOSITE:
 * zero suitable attempts must resolve as `NOT_YET_CONVERGED` (evidence simply
 * has not arrived yet — safe to keep polling) while more than one suitable
 * attempt must resolve as a distinct `AMBIGUOUS` outcome that the service
 * layer terminalizes `FAILED`/`ERROR` (a genuine correctness anomaly, not a
 * "keep waiting" condition). Reusing the shared resolver as-is would erase
 * that distinction. `resolveAuthoritativeC11ReplaySource` itself is therefore
 * left completely UNMODIFIED and UNUSED by this module — C11-B's behavior is
 * unaffected by this file in every way.
 *
 * This module's own validation steps mirror that resolver's checks (same
 * webhook-event provenance/signature/event-type/processing-status
 * requirements, same processing-attempt provenance/status/duplicate
 * requirements, same `normalized_event` envelope shape checks) so the two
 * scenarios' evidence standards stay in lockstep, without sharing mutable
 * state or import-coupling the two files together.
 */
import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";

/** Deterministic domain error for this module's I/O failures — never leaks the raw Supabase error (matches every other repository's error-boundary convention in this codebase). */
export class C11ObservationRepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "C11ObservationRepositoryError";
    this.code = code;
  }
}

/** The C11-A Mechanism A source event type (docs/CHAOS_SCENARIOS.md Section 23 "Inputs / Events Used") — the only event type a C11-A observation may ever converge against. */
const C11A_SOURCE_EVENT_TYPE = "payment.failed" as const;

export interface C11AObservationEvidence {
  readonly webhookEventId: string;
  readonly paymentAttemptId: string;
  readonly paymentId: string;
}

/**
 * The discriminated resolution outcome (this task's Section 6). `AMBIGUOUS`
 * is deliberately distinct from `NOT_YET_CONVERGED` — the caller
 * (`lib/chaos/c11-execution-service.ts`) must terminalize `FAILED`/`ERROR`
 * for `AMBIGUOUS`, never keep waiting for it to resolve on its own.
 */
export type C11AObservationResolution =
  | { readonly kind: "NOT_YET_CONVERGED" }
  | { readonly kind: "AMBIGUOUS" }
  | { readonly kind: "RESOLVED"; readonly evidence: C11AObservationEvidence };

function isSafeNormalizedEventObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolves the ONE authoritative `payment.failed` failure chain for a C11-A
 * run's order (docs/CHAOS_SCENARIOS.md Section 23 Sections 5–7 as narrowed by
 * this task's Sections 5–7). ALL of the following must hold for `RESOLVED`:
 *
 *   1. exactly ONE `webhook_events` row correlates to a `payment_attempts`
 *      row belonging to `orderId`, with `event_type = payment.failed`,
 *      `source_kind = REAL_RAZORPAY_WEBHOOK`, `signature_verified = true`,
 *      `processing_status = PROCESSED`, `payment_attempt_id IS NOT NULL`,
 *      `payment_id IS NOT NULL`, and `received_at >= runStartedAt` (this
 *      task's Section 5 timestamp bound — a C11-A observation can only ever
 *      converge against failure evidence received at or after the run
 *      itself started, never a stale pre-existing failure);
 *   2. exactly ONE `event_processing_attempts` row is the original
 *      authoritative processing of that exact webhook event:
 *      `source_kind = REAL_RAZORPAY_WEBHOOK`, `status = SUCCEEDED`,
 *      `is_duplicate_delivery = false`, `chaos_run_id IS NULL`,
 *      `webhook_event_id` = the selected canonical event,
 *      `payment_attempt_id`/`payment_id` = that event's own correlation;
 *   3. that attempt's `normalized_event` is a JSON object whose
 *      `sourceKind` is `REAL_RAZORPAY_WEBHOOK`, whose `eventType` is exactly
 *      `payment.failed`, whose `kind` equals `payment.failed`, and whose
 *      `razorpayPaymentStatus` is exactly `failed`.
 *
 * Zero candidates at step 1 or 2, or a normalized-event validation failure at
 * step 3, resolves as `NOT_YET_CONVERGED` (never fabricates evidence, always
 * safe to retry later). MORE THAN ONE candidate at step 1 or step 2 resolves
 * as `AMBIGUOUS` — there is no deterministic way to prove which row is
 * canonical, so this never guesses "latest"/"first". Throws
 * `C11ObservationRepositoryError` only on a genuine read failure, distinct
 * from both of the above.
 */
export async function resolveC11AFailureObservationEvidence(
  orderId: string,
  runStartedAt: string,
): Promise<C11AObservationResolution> {
  const client = getSupabaseServerClient();

  // Step 0: the run's own trusted payment attempts — never trust a
  // webhook_events row's payment_attempt_id correlation without first
  // proving it belongs to THIS order.
  const { data: attempts, error: attemptsError } = await client
    .from("payment_attempts")
    .select("id")
    .eq("order_id", orderId);
  if (attemptsError) {
    throw new C11ObservationRepositoryError(
      "C11A_ATTEMPTS_LOOKUP_FAILED",
      "Failed to load payment attempts for C11-A observation.",
    );
  }
  const attemptIds = (attempts ?? []).map((row) => row.id);
  if (attemptIds.length === 0) {
    return { kind: "NOT_YET_CONVERGED" };
  }

  // Step 1: candidate canonical payment.failed webhook event(s).
  const { data: webhookEvents, error: webhookError } = await client
    .from("webhook_events")
    .select("*")
    .in("payment_attempt_id", attemptIds)
    .eq("event_type", C11A_SOURCE_EVENT_TYPE)
    .eq("source_kind", "REAL_RAZORPAY_WEBHOOK")
    .eq("signature_verified", true)
    .eq("processing_status", "PROCESSED")
    .not("payment_id", "is", null)
    .gte("received_at", runStartedAt);
  if (webhookError) {
    throw new C11ObservationRepositoryError(
      "C11A_WEBHOOK_LOOKUP_FAILED",
      "Failed to load candidate webhook events for C11-A observation.",
    );
  }

  const webhookCandidates = webhookEvents ?? [];
  if (webhookCandidates.length === 0) {
    return { kind: "NOT_YET_CONVERGED" };
  }
  if (webhookCandidates.length > 1) {
    return { kind: "AMBIGUOUS" };
  }

  const webhookEvent = webhookCandidates[0]!;
  if (!webhookEvent.payment_attempt_id || !webhookEvent.payment_id) {
    // Cannot happen given the query filters above (payment_attempt_id is
    // constrained via .in(attemptIds), payment_id via .not(...,"is",null)),
    // but this function never trusts a non-null assertion for a value it is
    // about to persist as a foreign key.
    return { kind: "NOT_YET_CONVERGED" };
  }

  // Step 2: the ONE original authoritative processing attempt.
  const { data: processingAttempts, error: procError } = await client
    .from("event_processing_attempts")
    .select("*")
    .eq("webhook_event_id", webhookEvent.id)
    .eq("source_kind", "REAL_RAZORPAY_WEBHOOK")
    .eq("status", "SUCCEEDED")
    .eq("is_duplicate_delivery", false)
    .is("chaos_run_id", null)
    .eq("payment_attempt_id", webhookEvent.payment_attempt_id)
    .eq("payment_id", webhookEvent.payment_id);
  if (procError) {
    throw new C11ObservationRepositoryError(
      "C11A_PROCESSING_ATTEMPT_LOOKUP_FAILED",
      "Failed to load the original processing attempt for C11-A observation.",
    );
  }

  const procCandidates = processingAttempts ?? [];
  if (procCandidates.length === 0) {
    return { kind: "NOT_YET_CONVERGED" };
  }
  if (procCandidates.length > 1) {
    return { kind: "AMBIGUOUS" };
  }

  const attempt = procCandidates[0]!;

  // Step 3: normalized event envelope validation (narrow, mirroring
  // resolveAuthoritativeC11ReplaySource's own checks — see module doc
  // comment for why this is not literally reused).
  if (!isSafeNormalizedEventObject(attempt.normalized_event)) {
    return { kind: "NOT_YET_CONVERGED" };
  }
  const { sourceKind, eventType, kind, razorpayPaymentStatus } =
    attempt.normalized_event;

  if (sourceKind !== "REAL_RAZORPAY_WEBHOOK") {
    return { kind: "NOT_YET_CONVERGED" };
  }
  if (eventType !== C11A_SOURCE_EVENT_TYPE) {
    return { kind: "NOT_YET_CONVERGED" };
  }
  if (kind !== C11A_SOURCE_EVENT_TYPE) {
    return { kind: "NOT_YET_CONVERGED" };
  }
  if (razorpayPaymentStatus !== "failed") {
    return { kind: "NOT_YET_CONVERGED" };
  }

  return {
    kind: "RESOLVED",
    evidence: {
      webhookEventId: webhookEvent.id,
      paymentAttemptId: webhookEvent.payment_attempt_id,
      paymentId: webhookEvent.payment_id,
    },
  };
}

/**
 * Read-only post-observation merchant-state evidence collection (this task's
 * Section 8 "OBSERVED MERCHANT STATE"). Deliberately never gates
 * `COMPLETED` vs `FAILED` on the CONTENT of what it reads — only a genuine
 * technical read failure (thrown here) is treated as an execution failure by
 * the caller (the architect's explicit "IMPORTANT ARCHITECT REFINEMENT":
 * unsafe observed merchant values must never prevent `COMPLETED`/`UNKNOWN`
 * once authoritative `payment.failed` evidence exists — Phase 3D never
 * assigns invariant PASS/FAIL; that is Phase 3F's job, INV-003/INV-004/
 * INV-011). Reads `orders`/`payment_attempts`/`payments`/`fulfilments`
 * only — never writes to any of them.
 */
export async function readC11AObservedMerchantState(
  orderId: string,
  paymentAttemptId: string,
  paymentId: string,
): Promise<void> {
  const client = getSupabaseServerClient();

  const { error: orderError } = await client
    .from("orders")
    .select("payment_status, business_status")
    .eq("id", orderId)
    .single();
  if (orderError) {
    throw new C11ObservationRepositoryError(
      "C11A_POST_STATE_ORDER_READ_FAILED",
      "Failed to read the observed order state.",
    );
  }

  const { error: attemptError } = await client
    .from("payment_attempts")
    .select("status, order_id")
    .eq("id", paymentAttemptId)
    .single();
  if (attemptError) {
    throw new C11ObservationRepositoryError(
      "C11A_POST_STATE_ATTEMPT_READ_FAILED",
      "Failed to read the observed payment attempt state.",
    );
  }

  const { error: paymentError } = await client
    .from("payments")
    .select("razorpay_payment_status, captured_at, failed_at")
    .eq("id", paymentId)
    .single();
  if (paymentError) {
    throw new C11ObservationRepositoryError(
      "C11A_POST_STATE_PAYMENT_READ_FAILED",
      "Failed to read the observed payment state.",
    );
  }

  const { error: fulfilmentError } = await client
    .from("fulfilments")
    .select("id")
    .eq("order_id", orderId);
  if (fulfilmentError) {
    throw new C11ObservationRepositoryError(
      "C11A_POST_STATE_FULFILMENT_READ_FAILED",
      "Failed to read the observed fulfilment count.",
    );
  }
}
