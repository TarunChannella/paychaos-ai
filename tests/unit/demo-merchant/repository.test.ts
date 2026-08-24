import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Phase 1E/2B: `lib/demo-merchant/repository.ts` behavior is exercised here
// against a MOCKED Supabase client (no network) — real-Supabase behavior is
// separately proven by
// tests/integration/supabase/045-demo-merchant-service.integration.test.ts
// and tests/integration/supabase/046-payment-attempt-razorpay-correlation.integration.test.ts.
vi.mock("server-only", () => ({}));

interface MockResult {
  data: unknown;
  error: unknown;
}

type InsertFn = (payload: Record<string, unknown>) => FakeQueryBuilder;
type SelectFn = () => FakeQueryBuilder;
type SingleFn = () => Promise<MockResult>;
type MaybeSingleFn = () => Promise<MockResult>;
type OrderFn = () => FakeQueryBuilder;
type LimitFn = (limit: number) => FakeQueryBuilder;
type InFn = (column: string, values: readonly string[]) => FakeQueryBuilder;
type EqFn = (column: string, value: unknown) => FakeQueryBuilder;
type UpdateFn = (payload: Record<string, unknown>) => FakeQueryBuilder;

/**
 * Mirrors the real `@supabase/supabase-js` `PostgrestFilterBuilder`: every
 * chainable method (`insert`/`select`/`order`/`limit`/`in`/`eq`/`update`)
 * returns the SAME builder instance, and the builder itself is thenable
 * (`PromiseLike<MockResult>`) so a caller may `await` the chain directly
 * (e.g. `listRecentOrders`'s `.select().order().limit(10)`, never calling
 * `.single()`/`.maybeSingle()`) OR call a terminal `.single()`/
 * `.maybeSingle()` after any number of chained calls (e.g.
 * `getLatestPaymentAttemptForOrder`'s `.select().eq().order().limit(1).maybeSingle()`).
 */
interface FakeQueryBuilder extends PromiseLike<MockResult> {
  insert: Mock<InsertFn>;
  select: Mock<SelectFn>;
  single: Mock<SingleFn>;
  maybeSingle: Mock<MaybeSingleFn>;
  order: Mock<OrderFn>;
  limit: Mock<LimitFn>;
  in: Mock<InFn>;
  eq: Mock<EqFn>;
  update: Mock<UpdateFn>;
}

/**
 * Each mock's call signature is set via `vi.fn`'s explicit type parameter
 * (rather than named implementation parameters) — the same pattern already
 * established in tests/unit/supabase/server.test.ts's `createClientMock`
 * fix — so call-shape assertions (e.g. `builder.insert.mock.calls[0]?.[0]`)
 * keep type-checking without declaring any unused parameter names in the
 * implementation body.
 */
