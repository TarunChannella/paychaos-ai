import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Phase 3A: `lib/chaos/repository.ts` behavior against a MOCKED Supabase
// client and MOCKED `lib/demo-merchant/repository.ts` reads (no network).
// Real-Supabase behavior is separately proven by
// tests/integration/supabase/051-chaos-safety-gate.integration.test.ts.
vi.mock("server-only", () => ({}));

interface MockResult {
  data: unknown;
  error: unknown;
}

type SelectFn = (
  columns?: string,
  options?: Record<string, unknown>,
) => FakeQueryBuilder;
type EqFn = (column: string, value: unknown) => FakeQueryBuilder;
type LimitFn = (limit: number) => FakeQueryBuilder;
type MaybeSingleFn = () => Promise<MockResult>;

interface FakeQueryBuilder extends PromiseLike<MockResult> {
  select: Mock<SelectFn>;
  eq: Mock<EqFn>;
  limit: Mock<LimitFn>;
  maybeSingle: Mock<MaybeSingleFn>;
}

function makeQueryBuilder(result: MockResult): FakeQueryBuilder {
  const builder: FakeQueryBuilder = {
    select: vi.fn<SelectFn>(() => builder),
    eq: vi.fn<EqFn>(() => builder),
    limit: vi.fn<LimitFn>(() => builder),
    maybeSingle: vi.fn<MaybeSingleFn>(async () => result),
    then: (onfulfilled, onrejected) =>
      Promise.resolve(result).then(onfulfilled, onrejected),
  };
  return builder;
}

const fromMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => ({ from: fromMock }),
}));

const getOrderByIdMock = vi.fn();
const countFulfilmentsForOrderIdsMock = vi.fn();
const getPaymentAttemptByIdMock = vi.fn();
vi.mock("@/lib/demo-merchant/repository", () => ({
  getOrderById: getOrderByIdMock,
  countFulfilmentsForOrderIds: countFulfilmentsForOrderIdsMock,
  getPaymentAttemptById: getPaymentAttemptByIdMock,
}));

beforeEach(() => {
  fromMock.mockReset();
  getOrderByIdMock.mockReset();
  countFulfilmentsForOrderIdsMock.mockReset();
  getPaymentAttemptByIdMock.mockReset();
});

const WEBHOOK_EVENT_ID = "11111111-1111-1111-1111-111111111111";
const ORDER_ID = "22222222-2222-2222-2222-222222222222";
const ATTEMPT_ID = "33333333-3333-3333-3333-333333333333";

function fakeWebhookEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: WEBHOOK_EVENT_ID,
    razorpay_event_id: "evt_fake_123",
    event_type: "payment.captured",
    source_kind: "REAL_RAZORPAY_WEBHOOK",
    razorpay_order_id: "order_fake",
    razorpay_payment_id: "pay_fake",
    payment_attempt_id: ATTEMPT_ID,
    payment_id: "44444444-4444-4444-4444-444444444444",
    signature_verified: true,
    received_at: "2026-01-01T00:00:00.000Z",
    provider_created_at: null,
    amount_subunits: 50000,
    currency: "INR",
    razorpay_payment_status: "captured",
    raw_body_sha256: "a".repeat(64),
    raw_payload_redacted: {},
    processing_status: "PROCESSED",
    processed_at: "2026-01-01T00:00:01.000Z",
    duplicate_delivery_count: 0,
    updated_at: "2026-01-01T00:00:01.000Z",
    ...overrides,
  };
}

describe("checkChaosDatabaseReachable", () => {
  it("resolves without throwing when Supabase returns no error", async () => {
    fromMock.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    const { checkChaosDatabaseReachable } =
      await import("@/lib/chaos/repository");
    await expect(checkChaosDatabaseReachable()).resolves.toBeUndefined();
    expect(fromMock).toHaveBeenCalledWith("orders");
  });

  it("throws ChaosRepositoryError when Supabase returns an error", async () => {
    fromMock.mockReturnValue(
      makeQueryBuilder({ data: null, error: { message: "boom" } }),
    );
    const { checkChaosDatabaseReachable, ChaosRepositoryError } =
      await import("@/lib/chaos/repository");
    await expect(checkChaosDatabaseReachable()).rejects.toBeInstanceOf(
      ChaosRepositoryError,
    );
  });

  it("never leaks the raw Supabase error message", async () => {
    fromMock.mockReturnValue(
      makeQueryBuilder({
        data: null,
        error: { message: "leaked-secret-detail" },
      }),
    );
    const { checkChaosDatabaseReachable } =
      await import("@/lib/chaos/repository");
    try {
      await checkChaosDatabaseReachable();
      throw new Error("expected checkChaosDatabaseReachable to throw");
    } catch (err) {
      expect((err as Error).message).not.toContain("leaked-secret-detail");
    }
  });
});

