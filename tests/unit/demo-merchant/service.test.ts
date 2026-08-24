import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 1E/2B: `lib/demo-merchant/service.ts` behavior against MOCKED
// repository/adapter/logger modules (no network) — proves the assembly or
// wiring, not real Supabase/Razorpay behavior (covered by the integration
// test and manual verification respectively).
vi.mock("server-only", () => ({}));

const insertOrderMock = vi.fn();
const listRecentOrdersMock = vi.fn();
const countFulfilmentsForOrderIdsMock = vi.fn();
const getOrderByIdMock = vi.fn();
const getLatestPaymentAttemptForOrderMock = vi.fn();
const listLatestPaymentAttemptsForOrderIdsMock = vi.fn();
const insertPaymentAttemptMock = vi.fn();
const markPaymentAttemptOrderCreatedMock = vi.fn();
const markPaymentAttemptFailedObservedMock = vi.fn();

vi.mock("@/lib/demo-merchant/repository", () => ({
  insertOrder: insertOrderMock,
  listRecentOrders: listRecentOrdersMock,
  countFulfilmentsForOrderIds: countFulfilmentsForOrderIdsMock,
  getOrderById: getOrderByIdMock,
  getLatestPaymentAttemptForOrder: getLatestPaymentAttemptForOrderMock,
  listLatestPaymentAttemptsForOrderIds:
    listLatestPaymentAttemptsForOrderIdsMock,
  insertPaymentAttempt: insertPaymentAttemptMock,
  markPaymentAttemptOrderCreated: markPaymentAttemptOrderCreatedMock,
  markPaymentAttemptFailedObserved: markPaymentAttemptFailedObservedMock,
}));

const createRazorpayOrderMock = vi.fn();

class FakeRazorpayOrderRejectedError extends Error {
  readonly httpStatus: number;
  readonly safeErrorCode: string | undefined;
  constructor(
    httpStatus: number,
    safeErrorCode: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "RazorpayOrderRejectedError";
    this.httpStatus = httpStatus;
    this.safeErrorCode = safeErrorCode;
  }
}
class FakeRazorpayOrderAmbiguousError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RazorpayOrderAmbiguousError";
  }
}

vi.mock("@/lib/razorpay/adapter", () => ({
  createRazorpayOrder: createRazorpayOrderMock,
  RazorpayOrderRejectedError: FakeRazorpayOrderRejectedError,
  RazorpayOrderAmbiguousError: FakeRazorpayOrderAmbiguousError,
}));

const logEventMock = vi.fn();
vi.mock("@/lib/security/logger", () => ({
  logEvent: logEventMock,
}));

const VALID_ORDER_ID = "11111111-1111-1111-1111-111111111111";

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_ORDER_ID,
    amount_subunits: 50000,
    currency: "INR",
    payment_status: "UNPAID",
    business_status: "OPEN",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function attemptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "attempt-1",
    order_id: VALID_ORDER_ID,
    attempt_no: 1,
    amount_subunits: 50000,
    currency: "INR",
    status: "CREATED",
    razorpay_receipt: "pc_order_1_1_fake-uuid",
    razorpay_order_id: null,
    razorpay_order_status: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  insertOrderMock.mockReset();
  listRecentOrdersMock.mockReset();
  countFulfilmentsForOrderIdsMock.mockReset();
  getOrderByIdMock.mockReset();
  getLatestPaymentAttemptForOrderMock.mockReset();
  listLatestPaymentAttemptsForOrderIdsMock
    .mockReset()
    .mockResolvedValue(new Map());
  insertPaymentAttemptMock.mockReset();
  markPaymentAttemptOrderCreatedMock.mockReset();
  markPaymentAttemptFailedObservedMock.mockReset();
  createRazorpayOrderMock.mockReset();
  logEventMock.mockReset();
});

