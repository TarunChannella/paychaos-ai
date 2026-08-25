/**
 * Phase 2D/2E/2F — Razorpay webhook ingestion + deduplication + event
 * normalization + merchant processing orchestration.
 *
 * `import "server-only"` for the same structural reason as
 * `lib/demo-merchant/service.ts`: this module performs I/O (through the
 * repositories) and reads the server-only webhook secret transitively, and
 * must never be reachable from a client bundle.
 *
 * Frozen flow (docs/ARCHITECTURE.md's "Webhook Route -> Webhook
 * Verification Service -> Event Repository -> Event Processor" reference
 * shape; this task's Section 2):
 *
 *   exact raw bytes
 *     -> bounded size check
 *     -> require X-Razorpay-Signature
 *     -> HMAC-SHA256 verify (RAW BYTES, never re-serialized JSON)
 *     -> ONLY IF VERIFIED: require x-razorpay-event-id (trimmed, non-empty)
 *     -> parse JSON
 *     -> validate minimum envelope (object; non-empty "event" string, trimmed)
 *     -> hash the SAME raw bytes already verified
 *     -> build allowlisted redacted evidence
 *     -> attempt canonical webhook_events insert
 *          -> fresh: proceed to normalize/correlate below
 *          -> 23505 (duplicate): atomically increment duplicate_delivery_count;
 *             if a durable normalized-or-later (PENDING/HELD/PROCESSING/
 *             SUCCEEDED) processing attempt already exists for this event,
 *             record a SKIPPED_DUPLICATE attempt and return
 *             "duplicate_received" WITHOUT re-normalizing; otherwise (no
 *             eligible attempt yet — none at all, or every attempt so far
 *             FAILED) retry normalization below exactly like a fresh event
 *             (this task's Section 14; 2026-08-27 architect review
 *             correction "Correction B" — the pre-correction version only
 *             checked whether the single LATEST row happened to be
 *             PENDING, which a later SKIPPED_DUPLICATE/FAILED row could
 *             incorrectly hide an eligible earlier attempt behind)
 *     -> normalize the safe redacted evidence FROM THE CANONICAL PERSISTED
 *        ROW (lib/events/normalization.ts) — never from this specific
 *        delivery's own locally-parsed body, even on the fresh-insert path
 *        (this task's Section 6/"Correction D": a later duplicate
 *        delivery must never be able to redefine an already-canonical
 *        logical event; a safe non-rejecting mismatch warning is logged if
 *        a duplicate's own body/event-type differs from the canonical row)
 *          -> unsupported event type: preserve canonical evidence, create NO
 *             processing attempt, return "unsupported_event_accepted"
 *             (this task's Section 19)
 *          -> invalid (malformed supported payload): record a FAILED
 *             processing attempt where practical, throw (-> 400)
 *     -> correlate to an internal payment_attempt via razorpay_order_id,
 *        and to a payments row via razorpay_payment_id (creating one from
 *        webhook evidence if Checkout hasn't already — "webhook-first
 *        payment observation", this task's Section 8); an existing
 *        canonical payment must fully agree on attempt/payment-id/amount/
 *        currency (2026-08-27 "Correction E") or the event fails closed
 *        with PAYMENT_EVIDENCE_CONFLICT
 *     -> update webhook_events' derived correlation fields FIRST; only
 *        once that durably succeeds, persist one PENDING
 *        event_processing_attempts row (READY FOR PHASE 2F — this task's
 *        Section 17). A derived-field-update failure is fatal (-> 500,
 *        safe to retry) and creates NO PENDING row (2026-08-27
 *        "Correction C" — the pre-correction version created the PENDING
 *        row first and swallowed a derived-field-update failure, which
 *        could permanently strand webhook_events with missing correlation
 *        fields once a later duplicate saw the PENDING row and stopped
 *        retrying)
 *     -> Phase 2F: invoke the single narrow merchant-processing transaction
 *        (`lib/events/processor.ts` -> `process_webhook_payment_event`)
 *        against the durable PENDING attempt — NEVER acknowledge 2xx before
 *        this succeeds (this task's Section 22). A processing failure is
 *        marked on the attempt via a status-guarded conditional update
 *        (never regressing an already-SUCCEEDED attempt — "ambiguous RPC
 *        failure safety", this task's Section 21) and propagates as a safe
 *        5xx so Razorpay/the caller redelivers later.
 *     -> respond 2xx ONLY after merchant processing has actually succeeded
 *        (or already idempotently succeeded)
 *
 * For a genuine duplicate delivery whose existing durable attempt is not
 * yet SUCCEEDED (PENDING/PROCESSING/HELD), the merchant-processing
 * transaction is invoked against that SAME existing attempt before a
 * SKIPPED_DUPLICATE evidence row is recorded and 2xx returned (this task's
 * Section 23) — a duplicate must never receive 2xx merely because merchant
 * processing is still uncompleted.
 *
 * Merchant/payment authoritative-state application
 * (orders.payment_status/business_status, payment_attempts.status,
 * payments.razorpay_payment_status/captured_at/failed_at, and fulfilment
 * creation) happens EXCLUSIVELY inside the single Phase 2F SQL transaction
 * — this module never mutates any of those fields directly; it only
 * invokes the trusted processor boundary with an internal processing
 * attempt id.
 */
