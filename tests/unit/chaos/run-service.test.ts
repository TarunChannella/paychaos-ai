import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 3B: `lib/chaos/run-service.ts` orchestration behavior, against a
// MOCKED frozen `runChaosPrecheck`, MOCKED registry/repository reads, and
// MOCKED persistence (no network, no real Supabase, no frozen-file
// modification). This proves the ORCHESTRATION contract only — Phase 3A's
// own precheck ordering/logic remains proven exclusively by
// tests/unit/chaos/safety-gate.test.ts.
vi.mock("server-only", () => ({}));

const runChaosPrecheckMock = vi.fn();
vi.mock("@/lib/chaos/safety-gate", () => ({
  runChaosPrecheck: runChaosPrecheckMock,
}));

const isRegisteredScenarioIdMock = vi.fn();
vi.mock("@/lib/chaos/registry", () => ({
  isRegisteredScenarioId: isRegisteredScenarioIdMock,
}));

const getWebhookEventByIdMock = vi.fn();
const loadC01SourceEvidenceMock = vi.fn();
const loadC11RealWebhookFailureEvidenceMock = vi.fn();
const getOrderBaselineMock = vi.fn();
vi.mock("@/lib/chaos/repository", () => ({
  getWebhookEventById: getWebhookEventByIdMock,
  loadC01SourceEvidence: loadC01SourceEvidenceMock,
  loadC11RealWebhookFailureEvidence: loadC11RealWebhookFailureEvidenceMock,
  getOrderBaseline: getOrderBaselineMock,
}));

const createPendingChaosRunMock = vi.fn();
const createBlockedChaosRunMock = vi.fn();
vi.mock("@/lib/chaos/run-repository", () => ({
  createPendingChaosRun: createPendingChaosRunMock,
  createBlockedChaosRun: createBlockedChaosRunMock,
}));

const logEventMock = vi.fn();
vi.mock("@/lib/security/logger", () => ({
  logEvent: logEventMock,
}));

const REGISTERED_SCENARIO_IDS = ["C01", "C03", "C07", "C11"];

beforeEach(() => {
  runChaosPrecheckMock.mockReset();
  isRegisteredScenarioIdMock.mockReset();
  isRegisteredScenarioIdMock.mockImplementation(
    (value: unknown) =>
      typeof value === "string" && REGISTERED_SCENARIO_IDS.includes(value),
  );
  getWebhookEventByIdMock.mockReset();
  loadC01SourceEvidenceMock.mockReset();
  loadC11RealWebhookFailureEvidenceMock.mockReset();
  getOrderBaselineMock.mockReset();
  createPendingChaosRunMock.mockReset();
  createBlockedChaosRunMock.mockReset();
  logEventMock.mockReset();
});

const ORDER_ID = "22222222-2222-2222-2222-222222222222";
const ATTEMPT_ID = "33333333-3333-3333-3333-333333333333";
const PAYMENT_ID = "44444444-4444-4444-4444-444444444444";
const WEBHOOK_EVENT_ID = "11111111-1111-1111-1111-111111111111";
const RUN_ID = "55555555-5555-5555-5555-555555555555";

function fakeWebhookEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: WEBHOOK_EVENT_ID,
    payment_attempt_id: ATTEMPT_ID,
    payment_id: PAYMENT_ID,
    ...overrides,
  };
}

function fakeRunRow(overrides: Record<string, unknown> = {}) {
  return { id: RUN_ID, ...overrides };
}

