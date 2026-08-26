import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Phase 3C: `lib/chaos/replay-repository.ts` behavior against a MOCKED
// Supabase client (no network). Real-Supabase behavior is separately proven
// by tests/integration/supabase/053-chaos-replay-execution.integration.test.ts
// (NOT runnable yet — the Phase 3C migration has not been applied).
vi.mock("server-only", () => ({}));

interface MockResult {
  data: unknown;
  error: unknown;
}

type EqFn = (column: string, value: unknown) => FakeQueryBuilder;
type IsFn = (column: string, value: unknown) => FakeQueryBuilder;
type SelectFn = (columns?: string) => FakeQueryBuilder;
type InsertFn = (payload: Record<string, unknown>) => FakeQueryBuilder;
type SingleFn = () => Promise<MockResult>;
type MaybeSingleFn = () => Promise<MockResult>;

interface FakeQueryBuilder extends PromiseLike<MockResult> {
  select: Mock<SelectFn>;
  insert: Mock<InsertFn>;
  eq: Mock<EqFn>;
  is: Mock<IsFn>;
  single: Mock<SingleFn>;
  maybeSingle: Mock<MaybeSingleFn>;
}

function makeQueryBuilder(result: MockResult): FakeQueryBuilder {
  const builder: FakeQueryBuilder = {
    select: vi.fn<SelectFn>(() => builder),
    insert: vi.fn<InsertFn>(() => builder),
    eq: vi.fn<EqFn>(() => builder),
    is: vi.fn<IsFn>(() => builder),
    single: vi.fn<SingleFn>(async () => result),
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

beforeEach(() => {
  fromMock.mockReset();
});

const WEBHOOK_EVENT_ID = "11111111-1111-1111-1111-111111111111";
const ORDER_ATTEMPT_ID = "22222222-2222-2222-2222-222222222222";
const PAYMENT_ID = "33333333-3333-3333-3333-333333333333";
const ORIGINAL_ATTEMPT_ID = "44444444-4444-4444-4444-444444444444";
const RUN_ID = "55555555-5555-5555-5555-555555555555";

function fakeWebhookEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: WEBHOOK_EVENT_ID,
    razorpay_event_id: "evt_test123",
    event_type: "payment.captured",
    source_kind: "REAL_RAZORPAY_WEBHOOK",
    signature_verified: true,
    payment_attempt_id: ORDER_ATTEMPT_ID,
    payment_id: PAYMENT_ID,
    ...overrides,
  };
}

function fakeOriginalAttemptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ORIGINAL_ATTEMPT_ID,
    webhook_event_id: WEBHOOK_EVENT_ID,
    payment_attempt_id: ORDER_ATTEMPT_ID,
    payment_id: PAYMENT_ID,
    chaos_run_id: null,
    source_kind: "REAL_RAZORPAY_WEBHOOK",
    is_duplicate_delivery: false,
    status: "SUCCEEDED",
    normalized_event: {
      sourceKind: "REAL_RAZORPAY_WEBHOOK",
      eventType: "payment.captured",
      kind: "payment.captured",
    },
    ...overrides,
  };
}

function mockFromByTable(byTable: Record<string, FakeQueryBuilder>) {
  fromMock.mockImplementation((table: string) => {
    const builder = byTable[table];
    if (!builder) {
      throw new Error(`unexpected table queried in test: ${table}`);
    }
    return builder;
  });
}