describe("getWebhookEventById", () => {
  it("returns the row when found", async () => {
    const row = fakeWebhookEventRow();
    fromMock.mockReturnValue(makeQueryBuilder({ data: row, error: null }));
    const { getWebhookEventById } = await import("@/lib/chaos/repository");
    const result = await getWebhookEventById(WEBHOOK_EVENT_ID);
    expect(result).toEqual(row);
    expect(fromMock).toHaveBeenCalledWith("webhook_events");
  });

  it("returns null when not found", async () => {
    fromMock.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    const { getWebhookEventById } = await import("@/lib/chaos/repository");
    expect(await getWebhookEventById(WEBHOOK_EVENT_ID)).toBeNull();
  });

  it("throws ChaosRepositoryError on a Supabase error", async () => {
    fromMock.mockReturnValue(
      makeQueryBuilder({ data: null, error: { message: "boom" } }),
    );
    const { getWebhookEventById, ChaosRepositoryError } =
      await import("@/lib/chaos/repository");
    await expect(getWebhookEventById(WEBHOOK_EVENT_ID)).rejects.toBeInstanceOf(
      ChaosRepositoryError,
    );
  });
});

describe("getOrderBaseline", () => {
  it("composes payment_status/business_status/fulfilmentCount from existing Phase 1/2 reads", async () => {
    getOrderByIdMock.mockResolvedValue({
      id: ORDER_ID,
      payment_status: "PAID",
      business_status: "FULFILLED",
    });
    countFulfilmentsForOrderIdsMock.mockResolvedValue(new Map([[ORDER_ID, 1]]));
    const { getOrderBaseline } = await import("@/lib/chaos/repository");
    const result = await getOrderBaseline(ORDER_ID);
    expect(result).toEqual({
      orderId: ORDER_ID,
      paymentStatus: "PAID",
      businessStatus: "FULFILLED",
      fulfilmentCount: 1,
    });
  });

  it("returns null when the order does not exist, without counting fulfilments", async () => {
    getOrderByIdMock.mockResolvedValue(null);
    const { getOrderBaseline } = await import("@/lib/chaos/repository");
    expect(await getOrderBaseline(ORDER_ID)).toBeNull();
    expect(countFulfilmentsForOrderIdsMock).not.toHaveBeenCalled();
  });

  it("defaults fulfilmentCount to 0 when the count map has no entry", async () => {
    getOrderByIdMock.mockResolvedValue({
      id: ORDER_ID,
      payment_status: "UNPAID",
      business_status: "OPEN",
    });
    countFulfilmentsForOrderIdsMock.mockResolvedValue(new Map());
    const { getOrderBaseline } = await import("@/lib/chaos/repository");
    const result = await getOrderBaseline(ORDER_ID);
    expect(result?.fulfilmentCount).toBe(0);
  });
});

describe("isFreshBaseline", () => {
  it("is true for UNPAID/OPEN/zero fulfilments", async () => {
    const { isFreshBaseline } = await import("@/lib/chaos/repository");
    expect(
      isFreshBaseline({
        orderId: ORDER_ID,
        paymentStatus: "UNPAID",
        businessStatus: "OPEN",
        fulfilmentCount: 0,
      }),
    ).toBe(true);
  });

  it.each([
    ["PAID", "OPEN", 0],
    ["UNPAID", "FULFILLED", 0],
    ["UNPAID", "OPEN", 1],
  ] as const)(
    "is false for (%s, %s, %d)",
    async (paymentStatus, businessStatus, fulfilmentCount) => {
      const { isFreshBaseline } = await import("@/lib/chaos/repository");
      expect(
        isFreshBaseline({
          orderId: ORDER_ID,
          paymentStatus,
          businessStatus,
          fulfilmentCount,
        }),
      ).toBe(false);
    },
  );
});