describe("createChaosRun — PRECHECK_PASSED persists PENDING", () => {
  it("C01: resolves genuine links via the frozen read-only helpers and persists PENDING with REPLAY_EVENT / RECORDED_TEST_EVIDENCE", async () => {
    runChaosPrecheckMock.mockResolvedValue({
      status: "PRECHECK_PASSED",
      scenarioId: "C01",
      mechanism: "B",
    });
    getWebhookEventByIdMock.mockResolvedValue(fakeWebhookEvent());
    loadC01SourceEvidenceMock.mockResolvedValue({
      webhookEventId: WEBHOOK_EVENT_ID,
      orderId: ORDER_ID,
      baseline: {
        orderId: ORDER_ID,
        paymentStatus: "PAID",
        businessStatus: "FULFILLED",
        fulfilmentCount: 1,
      },
    });
    createPendingChaosRunMock.mockResolvedValue(fakeRunRow());

    const { createChaosRun } = await import("@/lib/chaos/run-service");
    const result = await createChaosRun({
      scenarioId: "C01",
      mechanism: "B",
      faultType: "REPLAY_EVENT",
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
    });

    expect(result).toEqual({
      kind: "PERSISTED_PENDING",
      chaosRunId: RUN_ID,
      scenarioId: "C01",
    });
    expect(createPendingChaosRunMock).toHaveBeenCalledWith({
      scenarioId: "C01",
      faultType: "REPLAY_EVENT",
      dataClassification: "RECORDED_TEST_EVIDENCE",
      orderId: ORDER_ID,
      paymentAttemptId: ATTEMPT_ID,
      paymentId: PAYMENT_ID,
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
    });
    expect(createBlockedChaosRunMock).not.toHaveBeenCalled();
  });

  it("C03: persists PENDING with all entity FKs NULL and SYNTHETIC_DEMO — never fabricates a merchant order link", async () => {
    runChaosPrecheckMock.mockResolvedValue({
      status: "PRECHECK_PASSED",
      scenarioId: "C03",
      mechanism: "C",
    });
    createPendingChaosRunMock.mockResolvedValue(fakeRunRow());

    const { createChaosRun } = await import("@/lib/chaos/run-service");
    const result = await createChaosRun({
      scenarioId: "C03",
      mechanism: "C",
      faultType: "INVALID_SIGNATURE_TEST",
    });

    expect(result.kind).toBe("PERSISTED_PENDING");
    expect(createPendingChaosRunMock).toHaveBeenCalledWith({
      scenarioId: "C03",
      faultType: "INVALID_SIGNATURE_TEST",
      dataClassification: "SYNTHETIC_DEMO",
      orderId: undefined,
      paymentAttemptId: undefined,
      paymentId: undefined,
      sourceWebhookEventId: undefined,
    });
    expect(getWebhookEventByIdMock).not.toHaveBeenCalled();
  });

  it("C07: persists PENDING with the validated freshOrderId; payment_attempt_id/payment_id/source_webhook_event_id remain NULL (never fabricated)", async () => {
    runChaosPrecheckMock.mockResolvedValue({
      status: "PRECHECK_PASSED",
      scenarioId: "C07",
      mechanism: ["A", "C"],
    });
    createPendingChaosRunMock.mockResolvedValue(fakeRunRow());

    const { createChaosRun } = await import("@/lib/chaos/run-service");
    const result = await createChaosRun({
      scenarioId: "C07",
      mechanism: ["A", "C"],
      faultType: "DROP_CLIENT_CONFIRMATION",
      freshOrderId: ORDER_ID,
    });

    expect(result.kind).toBe("PERSISTED_PENDING");
    expect(createPendingChaosRunMock).toHaveBeenCalledWith({
      scenarioId: "C07",
      faultType: "DROP_CLIENT_CONFIRMATION",
      dataClassification: "RECORDED_TEST_EVIDENCE",
      orderId: ORDER_ID,
      paymentAttemptId: undefined,
      paymentId: undefined,
      sourceWebhookEventId: undefined,
    });
  });

  it("C11 Mechanism A: persists PENDING with the validated freshOrderId and fault_type NULL", async () => {
    runChaosPrecheckMock.mockResolvedValue({
      status: "PRECHECK_PASSED",
      scenarioId: "C11",
      mechanism: "A",
    });
    createPendingChaosRunMock.mockResolvedValue(fakeRunRow());

    const { createChaosRun } = await import("@/lib/chaos/run-service");
    const result = await createChaosRun({
      scenarioId: "C11",
      mechanism: "A",
      freshOrderId: ORDER_ID,
    });

    expect(result.kind).toBe("PERSISTED_PENDING");
    expect(createPendingChaosRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioId: "C11",
        faultType: null,
        orderId: ORDER_ID,
      }),
    );
  });

  it("C11 Mechanism B REAL_WEBHOOK_EVENT: resolves authentic evidence links and persists PENDING", async () => {
    runChaosPrecheckMock.mockResolvedValue({
      status: "PRECHECK_PASSED",
      scenarioId: "C11",
      mechanism: "B",
    });
    getWebhookEventByIdMock.mockResolvedValue(fakeWebhookEvent());
    loadC11RealWebhookFailureEvidenceMock.mockResolvedValue({
      webhookEventId: WEBHOOK_EVENT_ID,
      orderId: ORDER_ID,
      baseline: {
        orderId: ORDER_ID,
        paymentStatus: "FAILED_OBSERVED",
        businessStatus: "OPEN",
        fulfilmentCount: 0,
      },
    });
    createPendingChaosRunMock.mockResolvedValue(fakeRunRow());

    const { createChaosRun } = await import("@/lib/chaos/run-service");
    const result = await createChaosRun({
      scenarioId: "C11",
      mechanism: "B",
      failureEvidence: {
        kind: "REAL_WEBHOOK_EVENT",
        webhookEventId: WEBHOOK_EVENT_ID,
      },
    });

    expect(result.kind).toBe("PERSISTED_PENDING");
    expect(createPendingChaosRunMock).toHaveBeenCalledWith({
      scenarioId: "C11",
      faultType: null,
      dataClassification: "RECORDED_TEST_EVIDENCE",
      orderId: ORDER_ID,
      paymentAttemptId: ATTEMPT_ID,
      paymentId: PAYMENT_ID,
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
    });
  });

  it("C11 Mechanism B TEST_FIXTURE can never produce a PENDING row, even defensively if PRECHECK_PASSED were ever (incorrectly) returned for it", async () => {
    runChaosPrecheckMock.mockResolvedValue({
      status: "PRECHECK_PASSED",
      scenarioId: "C11",
      mechanism: "B",
    });

    const { createChaosRun } = await import("@/lib/chaos/run-service");
    const result = await createChaosRun({
      scenarioId: "C11",
      mechanism: "B",
      failureEvidence: { kind: "TEST_FIXTURE", fixtureId: "fixture-1" },
    });

    expect(result.kind).toBe("NOT_PERSISTED_BLOCKED");
    expect(createPendingChaosRunMock).not.toHaveBeenCalled();
    expect(createBlockedChaosRunMock).not.toHaveBeenCalled();
    expect(loadC11RealWebhookFailureEvidenceMock).not.toHaveBeenCalled();
  });

  it("fails closed (NOT_PERSISTED_BLOCKED) rather than fabricating a PENDING row when evidence cannot be independently re-resolved after precheck success", async () => {
    runChaosPrecheckMock.mockResolvedValue({
      status: "PRECHECK_PASSED",
      scenarioId: "C01",
      mechanism: "B",
    });
    getWebhookEventByIdMock.mockResolvedValue(null);
    loadC01SourceEvidenceMock.mockResolvedValue(null);

    const { createChaosRun } = await import("@/lib/chaos/run-service");
    const result = await createChaosRun({
      scenarioId: "C01",
      mechanism: "B",
      faultType: "REPLAY_EVENT",
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
    });

    expect(result).toMatchObject({ kind: "NOT_PERSISTED_BLOCKED" });
    expect(createPendingChaosRunMock).not.toHaveBeenCalled();
  });
});

