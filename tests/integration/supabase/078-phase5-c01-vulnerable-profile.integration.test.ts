import { afterAll, describe, expect, it } from "vitest";

import { getClientEnv } from "@/lib/config/client-env";
import { getServerEnv } from "@/lib/config/server-env";
import { getSupabaseServerClient } from "@/lib/supabase/server";

import { getAnonClientForTest } from "./helpers";

/**
 * Phase 5 — the controlled C01 vulnerable Demo Merchant profile, against the
 * REAL Supabase project (migration
 * `20260907000000_phase5_c01_controlled_vulnerable_profile.sql`).
 *
 * *** NOT RUNNABLE UNTIL THE MIGRATION IS APPLIED ***. Until the developer
 * applies that migration through the Supabase SQL Editor (the only sanctioned
 * method — `docs/DATABASE.md`: never `supabase db push`, never psql), every
 * test below fails at its first `demo_merchant_profile` access with PostgREST
 * `PGRST205` ("Could not find the table ... in the schema cache"). That
 * failure is EXPECTED and must be reported honestly rather than hidden —
 * Claude does not apply this migration.
 *
 * ============================================================================
 * WHY THIS FILE IS STRUCTURAL ONLY (architect correction)
 * ============================================================================
 *
 * An earlier version of this file built a full baseline -> replay -> duplicate
 * fulfilment -> INV-002 FAIL -> Finding chain. To do that it had to insert a
 * `webhook_events` row, and the schema leaves exactly one option for such a
 * row:
 *
 *     constraint webhook_events_source_kind_valid
 *       check (source_kind = 'REAL_RAZORPAY_WEBHOOK')
 *     constraint webhook_events_signature_verified_true
 *       check (signature_verified = true)
 *
 * There is no synthetic or test-fixture provenance available at that table —
 * by deliberate design, `webhook_events` is the canonical PROVIDER-EVIDENCE
 * table and every row in it asserts a genuine, HMAC-authenticated Razorpay
 * delivery. `event_processing_attempts` additionally requires a non-null
 * `webhook_event_id` for BOTH of its source kinds, so there is no path to a
 * processing attempt that avoids making that claim.
 *
 * A comment saying "synthetic" does not make a persisted row synthetic. Since
 * this suite runs against the REAL project and a failed cleanup would leave
 * rows behind that read as authentic provider evidence, the architect's
 * ruling applies: DO NOT fabricate provider provenance to make an automated
 * test possible. Verification is therefore split.
 *
 * PROVEN HERE (no provider evidence required, nothing fabricated):
 *   - the profile table exists, is a singleton, and defaults to SAFE;
 *   - the CHECK constraint refuses any value outside the approved two;
 *   - RLS and grants keep anon out, for both reads and writes;
 *   - SAFE <-> VULNERABLE_IDEMPOTENCY transitions persist and read back;
 *   - both RPCs are reachable through PostgREST's schema cache;
 *   - the reset restores SAFE (destructive, opt-in only).
 *
 * PROVEN BY MANUAL ACCEPTANCE, using a real Razorpay Test Mode payment —
 * see `docs/TESTING.md` "Phase 5 — C01 controlled vulnerability":
 *   - baseline fulfilment count = 1;
 *   - controlled C01 replay under VULNERABLE_IDEMPOTENCY;
 *   - fulfilment count = 2;
 *   - INV-002 deterministic FAIL;
 *   - exactly one Finding, not duplicated on re-evaluation.
 *
 * The guard's STRUCTURE (its four ANDed conditions, and that the processor is
 * Phase 3C plus additions only) is proven exhaustively at the SQL layer by
 * `tests/unit/demo-profile/vulnerable-profile-sql.test.ts`, which diffs the
 * two function bodies line by line.
 *
 * THIS FILE CREATES NO `orders`, `payments`, `webhook_events`,
 * `event_processing_attempts`, `chaos_runs` OR `fulfilments` ROW. It touches
 * exactly one pre-existing singleton row and always restores it to SAFE.
 */

const client = getSupabaseServerClient();

