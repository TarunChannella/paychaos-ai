import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// instrumentation.ts transitively imports lib/config/server-env.ts, which
// imports the `server-only` package. The real package unconditionally
// throws when resolved through plain Node/Vite module resolution (it
// relies on webpack/Next's "react-server" export condition to swap in a
// no-op on the server, the same way Next.js's own server compiler does).
// Vitest never sets that condition, so we stub the marker the same way
// Next's bundler effectively does on the server. See
// tests/unit/config/server-env.test.ts for the identical rationale.
vi.mock("server-only", () => ({}));

// Phase 1B ENV-006 verification: proves instrumentation.ts's `register()`
// actually performs fail-closed startup validation (not just lazy
// validate-on-call), per docs/SECURITY.md ENV-006/ENV-007.
//
// Next.js invokes `register()` once when a server instance boots; if it
// throws, the server fails to start. These tests call `register()`
// directly (the same exported function Next.js calls) against a freshly
// reset module graph so each case gets its own uncached
// getClientEnv()/getServerEnv() singleton.

const PHASE_1B_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_RUNTIME",
] as const;

type Phase1bEnvKey = (typeof PHASE_1B_ENV_KEYS)[number];
type EnvSnapshot = Partial<Record<Phase1bEnvKey, string>>;

function snapshotEnv(): EnvSnapshot {
  const snapshot: EnvSnapshot = {};
  for (const key of PHASE_1B_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      snapshot[key] = value;
    }
  }
  return snapshot;
}

function clearPhase1bEnv(): void {
  for (const key of PHASE_1B_ENV_KEYS) {
    delete process.env[key];
  }
}

function restoreEnv(snapshot: EnvSnapshot): void {
  clearPhase1bEnv();
  for (const key of PHASE_1B_ENV_KEYS) {
    const value = snapshot[key];
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
}

let originalEnv: EnvSnapshot;

beforeEach(() => {
  originalEnv = snapshotEnv();
  clearPhase1bEnv();
  // instrumentation.ts only runs Phase 1B validation on the Node.js
  // runtime (see its NEXT_RUNTIME guard); the default runtime Next.js
  // uses for this app is "nodejs".
  process.env.NEXT_RUNTIME = "nodejs";
  vi.resetModules();
});

afterEach(() => {
  restoreEnv(originalEnv);
  vi.resetModules();
});

describe("instrumentation.ts register() — startup validation (ENV-006)", () => {
  it("A: startup succeeds with fake valid Phase 1B variables", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake-project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fake-anon-key-not-real";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key-not-real";

    const { register } = await import("@/instrumentation");
    await expect(register()).resolves.toBeUndefined();
  });

  it("B: startup fails closed when SUPABASE_SERVICE_ROLE_KEY is missing", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake-project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fake-anon-key-not-real";
    // SUPABASE_SERVICE_ROLE_KEY intentionally left unset.

    const { register } = await import("@/instrumentation");
    await expect(register()).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("C: startup fails closed when NEXT_PUBLIC_SUPABASE_URL is malformed", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-valid-url";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fake-anon-key-not-real";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key-not-real";

    const { register } = await import("@/instrumentation");
    await expect(register()).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("D: the malformed URL value itself never appears in the resulting error", async () => {
    const malformedValue = "not-a-valid-url-leak-check-13579";
    process.env.NEXT_PUBLIC_SUPABASE_URL = malformedValue;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fake-anon-key-not-real";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key-not-real";

    const { register } = await import("@/instrumentation");
    try {
      await register();
      throw new Error("expected register() to throw");
    } catch (err) {
      expect((err as Error).message).not.toContain(malformedValue);
    }
  });

  it("does not run Node-only Phase 1B validation on a non-Node runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";
    // All three Phase 1B variables intentionally left unset — if the
    // NEXT_RUNTIME guard were broken, register() would throw here too.

    const { register } = await import("@/instrumentation");
    await expect(register()).resolves.toBeUndefined();
  });
});