describe("createDemoMerchantOrder", () => {
  it("inserts using ONLY the fixed DEMO_MERCHANT_PRODUCT amount/currency (no browser-supplied terms possible)", async () => {
    const persistedRow = {
      id: "33333333-3333-3333-3333-333333333333",
      amount_subunits: 50000,
      currency: "INR",
      payment_status: "UNPAID",
      business_status: "OPEN",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    insertOrderMock.mockResolvedValue(persistedRow);
    countFulfilmentsForOrderIdsMock.mockResolvedValue(new Map());

    const { createDemoMerchantOrder } =
      await import("@/lib/demo-merchant/service");
    const { DEMO_MERCHANT_PRODUCT } =
      await import("@/lib/demo-merchant/product");

    const result = await createDemoMerchantOrder();

    expect(insertOrderMock).toHaveBeenCalledWith({
      amountSubunits: DEMO_MERCHANT_PRODUCT.amountSubunits,
      currency: DEMO_MERCHANT_PRODUCT.currency,
    });
    // createDemoMerchantOrder itself takes no parameters at all — statically
    // enforced (the function is declared with an empty parameter list) —
    // this call-args assertion proves what was actually forwarded to the
    // repository can only be the fixed product's terms.
    expect(result.conceptualState).toBe("CREATED");
    expect(result.paymentStatus).toBe("UNPAID");
    expect(result.businessStatus).toBe("OPEN");
    expect(result.fulfilmentCount).toBe(0);
    expect(result.id).toBe(persistedRow.id);
  });

  it("createDemoMerchantOrder is declared with zero parameters", async () => {
    const { createDemoMerchantOrder } =
      await import("@/lib/demo-merchant/service");
    expect(createDemoMerchantOrder.length).toBe(0);
  });
});

describe("listDemoMerchantOrders", () => {
  it("returns [] without querying fulfilment counts when there are no orders", async () => {
    listRecentOrdersMock.mockResolvedValue([]);

    const { listDemoMerchantOrders } =
      await import("@/lib/demo-merchant/service");
    const result = await listDemoMerchantOrders(10);

    expect(result).toEqual([]);
    expect(countFulfilmentsForOrderIdsMock).not.toHaveBeenCalled();
  });

  it("maps each row through the real fulfilment count map (never hardcodes 0)", async () => {
    const rowA = {
      id: "a",
      amount_subunits: 50000,
      currency: "INR",
      payment_status: "UNPAID",
      business_status: "OPEN",
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    };
    listRecentOrdersMock.mockResolvedValue([rowA]);
    countFulfilmentsForOrderIdsMock.mockResolvedValue(new Map([["a", 0]]));

    const { listDemoMerchantOrders } =
      await import("@/lib/demo-merchant/service");
    const result = await listDemoMerchantOrders(10);

    expect(countFulfilmentsForOrderIdsMock).toHaveBeenCalledWith(["a"]);
    expect(result).toHaveLength(1);
    expect(result[0]?.fulfilmentCount).toBe(0);
    expect(result[0]?.conceptualState).toBe("CREATED");
  });

  it("also resolves each order's latest payment attempt (never hardcodes null)", async () => {
    const rowA = orderRow({ id: "a" });
    listRecentOrdersMock.mockResolvedValue([rowA]);
    countFulfilmentsForOrderIdsMock.mockResolvedValue(new Map([["a", 0]]));
    listLatestPaymentAttemptsForOrderIdsMock.mockResolvedValue(
      new Map([["a", attemptRow({ order_id: "a" })]]),
    );

    const { listDemoMerchantOrders } =
      await import("@/lib/demo-merchant/service");
    const result = await listDemoMerchantOrders(10);

    expect(listLatestPaymentAttemptsForOrderIdsMock).toHaveBeenCalledWith([
      "a",
    ]);
    expect(result[0]?.latestPaymentAttempt?.status).toBe("CREATED");
  });
});

describe("createRazorpayOrderForMerchantOrder", () => {
  it("rejects a malformed order id before ever querying the database", async () => {
    const {
      createRazorpayOrderForMerchantOrder,
      DemoMerchantOrderNotFoundError,
    } = await import("@/lib/demo-merchant/service");

    await expect(
      createRazorpayOrderForMerchantOrder("not-a-uuid"),
    ).rejects.toThrow(DemoMerchantOrderNotFoundError);
    expect(getOrderByIdMock).not.toHaveBeenCalled();
  });

  it("throws DemoMerchantOrderNotFoundError when the order does not exist", async () => {
    getOrderByIdMock.mockResolvedValue(null);

    const {
      createRazorpayOrderForMerchantOrder,
      DemoMerchantOrderNotFoundError,
    } = await import("@/lib/demo-merchant/service");

    await expect(
      createRazorpayOrderForMerchantOrder(VALID_ORDER_ID),
    ).rejects.toThrow(DemoMerchantOrderNotFoundError);
    expect(createRazorpayOrderMock).not.toHaveBeenCalled();
  });

  it("derives amount/currency from the stored order — there is no parameter for the browser to override them with", async () => {
    getOrderByIdMock.mockResolvedValue(orderRow());
    getLatestPaymentAttemptForOrderMock.mockResolvedValue(null);
    insertPaymentAttemptMock.mockResolvedValue(attemptRow());
    createRazorpayOrderMock.mockResolvedValue({
      razorpayOrderId: "order_fake_id",
      razorpayOrderStatus: "created",
    });
    markPaymentAttemptOrderCreatedMock.mockResolvedValue(
      attemptRow({
        status: "ORDER_CREATED",
        razorpay_order_id: "order_fake_id",
        razorpay_order_status: "created",
      }),
    );

    const { createRazorpayOrderForMerchantOrder } =
      await import("@/lib/demo-merchant/service");

    // createRazorpayOrderForMerchantOrder(orderId) — a single parameter,
    // statically enforced: no amount/currency/receipt argument exists.
    expect(
      (await import("@/lib/demo-merchant/service"))
        .createRazorpayOrderForMerchantOrder.length,
    ).toBe(1);

    await createRazorpayOrderForMerchantOrder(VALID_ORDER_ID);

    expect(insertPaymentAttemptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: VALID_ORDER_ID,
        amountSubunits: 50000,
        currency: "INR",
      }),
    );
    expect(createRazorpayOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({ amountSubunits: 50000, currency: "INR" }),
    );
  });

  it("attempt_no follows the existing sequence: first attempt is 1, next attempt after a resolved one is 2", async () => {
    getOrderByIdMock.mockResolvedValue(orderRow());
    getLatestPaymentAttemptForOrderMock.mockResolvedValue(
      attemptRow({ attempt_no: 1, status: "ORDER_CREATED" }),
    );
    insertPaymentAttemptMock.mockResolvedValue(
      attemptRow({ id: "attempt-2", attempt_no: 2 }),
    );
    createRazorpayOrderMock.mockResolvedValue({
      razorpayOrderId: "order_fake_id_2",
      razorpayOrderStatus: "created",
    });
    markPaymentAttemptOrderCreatedMock.mockResolvedValue(
      attemptRow({ id: "attempt-2", attempt_no: 2, status: "ORDER_CREATED" }),
    );

    const { createRazorpayOrderForMerchantOrder } =
      await import("@/lib/demo-merchant/service");
    await createRazorpayOrderForMerchantOrder(VALID_ORDER_ID);

    expect(insertPaymentAttemptMock).toHaveBeenCalledWith(
      expect.objectContaining({ attemptNo: 2 }),
    );
  });

  it("reuses an existing unresolved (CREATED) attempt with its same stable receipt instead of creating a new one", async () => {
    getOrderByIdMock.mockResolvedValue(orderRow());
    const existing = attemptRow({ status: "CREATED" });
    getLatestPaymentAttemptForOrderMock.mockResolvedValue(existing);
    createRazorpayOrderMock.mockResolvedValue({
      razorpayOrderId: "order_fake_id",
      razorpayOrderStatus: "created",
    });
    markPaymentAttemptOrderCreatedMock.mockResolvedValue(
      attemptRow({ status: "ORDER_CREATED" }),
    );

    const { createRazorpayOrderForMerchantOrder } =
      await import("@/lib/demo-merchant/service");
    await createRazorpayOrderForMerchantOrder(VALID_ORDER_ID);

    expect(insertPaymentAttemptMock).not.toHaveBeenCalled();
    expect(createRazorpayOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({ receipt: existing.razorpay_receipt }),
    );
  });

  it("does NOT reuse a FAILED_OBSERVED attempt — it is resolved, immutable evidence (Phase 2B correction)", async () => {
    // Confirmed real-world defect: FAILED_OBSERVED means Razorpay
    // DEFINITELY rejected the request already (a resolved outcome, not an
    // ambiguous one) — blindly resending the identical rejected request
    // (same invalid receipt) was the actual production bug. A later retry
    // must create attempt #2 with a brand-new receipt instead.
    getOrderByIdMock.mockResolvedValue(orderRow());
    const failedAttempt = attemptRow({
      id: "attempt-1",
      attempt_no: 1,
      status: "FAILED_OBSERVED",
    });
    getLatestPaymentAttemptForOrderMock.mockResolvedValue(failedAttempt);
    insertPaymentAttemptMock.mockResolvedValue(
      attemptRow({
        id: "attempt-2",
        attempt_no: 2,
        razorpay_receipt: "pc_new_receipt",
      }),
    );
    createRazorpayOrderMock.mockResolvedValue({
      razorpayOrderId: "order_fake_id_2",
      razorpayOrderStatus: "created",
    });
    markPaymentAttemptOrderCreatedMock.mockResolvedValue(
      attemptRow({ id: "attempt-2", attempt_no: 2, status: "ORDER_CREATED" }),
    );

    const { createRazorpayOrderForMerchantOrder } =
      await import("@/lib/demo-merchant/service");
    await createRazorpayOrderForMerchantOrder(VALID_ORDER_ID);

    // A genuinely new attempt is created — attempt_no 2, a freshly
    // generated receipt (distinct from failedAttempt's rejected one) is
    // what gets passed INTO insertPaymentAttempt...
    expect(insertPaymentAttemptMock).toHaveBeenCalledWith(
      expect.objectContaining({ attemptNo: 2 }),
    );
    const generatedReceipt = insertPaymentAttemptMock.mock.calls[0]?.[0]
      ?.razorpayReceipt as string;
    expect(generatedReceipt).not.toBe(failedAttempt.razorpay_receipt);

    // ...and the Razorpay adapter is called with whatever the (mocked)
    // persisted row's own razorpay_receipt is — never with the old
    // rejected attempt's receipt. insertPaymentAttemptMock above resolves
    // to a fixed row (`razorpay_receipt: "pc_new_receipt"`), so that is
    // the value the code actually forwards to the adapter.
    expect(createRazorpayOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({ receipt: "pc_new_receipt" }),
    );
    expect(createRazorpayOrderMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ receipt: failedAttempt.razorpay_receipt }),
    );
  });

  it("the original FAILED_OBSERVED attempt is never mutated when a new attempt is created for the same order", async () => {
    getOrderByIdMock.mockResolvedValue(orderRow());
    getLatestPaymentAttemptForOrderMock.mockResolvedValue(
      attemptRow({ id: "attempt-1", attempt_no: 1, status: "FAILED_OBSERVED" }),
    );
    insertPaymentAttemptMock.mockResolvedValue(
      attemptRow({ id: "attempt-2", attempt_no: 2 }),
    );
    createRazorpayOrderMock.mockResolvedValue({
      razorpayOrderId: "order_fake_id_2",
      razorpayOrderStatus: "created",
    });
    markPaymentAttemptOrderCreatedMock.mockResolvedValue(
      attemptRow({ id: "attempt-2", attempt_no: 2, status: "ORDER_CREATED" }),
    );

    const { createRazorpayOrderForMerchantOrder } =
      await import("@/lib/demo-merchant/service");
    await createRazorpayOrderForMerchantOrder(VALID_ORDER_ID);

    // Neither mutation function is ever called with the original attempt's
    // id — attempt-1 remains completely untouched.
    expect(markPaymentAttemptOrderCreatedMock).not.toHaveBeenCalledWith(
      "attempt-1",
      expect.anything(),
    );
    expect(markPaymentAttemptFailedObservedMock).not.toHaveBeenCalledWith(
      "attempt-1",
    );
  });

  it("network/5xx ambiguous handling does not create a replacement attempt merely because the outcome is unknown", async () => {
    getOrderByIdMock.mockResolvedValue(orderRow());
    getLatestPaymentAttemptForOrderMock.mockResolvedValue(null);
    const created = attemptRow({ status: "CREATED" });
    insertPaymentAttemptMock.mockResolvedValue(created);
    createRazorpayOrderMock.mockRejectedValue(
      new FakeRazorpayOrderAmbiguousError("5xx / network failure"),
    );

    const { createRazorpayOrderForMerchantOrder } =
      await import("@/lib/demo-merchant/service");

    await expect(
      createRazorpayOrderForMerchantOrder(VALID_ORDER_ID),
    ).rejects.toThrow(FakeRazorpayOrderAmbiguousError);

    // Exactly one attempt was ever inserted for this call — no second
    // "replacement" attempt was created just because the outcome of the
    // first was unknown.
    expect(insertPaymentAttemptMock).toHaveBeenCalledTimes(1);
    expect(markPaymentAttemptFailedObservedMock).not.toHaveBeenCalled();
    expect(markPaymentAttemptOrderCreatedMock).not.toHaveBeenCalled();
  });

  it("a later call after an ambiguous outcome reuses the SAME still-CREATED attempt and receipt (not a new attempt_no)", async () => {
    getOrderByIdMock.mockResolvedValue(orderRow());
    // The attempt left behind by a prior ambiguous outcome: still CREATED,
    // same receipt, never mutated.
    const stillCreated = attemptRow({ id: "attempt-1", status: "CREATED" });
    getLatestPaymentAttemptForOrderMock.mockResolvedValue(stillCreated);
    createRazorpayOrderMock.mockResolvedValue({
      razorpayOrderId: "order_fake_id",
      razorpayOrderStatus: "created",
    });
    markPaymentAttemptOrderCreatedMock.mockResolvedValue(
      attemptRow({ id: "attempt-1", status: "ORDER_CREATED" }),
    );

    const { createRazorpayOrderForMerchantOrder } =
      await import("@/lib/demo-merchant/service");
    await createRazorpayOrderForMerchantOrder(VALID_ORDER_ID);

    expect(insertPaymentAttemptMock).not.toHaveBeenCalled();
    expect(createRazorpayOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({ receipt: stillCreated.razorpay_receipt }),
    );
  });

  it("a successful new attempt after a FAILED_OBSERVED rejection still persists Razorpay Order ID/status and becomes ORDER_CREATED", async () => {
    getOrderByIdMock.mockResolvedValue(orderRow());
    getLatestPaymentAttemptForOrderMock.mockResolvedValue(
      attemptRow({ id: "attempt-1", attempt_no: 1, status: "FAILED_OBSERVED" }),
    );
    insertPaymentAttemptMock.mockResolvedValue(
      attemptRow({ id: "attempt-2", attempt_no: 2 }),
    );
    createRazorpayOrderMock.mockResolvedValue({
      razorpayOrderId: "order_real_shaped_id",
      razorpayOrderStatus: "created",
    });
    markPaymentAttemptOrderCreatedMock.mockResolvedValue(
      attemptRow({
        id: "attempt-2",
        attempt_no: 2,
        status: "ORDER_CREATED",
        razorpay_order_id: "order_real_shaped_id",
        razorpay_order_status: "created",
      }),
    );

    const { createRazorpayOrderForMerchantOrder } =
      await import("@/lib/demo-merchant/service");
    const result = await createRazorpayOrderForMerchantOrder(VALID_ORDER_ID);

    expect(markPaymentAttemptOrderCreatedMock).toHaveBeenCalledWith(
      "attempt-2",
      {
        razorpayOrderId: "order_real_shaped_id",
        razorpayOrderStatus: "created",
      },
    );
    expect(result.status).toBe("ORDER_CREATED");
    expect(result.razorpayOrderId).toBe("order_real_shaped_id");
    expect(result.razorpayOrderStatus).toBe("created");
  });

  it("the merchant order/business status/fulfilment are never touched by this service — no such repository function is even called", async () => {
    // Structural guarantee: the mocked repository module exposes no
    // order-update or fulfilment-insert function at all, so regardless of
    // outcome (success, rejection, or a FAILED_OBSERVED-triggered new
    // attempt), orders.payment_status/business_status and fulfilments
    // cannot be mutated by this code path.
    getOrderByIdMock.mockResolvedValue(orderRow());
    getLatestPaymentAttemptForOrderMock.mockResolvedValue(
      attemptRow({ status: "FAILED_OBSERVED" }),
    );
    insertPaymentAttemptMock.mockResolvedValue(
      attemptRow({ id: "attempt-2", attempt_no: 2 }),
    );
    createRazorpayOrderMock.mockResolvedValue({
      razorpayOrderId: "order_fake_id",
      razorpayOrderStatus: "created",
    });
    markPaymentAttemptOrderCreatedMock.mockResolvedValue(
      attemptRow({ id: "attempt-2", attempt_no: 2, status: "ORDER_CREATED" }),
    );

    const { createRazorpayOrderForMerchantOrder } =
      await import("@/lib/demo-merchant/service");
    await createRazorpayOrderForMerchantOrder(VALID_ORDER_ID);

    expect(insertOrderMock).not.toHaveBeenCalled();
  });

  it("generated receipt for a new attempt is non-empty, unique-looking (pc_ + 32 hex chars), and at most 40 characters", async () => {
    getOrderByIdMock.mockResolvedValue(orderRow());
    getLatestPaymentAttemptForOrderMock.mockResolvedValue(null);
    insertPaymentAttemptMock.mockResolvedValue(attemptRow());
    createRazorpayOrderMock.mockResolvedValue({
      razorpayOrderId: "order_fake_id",
      razorpayOrderStatus: "created",
    });
    markPaymentAttemptOrderCreatedMock.mockResolvedValue(
      attemptRow({ status: "ORDER_CREATED" }),
    );

    const { createRazorpayOrderForMerchantOrder } =
      await import("@/lib/demo-merchant/service");
    await createRazorpayOrderForMerchantOrder(VALID_ORDER_ID);

    const receipt = insertPaymentAttemptMock.mock.calls[0]?.[0]
      ?.razorpayReceipt as string;
    expect(receipt.length).toBeGreaterThan(0);
    expect(receipt.length).toBeLessThanOrEqual(40);
    expect(receipt).toMatch(/^pc_[0-9a-f]{32}$/);
  });

  it("two separately generated receipts are never identical (uniqueness)", async () => {
    getOrderByIdMock.mockResolvedValue(orderRow());
    getLatestPaymentAttemptForOrderMock.mockResolvedValue(null);
    insertPaymentAttemptMock.mockResolvedValue(attemptRow());
    createRazorpayOrderMock.mockResolvedValue({
      razorpayOrderId: "order_fake_id",
      razorpayOrderStatus: "created",
    });
    markPaymentAttemptOrderCreatedMock.mockResolvedValue(
      attemptRow({ status: "ORDER_CREATED" }),
    );

    const { createRazorpayOrderForMerchantOrder } =
      await import("@/lib/demo-merchant/service");

    await createRazorpayOrderForMerchantOrder(VALID_ORDER_ID);
    const firstReceipt = insertPaymentAttemptMock.mock.calls[0]?.[0]
      ?.razorpayReceipt as string;

    insertPaymentAttemptMock.mockClear();
    await createRazorpayOrderForMerchantOrder(VALID_ORDER_ID);
    const secondReceipt = insertPaymentAttemptMock.mock.calls[0]?.[0]
      ?.razorpayReceipt as string;

    expect(firstReceipt).not.toBe(secondReceipt);
  });

  it("does NOT reuse an already ORDER_CREATED attempt — creates a genuinely new one instead", async () => {
    getOrderByIdMock.mockResolvedValue(orderRow());
    getLatestPaymentAttemptForOrderMock.mockResolvedValue(
      attemptRow({ attempt_no: 1, status: "ORDER_CREATED" }),
    );
    insertPaymentAttemptMock.mockResolvedValue(
      attemptRow({ id: "attempt-2", attempt_no: 2 }),
    );
    createRazorpayOrderMock.mockResolvedValue({
      razorpayOrderId: "order_fake_id_2",
      razorpayOrderStatus: "created",
    });
    markPaymentAttemptOrderCreatedMock.mockResolvedValue(
      attemptRow({ id: "attempt-2", attempt_no: 2, status: "ORDER_CREATED" }),
    );

    const { createRazorpayOrderForMerchantOrder } =
      await import("@/lib/demo-merchant/service");
    await createRazorpayOrderForMerchantOrder(VALID_ORDER_ID);

    expect(insertPaymentAttemptMock).toHaveBeenCalledTimes(1);
  });

  it("on success: persists razorpay_order_id/status and returns status ORDER_CREATED", async () => {
    getOrderByIdMock.mockResolvedValue(orderRow());
    getLatestPaymentAttemptForOrderMock.mockResolvedValue(null);
    insertPaymentAttemptMock.mockResolvedValue(attemptRow());
    createRazorpayOrderMock.mockResolvedValue({
      razorpayOrderId: "order_fake_id",
      razorpayOrderStatus: "created",
    });
    markPaymentAttemptOrderCreatedMock.mockResolvedValue(
      attemptRow({
        status: "ORDER_CREATED",
        razorpay_order_id: "order_fake_id",
        razorpay_order_status: "created",
      }),
    );

    const { createRazorpayOrderForMerchantOrder } =
      await import("@/lib/demo-merchant/service");
    const result = await createRazorpayOrderForMerchantOrder(VALID_ORDER_ID);

    expect(markPaymentAttemptOrderCreatedMock).toHaveBeenCalledWith(
      "attempt-1",
      { razorpayOrderId: "order_fake_id", razorpayOrderStatus: "created" },
    );
    expect(result.status).toBe("ORDER_CREATED");
    expect(result.razorpayOrderId).toBe("order_fake_id");
    expect(result.razorpayOrderStatus).toBe("created");
    expect(markPaymentAttemptFailedObservedMock).not.toHaveBeenCalled();
  });

  it("on a definite provider rejection: marks the attempt FAILED_OBSERVED, does not fabricate an order id, and rethrows", async () => {
    getOrderByIdMock.mockResolvedValue(orderRow());
    getLatestPaymentAttemptForOrderMock.mockResolvedValue(null);
    insertPaymentAttemptMock.mockResolvedValue(attemptRow());
    createRazorpayOrderMock.mockRejectedValue(
      new FakeRazorpayOrderRejectedError(400, "BAD_REQUEST_ERROR", "rejected"),
    );
    markPaymentAttemptFailedObservedMock.mockResolvedValue(
      attemptRow({ status: "FAILED_OBSERVED" }),
    );

    const { createRazorpayOrderForMerchantOrder } =
      await import("@/lib/demo-merchant/service");

    await expect(
      createRazorpayOrderForMerchantOrder(VALID_ORDER_ID),
    ).rejects.toThrow(FakeRazorpayOrderRejectedError);

    expect(markPaymentAttemptFailedObservedMock).toHaveBeenCalledWith(
      "attempt-1",
    );
    expect(markPaymentAttemptOrderCreatedMock).not.toHaveBeenCalled();
  });

  it("on an ambiguous outcome: does NOT mutate the attempt at all (no FAILED_OBSERVED, no ORDER_CREATED) and rethrows", async () => {
    getOrderByIdMock.mockResolvedValue(orderRow());
    getLatestPaymentAttemptForOrderMock.mockResolvedValue(null);
    insertPaymentAttemptMock.mockResolvedValue(attemptRow());
    createRazorpayOrderMock.mockRejectedValue(
      new FakeRazorpayOrderAmbiguousError("network failure"),
    );

    const { createRazorpayOrderForMerchantOrder } =
      await import("@/lib/demo-merchant/service");

    await expect(
      createRazorpayOrderForMerchantOrder(VALID_ORDER_ID),
    ).rejects.toThrow(FakeRazorpayOrderAmbiguousError);

    expect(markPaymentAttemptFailedObservedMock).not.toHaveBeenCalled();
    expect(markPaymentAttemptOrderCreatedMock).not.toHaveBeenCalled();
  });

  it("never marks the merchant order PAID and never creates a fulfilment (no such calls exist in this module's dependency set)", async () => {
    // Structural guarantee: the mocked repository module above does not
    // even expose an order-update or fulfilment-insert function, so this
    // service cannot call one — proven by the successful-path test above
    // completing without any repository call beyond the payment_attempts
    // ones already asserted.
    getOrderByIdMock.mockResolvedValue(orderRow());
    getLatestPaymentAttemptForOrderMock.mockResolvedValue(null);
    insertPaymentAttemptMock.mockResolvedValue(attemptRow());
    createRazorpayOrderMock.mockResolvedValue({
      razorpayOrderId: "order_fake_id",
      razorpayOrderStatus: "created",
    });
    markPaymentAttemptOrderCreatedMock.mockResolvedValue(
      attemptRow({ status: "ORDER_CREATED" }),
    );

    const { createRazorpayOrderForMerchantOrder } =
      await import("@/lib/demo-merchant/service");
    await createRazorpayOrderForMerchantOrder(VALID_ORDER_ID);

    expect(insertOrderMock).not.toHaveBeenCalled();
  });
});