/** Set to "1" only for a supervised, deliberate destructive verification. */
const DESTRUCTIVE_OPT_IN =
  process.env.PAYCHAOS_ALLOW_DESTRUCTIVE_RESET_TEST === "1";

async function readProfile(): Promise<string> {
  const { data, error } = await client
    .from("demo_merchant_profile")
    .select("c01_idempotency_profile")
    .eq("id", true)
    .maybeSingle();

  expect(
    error,
    "demo_merchant_profile must exist — apply the Phase 5 migration first",
  ).toBeNull();
  expect(data, "the singleton profile row must exist").not.toBeNull();
  return data!.c01_idempotency_profile;
}

async function setProfile(
  value: "SAFE" | "VULNERABLE_IDEMPOTENCY",
): Promise<void> {
  const { error } = await client
    .from("demo_merchant_profile")
    .update({ c01_idempotency_profile: value })
    .eq("id", true);
  expect(error, `failed to set profile to ${value}`).toBeNull();
}

describe("Phase 5 C01 profile — the storage is a safe-by-default singleton", () => {
  it("1: the singleton row exists and the profile defaults to SAFE", async () => {
    expect(await readProfile()).toBe("SAFE");
  });

  it("2: a second row is structurally impossible", async () => {
    // CORRECTED against the real database. This originally expected 23505
    // (PK collision) or 23514 (check violation) — the two ways the SCHEMA
    // refuses a second row. The live answer is 42501, insufficient_privilege,
    // and it is the better one: the migration grants service_role only
    // `select, update`, so the server cannot INSERT here at all. The refusal
    // happens a layer earlier than the constraints, and never reaches them.
    //
    // Asserting the real code is what makes this test prove something. A
    // relaxed "any error will do" would still pass if the narrow grant were
    // widened to full CRUD later, which is exactly the regression worth
    // catching — the missing grant statement was the defect the architect
    // review found in the first place.
    const { error } = await client
      .from("demo_merchant_profile")
      .insert({ id: true, c01_idempotency_profile: "SAFE" });

    expect(error, "a second profile row must be refused").not.toBeNull();
    expect(
      error?.code,
      "the server must hold no INSERT privilege on this table",
    ).toBe("42501");

    // Belt and braces: still exactly one row, still SAFE.
    const { count } = await client
      .from("demo_merchant_profile")
      .select("*", { count: "exact", head: true });
    expect(count).toBe(1);
    expect(await readProfile()).toBe("SAFE");
  });

  it("3: a value outside the approved two is refused by the CHECK", async () => {
    const { error } = await client
      .from("demo_merchant_profile")
      // Deliberately invalid: the DATABASE, not the application, must refuse.
      .update({ c01_idempotency_profile: "TOTALLY_UNSAFE" as never })
      .eq("id", true);

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
    expect(await readProfile()).toBe("SAFE");
  });
});

describe("Phase 5 C01 profile — RLS and grants keep the browser out", () => {
  it("4: anon cannot READ the profile", async () => {
    // RLS is enabled with no policy, so anon sees no row even though the
    // table exists. A leak here would tell an unauthenticated visitor
    // whether the controlled defect is currently armed.
    // Asserted FIRST so this test cannot pass vacuously while the migration
    // is unapplied: without it, a missing table makes the anon read fail and
    // the `error !== null` branch below would report a green tick for a
    // protection that was never exercised.
    expect(await readProfile()).toBe("SAFE");

    const anon = getAnonClientForTest();
    const { data, error } = await anon
      .from("demo_merchant_profile")
      .select("c01_idempotency_profile");

    // Either an outright refusal or an empty set is acceptable; a populated
    // result is not — that would leak whether the defect is currently armed.
    if (error === null) expect(data ?? []).toEqual([]);
  });

  it("5: anon cannot WRITE the profile", async () => {
    // The one that would be a critical defect: enabling the controlled
    // vulnerability without the Demo Access Code.
    const anon = getAnonClientForTest();
    const { error } = await anon
      .from("demo_merchant_profile")
      .update({ c01_idempotency_profile: "VULNERABLE_IDEMPOTENCY" })
      .eq("id", true);

    // PostgREST reports an RLS refusal either as an error or as zero rows
    // affected; the authoritative check is that the value did not change.
    expect(await readProfile()).toBe("SAFE");
    if (error !== null) expect(error.code).toBeDefined();
  });

  it("6: anon cannot DELETE the singleton row", async () => {
    const anon = getAnonClientForTest();
    await anon.from("demo_merchant_profile").delete().eq("id", true);

    // Still there, still readable by the server.
    expect(await readProfile()).toBe("SAFE");
  });
});

