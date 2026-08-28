import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 3D-E: `lib/chaos/c11-observation-repository.ts` behavior against a
// MOCKED Supabase client (no network). Real-Supabase mechanics are
// separately proven by
// tests/integration/supabase/059-chaos-c11-a-observation.integration.test.ts.
vi.mock("server-only", () => ({}));

interface MockResult {
  data: unknown;
  error: unknown;
}

type TableResponses = Record<string, MockResult>;

/** Minimal chained query-builder mock: every terminal chain call resolves to the fixed result configured for that table. */
function makeFromMock(responses: TableResponses) {
  return vi.fn((table: string) => {
    const result: MockResult = responses[table] ?? { data: null, error: null };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      not: () => builder,
      is: () => builder,
      gte: () => builder,
      single: async () => result,
      then: (onfulfilled: (v: MockResult) => unknown, onrejected?: unknown) =>
        Promise.resolve(result).then(
          onfulfilled,
          onrejected as (reason: unknown) => unknown,
        ),
    };
    return builder;
  });
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => ({
    from: (fromMockRef as { current: ReturnType<typeof makeFromMock> }).current,
  }),
}));

const fromMockRef: { current: ReturnType<typeof makeFromMock> } = {
  current: makeFromMock({}),
};

function setResponses(responses: TableResponses): void {
  fromMockRef.current = makeFromMock(responses);
}

beforeEach(() => {
  setResponses({});
});

const ORDER_ID = "99999999-9999-9999-9999-999999999999";
const ATTEMPT_ID = "22222222-2222-2222-2222-222222222222";
const PAYMENT_ID = "33333333-3333-3333-3333-333333333333";
const WEBHOOK_EVENT_ID = "11111111-1111-1111-1111-111111111111";
const PROC_ATTEMPT_ID = "44444444-4444-4444-4444-444444444444";
const RUN_STARTED_AT = "2026-01-01T00:00:00.000Z";

function fakeWebhookEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: WEBHOOK_EVENT_ID,
    event_type: "payment.failed",
    source_kind: "REAL_RAZORPAY_WEBHOOK",
    signature_verified: true,
    processing_status: "PROCESSED",
    payment_attempt_id: ATTEMPT_ID,
    payment_id: PAYMENT_ID,
    received_at: "2026-01-01T01:00:00.000Z",
    ...overrides,
  };
}

function fakeNormalizedEvent(overrides: Record<string, unknown> = {}) {
  return {
    sourceKind: "REAL_RAZORPAY_WEBHOOK",
    eventType: "payment.failed",
    kind: "payment.failed",
    razorpayPaymentStatus: "failed",
    ...overrides,
  };
}

function fakeProcessingAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: PROC_ATTEMPT_ID,
    webhook_event_id: WEBHOOK_EVENT_ID,
    source_kind: "REAL_RAZORPAY_WEBHOOK",
    status: "SUCCEEDED",
    is_duplicate_delivery: false,
    chaos_run_id: null,
    payment_attempt_id: ATTEMPT_ID,
    payment_id: PAYMENT_ID,
    normalized_event: fakeNormalizedEvent(),
    ...overrides,
  };
}

function setUpResolvedHappyPath() {
  setResponses({
    payment_attempts: { data: [{ id: ATTEMPT_ID }], error: null },
    webhook_events: { data: [fakeWebhookEvent()], error: null },
    event_processing_attempts: {
      data: [fakeProcessingAttempt()],
      error: null,
    },
  });
}

describe("resolveC11AFailureObservationEvidence — resolves uniquely", () => {
  it("returns RESOLVED with the exact webhookEventId/paymentAttemptId/paymentId when every layer matches", async () => {
    setUpResolvedHappyPath();
    const { resolveC11AFailureObservationEvidence } =
      await import("@/lib/chaos/c11-observation-repository");
    const result = await resolveC11AFailureObservationEvidence(
      ORDER_ID,
      RUN_STARTED_AT,
    );
    expect(result).toEqual({
      kind: "RESOLVED",
      evidence: {
        webhookEventId: WEBHOOK_EVENT_ID,
        paymentAttemptId: ATTEMPT_ID,
        paymentId: PAYMENT_ID,
      },
    });
  });
});