describe("createChaosRun — BLOCKED precheck IDs that are never persisted", () => {
  it.each([
    "PRECHECK-01",
    "PRECHECK-02",
    "PRECHECK-03",
    "PRECHECK-05",
    "PRECHECK-06",
  ] as const)("%s never creates a chaos_runs row", async (failedPrecheckId) => {
    runChaosPrecheckMock.mockResolvedValue({
      status: "BLOCKED",
      failedPrecheckId,
      reasonCode: "SOME_CODE",
      reason: "Safe reason text.",
    });

    const { createChaosRun } = await import("@/lib/chaos/run-service");
    const result = await createChaosRun({ scenarioId: "C01", mechanism: "B" });

    expect(result).toMatchObject({ kind: "NOT_PERSISTED_BLOCKED" });
    expect(createPendingChaosRunMock).not.toHaveBeenCalled();
    expect(createBlockedChaosRunMock).not.toHaveBeenCalled();
  });
});

describe("createChaosRun — persistable BLOCKED precheck IDs", () => {
  it("PRECHECK-07 (C01, no evidence resolved): persists BLOCKED with all entity links NULL", async () => {
    runChaosPrecheckMock.mockResolvedValue({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-07",
      reasonCode: "C01_SOURCE_EVIDENCE_UNAVAILABLE",
      reason:
        "No suitable verified payment.captured/order.paid webhook evidence was found for replay.",
    });
    createBlockedChaosRunMock.mockResolvedValue(fakeRunRow());

    const { createChaosRun } = await import("@/lib/chaos/run-service");
    const result = await createChaosRun({
      scenarioId: "C01",
      mechanism: "B",
      faultType: "REPLAY_EVENT",
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
    });

    expect(result).toEqual({
      kind: "PERSISTED_BLOCKED",
      chaosRunId: RUN_ID,
      scenarioId: "C01",
      failedPrecheckId: "PRECHECK-07",
      reason:
        "No suitable verified payment.captured/order.paid webhook evidence was found for replay.",
    });
    expect(createBlockedChaosRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioId: "C01",
        failedPrecheckId: "PRECHECK-07",
        orderId: undefined,
        paymentAttemptId: undefined,
        paymentId: undefined,
        sourceWebhookEventId: undefined,
      }),
    );
  });

  it("PRECHECK-08 (C01, baseline not eligible): persists BLOCKED WITH the genuinely re-resolved entity links — real evidence, not false absence", async () => {
    runChaosPrecheckMock.mockResolvedValue({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-08",
      reasonCode: "C01_BASELINE_NOT_PAID_ONE_FULFILMENT",
      reason:
        "The correlated order is not in the required PAID-with-exactly-one-fulfilment baseline.",
    });
    getWebhookEventByIdMock.mockResolvedValue(fakeWebhookEvent());
    loadC01SourceEvidenceMock.mockResolvedValue({
      webhookEventId: WEBHOOK_EVENT_ID,
      orderId: ORDER_ID,
      baseline: {
        orderId: ORDER_ID,
        paymentStatus: "PAID",
        businessStatus: "FULFILLED",
        fulfilmentCount: 2,
      },
    });
    createBlockedChaosRunMock.mockResolvedValue(fakeRunRow());

    const { createChaosRun } = await import("@/lib/chaos/run-service");
    await createChaosRun({
      scenarioId: "C01",
      mechanism: "B",
      faultType: "REPLAY_EVENT",
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
    });

    expect(createBlockedChaosRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ORDER_ID,
        paymentAttemptId: ATTEMPT_ID,
        paymentId: PAYMENT_ID,
        sourceWebhookEventId: WEBHOOK_EVENT_ID,
      }),
    );
  });

  describe("PRECHECK-08 (C07): freshOrderId presence never proves the order genuinely exists (architect correction, Finding 1)", () => {
    it("no freshOrderId supplied -> BLOCKED row persists with orderId undefined, getOrderBaseline never called", async () => {
      runChaosPrecheckMock.mockResolvedValue({
        status: "BLOCKED",
        failedPrecheckId: "PRECHECK-08",
        reasonCode: "C07_NO_ORDER_SELECTED",
        reason:
          "No candidate order was supplied — a known fresh UNPAID/OPEN/zero-fulfilment baseline cannot be confirmed.",
      });
      createBlockedChaosRunMock.mockResolvedValue(fakeRunRow());

      const { createChaosRun } = await import("@/lib/chaos/run-service");
      const result = await createChaosRun({
        scenarioId: "C07",
        mechanism: ["A", "C"],
        faultType: "DROP_CLIENT_CONFIRMATION",
      });

      expect(result.kind).toBe("PERSISTED_BLOCKED");
      expect(getOrderBaselineMock).not.toHaveBeenCalled();
      expect(createBlockedChaosRunMock).toHaveBeenCalledTimes(1);
      expect(createBlockedChaosRunMock).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: undefined }),
      );
    });

    it("nonexistent freshOrderId -> getOrderBaseline returns null -> BLOCKED row still persists with orderId omitted (never a raw UUID that would violate the FK), createBlockedChaosRun called exactly once — never becomes an audit-write failure", async () => {
      runChaosPrecheckMock.mockResolvedValue({
        status: "BLOCKED",
        failedPrecheckId: "PRECHECK-08",
        reasonCode: "C07_ORDER_NOT_FOUND",
        reason: "The supplied order does not exist.",
      });
      getOrderBaselineMock.mockResolvedValue(null);
      createBlockedChaosRunMock.mockResolvedValue(fakeRunRow());

      const { createChaosRun } = await import("@/lib/chaos/run-service");
      const result = await createChaosRun({
        scenarioId: "C07",
        mechanism: ["A", "C"],
        faultType: "DROP_CLIENT_CONFIRMATION",
        freshOrderId: ORDER_ID,
      });

      expect(getOrderBaselineMock).toHaveBeenCalledWith(ORDER_ID);
      expect(result).toEqual({
        kind: "PERSISTED_BLOCKED",
        chaosRunId: RUN_ID,
        scenarioId: "C07",
        failedPrecheckId: "PRECHECK-08",
        reason: "The supplied order does not exist.",
      });
      expect(createBlockedChaosRunMock).toHaveBeenCalledTimes(1);
      expect(createBlockedChaosRunMock).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: undefined }),
      );
    });

    it("existing but non-fresh order -> orderId is persisted (the FK target genuinely exists; freshness is not required for this audit link)", async () => {
      runChaosPrecheckMock.mockResolvedValue({
        status: "BLOCKED",
        failedPrecheckId: "PRECHECK-08",
        reasonCode: "C07_BASELINE_NOT_FRESH",
        reason:
          "The supplied order is not in the required fresh UNPAID/OPEN/zero-fulfilment baseline.",
      });
      getOrderBaselineMock.mockResolvedValue({
        orderId: ORDER_ID,
        paymentStatus: "PAID",
        businessStatus: "FULFILLED",
        fulfilmentCount: 1,
      });
      createBlockedChaosRunMock.mockResolvedValue(fakeRunRow());

      const { createChaosRun } = await import("@/lib/chaos/run-service");
      await createChaosRun({
        scenarioId: "C07",
        mechanism: ["A", "C"],
        faultType: "DROP_CLIENT_CONFIRMATION",
        freshOrderId: ORDER_ID,
      });

      expect(createBlockedChaosRunMock).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: ORDER_ID }),
      );
    });
  });

  describe("PRECHECK-08 (C11 Mechanism A): freshOrderId presence never proves the order genuinely exists (architect correction, Finding 1)", () => {
    it("no freshOrderId supplied -> BLOCKED row persists with orderId undefined, getOrderBaseline never called", async () => {
      runChaosPrecheckMock.mockResolvedValue({
        status: "BLOCKED",
        failedPrecheckId: "PRECHECK-08",
        reasonCode: "C11_NO_ORDER_SELECTED",
        reason:
          "No candidate order was supplied — a known fresh UNPAID/OPEN/zero-fulfilment baseline cannot be confirmed.",
      });
      createBlockedChaosRunMock.mockResolvedValue(fakeRunRow());

      const { createChaosRun } = await import("@/lib/chaos/run-service");
      const result = await createChaosRun({
        scenarioId: "C11",
        mechanism: "A",
      });

      expect(result.kind).toBe("PERSISTED_BLOCKED");
      expect(getOrderBaselineMock).not.toHaveBeenCalled();
      expect(createBlockedChaosRunMock).toHaveBeenCalledTimes(1);
      expect(createBlockedChaosRunMock).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: undefined, faultType: null }),
      );
    });

    it("nonexistent freshOrderId -> getOrderBaseline returns null -> BLOCKED row still persists with orderId omitted, createBlockedChaosRun called exactly once — never becomes an audit-write failure", async () => {
      runChaosPrecheckMock.mockResolvedValue({
        status: "BLOCKED",
        failedPrecheckId: "PRECHECK-08",
        reasonCode: "C11_ORDER_NOT_FOUND",
        reason: "The supplied order does not exist.",
      });
      getOrderBaselineMock.mockResolvedValue(null);
      createBlockedChaosRunMock.mockResolvedValue(fakeRunRow());

      const { createChaosRun } = await import("@/lib/chaos/run-service");
      const result = await createChaosRun({
        scenarioId: "C11",
        mechanism: "A",
        freshOrderId: ORDER_ID,
      });

      expect(getOrderBaselineMock).toHaveBeenCalledWith(ORDER_ID);
      expect(result).toEqual({
        kind: "PERSISTED_BLOCKED",
        chaosRunId: RUN_ID,
        scenarioId: "C11",
        failedPrecheckId: "PRECHECK-08",
        reason: "The supplied order does not exist.",
      });
      expect(createBlockedChaosRunMock).toHaveBeenCalledTimes(1);
      expect(createBlockedChaosRunMock).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: undefined }),
      );
    });

    it("existing but non-fresh order -> orderId is persisted (the FK target genuinely exists; freshness is not required for this audit link)", async () => {
      runChaosPrecheckMock.mockResolvedValue({
        status: "BLOCKED",
        failedPrecheckId: "PRECHECK-08",
        reasonCode: "C11_BASELINE_NOT_FRESH",
        reason:
          "The supplied order is not in the required fresh UNPAID/OPEN/zero-fulfilment baseline.",
      });
      getOrderBaselineMock.mockResolvedValue({
        orderId: ORDER_ID,
        paymentStatus: "PAID",
        businessStatus: "FULFILLED",
        fulfilmentCount: 1,
      });
      createBlockedChaosRunMock.mockResolvedValue(fakeRunRow());

      const { createChaosRun } = await import("@/lib/chaos/run-service");
      await createChaosRun({
        scenarioId: "C11",
        mechanism: "A",
        freshOrderId: ORDER_ID,
      });

      expect(createBlockedChaosRunMock).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: ORDER_ID }),
      );
    });
  });

  it("PRECHECK-09 (C01): sanitized BLOCKED persistence — no raw fault_type/entity field from rawInput is trusted or copied, and dataClassification is always SYNTHETIC_DEMO regardless of scenarioId (architect correction, Finding 3 — the row is an audit of a rejected mechanism, never evidence-backed)", async () => {
    runChaosPrecheckMock.mockResolvedValue({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-09",
      reasonCode: "MECHANISM_NOT_ALLOWED",
      reason: "Requested mechanism is not allowed for this scenario.",
    });
    createBlockedChaosRunMock.mockResolvedValue(fakeRunRow());

    const { createChaosRun } = await import("@/lib/chaos/run-service");
    const result = await createChaosRun({
      scenarioId: "C01",
      mechanism: "C",
      faultType: "FAIL_DATABASE_TRANSACTION",
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
    });

    expect(result.kind).toBe("PERSISTED_BLOCKED");
    expect(createBlockedChaosRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioId: "C01",
        faultType: null,
        dataClassification: "SYNTHETIC_DEMO",
        orderId: undefined,
        paymentAttemptId: undefined,
        paymentId: undefined,
        sourceWebhookEventId: undefined,
      }),
    );
    expect(getWebhookEventByIdMock).not.toHaveBeenCalled();
    expect(loadC01SourceEvidenceMock).not.toHaveBeenCalled();
  });

  it("PRECHECK-09 (C07): dataClassification is SYNTHETIC_DEMO even though C07's own PENDING/PRECHECK-08 classification is RECORDED_TEST_EVIDENCE — mechanism/evidence lineage cannot be trusted this early", async () => {
    runChaosPrecheckMock.mockResolvedValue({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-09",
      reasonCode: "MECHANISM_NOT_ALLOWED",
      reason: "Requested mechanism is not allowed for this scenario.",
    });
    createBlockedChaosRunMock.mockResolvedValue(fakeRunRow());

    const { createChaosRun } = await import("@/lib/chaos/run-service");
    const result = await createChaosRun({
      scenarioId: "C07",
      mechanism: "B",
      faultType: "DROP_CLIENT_CONFIRMATION",
    });

    expect(result.kind).toBe("PERSISTED_BLOCKED");
    expect(createBlockedChaosRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioId: "C07",
        faultType: null,
        dataClassification: "SYNTHETIC_DEMO",
        orderId: undefined,
        paymentAttemptId: undefined,
        paymentId: undefined,
        sourceWebhookEventId: undefined,
      }),
    );
  });

  it.each(["C01", "C03", "C07", "C11"] as const)(
    "PRECHECK-10 (%s): sanitized BLOCKED persistence — an arbitrary rejected field (e.g. url) is never read or persisted, and dataClassification is always SYNTHETIC_DEMO regardless of scenarioId",
    async (scenarioId) => {
      runChaosPrecheckMock.mockResolvedValue({
        status: "BLOCKED",
        failedPrecheckId: "PRECHECK-10",
        reasonCode: "INPUT_SHAPE_REJECTED",
        reason:
          "Chaos request input contains unsupported, missing, or extra fields.",
      });
      createBlockedChaosRunMock.mockResolvedValue(fakeRunRow());

      const { createChaosRun } = await import("@/lib/chaos/run-service");
      const result = await createChaosRun({
        scenarioId,
        mechanism: "C",
        faultType: "INVALID_SIGNATURE_TEST",
        url: "http://evil.example.com",
      });

      expect(result.kind).toBe("PERSISTED_BLOCKED");
      expect(createBlockedChaosRunMock).toHaveBeenCalledWith(
        expect.objectContaining({
          scenarioId,
          faultType: null,
          dataClassification: "SYNTHETIC_DEMO",
          orderId: undefined,
          paymentAttemptId: undefined,
          paymentId: undefined,
          sourceWebhookEventId: undefined,
        }),
      );
      expect(getWebhookEventByIdMock).not.toHaveBeenCalled();
      expect(loadC01SourceEvidenceMock).not.toHaveBeenCalled();
      expect(loadC11RealWebhookFailureEvidenceMock).not.toHaveBeenCalled();
    },
  );

  it("C11 TEST_FIXTURE BLOCKED model: PRECHECK-07, exactly one createBlockedChaosRun call, SYNTHETIC_DEMO, fault_type NULL, every entity FK NULL, no fabricated evidence", async () => {
    runChaosPrecheckMock.mockResolvedValue({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-07",
      reasonCode: "C11_FAILURE_EVIDENCE_UNAVAILABLE",
      reason: "No suitable authentic payment.failed evidence is available.",
    });
    createBlockedChaosRunMock.mockResolvedValue(fakeRunRow());

    const { createChaosRun } = await import("@/lib/chaos/run-service");
    const result = await createChaosRun({
      scenarioId: "C11",
      mechanism: "B",
      failureEvidence: { kind: "TEST_FIXTURE", fixtureId: "fixture-1" },
    });

    expect(result).toEqual({
      kind: "PERSISTED_BLOCKED",
      chaosRunId: RUN_ID,
      scenarioId: "C11",
      failedPrecheckId: "PRECHECK-07",
      reason: "No suitable authentic payment.failed evidence is available.",
    });
    expect(createBlockedChaosRunMock).toHaveBeenCalledTimes(1);
    expect(createBlockedChaosRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioId: "C11",
        failedPrecheckId: "PRECHECK-07",
        dataClassification: "SYNTHETIC_DEMO",
        faultType: null,
        orderId: undefined,
        paymentAttemptId: undefined,
        paymentId: undefined,
        sourceWebhookEventId: undefined,
      }),
    );
    expect(loadC11RealWebhookFailureEvidenceMock).not.toHaveBeenCalled();
    expect(getWebhookEventByIdMock).not.toHaveBeenCalled();
  });
});

