import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Phase 2D: `lib/webhooks/repository.ts` behavior exercised here against a
// MOCKED Supabase client (no network) — real-Supabase behavior is
// separately proven by
// tests/integration/supabase/048-webhook-events.integration.test.ts.
vi.mock("server-only", () => ({}));

interface MockResult {
  data: unknown;
  error: unknown;
}

type InsertFn = (payload: Record<string, unknown>) => FakeQueryBuilder;
type SelectFn = () => FakeQueryBuilder;
type SingleFn = () => Promise<MockResult>;

interface FakeQueryBuilder extends PromiseLike<MockResult> {
  insert: Mock<InsertFn>;
  select: Mock<SelectFn>;
  single: Mock<SingleFn>;
}

function makeQueryBuilder(result: MockResult): FakeQueryBuilder {
  const builder: FakeQueryBuilder = {
    insert: vi.fn<InsertFn>(() => builder),
    select: vi.fn<SelectFn>(() => builder),
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
    // Never sets normalization/correlation fields at insert time — those
    // are Phase 2E's responsibility and remain database-default NULL.
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

  it("architect review correction (2026-08-26): a unique-constraint violation (23505) is treated as a generic repository failure, NOT a special duplicate-recognition outcome — that belongs to Phase 2E", async () => {
    const builder = makeQueryBuilder({
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });
    fromMock.mockReturnValue(builder);

    const { insertWebhookEvent, WebhookRepositoryError } =
      await import("@/lib/webhooks/repository");

    await expect(
      insertWebhookEvent({
        razorpayEventId: "evt_dup",
        eventType: "payment.captured",
        providerCreatedAt: null,
        rawBodySha256: "b".repeat(64),
        rawPayloadRedacted: {},
      }),
    ).rejects.toThrow(WebhookRepositoryError);
  });

  it("a 23505 failure never leaks the raw Supabase error message", async () => {
    const builder = makeQueryBuilder({
      data: null,
      error: { code: "23505", message: "connection string leaked here" },
    });
    fromMock.mockReturnValue(builder);

    const { insertWebhookEvent, WebhookRepositoryError } =
      await import("@/lib/webhooks/repository");

    try {
      await insertWebhookEvent({
        razorpayEventId: "evt_dup_2",
        eventType: "payment.captured",
        providerCreatedAt: null,
        rawBodySha256: "c".repeat(64),
        rawPayloadRedacted: {},
      });
      throw new Error("expected insertWebhookEvent to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(WebhookRepositoryError);
      expect((err as Error).message).not.toContain("connection string");
    }
  });

  it("this module no longer exports a duplicate-recognition error type (Phase 2E scope)", async () => {
    const repository = await import("@/lib/webhooks/repository");
    expect(
      (repository as Record<string, unknown>).WebhookEventAlreadyRecordedError,
    ).toBeUndefined();
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
