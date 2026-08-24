import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Phase 2C: server-only module. Same rationale as
// tests/unit/razorpay/adapter.test.ts.
vi.mock("server-only", () => ({}));

const FAKE_KEY_ID = "rzp_test_fake_key_id_not_real";
const FAKE_KEY_SECRET = "fake-razorpay-key-secret-not-real";

const TRACKED_ENV_KEYS = [
  "RAZORPAY_MODE",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
] as const;
type TrackedEnvKey = (typeof TRACKED_ENV_KEYS)[number];
type EnvSnapshot = Partial<Record<TrackedEnvKey, string>>;

let originalEnv: EnvSnapshot;

function snapshotEnv(): EnvSnapshot {
  const snapshot: EnvSnapshot = {};
  for (const key of TRACKED_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) snapshot[key] = value;
  }
  return snapshot;
}

function clearTrackedEnv(): void {
  for (const key of TRACKED_ENV_KEYS) delete process.env[key];
}

function restoreEnv(snapshot: EnvSnapshot): void {
  clearTrackedEnv();
  for (const key of TRACKED_ENV_KEYS) {
    const value = snapshot[key];
    if (value !== undefined) process.env[key] = value;
  }
}

function setFakeValidRazorpayEnv(): void {
  process.env.RAZORPAY_MODE = "test";
  process.env.RAZORPAY_KEY_ID = FAKE_KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = FAKE_KEY_SECRET;
}

