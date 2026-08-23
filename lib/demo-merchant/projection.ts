/**
 * Phase 1D — deterministic composite-state projection
 * (docs/MONEY_INVARIANTS.md Section 8 "Human-Readable Composite States").
 *
 * Pure domain logic. No Supabase import, no `process.env` read, no network
 * call.
 *
 * `projectConceptualOrderState` maps the two independent database axes
 * (`payment_status`, `business_status`) plus `fulfilmentCount` onto the
 * single human-readable `ConceptualOrderState` used by UI/diagrams. It
 * rejects impossible combinations rather than silently presenting
 * misleading state: `business_status = FULFILLED` with `payment_status !=
 * PAID`, or `FULFILLED` with `fulfilmentCount < 1`, throws instead of
 * returning a value.
 *
 * ----------------------------------------------------------------------------
 * PHASE 1 FULFILMENT SAFETY
 * ----------------------------------------------------------------------------
 * This module never sets `businessStatus = "FULFILLED"` and never inserts
 * into `fulfilments` — it has no I/O at all. Every order Phase 1 can
 * construct comes from `createInitialMerchantOrder`
 * (`lib/demo-merchant/order.ts`), which always produces
 * `OPEN`/`fulfilmentCount = 0`. `FULFILLED` therefore never occurs for a
 * Phase-1-created order; this function only defines what a *valid*
 * `FULFILLED` projection would require, for Phase 2 to rely on once it adds
 * the actual fulfilment write path.
 * ----------------------------------------------------------------------------
 */

import {
  DemoMerchantDomainError,
  type ConceptualOrderState,
  type MerchantOrderState,
} from "./types";

export function projectConceptualOrderState(
  input: MerchantOrderState,
): ConceptualOrderState {
  const { paymentStatus, businessStatus, fulfilmentCount } = input;

  if (
    typeof fulfilmentCount !== "number" ||
    !Number.isInteger(fulfilmentCount) ||
    fulfilmentCount < 0
  ) {
    throw new DemoMerchantDomainError(
      "INVALID_FULFILMENT_COUNT",
      "fulfilmentCount must be a non-negative integer.",
    );
  }

  if (businessStatus === "FULFILLED") {
    if (paymentStatus !== "PAID") {
      throw new DemoMerchantDomainError(
        "IMPOSSIBLE_STATE_FULFILLED_WITHOUT_PAID",
        `business_status=FULFILLED requires payment_status=PAID; observed payment_status=${paymentStatus}. This combination is impossible and must not be presented as valid state.`,
      );
    }
    if (fulfilmentCount < 1) {
      throw new DemoMerchantDomainError(
        "IMPOSSIBLE_STATE_FULFILLED_WITHOUT_FULFILMENT",
        "business_status=FULFILLED requires at least one recorded fulfilment effect (fulfilmentCount >= 1).",
      );
    }
    return "FULFILLED";
  }

  // businessStatus === "OPEN"
  switch (paymentStatus) {
    case "UNPAID":
      return "CREATED";
    case "PENDING":
      return "PAYMENT_PENDING";
    case "FAILED_OBSERVED":
      return "PAYMENT_FAILED";
    case "PAID":
      return "PAID";
    default: {
      const exhaustiveCheck: never = paymentStatus;
      throw new DemoMerchantDomainError(
        "UNKNOWN_PAYMENT_STATUS",
        `Unrecognized payment_status: ${String(exhaustiveCheck)}`,
      );
    }
  }
}
