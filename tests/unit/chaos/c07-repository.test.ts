import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 3D-B — `lib/chaos/c07-repository.ts`'s `resolveC07ConvergenceEvidence`
// exercised against a MOCKED Supabase client (no network) — proves the
// exact-correlation evidence-resolution shape nuances that
// tests/unit/chaos/c07-execution-service.test.ts deliberately does not
// re-derive (that file mocks this module entirely).

vi.mock("server-only", () => ({}));

const getPaymentAttemptByIdMock = vi.fn();
vi.mock("@/lib/demo-merchant/repository", () => ({
  getPaymentAttemptById: getPaymentAttemptByIdMock,
}));

interface FakeResult {
  data: unknown;
  error: unknown;
}

function makeBuilder(result: FakeResult) {
  const builder: {
    select: (...args: unknown[]) => typeof builder;
    eq: (...args: unknown[]) => typeof builder;
    maybeSingle: () => Promise<FakeResult>;
    then: (
      onFulfilled: (value: FakeResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  } = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => result,
    then: (onFulfilled, onRejected) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

const fromMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => ({ from: fromMock }),
}));

beforeEach(() => {
  fromMock.mockReset();
  getPaymentAttemptByIdMock.mockReset();
});

const ORDER_ID = "22222222-2222-2222-2222-222222222222";
const ATTEMPT_ID = "33333333-3333-3333-3333-333333333333";
const PAYMENT_ID = "44444444-4444-4444-4444-444444444444";
const WEBHOOK_ID = "55555555-5555-5555-5555-555555555555";

const PAID_FULFILLED_ORDER = {
  id: ORDER_ID,
  payment_status: "PAID",
  business_status: "FULFILLED",
};

const CAPTURED_ATTEMPT = {
  id: ATTEMPT_ID,
  order_id: ORDER_ID,
  status: "CAPTURED",
};

const CAPTURED_PAYMENT = {
  id: PAYMENT_ID,
  payment_attempt_id: ATTEMPT_ID,
  razorpay_payment_status: "captured",
  captured_at: "2026-01-01T00:05:00.000Z",
};

const MATCHING_FULFILMENT = {
  id: "66666666-6666-6666-6666-666666666666",
  order_id: ORDER_ID,
  payment_id: PAYMENT_ID,
};

const VERIFIED_CAPTURED_WEBHOOK = {
  id: WEBHOOK_ID,
  payment_id: PAYMENT_ID,
  source_kind: "REAL_RAZORPAY_WEBHOOK",
  signature_verified: true,
  event_type: "payment.captured",
};

const VERIFIED_ORDER_PAID_WEBHOOK = {
  id: "77777777-7777-7777-7777-777777777777",
  payment_id: PAYMENT_ID,
  source_kind: "REAL_RAZORPAY_WEBHOOK",
  signature_verified: true,
  event_type: "order.paid",
};

function mockTables(overrides: {
  orders?: unknown;
  payment_attempts?: unknown;
  payments?: unknown;
  fulfilments?: unknown;
  webhook_events?: unknown;
}) {
  const defaults = {
    orders: { data: PAID_FULFILLED_ORDER, error: null },
    payment_attempts: { data: [CAPTURED_ATTEMPT], error: null },
    payments: { data: [CAPTURED_PAYMENT], error: null },
    fulfilments: { data: [MATCHING_FULFILMENT], error: null },
    webhook_events: { data: [VERIFIED_CAPTURED_WEBHOOK], error: null },
  };
  const merged = { ...defaults, ...overrides };
  fromMock.mockImplementation((table: keyof typeof merged) =>
    makeBuilder(merged[table] as FakeResult),
  );
}

async function importRepo() {
  return import("@/lib/chaos/c07-repository");
}