function realSignatureFor(orderId: string, paymentId: string): string {
  return createHmac("sha256", FAKE_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
}

beforeEach(() => {
  originalEnv = snapshotEnv();
  clearTrackedEnv();
  vi.resetModules();
});

afterEach(() => {
  restoreEnv(originalEnv);
  vi.resetModules();
});

describe("verifyCheckoutSignature", () => {
  it("accepts a known-valid signature computed with the trusted order id", async () => {
    setFakeValidRazorpayEnv();
    const { verifyCheckoutSignature } =
      await import("@/lib/razorpay/checkout-verification");

    const trustedRazorpayOrderId = "order_trusted_abc123";
    const razorpayPaymentId = "pay_fake_xyz789";
    const razorpaySignature = realSignatureFor(
      trustedRazorpayOrderId,
      razorpayPaymentId,
    );

    expect(
      verifyCheckoutSignature({
        trustedRazorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
      }),
    ).toBe(true);
  });

  it("rejects a known-invalid signature", async () => {
    setFakeValidRazorpayEnv();
    const { verifyCheckoutSignature } =
      await import("@/lib/razorpay/checkout-verification");

    expect(
      verifyCheckoutSignature({
        trustedRazorpayOrderId: "order_trusted_abc123",
        razorpayPaymentId: "pay_fake_xyz789",
        razorpaySignature: "0".repeat(64),
      }),
    ).toBe(false);
  });

  it("computes the signature using the TRUSTED order id — a signature valid for a different order id fails", async () => {
    setFakeValidRazorpayEnv();
    const { verifyCheckoutSignature } =
      await import("@/lib/razorpay/checkout-verification");

    const paymentId = "pay_fake_xyz789";
    // Signature was computed for a DIFFERENT (e.g. browser-supplied,
    // attacker-controlled) order id than the one now passed as trusted.
    const signatureForWrongOrder = realSignatureFor(
      "order_attacker_controlled",
      paymentId,
    );

    expect(
      verifyCheckoutSignature({
        trustedRazorpayOrderId: "order_trusted_abc123",
        razorpayPaymentId: paymentId,
        razorpaySignature: signatureForWrongOrder,
      }),
    ).toBe(false);
  });

  it("rejects when the payment id does not match the one the signature was computed for", async () => {
    setFakeValidRazorpayEnv();
    const { verifyCheckoutSignature } =
      await import("@/lib/razorpay/checkout-verification");

    const trustedRazorpayOrderId = "order_trusted_abc123";
    const signatureForOtherPayment = realSignatureFor(
      trustedRazorpayOrderId,
      "pay_the_real_one",
    );

    expect(
      verifyCheckoutSignature({
        trustedRazorpayOrderId,
        razorpayPaymentId: "pay_a_different_one",
        razorpaySignature: signatureForOtherPayment,
      }),
    ).toBe(false);
  });

  it("rejects a malformed (non-hex-length) signature without throwing", async () => {
    setFakeValidRazorpayEnv();
    const { verifyCheckoutSignature } =
      await import("@/lib/razorpay/checkout-verification");

    expect(() =>
      verifyCheckoutSignature({
        trustedRazorpayOrderId: "order_trusted_abc123",
        razorpayPaymentId: "pay_fake_xyz789",
        razorpaySignature: "not-a-real-signature",
      }),
    ).not.toThrow();
    expect(
      verifyCheckoutSignature({
        trustedRazorpayOrderId: "order_trusted_abc123",
        razorpayPaymentId: "pay_fake_xyz789",
        razorpaySignature: "not-a-real-signature",
      }),
    ).toBe(false);
  });

  it("rejects a missing/empty payment id", async () => {
    setFakeValidRazorpayEnv();
    const { verifyCheckoutSignature } =
      await import("@/lib/razorpay/checkout-verification");

    expect(
      verifyCheckoutSignature({
        trustedRazorpayOrderId: "order_trusted_abc123",
        razorpayPaymentId: "",
        razorpaySignature: realSignatureFor("order_trusted_abc123", ""),
      }),
    ).toBe(false);
  });

  it("rejects a missing/empty signature", async () => {
    setFakeValidRazorpayEnv();
    const { verifyCheckoutSignature } =
      await import("@/lib/razorpay/checkout-verification");

    expect(
      verifyCheckoutSignature({
        trustedRazorpayOrderId: "order_trusted_abc123",
        razorpayPaymentId: "pay_fake_xyz789",
        razorpaySignature: "",
      }),
    ).toBe(false);
  });

  it("rejects a missing/empty trusted order id", async () => {
    setFakeValidRazorpayEnv();
    const { verifyCheckoutSignature } =
      await import("@/lib/razorpay/checkout-verification");

    expect(
      verifyCheckoutSignature({
        trustedRazorpayOrderId: "",
        razorpayPaymentId: "pay_fake_xyz789",
        razorpaySignature: realSignatureFor("", "pay_fake_xyz789"),
      }),
    ).toBe(false);
  });

  it("never includes the Key Secret in its return value (it returns only a boolean)", async () => {
    setFakeValidRazorpayEnv();
    const { verifyCheckoutSignature } =
      await import("@/lib/razorpay/checkout-verification");

    const result = verifyCheckoutSignature({
      trustedRazorpayOrderId: "order_trusted_abc123",
      razorpayPaymentId: "pay_fake_xyz789",
      razorpaySignature: "0".repeat(64),
    });

    expect(typeof result).toBe("boolean");
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY_SECRET);
  });

  it("fails closed when Razorpay configuration is invalid (e.g. a fake Live Mode key)", async () => {
    process.env.RAZORPAY_MODE = "test";
    process.env.RAZORPAY_KEY_ID = "rzp_live_fake_live_key_not_real";
    process.env.RAZORPAY_KEY_SECRET = FAKE_KEY_SECRET;

    const { verifyCheckoutSignature } =
      await import("@/lib/razorpay/checkout-verification");
    const { EnvValidationError } = await import("@/lib/config/env-validation");

    expect(() =>
      verifyCheckoutSignature({
        trustedRazorpayOrderId: "order_trusted_abc123",
        razorpayPaymentId: "pay_fake_xyz789",
        razorpaySignature: "0".repeat(64),
      }),
    ).toThrow(EnvValidationError);
  });
});

describe("checkout-verification module marks itself server-only", () => {
  it("imports the server-only marker package", () => {
    const source = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../lib/razorpay/checkout-verification.ts",
      ),
      "utf-8",
    );
    expect(source).toMatch(/^import\s+["']server-only["'];/m);
  });
});