describe("resolveC11AFailureObservationEvidence — not yet converged (zero candidates at any layer)", () => {
  it("no payment_attempts for the order -> NOT_YET_CONVERGED", async () => {
    setResponses({
      payment_attempts: { data: [], error: null },
    });
    const { resolveC11AFailureObservationEvidence } =
      await import("@/lib/chaos/c11-observation-repository");
    expect(
      await resolveC11AFailureObservationEvidence(ORDER_ID, RUN_STARTED_AT),
    ).toEqual({ kind: "NOT_YET_CONVERGED" });
  });

  it("no payment.failed candidate -> NOT_YET_CONVERGED", async () => {
    setResponses({
      payment_attempts: { data: [{ id: ATTEMPT_ID }], error: null },
      webhook_events: { data: [], error: null },
    });
    const { resolveC11AFailureObservationEvidence } =
      await import("@/lib/chaos/c11-observation-repository");
    expect(
      await resolveC11AFailureObservationEvidence(ORDER_ID, RUN_STARTED_AT),
    ).toEqual({ kind: "NOT_YET_CONVERGED" });
  });

  it("zero original authoritative processing attempts -> NOT_YET_CONVERGED", async () => {
    setResponses({
      payment_attempts: { data: [{ id: ATTEMPT_ID }], error: null },
      webhook_events: { data: [fakeWebhookEvent()], error: null },
      event_processing_attempts: { data: [], error: null },
    });
    const { resolveC11AFailureObservationEvidence } =
      await import("@/lib/chaos/c11-observation-repository");
    expect(
      await resolveC11AFailureObservationEvidence(ORDER_ID, RUN_STARTED_AT),
    ).toEqual({ kind: "NOT_YET_CONVERGED" });
  });

  it("normalized_event malformed (not an object) -> NOT_YET_CONVERGED", async () => {
    setResponses({
      payment_attempts: { data: [{ id: ATTEMPT_ID }], error: null },
      webhook_events: { data: [fakeWebhookEvent()], error: null },
      event_processing_attempts: {
        data: [fakeProcessingAttempt({ normalized_event: "not-an-object" })],
        error: null,
      },
    });
    const { resolveC11AFailureObservationEvidence } =
      await import("@/lib/chaos/c11-observation-repository");
    expect(
      await resolveC11AFailureObservationEvidence(ORDER_ID, RUN_STARTED_AT),
    ).toEqual({ kind: "NOT_YET_CONVERGED" });
  });

  it.each([
    ["sourceKind", "PAYCHAOS_REPLAY"],
    ["eventType", "payment.captured"],
    ["kind", "payment.captured"],
    ["razorpayPaymentStatus", "captured"],
  ])("normalized event wrong %s -> NOT_YET_CONVERGED", async (field, value) => {
    setResponses({
      payment_attempts: { data: [{ id: ATTEMPT_ID }], error: null },
      webhook_events: { data: [fakeWebhookEvent()], error: null },
      event_processing_attempts: {
        data: [
          fakeProcessingAttempt({
            normalized_event: fakeNormalizedEvent({ [field]: value }),
          }),
        ],
        error: null,
      },
    });
    const { resolveC11AFailureObservationEvidence } =
      await import("@/lib/chaos/c11-observation-repository");
    expect(
      await resolveC11AFailureObservationEvidence(ORDER_ID, RUN_STARTED_AT),
    ).toEqual({ kind: "NOT_YET_CONVERGED" });
  });
});

describe("resolveC11AFailureObservationEvidence — ambiguous (more than one candidate)", () => {
  it("more than one candidate webhook event -> AMBIGUOUS", async () => {
    setResponses({
      payment_attempts: { data: [{ id: ATTEMPT_ID }], error: null },
      webhook_events: {
        data: [
          fakeWebhookEvent({ id: "aaaa1111-0000-0000-0000-000000000001" }),
          fakeWebhookEvent({ id: "aaaa2222-0000-0000-0000-000000000002" }),
        ],
        error: null,
      },
    });
    const { resolveC11AFailureObservationEvidence } =
      await import("@/lib/chaos/c11-observation-repository");
    expect(
      await resolveC11AFailureObservationEvidence(ORDER_ID, RUN_STARTED_AT),
    ).toEqual({ kind: "AMBIGUOUS" });
  });

  it("more than one suitable original processing attempt -> AMBIGUOUS (fail closed, never latest/first)", async () => {
    setResponses({
      payment_attempts: { data: [{ id: ATTEMPT_ID }], error: null },
      webhook_events: { data: [fakeWebhookEvent()], error: null },
      event_processing_attempts: {
        data: [
          fakeProcessingAttempt({ id: "bbbb1111-0000-0000-0000-000000000001" }),
          fakeProcessingAttempt({ id: "bbbb2222-0000-0000-0000-000000000002" }),
        ],
        error: null,
      },
    });
    const { resolveC11AFailureObservationEvidence } =
      await import("@/lib/chaos/c11-observation-repository");
    expect(
      await resolveC11AFailureObservationEvidence(ORDER_ID, RUN_STARTED_AT),
    ).toEqual({ kind: "AMBIGUOUS" });
  });
});