describe("resolveC07ConvergenceEvidence", () => {
  it("full genuine convergence returns the exact correlated evidence", async () => {
    mockTables({});

    const { resolveC07ConvergenceEvidence } = await importRepo();
    const result = await resolveC07ConvergenceEvidence(ORDER_ID);

    expect(result).toEqual({
      paymentAttemptId: ATTEMPT_ID,
      paymentId: PAYMENT_ID,
      webhookEventId: WEBHOOK_ID,
    });
  });

  it("22: a captured payment but order not yet PAID returns null (NOT_YET_CONVERGED)", async () => {
    mockTables({
      orders: {
        data: { ...PAID_FULFILLED_ORDER, payment_status: "PENDING" },
        error: null,
      },
    });

    const { resolveC07ConvergenceEvidence } = await importRepo();
    expect(await resolveC07ConvergenceEvidence(ORDER_ID)).toBeNull();
  });

  it("order PAID but not yet FULFILLED returns null", async () => {
    mockTables({
      orders: {
        data: { ...PAID_FULFILLED_ORDER, business_status: "OPEN" },
        error: null,
      },
    });

    const { resolveC07ConvergenceEvidence } = await importRepo();
    expect(await resolveC07ConvergenceEvidence(ORDER_ID)).toBeNull();
  });

  it("23: PAID+FULFILLED but zero fulfilment rows returns null", async () => {
    mockTables({ fulfilments: { data: [], error: null } });

    const { resolveC07ConvergenceEvidence } = await importRepo();
    expect(await resolveC07ConvergenceEvidence(ORDER_ID)).toBeNull();
  });

  it("24: more than one fulfilment row is never treated as healthy convergence", async () => {
    mockTables({
      fulfilments: {
        data: [
          MATCHING_FULFILMENT,
          {
            ...MATCHING_FULFILMENT,
            id: "88888888-8888-8888-8888-888888888888",
          },
        ],
        error: null,
      },
    });

    const { resolveC07ConvergenceEvidence } = await importRepo();
    expect(await resolveC07ConvergenceEvidence(ORDER_ID)).toBeNull();
  });

  it("more than one CAPTURED payment attempt is treated as ambiguous, never guessed", async () => {
    mockTables({
      payment_attempts: {
        data: [
          CAPTURED_ATTEMPT,
          { ...CAPTURED_ATTEMPT, id: "99999999-9999-9999-9999-999999999999" },
        ],
        error: null,
      },
    });

    const { resolveC07ConvergenceEvidence } = await importRepo();
    expect(await resolveC07ConvergenceEvidence(ORDER_ID)).toBeNull();
  });

  it("25: a synthetic/unverified webhook (signature_verified filter excludes it) never converges", async () => {
    mockTables({ webhook_events: { data: [], error: null } });

    const { resolveC07ConvergenceEvidence } = await importRepo();
    expect(await resolveC07ConvergenceEvidence(ORDER_ID)).toBeNull();
  });

  it("a fulfilment whose payment_id does not match the captured payment never converges", async () => {
    mockTables({
      fulfilments: {
        data: [{ ...MATCHING_FULFILMENT, payment_id: "mismatched-payment-id" }],
        error: null,
      },
    });

    const { resolveC07ConvergenceEvidence } = await importRepo();
    expect(await resolveC07ConvergenceEvidence(ORDER_ID)).toBeNull();
  });

  it("26/28: payment.captured is preferred over order.paid when both exist", async () => {
    mockTables({
      webhook_events: {
        data: [VERIFIED_ORDER_PAID_WEBHOOK, VERIFIED_CAPTURED_WEBHOOK],
        error: null,
      },
    });

    const { resolveC07ConvergenceEvidence } = await importRepo();
    const result = await resolveC07ConvergenceEvidence(ORDER_ID);

    expect(result?.webhookEventId).toBe(WEBHOOK_ID);
  });

  it("order.paid is accepted only when payment.captured is absent", async () => {
    mockTables({
      webhook_events: { data: [VERIFIED_ORDER_PAID_WEBHOOK], error: null },
    });

    const { resolveC07ConvergenceEvidence } = await importRepo();
    const result = await resolveC07ConvergenceEvidence(ORDER_ID);

    expect(result?.webhookEventId).toBe(VERIFIED_ORDER_PAID_WEBHOOK.id);
  });

  it("a payment lacking captured_at is never treated as captured", async () => {
    mockTables({
      payments: {
        data: [{ ...CAPTURED_PAYMENT, captured_at: null }],
        error: null,
      },
    });

    const { resolveC07ConvergenceEvidence } = await importRepo();
    expect(await resolveC07ConvergenceEvidence(ORDER_ID)).toBeNull();
  });

  it("throws a repository error (technical failure, not NOT_YET_CONVERGED) on a genuine read failure", async () => {
    mockTables({
      orders: { data: null, error: { message: "connection reset" } },
    });

    const { resolveC07ConvergenceEvidence } = await importRepo();
    await expect(resolveC07ConvergenceEvidence(ORDER_ID)).rejects.toThrow();
  });
});

