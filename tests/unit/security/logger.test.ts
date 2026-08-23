import { describe, expect, it } from "vitest";
import {
  MAX_LOG_FIELDS,
  REDACTED_PLACEHOLDER,
  logEvent,
  redactFields,
} from "@/lib/security/logger";

// Phase 1B: secret-safe structured logging/redaction foundation.
// Never logs to real stdout in tests — every call uses an injected `sink`
// so output is captured deterministically instead of parsed from console.

describe("redactFields / logEvent (G: redacts known secret fields)", () => {
  const secretFields = {
    supabaseServiceRoleKey: "test-service-role-key-not-real",
    razorpayKeySecret: "test-razorpay-key-secret-not-real",
    razorpayWebhookSecret: "test-webhook-secret-not-real",
    paychaosAccessToken: "test-access-token-not-real",
    paychaosSessionSecret: "test-session-secret-not-real",
    cvv: "123",
    otp: "654321",
    sessionCookie: "test-session-cookie-value-not-real",
  };

  it("redacts every known critical field by name via redactFields", () => {
    const redacted = redactFields(secretFields);
    for (const key of Object.keys(secretFields)) {
      expect(redacted[key]).toBe(REDACTED_PLACEHOLDER);
    }
  });

  it("none of the original secret values appear anywhere in the redacted output", () => {
    const redacted = redactFields(secretFields);
    const serialized = JSON.stringify(redacted);
    for (const value of Object.values(secretFields)) {
      expect(serialized).not.toContain(value);
    }
  });

  it("logEvent's emitted line never contains a secret value", () => {
    const lines: string[] = [];
    logEvent("test_event", secretFields, (line) => lines.push(line));

    expect(lines).toHaveLength(1);
    for (const value of Object.values(secretFields)) {
      expect(lines[0]).not.toContain(value);
    }
    expect(lines[0]).toContain(REDACTED_PLACEHOLDER);
  });

  it("also redacts SCREAMING_SNAKE_CASE variants of the same field names", () => {
    const redacted = redactFields({
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-not-real",
      RAZORPAY_KEY_SECRET: "test-razorpay-key-secret-not-real",
      RAZORPAY_WEBHOOK_SECRET: "test-webhook-secret-not-real",
      PAYCHAOS_ACCESS_TOKEN: "test-access-token-not-real",
      PAYCHAOS_SESSION_SECRET: "test-session-secret-not-real",
      CVV: "123",
      OTP: "654321",
    });
    expect(redacted.SUPABASE_SERVICE_ROLE_KEY).toBe(REDACTED_PLACEHOLDER);
    expect(redacted.RAZORPAY_KEY_SECRET).toBe(REDACTED_PLACEHOLDER);
    expect(redacted.RAZORPAY_WEBHOOK_SECRET).toBe(REDACTED_PLACEHOLDER);
    expect(redacted.PAYCHAOS_ACCESS_TOKEN).toBe(REDACTED_PLACEHOLDER);
    expect(redacted.PAYCHAOS_SESSION_SECRET).toBe(REDACTED_PLACEHOLDER);
    expect(redacted.CVV).toBe(REDACTED_PLACEHOLDER);
    expect(redacted.OTP).toBe(REDACTED_PLACEHOLDER);
  });
});

describe("redactFields (H: does not blanket-redact approved safe fields)", () => {
  const safeFields = {
    paymentAttemptId: "attempt_123",
    merchantOrderId: "order_456",
    razorpayOrderId: "order_rzp_789",
    razorpayPaymentId: "pay_abc",
    razorpayEventId: "evt_def",
    status: "success",
    signatureVerified: true,
    duplicateDetected: false,
    latencyMs: 42,
  };

  it("leaves every approved safe field exactly as supplied", () => {
    const redacted = redactFields(safeFields);
    expect(redacted).toEqual(safeFields);
  });

  it("logEvent emits the safe field values unchanged", () => {
    const lines: string[] = [];
    logEvent("webhook_processed", safeFields, (line) => lines.push(line));

    const parsed = JSON.parse(lines[0]!) as { fields: typeof safeFields };
    expect(parsed.fields).toEqual(safeFields);
  });
});

describe("logEvent structured output", () => {
  it("includes the event name and an ISO timestamp", () => {
    const lines: string[] = [];
    logEvent("chaos_run_started", { chaosRunId: "run_1" }, (line) =>
      lines.push(line),
    );

    const parsed = JSON.parse(lines[0]!) as {
      event: string;
      timestamp: string;
      fields: Record<string, unknown>;
    };
    expect(parsed.event).toBe("chaos_run_started");
    expect(() => new Date(parsed.timestamp).toISOString()).not.toThrow();
    expect(parsed.fields).toEqual({ chaosRunId: "run_1" });
  });

  it("defaults to an empty fields object when none is supplied", () => {
    const lines: string[] = [];
    logEvent("noop_event", undefined, (line) => lines.push(line));
    const parsed = JSON.parse(lines[0]!) as { fields: Record<string, unknown> };
    expect(parsed.fields).toEqual({});
  });
});

describe("logEvent fails closed against accidental object/environment dumps", () => {
  it("throws rather than logging a field set larger than MAX_LOG_FIELDS", () => {
    const hugeFieldSet: Record<string, string> = {};
    for (let i = 0; i < MAX_LOG_FIELDS + 5; i += 1) {
      hugeFieldSet[`field_${i}`] = `value_${i}`;
    }

    const lines: string[] = [];
    expect(() =>
      logEvent("suspicious_dump", hugeFieldSet, (line) => lines.push(line)),
    ).toThrow();
    // Nothing was written to the sink — the guard fails closed before emit.
    expect(lines).toHaveLength(0);
  });

  it("does not throw for a field set at the boundary size", () => {
    const boundaryFieldSet: Record<string, string> = {};
    for (let i = 0; i < MAX_LOG_FIELDS; i += 1) {
      boundaryFieldSet[`field_${i}`] = `value_${i}`;
    }

    const lines: string[] = [];
    expect(() =>
      logEvent("ok_size", boundaryFieldSet, (line) => lines.push(line)),
    ).not.toThrow();
    expect(lines).toHaveLength(1);
  });
});
