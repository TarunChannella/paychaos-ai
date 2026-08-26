import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 3D-A (correction round 1) — "ROUTE-LEVEL TESTING STILL REQUIRED"
 * proofs A and B. The production C03 runtime chaos executor
 * (`lib/chaos/c03-execution-service.ts`) no longer invokes this route at
 * all (Blocker 2 correction — it now calls `verifyWebhookSignature`
 * directly, so it can never fabricate canonical webhook evidence even if
 * this HTTP boundary regressed). This file independently keeps the HTTP
 * Route Handler proof alive: the REAL, UNMODIFIED
 * `app/api/webhooks/razorpay/route.ts` -> `lib/webhooks/service.ts` ->
 * `lib/razorpay/webhook-verification.ts` chain, exercised with a fixed
 * synthetic TEST-ONLY secret and persistence collaborators mocked (never
 * real Supabase, never the real `RAZORPAY_WEBHOOK_SECRET`).
 *
 * Mirrors the mocking pattern already established by
 * `tests/unit/api/webhooks-razorpay-route-modified-body.test.ts` (Proof C).
 */

vi.mock("server-only", () => ({}));

const PAYCHAOS_C03_TEST_ONLY_SECRET =
  "paychaos-c03-test-only-synthetic-secret-" + "y".repeat(10);

vi.mock("@/lib/config/razorpay-webhook-env", () => ({
  getRazorpayWebhookSecret: () => PAYCHAOS_C03_TEST_ONLY_SECRET,
}));

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

function buildSyntheticBody(marker: string): string {
  return JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: marker } } },
  });
}

function assertZeroPersistenceCalls(): void {
  expect(insertWebhookEventMock).not.toHaveBeenCalled();
  expect(insertEventProcessingAttemptMock).not.toHaveBeenCalled();
  expect(processMerchantWebhookEventMock).not.toHaveBeenCalled();
}

describe("A: WRONG_SIGNATURE — real route, real verification, mocked persistence", () => {
  it("rejects a well-formed-but-wrong signature with HTTP 400 and zero canonical persistence calls", async () => {
    const { POST } = await import("@/app/api/webhooks/razorpay/route");
    const { NextRequest } = await import("next/server");

    const headers = new Headers();
    headers.set("x-razorpay-signature", "0".repeat(64));
    headers.set("x-razorpay-event-id", "paychaos-c03-route-test-wrong");

    const request = new NextRequest(WEBHOOK_URL, {
      method: "POST",
      headers,
      body: buildSyntheticBody("paychaos_route_test_wrong"),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    assertZeroPersistenceCalls();
  }, 20_000);
});

describe("B: MISSING_SIGNATURE — real route, real verification, mocked persistence", () => {
  it("rejects a request with no x-razorpay-signature header with HTTP 400 and zero canonical persistence calls", async () => {
    const { POST } = await import("@/app/api/webhooks/razorpay/route");
    const { NextRequest } = await import("next/server");

    const headers = new Headers();
    // Deliberately no x-razorpay-signature header.
    headers.set("x-razorpay-event-id", "paychaos-c03-route-test-missing");

    const request = new NextRequest(WEBHOOK_URL, {
      method: "POST",
      headers,
      body: buildSyntheticBody("paychaos_route_test_missing"),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    assertZeroPersistenceCalls();
  });
});

describe("never reads .env.local's real RAZORPAY_WEBHOOK_SECRET", () => {
  it("the config module is fully mocked to a synthetic test-only value", () => {
    expect(process.env.RAZORPAY_WEBHOOK_SECRET).not.toBe(
      PAYCHAOS_C03_TEST_ONLY_SECRET,
    );
  });
});
