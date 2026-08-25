/**
 * Phase 2E — deterministic, pure normalization of an already-verified,
 * already-redacted Razorpay webhook event into a small typed internal
 * model.
 *
 * Consumes ONLY already-authenticated safe evidence — the
 * `raw_payload_redacted` object `lib/webhooks/redaction.ts` builds AFTER
 * signature verification succeeds (this task's Section 6). This module
 * never sees the raw webhook body, the signature, or any unredacted
 * field — it cannot leak email/contact/VPA/card/bank/notes/method/tokens
 * because none of those field names ever reach it in the first place.
 *
 * Pure function: no I/O, no Supabase, no `server-only` marker needed.
 *
 * Supported P0 event catalogue (frozen — docs/RAZORPAY_GUIDE.md Section
 * 23, docs/PHASE_PLAN.md "Phase 2E"): exactly `payment.captured`,
 * `payment.failed`, `order.paid`. Any other authenticated event type is
 * NOT an error — it is reported as `outcome: "unsupported"` so the caller
 * can preserve the canonical webhook evidence and return a safe 2xx
 * without fabricating normalized data for it (this task's Section 19).
 */

export const SUPPORTED_RAZORPAY_EVENT_TYPES = [
  "payment.captured",
  "payment.failed",
  "order.paid",
] as const;

export type SupportedRazorpayEventType =
  (typeof SUPPORTED_RAZORPAY_EVENT_TYPES)[number];

const SUPPORTED_EVENT_TYPE_SET: ReadonlySet<string> = new Set(
  SUPPORTED_RAZORPAY_EVENT_TYPES,
);

interface NormalizedEventCommon {
  /** Bumped only on a genuine breaking change to this shape. */
  readonly schemaVersion: 1;
  readonly sourceKind: "REAL_RAZORPAY_WEBHOOK";
  readonly razorpayEventId: string;
  readonly eventType: SupportedRazorpayEventType;
  readonly providerCreatedAt: string | null;
}

export interface NormalizedPaymentCapturedEvent extends NormalizedEventCommon {
  readonly kind: "payment.captured";
  readonly razorpayOrderId: string;
  readonly razorpayPaymentId: string;
  readonly amountSubunits: number;
  readonly currency: string;
  readonly razorpayPaymentStatus: "captured";
}

export interface NormalizedPaymentFailedEvent extends NormalizedEventCommon {
  readonly kind: "payment.failed";
  readonly razorpayOrderId: string;
  readonly razorpayPaymentId: string;
  readonly amountSubunits: number;
  readonly currency: string;
  readonly razorpayPaymentStatus: "failed";
  readonly errorCode: string | null;
  readonly errorSource: string | null;
  readonly errorStep: string | null;
  readonly errorReason: string | null;
}

export interface NormalizedOrderPaidEvent extends NormalizedEventCommon {
  readonly kind: "order.paid";
  readonly razorpayOrderId: string;
  /** NULL when the safe event payload does not contain one — never invented. */
  readonly razorpayPaymentId: string | null;
  readonly amountSubunits: number;
  readonly currency: string;
}

export type NormalizedRazorpayEvent =
  | NormalizedPaymentCapturedEvent
  | NormalizedPaymentFailedEvent
  | NormalizedOrderPaidEvent;

export type NormalizationResult =
  | { readonly outcome: "normalized"; readonly event: NormalizedRazorpayEvent }
  | { readonly outcome: "unsupported"; readonly eventType: string }
  | { readonly outcome: "invalid"; readonly reason: string };

