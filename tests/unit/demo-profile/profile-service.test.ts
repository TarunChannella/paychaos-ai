import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Phase 5 — the controlled C01 profile service.
 *
 * The SQL tests prove the vulnerable behaviour is unreachable without the
 * four persisted conditions. These tests cover the layer above: what the
 * server will and will not persist, and how it behaves when it cannot tell.
 *
 * THE INTERESTING CASE IS THE UNREADABLE ONE. A read failure must not report
 * SAFE. "The merchant is safe" and "I could not find out whether the merchant
 * is safe" are different claims, and collapsing the second into the first is
 * the exact class of unearned reassurance this product exists to remove.
 */

interface Recorded {
  readonly table: string;
  readonly op: "select" | "update";
  readonly payload?: Record<string, unknown>;
}

const calls: Recorded[] = [];
let readRow: unknown = { c01_idempotency_profile: "SAFE" };
let readError: { code?: string } | null = null;
let writeRow: unknown = { c01_idempotency_profile: "VULNERABLE_IDEMPOTENCY" };
let writeError: { code?: string } | null = null;

/** Minimal PostgREST-shaped chain: .select().eq().maybeSingle() etc. */
function builder(table: string) {
  const chain = {
    _op: "select" as "select" | "update",
    _payload: undefined as Record<string, unknown> | undefined,
    select() {
      return chain;
    },
    update(payload: Record<string, unknown>) {
      chain._op = "update";
      chain._payload = payload;
      return chain;
    },
    eq() {
      return chain;
    },
    maybeSingle() {
      calls.push({ table, op: chain._op, payload: chain._payload });
      return Promise.resolve(
        chain._op === "update"
          ? { data: writeError === null ? writeRow : null, error: writeError }
          : { data: readError === null ? readRow : null, error: readError },
      );
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => ({ from: (table: string) => builder(table) }),
}));

let razorpayMode: string | null = "test";

vi.mock("@/lib/config/razorpay-env", () => ({
  getRazorpayEnv: () => {
    if (razorpayMode === null) {
      throw new Error('Environment variable RAZORPAY_MODE must be "test"');
    }
    return { mode: razorpayMode };
  },
}));

const {
  readC01IdempotencyProfile,
  setC01IdempotencyProfile,
  isC01IdempotencyProfile,
  C01_IDEMPOTENCY_PROFILES,
  DEFAULT_C01_IDEMPOTENCY_PROFILE,
} = await import("@/lib/demo-profile/service");

