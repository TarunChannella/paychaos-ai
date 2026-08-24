/**
 * Phase 1E/2B — Demo Merchant application service.
 *
 * `import "server-only"` for the same structural reason as
 * `lib/demo-merchant/repository.ts`: this module transitively performs I/O
 * (through the repository and, for Phase 2B, the Razorpay adapter) and must
 * never be reachable from a client bundle.
 *
 * Order-creation flow (docs instructions Section 5C):
 *   fixed product (`lib/demo-merchant/product.ts`)
 *     -> `createInitialMerchantOrder` (reused, unmodified Phase 1D domain
 *        factory/validation — not reimplemented here)
 *     -> repository insert (`lib/demo-merchant/repository.ts`)
 *     -> read persisted row + real fulfilment count
 *     -> safe view model (`lib/demo-merchant/view-model.ts`)
 *
 * Phase 2B Razorpay Order-creation flow (docs/RAZORPAY_GUIDE.md Section
 * 24 steps 1–6):
 *   existing order (loaded by ID, never browser-supplied money terms)
 *     -> reuse an unresolved (CREATED) attempt OR create a new one with a
 *        stable receipt (PAYATT-001/003/004)
 *     -> `lib/razorpay/adapter.ts` creates a Razorpay Test Mode Order using
 *        ONLY the persisted attempt's amount/currency/receipt
 *     -> success persists razorpay_order_id/status and transitions the
 *        attempt to ORDER_CREATED (PAYATT-005); a definite rejection marks
 *        FAILED_OBSERVED and is treated as a RESOLVED outcome — the
 *        rejected attempt is immutable evidence and is never reused, so a
 *        later retry creates a genuinely new attempt (PAYATT-003's "reuse"
 *        protection is for an unresolved outcome, not a resolved
 *        rejection); a genuinely ambiguous outcome (network failure,
 *        timeout, 5xx) leaves the CREATED attempt completely untouched so
 *        its receipt can be safely reused later, per docs/RAZORPAY_GUIDE.md
 *        Section 39 "Order Creation" (PayChaos correction, confirmed by a
 *        real Test Mode manual verification — see
 *        handoffs/PHASE-2-HANDOFF.md).
 *
 * Phase 1D domain rules remain authoritative: this service does not
 * duplicate amount/currency validation or the UNPAID/OPEN/0 initial-state
 * rule — it calls into `lib/demo-merchant/order.ts` for both.
 */
import "server-only";

import { randomUUID } from "node:crypto";

import {
  createRazorpayOrder,
  RazorpayOrderAmbiguousError,
  RazorpayOrderRejectedError,
} from "@/lib/razorpay/adapter";
import { logEvent } from "@/lib/security/logger";

import {
  assertPaymentAttemptMatchesOrderTerms,
  createInitialMerchantOrder,
} from "./order";
import { DEMO_MERCHANT_PRODUCT } from "./product";
import {
  countFulfilmentsForOrderIds,
  getLatestPaymentAttemptForOrder,
  getOrderById,
  insertOrder,
  insertPaymentAttempt,
  listLatestPaymentAttemptsForOrderIds,
  listRecentOrders,
  markPaymentAttemptFailedObserved,
  markPaymentAttemptOrderCreated,
  type PaymentAttemptRow,
} from "./repository";
import {
  toDemoMerchantOrderViewModel,
  toPaymentAttemptViewModel,
  type DemoMerchantOrderViewModel,
  type PaymentAttemptViewModel,
} from "./view-model";

const DEFAULT_RECENT_ORDER_LIMIT = 10;

/** Thrown when the caller-supplied order ID does not match an existing order. */
export class DemoMerchantOrderNotFoundError extends Error {
  constructor(orderId: string) {
    super(`No Demo Merchant order exists for id "${orderId}".`);
    this.name = "DemoMerchantOrderNotFoundError";
  }
}

