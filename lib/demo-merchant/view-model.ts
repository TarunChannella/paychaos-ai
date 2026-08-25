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
type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];
type WebhookEventRow = Database["public"]["Tables"]["webhook_events"]["Row"];

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
 * The safe, UI-facing shape of one canonical Razorpay Payment (Phase 2C).
 * Every field here is server-derived from the persisted `payments` row.
 * Deliberately excludes the Checkout signature — it is never persisted
 * (docs/DATABASE.md Section 11) and must never be displayed
 * (this task's UI instructions: "Do NOT display the signature value").
 */
export interface PaymentViewModel {
  readonly id: string;
  readonly paymentAttemptId: string;
  readonly razorpayPaymentId: string;
  readonly razorpayPaymentStatus: string | null;
  readonly checkoutSignatureVerified: boolean;
  readonly checkoutVerifiedAt: string | null;
  readonly capturedAt: string | null;
  readonly failedAt: string | null;
}

export function toPaymentViewModel(row: PaymentRow): PaymentViewModel {
  return {
    id: row.id,
    paymentAttemptId: row.payment_attempt_id,
    razorpayPaymentId: row.razorpay_payment_id,
    razorpayPaymentStatus: row.razorpay_payment_status,
    checkoutSignatureVerified: row.checkout_signature_verified,
    checkoutVerifiedAt: row.checkout_verified_at,
    capturedAt: row.captured_at,
    failedAt: row.failed_at,
  };
}

/**
 * The Checkout-safe server projection for one payment attempt (Phase 2C).
 * Contains ONLY values required by Razorpay Standard Checkout plus safe
 * application correlation/display data — never `RAZORPAY_KEY_SECRET`,
 * never `RAZORPAY_WEBHOOK_SECRET`, never `SUPABASE_SERVICE_ROLE_KEY`
 * (docs/RAZORPAY_GUIDE.md Section 9, this task's Section 1).
 */
export interface CheckoutConfigViewModel {
  readonly razorpayKeyId: string;
  readonly razorpayOrderId: string;
  readonly amountSubunits: number;
  readonly currency: string;
  readonly paymentAttemptId: string;
  readonly orderId: string;
  readonly name: string;
  readonly description: string;
}

/**
 * Phase 2G readiness — the safe, UI-facing shape of one real webhook
 * evidence row (Section 6 "Basic Payment/Event Evidence UI — P0").
 *
 * Deliberately excludes `raw_payload_redacted` (never rendered — this
 * round's explicit "The UI must NEVER render: raw unredacted webhook
 * payload" rule extends to the redacted copy too, out of caution: a UI
 * projection stays structured-fields-only, matching every other view model
 * in this file) and `raw_body_sha256` (an integrity hash, not
 * judge-relevant evidence). `sourceKind` is always the literal
 * `"REAL_RAZORPAY_WEBHOOK"` here — `webhook_events.source_kind` is a fixed-
 * value database CHECK constraint (docs/DATABASE.md Section 13), so any row
 * this type wraps is real provider evidence by construction, never a
 * PayChaos replay/simulation/fixture (this round's Section 8 "Real vs
 * Synthetic Provenance").
 */
export interface WebhookEvidenceViewModel {
  readonly sourceKind: "REAL_RAZORPAY_WEBHOOK";
  readonly eventType: string;
  readonly signatureVerified: boolean;
  readonly processingStatus: WebhookEventRow["processing_status"];
  readonly receivedAt: string;
  readonly processedAt: string | null;
  readonly isDuplicateDelivery: boolean;
  readonly duplicateDeliveryCount: number;
}

export function toWebhookEvidenceViewModel(
  row: WebhookEventRow,
): WebhookEvidenceViewModel {
  return {
    sourceKind: "REAL_RAZORPAY_WEBHOOK",
    eventType: row.event_type,
    signatureVerified: row.signature_verified,
    processingStatus: row.processing_status,
    receivedAt: row.received_at,
    processedAt: row.processed_at,
    isDuplicateDelivery: row.duplicate_delivery_count > 0,
    duplicateDeliveryCount: row.duplicate_delivery_count,
  };
}

/**
 * The safe, UI-facing shape of one Demo Merchant order. Every field here is
 * server-derived (read back from the persisted `orders` row plus a real
 * `fulfilments` count) — nothing here is browser-supplied.
 *
 * `latestPaymentAttempt` is `null` until a Phase 2B Razorpay Order-creation
 * attempt has been made for this order — most orders will have none.
 * `latestPayment` (Phase 2C) is `null` until a Checkout response has been
 * verified for that attempt. `latestWebhookEvent` (Phase 2G readiness) is
 * `null` until a real, signature-verified Razorpay webhook correlated to
 * that payment has been received.
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
  readonly latestPayment: PaymentViewModel | null;
  readonly latestWebhookEvent: WebhookEvidenceViewModel | null;
}

/**
 * Maps a persisted `orders` row plus its real fulfilment count (and, if
 * they exist, its latest payment attempt, latest verified payment, and
 * latest correlated real webhook event) onto the safe view model, deriving
 * `conceptualState` via the approved Phase 1D projection (which itself
 * rejects impossible combinations rather than silently presenting
 * misleading state).
 */
export function toDemoMerchantOrderViewModel(
  row: OrderRow,
  fulfilmentCount: number,
  latestPaymentAttemptRow: PaymentAttemptRow | null = null,
  latestPaymentRow: PaymentRow | null = null,
  latestWebhookEventRow: WebhookEventRow | null = null,
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
    latestPayment: latestPaymentRow
      ? toPaymentViewModel(latestPaymentRow)
      : null,
    latestWebhookEvent: latestWebhookEventRow
      ? toWebhookEvidenceViewModel(latestWebhookEventRow)
      : null,
  };
}

