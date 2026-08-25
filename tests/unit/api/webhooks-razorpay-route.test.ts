import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 2D: `app/api/webhooks/razorpay/route.ts` exercised here against a
// FULLY MOCKED `lib/webhooks/service.ts` — no real signature verification,
// no real Supabase, no real Razorpay. `ingestRazorpayWebhook`'s own
// orchestration logic is separately proven by tests/unit/webhooks/service.test.ts,
// and the HMAC math itself by tests/unit/razorpay/webhook-verification.test.ts.
// This file proves only the route's OWN job: read raw bytes, extract
// headers, delegate, and map typed outcomes to the correct HTTP status
// without ever leaking anything in the response.

class FakeWebhookPayloadTooLargeError extends Error {
  constructor() {
    super("too large");
    this.name = "WebhookPayloadTooLargeError";
  }
}
class FakeWebhookSignatureMissingError extends Error {
  constructor() {
    super("missing signature");
    this.name = "WebhookSignatureMissingError";
  }
}
class FakeWebhookSignatureInvalidError extends Error {
  constructor() {
    super("invalid signature");
    this.name = "WebhookSignatureInvalidError";
  }
}
class FakeWebhookEventIdMissingError extends Error {
  constructor() {
    super("missing event id");
    this.name = "WebhookEventIdMissingError";
  }
}
class FakeWebhookPayloadMalformedError extends Error {
  constructor() {
    super("malformed payload");
    this.name = "WebhookPayloadMalformedError";
  }
}
class FakeWebhookEventNormalizationInvalidError extends Error {
  constructor() {
    super("normalization invalid");
    this.name = "WebhookEventNormalizationInvalidError";
  }
}
class FakeWebhookEventCorrelationFailedError extends Error {
  readonly code: string;
  constructor(code = "CORRELATION_ORDER_NOT_FOUND") {
    super(`correlation failed: ${code}`);
    this.name = "WebhookEventCorrelationFailedError";
    this.code = code;
  }
}
class FakeWebhookMerchantProcessingFailedError extends Error {
  readonly code: string;
  constructor(code = "PROCESSING_TRANSACTION_FAILED") {
    super(`merchant processing failed: ${code}`);
    this.name = "WebhookMerchantProcessingFailedError";
    this.code = code;
  }
}
class FakeEnvValidationError extends Error {
  readonly variable: string;
  constructor(variable: string) {
    super(
      `${variable} is invalid — a super secret leaky detail: sk_live_totally_real_secret`,
    );
    this.name = "EnvValidationError";
    this.variable = variable;
  }
}

const ingestRazorpayWebhookMock = vi.fn();

vi.mock("@/lib/webhooks/service", () => ({
  ingestRazorpayWebhook: ingestRazorpayWebhookMock,
  WebhookPayloadTooLargeError: FakeWebhookPayloadTooLargeError,
  WebhookSignatureMissingError: FakeWebhookSignatureMissingError,
  WebhookSignatureInvalidError: FakeWebhookSignatureInvalidError,
  WebhookEventIdMissingError: FakeWebhookEventIdMissingError,
  WebhookPayloadMalformedError: FakeWebhookPayloadMalformedError,
  WebhookEventNormalizationInvalidError:
    FakeWebhookEventNormalizationInvalidError,
  WebhookEventCorrelationFailedError: FakeWebhookEventCorrelationFailedError,
  WebhookMerchantProcessingFailedError:
    FakeWebhookMerchantProcessingFailedError,
}));

vi.mock("@/lib/config/env-validation", () => ({
  EnvValidationError: FakeEnvValidationError,
}));

const logEventMock = vi.fn();
vi.mock("@/lib/security/logger", () => ({
  logEvent: logEventMock,
}));

const VALID_EVENT_ID = "evt_fake_id_123";
const VALID_SIGNATURE = "a".repeat(64);
const WEBHOOK_URL = "http://localhost/api/webhooks/razorpay";

