/**
 * Phase 1B — server-only environment configuration.
 *
 * This module holds `SUPABASE_SERVICE_ROLE_KEY`, a critical secret that
 * bypasses Supabase Row Level Security (docs/SECURITY.md Section 8/10).
 * It must never be imported from client/browser code.
 *
 * The `server-only` package makes that a structural guarantee rather than
 * a naming convention: importing this module from a module that ends up in
 * a client bundle fails at build time, not just by review discipline.
 *
 * This module intentionally does NOT create a Supabase client and does NOT
 * connect to Supabase. That is Phase 1C.
 */
import "server-only";

import { requireNonEmptyString } from "./env-validation";

export interface ServerEnv {
  readonly supabaseServiceRoleKey: string;
}

/**
 * Pure loader. Accepts an explicit `source` (defaulting to `process.env`)
 * so tests can inject an obviously-fake value (e.g.
 * "test-service-role-key-not-real") without needing real credentials.
 *
 * Fails closed: throws `EnvValidationError` if the value is missing or
 * empty/whitespace-only. The error never includes the supplied value.
 */
export function loadServerEnv(
  source: Record<string, string | undefined> = process.env,
): ServerEnv {
  return {
    supabaseServiceRoleKey: requireNonEmptyString(
      "SUPABASE_SERVICE_ROLE_KEY",
      source.SUPABASE_SERVICE_ROLE_KEY,
    ),
  };
}

let cachedServerEnv: ServerEnv | undefined;

/**
 * Validated singleton for server-only application code. Validation runs
 * lazily on first access, not at module import time.
 */
export function getServerEnv(): ServerEnv {
  if (!cachedServerEnv) {
    cachedServerEnv = loadServerEnv();
  }
  return cachedServerEnv;
}
