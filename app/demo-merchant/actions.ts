"use server";

/**
 * Phase 1E/2B — Demo Merchant Server Action module. `"use server"` is
 * isolated to this file only — no other module in `app/demo-merchant/`
 * carries it (docs instructions Section 12).
 *
 * `createDemoMerchantOrderAction` accepts NO arguments. There is therefore
 * no field of any kind — no `amount`, `currency`, `payment_status`,
 * `business_status`, `id`, `created_at`, or `updated_at` — that a browser
 * caller can submit through this action. It only calls the trusted
 * `lib/demo-merchant/service.ts` application service, which in turn uses
 * the fixed, server-owned `DEMO_MERCHANT_PRODUCT` — never a client-supplied
 * value.
 *
 * `createRazorpayOrderAction` accepts ONLY an existing order ID — never an
 * amount, currency, receipt, or Razorpay ID. The service loads the trusted
 * order row and derives every money term itself (see
 * `lib/demo-merchant/service.ts`'s `createRazorpayOrderForMerchantOrder`
 * doc comment).
 *
 * Both actions call `revalidatePath("/demo-merchant")` on success so the
 * freshly persisted state is visible on next render (docs instructions
 * Section 12). Errors are mapped to one generic, safe message each — the
 * real Supabase/Razorpay error object is never forwarded to the browser,
 * and only a safe error `name` is logged via the existing redacting
 * structured logger.
 */
import { revalidatePath } from "next/cache";

import {
  createDemoMerchantOrder,
  createRazorpayOrderForMerchantOrder,
  prepareCheckoutForPaymentAttempt,
  verifyCheckoutAndPersistPayment,
} from "@/lib/demo-merchant/service";
import { logEvent } from "@/lib/security/logger";

export interface CreateDemoMerchantOrderActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

const SAFE_CREATE_ERROR_MESSAGE =
  "Could not create the test order. Please try again.";

export async function createDemoMerchantOrderAction(): Promise<CreateDemoMerchantOrderActionResult> {
  try {
    await createDemoMerchantOrder();
    revalidatePath("/demo-merchant");
    return { ok: true };
  } catch (err) {
    logEvent("demo_merchant_order_create_failed", {
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    return { ok: false, error: SAFE_CREATE_ERROR_MESSAGE };
  }
}

export interface CreateRazorpayOrderActionResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly attempt?: {
    readonly id: string;
    readonly attemptNo: number;
    readonly status: string;
    readonly razorpayReceipt: string;
    readonly razorpayOrderId: string | null;
    readonly razorpayOrderStatus: string | null;
  };
}

const SAFE_RAZORPAY_ORDER_ERROR_MESSAGE =
  "Could not create the Razorpay Test Order. Please try again.";

/**
 * Accepts ONLY `orderId` — the ID of an already-persisted Demo Merchant
 * order. No money term, receipt, or Razorpay identifier is ever accepted
 * from the caller.
 */
export async function createRazorpayOrderAction(
  orderId: string,
): Promise<CreateRazorpayOrderActionResult> {
  if (typeof orderId !== "string" || orderId.trim().length === 0) {
    return { ok: false, error: SAFE_RAZORPAY_ORDER_ERROR_MESSAGE };
  }

  try {
    const attempt = await createRazorpayOrderForMerchantOrder(orderId);
    revalidatePath("/demo-merchant");
    return {
      ok: true,
      attempt: {
        id: attempt.id,
        attemptNo: attempt.attemptNo,
        status: attempt.status,
        razorpayReceipt: attempt.razorpayReceipt,
        razorpayOrderId: attempt.razorpayOrderId,
        razorpayOrderStatus: attempt.razorpayOrderStatus,
      },
    };
  } catch (err) {
    logEvent("razorpay_order_action_failed", {
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    // Revalidate even on a definite/ambiguous failure: a definite
    // rejection may have changed the attempt's status to FAILED_OBSERVED,
    // which should still be reflected on next render.
    revalidatePath("/demo-merchant");
    return { ok: false, error: SAFE_RAZORPAY_ORDER_ERROR_MESSAGE };
  }
}

// ============================================================================
// Phase 2C — Razorpay Standard Checkout integration
// ============================================================================

export interface PrepareCheckoutActionResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly checkout?: {
    readonly razorpayKeyId: string;
    readonly razorpayOrderId: string;
    readonly amountSubunits: number;
    readonly currency: string;
    readonly paymentAttemptId: string;
    readonly orderId: string;
    readonly name: string;
    readonly description: string;
  };
}

const SAFE_CHECKOUT_PREPARE_ERROR_MESSAGE =
  "Could not prepare Razorpay Checkout. Please try again.";

/**
 * Accepts ONLY `paymentAttemptId`. Returns the Checkout-safe server
 * projection (Key ID, trusted Order ID, amount, currency, safe display
 * data) — never the Key Secret, webhook secret, or service-role key. See
 * `lib/demo-merchant/service.ts`'s `prepareCheckoutForPaymentAttempt` doc
 * comment for the full trust boundary.
 */
export async function prepareCheckoutAction(
  paymentAttemptId: string,
): Promise<PrepareCheckoutActionResult> {
  if (
    typeof paymentAttemptId !== "string" ||
    paymentAttemptId.trim().length === 0
  ) {
    return { ok: false, error: SAFE_CHECKOUT_PREPARE_ERROR_MESSAGE };
  }

  try {
    const checkout = await prepareCheckoutForPaymentAttempt(paymentAttemptId);
    revalidatePath("/demo-merchant");
    return { ok: true, checkout };
  } catch (err) {
    logEvent("checkout_prepare_failed", {
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    return { ok: false, error: SAFE_CHECKOUT_PREPARE_ERROR_MESSAGE };
  }
}

export interface VerifyCheckoutActionInput {
  readonly paymentAttemptId: string;
  readonly razorpayPaymentId: string;
  readonly razorpayOrderId: string;
  readonly razorpaySignature: string;
}

export interface VerifyCheckoutActionResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly payment?: {
    readonly razorpayPaymentId: string;
    readonly checkoutSignatureVerified: boolean;
    readonly checkoutVerifiedAt: string | null;
    readonly razorpayPaymentStatus: string | null;
  };
}

const SAFE_CHECKOUT_VERIFY_ERROR_MESSAGE =
  "Could not verify the Checkout response. Please try again.";

/**
 * Accepts the browser's full Checkout success response
 * (`paymentAttemptId`, `razorpayPaymentId`, `razorpayOrderId`,
 * `razorpaySignature`) — ALL untrusted until
 * `verifyCheckoutAndPersistPayment` independently verifies them against
 * this server's own trusted `payment_attempts` row. The returned
 * signature-verification status is genuine server-computed evidence, never
 * an echo of client input. The signature value itself is never returned to
 * the browser and never logged.
 */
export async function verifyCheckoutAction(
  input: VerifyCheckoutActionInput,
): Promise<VerifyCheckoutActionResult> {
  try {
    const payment = await verifyCheckoutAndPersistPayment(input);
    revalidatePath("/demo-merchant");
    return {
      ok: true,
      payment: {
        razorpayPaymentId: payment.razorpayPaymentId,
        checkoutSignatureVerified: payment.checkoutSignatureVerified,
        checkoutVerifiedAt: payment.checkoutVerifiedAt,
        razorpayPaymentStatus: payment.razorpayPaymentStatus,
      },
    };
  } catch (err) {
    logEvent("checkout_verify_failed", {
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    return { ok: false, error: SAFE_CHECKOUT_VERIFY_ERROR_MESSAGE };
  }
}
