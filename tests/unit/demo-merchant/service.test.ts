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
const getPaymentAttemptByIdMock = vi.fn();
const markPaymentAttemptCheckoutInProgressMock = vi.fn();
const getPaymentByRazorpayPaymentIdMock = vi.fn();
const insertVerifiedPaymentMock = vi.fn();
const listLatestPaymentsForAttemptIdsMock = vi.fn();
const attachCheckoutVerificationToPaymentMock = vi.fn();

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
  getPaymentAttemptById: getPaymentAttemptByIdMock,
  markPaymentAttemptCheckoutInProgress:
    markPaymentAttemptCheckoutInProgressMock,
  getPaymentByRazorpayPaymentId: getPaymentByRazorpayPaymentIdMock,
  insertVerifiedPayment: insertVerifiedPaymentMock,
  listLatestPaymentsForAttemptIds: listLatestPaymentsForAttemptIdsMock,
  attachCheckoutVerificationToPayment: attachCheckoutVerificationToPaymentMock,
}));

const verifyCheckoutSignatureMock = vi.fn();
vi.mock("@/lib/razorpay/checkout-verification", () => ({
  verifyCheckoutSignature: verifyCheckoutSignatureMock,
}));

const FAKE_KEY_ID = "rzp_test_fake_key_id_not_real";
const FAKE_KEY_SECRET = "fake-razorpay-key-secret-not-real";
const getRazorpayEnvMock = vi.fn();
vi.mock("@/lib/config/razorpay-env", () => ({
  getRazorpayEnv: getRazorpayEnvMock,
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

const VALID_ATTEMPT_ID = "22222222-2222-2222-2222-222222222222";

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

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment-1",
    payment_attempt_id: VALID_ATTEMPT_ID,
    razorpay_payment_id: "pay_fake_id",
    razorpay_payment_status: null,
    amount_subunits: 50000,
    currency: "INR",
    checkout_signature_verified: true,
    checkout_verified_at: "2026-01-01T00:00:00.000Z",
    captured_at: null,
    failed_at: null,
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
  getPaymentAttemptByIdMock.mockReset();
  markPaymentAttemptCheckoutInProgressMock.mockReset();
  getPaymentByRazorpayPaymentIdMock.mockReset();
  insertVerifiedPaymentMock.mockReset();
  attachCheckoutVerificationToPaymentMock.mockReset();
  listLatestPaymentsForAttemptIdsMock.mockReset().mockResolvedValue(new Map());
  createRazorpayOrderMock.mockReset();
  verifyCheckoutSignatureMock.mockReset();
  getRazorpayEnvMock.mockReset().mockReturnValue({
    mode: "test",
    keyId: FAKE_KEY_ID,
    keySecret: FAKE_KEY_SECRET,
  });
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

describe("prepareCheckoutForPaymentAttempt", () => {
  it("is declared with exactly one parameter — no amount/currency/orderId argument exists for the browser to override", async () => {
    const { prepareCheckoutForPaymentAttempt } =
      await import("@/lib/demo-merchant/service");
    expect(prepareCheckoutForPaymentAttempt.length).toBe(1);
  });

  it("rejects a malformed attempt id before ever querying the database", async () => {
    const {
      prepareCheckoutForPaymentAttempt,
      DemoMerchantPaymentAttemptNotFoundError,
    } = await import("@/lib/demo-merchant/service");

    await expect(
      prepareCheckoutForPaymentAttempt("not-a-uuid"),
    ).rejects.toThrow(DemoMerchantPaymentAttemptNotFoundError);
    expect(getPaymentAttemptByIdMock).not.toHaveBeenCalled();
  });

  it("throws DemoMerchantPaymentAttemptNotFoundError when the attempt does not exist", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(null);
    const {
      prepareCheckoutForPaymentAttempt,
      DemoMerchantPaymentAttemptNotFoundError,
    } = await import("@/lib/demo-merchant/service");

    await expect(
      prepareCheckoutForPaymentAttempt(VALID_ATTEMPT_ID),
    ).rejects.toThrow(DemoMerchantPaymentAttemptNotFoundError);
  });

  it("rejects an attempt with no trusted Razorpay Order correlation yet", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(
      attemptRow({
        id: VALID_ATTEMPT_ID,
        status: "CREATED",
        razorpay_order_id: null,
      }),
    );
    const {
      prepareCheckoutForPaymentAttempt,
      DemoMerchantCheckoutNotEligibleError,
    } = await import("@/lib/demo-merchant/service");

    await expect(
      prepareCheckoutForPaymentAttempt(VALID_ATTEMPT_ID),
    ).rejects.toThrow(DemoMerchantCheckoutNotEligibleError);
    expect(markPaymentAttemptCheckoutInProgressMock).not.toHaveBeenCalled();
  });

  it("rejects an attempt in an ineligible state (e.g. FAILED_OBSERVED) even with a Razorpay Order id present", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(
      attemptRow({
        id: VALID_ATTEMPT_ID,
        status: "FAILED_OBSERVED",
        razorpay_order_id: "order_fake_id",
      }),
    );
    const {
      prepareCheckoutForPaymentAttempt,
      DemoMerchantCheckoutNotEligibleError,
    } = await import("@/lib/demo-merchant/service");

    await expect(
      prepareCheckoutForPaymentAttempt(VALID_ATTEMPT_ID),
    ).rejects.toThrow(DemoMerchantCheckoutNotEligibleError);
  });

  it("ORDER_CREATED: transitions to CHECKOUT_IN_PROGRESS and returns the exact trusted amount/currency/order id/Key ID", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(
      attemptRow({
        id: VALID_ATTEMPT_ID,
        status: "ORDER_CREATED",
        razorpay_order_id: "order_trusted_id",
        amount_subunits: 50000,
        currency: "INR",
      }),
    );
    getOrderByIdMock.mockResolvedValue(orderRow());
    markPaymentAttemptCheckoutInProgressMock.mockResolvedValue(
      attemptRow({
        id: VALID_ATTEMPT_ID,
        status: "CHECKOUT_IN_PROGRESS",
        razorpay_order_id: "order_trusted_id",
        amount_subunits: 50000,
        currency: "INR",
      }),
    );

    const { prepareCheckoutForPaymentAttempt } =
      await import("@/lib/demo-merchant/service");
    const result = await prepareCheckoutForPaymentAttempt(VALID_ATTEMPT_ID);

    expect(getPaymentAttemptByIdMock).toHaveBeenCalledWith(VALID_ATTEMPT_ID);
    expect(getOrderByIdMock).toHaveBeenCalledWith(VALID_ORDER_ID);
    expect(markPaymentAttemptCheckoutInProgressMock).toHaveBeenCalledWith(
      VALID_ATTEMPT_ID,
    );
    expect(result).toEqual({
      razorpayKeyId: FAKE_KEY_ID,
      razorpayOrderId: "order_trusted_id",
      amountSubunits: 50000,
      currency: "INR",
      paymentAttemptId: VALID_ATTEMPT_ID,
      orderId: VALID_ORDER_ID,
      name: expect.any(String),
      description: expect.any(String),
    });
    // Never the Key Secret, webhook secret, or service-role key — the
    // returned object's keys are exhaustively the Checkout-safe set.
    expect(Object.keys(result).sort()).toEqual(
      [
        "amountSubunits",
        "currency",
        "description",
        "name",
        "orderId",
        "paymentAttemptId",
        "razorpayKeyId",
        "razorpayOrderId",
      ].sort(),
    );
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY_SECRET);
  });

  it("CHECKOUT_IN_PROGRESS: reopens without transitioning again and without creating a new payment attempt", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(
      attemptRow({
        id: VALID_ATTEMPT_ID,
        status: "CHECKOUT_IN_PROGRESS",
        razorpay_order_id: "order_trusted_id",
      }),
    );
    getOrderByIdMock.mockResolvedValue(orderRow());

    const { prepareCheckoutForPaymentAttempt } =
      await import("@/lib/demo-merchant/service");
    await prepareCheckoutForPaymentAttempt(VALID_ATTEMPT_ID);

    expect(markPaymentAttemptCheckoutInProgressMock).not.toHaveBeenCalled();
    expect(insertPaymentAttemptMock).not.toHaveBeenCalled();
  });

  it("re-validates Test Mode configuration before returning anything (fails closed on a fake Live key)", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(
      attemptRow({
        id: VALID_ATTEMPT_ID,
        status: "ORDER_CREATED",
        razorpay_order_id: "order_trusted_id",
      }),
    );
    getOrderByIdMock.mockResolvedValue(orderRow());
    getRazorpayEnvMock.mockImplementation(() => {
      throw new Error("Live Mode key rejected");
    });

    const { prepareCheckoutForPaymentAttempt } =
      await import("@/lib/demo-merchant/service");
    await expect(
      prepareCheckoutForPaymentAttempt(VALID_ATTEMPT_ID),
    ).rejects.toThrow("Live Mode key rejected");
    expect(markPaymentAttemptCheckoutInProgressMock).not.toHaveBeenCalled();
  });

  it("never marks the merchant order PAID, never creates a fulfilment, and never marks the attempt CAPTURED (no such repository call exists)", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(
      attemptRow({
        id: VALID_ATTEMPT_ID,
        status: "ORDER_CREATED",
        razorpay_order_id: "order_trusted_id",
      }),
    );
    getOrderByIdMock.mockResolvedValue(orderRow());
    markPaymentAttemptCheckoutInProgressMock.mockResolvedValue(
      attemptRow({ id: VALID_ATTEMPT_ID, status: "CHECKOUT_IN_PROGRESS" }),
    );

    const { prepareCheckoutForPaymentAttempt } =
      await import("@/lib/demo-merchant/service");
    await prepareCheckoutForPaymentAttempt(VALID_ATTEMPT_ID);

    expect(insertOrderMock).not.toHaveBeenCalled();
    expect(markPaymentAttemptOrderCreatedMock).not.toHaveBeenCalled();
    expect(markPaymentAttemptFailedObservedMock).not.toHaveBeenCalled();
  });
});

