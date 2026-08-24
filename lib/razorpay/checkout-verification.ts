/**
 * Phase 2C — server-only Razorpay Standard Checkout signature verification.
 *
 * Implements the exact contract documented in docs/RAZORPAY_GUIDE.md
 * Section 26 and confirmed against current official Razorpay documentation
 * (razorpay-node's paymentVerification.md, Razorpay Docs "Verify payment
 * signature", 2026-08-24):
 *
 *   generated_signature = HMAC-SHA256(
 *     trusted_order_id + "|" + razorpay_payment_id,
 *     RAZORPAY_KEY_SECRET
 *   )
 *
 * compared against the `razorpay_signature` Checkout returned to the
 * browser.
 *
 * CRITICAL (docs/RAZORPAY_GUIDE.md "Mistake 3", SR-RZP-006): the caller
 * MUST pass the Razorpay Order ID already trusted from this server's own
 * database (`payment_attempts.razorpay_order_id`) as
 * `trustedRazorpayOrderId` — never the `razorpay_order_id` Checkout
 * returned to the browser. This module has no way to enforce that itself
 * (it only receives one order-id parameter); the order-ID-mismatch check
 * against the browser-supplied value belongs to the caller
 * (`lib/demo-merchant/service.ts`), which must reject a mismatch BEFORE
 * ever calling this function.
 *
 * Uses Node's built-in `crypto` directly — one HMAC comparison does not
 * justify a new dependency (CLAUDE.md "do not add unnecessary
 * frameworks").
 */
import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { getRazorpayEnv } from "@/lib/config/razorpay-env";

export interface VerifyCheckoutSignatureInput {
  /** The Razorpay Order ID already trusted from this server's own database — never a browser-supplied value. */
  readonly trustedRazorpayOrderId: string;
  readonly razorpayPaymentId: string;
  readonly razorpaySignature: string;
}

/**
 * Generous but bounded length guard applied before any cryptographic work.
 * Real Razorpay order/payment IDs and signatures are far shorter than
 * this; the bound exists only to reject grossly malformed input cheaply,
 * per docs/SECURITY.md Section 22 ("Input Validation... Request Size") and
 * this task's "validate basic input shape/size before cryptographic
 * comparison" requirement.
 */
const MAX_INPUT_LENGTH = 256;

function isSafeNonEmptyString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_INPUT_LENGTH
  );
}

/**
 * Verifies one Razorpay Standard Checkout success response's signature.
 *
 * Returns a plain boolean — never throws for malformed/invalid input — so
 * callers always get a definite verified/not-verified result rather than
 * needing to catch a crypto exception. Uses a timing-safe comparison
 * (`crypto.timingSafeEqual`) rather than `===`, and never logs the secret,
 * the generated digest, or the received signature (docs/SECURITY.md
 * Section 31 "Never Log": "Checkout signature unnecessarily").
 */
export function verifyCheckoutSignature(
  input: VerifyCheckoutSignatureInput,
): boolean {
  if (
    !isSafeNonEmptyString(input.trustedRazorpayOrderId) ||
    !isSafeNonEmptyString(input.razorpayPaymentId) ||
    !isSafeNonEmptyString(input.razorpaySignature)
  ) {
    return false;
  }

  const { keySecret } = getRazorpayEnv();

  const expectedSignature = createHmac("sha256", keySecret)
    .update(`${input.trustedRazorpayOrderId}|${input.razorpayPaymentId}`)
    .digest("hex");

  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const receivedBuffer = Buffer.from(input.razorpaySignature, "utf8");

  // timingSafeEqual throws on length mismatch rather than returning false —
  // check lengths first so a malformed/short signature is rejected safely.
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