describe("loadC01SourceEvidence", () => {
  it("returns null when the webhook event does not exist", async () => {
    fromMock.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    const { loadC01SourceEvidence } = await import("@/lib/chaos/repository");
    expect(await loadC01SourceEvidence(WEBHOOK_EVENT_ID)).toBeNull();
  });

  it("returns null when signature_verified is false", async () => {
    fromMock.mockReturnValue(
      makeQueryBuilder({
        data: fakeWebhookEventRow({ signature_verified: false }),
        error: null,
      }),
    );
    const { loadC01SourceEvidence } = await import("@/lib/chaos/repository");
    expect(await loadC01SourceEvidence(WEBHOOK_EVENT_ID)).toBeNull();
  });

  it("returns null for an unsupported event_type", async () => {
    fromMock.mockReturnValue(
      makeQueryBuilder({
        data: fakeWebhookEventRow({ event_type: "payment.failed" }),
        error: null,
      }),
    );
    const { loadC01SourceEvidence } = await import("@/lib/chaos/repository");
    expect(await loadC01SourceEvidence(WEBHOOK_EVENT_ID)).toBeNull();
  });

  it("returns null when payment_attempt_id is not yet correlated", async () => {
    fromMock.mockReturnValue(
      makeQueryBuilder({
        data: fakeWebhookEventRow({ payment_attempt_id: null }),
        error: null,
      }),
    );
    const { loadC01SourceEvidence } = await import("@/lib/chaos/repository");
    expect(await loadC01SourceEvidence(WEBHOOK_EVENT_ID)).toBeNull();
  });

  it("returns null when the correlated payment attempt cannot be found", async () => {
    fromMock.mockReturnValue(
      makeQueryBuilder({ data: fakeWebhookEventRow(), error: null }),
    );
    getPaymentAttemptByIdMock.mockResolvedValue(null);
    const { loadC01SourceEvidence } = await import("@/lib/chaos/repository");
    expect(await loadC01SourceEvidence(WEBHOOK_EVENT_ID)).toBeNull();
  });

  it("returns the full evidence object on a valid payment.captured chain", async () => {
    fromMock.mockReturnValue(
      makeQueryBuilder({ data: fakeWebhookEventRow(), error: null }),
    );
    getPaymentAttemptByIdMock.mockResolvedValue({
      id: ATTEMPT_ID,
      order_id: ORDER_ID,
    });
    getOrderByIdMock.mockResolvedValue({
      id: ORDER_ID,
      payment_status: "PAID",
      business_status: "FULFILLED",
    });
    countFulfilmentsForOrderIdsMock.mockResolvedValue(new Map([[ORDER_ID, 1]]));
    const { loadC01SourceEvidence } = await import("@/lib/chaos/repository");
    const result = await loadC01SourceEvidence(WEBHOOK_EVENT_ID);
    expect(result).toEqual({
      webhookEventId: WEBHOOK_EVENT_ID,
      orderId: ORDER_ID,
      baseline: {
        orderId: ORDER_ID,
        paymentStatus: "PAID",
        businessStatus: "FULFILLED",
        fulfilmentCount: 1,
      },
    });
  });

  it("accepts order.paid as a supported source event_type", async () => {
    fromMock.mockReturnValue(
      makeQueryBuilder({
        data: fakeWebhookEventRow({ event_type: "order.paid" }),
        error: null,
      }),
    );
    getPaymentAttemptByIdMock.mockResolvedValue({
      id: ATTEMPT_ID,
      order_id: ORDER_ID,
    });
    getOrderByIdMock.mockResolvedValue({
      id: ORDER_ID,
      payment_status: "PAID",
      business_status: "FULFILLED",
    });
    countFulfilmentsForOrderIdsMock.mockResolvedValue(new Map([[ORDER_ID, 1]]));
    const { loadC01SourceEvidence } = await import("@/lib/chaos/repository");
    expect(await loadC01SourceEvidence(WEBHOOK_EVENT_ID)).not.toBeNull();
  });
});

describe("loadC11RealWebhookFailureEvidence", () => {
  it("requires event_type = payment.failed", async () => {
    fromMock.mockReturnValue(
      makeQueryBuilder({
        data: fakeWebhookEventRow({ event_type: "payment.captured" }),
        error: null,
      }),
    );
    const { loadC11RealWebhookFailureEvidence } =
      await import("@/lib/chaos/repository");
    expect(
      await loadC11RealWebhookFailureEvidence(WEBHOOK_EVENT_ID),
    ).toBeNull();
  });

  it("returns evidence for a valid signature-verified payment.failed row", async () => {
    fromMock.mockReturnValue(
      makeQueryBuilder({
        data: fakeWebhookEventRow({ event_type: "payment.failed" }),
        error: null,
      }),
    );
    getPaymentAttemptByIdMock.mockResolvedValue({
      id: ATTEMPT_ID,
      order_id: ORDER_ID,
    });
    getOrderByIdMock.mockResolvedValue({
      id: ORDER_ID,
      payment_status: "FAILED_OBSERVED",
      business_status: "OPEN",
    });
    countFulfilmentsForOrderIdsMock.mockResolvedValue(new Map());
    const { loadC11RealWebhookFailureEvidence } =
      await import("@/lib/chaos/repository");
    const result = await loadC11RealWebhookFailureEvidence(WEBHOOK_EVENT_ID);
    expect(result).toEqual({
      webhookEventId: WEBHOOK_EVENT_ID,
      orderId: ORDER_ID,
      baseline: {
        orderId: ORDER_ID,
        paymentStatus: "FAILED_OBSERVED",
        businessStatus: "OPEN",
        fulfilmentCount: 0,
      },
    });
  });
});

describe("loadC11TestFixtureFailureEvidence", () => {
  it("always returns null — Phase 3A implements no fixture store", async () => {
    const { loadC11TestFixtureFailureEvidence } =
      await import("@/lib/chaos/repository");
    expect(
      await loadC11TestFixtureFailureEvidence("any-fixture-id"),
    ).toBeNull();
  });
});

describe("this module exposes no mutation capability", () => {
  it("exports no insert/update/delete/upsert-shaped function", async () => {
    const mod = await import("@/lib/chaos/repository");
    const mutationLike = /^(insert|update|delete|upsert|remove|write|create)/i;
    for (const name of Object.keys(mod)) {
      expect(name).not.toMatch(mutationLike);
    }
  });
});