describe("Phase 5 C01 profile — the server can drive the state machine", () => {
  it("7: SAFE -> VULNERABLE_IDEMPOTENCY persists and reads back", async () => {
    await setProfile("VULNERABLE_IDEMPOTENCY");
    expect(await readProfile()).toBe("VULNERABLE_IDEMPOTENCY");
  });

  it("8: VULNERABLE_IDEMPOTENCY -> SAFE persists and reads back", async () => {
    await setProfile("VULNERABLE_IDEMPOTENCY");
    await setProfile("SAFE");
    expect(await readProfile()).toBe("SAFE");
  });

  it("9: the write is idempotent — setting the same value twice is stable", async () => {
    await setProfile("SAFE");
    await setProfile("SAFE");
    expect(await readProfile()).toBe("SAFE");
  });
});

describe("Phase 5 C01 profile — the RPCs are reachable through PostgREST", () => {
  /**
   * WHY THIS EXISTS, borrowed from 052: a function created by hand in the SQL
   * Editor is invisible to the API until PostgREST's schema cache reloads. The
   * migration will be applied exactly that way, so "it works in the editor"
   * is not evidence that the application can call it. This probe reads
   * PostgREST's own OpenAPI document and calls nothing.
   */
  it("10: both the reset and the merchant processor are exposed as RPCs", async () => {
    const { supabaseUrl } = getClientEnv();
    const { supabaseServiceRoleKey } = getServerEnv();

    // The key is used, never logged: only status and path names are surfaced.
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        Accept: "application/openapi+json",
      },
    });
    expect(response.ok, `PostgREST root must be readable`).toBe(true);

    const spec = (await response.json()) as { paths?: Record<string, unknown> };
    const paths = Object.keys(spec.paths ?? {});
    expect(paths.length).toBeGreaterThan(0);

    expect(paths).toContain("/rpc/reset_paychaos_demo_runtime");
    expect(paths).toContain("/rpc/process_webhook_payment_event");
  });

  it("11: the profile table itself is exposed to the API", async () => {
    const { supabaseUrl } = getClientEnv();
    const { supabaseServiceRoleKey } = getServerEnv();

    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        Accept: "application/openapi+json",
      },
    });
    const spec = (await response.json()) as { paths?: Record<string, unknown> };

    expect(Object.keys(spec.paths ?? {})).toContain("/demo_merchant_profile");
  });
});

describe("Phase 5 C01 profile — a reset restores SAFE (opt-in only)", () => {
  // `skipIf`, not an early return: a test that quietly returns is reported as
  // PASSED, which would put a green tick against a destructive proof that
  // never ran. Convention and variable name match 052 exactly.
  it.skipIf(!DESTRUCTIVE_OPT_IN)(
    "12: reset_paychaos_demo_runtime() returns the profile to SAFE",
    async () => {
      await setProfile("VULNERABLE_IDEMPOTENCY");
      expect(await readProfile()).toBe("VULNERABLE_IDEMPOTENCY");

      const { error } = await client.rpc("reset_paychaos_demo_runtime");
      expect(error).toBeNull();

      expect(
        await readProfile(),
        "a vulnerable profile must never survive a reset",
      ).toBe("SAFE");
    },
  );
});

afterAll(async () => {
  // Always leave the project SAFE, whatever happened above. This file creates
  // no rows, so this is the entirety of its cleanup.
  const { error } = await client
    .from("demo_merchant_profile")
    .update({ c01_idempotency_profile: "SAFE" })
    .eq("id", true);

  // A missing table here means the migration is not applied yet, which every
  // test above has already reported; anything else is a real cleanup failure.
  if (error !== null && error.code !== "PGRST205") {
    expect(error, "the profile must be restored to SAFE").toBeNull();
  }
});
