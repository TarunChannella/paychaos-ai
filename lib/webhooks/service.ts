/**
 * Phase 2D — Razorpay webhook ingestion orchestration.
 *
 * `import "server-only"` for the same structural reason as
 * `lib/demo-merchant/service.ts`: this module performs I/O (through the
 * repository) and reads the server-only webhook secret transitively, and
 * must never be reachable from a client bundle.
 *
 * Frozen P0 flow (docs/ARCHITECTURE.md Section 10, this task's Section 3
 * "TEST-MODE BUILDATHON P0 SIMPLIFICATION" — a deliberate small
 * synchronous design, not a general production-scale recommendation):
 *
 *   exact raw bytes
 *     -> bounded size check
 *     -> require X-Razorpay-Signature
 *     -> HMAC-SHA256 verify (RAW BYTES, never re-serialized JSON)
 *     -> ONLY IF VERIFIED: require x-razorpay-event-id
 *     -> parse JSON
 *     -> validate minimum envelope (object; non-empty "event" string)
 *     -> hash the SAME raw bytes already verified
 *     -> build allowlisted redacted evidence
 *     -> persist one canonical webhook_events row
 *
 * STOPS THERE — Phase 2D does not normalize events (Phase 2E), does not
 * update orders/payment_attempts/payments/fulfilments (Phase 2F), and does
 * not implement any duplicate-delivery workflow. A `UNIQUE(razorpay_event_id)`
 * constraint hit is NOT interpreted specially — it flows through the same
 * generic repository-failure path as any other insert error. Recognizing a
 * duplicate delivery and responding to it safely (`duplicate_delivery_count`,
 * normalized duplicate handling) is Phase 2E scope (2026-08-26 architect
 * review correction — see handoffs/PHASE-2-HANDOFF.md). No real Razorpay
 * webhook is registered until that protection exists, so a temporary 5xx on
 * a duplicate conflict is never exercised against the real provider.
 */
import "server-only";

import { createHash } from "node:crypto";

import { verifyWebhookSignature } from "@/lib/razorpay/webhook-verification";
import { logEvent } from "@/lib/security/logger";

import {
  buildRedactedWebhookEvidence,
  extractProviderCreatedAt,
} from "./redaction";
import { insertWebhookEvent } from "./repository";

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

export interface IngestRazorpayWebhookInput {
  /** The EXACT raw bytes of the incoming request body. */
  readonly rawBody: Buffer;
  readonly signatureHeader: string | null;
  readonly eventIdHeader: string | null;
}

export interface IngestRazorpayWebhookResult {
  /** The `webhook_events.id` of the fresh row that was durably inserted. */
  readonly id: string;
  readonly eventType: string;
}

/**
 * Ingests one incoming Razorpay webhook HTTP request. Throws one of the
 * typed errors above for every invalid/malformed case BEFORE any database
 * write — this task's "Failure Zero-Mutation Guarantee": every rejection
 * path here results in exactly zero `webhook_events` rows and (since this
 * module never touches any other table) zero order/payment/business
 * mutation of any kind.
 *
 * May also let `EnvValidationError` propagate uncaught from
 * `verifyWebhookSignature()` if `RAZORPAY_WEBHOOK_SECRET` itself is
 * missing/invalid — a server configuration problem, deliberately distinct
 * from `WebhookSignatureInvalidError` so the route handler
 * (`app/api/webhooks/razorpay/route.ts`) can return the correct 5xx vs 4xx
 * status class. Both equally guarantee zero trusted insertion.
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

  // `Headers.get(...)` always returns either a string or `null` — never
  // whitespace-only by construction from a well-behaved HTTP client, but a
  // whitespace-only value is still rejected the same as a missing header
  // (envelope validation, not Phase 2E semantic event-ID validation).
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
  // the redacted evidence and never a re-serialized JSON.stringify(parsed)
  // (this task's Section 12).
  const rawBodySha256 = createHash("sha256")
    .update(input.rawBody)
    .digest("hex");
  const providerCreatedAt = extractProviderCreatedAt(parsed);
  const rawPayloadRedacted = buildRedactedWebhookEvidence(parsed);

  // A successful Phase 2D ingest means exactly one fresh canonical
  // verified row was durably inserted. A `UNIQUE(razorpay_event_id)`
  // conflict (or any other insert failure) propagates as a generic
  // `WebhookRepositoryError` here, uninterpreted — see the module header.
  const row = await insertWebhookEvent({
    razorpayEventId: eventId,
    eventType,
    providerCreatedAt,
    rawBodySha256,
    rawPayloadRedacted,
  });

  logEvent("webhook_event_received", {
    razorpay_event_id: row.razorpay_event_id,
    event_type: row.event_type,
    signature_verified: true,
  });

  return { id: row.id, eventType: row.event_type };
}
