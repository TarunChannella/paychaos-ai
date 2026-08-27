/**
 * Phase 3D-B — server-only, READ-ONLY resolution helpers for C07 (Payment
 * Succeeds but Client Confirmation Is Lost).
 *
 * This module performs zero writes to `orders`, `payment_attempts`,
 * `payments`, `fulfilments`, or `webhook_events` — it only resolves the
 * trusted order/attempt correlation, the active fault lookup, and
 * authoritative convergence evidence, all via read-only `SELECT`s. The only
 * production writes for C07 happen in `lib/chaos/run-repository.ts`'s C07
 * functions, against `chaos_runs` alone.
 *
 * `resolveTrustedOrderIdForPaymentAttempt`/`resolveTrustedPaymentAttemptForC07`
 * reuse the existing, already approved `getPaymentAttemptById`
 * (`lib/demo-merchant/repository.ts`) — this module never trusts a
 * browser-supplied order/payment id of any kind.
 *
 * ============================================================================
 * CORRECTION ROUND — EXACT FAULT_STATE VALIDATION (Blocker 3)
 * ============================================================================
 * The frozen C07 contract's server-owned `fault_state` is EXACTLY
 * `{armed: true, consumed: false}` or `{armed: true, consumed: true}` — no
 * extra key, no wrong type. `parseExactC07FaultState` is the ONE pure
 * validator for this shape, used consistently by every C07 code path that
 * inspects a persisted `fault_state` (arm proof, active-fault lookup,
 * suppression, reconciliation, cancellation proof) — a malformed state
 * (extra key, non-boolean `consumed`, `armed !== true`) fails closed: it is
 * never treated as an active fault, never suppresses a normal Checkout
 * confirmation, and never reconciles as successful.
 */
import "server-only";

import {
  getPaymentAttemptById,
  type PaymentAttemptRow,
} from "@/lib/demo-merchant/repository";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

export type ChaosRunRow = Database["public"]["Tables"]["chaos_runs"]["Row"];

/** Deterministic domain error for this module's I/O failures — never leaks the raw Supabase error. */
export class C07RepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "C07RepositoryError";
    this.code = code;
  }
}

/** The exact, closed C07 `fault_state` shape — no other field, no other type. */
export interface C07ExactFaultState {
  readonly armed: true;
  readonly consumed: boolean;
}

/**
 * The ONE pure validator for C07's exact `fault_state` shape (Blocker 3).
 * Returns `null` for anything that is not EXACTLY `{armed: true, consumed:
 * <boolean>}` — not an object, `null`, an array, missing either key, an
 * extra key of any name, `armed !== true`, or a non-boolean `consumed`.
 * Never throws.
 */
export function parseExactC07FaultState(
  value: unknown,
): C07ExactFaultState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const keys = Object.keys(value as Record<string, unknown>);
  if (
    keys.length !== 2 ||
    !keys.includes("armed") ||
    !keys.includes("consumed")
  ) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  if (obj.armed !== true) return null;
  if (typeof obj.consumed !== "boolean") return null;
  return { armed: true, consumed: obj.consumed };
}

/** `true` only for the exact initial armed-and-unconsumed shape. */
export function isExactArmedUnconsumedFaultState(value: unknown): boolean {
  const parsed = parseExactC07FaultState(value);
  return parsed !== null && parsed.consumed === false;
}

/** `true` only for the exact armed-and-consumed shape. */
export function isExactArmedConsumedFaultState(value: unknown): boolean {
  const parsed = parseExactC07FaultState(value);
  return parsed !== null && parsed.consumed === true;
}

/**
 * Resolves the TRUSTED internal `order_id` for a payment attempt via the
 * existing `getPaymentAttemptById` read. Returns `null` if the attempt does
 * not exist. Never trusts a browser-supplied order/payment id.
 */
export async function resolveTrustedOrderIdForPaymentAttempt(
  paymentAttemptId: string,
): Promise<string | null> {
  const attempt = await getPaymentAttemptById(paymentAttemptId);
  return attempt?.order_id ?? null;
}

/**
 * Resolves the FULL trusted payment attempt row (Blocker 1) — the C07
 * suppression authentication flow needs both the trusted `order_id` and the
 * trusted, already-persisted `razorpay_order_id` to independently verify a
 * candidate Checkout confirmation before ever consuming the fault. Reuses
 * the existing, already-approved `getPaymentAttemptById` — never trusts a
 * browser-supplied value.
 */
export async function resolveTrustedPaymentAttemptForC07(
  paymentAttemptId: string,
): Promise<PaymentAttemptRow | null> {
  return getPaymentAttemptById(paymentAttemptId);
}

/**
 * Read-only lookup: the active RUNNING C07 fault for one trusted order id
 * (Blocker 3, this task's Section 13 "Active-Fault Provenance"). The
 * database query itself now scopes on `data_classification =
 * RECORDED_TEST_EVIDENCE` in addition to `scenario_id`/`fault_type`/
 * `status` — a row matching scenario/status alone is never trusted as
 * structurally safe. The returned row's `fault_state` is independently
 * validated via `parseExactC07FaultState` — a malformed state (extra key,
 * wrong type) returns `null` here, regardless of its `consumed` value; the
 * caller decides what to do with a genuinely valid `consumed` value.
 *
 * Returns `null` if no such row exists, or if its `fault_state` fails exact
 * validation. The Phase 3D-0 partial unique index
 * (`chaos_runs_one_active_c07_fault_per_order_idx`) guarantees at most one
 * RUNNING C07/DROP_CLIENT_CONFIRMATION row can ever exist for a given order,
 * so `.maybeSingle()` is safe here.
 */
