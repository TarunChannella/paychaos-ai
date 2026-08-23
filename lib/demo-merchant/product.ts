/**
 * Phase 1E — the fixed Demo Merchant test product.
 *
 * Pure TypeScript application configuration. Not a database table —
 * docs/DATABASE.md Section 33 explicitly excludes a `products` table from
 * P0 ("The single demo product/configuration can remain application
 * configuration."). No I/O, no `process.env` read.
 *
 * This is the ONLY product Phase 1E exposes. The browser never supplies
 * amount/currency/name for order creation — every Demo Merchant order this
 * phase can create uses exactly these fixed, server-owned terms (see
 * `lib/demo-merchant/service.ts` `createDemoMerchantOrder`).
 */

export interface DemoMerchantProduct {
  readonly name: string;
  readonly amountSubunits: number;
  readonly currency: string;
}

/** ₹500.00 — an arbitrary, simple, valid fixed Phase 1D money value. */
export const DEMO_MERCHANT_PRODUCT: DemoMerchantProduct = {
  name: "PayChaos Test Product",
  amountSubunits: 50_000,
  currency: "INR",
};
