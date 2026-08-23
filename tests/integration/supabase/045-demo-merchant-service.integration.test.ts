import { describe, expect, it } from "vitest";

import { DEMO_MERCHANT_PRODUCT } from "@/lib/demo-merchant/product";
import {
  createDemoMerchantOrder,
  listDemoMerchantOrders,
} from "@/lib/demo-merchant/service";
import { getSupabaseServerClient } from "@/lib/supabase/server";

import { trackOrder } from "./helpers";

/**
 * Phase 1E — real Supabase integration test for the NEW application
 * service/repository path (`createDemoMerchantOrder` /
 * `listDemoMerchantOrders`), as distinct from the raw
 * `supabase.from("orders").insert(...)` calls already proven in Phase 1C
 * (02-service-role-crud.integration.test.ts).
 *
 * Filename sorts as "045-..." — after "04-anon-rls..." and before
 * "05-final-state..." (see vitest.integration.config.ts's
 * fileParallelism:false / isolate:false sequential, numeric-filename-order
 * execution contract documented in helpers.ts) — so
 * 05-final-state.integration.test.ts still runs last, after this file has
 * already cleaned up its own row.
 */
describe("Phase 1E — createDemoMerchantOrder / listDemoMerchantOrders against the real Supabase project", () => {
  const client = getSupabaseServerClient();

  it("creates a real persisted order with the fixed product's terms, UNPAID/OPEN/0/CREATED, zero payment_attempts, zero fulfilments, and is visible via listDemoMerchantOrders", async () => {
    const created = await createDemoMerchantOrder();
    trackOrder(created.id);

    try {
      // The service's own return value.
      expect(created.amountSubunits).toBe(DEMO_MERCHANT_PRODUCT.amountSubunits);
      expect(created.currency).toBe(DEMO_MERCHANT_PRODUCT.currency);
      expect(created.paymentStatus).toBe("UNPAID");
      expect(created.businessStatus).toBe("OPEN");
      expect(created.fulfilmentCount).toBe(0);
      expect(created.conceptualState).toBe("CREATED");

      // Independently re-verify via a real service-role SELECT — never
      // trust the service's own return value alone.
      const { data: persisted, error: readError } = await client
        .from("orders")
        .select("*")
        .eq("id", created.id)
        .single();
      expect(readError).toBeNull();
      expect(persisted?.amount_subunits).toBe(
        DEMO_MERCHANT_PRODUCT.amountSubunits,
      );
      expect(persisted?.currency).toBe(DEMO_MERCHANT_PRODUCT.currency);
      expect(persisted?.payment_status).toBe("UNPAID");
      expect(persisted?.business_status).toBe("OPEN");

      // The service/repository path must not insert into payment_attempts
      // or fulfilments during normal creation.
      const { count: attemptCount, error: attemptCountError } = await client
        .from("payment_attempts")
        .select("id", { count: "exact", head: true })
        .eq("order_id", created.id);
      expect(attemptCountError).toBeNull();
      expect(attemptCount).toBe(0);

      const { count: fulfilmentCount, error: fulfilmentCountError } =
        await client
          .from("fulfilments")
          .select("id", { count: "exact", head: true })
          .eq("order_id", created.id);
      expect(fulfilmentCountError).toBeNull();
      expect(fulfilmentCount).toBe(0);

      // The service/read path returns the created order.
      const recent = await listDemoMerchantOrders(10);
      const found = recent.find((order) => order.id === created.id);
      expect(found).toBeDefined();
      expect(found?.paymentStatus).toBe("UNPAID");
      expect(found?.businessStatus).toBe("OPEN");
      expect(found?.fulfilmentCount).toBe(0);
      expect(found?.conceptualState).toBe("CREATED");
      expect(found?.amountSubunits).toBe(DEMO_MERCHANT_PRODUCT.amountSubunits);
      expect(found?.currency).toBe(DEMO_MERCHANT_PRODUCT.currency);
    } finally {
      // Exact-ID-scoped cleanup only — never truncate/reset.
      const { error: deleteError } = await client
        .from("orders")
        .delete()
        .eq("id", created.id);
      expect(deleteError).toBeNull();
    }
  });
});