function makeQueryBuilder(result: MockResult): FakeQueryBuilder {
  const builder: FakeQueryBuilder = {
    insert: vi.fn<InsertFn>(() => builder),
    select: vi.fn<SelectFn>(() => builder),
    single: vi.fn<SingleFn>(async () => result),
    maybeSingle: vi.fn<MaybeSingleFn>(async () => result),
    order: vi.fn<OrderFn>(() => builder),
    limit: vi.fn<LimitFn>(() => builder),
    in: vi.fn<InFn>(() => builder),
    eq: vi.fn<EqFn>(() => builder),
    update: vi.fn<UpdateFn>(() => builder),
    then: (onfulfilled, onrejected) =>
      Promise.resolve(result).then(onfulfilled, onrejected),
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

describe("getOrderById", () => {
  it("looks up by id and returns the row", async () => {
    const orderRow = {
      id: "11111111-1111-1111-1111-111111111111",
      amount_subunits: 50000,
      currency: "INR",
      payment_status: "UNPAID",
      business_status: "OPEN",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const builder = makeQueryBuilder({ data: orderRow, error: null });
    fromMock.mockReturnValue(builder);

    const { getOrderById } = await import("@/lib/demo-merchant/repository");
    const result = await getOrderById(orderRow.id);

    expect(fromMock).toHaveBeenCalledWith("orders");
    expect(builder.eq).toHaveBeenCalledWith("id", orderRow.id);
    expect(result).toEqual(orderRow);
  });

  it("returns null when no order matches", async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    fromMock.mockReturnValue(builder);

    const { getOrderById } = await import("@/lib/demo-merchant/repository");
    expect(await getOrderById("does-not-exist")).toBeNull();
  });

  it("throws DemoMerchantRepositoryError on a query error", async () => {
    const builder = makeQueryBuilder({
      data: null,
      error: { message: "connection string leaked here" },
    });
    fromMock.mockReturnValue(builder);

    const { getOrderById, DemoMerchantRepositoryError } =
      await import("@/lib/demo-merchant/repository");
    await expect(getOrderById("x")).rejects.toThrow(
      DemoMerchantRepositoryError,
    );
  });
});

describe("getLatestPaymentAttemptForOrder", () => {
  it("orders by attempt_no descending and limits to 1", async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    fromMock.mockReturnValue(builder);

    const { getLatestPaymentAttemptForOrder } =
      await import("@/lib/demo-merchant/repository");
    await getLatestPaymentAttemptForOrder("order-1");

    expect(fromMock).toHaveBeenCalledWith("payment_attempts");
    expect(builder.eq).toHaveBeenCalledWith("order_id", "order-1");
    expect(builder.order).toHaveBeenCalledWith("attempt_no", {
      ascending: false,
    });
    expect(builder.limit).toHaveBeenCalledWith(1);
  });

  it("returns null when the order has no attempts yet", async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    fromMock.mockReturnValue(builder);

    const { getLatestPaymentAttemptForOrder } =
      await import("@/lib/demo-merchant/repository");
    expect(await getLatestPaymentAttemptForOrder("order-1")).toBeNull();
  });
});

