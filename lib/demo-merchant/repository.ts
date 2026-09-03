/**
 * Phase 1E/2B — Demo Merchant server-only persistence boundary.
 *
 * Structural guarantee: `import "server-only"` (same pattern as
 * `lib/supabase/server.ts` / `lib/config/server-env.ts`) makes a
 * client-bundle import of this module fail at build time rather than
 * relying on review discipline alone.
 *
 * This module is the ONLY place `orders` is written/read and `fulfilments`
 * is read. Phase 2B adds `payment_attempts` reads/writes here too — Phase 1
 * never wrote to `payment_attempts`, but Phase 2B's Order-creation flow
 * legitimately requires it (docs/DATABASE.md Section 10). It builds
 * strictly on the existing `getSupabaseServerClient()` helper; it does not
 * create its own Supabase client and does not read `process.env`.
 */
import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

import { logSupabaseReadFailure } from "@/lib/supabase/read-diagnostics";

export type OrderRow = Database["public"]["Tables"]["orders"]["Row"];

/** Deterministic domain error for this repository's I/O failures. */
export class DemoMerchantRepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DemoMerchantRepositoryError";
    this.code = code;
  }
}

/**
 * The COMPLETE set of fields `insertOrder` accepts. Deliberately contains
 * only `amountSubunits`/`currency` — there is no `id`, `createdAt`,
 * `updatedAt`, `paymentStatus` or `businessStatus` field on this type, so
 * there is no code path through which a caller could pass a
 * browser-supplied value for any of those fields into this insert. The
 * database itself assigns `id` (`gen_random_uuid()`), `created_at`,
 * `updated_at`, and defaults `payment_status`/`business_status` to
 * `'UNPAID'`/`'OPEN'` (see
 * `supabase/migrations/20260823000000_phase1_foundation_schema.sql`) —
 * this function does not set them explicitly, so it cannot accidentally
 * forward an overridden value for them either.
 */
export interface InsertOrderInput {
  readonly amountSubunits: number;
  readonly currency: string;
}

/**
 * Inserts one new `orders` row using ONLY the validated amount/currency
 * terms. Returns the full persisted row (including the database-generated
 * `id`) via a `.select().single()` read-back — the caller never generates
 * an application-side ID.
 */
export async function insertOrder(input: InsertOrderInput): Promise<OrderRow> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("orders")
    .insert({
      amount_subunits: input.amountSubunits,
      currency: input.currency,
    })
    .select()
    .single();

  if (error || !data) {
    throw new DemoMerchantRepositoryError(
      "ORDER_INSERT_FAILED",
      "Failed to create the Demo Merchant order.",
    );
  }

  return data;
}

/**
 * Reads one `orders` row by ID, or `null` if no such order exists. Used by
 * Phase 2B to load the trusted, authoritative amount/currency for an
 * existing order before creating a payment attempt against it — the
 * browser supplies only the order ID, never the money terms.
 */
export async function getOrderById(orderId: string): Promise<OrderRow | null> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    // Sanitized, server-side only. The throw below is unchanged.
    logSupabaseReadFailure("ORDER_LOOKUP_FAILED", "orders", error);
    throw new DemoMerchantRepositoryError(
      "ORDER_LOOKUP_FAILED",
      "Failed to load the Demo Merchant order.",
    );
  }

  return data;
}

/** Reads the most recent `orders` rows, newest first, up to `limit`. */
export async function listRecentOrders(limit: number): Promise<OrderRow[]> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    // Sanitized, server-side only. The throw below is unchanged.
    logSupabaseReadFailure("ORDER_LIST_FAILED", "orders", error);
    throw new DemoMerchantRepositoryError(
      "ORDER_LIST_FAILED",
      "Failed to load Demo Merchant orders.",
    );
  }

  return data ?? [];
}

/**
 * Real server-side count of `fulfilments` rows per order id, grouped by
 * `order_id` — never hardcoded, never guessed. Phase 1 never inserts into
 * `fulfilments` (docs/DATABASE.md Section 12 "Phase 1 must not insert any
 * row into `fulfilments`"), so this always resolves to 0 for every order
 * Phase 1E can create — but the query is genuine, reads the real (always
 * empty in Phase 1) table, and would reflect an actual fulfilment the
 * moment a later phase starts writing one.
 */
