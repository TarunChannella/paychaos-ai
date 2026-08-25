import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Phase 2D/2E: `lib/webhooks/repository.ts` behavior exercised here against
// a MOCKED Supabase client (no network) — real-Supabase behavior is
// separately proven by
// tests/integration/supabase/048-webhook-events.integration.test.ts and
// tests/integration/supabase/049-event-processing-attempts.integration.test.ts.
vi.mock("server-only", () => ({}));

interface MockResult {
  data: unknown;
  error: unknown;
}

type InsertFn = (payload: Record<string, unknown>) => FakeQueryBuilder;
type UpdateFn = (payload: Record<string, unknown>) => FakeQueryBuilder;
type SelectFn = () => FakeQueryBuilder;
type EqFn = (column: string, value: unknown) => FakeQueryBuilder;
type MaybeSingleFn = () => Promise<MockResult>;
type SingleFn = () => Promise<MockResult>;

interface FakeQueryBuilder extends PromiseLike<MockResult> {
  insert: Mock<InsertFn>;
  update: Mock<UpdateFn>;
  select: Mock<SelectFn>;
  eq: Mock<EqFn>;
  maybeSingle: Mock<MaybeSingleFn>;
  single: Mock<SingleFn>;
}

function makeQueryBuilder(result: MockResult): FakeQueryBuilder {
  const builder: FakeQueryBuilder = {
    insert: vi.fn<InsertFn>(() => builder),
    update: vi.fn<UpdateFn>(() => builder),
    select: vi.fn<SelectFn>(() => builder),
    eq: vi.fn<EqFn>(() => builder),
    maybeSingle: vi.fn<MaybeSingleFn>(async () => result),
    single: vi.fn<SingleFn>(async () => result),
    then: (onfulfilled, onrejected) =>
      Promise.resolve(result).then(onfulfilled, onrejected),
  };
  return builder;
}

const fromMock = vi.fn();
const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => ({ from: fromMock, rpc: rpcMock }),
}));

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
});

describe("insertWebhookEvent", () => {
  it("inserts using exactly the trusted fields, with signature_verified always true", async () => {
    const persistedRow = {
      id: "webhook-event-1",
      razorpay_event_id: "evt_fake_id",
      event_type: "payment.captured",
      source_kind: "REAL_RAZORPAY_WEBHOOK",
      signature_verified: true,
      raw_body_sha256: "a".repeat(64),
      raw_payload_redacted: { event: "payment.captured" },
      processing_status: "RECEIVED",
      duplicate_delivery_count: 0,
    };
    const builder = makeQueryBuilder({ data: persistedRow, error: null });
    fromMock.mockReturnValue(builder);

    const { insertWebhookEvent } = await import("@/lib/webhooks/repository");
    const result = await insertWebhookEvent({
      razorpayEventId: "evt_fake_id",
      eventType: "payment.captured",
      providerCreatedAt: null,
      rawBodySha256: "a".repeat(64),
      rawPayloadRedacted: { event: "payment.captured" },
    });

    expect(fromMock).toHaveBeenCalledWith("webhook_events");
    const insertPayload = builder.insert.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(insertPayload).toEqual({
      razorpay_event_id: "evt_fake_id",
      event_type: "payment.captured",
      signature_verified: true,
      provider_created_at: null,
      raw_body_sha256: "a".repeat(64),
      raw_payload_redacted: { event: "payment.captured" },
    });
    for (const forbidden of [
      "razorpay_order_id",
      "razorpay_payment_id",
      "payment_attempt_id",
      "payment_id",
      "amount_subunits",
      "currency",
      "razorpay_payment_status",
      "source_kind",
    ]) {
      expect(insertPayload).not.toHaveProperty(forbidden);
    }
    expect(result).toEqual(persistedRow);
  });

  it("Phase 2E: returns null (not a throw) on a unique-constraint violation (23505) — duplicate recognition is Phase 2E's own job", async () => {
    const builder = makeQueryBuilder({
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });
    fromMock.mockReturnValue(builder);

    const { insertWebhookEvent } = await import("@/lib/webhooks/repository");

    const result = await insertWebhookEvent({
      razorpayEventId: "evt_dup",
      eventType: "payment.captured",
      providerCreatedAt: null,
      rawBodySha256: "b".repeat(64),
      rawPayloadRedacted: {},
    });

    expect(result).toBeNull();
  });

  it("throws WebhookRepositoryError (never leaks the raw Supabase error) on any other insert failure", async () => {
    const builder = makeQueryBuilder({
      data: null,
      error: { code: "XX000", message: "connection string leaked here" },
    });
    fromMock.mockReturnValue(builder);

    const { insertWebhookEvent, WebhookRepositoryError } =
      await import("@/lib/webhooks/repository");

    await expect(
      insertWebhookEvent({
        razorpayEventId: "evt_fail",
        eventType: "payment.captured",
        providerCreatedAt: null,
        rawBodySha256: "d".repeat(64),
        rawPayloadRedacted: {},
      }),
    ).rejects.toThrow(WebhookRepositoryError);

    try {
      await insertWebhookEvent({
        razorpayEventId: "evt_fail",
        eventType: "payment.captured",
        providerCreatedAt: null,
        rawBodySha256: "d".repeat(64),
        rawPayloadRedacted: {},
      });
      throw new Error("expected insertWebhookEvent to throw");
    } catch (err) {
      expect((err as Error).message).not.toContain("connection string");
    }
  });
});