describe("listLatestPaymentAttemptsForOrderIds", () => {
  it("returns an empty map without querying when orderIds is empty", async () => {
    const { listLatestPaymentAttemptsForOrderIds } =
      await import("@/lib/demo-merchant/repository");
    const result = await listLatestPaymentAttemptsForOrderIds([]);
    expect(result.size).toBe(0);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("keeps only the highest attempt_no row per order_id (rows arrive attempt_no-descending)", async () => {
    const rowA2 = { id: "a2", order_id: "a", attempt_no: 2 };
    const rowA1 = { id: "a1", order_id: "a", attempt_no: 1 };
    const rowB1 = { id: "b1", order_id: "b", attempt_no: 1 };
    const builder = makeQueryBuilder({
      data: [rowA2, rowA1, rowB1],
      error: null,
    });
    fromMock.mockReturnValue(builder);

    const { listLatestPaymentAttemptsForOrderIds } =
      await import("@/lib/demo-merchant/repository");
    const result = await listLatestPaymentAttemptsForOrderIds(["a", "b", "c"]);

    expect(fromMock).toHaveBeenCalledWith("payment_attempts");
    expect(builder.order).toHaveBeenCalledWith("attempt_no", {
      ascending: false,
    });
    expect(result.get("a")).toEqual(rowA2);
    expect(result.get("b")).toEqual(rowB1);
    expect(result.get("c")).toBeUndefined();
  });
});

describe("insertPaymentAttempt", () => {
  it("inserts using exactly orderId/attemptNo/amountSubunits/currency/razorpayReceipt", async () => {
    const persistedRow = {
      id: "attempt-1",
      order_id: "order-1",
      attempt_no: 1,
      amount_subunits: 50000,
      currency: "INR",
      status: "CREATED",
      razorpay_receipt: "receipt-1",
      razorpay_order_id: null,
      razorpay_order_status: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const builder = makeQueryBuilder({ data: persistedRow, error: null });
    fromMock.mockReturnValue(builder);

    const { insertPaymentAttempt } =
      await import("@/lib/demo-merchant/repository");
    const result = await insertPaymentAttempt({
      orderId: "order-1",
      attemptNo: 1,
      amountSubunits: 50000,
      currency: "INR",
      razorpayReceipt: "receipt-1",
    });

    expect(fromMock).toHaveBeenCalledWith("payment_attempts");
    expect(builder.insert).toHaveBeenCalledWith({
      order_id: "order-1",
      attempt_no: 1,
      amount_subunits: 50000,
      currency: "INR",
      razorpay_receipt: "receipt-1",
    });
    // The insert payload must never include status/razorpay_order_id/
    // razorpay_order_status — those are never set at creation time.
    const insertPayload = builder.insert.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(insertPayload).sort()).toEqual([
      "amount_subunits",
      "attempt_no",
      "currency",
      "order_id",
      "razorpay_receipt",
    ]);
    expect(result).toEqual(persistedRow);
  });

  it("throws DemoMerchantRepositoryError (never leaks the raw Supabase error) when the insert fails", async () => {
    const builder = makeQueryBuilder({
      data: null,
      error: { message: "connection string leaked here" },
    });
    fromMock.mockReturnValue(builder);

    const { insertPaymentAttempt, DemoMerchantRepositoryError } =
      await import("@/lib/demo-merchant/repository");
    await expect(
      insertPaymentAttempt({
        orderId: "order-1",
        attemptNo: 1,
        amountSubunits: 50000,
        currency: "INR",
        razorpayReceipt: "receipt-1",
      }),
    ).rejects.toThrow(DemoMerchantRepositoryError);
  });
});

describe("markPaymentAttemptOrderCreated", () => {
  it("updates status to ORDER_CREATED with exactly the trusted Razorpay correlation fields", async () => {
    const updatedRow = {
      id: "attempt-1",
      status: "ORDER_CREATED",
      razorpay_order_id: "order_fake_id",
      razorpay_order_status: "created",
    };
    const builder = makeQueryBuilder({ data: updatedRow, error: null });
    fromMock.mockReturnValue(builder);

    const { markPaymentAttemptOrderCreated } =
      await import("@/lib/demo-merchant/repository");
    const result = await markPaymentAttemptOrderCreated("attempt-1", {
      razorpayOrderId: "order_fake_id",
      razorpayOrderStatus: "created",
    });

    expect(fromMock).toHaveBeenCalledWith("payment_attempts");
    expect(builder.update).toHaveBeenCalledWith({
      status: "ORDER_CREATED",
      razorpay_order_id: "order_fake_id",
      razorpay_order_status: "created",
    });
    expect(builder.eq).toHaveBeenCalledWith("id", "attempt-1");
    expect(result).toEqual(updatedRow);
  });
});

describe("markPaymentAttemptFailedObserved", () => {
  it("updates status to FAILED_OBSERVED only — never touches the Razorpay correlation fields", async () => {
    const updatedRow = { id: "attempt-1", status: "FAILED_OBSERVED" };
    const builder = makeQueryBuilder({ data: updatedRow, error: null });
    fromMock.mockReturnValue(builder);

    const { markPaymentAttemptFailedObserved } =
      await import("@/lib/demo-merchant/repository");
    const result = await markPaymentAttemptFailedObserved("attempt-1");

    expect(builder.update).toHaveBeenCalledWith({ status: "FAILED_OBSERVED" });
    expect(builder.eq).toHaveBeenCalledWith("id", "attempt-1");
    expect(result).toEqual(updatedRow);
  });
});

describe("getPaymentAttemptById", () => {
  it("looks up by id and returns the row", async () => {
    const attemptRow = {
      id: "attempt-1",
      order_id: "order-1",
      status: "ORDER_CREATED",
      razorpay_order_id: "order_fake_id",
    };
    const builder = makeQueryBuilder({ data: attemptRow, error: null });
    fromMock.mockReturnValue(builder);

    const { getPaymentAttemptById } =
      await import("@/lib/demo-merchant/repository");
    const result = await getPaymentAttemptById("attempt-1");

    expect(fromMock).toHaveBeenCalledWith("payment_attempts");
    expect(builder.eq).toHaveBeenCalledWith("id", "attempt-1");
    expect(result).toEqual(attemptRow);
  });

  it("returns null when no attempt matches", async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    fromMock.mockReturnValue(builder);

    const { getPaymentAttemptById } =
      await import("@/lib/demo-merchant/repository");
    expect(await getPaymentAttemptById("does-not-exist")).toBeNull();
  });

  it("throws DemoMerchantRepositoryError on a query error", async () => {
    const builder = makeQueryBuilder({
      data: null,
      error: { message: "connection string leaked here" },
    });
    fromMock.mockReturnValue(builder);

    const { getPaymentAttemptById, DemoMerchantRepositoryError } =
      await import("@/lib/demo-merchant/repository");
    await expect(getPaymentAttemptById("x")).rejects.toThrow(
      DemoMerchantRepositoryError,
    );
  });
});

describe("markPaymentAttemptCheckoutInProgress", () => {
  it("updates status to CHECKOUT_IN_PROGRESS only", async () => {
    const updatedRow = { id: "attempt-1", status: "CHECKOUT_IN_PROGRESS" };
    const builder = makeQueryBuilder({ data: updatedRow, error: null });
    fromMock.mockReturnValue(builder);

    const { markPaymentAttemptCheckoutInProgress } =
      await import("@/lib/demo-merchant/repository");
    const result = await markPaymentAttemptCheckoutInProgress("attempt-1");

    expect(fromMock).toHaveBeenCalledWith("payment_attempts");
    expect(builder.update).toHaveBeenCalledWith({
      status: "CHECKOUT_IN_PROGRESS",
    });
    expect(builder.eq).toHaveBeenCalledWith("id", "attempt-1");
    expect(result).toEqual(updatedRow);
  });
});

describe("getPaymentByRazorpayPaymentId", () => {
  it("looks up by razorpay_payment_id and returns the row", async () => {
    const paymentRow = {
      id: "payment-1",
      payment_attempt_id: "attempt-1",
      razorpay_payment_id: "pay_fake_id",
    };
    const builder = makeQueryBuilder({ data: paymentRow, error: null });
    fromMock.mockReturnValue(builder);

    const { getPaymentByRazorpayPaymentId } =
      await import("@/lib/demo-merchant/repository");
    const result = await getPaymentByRazorpayPaymentId("pay_fake_id");

    expect(fromMock).toHaveBeenCalledWith("payments");
    expect(builder.eq).toHaveBeenCalledWith(
      "razorpay_payment_id",
      "pay_fake_id",
    );
    expect(result).toEqual(paymentRow);
  });

  it("returns null when no payment matches", async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    fromMock.mockReturnValue(builder);

    const { getPaymentByRazorpayPaymentId } =
      await import("@/lib/demo-merchant/repository");
    expect(await getPaymentByRazorpayPaymentId("pay_none")).toBeNull();
  });
});

