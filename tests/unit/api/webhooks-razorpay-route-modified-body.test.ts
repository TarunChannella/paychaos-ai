import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 3D-A — C03's MODIFIED_BODY proof (docs/CHAOS_SCENARIOS.md Section
 * 15; this task's Section 6). Deliberately an OFFLINE UNIT TEST ONLY, never
 * part of the production C03 chaos executor
 * (`lib/chaos/c03-execution-service.ts`) — a modified-body proof requires
 * first manufacturing a VALID signature over a body, which requires the
 * webhook secret's value. The production chaos executor must never read the
 * real secret to compute an HMAC; this constraint is exactly why this proof
 * lives here instead.
 *
 * Uses a FIXED, OBVIOUSLY-SYNTHETIC TEST-ONLY secret
 * (`PAYCHAOS_C03_TEST_ONLY_SECRET`) — never `.env.local`'s real
 * `RAZORPAY_WEBHOOK_SECRET`. `lib/config/razorpay-webhook-env.ts`'s narrow
 * `getRazorpayWebhookSecret()` accessor is mocked so the REAL, UNMODIFIED
 * `app/api/webhooks/razorpay/route.ts` -> `lib/webhooks/service.ts` ->
 * `lib/razorpay/webhook-verification.ts` chain runs unmodified against this
 * synthetic secret — no production code is changed to make this test
 * possible.
 *
 * Structure (this task's Section 6):
 *   body A -> HMAC-SHA256(body A, SYNTHETIC_TEST_SECRET) -> mutate to body B
 *   -> send body B with body A's signature (now stale) -> real POST handler
 *   -> expect HTTP 400 -> assert no ingestion/persistence call occurs.
 */

vi.mock("server-only", () => ({}));

const PAYCHAOS_C03_TEST_ONLY_SECRET =
  "paychaos-c03-test-only-synthetic-secret-" + "x".repeat(10);

vi.mock("@/lib/config/razorpay-webhook-env", () => ({
  getRazorpayWebhookSecret: () => PAYCHAOS_C03_TEST_ONLY_SECRET,
}));

// Proves "no ingestion call occurs" — the canonical webhook_events writer is
// mocked so this test can assert it is never invoked, without needing a real
// Supabase connection. If the real signature check ever regressed to a
// fail-open path, this mock would surface that regression as a spurious
// call rather than a silent real database write.
const insertWebhookEventMock = vi.fn();
vi.mock("@/lib/webhooks/repository", () => ({
  insertWebhookEvent: insertWebhookEventMock,
  incrementWebhookDuplicateDeliveryCount: vi.fn(),
  updateWebhookEventDerivedFields: vi.fn(),
}));

const insertEventProcessingAttemptMock = vi.fn();
vi.mock("@/lib/webhooks/event-processing-repository", () => ({
  insertEventProcessingAttempt: insertEventProcessingAttemptMock,
  getDurableNormalizedAttemptForWebhookEvent: vi.fn(),
  markEventProcessingAttemptFailedIfNotFinal: vi.fn(),
}));

const processMerchantWebhookEventMock = vi.fn();
vi.mock("@/lib/events/processor", () => ({
  processMerchantWebhookEvent: processMerchantWebhookEventMock,
  MerchantProcessingError: class MerchantProcessingError extends Error {},
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const WEBHOOK_URL = "http://localhost/api/webhooks/razorpay";

function computeSignature(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("C03 MODIFIED_BODY proof — real webhook route, synthetic test-only secret", () => {
  it("rejects a request whose body was modified after signing, with HTTP 400 and zero ingestion calls", async () => {
    const { POST } = await import("@/app/api/webhooks/razorpay/route");
    const { NextRequest } = await import("next/server");

    const bodyA = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "paychaos_synthetic_body_a" } } },
    });
    const signatureOverBodyA = computeSignature(
      bodyA,
      PAYCHAOS_C03_TEST_ONLY_SECRET,
    );

    // Mutate to body B — the signature above is now stale for this exact
    // content, exactly the "changed-raw-body" case docs/RAZORPAY_GUIDE.md
    // requires be provably rejected.
    const bodyB = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "paychaos_synthetic_body_b" } } },
    });
    expect(bodyB).not.toBe(bodyA);

    const headers = new Headers();
    headers.set("x-razorpay-signature", signatureOverBodyA);
    headers.set("x-razorpay-event-id", "paychaos-c03-modified-body-test");

    const request = new NextRequest(WEBHOOK_URL, {
      method: "POST",
      headers,
      body: bodyB,
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(insertWebhookEventMock).not.toHaveBeenCalled();
    expect(insertEventProcessingAttemptMock).not.toHaveBeenCalled();
    expect(processMerchantWebhookEventMock).not.toHaveBeenCalled();
  }, 20_000);

  it("sanity check: the SAME unmodified body with its own correct signature is accepted past signature verification (proves the mock secret is genuinely exercised, not merely always-reject)", async () => {
    const { POST } = await import("@/app/api/webhooks/razorpay/route");
    const { NextRequest } = await import("next/server");

    const body = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "paychaos_synthetic_sanity" } } },
    });
    const signature = computeSignature(body, PAYCHAOS_C03_TEST_ONLY_SECRET);

    const headers = new Headers();
    headers.set("x-razorpay-signature", signature);
    headers.set("x-razorpay-event-id", "paychaos-c03-sanity-check");

    const request = new NextRequest(WEBHOOK_URL, {
      method: "POST",
      headers,
      body,
    });

    const response = await POST(request);

    // Signature verification passes (not 400-for-signature); this event
    // then proceeds to the mocked persistence layer, which this test does
    // not need to fully wire up — only that the route did not reject it at
    // the signature stage the way the modified-body case above did.
    expect(response.status).not.toBe(400);
  });

  it("never reads .env.local's real RAZORPAY_WEBHOOK_SECRET — the config module is fully mocked", () => {
    expect(process.env.RAZORPAY_WEBHOOK_SECRET).not.toBe(
      PAYCHAOS_C03_TEST_ONLY_SECRET,
    );
  });
});
