import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Phase 1C-A: server-only Supabase connection helper.
//
// Same rationale as tests/unit/config/server-env.test.ts: the real
// `server-only` package unconditionally throws when resolved through plain
// Node/Vite module resolution, so it is stubbed the same way Next's
// bundler effectively does on the server. This does not weaken the
// production guarantee — the real package still fails a client-bundle
// import at build time.
vi.mock("server-only", () => ({}));

// @supabase/supabase-js's createClient is mocked so these tests never open
// a real network connection or require a real Supabase project. This test
// file proves the HELPER'S WIRING (which URL/key it passes, singleton
// caching, fail-closed behavior) — not real Supabase connectivity, which
// is out of scope until the migration is actually applied.
// The mock's call signature is set via vi.fn's explicit type parameter
// (rather than named implementation parameters) so `createClientMock`
// keeps a 3-positional-arg call signature — which
// `createClientMock.mock.calls[0][1]` (test B below) relies on for its
// index-1/index-2 access to type-check — without declaring any unused
// parameter names in the implementation body.
const createClientMock = vi.fn<
  (
    url: string,
    key: string,
    options?: unknown,
  ) => { __fakeSupabaseClient: true }
>(() => ({
  __fakeSupabaseClient: true,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

const repoRoot = path.resolve(import.meta.dirname, "../../../");

const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;
type EnvKey = (typeof ENV_KEYS)[number];
type EnvSnapshot = Partial<Record<EnvKey, string>>;

function snapshotEnv(): EnvSnapshot {
  const snapshot: EnvSnapshot = {};
  for (const key of ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) snapshot[key] = value;
  }
  return snapshot;
}

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

function restoreEnv(snapshot: EnvSnapshot): void {
  clearEnv();
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value !== undefined) process.env[key] = value;
  }
}

let originalEnv: EnvSnapshot;

beforeEach(() => {
  originalEnv = snapshotEnv();
  clearEnv();
  createClientMock.mockClear();
  vi.resetModules();
});

afterEach(() => {
  restoreEnv(originalEnv);
  vi.resetModules();
});

const FAKE_URL = "https://fake-project.supabase.co";
const FAKE_ANON_KEY = "fake-anon-key-not-real";
const FAKE_SERVICE_ROLE_KEY = "fake-service-role-key-not-real";

