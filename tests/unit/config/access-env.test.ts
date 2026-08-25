import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// Phase 2G readiness: server-only config module. Same rationale as
// tests/unit/config/razorpay-webhook-env.test.ts.
vi.mock("server-only", () => ({}));

import { EnvValidationError } from "@/lib/config/env-validation";
import { loadAccessGateEnv } from "@/lib/config/access-env";
import * as accessEnvModule from "@/lib/config/access-env";

const FAKE_ACCESS_TOKEN = "fake-access-token-not-real-abc123";
const FAKE_SESSION_SECRET = "fake-session-secret-not-real-" + "x".repeat(10);

describe("loadAccessGateEnv", () => {
  it("is disabled when PAYCHAOS_ACCESS_GATE is unset", () => {
    const env = loadAccessGateEnv({});
    expect(env.mode).toBe("disabled");
    expect(env.accessToken).toBeNull();
    expect(env.sessionSecret).toBeNull();
  });

  it("is disabled when PAYCHAOS_ACCESS_GATE is empty", () => {
    const env = loadAccessGateEnv({ PAYCHAOS_ACCESS_GATE: "" });
    expect(env.mode).toBe("disabled");
  });

  it('is disabled when PAYCHAOS_ACCESS_GATE is exactly "disabled"', () => {
    const env = loadAccessGateEnv({ PAYCHAOS_ACCESS_GATE: "disabled" });
    expect(env.mode).toBe("disabled");
    expect(env.accessToken).toBeNull();
    expect(env.sessionSecret).toBeNull();
  });

  it("does not require PAYCHAOS_ACCESS_TOKEN/PAYCHAOS_SESSION_SECRET when disabled", () => {
    // Proves the gate never blocks ordinary local development merely
    // because these are unset — the whole point of the lazy, opt-in design.
    expect(() =>
      loadAccessGateEnv({ PAYCHAOS_ACCESS_GATE: "disabled" }),
    ).not.toThrow();
    expect(() => loadAccessGateEnv({})).not.toThrow();
  });

  it("rejects an unrecognized PAYCHAOS_ACCESS_GATE value instead of guessing", () => {
    expect(() => loadAccessGateEnv({ PAYCHAOS_ACCESS_GATE: "true" })).toThrow(
      EnvValidationError,
    );
    expect(() => loadAccessGateEnv({ PAYCHAOS_ACCESS_GATE: "1" })).toThrow(
      EnvValidationError,
    );
    expect(() =>
      loadAccessGateEnv({ PAYCHAOS_ACCESS_GATE: "Enabled" }),
    ).toThrow(EnvValidationError);
  });

  it("is enabled with valid token/secret", () => {
    const env = loadAccessGateEnv({
      PAYCHAOS_ACCESS_GATE: "enabled",
      PAYCHAOS_ACCESS_TOKEN: FAKE_ACCESS_TOKEN,
      PAYCHAOS_SESSION_SECRET: FAKE_SESSION_SECRET,
    });
    expect(env.mode).toBe("enabled");
    expect(env.accessToken).toBe(FAKE_ACCESS_TOKEN);
    expect(env.sessionSecret).toBe(FAKE_SESSION_SECRET);
  });

  it("rejects enabled mode with a missing PAYCHAOS_ACCESS_TOKEN", () => {
    expect(() =>
      loadAccessGateEnv({
        PAYCHAOS_ACCESS_GATE: "enabled",
        PAYCHAOS_SESSION_SECRET: FAKE_SESSION_SECRET,
      }),
    ).toThrow(EnvValidationError);
  });

  it("rejects enabled mode with a missing PAYCHAOS_SESSION_SECRET", () => {
    expect(() =>
      loadAccessGateEnv({
        PAYCHAOS_ACCESS_GATE: "enabled",
        PAYCHAOS_ACCESS_TOKEN: FAKE_ACCESS_TOKEN,
      }),
    ).toThrow(EnvValidationError);
  });

  it("rejects a PAYCHAOS_ACCESS_TOKEN shorter than 20 characters", () => {
    expect(() =>
      loadAccessGateEnv({
        PAYCHAOS_ACCESS_GATE: "enabled",
        PAYCHAOS_ACCESS_TOKEN: "too-short",
        PAYCHAOS_SESSION_SECRET: FAKE_SESSION_SECRET,
      }),
    ).toThrow(EnvValidationError);
  });

  it("rejects a PAYCHAOS_SESSION_SECRET shorter than 32 characters", () => {
    expect(() =>
      loadAccessGateEnv({
        PAYCHAOS_ACCESS_GATE: "enabled",
        PAYCHAOS_ACCESS_TOKEN: FAKE_ACCESS_TOKEN,
        PAYCHAOS_SESSION_SECRET: "too-short",
      }),
    ).toThrow(EnvValidationError);
  });

  it("rejects PAYCHAOS_SESSION_SECRET equal to PAYCHAOS_ACCESS_TOKEN", () => {
    const shared = "a".repeat(40);
    expect(() =>
      loadAccessGateEnv({
        PAYCHAOS_ACCESS_GATE: "enabled",
        PAYCHAOS_ACCESS_TOKEN: shared,
        PAYCHAOS_SESSION_SECRET: shared,
      }),
    ).toThrow(EnvValidationError);
  });

  it("the rejected value never appears in the thrown error message", () => {
    const rejectedToken = "short";
    try {
      loadAccessGateEnv({
        PAYCHAOS_ACCESS_GATE: "enabled",
        PAYCHAOS_ACCESS_TOKEN: rejectedToken,
        PAYCHAOS_SESSION_SECRET: FAKE_SESSION_SECRET,
      });
      throw new Error("expected loadAccessGateEnv to throw");
    } catch (err) {
      expect((err as EnvValidationError).message).not.toContain(rejectedToken);
    }

    const rejectedSecret = "also-short";
    try {
      loadAccessGateEnv({
        PAYCHAOS_ACCESS_GATE: "enabled",
        PAYCHAOS_ACCESS_TOKEN: FAKE_ACCESS_TOKEN,
        PAYCHAOS_SESSION_SECRET: rejectedSecret,
      });
      throw new Error("expected loadAccessGateEnv to throw");
    } catch (err) {
      expect((err as EnvValidationError).message).not.toContain(rejectedSecret);
    }
  });
});

describe("access-env module marks itself server-only", () => {
  it("imports the server-only marker package", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../lib/config/access-env.ts"),
      "utf-8",
    );
    expect(source).toMatch(/import\s+["']server-only["']/);
  });

  it("does not export a NEXT_PUBLIC_-prefixed name", () => {
    const exportNames = Object.keys(accessEnvModule);
    for (const name of exportNames) {
      expect(name).not.toMatch(/^NEXT_PUBLIC_/i);
    }
  });
});