describe("getWebhookEventByRazorpayEventId", () => {
  it("returns the row when found", async () => {
    const row = { id: "webhook-event-1", razorpay_event_id: "evt_fake_id" };
    const builder = makeQueryBuilder({ data: row, error: null });
    fromMock.mockReturnValue(builder);

    const { getWebhookEventByRazorpayEventId } =
      await import("@/lib/webhooks/repository");
    const result = await getWebhookEventByRazorpayEventId("evt_fake_id");

    expect(fromMock).toHaveBeenCalledWith("webhook_events");
    expect(builder.eq).toHaveBeenCalledWith("razorpay_event_id", "evt_fake_id");
    expect(result).toEqual(row);
  });

  it("returns null when not found", async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    fromMock.mockReturnValue(builder);

    const { getWebhookEventByRazorpayEventId } =
      await import("@/lib/webhooks/repository");
    expect(await getWebhookEventByRazorpayEventId("evt_missing")).toBeNull();
  });

  it("throws WebhookRepositoryError on a lookup failure, never leaking the raw error", async () => {
    const builder = makeQueryBuilder({
      data: null,
      error: { message: "connection string leaked here" },
    });
    fromMock.mockReturnValue(builder);

    const { getWebhookEventByRazorpayEventId, WebhookRepositoryError } =
      await import("@/lib/webhooks/repository");

    try {
      await getWebhookEventByRazorpayEventId("evt_fail");
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(WebhookRepositoryError);
      expect((err as Error).message).not.toContain("connection string");
    }
  });
});

describe("incrementWebhookDuplicateDeliveryCount", () => {
  it("calls the record_webhook_duplicate_delivery RPC with the exact event id and returns the updated row", async () => {
    const updatedRow = {
      id: "webhook-event-1",
      razorpay_event_id: "evt_fake_id",
      duplicate_delivery_count: 1,
    };
    rpcMock.mockResolvedValue({ data: updatedRow, error: null });

    const { incrementWebhookDuplicateDeliveryCount } =
      await import("@/lib/webhooks/repository");
    const result = await incrementWebhookDuplicateDeliveryCount("evt_fake_id");

    expect(rpcMock).toHaveBeenCalledWith("record_webhook_duplicate_delivery", {
      p_razorpay_event_id: "evt_fake_id",
    });
    expect(result).toEqual(updatedRow);
  });

  it("throws WebhookRepositoryError (never leaks the raw error) when the RPC fails", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "connection string leaked here" },
    });

    const { incrementWebhookDuplicateDeliveryCount, WebhookRepositoryError } =
      await import("@/lib/webhooks/repository");

    try {
      await incrementWebhookDuplicateDeliveryCount("evt_fail");
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(WebhookRepositoryError);
      expect((err as Error).message).not.toContain("connection string");
    }
  });

  it("this is NEVER implemented as a select-then-increment-in-JS pattern (structural guard)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../lib/webhooks/repository.ts"),
      "utf-8",
    );
    // The increment function must delegate to the RPC, not read
    // duplicate_delivery_count in JS and write count + 1 back itself.
    const fnMatch = source.match(
      /export async function incrementWebhookDuplicateDeliveryCount[\s\S]*?\n}/,
    );
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0]!;
    expect(fnBody).toContain("client.rpc(");
    expect(fnBody).not.toMatch(/duplicate_delivery_count\s*\+\s*1/);
  });
});

describe("updateWebhookEventDerivedFields", () => {
  it("updates exactly the derived fields, never the immutable evidence fields", async () => {
    const updatedRow = { id: "webhook-event-1" };
    const builder = makeQueryBuilder({ data: updatedRow, error: null });
    fromMock.mockReturnValue(builder);

    const { updateWebhookEventDerivedFields } =
      await import("@/lib/webhooks/repository");
    await updateWebhookEventDerivedFields("webhook-event-1", {
      razorpayOrderId: "order_fake_id",
      razorpayPaymentId: "pay_fake_id",
      paymentAttemptId: "attempt-1",
      paymentId: "payment-1",
      amountSubunits: 50000,
      currency: "INR",
      razorpayPaymentStatus: "captured",
    });

    const updatePayload = builder.update.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(updatePayload).toMatchObject({
      razorpay_order_id: "order_fake_id",
      razorpay_payment_id: "pay_fake_id",
      payment_attempt_id: "attempt-1",
      payment_id: "payment-1",
      amount_subunits: 50000,
      currency: "INR",
      razorpay_payment_status: "captured",
    });
    expect(updatePayload).toHaveProperty("updated_at");
    for (const immutable of [
      "razorpay_event_id",
      "event_type",
      "source_kind",
      "signature_verified",
      "received_at",
      "provider_created_at",
      "raw_body_sha256",
      "raw_payload_redacted",
      "processing_status",
      "processed_at",
    ]) {
      expect(updatePayload).not.toHaveProperty(immutable);
    }
    expect(builder.eq).toHaveBeenCalledWith("id", "webhook-event-1");
  });

  it("throws WebhookRepositoryError (never leaks the raw error) on an update failure", async () => {
    const builder = makeQueryBuilder({
      data: null,
      error: { message: "connection string leaked here" },
    });
    fromMock.mockReturnValue(builder);

    const { updateWebhookEventDerivedFields, WebhookRepositoryError } =
      await import("@/lib/webhooks/repository");

    try {
      await updateWebhookEventDerivedFields("webhook-event-1", {
        razorpayOrderId: null,
        razorpayPaymentId: null,
        paymentAttemptId: null,
        paymentId: null,
        amountSubunits: null,
        currency: null,
        razorpayPaymentStatus: null,
      });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(WebhookRepositoryError);
      expect((err as Error).message).not.toContain("connection string");
    }
  });
});

describe("lib/webhooks/repository.ts — structural server-only boundary", () => {
  it("imports the server-only marker package as its first import", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../lib/webhooks/repository.ts"),
      "utf-8",
    );
    expect(source).toMatch(/^import\s+["']server-only["'];/m);
  });
});
