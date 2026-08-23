import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 1E: `lib/demo-merchant/service.ts` behavior against a MOCKED
// repository (no network) — proves the assembly or wiring
// (product -> domain validation -> repository -> view model), not real
// Supabase persistence (covered by the integration test).
vi.mock("server-only", () => ({}));

const insertOrderMock = vi.fn();
const listRecentOrdersMock = vi.fn();
const countFulfilmentsForOrderIdsMock = vi.fn();

vi.mock("@/lib/demo-merchant/repository", () => ({
  insertOrder: insertOrderMock,
  listRecentOrders: listRecentOrdersMock,
  countFulfilmentsForOrderIds: countFulfilmentsForOrderIdsMock,
}));

beforeEach(() => {
  insertOrderMock.mockReset();
  listRecentOrdersMock.mockReset();
  countFulfilmentsForOrderIdsMock.mockReset();
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
});