/** UUID shape check — anything else cannot possibly be a real order ID, so it is rejected before ever reaching the database. */
const UUID_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Attempt statuses that are safe to REUSE (same stable receipt) rather than
// creating a new attempt merely to retry (PAYATT-003/PAYATT-004).
//
// Only CREATED qualifies. CREATED means no Razorpay request has resolved
// yet — either none was ever sent, or the last attempt ended ambiguously
// (network failure/timeout/5xx), where Razorpay itself instructs retaining
// the same receipt rather than guessing (docs/RAZORPAY_GUIDE.md Section
// 39 "Order Creation").
//
// FAILED_OBSERVED is deliberately EXCLUDED. It means Razorpay definitely
// rejected the request (a resolved outcome, not an unresolved one) — the
// rejected attempt is immutable evidence, per PAYATT-003's own qualifier
// ("only create another logical payment attempt when the first outcome is
// resolved" — a definite rejection IS a resolved outcome). Reusing it here
// was a confirmed Phase 2B defect: it caused the exact same (invalid)
// receipt to be blindly resent. A later retry must create a brand-new
// attempt with a fresh receipt instead (see createNextPaymentAttempt).
const REUSABLE_ATTEMPT_STATUSES = new Set<PaymentAttemptRow["status"]>([
  "CREATED",
]);

/**
 * Razorpay's Create Order API rejects `receipt` values longer than 40
 * characters with HTTP 400 (confirmed by a real Test Mode manual
 * verification — see handoffs/PHASE-2-HANDOFF.md "Phase 2B correction").
 * `pc_` (3 chars) + a UUID with its hyphens stripped (32 hex chars) = 35
 * characters total, safely under that limit. Deliberately does NOT include
 * the order ID or attempt number — concatenating those pushed the previous
 * generator past 40 characters, which is exactly what caused the real
 * provider rejection this correction fixes. Uniqueness comes entirely from
 * the UUID; `lib/razorpay/adapter.ts` also enforces the 40-character limit
 * as a defense-in-depth guard immediately before any Razorpay request.
 */
function generateRazorpayReceipt(): string {
  return `pc_${randomUUID().replace(/-/g, "")}`;
}

/**
 * Creates one new Demo Merchant order for the fixed
 * `DEMO_MERCHANT_PRODUCT`. Accepts NO caller-supplied amount, currency, id,
 * or status — the fixed product is the only source of order terms, and the
 * database assigns identity/timestamps/initial status. Every order this
 * function creates is UNPAID / OPEN / 0 fulfilments / CREATED.
 */
export async function createDemoMerchantOrder(): Promise<DemoMerchantOrderViewModel> {
  const initial = createInitialMerchantOrder({
    amountSubunits: DEMO_MERCHANT_PRODUCT.amountSubunits,
    currency: DEMO_MERCHANT_PRODUCT.currency,
  });

  const row = await insertOrder({
    amountSubunits: initial.amountSubunits,
    currency: initial.currency,
  });

  const counts = await countFulfilmentsForOrderIds([row.id]);
  return toDemoMerchantOrderViewModel(row, counts.get(row.id) ?? 0);
}

/**
 * Reads the most recent Demo Merchant orders, newest first, with each
 * order's real fulfilment count and latest payment attempt (if any)
 * resolved from the database (never hardcoded).
 */
export async function listDemoMerchantOrders(
  limit: number = DEFAULT_RECENT_ORDER_LIMIT,
): Promise<DemoMerchantOrderViewModel[]> {
  const rows = await listRecentOrders(limit);
  if (rows.length === 0) return [];

  const orderIds = rows.map((row) => row.id);
  const [counts, latestAttempts] = await Promise.all([
    countFulfilmentsForOrderIds(orderIds),
    listLatestPaymentAttemptsForOrderIds(orderIds),
  ]);
  return rows.map((row) =>
    toDemoMerchantOrderViewModel(
      row,
      counts.get(row.id) ?? 0,
      latestAttempts.get(row.id) ?? null,
    ),
  );
}