/**
 * Phase 2G real-verification UI consistency fix — true only when
 * authoritative REAL_RAZORPAY_WEBHOOK evidence already confirms this
 * order's payment was captured.
 *
 * A confirmed bug: `pay-with-razorpay-button.tsx`'s post-Checkout evidence
 * block unconditionally claimed "awaiting webhook confirmation" even after
 * a real webhook had already processed the capture — because that claim
 * was derived only from the button's own ephemeral client-side Checkout-
 * verification result, never from the order's actual current webhook
 * evidence. This function is the single source of truth the page passes
 * down instead, so the claim is always order-state-derived, not stale
 * client state (this task's Cases A/B/D).
 *
 * Requires BOTH the order-level authoritative `paymentStatus` (`PAID` —
 * never merely "some webhook processed something", since e.g. an `order.paid`
 * event alone can reach `processingStatus: "PROCESSED"` without itself
 * authorizing capture, per the Phase 2F `order.paid` semantics) AND a
 * `latestWebhookEvent` that is itself real, processed evidence.
 *
 * Cannot be satisfied by synthetic/non-real evidence (this task's Case C):
 * `latestWebhookEvent` is only ever populated from an actual `webhook_events`
 * row, and that table's own `source_kind` CHECK constraint
 * (docs/DATABASE.md Section 13) guarantees every such row is genuine
 * Razorpay-delivered evidence — `WebhookEvidenceViewModel.sourceKind` is a
 * literal-typed `"REAL_RAZORPAY_WEBHOOK"`-only projection reinforcing the
 * same guarantee at the type level. A PayChaos replay/simulation/test
 * fixture can only ever exist in `event_processing_attempts`
 * (`PAYCHAOS_REPLAY`/`PAYCHAOS_SIMULATION`/`TEST_FIXTURE` source kinds), a
 * different table this projection never reads.
 *
 * Timing-agnostic by design (this task's Case D "webhook-first"): this
 * function only ever inspects the order's CURRENT final state, never the
 * order in which Checkout verification and webhook processing happened to
 * arrive.
 */
export function isPaymentCaptureConfirmedByRealWebhook(
  order: Pick<
    DemoMerchantOrderViewModel,
    "paymentStatus" | "latestWebhookEvent"
  >,
): boolean {
  return (
    order.paymentStatus === "PAID" &&
    order.latestWebhookEvent !== null &&
    order.latestWebhookEvent.sourceKind === "REAL_RAZORPAY_WEBHOOK" &&
    order.latestWebhookEvent.processingStatus === "PROCESSED"
  );
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
