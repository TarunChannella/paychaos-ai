import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Phase 1E: `lib/demo-merchant/repository.ts` behavior is exercised here
// against a MOCKED Supabase client (no network) — real-Supabase behavior is
// separately proven by
// tests/integration/supabase/045-demo-merchant-service.integration.test.ts.
vi.mock("server-only", () => ({}));

interface MockResult {
  data: unknown;
  error: unknown;
}

type InsertFn = (payload: Record<string, unknown>) => FakeQueryBuilder;
type SelectFn = () => FakeQueryBuilder;
type SingleFn = () => Promise<MockResult>;
type OrderFn = () => FakeQueryBuilder;
type LimitFn = (limit: number) => Promise<MockResult>;
type InFn = (column: string, values: readonly string[]) => Promise<MockResult>;

interface FakeQueryBuilder {
  insert: Mock<InsertFn>;
  select: Mock<SelectFn>;
  single: Mock<SingleFn>;
  order: Mock<OrderFn>;
  limit: Mock<LimitFn>;
  in: Mock<InFn>;
}

/**
 * Minimal chainable fake matching the exact call shapes this repository
 * uses. Each mock's call signature is set via `vi.fn`'s explicit type
 * parameter (rather than named implementation parameters) — the same
 * pattern already established in tests/unit/supabase/server.test.ts's
 * `createClientMock` fix — so call-shape assertions (e.g.
 * `builder.insert.mock.calls[0]?.[0]`) keep type-checking without
 * declaring any unused parameter names in the implementation body.
 */
function makeQueryBuilder(result: MockResult): FakeQueryBuilder {
  const builder: FakeQueryBuilder = {
    insert: vi.fn<InsertFn>(() => builder),
    select: vi.fn<SelectFn>(() => builder),
    single: vi.fn<SingleFn>(async () => result),
    order: vi.fn<OrderFn>(() => builder),
    limit: vi.fn<LimitFn>(async () => result),
    in: vi.fn<InFn>(async () => result),
  };
  return builder;
}

const fromMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => ({ from: fromMock }),
}));

beforeEach(() => {
  fromMock.mockReset();
});

describe("insertOrder", () => {
  it("inserts using ONLY amount_subunits/currency and returns the persisted row", async () => {
    const persistedRow = {
      id: "22222222-2222-2222-2222-222222222222",
      amount_subunits: 50000,
      currency: "INR",
      payment_status: "UNPAID",
      business_status: "OPEN",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const builder = makeQueryBuilder({ data: persistedRow, error: null });
    fromMock.mockReturnValue(builder);

    const { insertOrder } = await import("@/lib/demo-merchant/repository");
    const result = await insertOrder({
      amountSubunits: 50000,
      currency: "INR",
    });

    expect(fromMock).toHaveBeenCalledWith("orders");
    expect(builder.insert).toHaveBeenCalledWith({
      amount_subunits: 50000,
      currency: "INR",
    });
    // The insert payload must NEVER include id/payment_status/business_status/
    // created_at/updated_at — those are server/database-derived only.
    const insertPayload = builder.insert.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(insertPayload).sort()).toEqual([
      "amount_subunits",
      "currency",
    ]);
    expect(result).toEqual(persistedRow);
  });

  it("throws DemoMerchantRepositoryError (never leaks the raw Supabase error) when the insert fails", async () => {
    const builder = makeQueryBuilder({
      data: null,
      error: { message: "connection string leaked here", code: "XX000" },
    });
    fromMock.mockReturnValue(builder);

    const { insertOrder, DemoMerchantRepositoryError } =
      await import("@/lib/demo-merchant/repository");

    await expect(
      insertOrder({ amountSubunits: 50000, currency: "INR" }),
    ).rejects.toThrow(DemoMerchantRepositoryError);

    try {
      await insertOrder({ amountSubunits: 50000, currency: "INR" });
      throw new Error("expected insertOrder to throw");
    } catch (err) {
      expect((err as Error).message).not.toContain("connection string");
    }
  });
});

describe("listRecentOrders", () => {
  it("orders by created_at descending and applies the given limit", async () => {
    const builder = makeQueryBuilder({ data: [], error: null });
    fromMock.mockReturnValue(builder);

    const { listRecentOrders } = await import("@/lib/demo-merchant/repository");
    await listRecentOrders(10);

    expect(fromMock).toHaveBeenCalledWith("orders");
    expect(builder.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(builder.limit).toHaveBeenCalledWith(10);
  });

  it("returns [] (never null/undefined) when data is null", async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    fromMock.mockReturnValue(builder);

    const { listRecentOrders } = await import("@/lib/demo-merchant/repository");
    expect(await listRecentOrders(10)).toEqual([]);
  });
});

describe("countFulfilmentsForOrderIds", () => {
  it("returns an empty map without querying when orderIds is empty", async () => {
    const { countFulfilmentsForOrderIds } =
      await import("@/lib/demo-merchant/repository");
    const result = await countFulfilmentsForOrderIds([]);
    expect(result.size).toBe(0);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("groups real fulfilments rows by order_id into per-order counts", async () => {
    const builder = makeQueryBuilder({
      data: [{ order_id: "a" }, { order_id: "a" }, { order_id: "b" }],
      error: null,
    });
    fromMock.mockReturnValue(builder);

    const { countFulfilmentsForOrderIds } =
      await import("@/lib/demo-merchant/repository");
    const result = await countFulfilmentsForOrderIds(["a", "b", "c"]);

    expect(fromMock).toHaveBeenCalledWith("fulfilments");
    expect(result.get("a")).toBe(2);
    expect(result.get("b")).toBe(1);
    expect(result.get("c")).toBeUndefined();
  });
});

describe("lib/demo-merchant/repository.ts — structural server-only boundary", () => {
  const source = fs.readFileSync(
    path.resolve(
      import.meta.dirname,
      "../../../lib/demo-merchant/repository.ts",
    ),
    "utf-8",
  );

  it("imports the server-only marker package as its first import", () => {
    expect(source).toMatch(/^import\s+["']server-only["'];/m);
  });

  it("InsertOrderInput contains ONLY amountSubunits/currency — no id/status fields", () => {
    const match = source.match(
      /export interface InsertOrderInput\s*\{([\s\S]*?)\}/,
    );
    expect(match).not.toBeNull();
    const body = match![1]!;
    expect(body).toMatch(/amountSubunits/);
    expect(body).toMatch(/currency/);
    for (const forbidden of [
      "paymentStatus",
      "businessStatus",
      "payment_status",
      "business_status",
      "\\bid\\b",
      "createdAt",
      "updatedAt",
    ]) {
      expect(body).not.toMatch(new RegExp(forbidden));
    }
  });
});