export async function resolveActiveArmedC07FaultForOrder(
  orderId: string,
): Promise<ChaosRunRow | null> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("chaos_runs")
    .select("*")
    .eq("order_id", orderId)
    .eq("scenario_id", "C07")
    .eq("fault_type", "DROP_CLIENT_CONFIRMATION")
    .eq("data_classification", "RECORDED_TEST_EVIDENCE")
    .eq("status", "RUNNING")
    .maybeSingle();

  if (error) {
    throw new C07RepositoryError(
      "C07_ACTIVE_FAULT_LOOKUP_FAILED",
      "Failed to look up the active C07 fault for this order.",
    );
  }

  if (!data || parseExactC07FaultState(data.fault_state) === null) {
    return null;
  }

  return data;
}

/** The exact, fully-correlated evidence a C07 reconciliation may complete against — never a "latest global webhook" guess. */
export interface C07ConvergenceEvidence {
  readonly paymentAttemptId: string;
  readonly paymentId: string;
  readonly webhookEventId: string;
}

/**
 * Read-only resolution of authoritative convergence evidence for one C07
 * run's order (docs/CHAOS_SCENARIOS.md Section 19 "Expected Correct
 * Behavior"). Requires, all correlated to the SAME order/attempt/payment —
 * never a global "latest webhook" shortcut:
 *
 *   1. the order is `payment_status=PAID` and `business_status=FULFILLED`;
 *   2. exactly one `payment_attempts` row for this order is `CAPTURED`
 *      (more than one is treated as ambiguous, never guessed);
 *   3. a `payments` row for that exact attempt is
 *      `razorpay_payment_status='captured'` with `captured_at` set;
 *   4. exactly one `fulfilments` row exists for this order, and its
 *      `payment_id` matches that exact captured payment;
 *   5. a genuine, signature-verified `REAL_RAZORPAY_WEBHOOK` row exists for
 *      that exact payment id — `payment.captured` preferred, `order.paid`
 *      accepted only if `payment.captured` is absent.
 *
 * Returns `null` (never throws for "not converged yet") whenever any of the
 * above cannot be established. Throws `C07RepositoryError` only on a
 * genuine read failure (a technical error, distinct from "not yet
 * converged").
 */
export async function resolveC07ConvergenceEvidence(
  orderId: string,
): Promise<C07ConvergenceEvidence | null> {
  const client = getSupabaseServerClient();

  const { data: order, error: orderError } = await client
    .from("orders")
    .select("id, payment_status, business_status")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) {
    throw new C07RepositoryError(
      "C07_ORDER_LOOKUP_FAILED",
      "Failed to load the order for C07 reconciliation.",
    );
  }
  if (
    !order ||
    order.payment_status !== "PAID" ||
    order.business_status !== "FULFILLED"
  ) {
    return null;
  }

  const { data: capturedAttempts, error: attemptError } = await client
    .from("payment_attempts")
    .select("*")
    .eq("order_id", orderId)
    .eq("status", "CAPTURED");
  if (attemptError) {
    throw new C07RepositoryError(
      "C07_ATTEMPT_LOOKUP_FAILED",
      "Failed to load payment attempts for C07 reconciliation.",
    );
  }
  if (!capturedAttempts || capturedAttempts.length !== 1) {
    return null;
  }
  const capturedAttempt = capturedAttempts[0]!;

  const { data: payments, error: paymentError } = await client
    .from("payments")
    .select("*")
    .eq("payment_attempt_id", capturedAttempt.id);
  if (paymentError) {
    throw new C07RepositoryError(
      "C07_PAYMENT_LOOKUP_FAILED",
      "Failed to load the payment for C07 reconciliation.",
    );
  }
  const capturedPayment = (payments ?? []).find(
    (payment) =>
      payment.razorpay_payment_status === "captured" &&
      payment.captured_at !== null,
  );
  if (!capturedPayment) {
    return null;
  }

  const { data: fulfilments, error: fulfilmentError } = await client
    .from("fulfilments")
    .select("*")
    .eq("order_id", orderId);
  if (fulfilmentError) {
    throw new C07RepositoryError(
      "C07_FULFILMENT_LOOKUP_FAILED",
      "Failed to load fulfilments for C07 reconciliation.",
    );
  }
  if (!fulfilments || fulfilments.length !== 1) {
    return null;
  }
  const fulfilment = fulfilments[0]!;
  if (fulfilment.payment_id !== capturedPayment.id) {
    return null;
  }

  const { data: webhookEvents, error: webhookError } = await client
    .from("webhook_events")
    .select("*")
    .eq("payment_id", capturedPayment.id)
    .eq("source_kind", "REAL_RAZORPAY_WEBHOOK")
    .eq("signature_verified", true);
  if (webhookError) {
    throw new C07RepositoryError(
      "C07_WEBHOOK_LOOKUP_FAILED",
      "Failed to load webhook evidence for C07 reconciliation.",
    );
  }
  const candidates = webhookEvents ?? [];
  const preferred =
    candidates.find((row) => row.event_type === "payment.captured") ??
    candidates.find((row) => row.event_type === "order.paid");
  if (!preferred) {
    return null;
  }

  return {
    paymentAttemptId: capturedAttempt.id,
    paymentId: capturedPayment.id,
    webhookEventId: preferred.id,
  };
}