describe("createChaosRun — audit write failure fails closed", () => {
  it("PENDING insert failure: NOT_PERSISTED_BLOCKED, no fake run id, safe logging only", async () => {
    runChaosPrecheckMock.mockResolvedValue({
      status: "PRECHECK_PASSED",
      scenarioId: "C03",
      mechanism: "C",
    });
    const dbError = new Error("connection reset by peer at 10.0.0.5:5432");
    dbError.name = "ChaosRunRepositoryError";
    createPendingChaosRunMock.mockRejectedValue(dbError);

    const { createChaosRun } = await import("@/lib/chaos/run-service");
    const result = await createChaosRun({
      scenarioId: "C03",
      mechanism: "C",
      faultType: "INVALID_SIGNATURE_TEST",
    });

    expect(result).toEqual({
      kind: "NOT_PERSISTED_BLOCKED",
      reasonCategory: "AUDIT_PERSISTENCE_FAILED",
      reason: "The chaos run could not be durably recorded.",
    });
    expect("chaosRunId" in result).toBe(false);
    expect(logEventMock).toHaveBeenCalledWith(
      "chaos_run_audit_persistence_failed",
      expect.objectContaining({ stage: "pending", scenario_id: "C03" }),
    );
    const loggedFields = logEventMock.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(loggedFields)).not.toContain("10.0.0.5");
  });

  it("BLOCKED insert failure: NOT_PERSISTED_BLOCKED, no fake run id, no execution, safe logging only", async () => {
    runChaosPrecheckMock.mockResolvedValue({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-06",
      reasonCode: "DATABASE_UNREACHABLE",
      reason: "The database is not reachable.",
    });
    // PRECHECK-06 is itself not persistable — use PRECHECK-09 instead to
    // exercise the actual insert-failure path.
    runChaosPrecheckMock.mockResolvedValue({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-09",
      reasonCode: "FAULT_NOT_ALLOWED",
      reason: "Requested fault primitive is not allowed for this scenario.",
    });
    const dbError = new Error("secret-shaped-internal-detail");
    createBlockedChaosRunMock.mockRejectedValue(dbError);

    const { createChaosRun } = await import("@/lib/chaos/run-service");
    const result = await createChaosRun({ scenarioId: "C11", mechanism: "A" });

    expect(result).toEqual({
      kind: "NOT_PERSISTED_BLOCKED",
      reasonCategory: "AUDIT_PERSISTENCE_FAILED",
      reason: "The blocked chaos run could not be durably recorded.",
    });
    const loggedFields = logEventMock.mock.calls.find(
      (call) => call[0] === "chaos_run_audit_persistence_failed",
    )?.[1] as Record<string, unknown>;
    expect(JSON.stringify(loggedFields)).not.toContain(
      "secret-shaped-internal-detail",
    );
  });
});