async function callRoute(options: {
  body: string | Buffer;
  signature?: string | null;
  eventId?: string | null;
}) {
  const { POST } = await import("@/app/api/webhooks/razorpay/route");
  const { NextRequest } = await import("next/server");

  const headers = new Headers();
  if (options.signature !== null) {
    headers.set("x-razorpay-signature", options.signature ?? VALID_SIGNATURE);
  }
  if (options.eventId !== null) {
    headers.set("x-razorpay-event-id", options.eventId ?? VALID_EVENT_ID);
  }

  const request = new NextRequest(WEBHOOK_URL, {
    method: "POST",
    headers,
    // Buffer is a valid runtime body for Node's fetch Request (used
    // transitively by NextRequest) even though the DOM BodyInit type
    // doesn't list it.
    body: options.body as BodyInit,
  });

  return POST(request);
}

beforeEach(() => {
  ingestRazorpayWebhookMock.mockReset();
  logEventMock.mockReset();
});

describe("POST /api/webhooks/razorpay", () => {
  // This test pays the cold dynamic-import cost of loading the route
  // module + next/server for the first time (subsequent tests hit the warm
  // module cache and run in milliseconds) — same cold-module-resolution
  // pattern documented for Playwright navigation elsewhere in this
  // project, not a logic issue. Timeout extended accordingly.
  it("on success: delegates to ingestRazorpayWebhook exactly once with the exact raw bytes and both headers", async () => {
    ingestRazorpayWebhookMock.mockResolvedValue({
      outcome: "processed",
      webhookEventId: "row-1",
      eventType: "payment.captured",
    });

    const body = JSON.stringify({ event: "payment.captured" });
    await callRoute({
      body,
      signature: VALID_SIGNATURE,
      eventId: VALID_EVENT_ID,
    });

    expect(ingestRazorpayWebhookMock).toHaveBeenCalledTimes(1);
    const call = ingestRazorpayWebhookMock.mock.calls[0]?.[0];
    expect(call.signatureHeader).toBe(VALID_SIGNATURE);
    expect(call.eventIdHeader).toBe(VALID_EVENT_ID);
    expect(Buffer.isBuffer(call.rawBody)).toBe(true);
    expect(call.rawBody.equals(Buffer.from(body, "utf8"))).toBe(true);
  }, 20_000);

  it("returns 200 {status:'received'} for a fresh event", async () => {
    ingestRazorpayWebhookMock.mockResolvedValue({
      outcome: "processed",
      webhookEventId: "row-1",
      eventType: "payment.captured",
    });

    const response = await callRoute({ body: "{}" });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ status: "received" });
  });

  it("Phase 2E: a database unique-constraint conflict at the repository layer (generic failure, never surfaced to the route) still maps to a generic safe 500 if it somehow propagates uninterpreted", async () => {
    class FakeWebhookRepositoryError extends Error {
      readonly code = "WEBHOOK_EVENT_INSERT_FAILED";
      constructor() {
        super("Failed to persist the webhook event.");
        this.name = "WebhookRepositoryError";
      }
    }
    ingestRazorpayWebhookMock.mockRejectedValue(
      new FakeWebhookRepositoryError(),
    );

    const response = await callRoute({ body: "{}" });
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json).toEqual({ error: "Webhook request could not be processed." });
    expect(json).not.toHaveProperty("status");
  });

  it("Phase 2E: returns 200 {status:'duplicate_received'} for a recognized duplicate delivery — a genuine success outcome, not an error", async () => {
    ingestRazorpayWebhookMock.mockResolvedValue({
      outcome: "duplicate_received",
      webhookEventId: "row-1",
      eventType: "payment.captured",
    });

    const response = await callRoute({ body: "{}" });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ status: "duplicate_received" });
  });

  it("returns 200 {status:'received'} for an unsupported-but-authenticated event — never a distinct status leaking which events are supported", async () => {
    ingestRazorpayWebhookMock.mockResolvedValue({
      outcome: "unsupported_event_accepted",
      webhookEventId: "row-1",
      eventType: "refund.processed",
    });

    const response = await callRoute({ body: "{}" });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ status: "received" });
  });

  it("maps WebhookEventNormalizationInvalidError to 400 with the generic safe body", async () => {
    ingestRazorpayWebhookMock.mockRejectedValue(
      new FakeWebhookEventNormalizationInvalidError(),
    );
    const response = await callRoute({ body: "{}" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Webhook request could not be processed.",
    });
  });

  it("maps WebhookEventCorrelationFailedError to 500 with the generic safe body — never leaking err.code or err.message", async () => {
    ingestRazorpayWebhookMock.mockRejectedValue(
      new FakeWebhookEventCorrelationFailedError(
        "CORRELATION_PAYMENT_MISMATCH",
      ),
    );
    const response = await callRoute({ body: "{}" });
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json).toEqual({ error: "Webhook request could not be processed." });
    expect(JSON.stringify(json)).not.toContain("CORRELATION_PAYMENT_MISMATCH");
  });

  it("Phase 2F: maps WebhookMerchantProcessingFailedError to 500 with the generic safe body — never leaking err.code or err.message", async () => {
    ingestRazorpayWebhookMock.mockRejectedValue(
      new FakeWebhookMerchantProcessingFailedError(
        "PROCESSING_AMOUNT_MISMATCH",
      ),
    );
    const response = await callRoute({ body: "{}" });
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json).toEqual({ error: "Webhook request could not be processed." });
    expect(JSON.stringify(json)).not.toContain("PROCESSING_AMOUNT_MISMATCH");
  });

  it("does NOT re-serialize the body — an arbitrary/malformed body's exact bytes still reach the service unchanged", async () => {
    ingestRazorpayWebhookMock.mockRejectedValue(
      new FakeWebhookPayloadMalformedError(),
    );

    const weirdBody = "not-json-at-all{{{ünïcödé byte";
    await callRoute({ body: weirdBody });

    const call = ingestRazorpayWebhookMock.mock.calls[0]?.[0];
    expect(call.rawBody.equals(Buffer.from(weirdBody, "utf8"))).toBe(true);
  });

  it("passes null for a missing signature header rather than an empty string or undefined-crash", async () => {
    ingestRazorpayWebhookMock.mockRejectedValue(
      new FakeWebhookSignatureMissingError(),
    );

    await callRoute({ body: "{}", signature: null });

    const call = ingestRazorpayWebhookMock.mock.calls[0]?.[0];
    expect(call.signatureHeader).toBeNull();
  });

  it("passes null for a missing event-id header", async () => {
    ingestRazorpayWebhookMock.mockRejectedValue(
      new FakeWebhookEventIdMissingError(),
    );

    await callRoute({ body: "{}", eventId: null });

    const call = ingestRazorpayWebhookMock.mock.calls[0]?.[0];
    expect(call.eventIdHeader).toBeNull();
  });

  it("maps WebhookPayloadTooLargeError to 413 with the generic safe body", async () => {
    ingestRazorpayWebhookMock.mockRejectedValue(
      new FakeWebhookPayloadTooLargeError(),
    );

    const response = await callRoute({ body: "{}" });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: "Webhook request could not be processed.",
    });
  });

  it("maps WebhookSignatureMissingError to 400 with the generic safe body", async () => {
    ingestRazorpayWebhookMock.mockRejectedValue(
      new FakeWebhookSignatureMissingError(),
    );
    const response = await callRoute({ body: "{}" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Webhook request could not be processed.",
    });
  });

  it("maps WebhookSignatureInvalidError to 400", async () => {
    ingestRazorpayWebhookMock.mockRejectedValue(
      new FakeWebhookSignatureInvalidError(),
    );
    const response = await callRoute({ body: "{}" });
    expect(response.status).toBe(400);
  });

  it("maps WebhookEventIdMissingError to 400", async () => {
    ingestRazorpayWebhookMock.mockRejectedValue(
      new FakeWebhookEventIdMissingError(),
    );
    const response = await callRoute({ body: "{}" });
    expect(response.status).toBe(400);
  });

  it("maps WebhookPayloadMalformedError to 400", async () => {
    ingestRazorpayWebhookMock.mockRejectedValue(
      new FakeWebhookPayloadMalformedError(),
    );
    const response = await callRoute({ body: "not json" });
    expect(response.status).toBe(400);
  });

  it("maps EnvValidationError (server misconfiguration) to 500 with the generic safe body — never leaking the underlying message", async () => {
    ingestRazorpayWebhookMock.mockRejectedValue(
      new FakeEnvValidationError("RAZORPAY_WEBHOOK_SECRET"),
    );
    const response = await callRoute({ body: "{}" });
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json).toEqual({ error: "Webhook request could not be processed." });
    expect(JSON.stringify(json)).not.toContain("sk_live_totally_real_secret");
    expect(JSON.stringify(json)).not.toContain("RAZORPAY_WEBHOOK_SECRET");
  });

  it("maps any other unexpected error to a generic 500 with the generic safe body", async () => {
    ingestRazorpayWebhookMock.mockRejectedValue(
      new Error("some internal detail: connection string leaked"),
    );
    const response = await callRoute({ body: "{}" });
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json).toEqual({ error: "Webhook request could not be processed." });
    expect(JSON.stringify(json)).not.toContain("connection string");
  });

  it("no error response body ever contains the request's signature header value", async () => {
    ingestRazorpayWebhookMock.mockRejectedValue(
      new FakeWebhookSignatureInvalidError(),
    );
    const response = await callRoute({
      body: "{}",
      signature: VALID_SIGNATURE,
    });
    const text = await response.text();
    expect(text).not.toContain(VALID_SIGNATURE);
  });

  it("no error response body ever contains any part of the raw request body", async () => {
    ingestRazorpayWebhookMock.mockRejectedValue(
      new FakeWebhookPayloadMalformedError(),
    );
    const secretLookingBody = JSON.stringify({
      event: "payment.captured",
      marker: "unique-body-marker-xyz-789",
    });
    const response = await callRoute({ body: secretLookingBody });
    const text = await response.text();
    expect(text).not.toContain("unique-body-marker-xyz-789");
  });

  it("logs http_status matching the returned response status on both success and failure paths", async () => {
    ingestRazorpayWebhookMock.mockResolvedValueOnce({
      outcome: "processed",
      webhookEventId: "row-1",
      eventType: "payment.captured",
    });
    await callRoute({ body: "{}" });
    expect(logEventMock).toHaveBeenCalledWith(
      "webhook_request_completed",
      expect.objectContaining({ http_status: 200 }),
    );

    logEventMock.mockClear();
    ingestRazorpayWebhookMock.mockRejectedValueOnce(
      new FakeWebhookSignatureInvalidError(),
    );
    await callRoute({ body: "{}" });
    expect(logEventMock).toHaveBeenCalledWith(
      "webhook_request_completed",
      expect.objectContaining({ http_status: 400 }),
    );
  });

  it("on success, logs the exact eventIdHeader as razorpay_event_id (never a value derived from the unverified body)", async () => {
    ingestRazorpayWebhookMock.mockResolvedValue({
      outcome: "processed",
      webhookEventId: "row-1",
      eventType: "payment.captured",
    });

    await callRoute({ body: "{}", eventId: VALID_EVENT_ID });

    expect(logEventMock).toHaveBeenCalledWith(
      "webhook_request_completed",
      expect.objectContaining({
        razorpay_event_id: VALID_EVENT_ID,
      }),
    );
  });

  it("no log call for any request ever contains the raw signature header value", async () => {
    ingestRazorpayWebhookMock.mockRejectedValue(
      new FakeWebhookSignatureInvalidError(),
    );
    await callRoute({ body: "{}", signature: VALID_SIGNATURE });

    for (const call of logEventMock.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(VALID_SIGNATURE);
    }
  });
});