describe("resolveTrustedOrderIdForPaymentAttempt", () => {
  it("resolves the trusted order_id from the existing getPaymentAttemptById read", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue({
      id: ATTEMPT_ID,
      order_id: ORDER_ID,
    });

    const { resolveTrustedOrderIdForPaymentAttempt } = await importRepo();
    expect(await resolveTrustedOrderIdForPaymentAttempt(ATTEMPT_ID)).toBe(
      ORDER_ID,
    );
  });

  it("returns null when the attempt does not exist", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(null);

    const { resolveTrustedOrderIdForPaymentAttempt } = await importRepo();
    expect(await resolveTrustedOrderIdForPaymentAttempt(ATTEMPT_ID)).toBeNull();
  });
});

describe("resolveActiveArmedC07FaultForOrder", () => {
  it("returns null when the row's fault_state is not armed", async () => {
    fromMock.mockImplementation(() =>
      makeBuilder({
        data: {
          id: "11111111-1111-1111-1111-111111111111",
          fault_state: { armed: false, consumed: false },
        },
        error: null,
      }),
    );

    const { resolveActiveArmedC07FaultForOrder } = await importRepo();
    expect(await resolveActiveArmedC07FaultForOrder(ORDER_ID)).toBeNull();
  });

  it("returns the row when exactly armed, regardless of consumed", async () => {
    const run = {
      id: "11111111-1111-1111-1111-111111111111",
      fault_state: { armed: true, consumed: true },
    };
    fromMock.mockImplementation(() => makeBuilder({ data: run, error: null }));

    const { resolveActiveArmedC07FaultForOrder } = await importRepo();
    expect(await resolveActiveArmedC07FaultForOrder(ORDER_ID)).toEqual(run);
  });

  it("7: an extra-key fault_state fails closed as not active", async () => {
    fromMock.mockImplementation(() =>
      makeBuilder({
        data: {
          id: "11111111-1111-1111-1111-111111111111",
          fault_state: { armed: true, consumed: false, unexpected: "value" },
        },
        error: null,
      }),
    );

    const { resolveActiveArmedC07FaultForOrder } = await importRepo();
    expect(await resolveActiveArmedC07FaultForOrder(ORDER_ID)).toBeNull();
  });

  it("8: a fault_state missing consumed fails closed as not active", async () => {
    fromMock.mockImplementation(() =>
      makeBuilder({
        data: {
          id: "11111111-1111-1111-1111-111111111111",
          fault_state: { armed: true },
        },
        error: null,
      }),
    );

    const { resolveActiveArmedC07FaultForOrder } = await importRepo();
    expect(await resolveActiveArmedC07FaultForOrder(ORDER_ID)).toBeNull();
  });

  it("9: a non-boolean consumed fails closed as not active", async () => {
    fromMock.mockImplementation(() =>
      makeBuilder({
        data: {
          id: "11111111-1111-1111-1111-111111111111",
          fault_state: { armed: true, consumed: "true" },
        },
        error: null,
      }),
    );

    const { resolveActiveArmedC07FaultForOrder } = await importRepo();
    expect(await resolveActiveArmedC07FaultForOrder(ORDER_ID)).toBeNull();
  });

  it("10: the query scopes on data_classification=RECORDED_TEST_EVIDENCE, not merely scenario/status", async () => {
    const builder = makeBuilder({
      data: {
        id: "11111111-1111-1111-1111-111111111111",
        fault_state: { armed: true, consumed: false },
      },
      error: null,
    });
    const eqSpy = vi.spyOn(builder, "eq");
    fromMock.mockImplementation(() => builder);

    const { resolveActiveArmedC07FaultForOrder } = await importRepo();
    await resolveActiveArmedC07FaultForOrder(ORDER_ID);

    expect(eqSpy).toHaveBeenCalledWith(
      "data_classification",
      "RECORDED_TEST_EVIDENCE",
    );
  });
});

