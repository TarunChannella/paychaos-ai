/**
 * Phase 2D/2E — public Razorpay Test Mode webhook endpoint.
 *
 * `POST /api/webhooks/razorpay` (docs/RAZORPAY_GUIDE.md Section 14). This
 * route's trust boundary is the Razorpay webhook HMAC signature, NOT an
 * operator session — no login/CSRF check applies here, matching
 * docs/SECURITY.md Section 28 "Webhook Exception" and ARCHITECTURE.md
 * ADR-A16's explicit carve-out for this exact endpoint. This does not
 * weaken authentication: an unsigned or wrongly-signed request is rejected
 * before any trusted processing regardless.
 *
 * Runs in the Node.js runtime (`node:crypto`'s `createHmac`/
 * `timingSafeEqual`, used transitively by
 * `lib/razorpay/webhook-verification.ts`, are not available in the Edge
 * runtime).
 *
 * All actual verification/parsing/persistence logic lives in
 * `lib/webhooks/service.ts` — this route only reads the raw request,
 * extracts headers, calls the service, and maps its typed outcomes to the
 * correct HTTP status (docs/ARCHITECTURE.md Section 36 "Important Module
 * Rule": route handlers delegate to domain services).
 */
import { createHash } from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { EnvValidationError } from "@/lib/config/env-validation";
import { logEvent } from "@/lib/security/logger";
import {
  ingestRazorpayWebhook,
  WebhookEventCorrelationFailedError,
  WebhookEventIdMissingError,
  WebhookEventNormalizationInvalidError,
  WebhookPayloadMalformedError,
  WebhookPayloadTooLargeError,
  WebhookSignatureInvalidError,
  WebhookSignatureMissingError,
} from "@/lib/webhooks/service";

export const runtime = "nodejs";

const SAFE_ERROR_BODY = {
  error: "Webhook request could not be processed.",
} as const;

function safeErrorResponse(status: number): NextResponse {
  return NextResponse.json(SAFE_ERROR_BODY, { status });
}

/**
 * Never used for the actual verification (that happens inside
 * `ingestRazorpayWebhook`, against the exact raw bytes) — only to compute
 * a safe correlation identifier for the completion log line when no event
 * ID was available (e.g. an invalid-signature request), without ever
 * logging the raw body itself.
 */
function safeBodyFingerprint(rawBody: Buffer): string {
  return createHash("sha256").update(rawBody).digest("hex").slice(0, 16);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();

  const arrayBuffer = await request.arrayBuffer();
  const rawBody = Buffer.from(arrayBuffer);

  // Headers.get(...) is case-insensitive per the Fetch/Web standard.
  const signatureHeader = request.headers.get("x-razorpay-signature");
  const eventIdHeader = request.headers.get("x-razorpay-event-id");

  try {
    // Phase 2E: a `UNIQUE(razorpay_event_id)` conflict is now recognized
    // (`outcome: "duplicate_received"`) rather than flowing through the
    // generic error path — application-level duplicate recognition is
    // this phase's job (docs/PHASE_PLAN.md "Phase 2E").
    const result = await ingestRazorpayWebhook({
      rawBody,
      signatureHeader,
      eventIdHeader,
    });

    logEvent("webhook_request_completed", {
      http_status: 200,
      latency_ms: Date.now() - startedAt,
      // Guaranteed non-null here: ingestion only succeeds once the event
      // ID header has already been validated as present.
      razorpay_event_id: eventIdHeader,
      outcome: result.outcome,
    });

    return NextResponse.json(
      {
        status:
          result.outcome === "duplicate_received"
            ? "duplicate_received"
            : "received",
      },
      { status: 200 },
    );
  } catch (err) {
    const latencyMs = Date.now() - startedAt;

    if (err instanceof WebhookPayloadTooLargeError) {
      logEvent("webhook_request_completed", {
        http_status: 413,
        latency_ms: latencyMs,
        error_name: err.name,
      });
      return safeErrorResponse(413);
    }

    if (
      err instanceof WebhookSignatureMissingError ||
      err instanceof WebhookSignatureInvalidError ||
      err instanceof WebhookEventIdMissingError ||
      err instanceof WebhookPayloadMalformedError ||
      err instanceof WebhookEventNormalizationInvalidError
    ) {
      logEvent("webhook_request_completed", {
        http_status: 400,
        latency_ms: latencyMs,
        error_name: err.name,
        body_fingerprint: safeBodyFingerprint(rawBody),
      });
      return safeErrorResponse(400);
    }

    if (err instanceof WebhookEventCorrelationFailedError) {
      // Normalization/correlation/persistence failure — always safe to
      // retry (this task's Section 18/30); Razorpay redelivers later.
      // Never expose `err.code` or `err.message` in the response.
      logEvent("webhook_request_completed", {
        http_status: 500,
        latency_ms: latencyMs,
        error_name: err.name,
        correlation_failure_code: err.code,
      });
      return safeErrorResponse(500);
    }

    if (err instanceof EnvValidationError) {
      // Server misconfiguration (e.g. RAZORPAY_WEBHOOK_SECRET missing/
      // invalid) — distinct from an ordinary invalid signature, but
      // equally guarantees zero trusted insertion. Never include the
      // variable name or any value in the response.
      logEvent("webhook_request_completed", {
        http_status: 500,
        latency_ms: latencyMs,
        error_name: "EnvValidationError",
      });
      return safeErrorResponse(500);
    }

    logEvent("webhook_request_completed", {
      http_status: 500,
      latency_ms: latencyMs,
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    return safeErrorResponse(500);
  }
}