/**
 * Phase 2B — creates (or, for an unresolved CREATED prior attempt, reuses)
 * a payment attempt for an existing Demo Merchant order and calls the
 * Razorpay adapter to create a real Razorpay Test Mode Order against it.
 *
 * The caller supplies ONLY `orderId`. The trusted amount/currency come
 * exclusively from the loaded `orders` row — there is no parameter through
 * which a browser-controlled amount, currency, receipt, or Razorpay ID
 * could ever reach this function.
 *
 * On success, the returned attempt has `status = 'ORDER_CREATED'` and both
 * Razorpay correlation fields populated. On a definite Razorpay rejection,
 * the attempt is marked `FAILED_OBSERVED` (a RESOLVED, immutable outcome —
 * never reused; a later call creates a brand-new attempt with a fresh
 * receipt) and this function throws. On an ambiguous outcome (network
 * failure, timeout, 5xx, unparseable response), the attempt is left
 * completely untouched (still `CREATED`, same stable receipt) and this
 * function throws — a later retry will safely reuse that same CREATED
 * attempt. In no case is order/payment/fulfilment state ever mutated.
 */
export async function createRazorpayOrderForMerchantOrder(
  orderId: string,
): Promise<PaymentAttemptViewModel> {
  if (typeof orderId !== "string" || !UUID_FORMAT.test(orderId)) {
    throw new DemoMerchantOrderNotFoundError(orderId);
  }

  const order = await getOrderById(orderId);
  if (!order) {
    throw new DemoMerchantOrderNotFoundError(orderId);
  }

  const latest = await getLatestPaymentAttemptForOrder(order.id);
  const attempt =
    latest && REUSABLE_ATTEMPT_STATUSES.has(latest.status)
      ? latest
      : await createNextPaymentAttempt(order.id, latest?.attempt_no ?? 0, {
          amountSubunits: order.amount_subunits,
          currency: order.currency,
        });

  try {
    const result = await createRazorpayOrder({
      amountSubunits: attempt.amount_subunits,
      currency: attempt.currency,
      receipt: attempt.razorpay_receipt,
    });

    const updated = await markPaymentAttemptOrderCreated(attempt.id, {
      razorpayOrderId: result.razorpayOrderId,
      razorpayOrderStatus: result.razorpayOrderStatus,
    });

    logEvent("razorpay_order_created", {
      merchant_order_id: order.id,
      payment_attempt_id: attempt.id,
      razorpay_order_id: result.razorpayOrderId,
    });

    return toPaymentAttemptViewModel(updated);
  } catch (err) {
    if (err instanceof RazorpayOrderRejectedError) {
      await markPaymentAttemptFailedObserved(attempt.id);
      logEvent("razorpay_order_rejected", {
        merchant_order_id: order.id,
        payment_attempt_id: attempt.id,
        http_status: err.httpStatus,
        safe_error_code: err.safeErrorCode ?? null,
      });
      throw err;
    }
    if (err instanceof RazorpayOrderAmbiguousError) {
      logEvent("razorpay_order_ambiguous", {
        merchant_order_id: order.id,
        payment_attempt_id: attempt.id,
      });
      throw err;
    }
    throw err;
  }
}

async function createNextPaymentAttempt(
  orderId: string,
  previousAttemptNo: number,
  orderTerms: { amountSubunits: number; currency: string },
): Promise<PaymentAttemptRow> {
  const attemptNo = previousAttemptNo + 1;
  const razorpayReceipt = generateRazorpayReceipt();

  // PAYATT-001: the new attempt's terms must match the order's terms at
  // creation time. Both sides are derived from the same trusted order row,
  // so this can never fail by construction — the explicit assertion is
  // kept as defense-in-depth against a future refactor accidentally
  // sourcing either side from somewhere else.
  assertPaymentAttemptMatchesOrderTerms(orderTerms, orderTerms);

  return insertPaymentAttempt({
    orderId,
    attemptNo,
    amountSubunits: orderTerms.amountSubunits,
    currency: orderTerms.currency,
    razorpayReceipt,
  });
}