import "server-only";

import { createHash } from "node:crypto";

import {
  getPaymentAttemptByRazorpayOrderId,
  getPaymentByRazorpayPaymentId,
  insertPaymentFromWebhookEvidence,
  type PaymentAttemptRow,
  type PaymentRow,
} from "@/lib/demo-merchant/repository";
import {
  normalizeRazorpayEvent,
  type NormalizedRazorpayEvent,
} from "@/lib/events/normalization";
import {
  MerchantProcessingError,
  processMerchantWebhookEvent,
} from "@/lib/events/processor";
import { verifyWebhookSignature } from "@/lib/razorpay/webhook-verification";
import { logEvent } from "@/lib/security/logger";

import {
  getDurableNormalizedAttemptForWebhookEvent,
  insertEventProcessingAttempt,
  markEventProcessingAttemptFailedIfNotFinal,
  type EventProcessingAttemptRow,
} from "./event-processing-repository";
import {
  buildRedactedWebhookEvidence,
  extractProviderCreatedAt,
} from "./redaction";
import {
  incrementWebhookDuplicateDeliveryCount,
  insertWebhookEvent,
  updateWebhookEventDerivedFields,
  type WebhookEventRow,
} from "./repository";

/**
 * PayChaos application safety bound — NOT a claimed Razorpay platform
 * limit. Real Razorpay Test Mode webhook payloads are far smaller than
 * this; the bound exists only to reject an obviously oversized request
 * cheaply, before any trusted processing (docs/SECURITY.md Section 22
 * "Request Size").
 */
export const MAX_WEBHOOK_BODY_BYTES = 1 * 1024 * 1024;

export class WebhookPayloadTooLargeError extends Error {
  constructor() {
    super("Webhook payload exceeds the maximum allowed size.");
    this.name = "WebhookPayloadTooLargeError";
  }
}

export class WebhookSignatureMissingError extends Error {
  constructor() {
    super("Missing X-Razorpay-Signature header.");
    this.name = "WebhookSignatureMissingError";
  }
}

export class WebhookSignatureInvalidError extends Error {
  constructor() {
    super("Webhook signature verification failed.");
    this.name = "WebhookSignatureInvalidError";
  }
}

export class WebhookEventIdMissingError extends Error {
  constructor() {
    super("Missing x-razorpay-event-id header.");
    this.name = "WebhookEventIdMissingError";
  }
}

export class WebhookPayloadMalformedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookPayloadMalformedError";
  }
}

/** A supported event's own required fields were missing/invalid (this task's Section 18 "NORMALIZATION_INVALID_PAYLOAD"). Maps to the same 400 status class as `WebhookPayloadMalformedError` — the "existing contract" this task's Section 30 route table refers to. */
export class WebhookEventNormalizationInvalidError extends Error {
  constructor(reason: string) {
    super(`Webhook event payload failed normalization: ${reason}`);
    this.name = "WebhookEventNormalizationInvalidError";
  }
}