export interface NormalizeRazorpayEventInput {
  readonly razorpayEventId: string;
  readonly eventType: string;
  readonly providerCreatedAt: string | null;
  /** The already-redacted `webhook_events.raw_payload_redacted`-shaped object. */
  readonly safeEvidence: Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const CURRENCY_FORMAT = /^[A-Z]{3}$/;

function isValidCurrency(value: unknown): value is string {
  return typeof value === "string" && CURRENCY_FORMAT.test(value);
}

/** Money must be a positive, safe (no float-precision-loss) integer subunit count — never a float, never zero/negative. */
function isPositiveSafeIntegerAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function invalid(reason: string): NormalizationResult {
  return { outcome: "invalid", reason };
}

function safeNullableString(value: unknown): string | null {
  return isNonEmptyString(value) ? value : null;
}

/**
 * Normalizes one already-verified, already-redacted Razorpay webhook event.
 *
 * Never throws — every rejection path returns a typed `"invalid"` or
 * `"unsupported"` outcome instead, so the caller can decide how to record
 * it (this task's Section 18/19).
 */
export function normalizeRazorpayEvent(
  input: NormalizeRazorpayEventInput,
): NormalizationResult {
  const { razorpayEventId, eventType, providerCreatedAt, safeEvidence } = input;

  if (!SUPPORTED_EVENT_TYPE_SET.has(eventType)) {
    return { outcome: "unsupported", eventType };
  }
  const supportedEventType = eventType as SupportedRazorpayEventType;

  const common = {
    schemaVersion: 1 as const,
    sourceKind: "REAL_RAZORPAY_WEBHOOK" as const,
    razorpayEventId,
    eventType: supportedEventType,
    providerCreatedAt,
  };

  const payment = isPlainObject(safeEvidence.payment)
    ? safeEvidence.payment
    : undefined;
  const order = isPlainObject(safeEvidence.order)
    ? safeEvidence.order
    : undefined;

  if (
    supportedEventType === "payment.captured" ||
    supportedEventType === "payment.failed"
  ) {
    if (!payment) return invalid("missing payment evidence");
    if (!isNonEmptyString(payment.id)) return invalid("missing payment.id");
    if (!isNonEmptyString(payment.order_id)) {
      return invalid("missing payment.order_id");
    }
    if (!isPositiveSafeIntegerAmount(payment.amount)) {
      return invalid("invalid payment.amount");
    }
    if (!isValidCurrency(payment.currency)) {
      return invalid("invalid payment.currency");
    }

    if (supportedEventType === "payment.captured") {
      if (payment.status !== "captured") {
        return invalid('payment.status must be "captured"');
      }
      return {
        outcome: "normalized",
        event: {
          ...common,
          kind: "payment.captured",
          razorpayOrderId: payment.order_id,
          razorpayPaymentId: payment.id,
          amountSubunits: payment.amount,
          currency: payment.currency,
          razorpayPaymentStatus: "captured",
        },
      };
    }

    if (payment.status !== "failed") {
      return invalid('payment.status must be "failed"');
    }
    return {
      outcome: "normalized",
      event: {
        ...common,
        kind: "payment.failed",
        razorpayOrderId: payment.order_id,
        razorpayPaymentId: payment.id,
        amountSubunits: payment.amount,
        currency: payment.currency,
        razorpayPaymentStatus: "failed",
        errorCode: safeNullableString(payment.error_code),
        errorSource: safeNullableString(payment.error_source),
        errorStep: safeNullableString(payment.error_step),
        errorReason: safeNullableString(payment.error_reason),
      },
    };
  }

  // order.paid
  if (!order) return invalid("missing order evidence");
  if (!isNonEmptyString(order.id)) return invalid("missing order.id");
  if (!isPositiveSafeIntegerAmount(order.amount)) {
    return invalid("invalid order.amount");
  }
  if (!isValidCurrency(order.currency))
    return invalid("invalid order.currency");
  if (order.status !== "paid") return invalid('order.status must be "paid"');

  return {
    outcome: "normalized",
    event: {
      ...common,
      kind: "order.paid",
      razorpayOrderId: order.id,
      // Never invented — only used if the safe payment evidence actually
      // contains one (this task's Section 5 "order.paid").
      razorpayPaymentId: safeNullableString(payment?.id),
      amountSubunits: order.amount,
      currency: order.currency,
    },
  };
}
