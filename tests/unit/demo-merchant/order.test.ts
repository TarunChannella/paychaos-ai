import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORDER_CURRENCY,
  assertOrderTermsMutable,
  assertPaymentAttemptMatchesOrderTerms,
  createInitialMerchantOrder,
  validateAmountSubunits,
  validateCurrency,
  validateOrderTermsChange,
} from "@/lib/demo-merchant/order";
import { DemoMerchantDomainError } from "@/lib/demo-merchant/types";

// Phase 1D: pure domain validation for Demo Merchant order amount/currency
// and ORD-001 immutability. No Supabase/network — fully offline.

describe("validateAmountSubunits", () => {
  it("accepts a positive integer amount", () => {
    expect(validateAmountSubunits(50000)).toBe(50000);
  });

  it("rejects zero", () => {
    expect(() => validateAmountSubunits(0)).toThrow(DemoMerchantDomainError);
  });

  it("rejects a negative amount", () => {
    expect(() => validateAmountSubunits(-100)).toThrow(DemoMerchantDomainError);
  });

  it("rejects a fractional amount", () => {
    expect(() => validateAmountSubunits(100.5)).toThrow(
      DemoMerchantDomainError,
    );
  });

  it("rejects a non-finite amount", () => {
    expect(() => validateAmountSubunits(Number.POSITIVE_INFINITY)).toThrow(
      DemoMerchantDomainError,
    );
  });
});

describe("validateCurrency", () => {
  it("accepts a valid uppercase 3-letter INR code", () => {
    expect(validateCurrency("INR")).toBe("INR");
  });

  it("accepts another valid uppercase 3-letter code (matches DB check ^[A-Z]{3}$)", () => {
    expect(validateCurrency("USD")).toBe("USD");
  });

  it("rejects a lowercase currency code and does not normalize it", () => {
    expect(() => validateCurrency("inr")).toThrow(DemoMerchantDomainError);
  });

  it("rejects a malformed currency code (wrong length)", () => {
    expect(() => validateCurrency("INRX")).toThrow(DemoMerchantDomainError);
    expect(() => validateCurrency("IN")).toThrow(DemoMerchantDomainError);
  });

  it("rejects a malformed currency code (non-letters)", () => {
    expect(() => validateCurrency("IN1")).toThrow(DemoMerchantDomainError);
  });

  it("DEFAULT_ORDER_CURRENCY is a valid currency", () => {
    expect(validateCurrency(DEFAULT_ORDER_CURRENCY)).toBe(
      DEFAULT_ORDER_CURRENCY,
    );
  });
});

describe("createInitialMerchantOrder", () => {
  it("produces UNPAID/OPEN/fulfilmentCount=0 for a valid input", () => {
    const order = createInitialMerchantOrder({
      amountSubunits: 100000,
      currency: "INR",
    });

    expect(order).toEqual({
      amountSubunits: 100000,
      currency: "INR",
      paymentStatus: "UNPAID",
      businessStatus: "OPEN",
      fulfilmentCount: 0,
    });
  });

  it("rejects invalid amount at creation time", () => {
    expect(() =>
      createInitialMerchantOrder({ amountSubunits: 0, currency: "INR" }),
    ).toThrow(DemoMerchantDomainError);
  });

  it("rejects invalid currency at creation time", () => {
    expect(() =>
      createInitialMerchantOrder({ amountSubunits: 100, currency: "inr" }),
    ).toThrow(DemoMerchantDomainError);
  });
});

describe("ORD-001 order-term immutability", () => {
  it("assertOrderTermsMutable allows a change when no attempt exists (count = 0)", () => {
    expect(() => assertOrderTermsMutable(0)).not.toThrow();
  });

  it("assertOrderTermsMutable rejects a change when an attempt already exists (count > 0)", () => {
    expect(() => assertOrderTermsMutable(1)).toThrow(DemoMerchantDomainError);
    expect(() => assertOrderTermsMutable(3)).toThrow(DemoMerchantDomainError);
  });

  it("assertOrderTermsMutable rejects a negative attempt count as invalid input", () => {
    expect(() => assertOrderTermsMutable(-1)).toThrow(DemoMerchantDomainError);
  });

  it("validateOrderTermsChange accepts a valid change before any attempt exists", () => {
    expect(
      validateOrderTermsChange({ amountSubunits: 20000, currency: "INR" }, 0),
    ).toEqual({ amountSubunits: 20000, currency: "INR" });
  });

  it("validateOrderTermsChange rejects an amount change once an attempt exists", () => {
    expect(() =>
      validateOrderTermsChange({ amountSubunits: 20000, currency: "INR" }, 1),
    ).toThrow(DemoMerchantDomainError);
  });

  it("validateOrderTermsChange rejects a currency change once an attempt exists", () => {
    expect(() =>
      validateOrderTermsChange({ amountSubunits: 10000, currency: "USD" }, 1),
    ).toThrow(DemoMerchantDomainError);
  });
});

describe("PAYATT-001 / PAYATT-002 order/attempt amount+currency consistency", () => {
  const order = { amountSubunits: 50000, currency: "INR" };

  it("accepts an exact amount/currency match", () => {
    expect(() =>
      assertPaymentAttemptMatchesOrderTerms(order, {
        amountSubunits: 50000,
        currency: "INR",
      }),
    ).not.toThrow();
  });

  it("rejects an amount mismatch", () => {
    expect(() =>
      assertPaymentAttemptMatchesOrderTerms(order, {
        amountSubunits: 50001,
        currency: "INR",
      }),
    ).toThrow(DemoMerchantDomainError);
  });

  it("rejects a currency mismatch", () => {
    expect(() =>
      assertPaymentAttemptMatchesOrderTerms(order, {
        amountSubunits: 50000,
        currency: "USD",
      }),
    ).toThrow(DemoMerchantDomainError);
  });
});
