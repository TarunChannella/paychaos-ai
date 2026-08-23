/**
 * Phase 1E — Demo Merchant server-only persistence boundary.
 *
 * Structural guarantee: `import "server-only"` (same pattern as
 * `lib/supabase/server.ts` / `lib/config/server-env.ts`) makes a
 * client-bundle import of this module fail at build time rather than
 * relying on review discipline alone.
 *
 * This module is the ONLY place Phase 1E writes/reads `orders` and reads
 * `fulfilments`. It never writes to `payment_attempts` or `fulfilments` —
 * Phase 1 must not insert into either table (docs/DATABASE.md Sections 10,
 * 12). It builds strictly on the existing `getSupabaseServerClient()`
 * helper; it does not create its own Supabase client and does not read
 * `process.env`.
 */
import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

export type OrderRow = Database["public"]["Tables"]["orders"]["Row"];

/** Deterministic domain error for this repository's I/O failures. */
export class DemoMerchantRepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DemoMerchantRepositoryError";
    this.code = code;
  }
}

/**
 * The COMPLETE set of fields `insertOrder` accepts. Deliberately contains
 * only `amountSubunits`/`currency` — there is no `id`, `createdAt`,
 * `updatedAt`, `paymentStatus` or `businessStatus` field on this type, so
 * there is no code path through which a caller could pass a
 * browser-supplied value for any of those fields into this insert. The
 * database itself assigns `id` (`gen_random_uuid()`), `created_at`,
 * `updated_at`, and defaults `payment_status`/`business_status` to
 * `'UNPAID'`/`'OPEN'` (see
 * `supabase/migrations/20260823000000_phase1_foundation_schema.sql`) —
 * this function does not set them explicitly, so it cannot accidentally
 * forward an overridden value for them either.
 */
export interface InsertOrderInput {
  readonly amountSubunits: number;
  readonly currency: string;
}

/**
 * Inserts one new `orders` row using ONLY the validated amount/currency
 * terms. Returns the full persisted row (including the database-generated
 * `id`) via a `.select().single()` read-back — the caller never generates
 * an application-side ID.
 */
export async function insertOrder(input: InsertOrderInput): Promise<OrderRow> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("orders")
    .insert({
      amount_subunits: input.amountSubunits,
      currency: input.currency,
    })
    .select()
    .single();

  if (error || !data) {
    throw new DemoMerchantRepositoryError(
      "ORDER_INSERT_FAILED",
      "Failed to create the Demo Merchant order.",
    );
  }

  return data;
}

/** Reads the most recent `orders` rows, newest first, up to `limit`. */
export async function listRecentOrders(limit: number): Promise<OrderRow[]> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new DemoMerchantRepositoryError(
      "ORDER_LIST_FAILED",
      "Failed to load Demo Merchant orders.",
    );
  }

  return data ?? [];
}

/**
 * Real server-side count of `fulfilments` rows per order id, grouped by
 * `order_id` — never hardcoded, never guessed. Phase 1 never inserts into
 * `fulfilments` (docs/DATABASE.md Section 12 "Phase 1 must not insert any
 * row into `fulfilments`"), so this always resolves to 0 for every order
 * Phase 1E can create — but the query is genuine, reads the real (always
 * empty in Phase 1) table, and would reflect an actual fulfilment the
 * moment a later phase starts writing one.
 */
export async function countFulfilmentsForOrderIds(
  orderIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (orderIds.length === 0) return counts;

  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("fulfilments")
    .select("order_id")
    .in("order_id", [...orderIds]);

  if (error) {
    throw new DemoMerchantRepositoryError(
      "FULFILMENT_COUNT_FAILED",
      "Failed to load fulfilment counts.",
    );
  }

  for (const row of data ?? []) {
    counts.set(row.order_id, (counts.get(row.order_id) ?? 0) + 1);
  }

  return counts;
}
