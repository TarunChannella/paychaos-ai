/**
 * Phase 1E — Demo Merchant application service.
 *
 * `import "server-only"` for the same structural reason as
 * `lib/demo-merchant/repository.ts`: this module transitively performs I/O
 * (through the repository) and must never be reachable from a client
 * bundle.
 *
 * Flow (docs instructions Section 5C):
 *   fixed product (`lib/demo-merchant/product.ts`)
 *     -> `createInitialMerchantOrder` (reused, unmodified Phase 1D domain
 *        factory/validation — not reimplemented here)
 *     -> repository insert (`lib/demo-merchant/repository.ts`)
 *     -> read persisted row + real fulfilment count
 *     -> safe view model (`lib/demo-merchant/view-model.ts`)
 *
 * Phase 1D domain rules remain authoritative: this service does not
 * duplicate amount/currency validation or the UNPAID/OPEN/0 initial-state
 * rule — it calls into `lib/demo-merchant/order.ts` for both.
 */
import "server-only";

import { createInitialMerchantOrder } from "./order";
import { DEMO_MERCHANT_PRODUCT } from "./product";
import {
  countFulfilmentsForOrderIds,
  insertOrder,
  listRecentOrders,
} from "./repository";
import {
  toDemoMerchantOrderViewModel,
  type DemoMerchantOrderViewModel,
} from "./view-model";

const DEFAULT_RECENT_ORDER_LIMIT = 10;

/**
 * Creates one new Demo Merchant order for the fixed
 * `DEMO_MERCHANT_PRODUCT`. Accepts NO caller-supplied amount, currency, id,
 * or status — the fixed product is the only source of order terms, and the
 * database assigns identity/timestamps/initial status. Every order this
 * function creates is UNPAID / OPEN / 0 fulfilments / CREATED.
 */
export async function createDemoMerchantOrder(): Promise<DemoMerchantOrderViewModel> {
  const initial = createInitialMerchantOrder({
    amountSubunits: DEMO_MERCHANT_PRODUCT.amountSubunits,
    currency: DEMO_MERCHANT_PRODUCT.currency,
  });

  const row = await insertOrder({
    amountSubunits: initial.amountSubunits,
    currency: initial.currency,
  });

  const counts = await countFulfilmentsForOrderIds([row.id]);
  return toDemoMerchantOrderViewModel(row, counts.get(row.id) ?? 0);
}

/**
 * Reads the most recent Demo Merchant orders, newest first, with each
 * order's real fulfilment count resolved from the database (never
 * hardcoded).
 */
export async function listDemoMerchantOrders(
  limit: number = DEFAULT_RECENT_ORDER_LIMIT,
): Promise<DemoMerchantOrderViewModel[]> {
  const rows = await listRecentOrders(limit);
  if (rows.length === 0) return [];

  const counts = await countFulfilmentsForOrderIds(rows.map((row) => row.id));
  return rows.map((row) =>
    toDemoMerchantOrderViewModel(row, counts.get(row.id) ?? 0),
  );
}