describe("getSupabaseServerClient", () => {
  it("A: creates a client using the validated URL and service-role key", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = FAKE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = FAKE_ANON_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_ROLE_KEY;

    const { getSupabaseServerClient } = await import("@/lib/supabase/server");
    const client = getSupabaseServerClient();

    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(createClientMock).toHaveBeenCalledWith(
      FAKE_URL,
      FAKE_SERVICE_ROLE_KEY,
      expect.objectContaining({
        auth: expect.objectContaining({
          autoRefreshToken: false,
          persistSession: false,
        }),
      }),
    );
    expect(client).toEqual({ __fakeSupabaseClient: true });
  });

  it("B: never passes the anon key as the client's auth key (uses service-role, not anon)", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = FAKE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = FAKE_ANON_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_ROLE_KEY;

    const { getSupabaseServerClient } = await import("@/lib/supabase/server");
    getSupabaseServerClient();

    const callArgs = createClientMock.mock.calls[0];
    expect(callArgs?.[1]).toBe(FAKE_SERVICE_ROLE_KEY);
    expect(callArgs?.[1]).not.toBe(FAKE_ANON_KEY);
  });

  it("C: caches the client across repeated calls (singleton, one createClient call)", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = FAKE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = FAKE_ANON_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_ROLE_KEY;

    const { getSupabaseServerClient } = await import("@/lib/supabase/server");
    const first = getSupabaseServerClient();
    const second = getSupabaseServerClient();

    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it("D: fails closed (throws, never calls createClient) when SUPABASE_SERVICE_ROLE_KEY is missing", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = FAKE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = FAKE_ANON_KEY;
    // SUPABASE_SERVICE_ROLE_KEY intentionally left unset.

    const { getSupabaseServerClient } = await import("@/lib/supabase/server");
    expect(() => getSupabaseServerClient()).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("D: fails closed when NEXT_PUBLIC_SUPABASE_URL is malformed", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-valid-url";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = FAKE_ANON_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_ROLE_KEY;

    const { getSupabaseServerClient } = await import("@/lib/supabase/server");
    expect(() => getSupabaseServerClient()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("E: a rejected/missing value never leaks into the thrown error message", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = FAKE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = FAKE_ANON_KEY;
    // SUPABASE_SERVICE_ROLE_KEY intentionally left unset — nothing to leak,
    // but assert the error text stays generic regardless.
    const { getSupabaseServerClient } = await import("@/lib/supabase/server");
    try {
      getSupabaseServerClient();
      throw new Error("expected getSupabaseServerClient to throw");
    } catch (err) {
      expect((err as Error).message).not.toContain(FAKE_SERVICE_ROLE_KEY);
    }
  });
});

describe("lib/supabase/server.ts — structural server-only guarantees (#1, #2)", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "lib", "supabase", "server.ts"),
    "utf-8",
  );

  it("imports the server-only marker package as its first import", () => {
    expect(source).toMatch(/^import\s+["']server-only["'];/m);
  });

  it("does not read process.env directly — reuses the Phase 1B env boundary instead", () => {
    // Matches actual property access (`process.env.X` / `process.env[...]`),
    // not the bare phrase "process.env" that appears in this file's own
    // explanatory doc comment.
    expect(source).not.toMatch(/process\.env(?:\.\w+|\[)/);
  });

  it("imports getServerEnv from the existing server-env module (no duplicated env-reading logic)", () => {
    expect(source).toMatch(
      /import\s*{\s*getServerEnv\s*}\s*from\s*["']@\/lib\/config\/server-env["']/,
    );
  });

  it("imports getClientEnv from the existing client-env module for the shared project URL", () => {
    expect(source).toMatch(
      /import\s*{\s*getClientEnv\s*}\s*from\s*["']@\/lib\/config\/client-env["']/,
    );
  });
});

describe("Phase 1C-A: no service-role name leaks into client-importable code (#3)", () => {
  function walk(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, out);
      } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  // app/ and components/ are the client-importable-by-default areas of the
  // repository (per docs/ARCHITECTURE.md Section 36's module boundaries).
  // lib/supabase/server.ts itself is intentionally excluded — it legitimately
  // uses the service-role key and is protected by the `server-only` import
  // asserted above, not by textual absence.
  const clientDirs = ["app", "components"].map((d) => path.join(repoRoot, d));
  const files = clientDirs.flatMap((d) => walk(d));

  it("scanned at least one app/ or components/ file", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("no app/ or components/ file references SUPABASE_SERVICE_ROLE_KEY or supabaseServiceRoleKey", () => {
    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      expect(content).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
      expect(content).not.toMatch(/supabaseServiceRoleKey/);
    }
  });
});

describe("Phase 1C-A/2C/2D: Database type is scoped to exactly the 5 approved tables", () => {
  const typesSource = fs.readFileSync(
    path.join(repoRoot, "lib", "supabase", "types.ts"),
    "utf-8",
  );

  it("declares the 5 approved table keys (Phase 1: orders/payment_attempts/fulfilments; Phase 2C: payments; Phase 2D: webhook_events)", () => {
    expect(typesSource).toMatch(/\borders:\s*{/);
    expect(typesSource).toMatch(/\bpayment_attempts:\s*{/);
    expect(typesSource).toMatch(/\bpayments:\s*{/);
    expect(typesSource).toMatch(/\bfulfilments:\s*{/);
    expect(typesSource).toMatch(/\bwebhook_events:\s*{/);
  });

  it("declares no Phase 2E+/3+/4+ table", () => {
    const forbidden = [
      "event_processing_attempts",
      "chaos_runs",
      "invariant_results",
      "findings",
      "regression_runs",
    ];
    for (const name of forbidden) {
      expect(typesSource).not.toMatch(new RegExp(`\\b${name}:\\s*{`));
    }
  });

  it("fulfilments has no payment_id or trigger_processing_attempt_id field", () => {
    // Scoped to ONLY the `fulfilments:` table block — the Phase 2C
    // `payments` table legitimately declares an unrelated
    // `payment_attempt_id` column, which contains the substring
    // "payment_id" and would false-positive against a whole-file check.
    const fulfilmentsMatch = typesSource.match(
      /\bfulfilments:\s*\{[\s\S]*?\n {6}\};/,
    );
    expect(fulfilmentsMatch).not.toBeNull();
    const fulfilmentsBlock = fulfilmentsMatch![0]!;
    expect(fulfilmentsBlock).not.toMatch(/\bpayment_id\b/);
    expect(fulfilmentsBlock).not.toMatch(/\btrigger_processing_attempt_id\b/);
  });
});