describe("resolveAuthoritativeC01ReplaySource", () => {
  it("resolves the single authoritative candidate when everything agrees", async () => {
    mockFromByTable({
      webhook_events: makeQueryBuilder({
        data: fakeWebhookEventRow(),
        error: null,
      }),
      event_processing_attempts: makeQueryBuilder({
        data: [fakeOriginalAttemptRow()],
        error: null,
      }),
    });
    const { resolveAuthoritativeC01ReplaySource } =
      await import("@/lib/chaos/replay-repository");

    const result = await resolveAuthoritativeC01ReplaySource({
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
      paymentAttemptId: ORDER_ATTEMPT_ID,
      paymentId: PAYMENT_ID,
    });

    expect(result).toEqual({
      processingAttemptId: ORIGINAL_ATTEMPT_ID,
      webhookEventId: WEBHOOK_EVENT_ID,
      paymentAttemptId: ORDER_ATTEMPT_ID,
      paymentId: PAYMENT_ID,
      normalizedEvent: {
        sourceKind: "REAL_RAZORPAY_WEBHOOK",
        eventType: "payment.captured",
        kind: "payment.captured",
      },
    });
  });

  it("returns null when sourceWebhookEventId is null — never guesses", async () => {
    const { resolveAuthoritativeC01ReplaySource } =
      await import("@/lib/chaos/replay-repository");
    const result = await resolveAuthoritativeC01ReplaySource({
      sourceWebhookEventId: null,
      paymentAttemptId: ORDER_ATTEMPT_ID,
      paymentId: PAYMENT_ID,
    });
    expect(result).toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns null when the webhook event does not exist", async () => {
    mockFromByTable({
      webhook_events: makeQueryBuilder({ data: null, error: null }),
    });
    const { resolveAuthoritativeC01ReplaySource } =
      await import("@/lib/chaos/replay-repository");
    const result = await resolveAuthoritativeC01ReplaySource({
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
      paymentAttemptId: ORDER_ATTEMPT_ID,
      paymentId: PAYMENT_ID,
    });
    expect(result).toBeNull();
  });

  it("returns null when the webhook event is not REAL_RAZORPAY_WEBHOOK or not signature_verified", async () => {
    mockFromByTable({
      webhook_events: makeQueryBuilder({
        data: fakeWebhookEventRow({ signature_verified: false }),
        error: null,
      }),
    });
    const { resolveAuthoritativeC01ReplaySource } =
      await import("@/lib/chaos/replay-repository");
    const result = await resolveAuthoritativeC01ReplaySource({
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
      paymentAttemptId: ORDER_ATTEMPT_ID,
      paymentId: PAYMENT_ID,
    });
    expect(result).toBeNull();
  });

  it("returns null when the webhook event_type is not a P0 C01 source type", async () => {
    mockFromByTable({
      webhook_events: makeQueryBuilder({
        data: fakeWebhookEventRow({ event_type: "payment.failed" }),
        error: null,
      }),
    });
    const { resolveAuthoritativeC01ReplaySource } =
      await import("@/lib/chaos/replay-repository");
    const result = await resolveAuthoritativeC01ReplaySource({
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
      paymentAttemptId: ORDER_ATTEMPT_ID,
      paymentId: PAYMENT_ID,
    });
    expect(result).toBeNull();
  });

  it("returns null when zero candidate processing attempts exist", async () => {
    mockFromByTable({
      webhook_events: makeQueryBuilder({
        data: fakeWebhookEventRow(),
        error: null,
      }),
      event_processing_attempts: makeQueryBuilder({ data: [], error: null }),
    });
    const { resolveAuthoritativeC01ReplaySource } =
      await import("@/lib/chaos/replay-repository");
    const result = await resolveAuthoritativeC01ReplaySource({
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
      paymentAttemptId: ORDER_ATTEMPT_ID,
      paymentId: PAYMENT_ID,
    });
    expect(result).toBeNull();
  });

  it("returns null (fails closed, never picks 'the latest') when MORE THAN ONE candidate exists", async () => {
    mockFromByTable({
      webhook_events: makeQueryBuilder({
        data: fakeWebhookEventRow(),
        error: null,
      }),
      event_processing_attempts: makeQueryBuilder({
        data: [
          fakeOriginalAttemptRow({
            id: "aaaaaaaa-0000-0000-0000-000000000001",
          }),
          fakeOriginalAttemptRow({
            id: "aaaaaaaa-0000-0000-0000-000000000002",
          }),
        ],
        error: null,
      }),
    });
    const { resolveAuthoritativeC01ReplaySource } =
      await import("@/lib/chaos/replay-repository");
    const result = await resolveAuthoritativeC01ReplaySource({
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
      paymentAttemptId: ORDER_ATTEMPT_ID,
      paymentId: PAYMENT_ID,
    });
    expect(result).toBeNull();
  });

  it("filters candidates to source_kind=REAL_RAZORPAY_WEBHOOK, status=SUCCEEDED, is_duplicate_delivery=false at the query level (never PAYCHAOS_REPLAY/FAILED/SKIPPED_DUPLICATE as source authority)", async () => {
    const attemptsBuilder = makeQueryBuilder({
      data: [fakeOriginalAttemptRow()],
      error: null,
    });
    mockFromByTable({
      webhook_events: makeQueryBuilder({
        data: fakeWebhookEventRow(),
        error: null,
      }),
      event_processing_attempts: attemptsBuilder,
    });
    const { resolveAuthoritativeC01ReplaySource } =
      await import("@/lib/chaos/replay-repository");

    await resolveAuthoritativeC01ReplaySource({
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
      paymentAttemptId: ORDER_ATTEMPT_ID,
      paymentId: PAYMENT_ID,
    });

    expect(attemptsBuilder.eq).toHaveBeenCalledWith(
      "webhook_event_id",
      WEBHOOK_EVENT_ID,
    );
    expect(attemptsBuilder.eq).toHaveBeenCalledWith(
      "source_kind",
      "REAL_RAZORPAY_WEBHOOK",
    );
    expect(attemptsBuilder.eq).toHaveBeenCalledWith("status", "SUCCEEDED");
    expect(attemptsBuilder.eq).toHaveBeenCalledWith(
      "is_duplicate_delivery",
      false,
    );
    expect(attemptsBuilder.eq).toHaveBeenCalledWith(
      "payment_attempt_id",
      ORDER_ATTEMPT_ID,
    );
    expect(attemptsBuilder.eq).toHaveBeenCalledWith("payment_id", PAYMENT_ID);
  });

  it("uses truthful NULL equality (.is) when the run's own payment_id is NULL — never matches a non-NULL attempt payment_id", async () => {
    const attemptsBuilder = makeQueryBuilder({
      data: [fakeOriginalAttemptRow({ payment_id: null })],
      error: null,
    });
    mockFromByTable({
      webhook_events: makeQueryBuilder({
        data: fakeWebhookEventRow({
          event_type: "order.paid",
          payment_id: null,
        }),
        error: null,
      }),
      event_processing_attempts: attemptsBuilder,
    });
    const { resolveAuthoritativeC01ReplaySource } =
      await import("@/lib/chaos/replay-repository");

    await resolveAuthoritativeC01ReplaySource({
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
      paymentAttemptId: ORDER_ATTEMPT_ID,
      paymentId: null,
    });

    expect(attemptsBuilder.is).toHaveBeenCalledWith("payment_id", null);
    expect(attemptsBuilder.eq).not.toHaveBeenCalledWith(
      "payment_id",
      expect.anything(),
    );
  });

  it("returns null when the resolved attempt's normalized_event is not an object", async () => {
    mockFromByTable({
      webhook_events: makeQueryBuilder({
        data: fakeWebhookEventRow(),
        error: null,
      }),
      event_processing_attempts: makeQueryBuilder({
        data: [fakeOriginalAttemptRow({ normalized_event: [1, 2, 3] })],
        error: null,
      }),
    });
    const { resolveAuthoritativeC01ReplaySource } =
      await import("@/lib/chaos/replay-repository");
    const result = await resolveAuthoritativeC01ReplaySource({
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
      paymentAttemptId: ORDER_ATTEMPT_ID,
      paymentId: PAYMENT_ID,
    });
    expect(result).toBeNull();
  });

  it("architect correction, Finding 3: returns null when normalized_event.sourceKind is not REAL_RAZORPAY_WEBHOOK, even though the attempt itself is SUCCEEDED/REAL_RAZORPAY_WEBHOOK — the envelope may have been mutated after original processing", async () => {
    mockFromByTable({
      webhook_events: makeQueryBuilder({
        data: fakeWebhookEventRow(),
        error: null,
      }),
      event_processing_attempts: makeQueryBuilder({
        data: [
          fakeOriginalAttemptRow({
            normalized_event: {
              sourceKind: "PAYCHAOS_REPLAY",
              eventType: "payment.captured",
              kind: "payment.captured",
            },
          }),
        ],
        error: null,
      }),
    });
    const { resolveAuthoritativeC01ReplaySource } =
      await import("@/lib/chaos/replay-repository");
    const result = await resolveAuthoritativeC01ReplaySource({
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
      paymentAttemptId: ORDER_ATTEMPT_ID,
      paymentId: PAYMENT_ID,
    });
    expect(result).toBeNull();
  });

  it("architect correction, Finding 3: returns null when normalized_event.kind is missing", async () => {
    mockFromByTable({
      webhook_events: makeQueryBuilder({
        data: fakeWebhookEventRow(),
        error: null,
      }),
      event_processing_attempts: makeQueryBuilder({
        data: [
          fakeOriginalAttemptRow({
            normalized_event: {
              sourceKind: "REAL_RAZORPAY_WEBHOOK",
              eventType: "payment.captured",
            },
          }),
        ],
        error: null,
      }),
    });
    const { resolveAuthoritativeC01ReplaySource } =
      await import("@/lib/chaos/replay-repository");
    const result = await resolveAuthoritativeC01ReplaySource({
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
      paymentAttemptId: ORDER_ATTEMPT_ID,
      paymentId: PAYMENT_ID,
    });
    expect(result).toBeNull();
  });

  it("architect correction, Finding 3: returns null when normalized_event.kind does not equal normalized_event.eventType", async () => {
    mockFromByTable({
      webhook_events: makeQueryBuilder({
        data: fakeWebhookEventRow(),
        error: null,
      }),
      event_processing_attempts: makeQueryBuilder({
        data: [
          fakeOriginalAttemptRow({
            normalized_event: {
              sourceKind: "REAL_RAZORPAY_WEBHOOK",
              eventType: "payment.captured",
              kind: "order.paid",
            },
          }),
        ],
        error: null,
      }),
    });
    const { resolveAuthoritativeC01ReplaySource } =
      await import("@/lib/chaos/replay-repository");
    const result = await resolveAuthoritativeC01ReplaySource({
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
      paymentAttemptId: ORDER_ATTEMPT_ID,
      paymentId: PAYMENT_ID,
    });
    expect(result).toBeNull();
  });

  it("architect correction, Finding 3: returns null when normalized_event.eventType disagrees with the correlated canonical webhook_events.event_type", async () => {
    mockFromByTable({
      webhook_events: makeQueryBuilder({
        data: fakeWebhookEventRow({ event_type: "order.paid" }),
        error: null,
      }),
      event_processing_attempts: makeQueryBuilder({
        data: [
          fakeOriginalAttemptRow({
            normalized_event: {
              sourceKind: "REAL_RAZORPAY_WEBHOOK",
              eventType: "payment.captured",
              kind: "payment.captured",
            },
          }),
        ],
        error: null,
      }),
    });
    const { resolveAuthoritativeC01ReplaySource } =
      await import("@/lib/chaos/replay-repository");
    const result = await resolveAuthoritativeC01ReplaySource({
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
      paymentAttemptId: ORDER_ATTEMPT_ID,
      paymentId: PAYMENT_ID,
    });
    expect(result).toBeNull();
  });

  it("architect correction, Finding 3: a fully valid REAL envelope (sourceKind/kind/eventType all agreeing with the canonical webhook) still resolves", async () => {
    mockFromByTable({
      webhook_events: makeQueryBuilder({
        data: fakeWebhookEventRow({ event_type: "payment.captured" }),
        error: null,
      }),
      event_processing_attempts: makeQueryBuilder({
        data: [
          fakeOriginalAttemptRow({
            normalized_event: {
              sourceKind: "REAL_RAZORPAY_WEBHOOK",
              eventType: "payment.captured",
              kind: "payment.captured",
            },
          }),
        ],
        error: null,
      }),
    });
    const { resolveAuthoritativeC01ReplaySource } =
      await import("@/lib/chaos/replay-repository");
    const result = await resolveAuthoritativeC01ReplaySource({
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
      paymentAttemptId: ORDER_ATTEMPT_ID,
      paymentId: PAYMENT_ID,
    });
    expect(result).not.toBeNull();
    expect(result?.normalizedEvent).toEqual({
      sourceKind: "REAL_RAZORPAY_WEBHOOK",
      eventType: "payment.captured",
      kind: "payment.captured",
    });
  });

  it("returns null when the resolved attempt's normalized_event.eventType is unsupported", async () => {
    mockFromByTable({
      webhook_events: makeQueryBuilder({
        data: fakeWebhookEventRow(),
        error: null,
      }),
      event_processing_attempts: makeQueryBuilder({
        data: [
          fakeOriginalAttemptRow({
            normalized_event: { eventType: "payment.failed" },
          }),
        ],
        error: null,
      }),
    });
    const { resolveAuthoritativeC01ReplaySource } =
      await import("@/lib/chaos/replay-repository");
    const result = await resolveAuthoritativeC01ReplaySource({
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
      paymentAttemptId: ORDER_ATTEMPT_ID,
      paymentId: PAYMENT_ID,
    });
    expect(result).toBeNull();
  });

  it("throws ChaosReplayRepositoryError on a webhook_events lookup failure, never leaking the raw error", async () => {
    mockFromByTable({
      webhook_events: makeQueryBuilder({
        data: null,
        error: { message: "leaked-secret-detail" },
      }),
    });
    const { resolveAuthoritativeC01ReplaySource, ChaosReplayRepositoryError } =
      await import("@/lib/chaos/replay-repository");
    await expect(
      resolveAuthoritativeC01ReplaySource({
        sourceWebhookEventId: WEBHOOK_EVENT_ID,
        paymentAttemptId: ORDER_ATTEMPT_ID,
        paymentId: PAYMENT_ID,
      }),
    ).rejects.toBeInstanceOf(ChaosReplayRepositoryError);
  });

  it("throws ChaosReplayRepositoryError on a candidate-lookup failure, never leaking the raw error", async () => {
    mockFromByTable({
      webhook_events: makeQueryBuilder({
        data: fakeWebhookEventRow(),
        error: null,
      }),
      event_processing_attempts: makeQueryBuilder({
        data: null,
        error: { message: "leaked-secret-detail" },
      }),
    });
    const { resolveAuthoritativeC01ReplaySource, ChaosReplayRepositoryError } =
      await import("@/lib/chaos/replay-repository");
    await expect(
      resolveAuthoritativeC01ReplaySource({
        sourceWebhookEventId: WEBHOOK_EVENT_ID,
        paymentAttemptId: ORDER_ATTEMPT_ID,
        paymentId: PAYMENT_ID,
      }),
    ).rejects.toBeInstanceOf(ChaosReplayRepositoryError);
  });
});

