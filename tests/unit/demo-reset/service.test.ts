import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Phase 5B — the deterministic Demo Reset.
 *
 * This is the only destructive operation in the product, so the tests are
 * about SCOPE and ORDER rather than about happy-path plumbing: exactly which
 * tables it touches, in exactly which sequence, that nothing else is
 * reachable, and that a partial failure is reported instead of hidden.
 */

interface Call {
  readonly table: string;
  op: "delete" | "select" | "insert" | "update" | "upsert";
  filters: string[];
}

const calls: Call[] = [];
let failOnTable: string | null = null;

function makeBuilder(record: Call) {
  const builder: Record<string, unknown> = {};
  const chain =
    (fn: () => void) =>
    (...args: unknown[]) => {
      fn();
      record.filters.push(args.map(String).join(":"));
      return builder;
    };

  builder.delete = chain(() => {
    record.op = "delete";
  });
  for (const op of ["select", "insert", "update", "upsert"] as const) {
    builder[op] = chain(() => {
      record.op = op;
    });
  }
  builder.not = chain(() => {});
  builder.eq = chain(() => {});
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(
      record.table === failOnTable
        ? { data: null, error: { message: "permission denied for relation" } }
        : { data: null, error: null },
    ).then(resolve);
  return builder;
}

const fakeClient = {
  from(table: string) {
    const record: Call = { table, op: "select", filters: [] };
    calls.push(record);
    return makeBuilder(record);
  },
  rpc(name: string) {
    calls.push({ table: `rpc:${name}`, op: "select", filters: [] });
    return Promise.resolve({ data: null, error: null });
  },
};

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => fakeClient,
}));

const { runDemoReset, DEMO_RESET_TABLES } =
  await import("@/lib/demo-reset/service");

beforeEach(() => {
  calls.length = 0;
  failOnTable = null;
});

describe("demo reset — scope is frozen", () => {
  it("1: clears exactly the ten documented runtime tables", async () => {
    await runDemoReset();

    expect(calls.map((c) => c.table)).toEqual([
      "regression_runs",
      "findings",
      "invariant_results",
      "event_processing_attempts",
      "chaos_runs",
      "webhook_events",
      "fulfilments",
      "payments",
      "payment_attempts",
      "orders",
    ]);
  });

  it("2: the exported table list matches the documented order exactly", () => {
    // docs/TESTING.md "Demo Reset" and docs/DATABASE.md Section 39.
    expect([...DEMO_RESET_TABLES]).toEqual([
      "regression_runs",
      "findings",
      "invariant_results",
      "event_processing_attempts",
      "chaos_runs",
      "webhook_events",
      "fulfilments",
      "payments",
      "payment_attempts",
      "orders",
    ]);
  });

  it("3: children are deleted before their parents", async () => {
    await runDemoReset();
    const order = calls.map((c) => c.table);

    // Each pair would violate a foreign key if reversed.
    for (const [child, parent] of [
      ["regression_runs", "findings"],
      ["findings", "invariant_results"],
      ["invariant_results", "chaos_runs"],
      ["event_processing_attempts", "webhook_events"],
      ["fulfilments", "payments"],
      ["payments", "payment_attempts"],
      ["payment_attempts", "orders"],
    ] as const) {
      expect(
        order.indexOf(child),
        `${child} must precede ${parent}`,
      ).toBeLessThan(order.indexOf(parent));
    }
  });

  it("4: no schema, config or fixture table is ever touched", async () => {
    await runDemoReset();
    const touched = calls.map((c) => c.table);

    for (const forbidden of [
      "schema_migrations",
      "supabase_migrations",
      "pg_policies",
      "users",
      "auth.users",
      "storage.objects",
    ]) {
      expect(touched, forbidden).not.toContain(forbidden);
    }
  });

  it("5: every statement is a DELETE — no truncate, no rpc, no select", async () => {
    await runDemoReset();

    expect(calls.every((c) => c.op === "delete")).toBe(true);
    expect(calls.some((c) => c.table.startsWith("rpc:"))).toBe(false);
  });

  it("6: it takes no arguments, so no caller can widen the scope", () => {
    // The signature is the guarantee: there is nothing to pass.
    expect(runDemoReset.length).toBe(0);
  });

  it("7: the frozen table list cannot be mutated at runtime", () => {
    expect(Object.isFrozen(DEMO_RESET_TABLES)).toBe(true);
  });
});

describe("demo reset — a partial reset is reported, not hidden", () => {
  it("8: a clean run reports ok with every table cleared", async () => {
    const result = await runDemoReset();

    expect(result.ok).toBe(true);
    expect(result.failedTable).toBeNull();
    expect(result.clearedTables).toHaveLength(DEMO_RESET_TABLES.length);
  });

  it("9: a failure stops immediately and names the table", async () => {
    failOnTable = "invariant_results";

    const result = await runDemoReset();

    expect(result.ok).toBe(false);
    expect(result.failedTable).toBe("invariant_results");
    // The two earlier tables succeeded; nothing after it was attempted.
    expect(result.clearedTables).toEqual(["regression_runs", "findings"]);
    expect(calls.map((c) => c.table)).toEqual([
      "regression_runs",
      "findings",
      "invariant_results",
    ]);
  });

  it("10: a failure never reports ok", async () => {
    // A half-cleared demo reported as clean would make every subsequent
    // screen unreadable.
    for (const table of DEMO_RESET_TABLES) {
      calls.length = 0;
      failOnTable = table;
      const result = await runDemoReset();
      expect(result.ok, table).toBe(false);
    }
  });

  it("11: no raw database message escapes the result", async () => {
    failOnTable = "orders";

    const result = await runDemoReset();

    expect(JSON.stringify(result)).not.toContain("permission denied");
    expect(JSON.stringify(result)).not.toContain("relation");
  });
});