export async function countFulfilmentsForOrderIds(
  orderIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (orderIds.length === 0) return counts;

  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("fulfilments")
    .select("order_id")
    .in("order_id", [...orderIds]);

  if (error) {
    // Sanitized, server-side only. The throw below is unchanged.
    logSupabaseReadFailure("FULFILMENT_COUNT_FAILED", "fulfilments", error);
    throw new DemoMerchantRepositoryError(
      "FULFILMENT_COUNT_FAILED",
      "Failed to load fulfilment counts.",
    );
  }

  for (const row of data ?? []) {
    counts.set(row.order_id, (counts.get(row.order_id) ?? 0) + 1);
  }

  return counts;
}

export type PaymentAttemptRow =
  Database["public"]["Tables"]["payment_attempts"]["Row"];

/**
 * Reads the payment attempt with the highest `attempt_no` for an order, or
 * `null` if the order has none yet. Phase 2B uses this to decide whether an
 * existing unresolved attempt (status `CREATED`/`FAILED_OBSERVED`) should be
 * reused — reusing preserves its stable `razorpay_receipt` rather than
 * generating a new one merely to retry (PAYATT-003/PAYATT-004).
 */
export async function getLatestPaymentAttemptForOrder(
  orderId: string,
): Promise<PaymentAttemptRow | null> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("payment_attempts")
    .select("*")
    .eq("order_id", orderId)
    .order("attempt_no", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // Sanitized, server-side only. The throw below is unchanged.
    logSupabaseReadFailure(
      "PAYMENT_ATTEMPT_LOOKUP_FAILED",
      "payment_attempts",
      error,
    );
    throw new DemoMerchantRepositoryError(
      "PAYMENT_ATTEMPT_LOOKUP_FAILED",
      "Failed to load payment attempts for this order.",
    );
  }

  return data;
}

/**
 * Real server-side lookup of each order's most recent `payment_attempts`
 * row, grouped by `order_id` — never hardcoded, never guessed. Mirrors
 * `countFulfilmentsForOrderIds`'s batch-lookup shape.
 */
export async function listLatestPaymentAttemptsForOrderIds(
  orderIds: readonly string[],
): Promise<Map<string, PaymentAttemptRow>> {
  const latestByOrderId = new Map<string, PaymentAttemptRow>();
  if (orderIds.length === 0) return latestByOrderId;

  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("payment_attempts")
    .select("*")
    .in("order_id", [...orderIds])
    .order("attempt_no", { ascending: false });

  if (error) {
    // Sanitized, server-side only. The throw below is unchanged.
    logSupabaseReadFailure(
      "PAYMENT_ATTEMPT_LOOKUP_FAILED",
      "payment_attempts",
      error,
    );
    throw new DemoMerchantRepositoryError(
      "PAYMENT_ATTEMPT_LOOKUP_FAILED",
      "Failed to load payment attempts for these orders.",
    );
  }

  // Rows arrive ordered by attempt_no descending, so the first row seen for
  // a given order_id is that order's latest attempt.
  for (const row of data ?? []) {
    if (!latestByOrderId.has(row.order_id)) {
      latestByOrderId.set(row.order_id, row);
    }
  }

  return latestByOrderId;
}

export interface InsertPaymentAttemptInput {
  readonly orderId: string;
  readonly attemptNo: number;
  readonly amountSubunits: number;
  readonly currency: string;
  readonly razorpayReceipt: string;
}

/**
 * Inserts one new `payment_attempts` row. Deliberately accepts no
 * `razorpay_order_id`/`razorpay_order_status`/`status` field — every new
 * attempt starts `status = 'CREATED'` (the database default) with both
 * Razorpay correlation columns `NULL`, exactly like `insertOrder` accepts
 * only `amountSubunits`/`currency`.
 */
export async function insertPaymentAttempt(
  input: InsertPaymentAttemptInput,
): Promise<PaymentAttemptRow> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("payment_attempts")
    .insert({
      order_id: input.orderId,
      attempt_no: input.attemptNo,
      amount_subunits: input.amountSubunits,
      currency: input.currency,
      razorpay_receipt: input.razorpayReceipt,
    })
    .select()
    .single();

  if (error || !data) {
    throw new DemoMerchantRepositoryError(
      "PAYMENT_ATTEMPT_INSERT_FAILED",
      "Failed to create the payment attempt.",
    );
  }

  return data;
}

