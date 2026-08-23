/**
 * Phase 1D — Demo Merchant domain types.
 *
 * Pure TypeScript domain layer. This module performs no I/O: it never
 * imports the Supabase client (`@/lib/supabase/server` or `@/lib/supabase/client`)
 * and never reads `process.env`. It only describes the shape of a Demo
 * Merchant order and the deterministic errors its domain rules can raise.
 *
 * Status unions are re-exported from `@/lib/supabase/types` (the approved
 * Phase 1C `Database` type) rather than redefined here, so there is exactly
 * one source of truth for the string literal unions that also constrain the
 * `orders`/`payment_attempts` columns at the database layer
 * (docs/DATABASE.md Sections 9–10, `supabase/migrations/20260823000000_phase1_foundation_schema.sql`).
 */

import type {
  OrderBusinessStatus,
  OrderPaymentStatus,
  PaymentAttemptStatus,
} from "@/lib/supabase/types";

export type { OrderBusinessStatus, OrderPaymentStatus, PaymentAttemptStatus };

/**
 * Deterministic domain error for Demo Merchant domain-rule violations
 * (invalid amount/currency, illegal state transition, immutability
 * violation, impossible composite state, etc).
 *
 * Follows the same shape as `EnvValidationError`
 * (`lib/config/env-validation.ts`): a stable machine-readable `code` plus a
 * clean, deterministic human-readable message. Messages never contain
 * secrets — there are none in this domain — and are otherwise safe to log.
 */
export class DemoMerchantDomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DemoMerchantDomainError";
    this.code = code;
  }
}

/**
 * The human-readable composite state PayChaos projects from
 * (`payment_status`, `business_status`, fulfilment count) — docs/MONEY_INVARIANTS.md
 * Section 8.
 *
 * `FULFILLED` is included here as a legal projection target, but Phase 1
 * never produces the underlying data (`business_status = 'FULFILLED'`) that
 * would cause `projectConceptualOrderState` to return it — see
 * `lib/demo-merchant/projection.ts` and the Phase 1 fulfilment-safety notes
 * there.
 */
export type ConceptualOrderState =
  "CREATED" | "PAYMENT_PENDING" | "PAYMENT_FAILED" | "PAID" | "FULFILLED";

/** The two order-term fields ORD-001 governs (docs/DATABASE.md Section 9). */
export interface MerchantOrderAmount {
  /** Integer smallest-currency subunits. Never a float. Must be `> 0`. */
  amountSubunits: number;
  /** Uppercase 3-letter currency code, e.g. `"INR"`. */
  currency: string;
}

/** The two independent state axes plus fulfilment count (docs/MONEY_INVARIANTS.md Section 7). */
export interface MerchantOrderState {
  paymentStatus: OrderPaymentStatus;
  businessStatus: OrderBusinessStatus;
  /**
   * Non-negative integer count of recorded `fulfilments` rows for this
   * order. Always `0` for every order Phase 1 can produce — Phase 1 must
   * not insert into `fulfilments` (docs/DATABASE.md Section 12).
   */
  fulfilmentCount: number;
}

/** A complete Demo Merchant order as the domain layer reasons about it. */
export interface MerchantOrder
  extends MerchantOrderAmount, MerchantOrderState {}