export type CorrelationFailureCode =
  | "CORRELATION_ORDER_NOT_FOUND"
  | "CORRELATION_PAYMENT_MISMATCH"
  | "PAYMENT_EVIDENCE_CONFLICT"
  | "NORMALIZATION_PERSISTENCE_FAILED";

/** A supported, validly-normalized event could not be safely correlated/persisted (this task's Section 18/30 "normalization/correlation persistence failure"). Always safe to retry — maps to 500 so Razorpay redelivers later. */
export class WebhookEventCorrelationFailedError extends Error {
  readonly code: CorrelationFailureCode;

  constructor(code: CorrelationFailureCode, message: string) {
    super(message);
    this.name = "WebhookEventCorrelationFailedError";
    this.code = code;
  }
}

/**
 * Phase 2F — a durable, normalized, correlated processing attempt could not
 * be successfully processed by the merchant-processing transaction (this
 * task's Section 22 "If merchant processing fails: return safe 5xx"). Never
 * acknowledge 2xx before this succeeds. Always safe to retry — the
 * business-effect idempotency the Phase 2F transaction itself guarantees
 * means a later retry (whether a genuine Razorpay redelivery or the normal
 * webhook retry flow) can safely re-attempt the same logical effect.
 */
export class WebhookMerchantProcessingFailedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WebhookMerchantProcessingFailedError";
    this.code = code;
  }
}

export interface IngestRazorpayWebhookInput {
  /** The EXACT raw bytes of the incoming request body. */
  readonly rawBody: Buffer;
  readonly signatureHeader: string | null;
  readonly eventIdHeader: string | null;
}

export type IngestRazorpayWebhookResult =
  | {
      readonly outcome: "processed";
      readonly webhookEventId: string;
      readonly eventType: string;
    }
  | {
      readonly outcome: "duplicate_received";
      readonly webhookEventId: string;
      readonly eventType: string;
    }
  | {
      readonly outcome: "unsupported_event_accepted";
      readonly webhookEventId: string;
      readonly eventType: string;
    };

/**
 * Records a best-effort `FAILED` `event_processing_attempts` row (this
 * task's Section 18 "where practical"). Never throws — a failure to
 * RECORD the failure must never mask the original error the caller is
 * about to throw, and must never itself become an unhandled rejection.
 */
async function recordFailedProcessingAttempt(
  webhookEventId: string,
  paymentAttemptId: string | null,
  isDuplicateDelivery: boolean,
  errorCode: string,
  errorMessageRedacted: string,
): Promise<void> {
  try {
    await insertEventProcessingAttempt({
      webhookEventId,
      paymentAttemptId,
      paymentId: null,
      isDuplicateDelivery,
      status: "FAILED",
      normalizedEvent: {},
      errorCode,
      errorMessageRedacted,
    });
  } catch {
    logEvent("webhook_failed_attempt_record_failed", {
      razorpay_event_id: webhookEventId,
    });
  }
}

/**
 * Phase 2F — invokes the merchant-processing transaction for one durable
 * processing attempt (this task's Section 22). On success, returns the
 * trusted result. On failure, performs "ambiguous RPC failure safety" (this
 * task's Section 21): a best-effort, status-guarded `FAILED` mark (never
 * regressing an already-`SUCCEEDED` attempt, since the conditional update
 * only matches `PENDING`/`PROCESSING`), then throws
 * `WebhookMerchantProcessingFailedError` — always safe to retry, always
 * mapped to a 5xx by the route so Razorpay/the caller redelivers later.
 * Never acknowledges success before this succeeds (this task's Section 22
 * "Do NOT acknowledge 2xx merely because normalization reached PENDING").
 */
async function runMerchantProcessingOrFail(
  attempt: EventProcessingAttemptRow,
): Promise<Awaited<ReturnType<typeof processMerchantWebhookEvent>>> {
  try {
    return await processMerchantWebhookEvent(attempt.id);
  } catch (err) {
    const code =
      err instanceof MerchantProcessingError
        ? err.code
        : "PROCESSING_TRANSACTION_FAILED";
    const message =
      err instanceof MerchantProcessingError
        ? err.message
        : "Merchant processing failed.";

    // Belt-and-suspenders: `markEventProcessingAttemptFailedIfNotFinal` is
    // itself documented to never throw (it swallows its own I/O failures
    // internally), but this call must NEVER be allowed to mask the
    // ORIGINAL merchant-processing error being propagated below, even if
    // that contract were ever violated.
    try {
      await markEventProcessingAttemptFailedIfNotFinal(
        attempt.id,
        code,
        message,
      );
    } catch {
      logEvent("webhook_failed_attempt_record_failed", {
        event_processing_attempt_id: attempt.id,
      });
    }
    logEvent("webhook_merchant_processing_failed", {
      event_processing_attempt_id: attempt.id,
      processing_failure_code: code,
    });
    throw new WebhookMerchantProcessingFailedError(code, message);
  }
}

