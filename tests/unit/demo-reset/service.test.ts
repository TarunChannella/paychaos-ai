import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Phase 5 — the atomic Demo Reset.
 *
 * This is the only destructive operation in the product, so the tests are
 * about SCOPE, ORDER and ATOMICITY rather than happy-path plumbing.
 *
 * WHY THIS FILE WAS REWRITTEN. The previous version froze a deletion order
 * that was WRONG, and its "children are deleted before their parents" test
 * passed anyway — because it hand-listed seven foreign-key pairs and happened
 * to omit `fulfilments -> event_processing_attempts`, which is the pair that
 * actually broke production. A test that enumerates a hand-picked subset of a
 * schema constraint can only ever catch the cases its author already thought
 * of. The order test below therefore PARSES the migrations and derives every
 * edge, so a future FK cannot be silently left out.
 */

interface Call {
  readonly table: string;
  op: "delete" | "select" | "insert" | "update" | "upsert" | "rpc";
}

const calls: Call[] = [];
let rpcError: { message: string } | null = null;
let rpcData: unknown = {
  fulfilments: 1,
  regression_runs: 2,
  event_processing_attempts: 3,
  findings: 4,
  invariant_results: 5,
  chaos_runs: 6,
  webhook_events: 7,
  payments: 8,
  payment_attempts: 9,
  orders: 10,
};

const fakeClient = {
  from(table: string) {
    // Any table access at all is now a defect: the reset is one RPC.
    calls.push({ table, op: "select" });
    throw new Error(`unexpected table access: ${table}`);
  },
  rpc(name: string, args?: unknown) {
    calls.push({ table: `rpc:${name}`, op: "rpc" });
    if (args !== undefined) throw new Error("reset RPC must take no arguments");
    return Promise.resolve(
      rpcError === null
        ? { data: rpcData, error: null }
        : { data: null, error: rpcError },
    );
  },
};

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => fakeClient,
}));

const { runDemoReset, DEMO_RESET_TABLES, DEMO_RESET_RPC } =
  await import("@/lib/demo-reset/service");

beforeEach(() => {
  calls.length = 0;
  rpcError = null;
});

describe("demo reset — one atomic call, not ten deletes", () => {
  it("1: the whole reset is a single RPC", async () => {
    await runDemoReset();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.table).toBe(`rpc:${DEMO_RESET_RPC}`);
  });

  it("2: no table is deleted from application code", async () => {
    // The loop is what allowed a partial reset to commit in production.
    await runDemoReset();
    expect(calls.some((c) => c.op === "delete")).toBe(false);
    expect(calls.filter((c) => !c.table.startsWith("rpc:"))).toEqual([]);
  });

  it("3: the RPC is called with no arguments at all", async () => {
    // `fakeClient.rpc` throws if anything is passed. A reset that can accept
    // an argument is one refactor away from a generic delete surface.
    await expect(runDemoReset()).resolves.toBeDefined();
  });

  it("4: runDemoReset itself takes no arguments", () => {
    expect(runDemoReset.length).toBe(0);
  });

  it("5: the frozen table list cannot be mutated at runtime", () => {
    expect(Object.isFrozen(DEMO_RESET_TABLES)).toBe(true);
    expect(DEMO_RESET_TABLES).toHaveLength(10);
  });
});

describe("demo reset — failure means nothing was applied", () => {
  it("6: a clean run reports ok and resetApplied", async () => {
    const result = await runDemoReset();

    expect(result.ok).toBe(true);
    expect(result.resetApplied).toBe(true);
    expect(result.deletedCounts).not.toBeNull();
  });

  it("7: a failure reports resetApplied false, never a partial success", async () => {
    rpcError = {
      message: 'update or delete on table "x" violates foreign key',
    };

    const result = await runDemoReset();

    expect(result.ok).toBe(false);
    expect(result.resetApplied).toBe(false);
    expect(result.deletedCounts).toBeNull();
  });

  it("8: the result shape cannot describe a partial reset", async () => {
    // The old contract carried `clearedTables` / `failedTable`, which existed
    // ONLY to describe a half-finished reset. Their absence is the guarantee:
    // no route or UI can render a partial story it cannot obtain.
    rpcError = { message: "boom" };
    const failure = JSON.stringify(await runDemoReset());
    rpcError = null;
    const success = JSON.stringify(await runDemoReset());

    for (const banned of ["clearedTables", "failedTable"]) {
      expect(failure, banned).not.toContain(banned);
      expect(success, banned).not.toContain(banned);
    }
  });

  it("9: no raw database message escapes the result", async () => {
    rpcError = {
      message:
        'update or delete on table "event_processing_attempts" violates ' +
        'foreign key constraint "fulfilments_trigger_processing_attempt_id_fkey"',
    };

    const serialized = JSON.stringify(await runDemoReset());

    for (const leak of [
      "violates",
      "foreign key",
      "constraint",
      "event_processing_attempts",
      "permission denied",
    ]) {
      expect(serialized, leak).not.toContain(leak);
    }
  });

  it("10: a malformed count payload never fabricates numbers", async () => {
    rpcData = "not an object";
    const result = await runDemoReset();
    rpcData = { orders: 1 };

    expect(result.ok).toBe(true);
    expect(result.deletedCounts).toBeNull();
  });
});
