import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Phase 2E: `lib/webhooks/event-processing-repository.ts` behavior exercised
// here against a MOCKED Supabase client (no network) — real-Supabase
// behavior is separately proven by
// tests/integration/supabase/049-event-processing-attempts.integration.test.ts.
vi.mock("server-only", () => ({}));

interface MockResult {
  data: unknown;
  error: unknown;
}

type InsertFn = (payload: Record<string, unknown>) => FakeQueryBuilder;
type SelectFn = () => FakeQueryBuilder;
type EqFn = (column: string, value: unknown) => FakeQueryBuilder;
type InFn = (column: string, values: readonly string[]) => FakeQueryBuilder;
type OrderFn = (column: string, opts: unknown) => FakeQueryBuilder;
type LimitFn = (count: number) => FakeQueryBuilder;
type MaybeSingleFn = () => Promise<MockResult>;
type SingleFn = () => Promise<MockResult>;

interface FakeQueryBuilder extends PromiseLike<MockResult> {
  insert: Mock<InsertFn>;
  select: Mock<SelectFn>;
  eq: Mock<EqFn>;
  in: Mock<InFn>;
  order: Mock<OrderFn>;
  limit: Mock<LimitFn>;
  maybeSingle: Mock<MaybeSingleFn>;
  single: Mock<SingleFn>;
}