describe("listLatestPaymentsForAttemptIds", () => {
  it("returns an empty map without querying when attemptIds is empty", async () => {
    const { listLatestPaymentsForAttemptIds } =
      await import("@/lib/demo-merchant/repository");
    const result = await listLatestPaymentsForAttemptIds([]);
    expect(result.size).toBe(0);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("keeps only the newest row per payment_attempt_id (rows arrive created_at-descending)", async () => {
    const rowA2 = { id: "pa2", payment_attempt_id: "a", created_at: "2" };
    const rowA1 = { id: "pa1", payment_attempt_id: "a", created_at: "1" };
    const rowB1 = { id: "pb1", payment_attempt_id: "b", created_at: "1" };
    const builder = makeQueryBuilder({
      data: [rowA2, rowA1, rowB1],
      error: null,
    });
    fromMock.mockReturnValue(builder);

    const { listLatestPaymentsForAttemptIds } =
      await import("@/lib/demo-merchant/repository");
    const result = await listLatestPaymentsForAttemptIds(["a", "b", "c"]);

    expect(fromMock).toHaveBeenCalledWith("payments");
    expect(builder.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(result.get("a")).toEqual(rowA2);
    expect(result.get("b")).toEqual(rowB1);
    expect(result.get("c")).toBeUndefined();
  });
});

describe("insertVerifiedPayment", () => {
  it("inserts using exactly the trusted fields, with checkout_signature_verified true and a non-null checkout_verified_at", async () => {
    const persistedRow = {
      id: "payment-1",
      payment_attempt_id: "attempt-1",
      razorpay_payment_id: "pay_fake_id",
      razorpay_payment_status: null,
      amount_subunits: 50000,
      currency: "INR",
      checkout_signature_verified: true,
      checkout_verified_at: "2026-01-01T00:00:00.000Z",
      captured_at: null,
      failed_at: null,
    };
    const builder = makeQueryBuilder({ data: persistedRow, error: null });
    fromMock.mockReturnValue(builder);

    const { insertVerifiedPayment } =
      await import("@/lib/demo-merchant/repository");
    const result = await insertVerifiedPayment({
      paymentAttemptId: "attempt-1",
      razorpayPaymentId: "pay_fake_id",
      amountSubunits: 50000,
      currency: "INR",
    });

    expect(fromMock).toHaveBeenCalledWith("payments");
    const insertPayload = builder.insert.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(insertPayload).toMatchObject({
      payment_attempt_id: "attempt-1",
      razorpay_payment_id: "pay_fake_id",
      amount_subunits: 50000,
      currency: "INR",
      checkout_signature_verified: true,
    });
    expect(insertPayload.checkout_verified_at).toEqual(expect.any(String));
    // Must never set razorpay_payment_status/captured_at/failed_at at
    // insert time — a verified signature does not establish captured-state
    // truth (docs/MONEY_INVARIANTS.md Section 5).
    expect(Object.keys(insertPayload).sort()).toEqual([
      "amount_subunits",
      "checkout_signature_verified",
      "checkout_verified_at",
      "currency",
      "payment_attempt_id",
      "razorpay_payment_id",
    ]);
    expect(result).toEqual(persistedRow);
  });

  it("returns null (not a throw) on a unique-constraint violation (Postgres code 23505) — concurrent-insert race", async () => {
    const builder = makeQueryBuilder({
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });
    fromMock.mockReturnValue(builder);

    const { insertVerifiedPayment } =
      await import("@/lib/demo-merchant/repository");
    const result = await insertVerifiedPayment({
      paymentAttemptId: "attempt-1",
      razorpayPaymentId: "pay_fake_id",
      amountSubunits: 50000,
      currency: "INR",
    });

    expect(result).toBeNull();
  });

  it("throws DemoMerchantRepositoryError (never leaks the raw Supabase error) on any other insert failure", async () => {
    const builder = makeQueryBuilder({
      data: null,
      error: { code: "XX000", message: "connection string leaked here" },
    });
    fromMock.mockReturnValue(builder);

    const { insertVerifiedPayment, DemoMerchantRepositoryError } =
      await import("@/lib/demo-merchant/repository");
    await expect(
      insertVerifiedPayment({
        paymentAttemptId: "attempt-1",
        razorpayPaymentId: "pay_fake_id",
        amountSubunits: 50000,
        currency: "INR",
      }),
    ).rejects.toThrow(DemoMerchantRepositoryError);
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

  it("InsertPaymentAttemptInput contains no status/razorpayOrderId/razorpayOrderStatus field", () => {
    const match = source.match(
      /export interface InsertPaymentAttemptInput\s*\{([\s\S]*?)\}/,
    );
    expect(match).not.toBeNull();
    const body = match![1]!;
    expect(body).toMatch(/orderId/);
    expect(body).toMatch(/attemptNo/);
    expect(body).toMatch(/amountSubunits/);
    expect(body).toMatch(/currency/);
    expect(body).toMatch(/razorpayReceipt/);
    for (const forbidden of [
      "status",
      "razorpayOrderId",
      "razorpayOrderStatus",
    ]) {
      expect(body).not.toMatch(new RegExp(forbidden));
    }
  });
});
