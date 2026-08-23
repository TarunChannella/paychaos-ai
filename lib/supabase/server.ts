/**
 * Phase 1C-A — server-only Supabase connection helper.
 *
 * Creates a Supabase client authenticated with `SUPABASE_SERVICE_ROLE_KEY`,
 * the critical secret that bypasses Row Level Security (docs/SECURITY.md
 * Section 8/10, Section 24-25). This module must never be imported from
 * client/browser code.
 *
 * Structural guarantee: `import "server-only"` (same pattern as
 * lib/config/server-env.ts) makes a client-bundle import of this module
 * fail at build time rather than relying on review discipline alone.
 *
 * This module intentionally does NOT read `process.env` itself and does
 * NOT duplicate any environment-reading logic. It builds strictly on top
 * of the existing Phase 1B validated env accessors:
 *   - `getServerEnv()` (lib/config/server-env.ts) for the service-role key;
 *   - `getClientEnv()` (lib/config/client-env.ts) for the project URL,
 *     which is the same public Supabase URL used client-side — reading it
 *     server-side is safe and avoids a second URL-validation code path.
 *
 * The returned client is a lazily-created singleton, matching the caching
 * pattern already used by `getServerEnv()`/`getClientEnv()`.
 */
import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getClientEnv } from "@/lib/config/client-env";
import { getServerEnv } from "@/lib/config/server-env";

import type { Database } from "./types";

let cachedClient: SupabaseClient<Database> | undefined;

/**
 * Validated singleton server-side Supabase client.
 *
 * Uses the service-role key, so callers of this function are trusted
 * server code that must enforce authorization/validation themselves — RLS
 * does not apply to this client (docs/SECURITY.md "Trusted Server").
 *
 * Construction is lazy: importing this module has no side effect; only
 * calling `getSupabaseServerClient()` triggers env validation and client
 * creation. `getServerEnv()`/`getClientEnv()` already throw
 * `EnvValidationError` (fail closed, never leaking the offending value) if
 * required variables are missing or malformed — this function does not
 * add a second error path.
 */
export function getSupabaseServerClient(): SupabaseClient<Database> {
  if (!cachedClient) {
    const { supabaseUrl } = getClientEnv();
    const { supabaseServiceRoleKey } = getServerEnv();

    cachedClient = createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        // Server-side service-role client: no user session to persist or
        // refresh. Avoids accidentally writing session state to disk/
        // storage in a server process.
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return cachedClient;
}