describe("resolveC11AFailureObservationEvidence — technical read failures throw", () => {
  it("payment_attempts read failure throws C11ObservationRepositoryError", async () => {
    setResponses({
      payment_attempts: { data: null, error: { message: "db-down" } },
    });
    const {
      resolveC11AFailureObservationEvidence,
      C11ObservationRepositoryError,
    } = await import("@/lib/chaos/c11-observation-repository");
    await expect(
      resolveC11AFailureObservationEvidence(ORDER_ID, RUN_STARTED_AT),
    ).rejects.toBeInstanceOf(C11ObservationRepositoryError);
  });

  it("webhook_events read failure throws C11ObservationRepositoryError", async () => {
    setResponses({
      payment_attempts: { data: [{ id: ATTEMPT_ID }], error: null },
      webhook_events: { data: null, error: { message: "db-down" } },
    });
    const {
      resolveC11AFailureObservationEvidence,
      C11ObservationRepositoryError,
    } = await import("@/lib/chaos/c11-observation-repository");
    await expect(
      resolveC11AFailureObservationEvidence(ORDER_ID, RUN_STARTED_AT),
    ).rejects.toBeInstanceOf(C11ObservationRepositoryError);
  });

  it("event_processing_attempts read failure throws C11ObservationRepositoryError", async () => {
    setResponses({
      payment_attempts: { data: [{ id: ATTEMPT_ID }], error: null },
      webhook_events: { data: [fakeWebhookEvent()], error: null },
      event_processing_attempts: { data: null, error: { message: "db-down" } },
    });
    const {
      resolveC11AFailureObservationEvidence,
      C11ObservationRepositoryError,
    } = await import("@/lib/chaos/c11-observation-repository");
    await expect(
      resolveC11AFailureObservationEvidence(ORDER_ID, RUN_STARTED_AT),
    ).rejects.toBeInstanceOf(C11ObservationRepositoryError);
  });
});

describe("readC11AObservedMerchantState — read-only, throws only on genuine read failure", () => {
  it("resolves successfully (void) when every read succeeds, regardless of content", async () => {
    setResponses({
      orders: {
        data: { payment_status: "PAID", business_status: "FULFILLED" },
        error: null,
      },
      payment_attempts: {
        data: { status: "CAPTURED", order_id: ORDER_ID },
        error: null,
      },
      payments: {
        data: {
          razorpay_payment_status: "captured",
          captured_at: "x",
          failed_at: null,
        },
        error: null,
      },
      fulfilments: { data: [{ id: "f1" }], error: null },
    });
    const { readC11AObservedMerchantState } =
      await import("@/lib/chaos/c11-observation-repository");
    await expect(
      readC11AObservedMerchantState(ORDER_ID, ATTEMPT_ID, PAYMENT_ID),
    ).resolves.toBeUndefined();
  });

  it("throws when the order read fails", async () => {
    setResponses({
      orders: { data: null, error: { message: "db-down" } },
    });
    const { readC11AObservedMerchantState, C11ObservationRepositoryError } =
      await import("@/lib/chaos/c11-observation-repository");
    await expect(
      readC11AObservedMerchantState(ORDER_ID, ATTEMPT_ID, PAYMENT_ID),
    ).rejects.toBeInstanceOf(C11ObservationRepositoryError);
  });

  it("throws when the payment_attempts read fails", async () => {
    setResponses({
      orders: { data: {}, error: null },
      payment_attempts: { data: null, error: { message: "db-down" } },
    });
    const { readC11AObservedMerchantState, C11ObservationRepositoryError } =
      await import("@/lib/chaos/c11-observation-repository");
    await expect(
      readC11AObservedMerchantState(ORDER_ID, ATTEMPT_ID, PAYMENT_ID),
    ).rejects.toBeInstanceOf(C11ObservationRepositoryError);
  });

  it("throws when the payments read fails", async () => {
    setResponses({
      orders: { data: {}, error: null },
      payment_attempts: { data: {}, error: null },
      payments: { data: null, error: { message: "db-down" } },
    });
    const { readC11AObservedMerchantState, C11ObservationRepositoryError } =
      await import("@/lib/chaos/c11-observation-repository");
    await expect(
      readC11AObservedMerchantState(ORDER_ID, ATTEMPT_ID, PAYMENT_ID),
    ).rejects.toBeInstanceOf(C11ObservationRepositoryError);
  });

  it("throws when the fulfilments read fails", async () => {
    setResponses({
      orders: { data: {}, error: null },
      payment_attempts: { data: {}, error: null },
      payments: { data: {}, error: null },
      fulfilments: { data: null, error: { message: "db-down" } },
    });
    const { readC11AObservedMerchantState, C11ObservationRepositoryError } =
      await import("@/lib/chaos/c11-observation-repository");
    await expect(
      readC11AObservedMerchantState(ORDER_ID, ATTEMPT_ID, PAYMENT_ID),
    ).rejects.toBeInstanceOf(C11ObservationRepositoryError);
  });
});

describe("lib/chaos/c11-observation-repository.ts — module surface", () => {
  it("imports the server-only marker package", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../lib/chaos/c11-observation-repository.ts",
      ),
      "utf-8",
    );
    expect(source).toMatch(/import\s+["']server-only["']/);
  });

  it("never inserts/updates/deletes orders/payment_attempts/payments/fulfilments/webhook_events/event_processing_attempts", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../lib/chaos/c11-observation-repository.ts",
      ),
      "utf-8",
    );
    expect(source).not.toMatch(/\.insert\(/);
    expect(source).not.toMatch(/\.update\(/);
    expect(source).not.toMatch(/\.delete\(/);
    expect(source).not.toMatch(/\.upsert\(/);
  });
});
