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
