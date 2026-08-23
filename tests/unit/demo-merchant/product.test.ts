import { describe, expect, it } from "vitest";

import { validateOrderAmount } from "@/lib/demo-merchant/order";
import { DEMO_MERCHANT_PRODUCT } from "@/lib/demo-merchant/product";

// Phase 1E: the fixed Demo Merchant product is pure application
// configuration — no Supabase/network — fully offline.

describe("DEMO_MERCHANT_PRODUCT", () => {
  it("has a positive integer amountSubunits", () => {
    expect(Number.isInteger(DEMO_MERCHANT_PRODUCT.amountSubunits)).toBe(true);
    expect(DEMO_MERCHANT_PRODUCT.amountSubunits).toBeGreaterThan(0);
  });

  it("has an uppercase 3-letter currency code", () => {
    expect(DEMO_MERCHANT_PRODUCT.currency).toMatch(/^[A-Z]{3}$/);
  });

  it("has a non-empty product name", () => {
    expect(DEMO_MERCHANT_PRODUCT.name.trim().length).toBeGreaterThan(0);
  });

  it("uses valid Phase 1D money semantics (passes validateOrderAmount unchanged)", () => {
    expect(
      validateOrderAmount({
        amountSubunits: DEMO_MERCHANT_PRODUCT.amountSubunits,
        currency: DEMO_MERCHANT_PRODUCT.currency,
      }),
    ).toEqual({
      amountSubunits: DEMO_MERCHANT_PRODUCT.amountSubunits,
      currency: DEMO_MERCHANT_PRODUCT.currency,
    });
  });
});
