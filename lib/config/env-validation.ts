/**
 * Phase 1B — shared environment-variable validation primitives.
 *
 * This module is intentionally value-free: it never reads `process.env`
 * itself and never holds any actual configuration value (client-safe or
 * server-only). It only contains small, deterministic, pure functions used
 * by both `client-env.ts` and `server-env.ts` to validate a value that the
 * caller already read from its own trusted source.
 *
 * Because it never touches an actual secret value, it is safe to import
 * from either side of the client/server boundary — it carries no side
 * channel back to a real environment variable.
 *
 * Fails closed: every validator throws `EnvValidationError` naming the
 * variable that failed, but the thrown error message never includes the
 * supplied value. See docs/SECURITY.md ENV-006 / ENV-007.
 */

/**
 * Thrown when an environment variable is missing or malformed.
 *
 * `variable` names which variable failed for safe diagnostics. The
 * offending value is deliberately never attached to this error or
 * included in its message.
 */
export class EnvValidationError extends Error {
  readonly variable: string;

  constructor(variable: string, message: string) {
    super(message);
    this.name = "EnvValidationError";
    this.variable = variable;
  }
}

/**
 * Requires a non-empty, non-whitespace-only string.
 *
 * Used for required secret strings (e.g. `SUPABASE_SERVICE_ROLE_KEY`) and
 * other required plain string configuration.
 */
export function requireNonEmptyString(
  name: string,
  value: string | undefined,
): string {
  if (value === undefined || value.trim().length === 0) {
    throw new EnvValidationError(
      name,
      `Missing or empty required environment variable: ${name}`,
    );
  }
  return value;
}

/**
 * Requires a syntactically valid absolute http(s) URL.
 *
 * Used for `NEXT_PUBLIC_SUPABASE_URL`. Rejects empty/whitespace-only values
 * and any value that does not parse as an absolute http/https URL.
 */
export function requireHttpUrl(
  name: string,
  value: string | undefined,
): string {
  const nonEmpty = requireNonEmptyString(name, value);

  let parsed: URL;
  try {
    parsed = new URL(nonEmpty);
  } catch {
    throw new EnvValidationError(
      name,
      `Environment variable ${name} must be a valid absolute URL`,
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new EnvValidationError(
      name,
      `Environment variable ${name} must use the http or https protocol`,
    );
  }

  return nonEmpty;
}
