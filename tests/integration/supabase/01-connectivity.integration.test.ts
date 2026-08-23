import { describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Phase 1C-B Task 4 — real connectivity proof.
 *
 * Uses the actual `lib/supabase/server.ts` helper (not a re-implemented
 * client) to prove a real SELECT succeeds against all three approved
 * Phase 1 tables on the real Supabase project. This is a genuine network
 * call — no mocking of `@supabase/supabase-js` in this suite.
 */
describe("Task 4 — real service-role SELECT against all 3 Phase 1 tables", () => {
  const client = getSupabaseServerClient();

  it("SELECT succeeds against orders", async () => {
    const { data, error } = await client.from("orders").select("id").limit(1);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it("SELECT succeeds against payment_attempts", async () => {
    const { data, error } = await client
      .from("payment_attempts")
      .select("id")
      .limit(1);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it("SELECT succeeds against fulfilments", async () => {
    const { data, error } = await client
      .from("fulfilments")
      .select("id")
      .limit(1);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});