/**
 * Full canonical-identity agreement check for an existing/race-won
 * `payments` row against this event's normalized payment evidence
 * (2026-08-27 architect review correction "Correction E"). Checking only
 * `payment_attempt_id` was incomplete — a row could share the same
 * attempt yet disagree on money terms or even (in a pathological race) the
 * Razorpay Payment ID itself. This is a CONSISTENCY check on one already-
 * identified canonical row, not an early Money Invariant evaluation
 * (Phase 3's job) — a genuine amount/currency disagreement here means the
 * canonical row does not actually describe the same payment this event is
 * evidence for, which must fail closed rather than silently accepted or
 * overwritten.
 */
function paymentIdentityAgrees(
  payment: PaymentRow,
  paymentAttemptId: string,
  razorpayPaymentId: string,
  amountSubunits: number,
  currency: string,
): boolean {
  return (
    payment.payment_attempt_id === paymentAttemptId &&
    payment.razorpay_payment_id === razorpayPaymentId &&
    payment.amount_subunits === amountSubunits &&
    payment.currency === currency
  );
}

/**
 * Correlates one normalized event to an internal payment attempt (and,
 * where applicable, a canonical payment), updates `webhook_events`'
 * derived fields, and — ONLY once that durably succeeds — persists a
 * durable `PENDING` processing attempt (this task's Sections 7-10).
 *
 * Ordering is deliberate (2026-08-27 architect review correction
 * "Correction C"): the derived-field update happens BEFORE the `PENDING`
 * attempt is created, and a derived-field-update failure is FATAL (not
 * swallowed) — creating a `PENDING` attempt before the correlation
 * evidence it depends on is durably persisted would let a later duplicate
 * delivery see that `PENDING` row, skip re-normalization (Correction B),
 * and permanently strand `webhook_events` with missing derived fields.
 * With this ordering, a derived-field-update failure simply causes THIS
 * delivery to fail safely (5xx) with no `PENDING` row created at all — a
 * later duplicate delivery finds no durable eligible attempt yet and
 * retries the whole correlation, including the derived-field update,
 * naturally repairing it.
 *
 * Throws `WebhookEventCorrelationFailedError` on any failure — every
 * failure path also attempts to record a `FAILED` processing attempt
 * first (best-effort; `FAILED` is never itself treated as an eligible
 * durable attempt, so it can never mask a genuine retry).
 */
