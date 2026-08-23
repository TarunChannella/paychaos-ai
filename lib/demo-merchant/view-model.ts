/**
 * Phase 1E — DB row -> safe UI view-model mapping, and display-formatting
 * helpers.
 *
 * Pure domain/presentation logic. No Supabase import, no `process.env`
 * read, no network call. Reuses the approved Phase 1D
 * `projectConceptualOrderState` for the composite state rather than
 * reimplementing it (docs/MONEY_INVARIANTS.md Section 8).
 */

import { projectConceptualOrderState } from "./projection";
import type { ConceptualOrderState } from "./types";
import type { Database } from "@/lib/supabase/types";

type OrderRow = Database["public"]["Tables"]["orders"]["Row"];

/**
 * The safe, UI-facing shape of one Demo Merchant order. Every field here is
 * server-derived (read back from the persisted `orders` row plus a real
 * `fulfilments` count) — nothing here is browser-supplied.
 */
export interface DemoMerchantOrderViewModel {
  readonly id: string;
  readonly amountSubunits: number;
  readonly currency: string;
  readonly paymentStatus: OrderRow["payment_status"];
  readonly businessStatus: OrderRow["business_status"];
  readonly fulfilmentCount: number;
  readonly conceptualState: ConceptualOrderState;
  readonly createdAt: string;
}

/**
 * Maps a persisted `orders` row plus its real fulfilment count onto the
 * safe view model, deriving `conceptualState` via the approved Phase 1D
 * projection (which itself rejects impossible combinations rather than
 * silently presenting misleading state).
 */
export function toDemoMerchantOrderViewModel(
  row: OrderRow,
  fulfilmentCount: number,
): DemoMerchantOrderViewModel {
  const conceptualState = projectConceptualOrderState({
    paymentStatus: row.payment_status,
    businessStatus: row.business_status,
    fulfilmentCount,
  });

  return {
    id: row.id,
    amountSubunits: row.amount_subunits,
    currency: row.currency,
    paymentStatus: row.payment_status,
    businessStatus: row.business_status,
    fulfilmentCount,
    conceptualState,
    createdAt: row.created_at,
  };
}

/**
 * Formats integer smallest-currency subunits as a human-readable amount.
 *
 * Phase 1E's only fixed product is INR (2 decimal subunits), so this
 * assumes a 2-decimal subunit currency. It is display-only formatting, not
 * a money-invariant/validation function — `lib/demo-merchant/order.ts`
 * remains the sole source of amount/currency validation truth.
 */
export function formatAmountForDisplay(
  amountSubunits: number,
  currency: string,
): string {
  const major = (amountSubunits / 100).toFixed(2);
  return currency === "INR" ? `₹${major}` : `${currency} ${major}`;
}

/**
 * Human-readable label per `ConceptualOrderState`. `CREATED` (which is what
 * every Phase 1E order starts as: UNPAID/OPEN/0) is deliberately labeled
 * "Created", never anything implying failure — UNPAID alone is not
 * FAILED_OBSERVED.
 */
const CONCEPTUAL_STATE_LABELS: Record<ConceptualOrderState, string> = {
  CREATED: "Created",
  PAYMENT_PENDING: "Payment Pending",
  PAYMENT_FAILED:
    "Payment Failed (a later successful payment is still possible)",
  PAID: "Paid",
  FULFILLED: "Fulfilled",
};

export function formatConceptualState(state: ConceptualOrderState): string {
  return CONCEPTUAL_STATE_LABELS[state];
}