export interface MarkPaymentAttemptOrderCreatedInput {
  readonly razorpayOrderId: string;
  readonly razorpayOrderStatus: string;
}

/**
 * Persists a successful Razorpay Order-creation result and transitions the
 * attempt from `CREATED` to `ORDER_CREATED` in the same update — this is
 * the ONLY place `payment_attempts.status` becomes `ORDER_CREATED`, and it
 * is only called after the Razorpay adapter has already returned a trusted
 * result (PAYATT-005).
 */
export async function markPaymentAttemptOrderCreated(
  attemptId: string,
  input: MarkPaymentAttemptOrderCreatedInput,
): Promise<PaymentAttemptRow> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("payment_attempts")
    .update({
      status: "ORDER_CREATED",
      razorpay_order_id: input.razorpayOrderId,
      razorpay_order_status: input.razorpayOrderStatus,
    })
    .eq("id", attemptId)
    .select()
    .single();

  if (error || !data) {
    throw new DemoMerchantRepositoryError(
      "PAYMENT_ATTEMPT_UPDATE_FAILED",
      "Failed to persist the Razorpay Order correlation.",
    );
  }

  return data;
}

/**
 * Records a definite Razorpay Order-creation rejection. Leaves
 * `razorpay_order_id`/`razorpay_order_status` untouched (`NULL`) — a
 * rejection never fabricates a Razorpay Order ID.
 */
export async function markPaymentAttemptFailedObserved(
  attemptId: string,
): Promise<PaymentAttemptRow> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("payment_attempts")
    .update({ status: "FAILED_OBSERVED" })
    .eq("id", attemptId)
    .select()
    .single();

  if (error || !data) {
    throw new DemoMerchantRepositoryError(
      "PAYMENT_ATTEMPT_UPDATE_FAILED",
      "Failed to record the payment attempt failure.",
    );
  }

  return data;
}

/**
 * Reads one `payment_attempts` row by ID, or `null` if none exists. Phase
 * 2C uses this to independently load the trusted attempt/Razorpay Order
 * relationship for Checkout preparation and Checkout-response verification
 * — the browser supplies only the attempt ID, never any of its persisted
 * fields.
 */
export async function getPaymentAttemptById(
  attemptId: string,
): Promise<PaymentAttemptRow | null> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("payment_attempts")
    .select("*")
    .eq("id", attemptId)
    .maybeSingle();

  if (error) {
    // Sanitized, server-side only. The throw below is unchanged.
    logSupabaseReadFailure(
      "PAYMENT_ATTEMPT_LOOKUP_FAILED",
      "payment_attempts",
      error,
    );
    throw new DemoMerchantRepositoryError(
      "PAYMENT_ATTEMPT_LOOKUP_FAILED",
      "Failed to load the payment attempt.",
    );
  }

  return data;
}

/**
 * Transitions an attempt to `CHECKOUT_IN_PROGRESS` (Phase 2C,
 * docs/MONEY_INVARIANTS.md Section 13). Unconditional, like
 * `markPaymentAttemptOrderCreated` — the caller
 * (`lib/demo-merchant/service.ts`) has already resolved that this is the
 * right attempt and that the transition is appropriate (only called when
 * the attempt is currently `ORDER_CREATED`; an already-`CHECKOUT_IN_PROGRESS`
 * attempt is left untouched by the caller instead of calling this again).
 */
export async function markPaymentAttemptCheckoutInProgress(
  attemptId: string,
): Promise<PaymentAttemptRow> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("payment_attempts")
    .update({ status: "CHECKOUT_IN_PROGRESS" })
    .eq("id", attemptId)
    .select()
    .single();

  if (error || !data) {
    throw new DemoMerchantRepositoryError(
      "PAYMENT_ATTEMPT_UPDATE_FAILED",
      "Failed to transition the payment attempt to CHECKOUT_IN_PROGRESS.",
    );
  }

  return data;
}

/**
 * Reads one `payment_attempts` row by its trusted Razorpay Order ID, or
 * `null` if none exists. Phase 2E uses this to correlate an incoming
 * verified webhook event's `razorpay_order_id` to the internal payment
 * attempt it belongs to (this task's Section 7) — never the reverse.
 */