function makeQueryBuilder(result: MockResult): FakeQueryBuilder {
  const builder: FakeQueryBuilder = {
    insert: vi.fn<InsertFn>(() => builder),
    select: vi.fn<SelectFn>(() => builder),
    eq: vi.fn<EqFn>(() => builder),
    in: vi.fn<InFn>(() => builder),
    order: vi.fn<OrderFn>(() => builder),
    limit: vi.fn<LimitFn>(() => builder),
    maybeSingle: vi.fn<MaybeSingleFn>(async () => result),
    single: vi.fn<SingleFn>(async () => result),
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

describe("insertEventProcessingAttempt", () => {
  it("inserts using exactly the given fields, always source_kind REAL_RAZORPAY_WEBHOOK", async () => {
    const persistedRow = { id: "attempt-1", status: "PENDING" };
    const builder = makeQueryBuilder({ data: persistedRow, error: null });
    fromMock.mockReturnValue(builder);

    const { insertEventProcessingAttempt } =
      await import("@/lib/webhooks/event-processing-repository");
    const result = await insertEventProcessingAttempt({
      webhookEventId: "webhook-event-1",
      paymentAttemptId: "attempt-1",
      paymentId: "payment-1",
      isDuplicateDelivery: false,
      status: "PENDING",
      normalizedEvent: { kind: "payment.captured" },
      errorCode: null,
      errorMessageRedacted: null,
    });

    expect(fromMock).toHaveBeenCalledWith("event_processing_attempts");
    const insertPayload = builder.insert.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(insertPayload).toMatchObject({
      webhook_event_id: "webhook-event-1",
      payment_attempt_id: "attempt-1",
      payment_id: "payment-1",
      source_kind: "REAL_RAZORPAY_WEBHOOK",
      is_duplicate_delivery: false,
      status: "PENDING",
      normalized_event: { kind: "payment.captured" },
      error_code: null,
      error_message_redacted: null,
    });
    expect(result).toEqual(persistedRow);
  });

  // Correction A: finished_at is derived from status, never blindly
  // stamped for every insert.
  it("A1: a PENDING insert has finished_at NULL", async () => {
    const builder = makeQueryBuilder({
      data: { id: "attempt-1", status: "PENDING" },
      error: null,
    });
    fromMock.mockReturnValue(builder);

    const { insertEventProcessingAttempt } =
      await import("@/lib/webhooks/event-processing-repository");
    await insertEventProcessingAttempt({
      webhookEventId: "webhook-event-1",
      paymentAttemptId: "attempt-1",
      paymentId: null,
      isDuplicateDelivery: false,
      status: "PENDING",
      normalizedEvent: {},
      errorCode: null,
      errorMessageRedacted: null,
    });

    const insertPayload = builder.insert.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(insertPayload.finished_at).toBeNull();
  });

  it("A2: a FAILED insert has a non-null finished_at", async () => {
    const builder = makeQueryBuilder({
      data: { id: "attempt-2", status: "FAILED" },
      error: null,
    });
    fromMock.mockReturnValue(builder);

    const { insertEventProcessingAttempt } =
      await import("@/lib/webhooks/event-processing-repository");
    await insertEventProcessingAttempt({
      webhookEventId: "webhook-event-1",
      paymentAttemptId: null,
      paymentId: null,
      isDuplicateDelivery: false,
      status: "FAILED",
      normalizedEvent: {},
      errorCode: "CORRELATION_ORDER_NOT_FOUND",
      errorMessageRedacted: "No payment attempt correlates to this order.",
    });

    const insertPayload = builder.insert.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(insertPayload.finished_at).toEqual(expect.any(String));
    expect(insertPayload.error_code).toBe("CORRELATION_ORDER_NOT_FOUND");
    expect(insertPayload.error_message_redacted).toBe(
      "No payment attempt correlates to this order.",
    );
  });

  it("A3: a SKIPPED_DUPLICATE insert has a non-null finished_at", async () => {
    const builder = makeQueryBuilder({
      data: { id: "attempt-3", status: "SKIPPED_DUPLICATE" },
      error: null,
    });
    fromMock.mockReturnValue(builder);

    const { insertEventProcessingAttempt } =
      await import("@/lib/webhooks/event-processing-repository");
    await insertEventProcessingAttempt({
      webhookEventId: "webhook-event-1",
      paymentAttemptId: "attempt-1",
      paymentId: "payment-1",
      isDuplicateDelivery: true,
      status: "SKIPPED_DUPLICATE",
      normalizedEvent: { kind: "payment.captured" },
      errorCode: null,
      errorMessageRedacted: null,
    });

    const insertPayload = builder.insert.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(insertPayload.finished_at).toEqual(expect.any(String));
  });

  it("A4 / Phase 2F compatibility: PROCESSING/HELD have finished_at NULL, SUCCEEDED has a non-null finished_at", async () => {
    const { insertEventProcessingAttempt } =
      await import("@/lib/webhooks/event-processing-repository");

    for (const status of ["PROCESSING", "HELD"] as const) {
      const builder = makeQueryBuilder({
        data: { id: `attempt-${status}`, status },
        error: null,
      });
      fromMock.mockReturnValue(builder);
      await insertEventProcessingAttempt({
        webhookEventId: "webhook-event-1",
        paymentAttemptId: "attempt-1",
        paymentId: "payment-1",
        isDuplicateDelivery: false,
        status,
        normalizedEvent: {},
        errorCode: null,
        errorMessageRedacted: null,
      });
      const insertPayload = builder.insert.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;
      expect(insertPayload.finished_at).toBeNull();
    }

    const succeededBuilder = makeQueryBuilder({
      data: { id: "attempt-succeeded", status: "SUCCEEDED" },
      error: null,
    });
    fromMock.mockReturnValue(succeededBuilder);
    await insertEventProcessingAttempt({
      webhookEventId: "webhook-event-1",
      paymentAttemptId: "attempt-1",
      paymentId: "payment-1",
      isDuplicateDelivery: false,
      status: "SUCCEEDED",
      normalizedEvent: {},
      errorCode: null,
      errorMessageRedacted: null,
    });
    const succeededPayload = succeededBuilder.insert.mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(succeededPayload.finished_at).toEqual(expect.any(String));
  });

  it("throws EventProcessingRepositoryError (never leaks the raw Supabase error) on an insert failure", async () => {
    const builder = makeQueryBuilder({
      data: null,
      error: { message: "connection string leaked here" },
    });
    fromMock.mockReturnValue(builder);

    const { insertEventProcessingAttempt, EventProcessingRepositoryError } =
      await import("@/lib/webhooks/event-processing-repository");

    try {
      await insertEventProcessingAttempt({
        webhookEventId: "webhook-event-1",
        paymentAttemptId: null,
        paymentId: null,
        isDuplicateDelivery: false,
        status: "FAILED",
        normalizedEvent: {},
        errorCode: "NORMALIZATION_INVALID_PAYLOAD",
        errorMessageRedacted: "invalid",
      });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EventProcessingRepositoryError);
      expect((err as Error).message).not.toContain("connection string");
    }
  });
});

describe("getDurableNormalizedAttemptForWebhookEvent", () => {
  it("queries only PENDING/HELD/PROCESSING/SUCCEEDED, ordered by started_at descending, limit 1", async () => {
    const row = { id: "attempt-latest", status: "PENDING" };
    const builder = makeQueryBuilder({ data: row, error: null });
    fromMock.mockReturnValue(builder);

    const { getDurableNormalizedAttemptForWebhookEvent } =
      await import("@/lib/webhooks/event-processing-repository");
    const result =
      await getDurableNormalizedAttemptForWebhookEvent("webhook-event-1");

    expect(builder.eq).toHaveBeenCalledWith(
      "webhook_event_id",
      "webhook-event-1",
    );
    expect(builder.in).toHaveBeenCalledWith("status", [
      "PENDING",
      "HELD",
      "PROCESSING",
      "SUCCEEDED",
    ]);
    expect(builder.order).toHaveBeenCalledWith(
      "started_at",
      expect.objectContaining({ ascending: false }),
    );
    expect(builder.limit).toHaveBeenCalledWith(1);
    expect(result).toEqual(row);
  });

  it("does NOT include FAILED or SKIPPED_DUPLICATE in the eligible-status filter", async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    fromMock.mockReturnValue(builder);

    const { getDurableNormalizedAttemptForWebhookEvent } =
      await import("@/lib/webhooks/event-processing-repository");
    await getDurableNormalizedAttemptForWebhookEvent("webhook-event-1");

    const eligibleStatuses = builder.in.mock.calls[0]?.[1] as string[];
    expect(eligibleStatuses).not.toContain("FAILED");
    expect(eligibleStatuses).not.toContain("SKIPPED_DUPLICATE");
  });

  it("returns null when no eligible attempt exists yet", async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    fromMock.mockReturnValue(builder);

    const { getDurableNormalizedAttemptForWebhookEvent } =
      await import("@/lib/webhooks/event-processing-repository");
    expect(
      await getDurableNormalizedAttemptForWebhookEvent("webhook-event-none"),
    ).toBeNull();
  });

  it("throws EventProcessingRepositoryError (never leaks the raw error) on a lookup failure", async () => {
    const builder = makeQueryBuilder({
      data: null,
      error: { message: "connection string leaked here" },
    });
    fromMock.mockReturnValue(builder);

    const {
      getDurableNormalizedAttemptForWebhookEvent,
      EventProcessingRepositoryError,
    } = await import("@/lib/webhooks/event-processing-repository");

    try {
      await getDurableNormalizedAttemptForWebhookEvent("webhook-event-1");
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EventProcessingRepositoryError);
      expect((err as Error).message).not.toContain("connection string");
    }
  });
});

describe("lib/webhooks/event-processing-repository.ts — structural server-only boundary", () => {
  it("imports the server-only marker package as its first import", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../lib/webhooks/event-processing-repository.ts",
      ),
      "utf-8",
    );
    expect(source).toMatch(/^import\s+["']server-only["'];/m);
  });
});
