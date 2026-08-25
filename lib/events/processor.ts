/**
 * Phase 2F — merchant processor application boundary (this task's Section
 * 25).
 *
 * `import "server-only"` for the same structural reason as every other I/O
 * module in this codebase: it transitively performs Supabase I/O through
 * `lib/webhooks/event-processing-repository.ts` and must never be
 * reachable from a client bundle.
 *
 * This module is intentionally NOT an "agent" — it does no reasoning, no
 * AI, no business-rule evaluation of its own. It:
 *
 *   - invokes the single narrow, trusted `process_webhook_payment_event`
 *     Postgres RPC (via the repository) using ONLY an internal
 *     `event_processing_attempts.id` — never a browser-supplied order id,
 *     payment id, amount, currency, desired status, or fulfilment key;
 *   - validates the RPC's small trusted return shape;
 *   - translates any repository/database failure into one of a small,
 *     deterministic, safe `ProcessorFailureCode` — never forwarding a raw
 *     database error message, raw SQL text, a secret, the raw webhook
 *     body, or card/customer information.
 *
 * All actual money/business-state logic (payment.captured/failed/order.paid
 * handling, amount/currency consistency, fulfilment idempotency, atomicity)
 * lives in the single SQL transaction
 * (supabase/migrations/20260828000000_phase2f_merchant_processing.sql) —
 * this module is a thin, safe, typed boundary in front of it, not a
 * reimplementation of it.
 */
import "server-only";

import {
  EventProcessingRepositoryError,
  processWebhookPaymentEvent,
} from "@/lib/webhooks/event-processing-repository";

export type ProcessorFailureCode =
  | "PROCESSING_ATTEMPT_NOT_FOUND"
  | "PROCESSING_ATTEMPT_NOT_READY"
  | "PROCESSING_SOURCE_INVALID"
  | "PROCESSING_EVENT_INVALID"
  | "PROCESSING_CORRELATION_INVALID"
  | "PROCESSING_PAYMENT_REQUIRED"
  | "PROCESSING_AMOUNT_MISMATCH"
  | "PROCESSING_CURRENCY_MISMATCH"
  | "PROCESSING_FULFILMENT_CONFLICT"
  | "PROCESSING_TRANSACTION_FAILED";

const PROCESSOR_FAILURE_CODES: ReadonlySet<string> =
  new Set<ProcessorFailureCode>([
    "PROCESSING_ATTEMPT_NOT_FOUND",
    "PROCESSING_ATTEMPT_NOT_READY",
    "PROCESSING_SOURCE_INVALID",
    "PROCESSING_EVENT_INVALID",
    "PROCESSING_CORRELATION_INVALID",
    "PROCESSING_PAYMENT_REQUIRED",
    "PROCESSING_AMOUNT_MISMATCH",
    "PROCESSING_CURRENCY_MISMATCH",
    "PROCESSING_FULFILMENT_CONFLICT",
    "PROCESSING_TRANSACTION_FAILED",
  ]);

function isProcessorFailureCode(value: string): value is ProcessorFailureCode {
  return PROCESSOR_FAILURE_CODES.has(value);
}

/** Fixed, safe messages only — never derived from a raw database error. */
const SAFE_MESSAGES: Record<ProcessorFailureCode, string> = {
  PROCESSING_ATTEMPT_NOT_FOUND: "The processing attempt could not be found.",
  PROCESSING_ATTEMPT_NOT_READY:
    "The processing attempt is not in a state that can be processed.",
  PROCESSING_SOURCE_INVALID:
    "The processing attempt does not carry valid webhook evidence.",
  PROCESSING_EVENT_INVALID:
    "The processing attempt's normalized event is missing, malformed, or unsupported.",
  PROCESSING_CORRELATION_INVALID:
    "The processing attempt's correlated records do not agree.",
  PROCESSING_PAYMENT_REQUIRED:
    "This event requires a correlated payment, but none was found.",
  PROCESSING_AMOUNT_MISMATCH:
    "The event's amount does not match the correlated records.",
  PROCESSING_CURRENCY_MISMATCH:
    "The event's currency does not match the correlated records.",
  PROCESSING_FULFILMENT_CONFLICT:
    "An existing fulfilment for this order does not agree with this payment.",
  PROCESSING_TRANSACTION_FAILED: "Merchant processing failed.",
};

/**
 * The processor's own error type — deliberately distinct from
 * `EventProcessingRepositoryError` (this task's Section 25: "translates
 * database failures into deterministic safe application errors"). Its
 * `.message` is always one of the fixed `SAFE_MESSAGES` strings above,
 * never raw database error text.
 */
export class MerchantProcessingError extends Error {
  readonly code: ProcessorFailureCode;

  constructor(code: ProcessorFailureCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "MerchantProcessingError";
    this.code = code;
  }
}

export interface MerchantProcessingResult {
  readonly outcome: "processed" | "already_processed";
  readonly eventType: string;
  readonly orderId: string;
  readonly paymentId: string | null;
  readonly fulfilmentId: string | null;
}

/**
 * Processes one durable, normalized, correlated `event_processing_attempts`
 * row through the trusted Phase 2F merchant-processing transaction.
 *
 * `processingAttemptId` is the ONLY input — an internal PayChaos UUID
 * already resolved server-side by `lib/webhooks/service.ts` from its own
 * trusted persistence, never a value read directly from an incoming HTTP
 * request body or browser state.
 *
 * Throws `MerchantProcessingError` with a deterministic safe `.code` on any
 * failure — never a raw database error, never a raw webhook body, never a
 * secret.
 */
export async function processMerchantWebhookEvent(
  processingAttemptId: string,
): Promise<MerchantProcessingResult> {
  try {
    const result = await processWebhookPaymentEvent(processingAttemptId);
    return {
      outcome: result.outcome,
      eventType: result.eventType,
      orderId: result.orderId,
      paymentId: result.paymentId,
      fulfilmentId: result.fulfilmentId,
    };
  } catch (err) {
    if (
      err instanceof EventProcessingRepositoryError &&
      isProcessorFailureCode(err.code)
    ) {
      throw new MerchantProcessingError(err.code);
    }
    throw new MerchantProcessingError("PROCESSING_TRANSACTION_FAILED");
  }
}
