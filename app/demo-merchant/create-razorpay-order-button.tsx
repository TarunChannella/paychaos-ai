"use client";

/**
 * Phase 2B — Client Component that triggers `createRazorpayOrderAction` for
 * one existing Demo Merchant order. Contains no Razorpay Checkout UI, no
 * checkout.js, no payment/card form — it only submits the order's own ID
 * (never an amount, currency, or Razorpay identifier) and displays the
 * safe correlation evidence the action returns.
 */
import { useState, useTransition } from "react";

import {
  createRazorpayOrderAction,
  type CreateRazorpayOrderActionResult,
} from "./actions";

const DEFAULT_ERROR_MESSAGE =
  "Could not create the Razorpay Test Order. Please try again.";

export function CreateRazorpayOrderButton({ orderId }: { orderId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] =
    useState<CreateRazorpayOrderActionResult | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await createRazorpayOrderAction(orderId);
      setLastResult(result);
      if (!result.ok) {
        setError(result.error ?? DEFAULT_ERROR_MESSAGE);
      }
    });
  }

  return (
    <div className="mt-2 flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        data-testid="create-razorpay-order-button"
        className="inline-flex items-center justify-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
      >
        {isPending
          ? "Creating Razorpay Test Order…"
          : "Create Razorpay Test Order"}
      </button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {lastResult?.ok && lastResult.attempt && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="create-razorpay-order-result"
        >
          Attempt #{lastResult.attempt.attemptNo}: {lastResult.attempt.status}
        </p>
      )}
    </div>
  );
}