describe("verifyCheckoutAndPersistPayment", () => {
  const validInput = {
    paymentAttemptId: VALID_ATTEMPT_ID,
    razorpayPaymentId: "pay_fake_id",
    razorpayOrderId: "order_trusted_id",
    razorpaySignature: "fake-signature-hex",
  };

  function eligibleAttempt(overrides: Record<string, unknown> = {}) {
    return attemptRow({
      id: VALID_ATTEMPT_ID,
      status: "CHECKOUT_IN_PROGRESS",
      razorpay_order_id: "order_trusted_id",
      amount_subunits: 50000,
      currency: "INR",
      ...overrides,
    });
  }

  it("rejects a malformed attempt id before ever querying the database", async () => {
    const {
      verifyCheckoutAndPersistPayment,
      DemoMerchantPaymentAttemptNotFoundError,
    } = await import("@/lib/demo-merchant/service");

    await expect(
      verifyCheckoutAndPersistPayment({
        ...validInput,
        paymentAttemptId: "not-a-uuid",
      }),
    ).rejects.toThrow(DemoMerchantPaymentAttemptNotFoundError);
    expect(getPaymentAttemptByIdMock).not.toHaveBeenCalled();
  });

  it("rejects a missing/empty razorpayPaymentId before touching the database", async () => {
    const {
      verifyCheckoutAndPersistPayment,
      RazorpayCheckoutSignatureInvalidError,
    } = await import("@/lib/demo-merchant/service");

    await expect(
      verifyCheckoutAndPersistPayment({ ...validInput, razorpayPaymentId: "" }),
    ).rejects.toThrow(RazorpayCheckoutSignatureInvalidError);
    expect(getPaymentAttemptByIdMock).not.toHaveBeenCalled();
  });

  it("rejects a missing/empty razorpaySignature before touching the database", async () => {
    const {
      verifyCheckoutAndPersistPayment,
      RazorpayCheckoutSignatureInvalidError,
    } = await import("@/lib/demo-merchant/service");

    await expect(
      verifyCheckoutAndPersistPayment({ ...validInput, razorpaySignature: "" }),
    ).rejects.toThrow(RazorpayCheckoutSignatureInvalidError);
    expect(getPaymentAttemptByIdMock).not.toHaveBeenCalled();
  });

  it("throws DemoMerchantPaymentAttemptNotFoundError when the attempt does not exist", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(null);
    const {
      verifyCheckoutAndPersistPayment,
      DemoMerchantPaymentAttemptNotFoundError,
    } = await import("@/lib/demo-merchant/service");

    await expect(verifyCheckoutAndPersistPayment(validInput)).rejects.toThrow(
      DemoMerchantPaymentAttemptNotFoundError,
    );
  });

  it("throws DemoMerchantCheckoutNotEligibleError when the attempt has no trusted Razorpay Order id yet", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(
      eligibleAttempt({ razorpay_order_id: null }),
    );
    const {
      verifyCheckoutAndPersistPayment,
      DemoMerchantCheckoutNotEligibleError,
    } = await import("@/lib/demo-merchant/service");

    await expect(verifyCheckoutAndPersistPayment(validInput)).rejects.toThrow(
      DemoMerchantCheckoutNotEligibleError,
    );
  });

  it("CRITICAL: rejects a browser-supplied razorpayOrderId that differs from the trusted DB order id — WITHOUT ever calling the signature verifier", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(
      eligibleAttempt({ razorpay_order_id: "order_trusted_id" }),
    );
    const {
      verifyCheckoutAndPersistPayment,
      RazorpayCheckoutOrderMismatchError,
    } = await import("@/lib/demo-merchant/service");

    await expect(
      verifyCheckoutAndPersistPayment({
        ...validInput,
        razorpayOrderId: "order_ATTACKER_supplied",
      }),
    ).rejects.toThrow(RazorpayCheckoutOrderMismatchError);
    expect(verifyCheckoutSignatureMock).not.toHaveBeenCalled();
    expect(insertVerifiedPaymentMock).not.toHaveBeenCalled();
  });

  it("computes the signature using the TRUSTED database order id, never the browser-supplied one", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(
      eligibleAttempt({ razorpay_order_id: "order_trusted_id" }),
    );
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(null);
    insertVerifiedPaymentMock.mockResolvedValue(paymentRow());
    verifyCheckoutSignatureMock.mockReturnValue(true);

    const { verifyCheckoutAndPersistPayment } =
      await import("@/lib/demo-merchant/service");
    await verifyCheckoutAndPersistPayment(validInput);

    expect(verifyCheckoutSignatureMock).toHaveBeenCalledWith({
      trustedRazorpayOrderId: "order_trusted_id",
      razorpayPaymentId: validInput.razorpayPaymentId,
      razorpaySignature: validInput.razorpaySignature,
    });
  });

  it("an invalid signature is rejected, creates zero trusted payments rows, and never mutates the order/business/fulfilment state", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(eligibleAttempt());
    verifyCheckoutSignatureMock.mockReturnValue(false);

    const {
      verifyCheckoutAndPersistPayment,
      RazorpayCheckoutSignatureInvalidError,
    } = await import("@/lib/demo-merchant/service");

    await expect(verifyCheckoutAndPersistPayment(validInput)).rejects.toThrow(
      RazorpayCheckoutSignatureInvalidError,
    );
    expect(insertVerifiedPaymentMock).not.toHaveBeenCalled();
    expect(getPaymentByRazorpayPaymentIdMock).not.toHaveBeenCalled();
    // No order/business/fulfilment mutation function is even exposed by
    // the mocked repository module, so none can have been called.
    expect(insertOrderMock).not.toHaveBeenCalled();
    expect(markPaymentAttemptOrderCreatedMock).not.toHaveBeenCalled();
  });

  it("on a valid signature: persists the canonical payment using ONLY trusted attempt fields (amount/currency), never any input-side amount", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(
      eligibleAttempt({ amount_subunits: 50000, currency: "INR" }),
    );
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(null);
    insertVerifiedPaymentMock.mockResolvedValue(paymentRow());
    verifyCheckoutSignatureMock.mockReturnValue(true);

    const { verifyCheckoutAndPersistPayment } =
      await import("@/lib/demo-merchant/service");
    const result = await verifyCheckoutAndPersistPayment(validInput);

    expect(insertVerifiedPaymentMock).toHaveBeenCalledWith({
      paymentAttemptId: VALID_ATTEMPT_ID,
      razorpayPaymentId: validInput.razorpayPaymentId,
      amountSubunits: 50000,
      currency: "INR",
    });
    // VerifyCheckoutInput has no amount/currency field at all — structural:
    // there is no way for a caller to have supplied a different value.
    expect(Object.keys(validInput).sort()).toEqual(
      [
        "paymentAttemptId",
        "razorpayOrderId",
        "razorpayPaymentId",
        "razorpaySignature",
      ].sort(),
    );
    expect(result.checkoutSignatureVerified).toBe(true);
    expect(result.checkoutVerifiedAt).not.toBeNull();
    // Absent stronger provider evidence in Phase 2C, both remain NULL —
    // reflected straight from the persisted row, never inferred.
    expect(result.razorpayPaymentStatus).toBeNull();
    expect(result.capturedAt).toBeNull();
    expect(result.failedAt).toBeNull();
    // The signature itself is never part of the insert call.
    const insertArgs = insertVerifiedPaymentMock.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(insertArgs.razorpaySignature).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(validInput.razorpaySignature);
  });

  it("never mutates orders/fulfilments and never marks the attempt CAPTURED on success (no such repository call exists in this module's dependency set)", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(eligibleAttempt());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(null);
    insertVerifiedPaymentMock.mockResolvedValue(paymentRow());
    verifyCheckoutSignatureMock.mockReturnValue(true);

    const { verifyCheckoutAndPersistPayment } =
      await import("@/lib/demo-merchant/service");
    await verifyCheckoutAndPersistPayment(validInput);

    expect(insertOrderMock).not.toHaveBeenCalled();
    expect(markPaymentAttemptOrderCreatedMock).not.toHaveBeenCalled();
    expect(markPaymentAttemptCheckoutInProgressMock).not.toHaveBeenCalled();
  });

  it("idempotent: the same razorpay_payment_id already verified for the SAME attempt returns the existing row without inserting a duplicate", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(eligibleAttempt());
    const existing = paymentRow({ payment_attempt_id: VALID_ATTEMPT_ID });
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(existing);
    verifyCheckoutSignatureMock.mockReturnValue(true);

    const { verifyCheckoutAndPersistPayment } =
      await import("@/lib/demo-merchant/service");
    const result = await verifyCheckoutAndPersistPayment(validInput);

    expect(insertVerifiedPaymentMock).not.toHaveBeenCalled();
    expect(result.id).toBe(existing.id);
  });

  it("Phase 2E Checkout-after-webhook compatibility: attaches verification to an existing payment the webhook observed first (checkout_signature_verified=false), rather than failing", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(eligibleAttempt());
    const webhookFirstPayment = paymentRow({
      payment_attempt_id: VALID_ATTEMPT_ID,
      checkout_signature_verified: false,
      checkout_verified_at: null,
    });
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(webhookFirstPayment);
    const attached = paymentRow({
      payment_attempt_id: VALID_ATTEMPT_ID,
      checkout_signature_verified: true,
      checkout_verified_at: "2026-01-01T00:00:00.000Z",
    });
    attachCheckoutVerificationToPaymentMock.mockResolvedValue(attached);
    verifyCheckoutSignatureMock.mockReturnValue(true);

    const { verifyCheckoutAndPersistPayment } =
      await import("@/lib/demo-merchant/service");
    const result = await verifyCheckoutAndPersistPayment(validInput);

    expect(attachCheckoutVerificationToPaymentMock).toHaveBeenCalledWith(
      webhookFirstPayment.id,
    );
    expect(insertVerifiedPaymentMock).not.toHaveBeenCalled();
    expect(result.id).toBe(attached.id);
  });

  it("does NOT attempt to attach verification when the existing payment is already checkout_signature_verified=true (pure idempotent retry)", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(eligibleAttempt());
    const existing = paymentRow({
      payment_attempt_id: VALID_ATTEMPT_ID,
      checkout_signature_verified: true,
    });
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(existing);
    verifyCheckoutSignatureMock.mockReturnValue(true);

    const { verifyCheckoutAndPersistPayment } =
      await import("@/lib/demo-merchant/service");
    await verifyCheckoutAndPersistPayment(validInput);

    expect(attachCheckoutVerificationToPaymentMock).not.toHaveBeenCalled();
  });

  it("rejects (integrity error) when the razorpay_payment_id already belongs to a DIFFERENT payment attempt — never silently reassigned", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(eligibleAttempt());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(
      paymentRow({ payment_attempt_id: "some-other-attempt-id" }),
    );
    verifyCheckoutSignatureMock.mockReturnValue(true);

    const {
      verifyCheckoutAndPersistPayment,
      RazorpayPaymentIdentityConflictError,
    } = await import("@/lib/demo-merchant/service");

    await expect(verifyCheckoutAndPersistPayment(validInput)).rejects.toThrow(
      RazorpayPaymentIdentityConflictError,
    );
    expect(insertVerifiedPaymentMock).not.toHaveBeenCalled();
  });

  it("Correction E: rejects (integrity error) when the existing payment's amount disagrees with the trusted attempt", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(eligibleAttempt());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(
      paymentRow({
        payment_attempt_id: VALID_ATTEMPT_ID,
        amount_subunits: 12345,
      }),
    );
    verifyCheckoutSignatureMock.mockReturnValue(true);

    const {
      verifyCheckoutAndPersistPayment,
      RazorpayPaymentIdentityConflictError,
    } = await import("@/lib/demo-merchant/service");

    await expect(verifyCheckoutAndPersistPayment(validInput)).rejects.toThrow(
      RazorpayPaymentIdentityConflictError,
    );
    expect(attachCheckoutVerificationToPaymentMock).not.toHaveBeenCalled();
  });

  it("Correction E: rejects (integrity error) when the existing payment's currency disagrees with the trusted attempt", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(eligibleAttempt());
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(
      paymentRow({ payment_attempt_id: VALID_ATTEMPT_ID, currency: "USD" }),
    );
    verifyCheckoutSignatureMock.mockReturnValue(true);

    const {
      verifyCheckoutAndPersistPayment,
      RazorpayPaymentIdentityConflictError,
    } = await import("@/lib/demo-merchant/service");

    await expect(verifyCheckoutAndPersistPayment(validInput)).rejects.toThrow(
      RazorpayPaymentIdentityConflictError,
    );
    expect(attachCheckoutVerificationToPaymentMock).not.toHaveBeenCalled();
  });

  it("Correction E: a race-winning reread with a mismatched amount is rejected", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(eligibleAttempt());
    getPaymentByRazorpayPaymentIdMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        paymentRow({
          payment_attempt_id: VALID_ATTEMPT_ID,
          amount_subunits: 1,
        }),
      );
    insertVerifiedPaymentMock.mockResolvedValue(null);
    verifyCheckoutSignatureMock.mockReturnValue(true);

    const {
      verifyCheckoutAndPersistPayment,
      RazorpayPaymentIdentityConflictError,
    } = await import("@/lib/demo-merchant/service");

    await expect(verifyCheckoutAndPersistPayment(validInput)).rejects.toThrow(
      RazorpayPaymentIdentityConflictError,
    );
  });

  it("Correction E: a race-winning reread with a mismatched currency is rejected", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(eligibleAttempt());
    getPaymentByRazorpayPaymentIdMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        paymentRow({ payment_attempt_id: VALID_ATTEMPT_ID, currency: "USD" }),
      );
    insertVerifiedPaymentMock.mockResolvedValue(null);
    verifyCheckoutSignatureMock.mockReturnValue(true);

    const {
      verifyCheckoutAndPersistPayment,
      RazorpayPaymentIdentityConflictError,
    } = await import("@/lib/demo-merchant/service");

    await expect(verifyCheckoutAndPersistPayment(validInput)).rejects.toThrow(
      RazorpayPaymentIdentityConflictError,
    );
  });

  it("E9: a valid webhook-first payment (agreeing on attempt/amount/currency) followed by a later verified Checkout still merges successfully", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(eligibleAttempt());
    const webhookFirstPayment = paymentRow({
      payment_attempt_id: VALID_ATTEMPT_ID,
      amount_subunits: 50000,
      currency: "INR",
      checkout_signature_verified: false,
      checkout_verified_at: null,
    });
    getPaymentByRazorpayPaymentIdMock.mockResolvedValue(webhookFirstPayment);
    const attached = paymentRow({
      payment_attempt_id: VALID_ATTEMPT_ID,
      amount_subunits: 50000,
      currency: "INR",
      checkout_signature_verified: true,
      checkout_verified_at: "2026-01-01T00:00:00.000Z",
    });
    attachCheckoutVerificationToPaymentMock.mockResolvedValue(attached);
    verifyCheckoutSignatureMock.mockReturnValue(true);

    const { verifyCheckoutAndPersistPayment } =
      await import("@/lib/demo-merchant/service");
    const result = await verifyCheckoutAndPersistPayment(validInput);

    expect(attachCheckoutVerificationToPaymentMock).toHaveBeenCalledWith(
      webhookFirstPayment.id,
    );
    expect(result.id).toBe(attached.id);
  });

  it("resolves a concurrent-insert race safely: insertVerifiedPayment returning null (DB unique-constraint race) re-reads and returns the winning row", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(eligibleAttempt());
    const raceWinner = paymentRow({ payment_attempt_id: VALID_ATTEMPT_ID });
    getPaymentByRazorpayPaymentIdMock
      .mockResolvedValueOnce(null) // first check: no existing row yet
      .mockResolvedValueOnce(raceWinner); // re-read after the race
    insertVerifiedPaymentMock.mockResolvedValue(null); // lost the race
    verifyCheckoutSignatureMock.mockReturnValue(true);

    const { verifyCheckoutAndPersistPayment } =
      await import("@/lib/demo-merchant/service");
    const result = await verifyCheckoutAndPersistPayment(validInput);

    expect(result.id).toBe(raceWinner.id);
  });
});
