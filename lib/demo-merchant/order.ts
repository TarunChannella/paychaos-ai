/**
 * Phase 1D — Demo Merchant order creation, amount/currency validation, and
 * order-term immutability (ORD-001).
 *
 * Pure domain logic. No Supabase import, no `process.env` read, no network
 * call. Every function here is deterministic and side-effect free.
 */

import {
  DemoMerchantDomainError,
  type MerchantOrder,
  type MerchantOrderAmount,
} from "./types";

/**
 * Matches `orders.currency` / `payment_attempts.currency`'s database CHECK
 * constraint exactly (`currency ~ '^[A-Z]{3}$'` —
 * `supabase/migrations/20260823000000_phase1_foundation_schema.sql`).
 *
 * Deliberately not normalized/lowercased: a malformed or lowercase value is
 * rejected, never silently coerced, so authoritative validation can never
 * diverge from what the database will actually accept.
 */
const CURRENCY_FORMAT = /^[A-Z]{3}$/;

/** P0 default currency (docs/DATABASE.md Section 8.4). Not the only supported currency — see `validateCurrency`. */
export const DEFAULT_ORDER_CURRENCY = "INR";

/**
 * Validates `amount_subunits`: must be an integer (never a float — Section
 * 8.3 / MONEY_INVARIANTS.md Principle 7) and strictly greater than zero
 * (docs/DATABASE.md Section 9 `orders_amount_subunits_positive`).
 */
export function validateAmountSubunits(amountSubunits: number): number {
  if (typeof amountSubunits !== "number" || !Number.isFinite(amountSubunits)) {
    throw new DemoMerchantDomainError(
      "INVALID_AMOUNT_SUBUNITS",
      "amount_subunits must be a finite number.",
    );
  }
  if (!Number.isInteger(amountSubunits)) {
    throw new DemoMerchantDomainError(
      "INVALID_AMOUNT_SUBUNITS",
      "amount_subunits must be an integer number of smallest-currency subunits; fractional/floating-point amounts are rejected.",
    );
  }
  if (amountSubunits <= 0) {
    throw new DemoMerchantDomainError(
      "INVALID_AMOUNT_SUBUNITS",
      "amount_subunits must be a positive integer greater than zero.",
    );
  }
  return amountSubunits;
}

/**
 * Validates `currency` against the same uppercase-3-letter shape the
 * database CHECK constraint enforces. Malformed or lowercase input is
 * rejected outright — never silently normalized (e.g. `"inr"` is NOT
 * coerced to `"INR"`), per docs/DATABASE.md Section 8.4 and the frozen
 * `orders_currency_format` constraint.
 */
export function validateCurrency(currency: string): string {
  if (typeof currency !== "string" || !CURRENCY_FORMAT.test(currency)) {
    throw new DemoMerchantDomainError(
      "INVALID_CURRENCY",
      'currency must be an uppercase 3-letter code matching ^[A-Z]{3}$ (e.g. "INR"); malformed or lowercase values are rejected, not normalized.',
    );
  }
  return currency;
}

/** Validates both order-term fields together and returns them unchanged. */
export function validateOrderAmount(
  input: MerchantOrderAmount,
): MerchantOrderAmount {
  return {
    amountSubunits: validateAmountSubunits(input.amountSubunits),
    currency: validateCurrency(input.currency),
  };
}

/**
 * Builds the initial state of a newly created Demo Merchant order
 * (docs/MONEY_INVARIANTS.md Section 8 `CREATED` row): `payment_status =
 * UNPAID`, `business_status = OPEN`, `fulfilmentCount = 0`.
 *
 * No Phase 1 order may initially be `PAID` or `FULFILLED` — this factory
 * cannot produce either, by construction.
 */
export function createInitialMerchantOrder(
  input: MerchantOrderAmount,
): MerchantOrder {
  const validated = validateOrderAmount(input);
  return {
    ...validated,
    paymentStatus: "UNPAID",
    businessStatus: "OPEN",
    fulfilmentCount: 0,
  };
}

/**
 * ORD-001 (docs/DATABASE.md Section 9 "Important Rules"):
 * `amount_subunits`/`currency` become immutable once a `payment_attempts`
 * row exists for the order.
 *
 * Pure domain rule only — this performs no database read/write. The caller
 * (a future Phase 1E/2 application service) is responsible for supplying
 * the real, authoritative `paymentAttemptCount` from the repository layer
 * before trusting this check.
 *
 * Throws when the count is not a valid non-negative integer, or when the
 * count is `> 0` (an attempt already exists, so the terms are frozen).
 */
export function assertOrderTermsMutable(paymentAttemptCount: number): void {
  if (
    typeof paymentAttemptCount !== "number" ||
    !Number.isInteger(paymentAttemptCount) ||
    paymentAttemptCount < 0
  ) {
    throw new DemoMerchantDomainError(
      "INVALID_PAYMENT_ATTEMPT_COUNT",
      "paymentAttemptCount must be a non-negative integer.",
    );
  }
  if (paymentAttemptCount > 0) {
    throw new DemoMerchantDomainError(
      "ORD_001_TERMS_IMMUTABLE",
      "amount_subunits/currency are immutable once a payment_attempt exists for this order (ORD-001).",
    );
  }
}

/**
 * Validates a proposed change to `amount_subunits`/`currency` and enforces
 * ORD-001 in one call: the new terms must themselves be valid, AND no
 * payment attempt may yet exist. Returns the validated terms on success.
 */
export function validateOrderTermsChange(
  input: MerchantOrderAmount,
  paymentAttemptCount: number,
): MerchantOrderAmount {
  assertOrderTermsMutable(paymentAttemptCount);
  return validateOrderAmount(input);
}

/**
 * PAYATT-001 / PAYATT-002 (docs/DATABASE.md Section 10 "Important Rules"):
 * a `payment_attempts` row's amount/currency must initially match its
 * parent order's amount/currency, and must not later be silently changed.
 *
 * This is a small, pure freeze of the PAYATT-001 comparison for Phase 2's
 * future use. Phase 1D does not implement attempt creation/lifecycle —
 * see the Phase 1D task boundary.
 */
export function assertPaymentAttemptMatchesOrderTerms(
  order: MerchantOrderAmount,
  attempt: MerchantOrderAmount,
): void {
  if (order.amountSubunits !== attempt.amountSubunits) {
    throw new DemoMerchantDomainError(
      "PAYATT_001_AMOUNT_MISMATCH",
      "payment_attempts.amount_subunits must match orders.amount_subunits (PAYATT-001).",
    );
  }
  if (order.currency !== attempt.currency) {
    throw new DemoMerchantDomainError(
      "PAYATT_001_CURRENCY_MISMATCH",
      "payment_attempts.currency must match orders.currency (PAYATT-001).",
    );
  }
}
