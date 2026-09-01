import { describe, expect, it } from "vitest";
import {
  assertLegalPaymentStatusTransition,
  isLegalPaymentStatusTransition,
} from "@/lib/demo-merchant/transitions";
import { DemoMerchantDomainError } from "@/lib/demo-merchant/types";
import type { OrderPaymentStatus } from "@/lib/demo-merchant/types";

// Phase 1D: pure payment_status transition legality
// (docs/MONEY_INVARIANTS.md Sections 11-12). No Supabase/network.
//
// Phase 4E-R3-B: the legal set tracks INV-011/v2 — `UNPAID -> FAILED_OBSERVED`
// moved from illegal to legal (docs/MONEY_INVARIANTS.md Section 11.1) after
// genuine Razorpay Test Mode evidence proved the direct provider-failure
// transition. Everything else is unchanged, and the exhaustive 16-combination
// guard below still proves the set has no accidental ninth member.

describe("isLegalPaymentStatusTransition — legal transitions", () => {
  const legalPairs: Array<[OrderPaymentStatus, OrderPaymentStatus]> = [
    ["UNPAID", "PENDING"],
    // INV-011/v2: a verified `payment.failed` legitimately reaches an order
    // still recorded UNPAID, because opening Checkout does not move the ORDER
    // to PENDING.
    ["UNPAID", "FAILED_OBSERVED"],
    ["UNPAID", "PAID"],
    ["PENDING", "FAILED_OBSERVED"],
    ["PENDING", "PAID"],
    ["FAILED_OBSERVED", "PENDING"],
    ["FAILED_OBSERVED", "PAID"],
    ["PAID", "PAID"],
  ];

  it.each(legalPairs)("%s -> %s is legal", (from, to) => {
    expect(isLegalPaymentStatusTransition(from, to)).toBe(true);
    expect(() => assertLegalPaymentStatusTransition(from, to)).not.toThrow();
  });
});

describe("isLegalPaymentStatusTransition — illegal transitions", () => {
  const illegalPairs: Array<[OrderPaymentStatus, OrderPaymentStatus]> = [
    ["PAID", "UNPAID"],
    ["PAID", "PENDING"],
    ["PAID", "FAILED_OBSERVED"],
    // Additional arbitrary pairs proving this is a real allowlist, not just
    // the named illegal cases above.
    ["UNPAID", "UNPAID"],
    ["PENDING", "PENDING"],
    ["PENDING", "UNPAID"],
    ["FAILED_OBSERVED", "FAILED_OBSERVED"],
    ["FAILED_OBSERVED", "UNPAID"],
  ];

  it.each(illegalPairs)("%s -> %s is illegal", (from, to) => {
    expect(isLegalPaymentStatusTransition(from, to)).toBe(false);
    expect(() => assertLegalPaymentStatusTransition(from, to)).toThrow(
      DemoMerchantDomainError,
    );
  });
});

describe("the v2 legal set is exactly eight members", () => {
  it("all 16 combinations: exactly the eight INV-011/v2 transitions are legal, and no accidental ninth exists", () => {
    const statuses: OrderPaymentStatus[] = [
      "UNPAID",
      "PENDING",
      "FAILED_OBSERVED",
      "PAID",
    ];
    const legal: string[] = [];
    for (const from of statuses) {
      for (const to of statuses) {
        if (isLegalPaymentStatusTransition(from, to))
          legal.push(`${from}->${to}`);
      }
    }
    expect(legal.sort()).toEqual([
      "FAILED_OBSERVED->PAID",
      "FAILED_OBSERVED->PENDING",
      "PAID->PAID",
      "PENDING->FAILED_OBSERVED",
      "PENDING->PAID",
      "UNPAID->FAILED_OBSERVED",
      "UNPAID->PAID",
      "UNPAID->PENDING",
    ]);
    expect(legal).toHaveLength(8);
  });

  it("PAID monotonicity is untouched by v2: PAID's only legal successor is PAID", () => {
    for (const to of ["UNPAID", "PENDING", "FAILED_OBSERVED"] as const) {
      expect(isLegalPaymentStatusTransition("PAID", to)).toBe(false);
    }
    expect(isLegalPaymentStatusTransition("PAID", "PAID")).toBe(true);
  });

  it("v2 did NOT make FAILED_OBSERVED -> UNPAID legal in the opposite direction", () => {
    expect(isLegalPaymentStatusTransition("FAILED_OBSERVED", "UNPAID")).toBe(
      false,
    );
  });
});

describe("legality check is not payment authority", () => {
  it("isLegalPaymentStatusTransition is a pure status->boolean check: it takes no order/id/repository and returns only a boolean, never a mutation", () => {
    // The function signature itself proves the scope: it accepts two plain
    // status strings and returns a boolean. There is no order object, no
    // order id, no database handle and no return value representing a
    // written/mutated order anywhere in this call. A real order's
    // payment_status can only ever be legally set to PAID by a future
    // Phase 2 application service after independently verifying
    // authoritative Razorpay Test Mode evidence (docs/PROJECT_CONTEXT.md
    // Section 24) — this pure function never performs that write and never
    // could, since it has no access to any order record or persistence
    // layer.
    const result = isLegalPaymentStatusTransition("UNPAID", "PAID");

    expect(typeof result).toBe("boolean");
    expect(result).toBe(true);
  });

  it("calling the legality check repeatedly is side-effect free and idempotent", () => {
    // A true authority to mutate would not be safely callable many times
    // with no observable effect; a pure legality predicate is.
    for (let i = 0; i < 5; i++) {
      expect(isLegalPaymentStatusTransition("PENDING", "PAID")).toBe(true);
    }
  });
});
