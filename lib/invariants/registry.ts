import "server-only";

import {
  MONEY_INVARIANT_IDS,
  type MoneyInvariantDefinition,
  type MoneyInvariantId,
} from "./types";

/**
 * Phase 3F-A — the frozen P0 Money Invariant catalogue.
 *
 * Contains EXACTLY the twelve P0 invariants INV-001…INV-012
 * (docs/MONEY_INVARIANTS.md Section 14). Every field below is transcribed
 * from that document — each invariant's Section 2 (Name), Section 3
 * (Priority), Section 6 (Entities / Data Required), Section 11 (Severity)
 * and Section 14 (Recommended Remediation). This module invents nothing.
 *
 * P1 invariants INV-013 and INV-014 are deliberately absent, and cannot be
 * added without widening `MoneyInvariantId` first.
 *
 * THIS MODULE CONTAINS NO EVALUATOR. It performs no I/O: no Supabase, no
 * database table, no Razorpay, no network, no LLM, no filesystem, no clock,
 * no randomness. It never decides PASS/FAIL/UNKNOWN for anything and never
 * inspects evidence. Deterministic evaluation is Phase 3F-B; orchestration
 * and persistence are Phase 3F-C. There are deliberately no placeholder
 * evaluator functions here — a stub returning `PASS` would be a fabricated
 * money verdict, which docs/MONEY_INVARIANTS.md Section 3 Principle 3 ("Fail
 * Safely") and CLAUDE.md Section 25 ("No fake metrics") both forbid.
 *
 * `import "server-only"` matches `lib/chaos/registry.ts`: the browser must
 * never become the authority for the invariant catalogue. A future UI may
 * receive a safe, server-generated projection of this metadata.
 *
 * RELATIONSHIP TO THE FROZEN CHAOS REGISTRY. `lib/chaos/registry.ts` maps
 * each of the four P0 scenarios to the invariants it requires:
 *
 *   C01 -> INV-001, INV-002, INV-006, INV-007
 *   C03 -> INV-004, INV-005
 *   C07 -> INV-002, INV-004, INV-011
 *   C11 -> INV-003, INV-004, INV-011
 *
 * That mapping is frozen and is NOT duplicated here — this catalogue
 * describes invariants, not scenarios. `tests/unit/invariants/registry.test.ts`
 * proves every invariant ID the frozen chaos registry references is a member
 * of this catalogue, without either file importing the other's data.
 *
 * SEVERITY VOCABULARY. docs/MONEY_INVARIANTS.md writes severities in prose
 * as "Critical"/"High". The values below are the upper-case
 * `invariant_results.severity` vocabulary the database CHECK accepts
 * (docs/DATABASE.md Section 16), which is the same severity in the persisted
 * spelling — not a different judgement.
 */

