/**
 * Phase 1C-B — setup file for the real-network Supabase integration suite.
 *
 * Registered ONLY in vitest.integration.config.ts's `setupFiles` — the
 * offline unit suite (vitest.config.ts) never loads this file, so
 * `npm run test` never opens a network connection or reads `.env.local`.
 *
 * Responsibilities:
 *   1. Stub the `server-only` marker package. Its real default export
 *      unconditionally throws when resolved outside a bundler's
 *      "react-server" condition (see node_modules/server-only/index.js) —
 *      including under plain Vitest/Node resolution, exactly as documented
 *      in tests/unit/supabase/server.test.ts. This suite legitimately
 *      calls the real `getSupabaseServerClient()` helper against a REAL
 *      Supabase project from Node, so the marker is stubbed the same way
 *      here. This does not weaken the real guarantee: Next's bundler still
 *      substitutes the throwing module for an actual client-bundle import
 *      (re-verified independently in Task 10 / migration.test.ts's static
 *      scan).
 *   2. Load `.env.local` (small dependency-free parser — no new package)
 *      WITHOUT ever printing/logging its contents, so this suite can run
 *      locally the same way `next dev` picks up `.env.local`.
 *   3. Fail fast with a clear error that names only the MISSING VARIABLE
 *      NAMES (never a value) if required variables are still unavailable
 *      after step 2 (e.g. in an environment relying on real process-level
 *      secret injection instead of a local file).
 */
import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";

vi.mock("server-only", () => ({}));

function loadDotEnvLocal(): void {
  const envPath = path.resolve(import.meta.dirname, "../../../.env.local");
  if (!fs.existsSync(envPath)) return;

  const contents = fs.readFileSync(envPath, "utf-8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!key) continue;

    // Never override a value already present in the real process
    // environment (e.g. CI-injected secrets take precedence over the
    // local file).
    if (process.env[key] !== undefined) continue;

    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotEnvLocal();

const REQUIRED_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const missing = REQUIRED_VARS.filter((name) => {
  const value = process.env[name];
  return value === undefined || value.trim().length === 0;
});

if (missing.length > 0) {
  throw new Error(
    "Real-Supabase integration suite is missing required environment " +
      `variable(s): ${missing.join(", ")}. ` +
      "Copy .env.example to .env.local and fill in real Supabase project " +
      'values, then re-run "npm run test:integration:supabase". ' +
      "(Values are never printed here — only variable names.)",
  );
}