describe("createChaosRun — security and safety guarantees", () => {
  it("runChaosPrecheck is always called before any persistence function", async () => {
    const callOrder: string[] = [];
    runChaosPrecheckMock.mockImplementation(async () => {
      callOrder.push("runChaosPrecheck");
      return { status: "PRECHECK_PASSED", scenarioId: "C03", mechanism: "C" };
    });
    createPendingChaosRunMock.mockImplementation(async () => {
      callOrder.push("createPendingChaosRun");
      return fakeRunRow();
    });

    const { createChaosRun } = await import("@/lib/chaos/run-service");
    await createChaosRun({
      scenarioId: "C03",
      mechanism: "C",
      faultType: "INVALID_SIGNATURE_TEST",
    });

    expect(callOrder).toEqual(["runChaosPrecheck", "createPendingChaosRun"]);
  });

  it("a caller-embedded dataClassification/status/outcome field in rawInput is never trusted — the persisted value is always server-derived", async () => {
    runChaosPrecheckMock.mockResolvedValue({
      status: "PRECHECK_PASSED",
      scenarioId: "C03",
      mechanism: "C",
    });
    createPendingChaosRunMock.mockResolvedValue(fakeRunRow());

    const { createChaosRun } = await import("@/lib/chaos/run-service");
    await createChaosRun({
      scenarioId: "C03",
      mechanism: "C",
      faultType: "INVALID_SIGNATURE_TEST",
      // Not part of ChaosPrecheckInput's shape at all — even if present,
      // run-service must never read or forward it.
      dataClassification: "RECORDED_TEST_EVIDENCE",
      status: "COMPLETED",
      outcome: "PASS",
    });

    expect(createPendingChaosRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ dataClassification: "SYNTHETIC_DEMO" }),
    );
  });

  it("the module source contains no fetch/Razorpay-adapter call and no direct insert/update/delete on orders/payments/payment_attempts/fulfilments", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../lib/chaos/run-service.ts"),
      "utf-8",
    );
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/razorpay\/adapter/);
    expect(source).not.toMatch(
      /from\(["'`](orders|payments|payment_attempts|fulfilments)["'`]\)/,
    );
  });

  it("imports the server-only marker package", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../lib/chaos/run-service.ts"),
      "utf-8",
    );
    expect(source).toMatch(/import\s+["']server-only["']/);
  });
});
