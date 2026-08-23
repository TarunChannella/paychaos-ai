"use server";

/**
 * Phase 1E — Demo Merchant Server Action module. `"use server"` is
 * isolated to this file only — no other module in `app/demo-merchant/`
 * carries it (docs instructions Section 12).
 *
 * `createDemoMerchantOrderAction` accepts NO arguments. There is therefore
 * no field of any kind — no `amount`, `currency`, `payment_status`,
 * `business_status`, `id`, `created_at`, or `updated_at` — that a browser
 * caller can submit through this action. It only calls the trusted
 * `lib/demo-merchant/service.ts` application service, which in turn uses
 * the fixed, server-owned `DEMO_MERCHANT_PRODUCT` — never a client-supplied
 * value.
 *
 * On success it calls `revalidatePath("/demo-merchant")` so the freshly
 * persisted order is visible on next render (docs instructions Section 12).
 * Errors are mapped to one generic, safe message — the real Supabase/error
 * object is never forwarded to the browser, and only a safe error `name` is
 * logged via the existing redacting structured logger.
 */
import { revalidatePath } from "next/cache";

import { createDemoMerchantOrder } from "@/lib/demo-merchant/service";
import { logEvent } from "@/lib/security/logger";

export interface CreateDemoMerchantOrderActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

const SAFE_CREATE_ERROR_MESSAGE =
  "Could not create the test order. Please try again.";

export async function createDemoMerchantOrderAction(): Promise<CreateDemoMerchantOrderActionResult> {
  try {
    await createDemoMerchantOrder();
    revalidatePath("/demo-merchant");
    return { ok: true };
  } catch (err) {
    logEvent("demo_merchant_order_create_failed", {
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    return { ok: false, error: SAFE_CREATE_ERROR_MESSAGE };
  }
}