describe("insertReplayProcessingAttempt", () => {
  function fakeInsertedRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "66666666-6666-6666-6666-666666666666",
      webhook_event_id: WEBHOOK_EVENT_ID,
      payment_attempt_id: ORDER_ATTEMPT_ID,
      payment_id: PAYMENT_ID,
      chaos_run_id: RUN_ID,
      source_kind: "PAYCHAOS_REPLAY",
      is_duplicate_delivery: false,
      status: "PENDING",
      normalized_event: { eventType: "payment.captured" },
      error_code: null,
      error_message_redacted: null,
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: null,
      ...overrides,
    };
  }

  it("inserts source_kind=PAYCHAOS_REPLAY, is_duplicate_delivery=false, status=PENDING, chaos_run_id set, and copies normalized_event verbatim", async () => {
    const builder = makeQueryBuilder({ data: fakeInsertedRow(), error: null });
    fromMock.mockReturnValue(builder);
    const { insertReplayProcessingAttempt } =
      await import("@/lib/chaos/replay-repository");

    await insertReplayProcessingAttempt({
      chaosRunId: RUN_ID,
      webhookEventId: WEBHOOK_EVENT_ID,
      paymentAttemptId: ORDER_ATTEMPT_ID,
      paymentId: PAYMENT_ID,
      normalizedEvent: {
        eventType: "payment.captured",
        sourceKind: "REAL_RAZORPAY_WEBHOOK",
      },
    });

    expect(fromMock).toHaveBeenCalledWith("event_processing_attempts");
    expect(builder.insert).toHaveBeenCalledWith({
      webhook_event_id: WEBHOOK_EVENT_ID,
      payment_attempt_id: ORDER_ATTEMPT_ID,
      payment_id: PAYMENT_ID,
      chaos_run_id: RUN_ID,
      source_kind: "PAYCHAOS_REPLAY",
      is_duplicate_delivery: false,
      status: "PENDING",
      normalized_event: {
        eventType: "payment.captured",
        sourceKind: "REAL_RAZORPAY_WEBHOOK",
      },
      error_code: null,
      error_message_redacted: null,
    });
  });

  it("never rewrites normalized_event.sourceKind — the inserted payload is the exact object passed in", async () => {
    const builder = makeQueryBuilder({ data: fakeInsertedRow(), error: null });
    fromMock.mockReturnValue(builder);
    const { insertReplayProcessingAttempt } =
      await import("@/lib/chaos/replay-repository");
    const original = {
      eventType: "order.paid",
      sourceKind: "REAL_RAZORPAY_WEBHOOK",
    };

    await insertReplayProcessingAttempt({
      chaosRunId: RUN_ID,
      webhookEventId: WEBHOOK_EVENT_ID,
      paymentAttemptId: null,
      paymentId: null,
      normalizedEvent: original,
    });

    const insertedPayload = builder.insert.mock.calls[0]?.[0] as {
      normalized_event: Record<string, unknown>;
    };
    expect(insertedPayload.normalized_event).toBe(original);
    expect(insertedPayload.normalized_event.sourceKind).toBe(
      "REAL_RAZORPAY_WEBHOOK",
    );
  });

  it("returns the persisted row", async () => {
    const row = fakeInsertedRow();
    fromMock.mockReturnValue(makeQueryBuilder({ data: row, error: null }));
    const { insertReplayProcessingAttempt } =
      await import("@/lib/chaos/replay-repository");
    const result = await insertReplayProcessingAttempt({
      chaosRunId: RUN_ID,
      webhookEventId: WEBHOOK_EVENT_ID,
      paymentAttemptId: ORDER_ATTEMPT_ID,
      paymentId: PAYMENT_ID,
      normalizedEvent: { eventType: "payment.captured" },
    });
    expect(result).toEqual(row);
  });

  it("throws ChaosReplayRepositoryError on a Supabase error, never leaking the raw error", async () => {
    fromMock.mockReturnValue(
      makeQueryBuilder({
        data: null,
        error: { message: "leaked-secret-detail" },
      }),
    );
    const { insertReplayProcessingAttempt, ChaosReplayRepositoryError } =
      await import("@/lib/chaos/replay-repository");
    await expect(
      insertReplayProcessingAttempt({
        chaosRunId: RUN_ID,
        webhookEventId: WEBHOOK_EVENT_ID,
        paymentAttemptId: ORDER_ATTEMPT_ID,
        paymentId: PAYMENT_ID,
        normalizedEvent: { eventType: "payment.captured" },
      }),
    ).rejects.toBeInstanceOf(ChaosReplayRepositoryError);
  });
});

describe("lib/chaos/replay-repository.ts — module surface", () => {
  it("imports the server-only marker package", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../lib/chaos/replay-repository.ts",
      ),
      "utf-8",
    );
    expect(source).toMatch(/import\s+["']server-only["']/);
  });

  it("never inserts/updates webhook_events or calls record_webhook_duplicate_delivery in the FUNCTIONAL code (the module doc comment legitimately names the RPC to document that this repository never calls it, so only non-comment lines are checked here)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../lib/chaos/replay-repository.ts",
      ),
      "utf-8",
    );
    const functionalSource = source
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith("*") && !trimmed.startsWith("//");
      })
      .join("\n");
    expect(functionalSource).not.toMatch(
      /from\(["']webhook_events["']\)\s*\n?\s*\.(insert|update)/,
    );
    expect(functionalSource).not.toMatch(/record_webhook_duplicate_delivery/);
  });
});
