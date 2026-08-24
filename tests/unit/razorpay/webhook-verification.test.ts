import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Phase 2D: server-only module. Same rationale as
// tests/unit/razorpay/checkout-verification.test.ts.
vi.mock("server-only", () => ({}));

const FAKE_WEBHOOK_SECRET = "f".repeat(40);

const TRACKED_ENV_KEYS = [
  "RAZORPAY_WEBHOOK_SECRET",
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

function setFakeValidWebhookEnv(): void {
  process.env.RAZORPAY_WEBHOOK_SECRET = FAKE_WEBHOOK_SECRET;
}

function realSignatureFor(rawBody: Buffer): string {
  return createHmac("sha256", FAKE_WEBHOOK_SECRET)
    .update(rawBody)
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

describe("verifyWebhookSignature", () => {
  it("accepts a known-valid signature computed over the exact raw body", async () => {
    setFakeValidWebhookEnv();
    const { verifyWebhookSignature } =
      await import("@/lib/razorpay/webhook-verification");

    const rawBody = Buffer.from('{"event":"payment.captured"}', "utf8");
    const signature = realSignatureFor(rawBody);

    expect(verifyWebhookSignature({ rawBody, signature })).toBe(true);
  });

  it("rejects a known-invalid signature", async () => {
    setFakeValidWebhookEnv();
    const { verifyWebhookSignature } =
      await import("@/lib/razorpay/webhook-verification");

    const rawBody = Buffer.from('{"event":"payment.captured"}', "utf8");

    expect(verifyWebhookSignature({ rawBody, signature: "0".repeat(64) })).toBe(
      false,
    );
  });

  it("rejects when even one byte of the raw body has changed (old signature)", async () => {
    setFakeValidWebhookEnv();
    const { verifyWebhookSignature } =
      await import("@/lib/razorpay/webhook-verification");

    const originalBody = Buffer.from('{"event":"payment.captured"}', "utf8");
    const signature = realSignatureFor(originalBody);

    const modifiedBody = Buffer.from('{"event":"payment.capturee"}', "utf8");
    expect(modifiedBody.length).toBe(originalBody.length);

    expect(verifyWebhookSignature({ rawBody: modifiedBody, signature })).toBe(
      false,
    );
  });

  it("rejects a missing signature", async () => {
    setFakeValidWebhookEnv();
    const { verifyWebhookSignature } =
      await import("@/lib/razorpay/webhook-verification");

    const rawBody = Buffer.from("{}", "utf8");
    expect(
      verifyWebhookSignature({
        rawBody,
        signature: undefined as unknown as string,
      }),
    ).toBe(false);
  });

  it("rejects a malformed short signature safely (no throw)", async () => {
    setFakeValidWebhookEnv();
    const { verifyWebhookSignature } =
      await import("@/lib/razorpay/webhook-verification");

    const rawBody = Buffer.from("{}", "utf8");
    expect(() =>
      verifyWebhookSignature({ rawBody, signature: "abc" }),
    ).not.toThrow();
    expect(verifyWebhookSignature({ rawBody, signature: "abc" })).toBe(false);
  });

  it("rejects a malformed non-hex signature of the correct length safely", async () => {
    setFakeValidWebhookEnv();
    const { verifyWebhookSignature } =
      await import("@/lib/razorpay/webhook-verification");

    const rawBody = Buffer.from("{}", "utf8");
    const nonHex = "g".repeat(64); // 'g' is not a valid hex character
    expect(verifyWebhookSignature({ rawBody, signature: nonHex })).toBe(false);
  });

  it("rejects an oversized signature value safely", async () => {
    setFakeValidWebhookEnv();
    const { verifyWebhookSignature } =
      await import("@/lib/razorpay/webhook-verification");

    const rawBody = Buffer.from("{}", "utf8");
    const oversized = "a".repeat(10_000);
    expect(verifyWebhookSignature({ rawBody, signature: oversized })).toBe(
      false,
    );
  });

  it("fails closed (throws) when the webhook secret is missing", async () => {
    // No RAZORPAY_WEBHOOK_SECRET set at all.
    const { verifyWebhookSignature } =
      await import("@/lib/razorpay/webhook-verification");
    const { EnvValidationError } = await import("@/lib/config/env-validation");

    const rawBody = Buffer.from("{}", "utf8");
    expect(() =>
      verifyWebhookSignature({ rawBody, signature: "a".repeat(64) }),
    ).toThrow(EnvValidationError);
  });

  it("fails closed (throws) when the webhook secret is shorter than 32 characters", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = "too-short";
    const { verifyWebhookSignature } =
      await import("@/lib/razorpay/webhook-verification");
    const { EnvValidationError } = await import("@/lib/config/env-validation");

    const rawBody = Buffer.from("{}", "utf8");
    expect(() =>
      verifyWebhookSignature({ rawBody, signature: "a".repeat(64) }),
    ).toThrow(EnvValidationError);
  });

  it("fails closed (throws) when the webhook secret equals RAZORPAY_KEY_SECRET", async () => {
    const shared = "s".repeat(40);
    process.env.RAZORPAY_WEBHOOK_SECRET = shared;
    process.env.RAZORPAY_KEY_SECRET = shared;
    const { verifyWebhookSignature } =
      await import("@/lib/razorpay/webhook-verification");
    const { EnvValidationError } = await import("@/lib/config/env-validation");

    const rawBody = Buffer.from("{}", "utf8");
    expect(() =>
      verifyWebhookSignature({ rawBody, signature: "a".repeat(64) }),
    ).toThrow(EnvValidationError);
  });

  it("never includes the webhook secret in its return value (it returns only a boolean)", async () => {
    setFakeValidWebhookEnv();
    const { verifyWebhookSignature } =
      await import("@/lib/razorpay/webhook-verification");

    const rawBody = Buffer.from("{}", "utf8");
    const result = verifyWebhookSignature({
      rawBody,
      signature: "0".repeat(64),
    });

    expect(typeof result).toBe("boolean");
    expect(JSON.stringify(result)).not.toContain(FAKE_WEBHOOK_SECRET);
  });
});

describe("webhook-verification module marks itself server-only", () => {
  it("imports the server-only marker package", () => {
    const source = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../lib/razorpay/webhook-verification.ts",
      ),
      "utf-8",
    );
    expect(source).toMatch(/^import\s+["']server-only["'];/m);
  });
});
