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

import { getRazorpayEnv } from "@/lib/config/razorpay-env";
import {
  createRazorpayOrder,
  RazorpayOrderAmbiguousError,
  RazorpayOrderRejectedError,
} from "@/lib/razorpay/adapter";
import { verifyCheckoutSignature } from "@/lib/razorpay/checkout-verification";
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
  getPaymentAttemptById,
  getPaymentByRazorpayPaymentId,
  insertOrder,
  insertPaymentAttempt,
  insertVerifiedPayment,
  listLatestPaymentAttemptsForOrderIds,
  listLatestPaymentsForAttemptIds,
  listRecentOrders,
  markPaymentAttemptCheckoutInProgress,
  markPaymentAttemptFailedObserved,
  markPaymentAttemptOrderCreated,
  type PaymentAttemptRow,
} from "./repository";
import {
  toDemoMerchantOrderViewModel,
  toPaymentAttemptViewModel,
  toPaymentViewModel,
  type CheckoutConfigViewModel,
  type DemoMerchantOrderViewModel,
  type PaymentAttemptViewModel,
  type PaymentViewModel,
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

  const attemptIds = [...latestAttempts.values()].map((attempt) => attempt.id);
  const latestPayments = await listLatestPaymentsForAttemptIds(attemptIds);

  return rows.map((row) => {
    const latestAttempt = latestAttempts.get(row.id) ?? null;
    const latestPayment = latestAttempt
      ? (latestPayments.get(latestAttempt.id) ?? null)
      : null;
    return toDemoMerchantOrderViewModel(
      row,
      counts.get(row.id) ?? 0,
      latestAttempt,
      latestPayment,
    );
  });
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

// ============================================================================
// Phase 2C — Razorpay Standard Checkout integration
// ============================================================================

/** Thrown when the caller-supplied payment attempt ID does not match an existing attempt. */
export class DemoMerchantPaymentAttemptNotFoundError extends Error {
  constructor(paymentAttemptId: string) {
    super(`No payment attempt exists for id "${paymentAttemptId}".`);
    this.name = "DemoMerchantPaymentAttemptNotFoundError";
  }
}

/** Thrown when Checkout cannot be prepared for the attempt's current state (missing Razorpay Order correlation, or an ineligible status). */
export class DemoMerchantCheckoutNotEligibleError extends Error {
  constructor(reason: string) {
    super(`Checkout cannot be prepared for this payment attempt: ${reason}`);
    this.name = "DemoMerchantCheckoutNotEligibleError";
  }
}

/**
 * Thrown when the Razorpay Order ID returned by Checkout to the browser
 * does NOT match this attempt's trusted database
 * `razorpay_order_id` — a security failure, never silently corrected
 * (docs/RAZORPAY_GUIDE.md "Mistake 3", SR-RZP-006).
 */
export class RazorpayCheckoutOrderMismatchError extends Error {
  constructor() {
    super(
      "The Razorpay Order ID returned by Checkout does not match the trusted server record.",
    );
    this.name = "RazorpayCheckoutOrderMismatchError";
  }
}

/** Thrown when the Checkout HMAC signature does not verify against the trusted server order ID. */
export class RazorpayCheckoutSignatureInvalidError extends Error {
  constructor() {
    super("The Razorpay Checkout signature could not be verified.");
    this.name = "RazorpayCheckoutSignatureInvalidError";
  }
}

/**
 * Thrown when a `razorpay_payment_id` already exists in `payments` but is
 * associated with a DIFFERENT payment attempt than the one this call is
 * verifying against — an integrity error. A payment identity is never
 * silently reassigned (this task's "Idempotent Success Callback"
 * requirement).
 */
export class RazorpayPaymentIdentityConflictError extends Error {
  constructor() {
    super(
      "This Razorpay Payment ID is already associated with a different payment attempt.",
    );
    this.name = "RazorpayPaymentIdentityConflictError";
  }
}

const ELIGIBLE_CHECKOUT_STATUSES = new Set<PaymentAttemptRow["status"]>([
  "ORDER_CREATED",
  "CHECKOUT_IN_PROGRESS",
]);

/**
 * Checkout-safe server projection for ONE existing payment attempt (Phase
 * 2C). The browser supplies only `paymentAttemptId` — every value in the
 * returned `CheckoutConfigViewModel` (Key ID, trusted Razorpay Order ID,
 * amount, currency) is loaded/derived server-side from persisted state,
 * never from the caller.
 *
 * Independently establishes, before returning anything:
 *   - the payment attempt exists;
 *   - its associated merchant order exists;
 *   - it already has a trusted `razorpay_order_id` (Phase 2B must have
 *     succeeded first);
 *   - Test Mode configuration remains valid (`getRazorpayEnv()` fails
 *     closed on Live/missing configuration);
 *   - the attempt is in an appropriate Checkout-launch state
 *     (`ORDER_CREATED` or `CHECKOUT_IN_PROGRESS`).
 *
 * Transitions `ORDER_CREATED` -> `CHECKOUT_IN_PROGRESS` on first launch. A
 * repeated launch for an attempt already `CHECKOUT_IN_PROGRESS` is a safe
 * no-op re-use — it does NOT create a new payment attempt and does NOT
 * re-run the transition.
 */
export async function prepareCheckoutForPaymentAttempt(
  paymentAttemptId: string,
): Promise<CheckoutConfigViewModel> {
  if (
    typeof paymentAttemptId !== "string" ||
    !UUID_FORMAT.test(paymentAttemptId)
  ) {
    throw new DemoMerchantPaymentAttemptNotFoundError(paymentAttemptId);
  }

  const attempt = await getPaymentAttemptById(paymentAttemptId);
  if (!attempt) {
    throw new DemoMerchantPaymentAttemptNotFoundError(paymentAttemptId);
  }

  if (!attempt.razorpay_order_id) {
    throw new DemoMerchantCheckoutNotEligibleError(
      "no trusted Razorpay Order correlation exists yet",
    );
  }

  if (!ELIGIBLE_CHECKOUT_STATUSES.has(attempt.status)) {
    throw new DemoMerchantCheckoutNotEligibleError(
      `attempt status "${attempt.status}" is not eligible for Checkout launch`,
    );
  }

  const order = await getOrderById(attempt.order_id);
  if (!order) {
    throw new DemoMerchantOrderNotFoundError(attempt.order_id);
  }

  // Re-validates Test Mode configuration before exposing anything
  // Checkout-related to the browser (docs/SECURITY.md Section 19 Control
  // 4) — fails closed on a Live/missing Key ID or Key Secret.
  const { keyId } = getRazorpayEnv();

  const finalAttempt =
    attempt.status === "ORDER_CREATED"
      ? await markPaymentAttemptCheckoutInProgress(attempt.id)
      : attempt;

  logEvent("razorpay_checkout_prepared", {
    merchant_order_id: order.id,
    payment_attempt_id: finalAttempt.id,
    razorpay_order_id: finalAttempt.razorpay_order_id,
  });

  return {
    razorpayKeyId: keyId,
    // Narrowed by the `!attempt.razorpay_order_id` check above — TypeScript
    // cannot see that `finalAttempt` (a possibly-different object identity
    // after the transition) still satisfies it, so this is asserted, not
    // re-derived from an untrusted source.
    razorpayOrderId: finalAttempt.razorpay_order_id as string,
    amountSubunits: finalAttempt.amount_subunits,
    currency: finalAttempt.currency,
    paymentAttemptId: finalAttempt.id,
    orderId: order.id,
    name: DEMO_MERCHANT_PRODUCT.name,
    description: `PayChaos AI Demo Merchant — ${DEMO_MERCHANT_PRODUCT.name}`,
  };
}

export interface VerifyCheckoutInput {
  /** Internal payment attempt ID — the only PayChaos-trusted identifier the browser supplies. */
  readonly paymentAttemptId: string;
  /** UNTRUSTED until verified below. */
  readonly razorpayPaymentId: string;
  /** UNTRUSTED — corroborating input only; compared against, never authoritative over, the trusted DB value. */
  readonly razorpayOrderId: string;
  /** UNTRUSTED until verified below. */
  readonly razorpaySignature: string;
}

/**
 * Trusted server-side verification of one Razorpay Standard Checkout
 * success response (Phase 2C), and — only on success — persistence of the
 * canonical `payments` evidence row.
 *
 * Enforces, in order:
 *   1. `paymentAttemptId` resolves to a real, trusted attempt with an
 *      existing `razorpay_order_id`;
 *   2. the browser-supplied `razorpayOrderId` EQUALS the trusted database
 *      `razorpay_order_id` — a mismatch is rejected before any
 *      cryptographic work, never "corrected" to the trusted value
 *      (docs/RAZORPAY_GUIDE.md "Mistake 3");
 *   3. the HMAC signature verifies against that trusted order ID (never
 *      the browser's), per `lib/razorpay/checkout-verification.ts`;
 *   4. idempotent persistence: the same `razorpay_payment_id` submitted
 *      again for the SAME attempt returns the already-verified row rather
 *      than inserting a duplicate; the same ID already tied to a
 *      DIFFERENT attempt is rejected as an integrity error, never silently
 *      reassigned.
 *
 * On ANY failure of steps 1-3, this function throws before touching the
 * database at all — zero trusted payment evidence, zero order/business
 * mutation (this task's "Invalid / Tampered Response Behavior" section).
 * This function never mutates `orders` or `fulfilments`, and never
 * transitions `payment_attempts.status` to `CAPTURED` — a verified
 * Checkout signature authenticates the response; it does not establish
 * captured-state truth (docs/MONEY_INVARIANTS.md Section 5).
 */
export async function verifyCheckoutAndPersistPayment(
  input: VerifyCheckoutInput,
): Promise<PaymentViewModel> {
  if (
    typeof input.paymentAttemptId !== "string" ||
    !UUID_FORMAT.test(input.paymentAttemptId)
  ) {
    throw new DemoMerchantPaymentAttemptNotFoundError(
      String(input.paymentAttemptId),
    );
  }

  if (
    typeof input.razorpayPaymentId !== "string" ||
    input.razorpayPaymentId.trim().length === 0 ||
    typeof input.razorpayOrderId !== "string" ||
    input.razorpayOrderId.trim().length === 0 ||
    typeof input.razorpaySignature !== "string" ||
    input.razorpaySignature.trim().length === 0
  ) {
    throw new RazorpayCheckoutSignatureInvalidError();
  }

  const attempt = await getPaymentAttemptById(input.paymentAttemptId);
  if (!attempt) {
    throw new DemoMerchantPaymentAttemptNotFoundError(input.paymentAttemptId);
  }

  if (!attempt.razorpay_order_id) {
    throw new DemoMerchantCheckoutNotEligibleError(
      "no trusted Razorpay Order correlation exists yet",
    );
  }

  // CRITICAL: the browser-returned order id is only corroborating input.
  // Reject a mismatch outright — never use it as verification authority
  // (docs/RAZORPAY_GUIDE.md "Mistake 3", SR-RZP-006).
  if (input.razorpayOrderId !== attempt.razorpay_order_id) {
    logEvent("razorpay_checkout_order_mismatch", {
      merchant_order_id: attempt.order_id,
      payment_attempt_id: attempt.id,
    });
    throw new RazorpayCheckoutOrderMismatchError();
  }

  const signatureVerified = verifyCheckoutSignature({
    trustedRazorpayOrderId: attempt.razorpay_order_id,
    razorpayPaymentId: input.razorpayPaymentId,
    razorpaySignature: input.razorpaySignature,
  });

  if (!signatureVerified) {
    logEvent("razorpay_checkout_signature_invalid", {
      merchant_order_id: attempt.order_id,
      payment_attempt_id: attempt.id,
    });
    throw new RazorpayCheckoutSignatureInvalidError();
  }

  const existing = await getPaymentByRazorpayPaymentId(input.razorpayPaymentId);
  if (existing) {
    if (existing.payment_attempt_id !== attempt.id) {
      throw new RazorpayPaymentIdentityConflictError();
    }
    // Idempotent: the same verified Checkout response reached the server
    // again (browser retry/re-render). Return the already-verified
    // canonical row rather than inserting a duplicate.
    return toPaymentViewModel(existing);
  }

  const inserted = await insertVerifiedPayment({
    paymentAttemptId: attempt.id,
    razorpayPaymentId: input.razorpayPaymentId,
    amountSubunits: attempt.amount_subunits,
    currency: attempt.currency,
  });

  // `inserted` is `null` only when a concurrent request won a race on the
  // database's UNIQUE(razorpay_payment_id) constraint between our read
  // above and this insert — re-read the now-existing row rather than
  // treating that as a failure.
  const payment =
    inserted ?? (await getPaymentByRazorpayPaymentId(input.razorpayPaymentId));
  if (!payment) {
    throw new DemoMerchantOrderNotFoundError(attempt.order_id);
  }
  if (payment.payment_attempt_id !== attempt.id) {
    throw new RazorpayPaymentIdentityConflictError();
  }

  logEvent("razorpay_checkout_verified", {
    merchant_order_id: attempt.order_id,
    payment_attempt_id: attempt.id,
    razorpay_payment_id: input.razorpayPaymentId,
  });

  return toPaymentViewModel(payment);
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
