/**
 * Phase 2D — allowlist-based safe evidence projection for a verified
 * Razorpay webhook payload.
 *
 * Deliberately an ALLOWLIST, not a blacklist (this task's Section 13,
 * docs/RAZORPAY_GUIDE.md Section 28): only a fixed, explicitly-named set
 * of fields is ever copied out of the incoming payload. Everything else —
 * including fields this module has never heard of — is silently dropped.
 * This is safe by construction: a payload shape this module does not
 * recognize simply yields less evidence, never more, and email/contact/
 * phone/VPA/card/bank/notes/tokens/method/webhook-signature can never leak
 * through no matter how Razorpay's payload evolves, because none of those
 * field names ever appear in the allowlists below.
 *
 * No domain/event-type interpretation happens here — that is Phase 2E's
 * normalization layer. This module only decides what is SAFE to keep, not
 * what it MEANS.
 *
 * Pure function: no I/O, no Supabase, no `server-only` marker needed (it
 * touches no secret and no network).
 */

const SAFE_PAYMENT_ENTITY_FIELDS = [
  "id",
  "order_id",
  "amount",
  "currency",
  "status",
  "error_code",
  "error_source",
  "error_step",
  "error_reason",
] as const;

const SAFE_ORDER_ENTITY_FIELDS = [
  "id",
  "amount",
  "currency",
  "status",
] as const;

/** Only JSON-primitive values are ever copied — never a nested object/array, which could smuggle an unreviewed field through. */
function isSafeScalar(
  value: unknown,
): value is string | number | boolean | null {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractAllowlistedScalars(
  source: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (!isPlainObject(source)) return {};

  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const value = source[field];
    if (isSafeScalar(value)) {
      result[field] = value;
    }
  }
  return result;
}

/**
 * Builds the safe, redacted evidence object persisted as
 * `webhook_events.raw_payload_redacted`.
 *
 * `parsedPayload` is the already-JSON-parsed webhook body (parsing must
 * only happen AFTER signature verification succeeds — enforced by the
 * caller, `lib/webhooks/service.ts`, not by this pure function).
 *
 * Extracts, only if present and of the expected shape:
 *   - top-level `event` (e.g. "payment.captured");
 *   - top-level `entity` (Razorpay's envelope type, typically "event");
 *   - top-level `created_at` (raw provider Unix timestamp, if a number);
 *   - from `payload.payment.entity`: id, order_id, amount, currency,
 *     status, error_code, error_source, error_step, error_reason;
 *   - from `payload.order.entity`: id, amount, currency, status.
 *
 * Never extracts: email, contact/phone, VPA/UPI identity, card/instrument
 * details, bank account data, notes, tokens, payment method, or any
 * signature/secret — none of those field names ever appear in the
 * allowlists above, so they cannot be copied through regardless of what
 * the real payload contains.
 */
export function buildRedactedWebhookEvidence(
  parsedPayload: unknown,
): Record<string, unknown> {
  if (!isPlainObject(parsedPayload)) return {};

  const evidence: Record<string, unknown> = {};

  if (typeof parsedPayload.event === "string") {
    evidence.event = parsedPayload.event;
  }
  if (typeof parsedPayload.entity === "string") {
    evidence.entity = parsedPayload.entity;
  }
  if (typeof parsedPayload.created_at === "number") {
    evidence.created_at = parsedPayload.created_at;
  }

  const payload = isPlainObject(parsedPayload.payload)
    ? parsedPayload.payload
    : {};

  const paymentEntity = isPlainObject(payload.payment)
    ? payload.payment.entity
    : undefined;
  const safePayment = extractAllowlistedScalars(
    paymentEntity,
    SAFE_PAYMENT_ENTITY_FIELDS,
  );
  if (Object.keys(safePayment).length > 0) {
    evidence.payment = safePayment;
  }

  const orderEntity = isPlainObject(payload.order)
    ? payload.order.entity
    : undefined;
  const safeOrder = extractAllowlistedScalars(
    orderEntity,
    SAFE_ORDER_ENTITY_FIELDS,
  );
  if (Object.keys(safeOrder).length > 0) {
    evidence.order = safeOrder;
  }

  return evidence;
}

/**
 * Extracts a safe `provider_created_at` ISO timestamp from the payload's
 * top-level `created_at` (a Unix timestamp in seconds, per Razorpay's
 * envelope), or `null` if absent/invalid. Kept separate from
 * `buildRedactedWebhookEvidence` because this value is also persisted as
 * its own typed database column (`webhook_events.provider_created_at`),
 * not only inside the redacted JSON blob.
 */
export function extractProviderCreatedAt(
  parsedPayload: unknown,
): string | null {
  if (!isPlainObject(parsedPayload)) return null;

  const value = parsedPayload.created_at;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString();
}
