import "server-only";

import { logEvent } from "@/lib/security/logger";

/**
 * Phase 5 — sanitized server-side diagnostics for a failed Supabase read.
 *
 * WHY THIS EXISTS. A deployed Preview renders the safe error boundary on every
 * page that reads persisted evidence, and Vercel shows the outbound request to
 * `/rest/v1/orders` with no application-level reason. That is not bad luck: the
 * repository catches the Supabase error and throws its own
 * `DemoMerchantRepositoryError`, discarding `code`, `message`, `details` and
 * `hint` without logging any of them. Eleven read sites in that one file do
 * this. The failure is therefore undiagnosable from the deployment, which is
 * the actual thing being fixed here.
 *
 * IT CHANGES NO BEHAVIOUR. The caller still throws exactly what it threw
 * before, the error boundary still catches it, and the browser still receives
 * the same generic message. This only writes a log line first.
 *
 * REDACTION IS VALUE-DRIVEN, NOT NAME-DRIVEN. `logEvent` redacts fields whose
 * NAME looks sensitive, which is the right default but the wrong protection
 * here: a secret arriving inside `error.message` would sail through a field
 * innocently called `message`. So every string below is scrubbed for
 * JWT-shaped and other long opaque tokens before it is logged, and truncated.
 * The Supabase client, its headers and its key are never touched at all —
 * there is no code path here that can reach them.
 */

/** Bounded so a pathological message cannot flood the log. */
const MAX_FIELD_LENGTH = 300;

/**
 * Patterns for values that must never reach a log line, whatever field they
 * arrive in.
 *
 * A Supabase key is a JWT, so the `eyJ...` shape is the one that matters most.
 * The generic long-opaque-run rule is defence in depth: it costs nothing and
 * catches a token shape nobody has thought of yet.
 */
const SECRET_SHAPED = [
  // A JWT: three base64url segments, or just the recognisable header.
  /eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){0,2}/g,
  // Razorpay-style identifiers for secrets, and any long opaque run.
  /rzp_(?:live|test)_[A-Za-z0-9]+/g,
  /\b[A-Za-z0-9_-]{40,}\b/g,
];

/** Removes anything secret-shaped, then bounds the length. */
export function sanitizeDiagnosticText(value: unknown): string | null {
  if (typeof value !== "string") return null;

  let safe = value;
  for (const pattern of SECRET_SHAPED) {
    safe = safe.replace(pattern, "[REDACTED]");
  }

  safe = safe.trim();
  if (safe.length === 0) return null;
  return safe.length > MAX_FIELD_LENGTH
    ? `${safe.slice(0, MAX_FIELD_LENGTH)}…`
    : safe;
}

/** The shape of a PostgREST error, as much of it as is safe to read. */
interface SupabaseErrorLike {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly details?: unknown;
  readonly hint?: unknown;
  readonly status?: unknown;
}

/**
 * Logs why a Supabase read failed, server-side only.
 *
 * Reads a fixed, closed set of fields off the error. It never enumerates the
 * error object, never serializes it wholesale, and never reads a request,
 * a header or the client — so there is no route by which a credential could
 * be picked up incidentally.
 */
export function logSupabaseReadFailure(
  operation: string,
  resource: string,
  error: unknown,
): void {
  const record: SupabaseErrorLike =
    typeof error === "object" && error !== null ? error : {};

  logEvent("supabase_read_failed", {
    operation,
    resource,
    // PostgREST/Postgres codes are the identifier that actually names the
    // failure category: PGRST301 (JWT), 42501 (RLS/permission), 42P01
    // (undefined table), and so on.
    error_code: sanitizeDiagnosticText(record.code) ?? "UNKNOWN",
    http_status:
      typeof record.status === "number" ? record.status : "NOT_REPORTED",
    error_message: sanitizeDiagnosticText(record.message) ?? "NOT_REPORTED",
    error_details: sanitizeDiagnosticText(record.details) ?? "NOT_REPORTED",
    error_hint: sanitizeDiagnosticText(record.hint) ?? "NOT_REPORTED",
  });
}