export async function getPaymentAttemptByRazorpayOrderId(
  razorpayOrderId: string,
): Promise<PaymentAttemptRow | null> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("payment_attempts")
    .select("*")
    .eq("razorpay_order_id", razorpayOrderId)
    .maybeSingle();

  if (error) {
    // Sanitized, server-side only. The throw below is unchanged.
    logSupabaseReadFailure(
      "PAYMENT_ATTEMPT_LOOKUP_FAILED",
      "payment_attempts",
      error,
    );
    throw new DemoMerchantRepositoryError(
      "PAYMENT_ATTEMPT_LOOKUP_FAILED",
      "Failed to load the payment attempt by Razorpay Order ID.",
    );
  }

  return data;
}

export type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];

/** Reads one canonical `payments` row by its Razorpay Payment ID, or `null` if none exists. */
export async function getPaymentByRazorpayPaymentId(
  razorpayPaymentId: string,
): Promise<PaymentRow | null> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("payments")
    .select("*")
    .eq("razorpay_payment_id", razorpayPaymentId)
    .maybeSingle();

  if (error) {
    // Sanitized, server-side only. The throw below is unchanged.
    logSupabaseReadFailure("PAYMENT_LOOKUP_FAILED", "payments", error);
    throw new DemoMerchantRepositoryError(
      "PAYMENT_LOOKUP_FAILED",
      "Failed to load the payment.",
    );
  }

  return data;
}

/**
 * Real server-side lookup of each payment attempt's most recent `payments`
 * row, grouped by `payment_attempt_id` — never hardcoded, never guessed.
 * Mirrors `listLatestPaymentAttemptsForOrderIds`'s batch-lookup shape.
 */
export async function listLatestPaymentsForAttemptIds(
  attemptIds: readonly string[],
): Promise<Map<string, PaymentRow>> {
  const latestByAttemptId = new Map<string, PaymentRow>();
  if (attemptIds.length === 0) return latestByAttemptId;

  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("payments")
    .select("*")
    .in("payment_attempt_id", [...attemptIds])
    .order("created_at", { ascending: false });

  if (error) {
    // Sanitized, server-side only. The throw below is unchanged.
    logSupabaseReadFailure("PAYMENT_LOOKUP_FAILED", "payments", error);
    throw new DemoMerchantRepositoryError(
      "PAYMENT_LOOKUP_FAILED",
      "Failed to load payments for these payment attempts.",
    );
  }

  for (const row of data ?? []) {
    if (!latestByAttemptId.has(row.payment_attempt_id)) {
      latestByAttemptId.set(row.payment_attempt_id, row);
    }
  }

  return latestByAttemptId;
}

export interface InsertVerifiedPaymentInput {
  readonly paymentAttemptId: string;
  readonly razorpayPaymentId: string;
  readonly amountSubunits: number;
  readonly currency: string;
}

/**
 * Inserts one canonical `payments` row for a Checkout response this caller
 * has ALREADY signature-verified — this function performs no verification
 * itself, only persistence. Deliberately accepts no
 * `razorpay_payment_status`, `captured_at`, or `failed_at`: signature
 * verification authenticates the Checkout response, it does not establish
 * captured-state truth (docs/MONEY_INVARIANTS.md Section 5). The Checkout
 * signature itself is never a parameter here and is therefore never
 * persisted (docs/DATABASE.md Section 11 "Checkout Verification
 * Constraint").
 *
 * Returns `null` instead of throwing on a `razorpay_payment_id` unique-
 * constraint violation (Postgres error code `23505`) — the database's
 * `UNIQUE(razorpay_payment_id)` constraint is the final race-safety
 * boundary against two concurrent identical Checkout callbacks both
 * observing "no existing row" before either inserts (this task's
 * "Idempotent Success Callback" requirement). The caller re-reads the
 * now-existing row via `getPaymentByRazorpayPaymentId` instead of treating
 * this as a failure.
 */
