import { describe, expect, it } from "vitest";
import { createInitialMerchantOrder } from "@/lib/demo-merchant/order";
import { projectConceptualOrderState } from "@/lib/demo-merchant/projection";
import { DemoMerchantDomainError } from "@/lib/demo-merchant/types";

// Phase 1D: deterministic composite-state projection
// (docs/MONEY_INVARIANTS.md Section 8). No Supabase/network.

describe("projectConceptualOrderState — valid composite states", () => {
  it("UNPAID/OPEN -> CREATED", () => {
    expect(
      projectConceptualOrderState({
        paymentStatus: "UNPAID",
        businessStatus: "OPEN",
        fulfilmentCount: 0,
      }),
    ).toBe("CREATED");
  });

  it("PENDING/OPEN -> PAYMENT_PENDING", () => {
    expect(
      projectConceptualOrderState({
        paymentStatus: "PENDING",
        businessStatus: "OPEN",
        fulfilmentCount: 0,
      }),
    ).toBe("PAYMENT_PENDING");
  });

  it("FAILED_OBSERVED/OPEN -> PAYMENT_FAILED", () => {
    expect(
      projectConceptualOrderState({
        paymentStatus: "FAILED_OBSERVED",
        businessStatus: "OPEN",
        fulfilmentCount: 0,
      }),
    ).toBe("PAYMENT_FAILED");
  });

  it("PAID/OPEN -> PAID", () => {
    expect(
      projectConceptualOrderState({
        paymentStatus: "PAID",
        businessStatus: "OPEN",
        fulfilmentCount: 0,
      }),
    ).toBe("PAID");
  });

  it("PAID/FULFILLED with a valid fulfilment count -> FULFILLED", () => {
    expect(
      projectConceptualOrderState({
        paymentStatus: "PAID",
        businessStatus: "FULFILLED",
        fulfilmentCount: 1,
      }),
    ).toBe("FULFILLED");
  });
});

describe("projectConceptualOrderState — impossible/invalid combinations rejected", () => {
  it("rejects FULFILLED with a non-PAID payment state", () => {
    expect(() =>
      projectConceptualOrderState({
        paymentStatus: "UNPAID",
        businessStatus: "FULFILLED",
        fulfilmentCount: 1,
      }),
    ).toThrow(DemoMerchantDomainError);

    expect(() =>
      projectConceptualOrderState({
        paymentStatus: "PENDING",
        businessStatus: "FULFILLED",
        fulfilmentCount: 1,
      }),
    ).toThrow(DemoMerchantDomainError);

    expect(() =>
      projectConceptualOrderState({
        paymentStatus: "FAILED_OBSERVED",
        businessStatus: "FULFILLED",
        fulfilmentCount: 1,
      }),
    ).toThrow(DemoMerchantDomainError);
  });

  it("rejects FULFILLED with a fulfilment count of 0", () => {
    expect(() =>
      projectConceptualOrderState({
        paymentStatus: "PAID",
        businessStatus: "FULFILLED",
        fulfilmentCount: 0,
      }),
    ).toThrow(DemoMerchantDomainError);
  });

  it("rejects a negative fulfilmentCount regardless of other fields", () => {
    expect(() =>
      projectConceptualOrderState({
        paymentStatus: "UNPAID",
        businessStatus: "OPEN",
        fulfilmentCount: -1,
      }),
    ).toThrow(DemoMerchantDomainError);
  });

  it("rejects a non-integer fulfilmentCount", () => {
    expect(() =>
      projectConceptualOrderState({
        paymentStatus: "UNPAID",
        businessStatus: "OPEN",
        fulfilmentCount: 1.5,
      }),
    ).toThrow(DemoMerchantDomainError);
  });
});

describe("Phase 1 initial state never projects PAID/FULFILLED", () => {
  it("a freshly created merchant order always projects to CREATED", () => {
    const order = createInitialMerchantOrder({
      amountSubunits: 100000,
      currency: "INR",
    });

    const conceptualState = projectConceptualOrderState(order);

    expect(conceptualState).toBe("CREATED");
    expect(conceptualState).not.toBe("PAID");
    expect(conceptualState).not.toBe("FULFILLED");
  });
});