describe("parseExactC07FaultState", () => {
  it("accepts exactly {armed: true, consumed: false}", async () => {
    const { parseExactC07FaultState } = await importRepo();
    expect(parseExactC07FaultState({ armed: true, consumed: false })).toEqual({
      armed: true,
      consumed: false,
    });
  });

  it("accepts exactly {armed: true, consumed: true}", async () => {
    const { parseExactC07FaultState } = await importRepo();
    expect(parseExactC07FaultState({ armed: true, consumed: true })).toEqual({
      armed: true,
      consumed: true,
    });
  });

  it("7: rejects an extra key", async () => {
    const { parseExactC07FaultState } = await importRepo();
    expect(
      parseExactC07FaultState({
        armed: true,
        consumed: false,
        extra: "value",
      }),
    ).toBeNull();
  });

  it("8: rejects a missing consumed key", async () => {
    const { parseExactC07FaultState } = await importRepo();
    expect(parseExactC07FaultState({ armed: true })).toBeNull();
  });

  it("9: rejects a non-boolean consumed value", async () => {
    const { parseExactC07FaultState } = await importRepo();
    expect(
      parseExactC07FaultState({ armed: true, consumed: "false" }),
    ).toBeNull();
  });

  it("rejects armed !== true", async () => {
    const { parseExactC07FaultState } = await importRepo();
    expect(
      parseExactC07FaultState({ armed: false, consumed: false }),
    ).toBeNull();
  });

  it("rejects null, arrays, and non-objects", async () => {
    const { parseExactC07FaultState } = await importRepo();
    expect(parseExactC07FaultState(null)).toBeNull();
    expect(parseExactC07FaultState([])).toBeNull();
    expect(parseExactC07FaultState("not an object")).toBeNull();
    expect(parseExactC07FaultState(42)).toBeNull();
    expect(parseExactC07FaultState(undefined)).toBeNull();
  });

  it("rejects an empty object", async () => {
    const { parseExactC07FaultState } = await importRepo();
    expect(parseExactC07FaultState({})).toBeNull();
  });
});

describe("isExactArmedUnconsumedFaultState / isExactArmedConsumedFaultState", () => {
  it("isExactArmedUnconsumedFaultState is true only for {armed:true, consumed:false}", async () => {
    const { isExactArmedUnconsumedFaultState } = await importRepo();
    expect(
      isExactArmedUnconsumedFaultState({ armed: true, consumed: false }),
    ).toBe(true);
    expect(
      isExactArmedUnconsumedFaultState({ armed: true, consumed: true }),
    ).toBe(false);
    expect(
      isExactArmedUnconsumedFaultState({
        armed: true,
        consumed: false,
        extra: 1,
      }),
    ).toBe(false);
  });

  it("isExactArmedConsumedFaultState is true only for {armed:true, consumed:true}", async () => {
    const { isExactArmedConsumedFaultState } = await importRepo();
    expect(
      isExactArmedConsumedFaultState({ armed: true, consumed: true }),
    ).toBe(true);
    expect(
      isExactArmedConsumedFaultState({ armed: true, consumed: false }),
    ).toBe(false);
    expect(
      isExactArmedConsumedFaultState({
        armed: true,
        consumed: true,
        extra: 1,
      }),
    ).toBe(false);
  });
});

describe("resolveTrustedPaymentAttemptForC07", () => {
  it("2: resolves the full trusted attempt row, including razorpay_order_id, via the existing getPaymentAttemptById read", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue({
      id: ATTEMPT_ID,
      order_id: ORDER_ID,
      razorpay_order_id: "order_trusted_abc123",
    });

    const { resolveTrustedPaymentAttemptForC07 } = await importRepo();
    const result = await resolveTrustedPaymentAttemptForC07(ATTEMPT_ID);

    expect(result).toEqual({
      id: ATTEMPT_ID,
      order_id: ORDER_ID,
      razorpay_order_id: "order_trusted_abc123",
    });
  });

  it("returns null when the attempt does not exist", async () => {
    getPaymentAttemptByIdMock.mockResolvedValue(null);

    const { resolveTrustedPaymentAttemptForC07 } = await importRepo();
    expect(await resolveTrustedPaymentAttemptForC07(ATTEMPT_ID)).toBeNull();
  });
});