describe("app/api/webhooks/razorpay/route.ts — structural checks", () => {
  const source = fs.readFileSync(
    path.resolve(
      import.meta.dirname,
      "../../../app/api/webhooks/razorpay/route.ts",
    ),
    "utf-8",
  );

  it("runs in the Node.js runtime (node:crypto is unavailable on Edge)", () => {
    expect(source).toMatch(/export const runtime\s*=\s*["']nodejs["']/);
  });

  it("delegates business logic only to lib/webhooks/service — never imports Supabase or Razorpay clients directly", () => {
    expect(source).toMatch(/from ["']@\/lib\/webhooks\/service["']/);
    expect(source).not.toMatch(/@\/lib\/supabase/);
    expect(source).not.toMatch(/@\/lib\/razorpay\/(?!webhook-verification)/);
    expect(source).not.toMatch(/@\/lib\/demo-merchant/);
  });

  it("reads the request body via arrayBuffer(), never request.json() (which would prevent verifying exact raw bytes)", () => {
    expect(source).toMatch(/request\.arrayBuffer\(\)/);
    expect(source).not.toMatch(/request\.json\(\)/);
  });

  it("architect review correction (2026-08-26): the route never returns an already_recorded status — that outcome does not exist at this phase", () => {
    expect(source).not.toContain("already_recorded");
    expect(source).not.toContain("alreadyRecorded");
  });
});

/**
 * Phase 2G readiness — architect timing-evidence correction
 * (docs/RAZORPAY_GUIDE.md's "an automated timing/budget test must prove the
 * normal handler contains no intentional long sleep or unbounded work").
 *
 * This does NOT (and cannot) prove the real webhook completes in
 * <5000 ms — that remains Phase 2G's deployed, real-provider manual
 * verification gate. What it proves, with stable structural assertions
 * against the actual source of the whole synchronous critical-path chain
 * (never a mocked/faked wall-clock number), is that nothing in that chain
 * is STRUCTURALLY capable of introducing an unbounded or artificially
 * delayed response:
 *
 *   - `latency_ms` timing starts before the raw body is read, and the
 *     success-path measurement is taken only after the full chain
 *     (signature verification -> persistence/dedup -> normalization/
 *     correlation -> merchant processing) has already resolved;
 *   - no deliberate timer/sleep primitive (`setTimeout`, `setInterval`,
 *     `Atomics.wait`, `node:timers/promises`, or an ad hoc `sleep`/`delay`
 *     helper) appears anywhere in that chain;
 *   - no unbounded `while (true)`/`for (;;)` loop appears anywhere in that
 *     chain;
 *   - no AI/ML/diagnosis/reconciliation/analytics/report-generation module
 *     is imported anywhere in that chain (Phase 4's diagnosis/Reliability
 *     Score engine does not exist yet, and this webhook path must never
 *     depend on it even once it does).
 */
describe("webhook critical path — timing / bounded-work contract (Phase 2G readiness)", () => {
  const routeSource = fs.readFileSync(
    path.resolve(
      import.meta.dirname,
      "../../../app/api/webhooks/razorpay/route.ts",
    ),
    "utf-8",
  );
  const serviceSource = fs.readFileSync(
    path.resolve(import.meta.dirname, "../../../lib/webhooks/service.ts"),
    "utf-8",
  );
  const processorSource = fs.readFileSync(
    path.resolve(import.meta.dirname, "../../../lib/events/processor.ts"),
    "utf-8",
  );
  const eventProcessingRepoSource = fs.readFileSync(
    path.resolve(
      import.meta.dirname,
      "../../../lib/webhooks/event-processing-repository.ts",
    ),
    "utf-8",
  );
  const webhookRepoSource = fs.readFileSync(
    path.resolve(import.meta.dirname, "../../../lib/webhooks/repository.ts"),
    "utf-8",
  );

  const CRITICAL_PATH_SOURCES: Record<string, string> = {
    "app/api/webhooks/razorpay/route.ts": routeSource,
    "lib/webhooks/service.ts": serviceSource,
    "lib/events/processor.ts": processorSource,
    "lib/webhooks/event-processing-repository.ts": eventProcessingRepoSource,
    "lib/webhooks/repository.ts": webhookRepoSource,
  };

  it("A: latency timing (startedAt) is captured strictly before the raw body is read", () => {
    const startedAtIndex = routeSource.indexOf("const startedAt = Date.now()");
    const rawBodyReadIndex = routeSource.indexOf("request.arrayBuffer()");
    expect(startedAtIndex).toBeGreaterThan(-1);
    expect(rawBodyReadIndex).toBeGreaterThan(-1);
    expect(startedAtIndex).toBeLessThan(rawBodyReadIndex);
  });

  it("B: the success-path latency_ms measurement is computed only AFTER ingestRazorpayWebhook (the full verify -> persist/dedup -> normalize/correlate -> merchant-process chain) has resolved", () => {
    const ingestCallIndex = routeSource.indexOf(
      "const result = await ingestRazorpayWebhook(",
    );
    const successLatencyLogIndex = routeSource.indexOf(
      'logEvent("webhook_request_completed", {\n      http_status: 200,\n      latency_ms: Date.now() - startedAt,',
    );
    expect(ingestCallIndex).toBeGreaterThan(-1);
    expect(successLatencyLogIndex).toBeGreaterThan(-1);
    expect(ingestCallIndex).toBeLessThan(successLatencyLogIndex);
  });

  it("C: no intentional timer/sleep mechanism (setTimeout/setInterval/Atomics.wait/node:timers/ad hoc sleep-delay helper) exists anywhere in the critical-path chain", () => {
    const forbiddenTimerPattern =
      /\bsetTimeout\s*\(|\bsetInterval\s*\(|Atomics\.wait\s*\(|from\s+["']node:timers|from\s+["']timers|\bsleep\s*\(|\bdelay\s*\(/;
    for (const [file, src] of Object.entries(CRITICAL_PATH_SOURCES)) {
      expect(
        src,
        `${file} must not contain a deliberate timer/sleep call`,
      ).not.toMatch(forbiddenTimerPattern);
    }
  });

  it("D: no unbounded while(true)/for(;;) loop exists anywhere in the critical-path chain", () => {
    const unboundedLoopPattern = /while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/;
    for (const [file, src] of Object.entries(CRITICAL_PATH_SOURCES)) {
      expect(src, `${file} must not contain an unbounded loop`).not.toMatch(
        unboundedLoopPattern,
      );
    }
  });

  it("E: no AI/ML/diagnosis/reconciliation/analytics/report-generation module is imported anywhere in the critical-path chain", () => {
    const forbiddenDependencyPattern =
      /openai|anthropic|ollama|langchain|lib\/diagnosis|lib\/reliability|lib\/reconciliation|lib\/analytics|lib\/report/i;
    for (const [file, src] of Object.entries(CRITICAL_PATH_SOURCES)) {
      expect(
        src,
        `${file} must not import an AI/diagnosis/reconciliation/analytics module`,
      ).not.toMatch(forbiddenDependencyPattern);
    }
  });

  it("F: this test file makes NO real <5000ms wall-clock assertion — real latency proof remains Phase 2G's deployed manual verification gate, never a mocked/faked unit-test number", () => {
    // A structural self-check on this describe block's own intent: no test
    // in THIS file measures actual elapsed Date.now() time against a
    // millisecond threshold. Every assertion above is source-structural
    // (index/pattern checks against the real critical-path source files),
    // not a fabricated timing benchmark.
    const thisTestFileSource = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../tests/unit/api/webhooks-razorpay-route.test.ts",
      ),
      "utf-8",
    );
    const fakeWallClockAssertionPattern =
      /toBeLessThan\s*\(\s*5000\s*\)|toBeGreaterThan\s*\(\s*5000\s*\)|performance\.now\s*\(/;
    expect(thisTestFileSource).not.toMatch(fakeWallClockAssertionPattern);
  });
});