const CATALOGUE: Readonly<Record<MoneyInvariantId, MoneyInvariantDefinition>> =
  Object.freeze({
    "INV-001": Object.freeze({
      invariantId: "INV-001",
      version: "1",
      name: "Unique Webhook Protected Logic Once",
      priority: "P0",
      defaultSeverity: "CRITICAL",
      description:
        "A unique webhook event must not execute protected business logic more than once, however many times it is delivered or reprocessed.",
      requiredEvidence: Object.freeze([
        "WEBHOOK_EVENT",
        "EVENT_PROCESSING_ATTEMPT",
        "FULFILMENT",
        "ORDER",
      ] as const),
      remediationCategories: Object.freeze([
        "FIX-IDEMPOTENCY",
        "FIX-BUSINESS-IDEMPOTENCY",
      ] as const),
      evaluatorKey: "INV-001/v1",
    }),

    "INV-002": Object.freeze({
      invariantId: "INV-002",
      version: "1",
      name: "One Captured Payment, At Most One Fulfilment",
      priority: "P0",
      defaultSeverity: "CRITICAL",
      description:
        "One successful/captured payment must produce at most one fulfilment record.",
      requiredEvidence: Object.freeze([
        "PAYMENT",
        "PAYMENT_ATTEMPT",
        "ORDER",
        "FULFILMENT",
      ] as const),
      remediationCategories: Object.freeze([
        "FIX-BUSINESS-IDEMPOTENCY",
      ] as const),
      evaluatorKey: "INV-002/v1",
    }),

    "INV-003": Object.freeze({
      invariantId: "INV-003",
      version: "1",
      name: "Failed Payment Never Marks Order Paid",
      priority: "P0",
      defaultSeverity: "CRITICAL",
      description:
        "A failed payment must never move an order into a paid state.",
      requiredEvidence: Object.freeze([
        "PAYMENT",
        "PAYMENT_ATTEMPT",
        "ORDER",
        "WEBHOOK_EVENT",
      ] as const),
      remediationCategories: Object.freeze([
        "FIX-PAYMENT-FAILURE-GUARD",
        "FIX-STATE-MACHINE",
      ] as const),
      evaluatorKey: "INV-003/v1",
    }),

    "INV-004": Object.freeze({
      invariantId: "INV-004",
      version: "1",
      name: "Fulfilment Requires Verified Successful Payment",
      priority: "P0",
      defaultSeverity: "CRITICAL",
      description:
        "An order must not be fulfilled without authoritative, server-verified evidence of a successful payment.",
      requiredEvidence: Object.freeze([
        "FULFILMENT",
        "PAYMENT",
        "PAYMENT_ATTEMPT",
        "ORDER",
        "WEBHOOK_EVENT",
      ] as const),
      remediationCategories: Object.freeze([
        "FIX-PAYMENT-FAILURE-GUARD",
        "FIX-WEBHOOK-AUTH",
        "FIX-STATE-MACHINE",
      ] as const),
      evaluatorKey: "INV-004/v1",
    }),

    "INV-005": Object.freeze({
      invariantId: "INV-005",
      version: "1",
      name: "Invalid Webhook Signature Causes Zero Mutation",
      priority: "P0",
      defaultSeverity: "CRITICAL",
      description:
        "A webhook whose signature does not verify must produce zero business-state mutation.",
      requiredEvidence: Object.freeze([
        "ORDER",
        "PAYMENT_ATTEMPT",
        "PAYMENT",
        "FULFILMENT",
        "WEBHOOK_EVENT",
        "CHAOS_RUN",
      ] as const),
      remediationCategories: Object.freeze(["FIX-WEBHOOK-AUTH"] as const),
      evaluatorKey: "INV-005/v1",
    }),

    "INV-006": Object.freeze({
      invariantId: "INV-006",
      version: "1",
      name: "Processed Event Replay Preserves Final Business State",
      priority: "P0",
      defaultSeverity: "CRITICAL",
      description:
        "Replaying an already-processed event must not change the correct final business state.",
      requiredEvidence: Object.freeze([
        "WEBHOOK_EVENT",
        "EVENT_PROCESSING_ATTEMPT",
        "ORDER",
        "PAYMENT",
        "FULFILMENT",
        "CHAOS_RUN",
      ] as const),
      remediationCategories: Object.freeze([
        "FIX-IDEMPOTENCY",
        "FIX-STATE-MACHINE",
      ] as const),
      evaluatorKey: "INV-006/v1",
    }),

    "INV-007": Object.freeze({
      invariantId: "INV-007",
      version: "1",
      name: "Duplicate Delivery Creates No Duplicate Business Record",
      priority: "P0",
      defaultSeverity: "CRITICAL",
      description:
        "Duplicate delivery of the same webhook must not create duplicate durable business records; in P0 the protected record is primarily the fulfilment.",
      requiredEvidence: Object.freeze([
        "FULFILMENT",
        "WEBHOOK_EVENT",
        "EVENT_PROCESSING_ATTEMPT",
        "ORDER",
        "PAYMENT",
      ] as const),
      remediationCategories: Object.freeze([
        "FIX-BUSINESS-IDEMPOTENCY",
      ] as const),
      evaluatorKey: "INV-007/v1",
    }),

    "INV-008": Object.freeze({
      invariantId: "INV-008",
      version: "1",
      name: "Order / Attempt / Payment Amount and Currency Consistency",
      priority: "P0",
      defaultSeverity: "CRITICAL",
      description:
        "Order, payment-attempt and verified payment amounts must stay consistent, compared as integer smallest currency units alongside their currency — never as floating-point values.",
      requiredEvidence: Object.freeze([
        "ORDER",
        "PAYMENT_ATTEMPT",
        "PAYMENT",
        "WEBHOOK_EVENT",
      ] as const),
      remediationCategories: Object.freeze(["FIX-STATE-MACHINE"] as const),
      evaluatorKey: "INV-008/v1",
    }),

    "INV-009": Object.freeze({
      invariantId: "INV-009",
      version: "1",
      name: "Failed Processing Is Atomic or Safely Retryable",
      priority: "P0",
      defaultSeverity: "CRITICAL",
      description:
        "Failed or partial webhook processing must not leave an impossible money/order state; it must be atomic or safely retryable.",
      requiredEvidence: Object.freeze([
        "EVENT_PROCESSING_ATTEMPT",
        "WEBHOOK_EVENT",
        "ORDER",
        "PAYMENT",
        "FULFILMENT",
        "CHAOS_RUN",
      ] as const),
      remediationCategories: Object.freeze([
        "FIX-TRANSACTION-ATOMICITY",
        "FIX-RETRY-HANDLING",
      ] as const),
      evaluatorKey: "INV-009/v1",
    }),

    "INV-010": Object.freeze({
      invariantId: "INV-010",
      version: "1",
      name: "Fulfilment Has Exactly One Valid Payment Path",
      priority: "P0",
      defaultSeverity: "CRITICAL",
      description:
        "A completed fulfilment must remain linked to exactly one valid successful payment/order path.",
      requiredEvidence: Object.freeze([
        "FULFILMENT",
        "PAYMENT",
        "PAYMENT_ATTEMPT",
        "ORDER",
        "WEBHOOK_EVENT",
      ] as const),
      remediationCategories: Object.freeze([
        "FIX-TRANSACTION-ATOMICITY",
        "FIX-STATE-MACHINE",
      ] as const),
      evaluatorKey: "INV-010/v1",
    }),

    "INV-011": Object.freeze({
      invariantId: "INV-011",
      // v2 (Phase 4E-R3-B). The deterministic meaning of Rule A changed:
      // `UNPAID -> FAILED_OBSERVED` became legal after genuine Razorpay Test
      // Mode evidence proved the direct provider-failure transition the
      // frozen Phase 2F processing path actually produces
      // (docs/MONEY_INVARIANTS.md §11, §26 §8 Rule A, §48). Historical
      // INV-011/v1 results stay exactly as persisted and remain
      // distinguishable by their stored `invariant_version`.
      version: "2",
      name: "Payment State Is Legal, Monotonic and Convergent",
      priority: "P0",
      defaultSeverity: "CRITICAL",
      description:
        "Payment state transitions must be legal and monotonic, and must converge to verified provider truth rather than to client-reported state.",
      requiredEvidence: Object.freeze([
        "ORDER",
        "PAYMENT_ATTEMPT",
        "PAYMENT",
        "WEBHOOK_EVENT",
        "EVENT_PROCESSING_ATTEMPT",
      ] as const),
      remediationCategories: Object.freeze([
        "FIX-STATE-MACHINE",
        "FIX-RECONCILIATION",
        "FIX-CLIENT-INDEPENDENCE",
      ] as const),
      evaluatorKey: "INV-011/v2",
    }),

    "INV-012": Object.freeze({
      invariantId: "INV-012",
      version: "1",
      // The one non-CRITICAL entry — docs/MONEY_INVARIANTS.md Section 27
      // Section 11 records this invariant's severity as High, not Critical.
      name: "Unsupported Event Causes No Business Effect",
      priority: "P0",
      defaultSeverity: "HIGH",
      description:
        "An unknown or unsupported webhook event type must produce zero business effect.",
      requiredEvidence: Object.freeze([
        "ORDER",
        "PAYMENT",
        "FULFILMENT",
        "EVENT_PROCESSING_ATTEMPT",
        "WEBHOOK_EVENT",
      ] as const),
      remediationCategories: Object.freeze([
        "FIX-UNSUPPORTED-EVENT-GUARD",
      ] as const),
      evaluatorKey: "INV-012/v1",
    }),
  } as const);

/** The frozen, ordered list of every catalogued P0 invariant ID. */
export const P0_INVARIANT_IDS: readonly MoneyInvariantId[] =
  MONEY_INVARIANT_IDS;

/**
 * Looks up one invariant's frozen catalogue entry, or `undefined` if
 * `invariantId` is not catalogued. Never guesses and never normalizes a
 * near-miss ID.
 */
export function getInvariantDefinition(
  invariantId: MoneyInvariantId,
): MoneyInvariantDefinition | undefined {
  return CATALOGUE[invariantId];
}

/** Returns every catalogued invariant definition, in `P0_INVARIANT_IDS` order. */
export function listInvariantDefinitions(): readonly MoneyInvariantDefinition[] {
  return P0_INVARIANT_IDS.map((id) => CATALOGUE[id]);
}
