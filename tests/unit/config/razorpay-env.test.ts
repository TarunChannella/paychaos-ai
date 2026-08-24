import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Phase 2A: server-only config module.
//
// The real `server-only` package unconditionally throws when resolved
// through a plain Node/bundler import (it relies on webpack/Next's
// "react-server" export condition to swap in a no-op on the server, the
// same way Next.js's own server compiler does). Vitest runs as plain Node,
// so it never sets that condition — meaning importing razorpay-env.ts here
// would always throw regardless of whether this is a legitimate server
// test context.
//
// We stub the marker package the same way Next's bundler effectively does
// on the server (swap it for a no-op) so this file can exercise the real
// validation logic in razorpay-env.ts. This does not weaken the production
// guarantee: in the actual Next.js build, the real `server-only` package
// still runs and still fails a client-bundle import at build time.
vi.mock("server-only", () => ({}));

import { loadRazorpayEnv } from "@/lib/config/razorpay-env";
import { EnvValidationError } from "@/lib/config/env-validation";
import * as razorpayEnvModule from "@/lib/config/razorpay-env";

const FAKE_TEST_KEY_ID = "rzp_test_fake_key_id_not_real";
const FAKE_KEY_SECRET = "fake-razorpay-key-secret-not-real";

describe("loadRazorpayEnv", () => {
  it("parses successfully using fake Test Mode values", () => {
    const env = loadRazorpayEnv({
      RAZORPAY_MODE: "test",
      RAZORPAY_KEY_ID: FAKE_TEST_KEY_ID,
      RAZORPAY_KEY_SECRET: FAKE_KEY_SECRET,
    });
    expect(env).toEqual({
      mode: "test",
      keyId: FAKE_TEST_KEY_ID,
      keySecret: FAKE_KEY_SECRET,
    });
  });

  describe("RAZORPAY_MODE", () => {
    it("rejects a missing RAZORPAY_MODE", () => {
      expect(() =>
        loadRazorpayEnv({
          RAZORPAY_KEY_ID: FAKE_TEST_KEY_ID,
          RAZORPAY_KEY_SECRET: FAKE_KEY_SECRET,
        }),
      ).toThrow(EnvValidationError);
    });

    it("rejects a non-'test' RAZORPAY_MODE (e.g. 'live')", () => {
      expect(() =>
        loadRazorpayEnv({
          RAZORPAY_MODE: "live",
          RAZORPAY_KEY_ID: FAKE_TEST_KEY_ID,
          RAZORPAY_KEY_SECRET: FAKE_KEY_SECRET,
        }),
      ).toThrow(EnvValidationError);
    });

    it("rejects an empty RAZORPAY_MODE", () => {
      expect(() =>
        loadRazorpayEnv({
          RAZORPAY_MODE: "",
          RAZORPAY_KEY_ID: FAKE_TEST_KEY_ID,
          RAZORPAY_KEY_SECRET: FAKE_KEY_SECRET,
        }),
      ).toThrow(EnvValidationError);
    });
  });

  describe("RAZORPAY_KEY_ID", () => {
    it("rejects a missing RAZORPAY_KEY_ID", () => {
      expect(() =>
        loadRazorpayEnv({
          RAZORPAY_MODE: "test",
          RAZORPAY_KEY_SECRET: FAKE_KEY_SECRET,
        }),
      ).toThrow(EnvValidationError);
    });

    it("rejects an empty RAZORPAY_KEY_ID", () => {
      expect(() =>
        loadRazorpayEnv({
          RAZORPAY_MODE: "test",
          RAZORPAY_KEY_ID: "",
          RAZORPAY_KEY_SECRET: FAKE_KEY_SECRET,
        }),
      ).toThrow(EnvValidationError);
    });

    it("rejects a fake Live Mode Key ID (rzp_live_ prefix)", () => {
      expect(() =>
        loadRazorpayEnv({
          RAZORPAY_MODE: "test",
          RAZORPAY_KEY_ID: "rzp_live_fake_live_key_not_real",
          RAZORPAY_KEY_SECRET: FAKE_KEY_SECRET,
        }),
      ).toThrow(EnvValidationError);
    });

    it("rejects a malformed/non-Razorpay-shaped Key ID", () => {
      expect(() =>
        loadRazorpayEnv({
          RAZORPAY_MODE: "test",
          RAZORPAY_KEY_ID: "not-a-razorpay-key-id",
          RAZORPAY_KEY_SECRET: FAKE_KEY_SECRET,
        }),
      ).toThrow(EnvValidationError);
    });
  });

  describe("RAZORPAY_KEY_SECRET", () => {
    it("rejects a missing RAZORPAY_KEY_SECRET", () => {
      expect(() =>
        loadRazorpayEnv({
          RAZORPAY_MODE: "test",
          RAZORPAY_KEY_ID: FAKE_TEST_KEY_ID,
        }),
      ).toThrow(EnvValidationError);
    });

    it("rejects an empty RAZORPAY_KEY_SECRET", () => {
      expect(() =>
        loadRazorpayEnv({
          RAZORPAY_MODE: "test",
          RAZORPAY_KEY_ID: FAKE_TEST_KEY_ID,
          RAZORPAY_KEY_SECRET: "",
        }),
      ).toThrow(EnvValidationError);
    });
  });

  it("the fake Key Secret never appears in a resulting error message", () => {
    // An invalid Key ID trips the RAZORPAY_KEY_ID check before the Key
    // Secret is validated; this proves the (well-formed) Key Secret value
    // never leaks into that unrelated failure's error message either.
    try {
      loadRazorpayEnv({
        RAZORPAY_MODE: "test",
        RAZORPAY_KEY_ID: "rzp_live_fake_live_key_not_real",
        RAZORPAY_KEY_SECRET: FAKE_KEY_SECRET,
      });
      throw new Error("expected loadRazorpayEnv to throw");
    } catch (err) {
      expect((err as EnvValidationError).message).not.toContain(
        FAKE_KEY_SECRET,
      );
    }
  });

  it("a rejected Key Secret's own value never appears in its error message", () => {
    const rejectedSecret = "   ";
    try {
      loadRazorpayEnv({
        RAZORPAY_MODE: "test",
        RAZORPAY_KEY_ID: FAKE_TEST_KEY_ID,
        RAZORPAY_KEY_SECRET: rejectedSecret,
      });
      throw new Error("expected loadRazorpayEnv to throw");
    } catch (err) {
      expect((err as EnvValidationError).message).not.toContain(rejectedSecret);
      expect((err as EnvValidationError).variable).toBe("RAZORPAY_KEY_SECRET");
    }
  });
});

describe("razorpay-env module marks itself server-only", () => {
  it("imports the server-only marker package", () => {
    // Verifies the structural guarantee is wired up: razorpay-env.ts must
    // import "server-only" as its first import so a real (non-stubbed)
    // build fails closed if this module is ever pulled into a client
    // bundle. We assert this via source inspection rather than relying on
    // the (here-stubbed) package's runtime throw.
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../lib/config/razorpay-env.ts"),
      "utf-8",
    );
    expect(source).toMatch(/import\s+["']server-only["']/);
  });

  it("does not export a NEXT_PUBLIC_-prefixed name for the Key Secret", () => {
    const exportNames = Object.keys(razorpayEnvModule);
    for (const name of exportNames) {
      expect(name).not.toMatch(/^NEXT_PUBLIC_/i);
    }
  });
});
