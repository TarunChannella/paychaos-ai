/**
 * Phase 1D — Demo Merchant `payment_status` state-transition legality
 * (docs/MONEY_INVARIANTS.md Sections 11–12).
 *
 * Pure domain logic. No Supabase import, no `process.env` read, no network
 * call, no order object is read or written.
 *
 * ============================================================================
 * CRITICAL — LEGALITY CHECK ONLY. NOT PAYMENT AUTHORITY.
 * ============================================================================
 * `isLegalPaymentStatusTransition` / `assertLegalPaymentStatusTransition`
 * answer exactly one question: "is `from -> to` on the frozen allowlist?"
 * They take and return plain status strings/booleans — never an order id,
 * never a database handle, never a mutation.
 *
 * In particular, `UNPAID -> PAID`, `PENDING -> PAID` and
 * `FAILED_OBSERVED -> PAID` are modeled as *legal* transitions here because
 * they are legal once Phase 2 has verified Razorpay Test Mode payment
 * evidence. Phase 1D introduces NO workflow, route, Server Action, UI
 * control or "mark paid" method that can actually reach `PAID` in the real
 * database — no such code path exists in this phase. A future Phase 2
 * application service must independently verify authoritative Razorpay
 * evidence (docs/PROJECT_CONTEXT.md Section 24 / docs/ARCHITECTURE.md
 * Section 5.13) before it may call a write path that sets `payment_status =
 * PAID`; passing this pure legality check is necessary but never sufficient
 * authority to do so.
 * ============================================================================
 */

import { DemoMerchantDomainError, type OrderPaymentStatus } from "./types";

/**
 * The complete allowlist of legal `orders.payment_status` transitions
 * (docs/MONEY_INVARIANTS.md Section 11). Every pair not listed here is
 * illegal, including but not limited to the explicitly documented illegal
 * transitions in Section 12 (`PAID -> UNPAID`, `PAID -> PENDING`,
 * `PAID -> FAILED_OBSERVED`).
 *
 * `UNPAID -> FAILED_OBSERVED` is legal as of INV-011/v2 (Phase 4E-R3-B):
 * a verified `payment.failed` legitimately reaches an order that is still
 * `UNPAID`, because opening Checkout does not move the ORDER to `PENDING`.
 * This set is kept in step with the invariant engine's own Rule A set in
 * `lib/invariants/evaluator-utils.ts` — the two must never disagree about
 * which transitions are legal.
 *
 * Legality is still not authority: see the module notice above. Only
 * verified provider processing may actually write `FAILED_OBSERVED`.
 */
const LEGAL_PAYMENT_STATUS_TRANSITIONS: ReadonlySet<string> = new Set([
  "UNPAID->PENDING",
  "UNPAID->FAILED_OBSERVED",
  "UNPAID->PAID",
  "PENDING->FAILED_OBSERVED",
  "PENDING->PAID",
  "FAILED_OBSERVED->PENDING",
  "FAILED_OBSERVED->PAID",
  "PAID->PAID",
]);

function transitionKey(
  from: OrderPaymentStatus,
  to: OrderPaymentStatus,
): string {
  return `${from}->${to}`;
}

/**
 * Returns whether `from -> to` is on the frozen legal-transition allowlist.
 * A pure allowlist membership check — see the module-level authority notice
 * above.
 */
export function isLegalPaymentStatusTransition(
  from: OrderPaymentStatus,
  to: OrderPaymentStatus,
): boolean {
  return LEGAL_PAYMENT_STATUS_TRANSITIONS.has(transitionKey(from, to));
}

/**
 * Throws `DemoMerchantDomainError` when `from -> to` is not legal. Same
 * legality-only scope as `isLegalPaymentStatusTransition` — see the
 * module-level authority notice above.
 */
export function assertLegalPaymentStatusTransition(
  from: OrderPaymentStatus,
  to: OrderPaymentStatus,
): void {
  if (!isLegalPaymentStatusTransition(from, to)) {
    throw new DemoMerchantDomainError(
      "ILLEGAL_PAYMENT_STATUS_TRANSITION",
      `Illegal payment_status transition: ${from} -> ${to}.`,
    );
  }
}
