/**
 * Phase 1E/2B — DB row -> safe UI view-model mapping, and display-formatting
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
type PaymentAttemptRow =
  Database["public"]["Tables"]["payment_attempts"]["Row"];

/**
 * The safe, UI-facing shape of one payment attempt. Every field here is
 * server-derived from the persisted `payment_attempts` row — the Key
 * Secret never appears anywhere in this module, and `razorpay_order_id`/
 * `razorpay_order_status` are correlation evidence, not secrets
 * (docs/RAZORPAY_GUIDE.md Section 50).
 */
export interface PaymentAttemptViewModel {
  readonly id: string;
  readonly orderId: string;
  readonly attemptNo: number;
  readonly amountSubunits: number;
  readonly currency: string;
  readonly status: PaymentAttemptRow["status"];
  readonly razorpayReceipt: string;
  readonly razorpayOrderId: string | null;
  readonly razorpayOrderStatus: string | null;
  readonly createdAt: string;
}

export function toPaymentAttemptViewModel(
  row: PaymentAttemptRow,
): PaymentAttemptViewModel {
  return {
    id: row.id,
    orderId: row.order_id,
    attemptNo: row.attempt_no,
    amountSubunits: row.amount_subunits,
    currency: row.currency,
    status: row.status,
    razorpayReceipt: row.razorpay_receipt,
    razorpayOrderId: row.razorpay_order_id,
    razorpayOrderStatus: row.razorpay_order_status,
    createdAt: row.created_at,
  };
}

/**
 * The safe, UI-facing shape of one Demo Merchant order. Every field here is
 * server-derived (read back from the persisted `orders` row plus a real
 * `fulfilments` count) — nothing here is browser-supplied.
 *
 * `latestPaymentAttempt` is `null` until a Phase 2B Razorpay Order-creation
 * attempt has been made for this order — most orders will have none.
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
  readonly latestPaymentAttempt: PaymentAttemptViewModel | null;
}

/**
 * Maps a persisted `orders` row plus its real fulfilment count (and, if one
 * exists, its latest payment attempt) onto the safe view model, deriving
 * `conceptualState` via the approved Phase 1D projection (which itself
 * rejects impossible combinations rather than silently presenting
 * misleading state).
 */
export function toDemoMerchantOrderViewModel(
  row: OrderRow,
  fulfilmentCount: number,
  latestPaymentAttemptRow: PaymentAttemptRow | null = null,
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
    latestPaymentAttempt: latestPaymentAttemptRow
      ? toPaymentAttemptViewModel(latestPaymentAttemptRow)
      : null,
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
