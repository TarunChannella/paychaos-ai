/**
 * Phase 2D — server-only Razorpay webhook signature verification.
 *
 * Implements the contract confirmed against current official Razorpay
 * webhook documentation (razorpay.com/docs/webhooks/validate-test/,
 * 2026-08-25) and docs/RAZORPAY_GUIDE.md Section 16:
 *
 *   generated_signature = HMAC-SHA256(raw_request_body, webhook_secret)
 *
 * compared against the `X-Razorpay-Signature` header — a DIFFERENT
 * formula from Checkout's `lib/razorpay/checkout-verification.ts`
 * (`order_id + "|" + payment_id`, keyed with the API Key Secret): webhook
 * signatures are keyed with the separate `RAZORPAY_WEBHOOK_SECRET` and
 * sign the entire raw body, not a constructed string.
 *
 * CRITICAL (docs/RAZORPAY_GUIDE.md Section 17, docs/SECURITY.md Section
 * 12): the caller MUST supply the EXACT raw bytes Razorpay sent — never a
 * value that has been JSON-parsed and re-serialized. This module accepts
 * only a `Buffer`, not a string, to make that boundary structural rather
 * than a naming convention: a caller cannot accidentally pass
 * `JSON.stringify(parsed)` here without an explicit `Buffer.from(...)`
 * conversion first.
 *
 * Uses Node's built-in `crypto` directly — one HMAC comparison does not
 * justify a new dependency (CLAUDE.md "do not add unnecessary
 * frameworks"), matching `lib/razorpay/checkout-verification.ts`'s
 * existing pattern.
 */
import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { getRazorpayWebhookSecret } from "@/lib/config/razorpay-webhook-env";

export interface VerifyWebhookSignatureInput {
  /** The EXACT raw bytes of the incoming request body — never re-serialized JSON. */
  readonly rawBody: Buffer;
  /** The `X-Razorpay-Signature` header value. */
  readonly signature: string;
}

/**
 * Razorpay's HMAC-SHA256 signature is a 64-character lowercase hex digest.
 * A value that does not match this exact shape cannot possibly be a valid
 * signature and is rejected before any cryptographic comparison — this
 * task's "Malformed values must return verification failure safely."
 */
const HEX_SHA256_SIGNATURE_PATTERN = /^[0-9a-f]{64}$/i;

function isWellFormedSignature(value: unknown): value is string {
  return typeof value === "string" && HEX_SHA256_SIGNATURE_PATTERN.test(value);
}

/**
 * Verifies one incoming Razorpay webhook request's signature.
 *
 * Returns a plain boolean for a genuine signature mismatch/malformed
 * input. Throws `EnvValidationError` (propagated from
 * `getRazorpayWebhookSecret()`) if the webhook secret itself is missing or
 * invalid — a SERVER configuration problem, deliberately distinct from an
 * ordinary "signature did not match" result, so the caller
 * (`app/api/webhooks/razorpay/route.ts`) can return the correct HTTP
 * status class for each (500 vs 400) while both equally guarantee zero
 * trusted event insertion.
 *
 * Uses a timing-safe comparison (`crypto.timingSafeEqual`) rather than
 * `===`. Never logs the secret, the generated digest, the received
 * signature, or the raw body (docs/SECURITY.md Section 31).
 */
export function verifyWebhookSignature(
  input: VerifyWebhookSignatureInput,
): boolean {
  if (!Buffer.isBuffer(input.rawBody)) {
    return false;
  }
  if (!isWellFormedSignature(input.signature)) {
    return false;
  }

  const webhookSecret = getRazorpayWebhookSecret();

  const expectedSignature = createHmac("sha256", webhookSecret)
    .update(input.rawBody)
    .digest("hex");

  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const receivedBuffer = Buffer.from(input.signature.toLowerCase(), "utf8");

  // Both are always exactly 64 bytes given the shape check above, but the
  // length check is kept as defense-in-depth before the timing-safe
  // comparison, matching lib/razorpay/checkout-verification.ts's pattern.
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