async function correlateNormalizeAndPersist(
  webhookEventRow: WebhookEventRow,
  normalized: NormalizedRazorpayEvent,
  isDuplicateDelivery: boolean,
): Promise<EventProcessingAttemptRow> {
  let resolvedAttempt: PaymentAttemptRow | null;
  try {
    resolvedAttempt = await getPaymentAttemptByRazorpayOrderId(
      normalized.razorpayOrderId,
    );
  } catch {
    await recordFailedProcessingAttempt(
      webhookEventRow.id,
      null,
      isDuplicateDelivery,
      "NORMALIZATION_PERSISTENCE_FAILED",
      "Failed to look up the correlated payment attempt.",
    );
    throw new WebhookEventCorrelationFailedError(
      "NORMALIZATION_PERSISTENCE_FAILED",
      "Failed to look up the correlated payment attempt.",
    );
  }

  if (!resolvedAttempt) {
    await recordFailedProcessingAttempt(
      webhookEventRow.id,
      null,
      isDuplicateDelivery,
      "CORRELATION_ORDER_NOT_FOUND",
      "No payment attempt correlates to the event's Razorpay Order ID.",
    );
    throw new WebhookEventCorrelationFailedError(
      "CORRELATION_ORDER_NOT_FOUND",
      "No payment attempt correlates to the event's Razorpay Order ID.",
    );
  }

  let payment: PaymentRow | null = null;

  if (
    normalized.kind === "payment.captured" ||
    normalized.kind === "payment.failed"
  ) {
    const existingPayment = await getPaymentByRazorpayPaymentId(
      normalized.razorpayPaymentId,
    );
    if (existingPayment) {
      if (
        !paymentIdentityAgrees(
          existingPayment,
          resolvedAttempt.id,
          normalized.razorpayPaymentId,
          normalized.amountSubunits,
          normalized.currency,
        )
      ) {
        await recordFailedProcessingAttempt(
          webhookEventRow.id,
          resolvedAttempt.id,
          isDuplicateDelivery,
          "PAYMENT_EVIDENCE_CONFLICT",
          "The existing canonical payment does not fully agree with this event's evidence (attempt/payment id/amount/currency).",
        );
        throw new WebhookEventCorrelationFailedError(
          "PAYMENT_EVIDENCE_CONFLICT",
          "The existing canonical payment does not fully agree with this event's evidence (attempt/payment id/amount/currency).",
        );
      }
      payment = existingPayment;
    } else {
      // Webhook-first payment observation (this task's Section 8) — the
      // Phase 2C Checkout callback may never have arrived (or may still
      // be in flight).
      const inserted = await insertPaymentFromWebhookEvidence({
        paymentAttemptId: resolvedAttempt.id,
        razorpayPaymentId: normalized.razorpayPaymentId,
        amountSubunits: normalized.amountSubunits,
        currency: normalized.currency,
      });
      payment =
        inserted ??
        (await getPaymentByRazorpayPaymentId(normalized.razorpayPaymentId));
      // The race-winning reread must be validated on the SAME full
      // identity, not merely re-checked for existence — Correction E.
      if (
        !payment ||
        !paymentIdentityAgrees(
          payment,
          resolvedAttempt.id,
          normalized.razorpayPaymentId,
          normalized.amountSubunits,
          normalized.currency,
        )
      ) {
        await recordFailedProcessingAttempt(
          webhookEventRow.id,
          resolvedAttempt.id,
          isDuplicateDelivery,
          "PAYMENT_EVIDENCE_CONFLICT",
          "Could not establish a consistent canonical payment record for this event.",
        );
        throw new WebhookEventCorrelationFailedError(
          "PAYMENT_EVIDENCE_CONFLICT",
          "Could not establish a consistent canonical payment record for this event.",
        );
      }
    }
  } else if (normalized.razorpayPaymentId) {
    // order.paid with a payment ID actually present in the safe evidence:
    // correlate to it ONLY if it already exists — order.paid must never
    // become payment-creation authority (this task's Section 5). Scoped
    // to attempt-id agreement only (unchanged) — order.paid does not
    // itself describe a single payment's money terms the way
    // payment.captured/payment.failed do, so the Correction E full
    // 4-field check is deliberately not extended here.
    const existingPayment = await getPaymentByRazorpayPaymentId(
      normalized.razorpayPaymentId,
    );
    if (existingPayment) {
      if (existingPayment.payment_attempt_id !== resolvedAttempt.id) {
        await recordFailedProcessingAttempt(
          webhookEventRow.id,
          resolvedAttempt.id,
          isDuplicateDelivery,
          "CORRELATION_PAYMENT_MISMATCH",
          "The Razorpay Order and Razorpay Payment correlate to different payment attempts.",
        );
        throw new WebhookEventCorrelationFailedError(
          "CORRELATION_PAYMENT_MISMATCH",
          "The Razorpay Order and Razorpay Payment correlate to different payment attempts.",
        );
      }
      payment = existingPayment;
    }
  }

  // Correction C: the derived-field update happens BEFORE the PENDING
  // attempt is created, and its failure is fatal — see the doc comment
  // above.
  try {
    await updateWebhookEventDerivedFields(webhookEventRow.id, {
      razorpayOrderId: normalized.razorpayOrderId,
      razorpayPaymentId: normalized.razorpayPaymentId,
      paymentAttemptId: resolvedAttempt.id,
      paymentId: payment?.id ?? null,
      amountSubunits: normalized.amountSubunits,
      currency: normalized.currency,
      razorpayPaymentStatus:
        normalized.kind === "order.paid"
          ? null
          : normalized.razorpayPaymentStatus,
    });
  } catch {
    await recordFailedProcessingAttempt(
      webhookEventRow.id,
      resolvedAttempt.id,
      isDuplicateDelivery,
      "NORMALIZATION_PERSISTENCE_FAILED",
      "Failed to persist the webhook event's derived correlation fields.",
    );
    throw new WebhookEventCorrelationFailedError(
      "NORMALIZATION_PERSISTENCE_FAILED",
      "Failed to persist the webhook event's derived correlation fields.",
    );
  }

  try {
    return await insertEventProcessingAttempt({
      webhookEventId: webhookEventRow.id,
      paymentAttemptId: resolvedAttempt.id,
      paymentId: payment?.id ?? null,
      isDuplicateDelivery,
      status: "PENDING",
      normalizedEvent: normalized as unknown as Record<string, unknown>,
      errorCode: null,
      errorMessageRedacted: null,
    });
  } catch {
    // The derived fields above are already durably persisted and safely
    // idempotent to repeat — a later duplicate delivery will find no
    // eligible durable attempt yet (this insert never happened) and will
    // simply retry, including re-running the (now redundant but harmless)
    // derived-field update before trying this insert again.
    await recordFailedProcessingAttempt(
      webhookEventRow.id,
      resolvedAttempt.id,
      isDuplicateDelivery,
      "NORMALIZATION_PERSISTENCE_FAILED",
      "Failed to persist the normalized processing attempt.",
    );
    throw new WebhookEventCorrelationFailedError(
      "NORMALIZATION_PERSISTENCE_FAILED",
      "Failed to persist the normalized processing attempt.",
    );
  }
}

