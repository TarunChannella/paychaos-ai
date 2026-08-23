/**
 * Phase 1B — client-safe environment configuration.
 *
 * This module is the ONLY place in the codebase allowed to read the
 * client-safe environment variables listed below. It must never import
 * from `server-env.ts` and must never read/export `SUPABASE_SERVICE_ROLE_KEY`
 * or any other server-only secret (see docs/SECURITY.md Section 10).
 *
 * Client-safe variables (Phase 1 scope):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - NEXT_PUBLIC_SUPABASE_ANON_KEY
 *
 * These are safe for the browser bundle because Next.js inlines
 * `NEXT_PUBLIC_*` variables at build time and Supabase's anon key is
 * designed to be used from untrusted clients under Row Level Security
 * (RLS) — it carries no privileged authority by itself.
 *
 * This module intentionally does NOT connect to Supabase. That is Phase 1C.
 */

import { requireHttpUrl, requireNonEmptyString } from "./env-validation";

export interface ClientEnv {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
}

/**
 * Pure loader. Accepts an explicit `source` (defaulting to `process.env`)
 * so tests can inject obviously-fake values without any module-cache
 * gymnastics and without ever touching real credentials.
 *
 * Fails closed: throws `EnvValidationError` (see env-validation.ts) if a
 * required variable is missing, empty, or malformed. The error never
 * includes the supplied value.
 */
export function loadClientEnv(
  source: Record<string, string | undefined> = process.env,
): ClientEnv {
  return {
    supabaseUrl: requireHttpUrl(
      "NEXT_PUBLIC_SUPABASE_URL",
      source.NEXT_PUBLIC_SUPABASE_URL,
    ),
    supabaseAnonKey: requireNonEmptyString(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      source.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  };
}

let cachedClientEnv: ClientEnv | undefined;

/**
 * Validated singleton for application code. Validation runs lazily on
 * first access (not at module import time) so importing this module never
 * has a validation side effect by itself; only actually using client
 * configuration triggers fail-closed startup validation (also invoked
 * eagerly at server startup by `instrumentation.ts`, see ENV-006).
 *
 * Deliberately does NOT call `loadClientEnv()` with its defaulted
 * `source = process.env` parameter. Next.js only guarantees build-time
 * inlining of `NEXT_PUBLIC_*` variables for STATIC references to
 * `process.env.NEXT_PUBLIC_X` written literally in source; a generic
 * property access through a variable (even one that defaults to
 * `process.env`) is not guaranteed to survive Next.js's static replacement
 * in every bundling scenario. The object literal below keeps the literal
 * `process.env.NEXT_PUBLIC_SUPABASE_URL` / `...ANON_KEY` tokens directly in
 * this client-facing code path so the browser bundle reliably gets real
 * inlined values instead of `undefined`.
 */
export function getClientEnv(): ClientEnv {
  if (!cachedClientEnv) {
    cachedClientEnv = loadClientEnv({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
  }
  return cachedClientEnv;
}
