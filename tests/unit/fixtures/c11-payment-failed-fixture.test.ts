import { describe, expect, it } from "vitest";

import { extractProviderCreatedAt } from "@/lib/webhooks/redaction";
import { normalizeRazorpayEvent } from "@/lib/events/normalization";
import fixture from "../../fixtures/razorpay/payment-failed-test-mode.fixture.json";

/**
 * Phase 3D-C — permanent unit coverage for the captured, sanitized C11
 * `payment.failed` TEST_FIXTURE (tests/fixtures/razorpay/
 * payment-failed-test-mode.fixture.json).
 *
 * This fixture was derived from ONE genuine, real Razorpay Test Mode
 * failure — canonical webhook_events row
 * e0df759e-bbde-45c3-aa80-a5a2d6b61be9 (signature_verified=true,
 * processing_status=PROCESSED, source_kind=REAL_RAZORPAY_WEBHOOK) — via its
 * already-redacted `raw_payload_redacted` projection. It is NEVER a new
 * Razorpay delivery, and this file proves that no key resembling a secret,
 * signature, or customer/card credential is present anywhere in it,
 * recursively, before proving the frozen production normalizer accepts it
 * and produces the expected `payment.failed` semantics.
 *
 * Pure offline test: no I/O, no Supabase, no network.
 */

const FORBIDDEN_KEY_SUBSTRINGS = [
  "email",
  "contact",
  "phone",
  "vpa",
  "upi",
  "card_number",
  "card",
  "pan",
  "cvv",
  "otp",
  "token",
  "razorpay_signature",
  "signature",
  "authorization",
  "bank_account",
  "customer",
  "key_secret",
  "webhook_secret",
  "service_role",
  "password",
];

/**
 * Recursively walks every own key of every plain object/array reachable from
 * `value`, returning any key whose lowercased name CONTAINS one of the
 * forbidden substrings above. This is a structural key-name scan, not a
 * serialized-text search — it catches a forbidden field regardless of its
 * value, nesting depth, or whether the value itself happens to be safe.
 */
function findForbiddenKeys(value: unknown, path: string[] = []): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findForbiddenKeys(item, [...path, String(index)]),
    );
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }

  const found: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (FORBIDDEN_KEY_SUBSTRINGS.some((needle) => lowerKey.includes(needle))) {
      found.push([...path, key].join("."));
    }
    found.push(...findForbiddenKeys(child, [...path, key]));
  }
  return found;
}

describe("C11 payment.failed TEST_FIXTURE — provenance and security metadata", () => {
  it("declares the exact required classification/provenance/source metadata", () => {
    expect(fixture.metadata.classification).toBe("TEST_FIXTURE");
    expect(fixture.metadata.provenance).toBe(
      "CAPTURED_RAZORPAY_TEST_MODE_FIXTURE",
    );
    expect(fixture.metadata.sourceEventType).toBe("payment.failed");
    expect(fixture.metadata.sanitized).toBe(true);
    expect(fixture.metadata.sourceSignatureVerifiedAtCapture).toBe(true);
    expect(fixture.metadata.runtimeSourceKindMustNeverBe).toBe(
      "REAL_RAZORPAY_WEBHOOK",
    );
    expect(fixture.metadata.sourceCanonicalWebhookEventId).toBe(
      "e0df759e-bbde-45c3-aa80-a5a2d6b61be9",
    );
  });

  it("payload contains no secret/signature/customer/card credential keys recursively", () => {
    // Deliberately scoped to `payload` — the object that actually flows
    // into the normalizer/database — not `metadata`, which is PayChaos's
    // own provenance documentation and legitimately contains descriptive
    // field NAMES like `sourceSignatureVerifiedAtCapture` (a fact about
    // capture provenance, not a secret VALUE) that would otherwise
    // false-positive against a naive substring scan. `payload` is the
    // security-sensitive data; `metadata` is covered by the exact-key
    // allowlist below instead.
    const forbidden = findForbiddenKeys(fixture.payload);
    expect(forbidden).toEqual([]);
  });

  it("metadata contains ONLY the exact allowlisted provenance keys — no unreviewed field can be silently added", () => {
    const ALLOWED_METADATA_KEYS = [
      "classification",
      "provenance",
      "sourceEventType",
      "sanitized",
      "sourceSignatureVerifiedAtCapture",
      "sourceProcessingStatusAtCapture",
      "sourceCanonicalWebhookEventId",
      "sourceProviderCreatedAt",
      "capturedAt",
      "capturedFrom",
      "runtimeSourceKindMustNeverBe",
      "derivedFrom",
      "providerIdsReplaced",
      "fixtureRazorpayEventId",
      "providerIdReplacementNote",
      "forbiddenFieldsConfirmedAbsent",
    ];
    const actualKeys = Object.keys(fixture.metadata);
    expect(actualKeys.sort()).toEqual([...ALLOWED_METADATA_KEYS].sort());
  });

  it("payment status/currency/error fields match the authentic captured semantics", () => {
    expect(fixture.payload.payment.status).toBe("failed");
    expect(fixture.payload.payment.currency).toBe("INR");
    expect(fixture.payload.payment.amount).toBe(50000);
    expect(fixture.payload.payment.error_code).toBe("BAD_REQUEST_ERROR");
    expect(fixture.payload.payment.error_source).toBe("bank");
    expect(fixture.payload.payment.error_step).toBe("payment_authorization");
    expect(fixture.payload.payment.error_reason).toBe("payment_failed");
  });

  it("provider IDs are deterministic fixture-only values, never the real captured Test Mode IDs", () => {
    expect(fixture.payload.payment.id).toBe("pay_fixture_c11_failed_001");
    expect(fixture.payload.payment.order_id).toBe(
      "order_fixture_c11_failed_001",
    );
    expect(fixture.metadata.fixtureRazorpayEventId).toBe(
      "evt_fixture_c11_failed_001",
    );
  });
});

describe("C11 payment.failed TEST_FIXTURE — deterministic normalization proof (real, unmodified normalizeRazorpayEvent)", () => {
  it("normalizes to the expected payment.failed shape via the frozen production normalizer", () => {
    const providerCreatedAt = extractProviderCreatedAt(fixture.payload);
    expect(providerCreatedAt).not.toBeNull();

    const result = normalizeRazorpayEvent({
      razorpayEventId: fixture.metadata.fixtureRazorpayEventId,
      eventType: fixture.payload.event,
      providerCreatedAt,
      safeEvidence: fixture.payload,
    });

    expect(result.outcome).toBe("normalized");
    if (result.outcome !== "normalized") {
      throw new Error("expected normalized");
    }
    expect(result.event).toEqual({
      schemaVersion: 1,
      // Structural artifact of the frozen, unmodified pure normalizer —
      // see this file's module doc comment and the handoff for why this is
      // NOT a provenance claim: normalizeRazorpayEvent always stamps this
      // literal on every output regardless of its input's true origin.
      sourceKind: "REAL_RAZORPAY_WEBHOOK",
      razorpayEventId: "evt_fixture_c11_failed_001",
      eventType: "payment.failed",
      providerCreatedAt,
      kind: "payment.failed",
      razorpayOrderId: "order_fixture_c11_failed_001",
      razorpayPaymentId: "pay_fixture_c11_failed_001",
      amountSubunits: 50000,
      currency: "INR",
      razorpayPaymentStatus: "failed",
      errorCode: "BAD_REQUEST_ERROR",
      errorSource: "bank",
      errorStep: "payment_authorization",
      errorReason: "payment_failed",
    });
  });
});
