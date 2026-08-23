import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Phase 1B: server-only config module.
//
// The real `server-only` package unconditionally throws when resolved
// through a plain Node/bundler import (it relies on webpack/Next's
// "react-server" export condition to swap in a no-op on the server, the
// same way Next.js's own server compiler does). Vitest runs as plain Node,
// so it never sets that condition — meaning importing server-env.ts here
// would always throw regardless of whether this is a legitimate server
// test context.
//
// We stub the marker package the same way Next's bundler effectively does
// on the server (swap it for a no-op) so this file can exercise the real
// validation logic in server-env.ts. This does not weaken the production
// guarantee: in the actual Next.js build, the real `server-only` package
// still runs and still fails a client-bundle import at build time.
vi.mock("server-only", () => ({}));

import { loadServerEnv } from "@/lib/config/server-env";
import { EnvValidationError } from "@/lib/config/env-validation";
import * as serverEnvModule from "@/lib/config/server-env";

describe("loadServerEnv", () => {
  it("C: parses successfully using a fake test-only service-role value", () => {
    const env = loadServerEnv({
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-not-real",
    });
    expect(env).toEqual({
      supabaseServiceRoleKey: "test-service-role-key-not-real",
    });
  });

  it("D: rejects a missing SUPABASE_SERVICE_ROLE_KEY", () => {
    expect(() => loadServerEnv({})).toThrow(EnvValidationError);
  });

  it("D: rejects an empty SUPABASE_SERVICE_ROLE_KEY", () => {
    expect(() => loadServerEnv({ SUPABASE_SERVICE_ROLE_KEY: "" })).toThrow(
      EnvValidationError,
    );
  });

  it("D: rejects a whitespace-only SUPABASE_SERVICE_ROLE_KEY", () => {
    expect(() => loadServerEnv({ SUPABASE_SERVICE_ROLE_KEY: "   " })).toThrow(
      EnvValidationError,
    );
  });

  it("E: the failure message never contains the (rejected) supplied value", () => {
    // Whitespace-only is rejected; assert the literal whitespace-padded
    // token itself never leaks into the error message.
    const rejectedValue = "   ";
    try {
      loadServerEnv({ SUPABASE_SERVICE_ROLE_KEY: rejectedValue });
      throw new Error("expected loadServerEnv to throw");
    } catch (err) {
      expect((err as EnvValidationError).message).not.toContain(rejectedValue);
      expect((err as EnvValidationError).variable).toBe(
        "SUPABASE_SERVICE_ROLE_KEY",
      );
    }
  });
});

describe("server-env module marks itself server-only", () => {
  it("imports the server-only marker package", () => {
    // Verifies the structural guarantee is wired up: server-env.ts must
    // import "server-only" as its first import so a real (non-stubbed)
    // build fails closed if this module is ever pulled into a client
    // bundle. We assert this via source inspection rather than relying on
    // the (here-stubbed) package's runtime throw.
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../lib/config/server-env.ts"),
      "utf-8",
    );
    expect(source).toMatch(/import\s+["']server-only["']/);
  });

  it("does not export a client-safe name", () => {
    const exportNames = Object.keys(serverEnvModule);
    for (const name of exportNames) {
      expect(name.toLowerCase()).not.toContain("clientenv");
    }
  });
});
