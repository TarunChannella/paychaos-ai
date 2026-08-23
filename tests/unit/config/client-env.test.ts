import { describe, expect, it } from "vitest";
import { loadClientEnv } from "@/lib/config/client-env";
import { EnvValidationError } from "@/lib/config/env-validation";
import * as clientEnvModule from "@/lib/config/client-env";

// Phase 1B: client-safe config module. Values are injected via the
// `source` parameter — never real credentials, never process.env directly
// — so these tests never require a real Supabase project.
describe("loadClientEnv", () => {
  const validSource = {
    NEXT_PUBLIC_SUPABASE_URL: "https://fake-project.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "fake-anon-key-not-real",
  };

  it("A: parses successfully with valid client-safe values", () => {
    const env = loadClientEnv(validSource);
    expect(env).toEqual({
      supabaseUrl: "https://fake-project.supabase.co",
      supabaseAnonKey: "fake-anon-key-not-real",
    });
  });

  it("B: rejects a missing NEXT_PUBLIC_SUPABASE_URL", () => {
    expect(() =>
      loadClientEnv({
        NEXT_PUBLIC_SUPABASE_ANON_KEY:
          validSource.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      }),
    ).toThrow(EnvValidationError);
  });

  it("B: rejects a malformed NEXT_PUBLIC_SUPABASE_URL", () => {
    expect(() =>
      loadClientEnv({
        ...validSource,
        NEXT_PUBLIC_SUPABASE_URL: "not-a-valid-url",
      }),
    ).toThrow(EnvValidationError);
  });

  it("B: rejects a missing NEXT_PUBLIC_SUPABASE_ANON_KEY", () => {
    expect(() =>
      loadClientEnv({
        NEXT_PUBLIC_SUPABASE_URL: validSource.NEXT_PUBLIC_SUPABASE_URL,
      }),
    ).toThrow(EnvValidationError);
  });

  it("B: rejects a whitespace-only NEXT_PUBLIC_SUPABASE_ANON_KEY", () => {
    expect(() =>
      loadClientEnv({
        ...validSource,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "   ",
      }),
    ).toThrow(EnvValidationError);
  });

  it("E: the failure message never contains the supplied malformed value", () => {
    const malformedValue = "totally-not-a-url-leak-check-98765";
    try {
      loadClientEnv({
        ...validSource,
        NEXT_PUBLIC_SUPABASE_URL: malformedValue,
      });
      throw new Error("expected loadClientEnv to throw");
    } catch (err) {
      expect((err as Error).message).not.toContain(malformedValue);
    }
  });
});

describe("client-env module shape (F: must never expose server secrets)", () => {
  it("the loaded client env object has exactly the two client-safe keys", () => {
    const env = loadClientEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://fake-project.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "fake-anon-key-not-real",
    });
    expect(Object.keys(env).sort()).toEqual(["supabaseAnonKey", "supabaseUrl"]);
  });

  it("passing SUPABASE_SERVICE_ROLE_KEY in the source never surfaces it on the result", () => {
    const env = loadClientEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://fake-project.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "fake-anon-key-not-real",
      // Even if a service-role value were present in the source object
      // (e.g. because the caller passed the full process.env), client-env
      // must never read or forward it.
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-not-real",
    });
    expect(JSON.stringify(env)).not.toContain("test-service-role-key-not-real");
    expect(env).not.toHaveProperty("supabaseServiceRoleKey");
    expect(env).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("the client-env module exports no server-only symbol", () => {
    const exportNames = Object.keys(clientEnvModule);
    for (const name of exportNames) {
      expect(name.toLowerCase()).not.toContain("servicerole");
      expect(name.toLowerCase()).not.toContain("serverenv");
    }
  });
});
