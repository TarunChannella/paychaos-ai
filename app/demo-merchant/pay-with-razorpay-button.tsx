"use client";

/**
 * Phase 2C — Client Component that launches real Razorpay Standard
 * Checkout for one existing payment attempt.
 *
 * Loads Razorpay's own hosted `checkout.js` (never self-hosted — this task
 * explicitly forbids that) and hands it ONLY the Checkout-safe projection
 * `prepareCheckoutAction` returns (Key ID, trusted Order ID, amount,
 * currency, safe display data). This component contains no card/payment
 * entry form of any kind — Razorpay Checkout itself owns sensitive payment
 * entry; PayChaos never receives or stores PAN, CVV, PIN, OTP, or bank
 * credentials (docs/SECURITY.md Principle 3).
 *
 * The `handler` callback forwards Checkout's success response to
 * `verifyCheckoutAction`, which independently verifies it server-side
 * before any evidence is trusted. This component never claims the payment
 * is captured/complete on its own authority — the displayed evidence says
 * "awaiting webhook confirmation" UNLESS the caller-supplied
 * `webhookConfirmed` prop (derived from the order's actual current webhook
 * evidence via `isPaymentCaptureConfirmedByRealWebhook` — never from this
 * component's own ephemeral Checkout-verification result) says a real
 * webhook has already confirmed capture (this task's Section 12 "Merchant
 * Authority Boundary"; Phase 2G real-verification UI consistency fix).
 */
import { useState, useTransition } from "react";

import { prepareCheckoutAction, verifyCheckoutAction } from "./actions";

const CHECKOUT_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
const CHECKOUT_SCRIPT_ID = "razorpay-checkout-script";

const DEFAULT_ERROR_MESSAGE =
  "Could not open Razorpay Checkout. Please try again.";

interface RazorpayCheckoutSuccessResponse {
  readonly razorpay_payment_id: string;
  readonly razorpay_order_id: string;
  readonly razorpay_signature: string;
}

interface RazorpayCheckoutOptions {
  readonly key: string;
  readonly amount: number;
  readonly currency: string;
  readonly order_id: string;
  readonly name: string;
  readonly description: string;
  readonly handler: (response: RazorpayCheckoutSuccessResponse) => void;
}

interface RazorpayCheckoutInstance {
  open: () => void;
}

declare global {
  interface Window {
    Razorpay?: new (
      options: RazorpayCheckoutOptions,
    ) => RazorpayCheckoutInstance;
  }
}

/** Loads the official hosted checkout.js exactly once per page, reusing an in-flight/completed load for subsequent clicks. */
function loadCheckoutScript(): Promise<void> {
  if (typeof window !== "undefined" && window.Razorpay) {
    return Promise.resolve();
  }

  const existing = document.getElementById(CHECKOUT_SCRIPT_ID);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Failed to load the Razorpay Checkout script.")),
      );
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = CHECKOUT_SCRIPT_ID;
    script.src = CHECKOUT_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Failed to load the Razorpay Checkout script."));
    document.body.appendChild(script);
  });
}

interface VerifiedEvidence {
  readonly razorpayPaymentId: string;
  readonly checkoutSignatureVerified: boolean;
  readonly razorpayPaymentStatus: string | null;
}

export function PayWithRazorpayButton({
  paymentAttemptId,
  webhookConfirmed,
}: {
  paymentAttemptId: string;
  /**
   * True only when the order's actual current webhook evidence
   * (`isPaymentCaptureConfirmedByRealWebhook`, computed server-side from
   * fresh order state) already shows a real, processed capture. Required —
   * never defaulted — so the caller cannot accidentally omit this and fall
   * back to the stale unconditional "awaiting" claim this fix removes.
   */
  webhookConfirmed: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState<VerifiedEvidence | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const prepared = await prepareCheckoutAction(paymentAttemptId);
      if (!prepared.ok || !prepared.checkout) {
        setError(prepared.error ?? DEFAULT_ERROR_MESSAGE);
        return;
      }
      const { checkout } = prepared;

      try {
        await loadCheckoutScript();
      } catch {
        setError(DEFAULT_ERROR_MESSAGE);
        return;
      }

      if (typeof window === "undefined" || !window.Razorpay) {
        setError(DEFAULT_ERROR_MESSAGE);
        return;
      }

      const razorpay = new window.Razorpay({
        key: checkout.razorpayKeyId,
        amount: checkout.amountSubunits,
        currency: checkout.currency,
        order_id: checkout.razorpayOrderId,
        name: checkout.name,
        description: checkout.description,
        handler: (response) => {
          startTransition(async () => {
            const result = await verifyCheckoutAction({
              paymentAttemptId: checkout.paymentAttemptId,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpayOrderId: response.razorpay_order_id,
              razorpaySignature: response.razorpay_signature,
            });
            if (!result.ok || !result.payment) {
              setError(result.error ?? DEFAULT_ERROR_MESSAGE);
              return;
            }
            setVerified({
              razorpayPaymentId: result.payment.razorpayPaymentId,
              checkoutSignatureVerified:
                result.payment.checkoutSignatureVerified,
              razorpayPaymentStatus: result.payment.razorpayPaymentStatus,
            });
          });
        },
      });
      razorpay.open();
    });
  }

  return (
    <div className="mt-2 flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        data-testid="pay-with-razorpay-button"
        className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
      >
        {isPending ? "Processing…" : "Pay with Razorpay"}
      </button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {verified && (
        <dl
          className="mt-1 text-xs text-muted-foreground"
          data-testid="checkout-verified-evidence"
        >
          <div>
            <dt className="inline font-medium">Razorpay Payment ID: </dt>
            <dd className="inline break-all">{verified.razorpayPaymentId}</dd>
          </div>
          <div>
            <dt className="inline font-medium">
              Checkout Signature Verified:{" "}
            </dt>
            <dd className="inline">
              {verified.checkoutSignatureVerified ? "Yes" : "No"}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">Provider Payment Status: </dt>
            <dd className="inline">
              {verified.razorpayPaymentStatus ?? "Awaiting webhook evidence"}
            </dd>
          </div>
          <p
            className="mt-1 font-medium text-foreground"
            data-testid="checkout-verified-status-message"
          >
            {webhookConfirmed
              ? "Payment capture confirmed by Razorpay Test Mode webhook."
              : "Checkout response verified — awaiting webhook confirmation."}
          </p>
        </dl>
      )}
    </div>
  );
}
