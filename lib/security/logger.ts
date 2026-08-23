/**
 * Phase 1B — secret-safe structured logging foundation.
 *
 * Not an observability platform, not an audit-event table — a small
 * deterministic utility that:
 *   1. Only accepts flat, JSON-safe primitive field values (structurally
 *      discourages raw object/error dumps — see `SafeLogFields` below).
 *   2. Redacts any field whose *name* matches a known sensitive pattern,
 *      regardless of the value logged under it.
 *   3. Refuses to log an unusually large field set, as a defensive guard
 *      against accidentally passing something like `process.env` as the
 *      fields object (docs/SECURITY.md ENV-005: "Do not print the
 *      environment configuration object to logs").
 *
 * See docs/SECURITY.md Section 31 ("Logging and Redaction Rules") and
 * docs/ARCHITECTURE.md Section 34 for the allowed/forbidden field lists
 * this module is built around.
 */

/** JSON-safe scalar value. Deliberately excludes objects/arrays so a whole
 * object cannot be logged as a single field value without at least being a
 * primitive first (enforced at the type level, not just by convention). */
export type SafeLogValue = string | number | boolean | null | undefined;

export type SafeLogFields = Record<string, SafeLogValue>;

/** Placeholder written in place of any redacted value. */
export const REDACTED_PLACEHOLDER = "[REDACTED]";

/**
 * Refuse to log field sets larger than this. A legitimate structured log
 * line (see docs/SECURITY.md Section 31 allowed-fields list) has a small,
 * fixed number of fields; a field set this large is far more likely to be
 * an accidental `process.env` / whole-object dump than genuine structured
 * logging fields.
 */
export const MAX_LOG_FIELDS = 25;

/**
 * Name fragments that mark a field as sensitive, matched case-insensitively
 * against the field name with all non-alphanumeric characters stripped
 * (so `SUPABASE_SERVICE_ROLE_KEY`, `supabaseServiceRoleKey` and
 * `supabase-service-role-key` are all recognized as the same fragment).
 *
 * Includes the critical fields named in docs/SECURITY.md Section 31
 * ("Never Log"): SUPABASE_SERVICE_ROLE_KEY, RAZORPAY_KEY_SECRET,
 * RAZORPAY_WEBHOOK_SECRET, PAYCHAOS_ACCESS_TOKEN, PAYCHAOS_SESSION_SECRET,
 * CVV, OTP, and full auth/session cookies — plus generic "secret"/
 * "password" fragments so later-phase fields inherit the same protection
 * by naming convention without this module needing to know about them
 * individually.
 *
 * This module recognizes these field *names* now so later phases (Razorpay
 * adapter, session auth) inherit redaction automatically. Recognizing a
 * name here implements no Razorpay/session functionality itself.
 */
const SENSITIVE_KEY_FRAGMENTS: readonly string[] = [
  "supabaseservicerolekey",
  "razorpaykeysecret",
  "razorpaywebhooksecret",
  "paychaosaccesstoken",
  "paychaossessionsecret",
  "cvv",
  "otp",
  "cookie",
  "secret",
  "password",
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) =>
    normalized.includes(fragment),
  );
}

/**
 * Returns a copy of `fields` with every value whose key name matches a
 * known sensitive pattern replaced by `REDACTED_PLACEHOLDER`. Field names
 * that do not match any sensitive pattern are returned unchanged — this is
 * a targeted, key-driven redaction, not a blanket "redact everything".
 */
export function redactFields(fields: SafeLogFields): SafeLogFields {
  const redacted: Record<string, SafeLogValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    redacted[key] = isSensitiveKey(key) ? REDACTED_PLACEHOLDER : value;
  }
  return redacted;
}

export interface StructuredLogLine {
  readonly event: string;
  readonly timestamp: string;
  readonly fields: SafeLogFields;
}

/**
 * Writes one structured, redacted log line.
 *
 * `sink` defaults to `console.log` but is injectable so tests (and later
 * phases) can capture output deterministically instead of parsing stdout.
 *
 * Fails closed against accidental object dumps: throws if `fields` has
 * more than `MAX_LOG_FIELDS` entries rather than silently logging
 * something that is probably not a genuine structured field set.
 */
export function logEvent(
  event: string,
  fields: SafeLogFields = {},
  sink: (line: string) => void = (line) => console.log(line),
): void {
  const fieldCount = Object.keys(fields).length;
  if (fieldCount > MAX_LOG_FIELDS) {
    throw new Error(
      `Refusing to log ${fieldCount} fields for event "${event}": exceeds ` +
        `MAX_LOG_FIELDS (${MAX_LOG_FIELDS}). This looks like an accidental ` +
        `object or environment dump rather than structured logging fields.`,
    );
  }

  const line: StructuredLogLine = {
    event,
    timestamp: new Date().toISOString(),
    fields: redactFields(fields),
  };

  sink(JSON.stringify(line));
}