export async function insertVerifiedPayment(
  input: InsertVerifiedPaymentInput,
): Promise<PaymentRow | null> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("payments")
    .insert({
      payment_attempt_id: input.paymentAttemptId,
      razorpay_payment_id: input.razorpayPaymentId,
      amount_subunits: input.amountSubunits,
      currency: input.currency,
      checkout_signature_verified: true,
      checkout_verified_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return null;
    }
    throw new DemoMerchantRepositoryError(
      "PAYMENT_INSERT_FAILED",
      "Failed to persist the verified payment.",
    );
  }
  if (!data) {
    throw new DemoMerchantRepositoryError(
      "PAYMENT_INSERT_FAILED",
      "Failed to persist the verified payment.",
    );
  }

  return data;
}

export interface InsertPaymentFromWebhookEvidenceInput {
  readonly paymentAttemptId: string;
  readonly razorpayPaymentId: string;
  readonly amountSubunits: number;
  readonly currency: string;
}

/**
 * Phase 2E — "webhook-first payment observation" (this task's Section 8).
 * A core reason webhooks exist is that the browser Checkout callback may
 * be lost, so a verified `payment.captured`/`payment.failed` webhook must
 * be able to create the canonical `payments` row itself, WITHOUT
 * requiring a prior Phase 2C Checkout callback.
 *
 * Deliberately does NOT set `checkout_signature_verified` to `true` — it
 * is left at its database default (`false`, with `checkout_verified_at`
 * `NULL`), because no Checkout HMAC signature was ever verified here; only
 * the webhook's own HMAC signature was verified
 * (`lib/razorpay/webhook-verification.ts`), which is a DIFFERENT
 * cryptographic claim. Also deliberately does NOT set
 * `razorpay_payment_status`/`captured_at`/`failed_at` — applying
 * authoritative provider state to the canonical payment record is Phase
 * 2F scope, not Phase 2E's.
 *
 * Returns `null` instead of throwing on a `razorpay_payment_id`
 * unique-constraint violation (Postgres error code `23505`) — the same
 * race-safety pattern as `insertVerifiedPayment`: if a concurrent path
 * (another duplicate webhook delivery, or a concurrent Checkout callback)
 * created the canonical row first, the caller re-reads the now-existing
 * row via `getPaymentByRazorpayPaymentId` rather than treating this as a
 * failure.
 */
export async function insertPaymentFromWebhookEvidence(
  input: InsertPaymentFromWebhookEvidenceInput,
): Promise<PaymentRow | null> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("payments")
    .insert({
      payment_attempt_id: input.paymentAttemptId,
      razorpay_payment_id: input.razorpayPaymentId,
      amount_subunits: input.amountSubunits,
      currency: input.currency,
      checkout_signature_verified: false,
      checkout_verified_at: null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return null;
    }
    throw new DemoMerchantRepositoryError(
      "PAYMENT_INSERT_FAILED",
      "Failed to persist the payment observed from webhook evidence.",
    );
  }
  if (!data) {
    throw new DemoMerchantRepositoryError(
      "PAYMENT_INSERT_FAILED",
      "Failed to persist the payment observed from webhook evidence.",
    );
  }

  return data;
}

/**
 * Phase 2E — Checkout-after-webhook compatibility (this task's Section 9).
 * Attaches a NOW-verified Checkout signature to an EXISTING canonical
 * `payments` row that a verified webhook already created first
 * (`checkout_signature_verified = false`). Out-of-order browser/webhook
 * observation is a genuine requirement — the Checkout path must not fail
 * solely because the webhook observed the payment first.
 *
 * Unconditional, like `markPaymentAttemptOrderCreated` — the caller
 * (`lib/demo-merchant/service.ts`) has already independently verified the
 * Checkout HMAC signature and confirmed this row belongs to the same
 * payment attempt before calling this. Never overwrites any other field —
 * money terms, Razorpay Payment ID, and any Phase 2F-applied provider
 * state are left untouched.
 */
export async function attachCheckoutVerificationToPayment(
  paymentId: string,
): Promise<PaymentRow> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("payments")
    .update({
      checkout_signature_verified: true,
      checkout_verified_at: new Date().toISOString(),
    })
    .eq("id", paymentId)
    .select()
    .single();

  if (error || !data) {
    throw new DemoMerchantRepositoryError(
      "PAYMENT_UPDATE_FAILED",
      "Failed to attach Checkout verification to the existing payment.",
    );
  }

  return data;
}
