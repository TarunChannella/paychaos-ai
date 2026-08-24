import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// Phase 2D: server-only config module. Same rationale as
// tests/unit/config/razorpay-env.test.ts.
vi.mock("server-only", () => ({}));

import { EnvValidationError } from "@/lib/config/env-validation";
import { loadRazorpayWebhookSecret } from "@/lib/config/razorpay-webhook-env";
import * as webhookEnvModule from "@/lib/config/razorpay-webhook-env";

const FAKE_WEBHOOK_SECRET = "f".repeat(32) + "-fake-webhook-secret-not-real";
const FAKE_API_KEY_SECRET = "fake-razorpay-key-secret-not-real";

describe("loadRazorpayWebhookSecret", () => {
  it("accepts a fake secret at least 32 characters long", () => {
    expect(
      loadRazorpayWebhookSecret({
        RAZORPAY_WEBHOOK_SECRET: FAKE_WEBHOOK_SECRET,
      }),
    ).toBe(FAKE_WEBHOOK_SECRET);
  });

  it("rejects a missing RAZORPAY_WEBHOOK_SECRET", () => {
    expect(() => loadRazorpayWebhookSecret({})).toThrow(EnvValidationError);
  });

  it("rejects an empty RAZORPAY_WEBHOOK_SECRET", () => {
    expect(() =>
      loadRazorpayWebhookSecret({ RAZORPAY_WEBHOOK_SECRET: "" }),
    ).toThrow(EnvValidationError);
  });

  it("rejects a secret shorter than 32 characters", () => {
    expect(() =>
      loadRazorpayWebhookSecret({
        RAZORPAY_WEBHOOK_SECRET: "too-short-secret",
      }),
    ).toThrow(EnvValidationError);
  });

  it("accepts a secret exactly 32 characters long", () => {
    const exactly32 = "a".repeat(32);
    expect(exactly32.length).toBe(32);
    expect(
      loadRazorpayWebhookSecret({ RAZORPAY_WEBHOOK_SECRET: exactly32 }),
    ).toBe(exactly32);
  });

  it("rejects a webhook secret equal to RAZORPAY_KEY_SECRET", () => {
    expect(() =>
      loadRazorpayWebhookSecret({
        RAZORPAY_WEBHOOK_SECRET: FAKE_API_KEY_SECRET.padEnd(32, "x"),
        RAZORPAY_KEY_SECRET: FAKE_API_KEY_SECRET.padEnd(32, "x"),
      }),
    ).toThrow(EnvValidationError);
  });

  it("accepts a webhook secret that differs from RAZORPAY_KEY_SECRET", () => {
    expect(
      loadRazorpayWebhookSecret({
        RAZORPAY_WEBHOOK_SECRET: FAKE_WEBHOOK_SECRET,
        RAZORPAY_KEY_SECRET: FAKE_API_KEY_SECRET,
      }),
    ).toBe(FAKE_WEBHOOK_SECRET);
  });

  it("does not require RAZORPAY_KEY_SECRET to be present at all", () => {
    // This module is deliberately decoupled from the eager Phase 2A
    // startup validation — it must validate independently.
    expect(
      loadRazorpayWebhookSecret({
        RAZORPAY_WEBHOOK_SECRET: FAKE_WEBHOOK_SECRET,
      }),
    ).toBe(FAKE_WEBHOOK_SECRET);
  });

  it("the rejected secret's own value never appears in the error message", () => {
    const rejected = "short";
    try {
      loadRazorpayWebhookSecret({ RAZORPAY_WEBHOOK_SECRET: rejected });
      throw new Error("expected loadRazorpayWebhookSecret to throw");
    } catch (err) {
      expect((err as EnvValidationError).message).not.toContain(rejected);
      expect((err as EnvValidationError).variable).toBe(
        "RAZORPAY_WEBHOOK_SECRET",
      );
    }
  });
});

describe("razorpay-webhook-env module marks itself server-only", () => {
  it("imports the server-only marker package", () => {
    const source = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../lib/config/razorpay-webhook-env.ts",
      ),
      "utf-8",
    );
    expect(source).toMatch(/import\s+["']server-only["']/);
  });

  it("does not export a NEXT_PUBLIC_-prefixed name for the webhook secret", () => {
    const exportNames = Object.keys(webhookEnvModule);
    for (const name of exportNames) {
      expect(name).not.toMatch(/^NEXT_PUBLIC_/i);
    }
  });
});