beforeEach(() => {
  calls.length = 0;
  readRow = { c01_idempotency_profile: "SAFE" };
  readError = null;
  writeRow = { c01_idempotency_profile: "VULNERABLE_IDEMPOTENCY" };
  writeError = null;
  razorpayMode = "test";
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("profile service — the approved values", () => {
  it("1: exactly two profiles exist, and SAFE is the default", () => {
    expect([...C01_IDEMPOTENCY_PROFILES]).toEqual([
      "SAFE",
      "VULNERABLE_IDEMPOTENCY",
    ]);
    expect(DEFAULT_C01_IDEMPOTENCY_PROFILE).toBe("SAFE");
  });

  it("2: the guard rejects everything that is not one of the two", () => {
    for (const value of [
      "safe",
      "Safe",
      "VULNERABLE",
      "vulnerable_idempotency",
      "",
      " SAFE",
      null,
      undefined,
      1,
      {},
      ["SAFE"],
      true,
    ]) {
      expect(isC01IdempotencyProfile(value), String(value)).toBe(false);
    }
    expect(isC01IdempotencyProfile("SAFE")).toBe(true);
    expect(isC01IdempotencyProfile("VULNERABLE_IDEMPOTENCY")).toBe(true);
  });
});

describe("profile service — Razorpay Test Mode is required to enable it", () => {
  it("3: a non-test mode refuses the change and writes nothing", () => {
    // Live Mode cannot reach this code at all in practice — the app refuses
    // to boot without a rzp_test_ key — so this proves the second, explicit
    // layer also holds if the first were ever relaxed.
    razorpayMode = "live";
    return setC01IdempotencyProfile("VULNERABLE_IDEMPOTENCY").then((result) => {
      expect(result.ok).toBe(false);
      expect(result.failureReason).toBe("PROFILE_NOT_TEST_MODE");
      expect(calls.filter((c) => c.op === "update")).toEqual([]);
    });
  });

  it("4: an unreadable Razorpay configuration also refuses", async () => {
    // `getRazorpayEnv()` throws on a misconfiguration. Failing closed is the
    // only safe reading of "I cannot tell which mode this is".
    razorpayMode = null;
    const result = await setC01IdempotencyProfile("VULNERABLE_IDEMPOTENCY");

    expect(result.ok).toBe(false);
    expect(result.failureReason).toBe("PROFILE_NOT_TEST_MODE");
    expect(calls.filter((c) => c.op === "update")).toEqual([]);
  });

  it("5: Test Mode permits the change", async () => {
    const result = await setC01IdempotencyProfile("VULNERABLE_IDEMPOTENCY");

    expect(result.ok).toBe(true);
    expect(result.profile).toBe("VULNERABLE_IDEMPOTENCY");
    expect(calls.filter((c) => c.op === "update")).toHaveLength(1);
  });

  it("6: returning to SAFE is permitted in Test Mode too", async () => {
    writeRow = { c01_idempotency_profile: "SAFE" };
    const result = await setC01IdempotencyProfile("SAFE");

    expect(result.ok).toBe(true);
    expect(result.profile).toBe("SAFE");
  });
});

describe("profile service — an unknown state is never reported as SAFE", () => {
  it("7: a read error fails rather than defaulting to SAFE", async () => {
    readError = { code: "42501" };
    const result = await readC01IdempotencyProfile();

    expect(result.ok).toBe(false);
    expect(result.profile).toBeNull();
    expect(result.failureReason).toBe("PROFILE_NOT_PERMITTED");
  });

  it("8: a missing migration is reported as unavailable, not as SAFE", async () => {
    readError = { code: "42P01" };
    const result = await readC01IdempotencyProfile();

    expect(result.ok).toBe(false);
    expect(result.failureReason).toBe("PROFILE_TABLE_UNAVAILABLE");
  });

  it("9: a missing singleton row is unavailable, not SAFE", async () => {
    readRow = null;
    const result = await readC01IdempotencyProfile();

    expect(result.ok).toBe(false);
    expect(result.profile).toBeNull();
    expect(result.failureReason).toBe("PROFILE_TABLE_UNAVAILABLE");
  });

  it("10: an unrecognised stored value is not silently coerced", async () => {
    // Only reachable if the CHECK constraint were dropped, which is exactly
    // when a silent coercion to SAFE would be most dangerous.
    readRow = { c01_idempotency_profile: "SOMETHING_ELSE" };
    const result = await readC01IdempotencyProfile();

    expect(result.ok).toBe(false);
    expect(result.profile).toBeNull();
  });

  it("11: a healthy read reports the stored value", async () => {
    readRow = { c01_idempotency_profile: "VULNERABLE_IDEMPOTENCY" };
    const result = await readC01IdempotencyProfile();

    expect(result.ok).toBe(true);
    expect(result.profile).toBe("VULNERABLE_IDEMPOTENCY");
  });
});

describe("profile service — writes are narrow and validated", () => {
  it("12: an invalid profile is refused before any database call", async () => {
    const result = await setC01IdempotencyProfile(
      "DROP TABLE fulfilments" as never,
    );

    expect(result.ok).toBe(false);
    expect(result.failureReason).toBe("PROFILE_INVALID_VALUE");
    expect(calls).toEqual([]);
  });

  it("13: the update writes only the profile and its timestamp", async () => {
    await setC01IdempotencyProfile("VULNERABLE_IDEMPOTENCY");

    const update = calls.find((c) => c.op === "update");
    expect(update).toBeDefined();
    expect(Object.keys(update?.payload ?? {}).sort()).toEqual([
      "c01_idempotency_profile",
      "updated_at",
    ]);
  });

  it("14: a CHECK violation surfaces as an invalid value, not a success", async () => {
    writeError = { code: "23514" };
    const result = await setC01IdempotencyProfile("VULNERABLE_IDEMPOTENCY");

    expect(result.ok).toBe(false);
    expect(result.failureReason).toBe("PROFILE_INVALID_VALUE");
  });

  it("15: only the singleton table is ever touched", async () => {
    await readC01IdempotencyProfile();
    await setC01IdempotencyProfile("SAFE");

    expect(new Set(calls.map((c) => c.table))).toEqual(
      new Set(["demo_merchant_profile"]),
    );
  });
});
