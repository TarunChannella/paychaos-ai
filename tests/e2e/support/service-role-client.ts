/**
 * Phase 1E — Playwright-process-only Supabase service-role client, used
 * ONLY for exact-ID test cleanup after tests/e2e/demo-merchant.spec.ts.
 *
 * This file is a Node-only test utility. It is never imported by app/ or
 * components/ code and is never reachable from the browser or any
 * application route — cleanup happens directly from the Playwright/Node
 * test process, the same trust boundary
 * tests/integration/supabase/helpers.ts already uses for the Vitest
 * integration suite. No delete capability is ever exposed to the browser
 * or added to any application API route.
 *
 * It intentionally does NOT import `lib/supabase/server.ts`: that module
 * starts with `import "server-only"`, which unconditionally throws when
 * resolved by plain Node module resolution outside a bundler's
 * "react-server" condition (the same reason
 * tests/integration/supabase/setup-env.ts stubs `server-only` via
 * `vi.mock` for the Vitest integration suite). Playwright's test runner has
 * no equivalent module-mocking hook, so this file builds an equivalent
 * client directly from `@supabase/supabase-js`, using the same
 * `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SUPABASE_URL` values, loaded
 * from `.env.local` the same way `setup-env.ts` does (small,
 * dependency-free parser — no new package; values are never printed or
 * logged).
 */
import fs from "node:fs";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

function loadDotEnvLocalIfNeeded(): void {
  if (
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.NEXT_PUBLIC_SUPABASE_URL
  ) {
    return;
  }

  const envPath = path.resolve(import.meta.dirname, "../../../.env.local");
  if (!fs.existsSync(envPath)) return;

  const contents = fs.readFileSync(envPath, "utf-8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;

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

let cachedClient: SupabaseClient<Database> | undefined;

/** Trusted, Node-process-only client for exact-ID Playwright cleanup only. */
export function getE2ETestServiceRoleClient(): SupabaseClient<Database> {
  if (!cachedClient) {
    loadDotEnvLocalIfNeeded();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "tests/e2e/support/service-role-client.ts: missing NEXT_PUBLIC_SUPABASE_URL " +
          "or SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env.local and fill in " +
          "real Supabase project values. (Values are never printed here — only names.)",
      );
    }
    cachedClient = createClient<Database>(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cachedClient;
}
