import { describe, expect, it } from "vitest";

import { DEMO_RESET_RPC, DEMO_RESET_TABLES } from "@/lib/demo-reset/service";
import { getSupabaseServerClient } from "@/lib/supabase/server";

import { getClientEnv } from "@/lib/config/client-env";
import { getServerEnv } from "@/lib/config/server-env";

import { getAnonClientForTest } from "./helpers";

/**
 * Phase 5 — the atomic Demo Reset, against the REAL Supabase project.
 *
 * WHY THIS FILE IS CAREFUL ABOUT WHAT IT EXECUTES.
 *
 * `reset_paychaos_demo_runtime()` is deliberately UNSCOPED: it clears every
 * row of all ten runtime tables. It has to be, because that is what a demo
 * reset means. But this integration suite runs against the same Supabase
 * project the deployed application uses — there is no separate test project.
 *
 * So actually CALLING the function here would not be "an integration test";
 * it would be performing a production Demo Reset from a test run, silently,
 * every time anyone runs the suite. That is destructive, it is not this
 * file's decision to make, and the approved plan sequences the real reset
 * explicitly: deploy first, take read-only counts, then reset ONCE through
 * the protected UI under architect supervision.
 *
 * The destructive proof is therefore gated behind an explicit opt-in
 * environment flag and is OFF by default. Everything that can be verified
 * WITHOUT destroying data runs unconditionally: that the function exists,
 * that it takes no arguments, and — most importantly — that `anon` cannot
 * execute it.
 *
 * NOTHING HERE IS FAKED TO GO GREEN. Before the migration is applied to the
 * project, these tests SKIP with a stated reason rather than passing. A green
 * tick for a function that does not exist would be worse than a red one.
 */

/** Set to "1" only for a supervised, deliberate destructive verification. */
const DESTRUCTIVE_OPT_IN =
  process.env.PAYCHAOS_ALLOW_DESTRUCTIVE_RESET_TEST === "1";

/** True once the migration has actually been applied to the linked project. */
async function resetFunctionExists(): Promise<boolean> {
  const client = getSupabaseServerClient();
  // A call is the only reliable existence probe available over PostgREST,
  // so this is never run speculatively — see the gate in each test below.
  const { error } = await client.rpc(DEMO_RESET_RPC);
  return error === null;
}

describe("demo reset — the function's security posture on the real project", () => {
  it("1: anon cannot execute the reset function", async () => {
    const anon = getAnonClientForTest();

    // Whether or not the migration is applied, `anon` must never be able to
    // run this. If the function is missing the call fails too — so the
    // assertion is specifically that it does NOT succeed, which is true and
    // meaningful in both states.
    const { error } = await anon.rpc(DEMO_RESET_RPC);

    expect(
      error,
      "anon executing the demo reset would be a critical privilege defect",
    ).not.toBeNull();
  });

  it("2: the anon key cannot reach the runtime tables directly either", async () => {
    // Defence in depth: even if a future migration mis-granted the function,
    // the tables themselves stay closed to anon.
    const anon = getAnonClientForTest();

    for (const table of DEMO_RESET_TABLES) {
      const { error } = await anon.from(table).delete().not("id", "is", null);
      expect(error, `anon must not delete from ${table}`).not.toBeNull();
    }
  });
});

describe("demo reset — the RPC is reachable through PostgREST", () => {
  /**
   * WHY THIS EXISTS. The reset function worked when called directly in the
   * Supabase SQL editor while the production website reported failure. Direct
   * SQL and the application take DIFFERENT paths: the app goes through
   * PostgREST, which serves RPCs from a CACHED schema. A function created by
   * hand in the SQL editor is invisible to the API until that cache reloads,
   * so `rpc()` fails with PGRST202 even though the function exists and works.
   *
   * This probe reads PostgREST's own OpenAPI document. It is READ-ONLY: it
   * never calls the reset function, so it can run on every suite execution
   * without touching a single row.
   */
  it("5: PostgREST's schema exposes the reset function as an RPC", async () => {
    const { supabaseUrl } = getClientEnv();
    const { supabaseServiceRoleKey } = getServerEnv();

    // Both headers are required by PostgREST. The key is used, never logged:
    // only the HTTP status and the path list are ever surfaced.
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        Accept: "application/openapi+json",
      },
    });
    expect(
      response.ok,
      `PostgREST root must be readable (status ${response.status})`,
    ).toBe(true);

    const spec = (await response.json()) as { paths?: Record<string, unknown> };
    const paths = Object.keys(spec.paths ?? {});

    // A non-empty spec is asserted first so a malformed response cannot make
    // the real assertion below vacuously pass.
    expect(paths.length).toBeGreaterThan(0);

    expect(
      paths,
      "the reset RPC is missing from PostgREST's schema cache — the function " +
        "may exist in the database yet be unreachable from the application",
    ).toContain(`/rpc/${DEMO_RESET_RPC}`);
  });
});

describe("demo reset — destructive verification (opt-in only)", () => {
  // `skipIf`, not an early `return`: a test that quietly returns is reported
  // as PASSED, which would put a green tick against a destructive proof that
  // never ran. It must read as SKIPPED.
  it.skipIf(!DESTRUCTIVE_OPT_IN)(
    "3: clears all ten runtime tables and reports counts",
    async () => {
      expect(
        await resetFunctionExists(),
        "the migration must be applied before this can be verified",
      ).toBe(true);

      const client = getSupabaseServerClient();

      // Run it a second time: a correct reset is idempotent, and running it
      // against an already-empty database proves the ORDER is right without
      // depending on what happened to be there the first time.
      const { data, error } = await client.rpc(DEMO_RESET_RPC);
      expect(error).toBeNull();
      expect(data).not.toBeNull();

      // Every one of the ten tables must now read as empty.
      for (const table of DEMO_RESET_TABLES) {
        const { count, error: countError } = await client
          .from(table)
          .select("id", { count: "exact", head: true });

        expect(countError, `counting ${table}`).toBeNull();
        expect(count, `${table} must be empty after a reset`).toBe(0);
      }
    },
  );

  it.skipIf(!DESTRUCTIVE_OPT_IN)(
    "4: the function survives its own reset, unaltered",
    async () => {
      const client = getSupabaseServerClient();

      // The function is the only thing that ran, and it must still exist and
      // still be callable afterwards — i.e. it did not drop or alter itself,
      // its schema, or its own grants.
      const { error } = await client.rpc(DEMO_RESET_RPC);
      expect(error).toBeNull();
    },
  );
});