/**
 * Ingests one incoming Razorpay webhook HTTP request. Throws one of the
 * typed errors above for every invalid/malformed/uncorrelatable case — this
 * task's "Failure Zero-Mutation Guarantee" for merchant/business state:
 * no path here ever mutates `orders`/`fulfilments`, or sets
 * `payment_attempts.status = 'CAPTURED'`,
 * `payments.razorpay_payment_status`/`captured_at`/`failed_at` — that
 * remains exclusively Phase 2F's responsibility.
 *
 * May also let `EnvValidationError` propagate uncaught from
 * `verifyWebhookSignature()` if `RAZORPAY_WEBHOOK_SECRET` itself is
 * missing/invalid — a server configuration problem, deliberately distinct
 * from `WebhookSignatureInvalidError` so the route handler
 * (`app/api/webhooks/razorpay/route.ts`) can return the correct 5xx vs 4xx
 * status class.
 */
export async function ingestRazorpayWebhook(
  input: IngestRazorpayWebhookInput,
): Promise<IngestRazorpayWebhookResult> {
  if (input.rawBody.length > MAX_WEBHOOK_BODY_BYTES) {
    throw new WebhookPayloadTooLargeError();
  }

  if (!input.signatureHeader) {
    logEvent("webhook_signature_missing", { signature_verified: false });
    throw new WebhookSignatureMissingError();
  }

  // Raw bytes verified BEFORE any parsing — never re-serialized JSON
  // (docs/RAZORPAY_GUIDE.md Section 17, docs/SECURITY.md Section 12).
  const verified = verifyWebhookSignature({
    rawBody: input.rawBody,
    signature: input.signatureHeader,
  });
  if (!verified) {
    logEvent("webhook_signature_invalid", { signature_verified: false });
    throw new WebhookSignatureInvalidError();
  }

  const eventId = input.eventIdHeader?.trim();
  if (!eventId) {
    logEvent("webhook_event_id_missing", { signature_verified: true });
    throw new WebhookEventIdMissingError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody.toString("utf8"));
  } catch {
    logEvent("webhook_payload_malformed", {
      signature_verified: true,
      razorpay_event_id: eventId,
      reason: "invalid_json",
    });
    throw new WebhookPayloadMalformedError(
      "Webhook payload is not valid JSON.",
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    logEvent("webhook_payload_malformed", {
      signature_verified: true,
      razorpay_event_id: eventId,
      reason: "not_an_object",
    });
    throw new WebhookPayloadMalformedError(
      "Webhook payload must be a JSON object.",
    );
  }

  const rawEventType = (parsed as Record<string, unknown>).event;
  const eventType = typeof rawEventType === "string" ? rawEventType.trim() : "";
  if (!eventType) {
    logEvent("webhook_payload_malformed", {
      signature_verified: true,
      razorpay_event_id: eventId,
      reason: "missing_event_field",
    });
    throw new WebhookPayloadMalformedError(
      'Webhook payload is missing a non-empty "event" field.',
    );
  }

  // Hashes the SAME raw bytes already used for HMAC verification — never
  // the redacted evidence and never a re-serialized JSON.stringify(parsed).
  const rawBodySha256 = createHash("sha256")
    .update(input.rawBody)
    .digest("hex");
  const providerCreatedAt = extractProviderCreatedAt(parsed);
  const rawPayloadRedacted = buildRedactedWebhookEvidence(parsed);

  const insertedRow = await insertWebhookEvent({
    razorpayEventId: eventId,
    eventType,
    providerCreatedAt,
    rawBodySha256,
    rawPayloadRedacted,
  });

  let webhookEventRow: WebhookEventRow;
  let isDuplicateDelivery: boolean;

  if (insertedRow) {
    webhookEventRow = insertedRow;
    isDuplicateDelivery = false;
    logEvent("webhook_event_received", {
      razorpay_event_id: webhookEventRow.razorpay_event_id,
      event_type: webhookEventRow.event_type,
      signature_verified: true,
    });
  } else {
    // Database `UNIQUE(razorpay_event_id)` conflict (Postgres 23505) — a
    // genuine Razorpay at-least-once redelivery of an event this table
    // already holds (docs/ARCHITECTURE.md ADR-A08). The atomic RPC
    // increment is the correctness mechanism, not a
    // SELECT-then-increment-in-JS pattern (this task's Section 12).
    webhookEventRow = await incrementWebhookDuplicateDeliveryCount(eventId);
    isDuplicateDelivery = true;
    logEvent("webhook_event_duplicate_delivery", {
      razorpay_event_id: webhookEventRow.razorpay_event_id,
      event_type: webhookEventRow.event_type,
      duplicate_delivery_count: webhookEventRow.duplicate_delivery_count,
    });

    // Safe hardening (optional, non-rejecting): a genuine Razorpay
    // redelivery of the same event should carry an identical body. If it
    // doesn't, that's worth a structured log line for visibility — never
    // a rejection (no policy for this is documented), never storing the
    // new body, and never overwriting the canonical evidence (Correction
    // D below already guarantees the canonical row is what's used, not
    // this delivery's body).
    if (
      rawBodySha256 !== webhookEventRow.raw_body_sha256 ||
      eventType !== webhookEventRow.event_type
    ) {
      logEvent("webhook_duplicate_evidence_mismatch", {
        razorpay_event_id: webhookEventRow.razorpay_event_id,
        body_matches: rawBodySha256 === webhookEventRow.raw_body_sha256,
        event_type_matches: eventType === webhookEventRow.event_type,
      });
    }

    const durableAttempt = await getDurableNormalizedAttemptForWebhookEvent(
      webhookEventRow.id,
    );
    if (durableAttempt) {
      // A durable normalized-or-later attempt already exists (Correction
      // B: PENDING/HELD/PROCESSING/SUCCEEDED all qualify — not merely
      // "the latest row happens to be PENDING") — do NOT re-normalize.
      //
      // Phase 2F (this task's Section 23): a duplicate must never receive
      // 2xx merely because merchant processing is still uncompleted.
      //
      //   - SUCCEEDED: merchant processing already durably completed —
      //     record SKIPPED_DUPLICATE directly, with NO processor
      //     reapplication (an extra RPC round trip would be redundant, not
      //     merely idempotent).
      //   - PENDING/PROCESSING/HELD: the merchant-processing transaction is
      //     invoked against this SAME existing attempt FIRST. For
      //     PENDING/PROCESSING this actually performs (or safely
      //     re-confirms) merchant processing; for HELD (not normally
      //     produced in Phase 2) it fails safely rather than falsely
      //     acknowledging success — this task's Section 23 "do not falsely
      //     acknowledge successful merchant processing". ONLY once that
      //     resolves successfully is the SKIPPED_DUPLICATE evidence row
      //     recorded and 2xx returned. A processing failure here propagates
      //     (5xx, caller/Razorpay may redeliver) and creates NO
      //     SKIPPED_DUPLICATE row.
      if (durableAttempt.status !== "SUCCEEDED") {
        await runMerchantProcessingOrFail(durableAttempt);
      }

      await insertEventProcessingAttempt({
        webhookEventId: webhookEventRow.id,
        paymentAttemptId: durableAttempt.payment_attempt_id,
        paymentId: durableAttempt.payment_id,
        isDuplicateDelivery: true,
        status: "SKIPPED_DUPLICATE",
        normalizedEvent: durableAttempt.normalized_event,
        errorCode: null,
        errorMessageRedacted: null,
      });
      return {
        outcome: "duplicate_received",
        webhookEventId: webhookEventRow.id,
        eventType: webhookEventRow.event_type,
      };
    }
    // No durable eligible attempt yet (none at all, or every attempt so
    // far is FAILED) — retry normalization below exactly like a fresh
    // event (this task's Section 14).
  }

  // Correction D: normalize from the CANONICAL persisted row, never from
  // this specific delivery's locally-parsed variables — unified for both
  // the fresh-insert path (where they are identical by construction) and
  // the duplicate-retry path (where they must NOT be, since a later
  // delivery must never be able to redefine an already-canonical logical
  // event). `webhookEventRow` is either the just-inserted fresh row or the
  // canonical row returned by the atomic increment RPC.
  const normalization = normalizeRazorpayEvent({
    razorpayEventId: webhookEventRow.razorpay_event_id,
    eventType: webhookEventRow.event_type,
    providerCreatedAt: webhookEventRow.provider_created_at,
    safeEvidence: webhookEventRow.raw_payload_redacted,
  });

  if (normalization.outcome === "unsupported") {
    // Validly signed, but outside the frozen P0 subscription catalogue —
    // preserve the canonical evidence, fabricate nothing, still 2xx (this
    // task's Section 19).
    logEvent("webhook_event_unsupported", {
      razorpay_event_id: webhookEventRow.razorpay_event_id,
      event_type: webhookEventRow.event_type,
      unsupported_event: true,
    });
    return {
      outcome: "unsupported_event_accepted",
      webhookEventId: webhookEventRow.id,
      eventType: webhookEventRow.event_type,
    };
  }

  if (normalization.outcome === "invalid") {
    await recordFailedProcessingAttempt(
      webhookEventRow.id,
      null,
      isDuplicateDelivery,
      "NORMALIZATION_INVALID_PAYLOAD",
      normalization.reason,
    );
    logEvent("webhook_event_normalization_invalid", {
      razorpay_event_id: webhookEventRow.razorpay_event_id,
      event_type: webhookEventRow.event_type,
    });
    throw new WebhookEventNormalizationInvalidError(normalization.reason);
  }

  const pendingAttempt = await correlateNormalizeAndPersist(
    webhookEventRow,
    normalization.event,
    isDuplicateDelivery,
  );

  // Phase 2F (this task's Section 22): extend the normal supported-event
  // path all the way through merchant processing — normalization/
  // correlation reaching a durable PENDING attempt is NOT itself
  // sufficient for a 2xx acknowledgement. `runMerchantProcessingOrFail`
  // throws (safe 5xx, Razorpay/the caller redelivers) if this fails; it
  // never returns a "processed" outcome without the merchant-processing
  // transaction having actually succeeded (or already having idempotently
  // succeeded).
  await runMerchantProcessingOrFail(pendingAttempt);

  logEvent("webhook_event_processed", {
    razorpay_event_id: webhookEventRow.razorpay_event_id,
    event_type: webhookEventRow.event_type,
    is_duplicate_delivery: isDuplicateDelivery,
  });

  return {
    outcome: "processed",
    webhookEventId: webhookEventRow.id,
    eventType: webhookEventRow.event_type,
  };
}
