"use client";

/**
 * Phase 1E — Client Component that triggers the `createDemoMerchantOrderAction`
 * Server Action. Contains no Supabase import, no Razorpay UI of any kind,
 * and submits nothing to the server beyond the action call itself.
 */
import { useState, useTransition } from "react";

import { DemoUnlockDialog } from "@/components/access/demo-unlock-dialog";

import { createDemoMerchantOrderAction } from "./actions";

const DEFAULT_ERROR_MESSAGE =
  "Could not create the test order. Please try again.";

/**
 * The stable message the SERVER returns when the session is not authorized.
 *
 * Matched here only to decide whether to OFFER the unlock dialog. The refusal
 * itself already happened server-side — this component cannot grant anything,
 * and a visitor who dismisses the dialog is exactly as unauthorized as before.
 */
const LOCKED_MESSAGE = "Interactive actions require the Demo Access Code.";

export function CreateOrderButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [unlockOpen, setUnlockOpen] = useState(false);

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await createDemoMerchantOrderAction();
      if (result.ok) return;

      // The server refused because there is no authorized session. Offer the
      // code instead of leaving the visitor with an unexplained failure.
      if (result.error === LOCKED_MESSAGE) {
        setUnlockOpen(true);
        return;
      }
      setError(result.error ?? DEFAULT_ERROR_MESSAGE);
    });
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={isPending}
        className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
      >
        {isPending ? "Creating…" : "Create Internal Test Order"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Unlocking continues the action the visitor originally asked for, so
          they are not made to find the button again. */}
      <DemoUnlockDialog
        open={unlockOpen}
        onClose={() => setUnlockOpen(false)}
        onUnlocked={() => {
          setUnlockOpen(false);
          run();
        }}
      />
    </div>
  );
}
