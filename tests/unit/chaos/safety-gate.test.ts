import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 3A: `lib/chaos/safety-gate.ts` behavior against MOCKED
// `lib/config/razorpay-env.ts` and `lib/chaos/repository.ts` boundaries (no
// network, no real Supabase). Real-Supabase-backed precheck behavior is
// separately proven by
// tests/integration/supabase/051-chaos-safety-gate.integration.test.ts.
vi.mock("server-only", () => ({}));

const getRazorpayEnvMock = vi.fn();
vi.mock("@/lib/config/razorpay-env", () => ({
  getRazorpayEnv: getRazorpayEnvMock,
}));

const checkChaosDatabaseReachableMock = vi.fn();
const getOrderBaselineMock = vi.fn();
const loadC01SourceEvidenceMock = vi.fn();
const loadC11RealWebhookFailureEvidenceMock = vi.fn();
const loadC11TestFixtureFailureEvidenceMock = vi.fn();

vi.mock("@/lib/chaos/repository", () => ({
  checkChaosDatabaseReachable: checkChaosDatabaseReachableMock,
  getOrderBaseline: getOrderBaselineMock,
  // Real (pure) logic re-implemented here deliberately — this is the exact
  // production rule (docs/CHAOS_SCENARIOS.md Sections 19/23), not a stubbed
  // shortcut, so tests exercising freshness still mean something.
  isFreshBaseline: (baseline: {
    paymentStatus: string;
    businessStatus: string;
    fulfilmentCount: number;
  }) =>
    baseline.paymentStatus === "UNPAID" &&
    baseline.businessStatus === "OPEN" &&
    baseline.fulfilmentCount === 0,
  loadC01SourceEvidence: loadC01SourceEvidenceMock,
  loadC11RealWebhookFailureEvidence: loadC11RealWebhookFailureEvidenceMock,
  loadC11TestFixtureFailureEvidence: loadC11TestFixtureFailureEvidenceMock,
}));

import { EnvValidationError } from "@/lib/config/env-validation";

const VALID_RAZORPAY_ENV = {
  mode: "test" as const,
  keyId: "rzp_test_fake_key_id_not_real",
  keySecret: "fake-razorpay-key-secret-not-real",
};

const ORDER_ID = "22222222-2222-2222-2222-222222222222";
const WEBHOOK_EVENT_ID = "11111111-1111-1111-1111-111111111111";

function freshBaseline(orderId = ORDER_ID) {
  return {
    orderId,
    paymentStatus: "UNPAID",
    businessStatus: "OPEN",
    fulfilmentCount: 0,
  };
}

function paidOnceBaseline(orderId = ORDER_ID) {
  return {
    orderId,
    paymentStatus: "PAID",
    businessStatus: "FULFILLED",
    fulfilmentCount: 1,
  };
}

beforeEach(() => {
  getRazorpayEnvMock.mockReset();
  getRazorpayEnvMock.mockReturnValue(VALID_RAZORPAY_ENV);
  checkChaosDatabaseReachableMock.mockReset();
  checkChaosDatabaseReachableMock.mockResolvedValue(undefined);
  getOrderBaselineMock.mockReset();
  getOrderBaselineMock.mockResolvedValue(null);
  loadC01SourceEvidenceMock.mockReset();
  loadC01SourceEvidenceMock.mockResolvedValue(null);
  loadC11RealWebhookFailureEvidenceMock.mockReset();
  loadC11RealWebhookFailureEvidenceMock.mockResolvedValue(null);
  loadC11TestFixtureFailureEvidenceMock.mockReset();
  loadC11TestFixtureFailureEvidenceMock.mockResolvedValue(null);
});

describe("PRECHECK-01/02/03 — Razorpay Test Mode configuration", () => {
  it("a valid TEST config passes the static config checks (reaches later checks)", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C03",
      mechanism: "C",
      faultType: "INVALID_SIGNATURE_TEST",
    });
    // C03 needs nothing beyond config + DB reachability, so a valid config
    // reaches PRECHECK_PASSED directly — proving 01/02/03 did not block it.
    expect(result.status).toBe("PRECHECK_PASSED");
  });

  it("blocks with PRECHECK-01 when RAZORPAY_MODE is not test", async () => {
    getRazorpayEnvMock.mockImplementation(() => {
      throw new EnvValidationError("RAZORPAY_MODE", "must equal test");
    });
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C03",
      mechanism: "C",
      faultType: "INVALID_SIGNATURE_TEST",
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-01",
    });
  });

  it("blocks with PRECHECK-02 for a live-shaped Key ID", async () => {
    getRazorpayEnvMock.mockImplementation(() => {
      throw new EnvValidationError(
        "RAZORPAY_KEY_ID",
        "must start with rzp_test_",
      );
    });
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C03",
      mechanism: "C",
      faultType: "INVALID_SIGNATURE_TEST",
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-02",
    });
  });

  it("never includes the raw EnvValidationError message or a credential value in the BLOCKED reason", async () => {
    getRazorpayEnvMock.mockImplementation(() => {
      throw new EnvValidationError(
        "RAZORPAY_KEY_ID",
        "leaked-secret-should-never-appear",
      );
    });
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C03",
      mechanism: "C",
      faultType: "INVALID_SIGNATURE_TEST",
    });
    expect(JSON.stringify(result)).not.toContain(
      "leaked-secret-should-never-appear",
    );
  });

  it("config checks run before scenario/DB checks are even attempted", async () => {
    getRazorpayEnvMock.mockImplementation(() => {
      throw new EnvValidationError("RAZORPAY_MODE", "must equal test");
    });
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    await runChaosPrecheck({ scenarioId: "UNKNOWN_SCENARIO", mechanism: "X" });
    expect(checkChaosDatabaseReachableMock).not.toHaveBeenCalled();
  });
});

describe("PRECHECK-05 — Scenario Is Registered", () => {
  it("blocks an unknown scenario id", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C02",
      mechanism: "B",
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-05",
    });
  });

  it("blocks non-object input", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck("not-an-object");
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-05",
    });
  });

  it("blocks null input", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck(null);
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-05",
    });
  });
});

describe("PRECHECK-09 — Fault Is Allowed (mechanism + fault primitive)", () => {
  it("blocks a mechanism not allowed for the scenario", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C01",
      mechanism: "C", // C01 only allows B
      faultType: "REPLAY_EVENT",
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-09",
    });
  });

  it("blocks a fault primitive not allowed for the scenario", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C01",
      mechanism: "B",
      faultType: "INVALID_SIGNATURE_TEST", // not allowed for C01
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-09",
    });
  });

  it("blocks a fault primitive supplied for a scenario that accepts none (C11)", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C11",
      mechanism: "A",
      faultType: "REPLAY_EVENT",
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-09",
    });
  });

  it("a P1 fault primitive can never become 'allowed' through any P0 scenario", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C01",
      mechanism: "B",
      faultType: "FAIL_DATABASE_TRANSACTION",
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-09",
    });
  });
});

describe("PRECHECK-10 — No Arbitrary External Target (exact-key shape)", () => {
  const dangerousFieldCases: ReadonlyArray<Record<string, unknown>> = [
    { url: "http://evil.example.com" },
    { host: "evil.example.com" },
    { hostname: "evil.example.com" },
    { ip: "10.0.0.1" },
    { webhook_url: "http://evil.example.com/hook" },
    { callback_url: "http://evil.example.com/cb" },
    { target_endpoint: "http://evil.example.com/api" },
  ];

  it.each(dangerousFieldCases)(
    "rejects C03 input carrying an extra field %o",
    async (extra) => {
      const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
      const result = await runChaosPrecheck({
        scenarioId: "C03",
        mechanism: "C",
        faultType: "INVALID_SIGNATURE_TEST",
        ...extra,
      });
      expect(result).toMatchObject({
        status: "BLOCKED",
        failedPrecheckId: "PRECHECK-10",
      });
    },
  );

  it("rejects C01 input carrying an extra field even though the base fields are all valid", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C01",
      mechanism: "B",
      faultType: "REPLAY_EVENT",
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
      url: "http://evil.example.com",
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-10",
    });
  });

  it("rejects a nested arbitrary field inside C11 Mechanism B's failureEvidence", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C11",
      mechanism: "B",
      failureEvidence: {
        kind: "REAL_WEBHOOK_EVENT",
        webhookEventId: WEBHOOK_EVENT_ID,
        url: "http://evil.example.com",
      },
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-10",
    });
  });

  it("rejects an unsupported failureEvidence.kind for C11 Mechanism B", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C11",
      mechanism: "B",
      failureEvidence: {
        kind: "ARBITRARY_KIND",
        webhookEventId: WEBHOOK_EVENT_ID,
      },
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-10",
    });
  });

  it("rejects C01 input missing its required sourceWebhookEventId", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C01",
      mechanism: "B",
      faultType: "REPLAY_EVENT",
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-10",
    });
  });

  it("no code path ever calls the database-reachability check before PRECHECK-10 passes", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    await runChaosPrecheck({
      scenarioId: "C03",
      mechanism: "C",
      faultType: "INVALID_SIGNATURE_TEST",
      url: "http://evil.example.com",
    });
    expect(checkChaosDatabaseReachableMock).not.toHaveBeenCalled();
  });
});

describe("PRECHECK-06 — Database Reachable", () => {
  it("blocks with PRECHECK-06 before any evidence/state check runs", async () => {
    checkChaosDatabaseReachableMock.mockRejectedValue(new Error("db down"));
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C01",
      mechanism: "B",
      faultType: "REPLAY_EVENT",
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-06",
    });
    expect(loadC01SourceEvidenceMock).not.toHaveBeenCalled();
  });

  it("never surfaces as a fabricated PRECHECK-07 'evidence missing' when the DB is actually down", async () => {
    checkChaosDatabaseReachableMock.mockRejectedValue(new Error("db down"));
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C03",
      mechanism: "C",
      faultType: "INVALID_SIGNATURE_TEST",
    });
    expect(result).toMatchObject({ failedPrecheckId: "PRECHECK-06" });
  });
});

describe("C01 — evidence + baseline", () => {
  const validC01Input = {
    scenarioId: "C01" as const,
    mechanism: "B" as const,
    faultType: "REPLAY_EVENT" as const,
    sourceWebhookEventId: WEBHOOK_EVENT_ID,
  };

  it("blocks with PRECHECK-07 when no suitable source evidence exists", async () => {
    loadC01SourceEvidenceMock.mockResolvedValue(null);
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck(validC01Input);
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-07",
    });
  });

  it("reaches PRECHECK_PASSED with valid PAID+one-fulfilment evidence", async () => {
    loadC01SourceEvidenceMock.mockResolvedValue({
      webhookEventId: WEBHOOK_EVENT_ID,
      orderId: ORDER_ID,
      baseline: paidOnceBaseline(),
    });
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck(validC01Input);
    expect(result).toEqual({
      status: "PRECHECK_PASSED",
      scenarioId: "C01",
      mechanism: "B",
    });
  });

  it("blocks with PRECHECK-08 when the baseline is not PAID + exactly one fulfilment", async () => {
    loadC01SourceEvidenceMock.mockResolvedValue({
      webhookEventId: WEBHOOK_EVENT_ID,
      orderId: ORDER_ID,
      baseline: { ...paidOnceBaseline(), fulfilmentCount: 2 },
    });
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck(validC01Input);
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-08",
    });
  });
});

describe("C03 — does not require existing real webhook evidence", () => {
  it("reaches PRECHECK_PASSED without ever calling any evidence loader", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C03",
      mechanism: "C",
      faultType: "INVALID_SIGNATURE_TEST",
    });
    expect(result.status).toBe("PRECHECK_PASSED");
    expect(loadC01SourceEvidenceMock).not.toHaveBeenCalled();
    expect(loadC11RealWebhookFailureEvidenceMock).not.toHaveBeenCalled();
    expect(getOrderBaselineMock).not.toHaveBeenCalled();
  });
});

describe("C07 — PRECHECK-08 must actually verify a known fresh baseline (architect correction, Finding 3)", () => {
  it("blocks with PRECHECK-08 when no freshOrderId is supplied — Phase 3A has no known baseline to confirm", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C07",
      mechanism: ["A", "C"],
      faultType: "DROP_CLIENT_CONFIRMATION",
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-08",
    });
    expect(getOrderBaselineMock).not.toHaveBeenCalled();
  });

  it("blocks with PRECHECK-08 when a supplied freshOrderId is not actually fresh", async () => {
    getOrderBaselineMock.mockResolvedValue(paidOnceBaseline());
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C07",
      mechanism: ["A", "C"],
      faultType: "DROP_CLIENT_CONFIRMATION",
      freshOrderId: ORDER_ID,
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-08",
    });
  });

  it("blocks with PRECHECK-08 when a supplied freshOrderId does not exist", async () => {
    getOrderBaselineMock.mockResolvedValue(null);
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C07",
      mechanism: ["A", "C"],
      faultType: "DROP_CLIENT_CONFIRMATION",
      freshOrderId: ORDER_ID,
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-08",
    });
  });

  it("reaches PRECHECK_PASSED with a genuinely fresh supplied order", async () => {
    getOrderBaselineMock.mockResolvedValue(freshBaseline());
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C07",
      mechanism: ["A", "C"],
      faultType: "DROP_CLIENT_CONFIRMATION",
      freshOrderId: ORDER_ID,
    });
    expect(result).toEqual({
      status: "PRECHECK_PASSED",
      scenarioId: "C07",
      mechanism: ["A", "C"],
    });
  });
});

describe("C11 — Mechanism A and Mechanism B prerequisites are evaluated separately", () => {
  it("Mechanism A blocks with PRECHECK-08 when no freshOrderId is supplied — Phase 3A has no known baseline to confirm (architect correction, Finding 3)", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C11",
      mechanism: "A",
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-08",
    });
    expect(getOrderBaselineMock).not.toHaveBeenCalled();
    expect(loadC11RealWebhookFailureEvidenceMock).not.toHaveBeenCalled();
    expect(loadC11TestFixtureFailureEvidenceMock).not.toHaveBeenCalled();
  });

  it("Mechanism A reaches PRECHECK_PASSED with a genuinely fresh supplied order", async () => {
    getOrderBaselineMock.mockResolvedValue(freshBaseline());
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C11",
      mechanism: "A",
      freshOrderId: ORDER_ID,
    });
    expect(result).toEqual({
      status: "PRECHECK_PASSED",
      scenarioId: "C11",
      mechanism: "A",
    });
  });

  it("Mechanism A blocks with PRECHECK-08 when the supplied order is not fresh", async () => {
    getOrderBaselineMock.mockResolvedValue(paidOnceBaseline());
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C11",
      mechanism: "A",
      freshOrderId: ORDER_ID,
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-08",
    });
  });

  it("Mechanism B (REAL_WEBHOOK_EVENT) blocks with PRECHECK-07 when no suitable evidence exists", async () => {
    loadC11RealWebhookFailureEvidenceMock.mockResolvedValue(null);
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C11",
      mechanism: "B",
      failureEvidence: {
        kind: "REAL_WEBHOOK_EVENT",
        webhookEventId: WEBHOOK_EVENT_ID,
      },
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-07",
    });
  });

  it("Mechanism B (TEST_FIXTURE) always blocks with PRECHECK-07 — Phase 3A has no fixture store", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C11",
      mechanism: "B",
      failureEvidence: { kind: "TEST_FIXTURE", fixtureId: "fixture-1" },
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-07",
    });
    expect(loadC11RealWebhookFailureEvidenceMock).not.toHaveBeenCalled();
  });

  it("Mechanism B reaches PRECHECK_PASSED with valid authentic failure evidence against a not-yet-paid order", async () => {
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
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C11",
      mechanism: "B",
      failureEvidence: {
        kind: "REAL_WEBHOOK_EVENT",
        webhookEventId: WEBHOOK_EVENT_ID,
      },
    });
    expect(result).toEqual({
      status: "PRECHECK_PASSED",
      scenarioId: "C11",
      mechanism: "B",
    });
  });

  it("Mechanism B blocks with PRECHECK-08 when the correlated order is already PAID", async () => {
    loadC11RealWebhookFailureEvidenceMock.mockResolvedValue({
      webhookEventId: WEBHOOK_EVENT_ID,
      orderId: ORDER_ID,
      baseline: paidOnceBaseline(),
    });
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C11",
      mechanism: "B",
      failureEvidence: {
        kind: "REAL_WEBHOOK_EVENT",
        webhookEventId: WEBHOOK_EVENT_ID,
      },
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-08",
    });
  });
});

describe("Determinism", () => {
  it("the same input and dependency state always produce the exact same result", async () => {
    loadC01SourceEvidenceMock.mockResolvedValue({
      webhookEventId: WEBHOOK_EVENT_ID,
      orderId: ORDER_ID,
      baseline: paidOnceBaseline(),
    });
    const input = {
      scenarioId: "C01" as const,
      mechanism: "B" as const,
      faultType: "REPLAY_EVENT" as const,
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
    };
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const first = await runChaosPrecheck(input);
    const second = await runChaosPrecheck(input);
    expect(first).toEqual(second);
  });

  it("a BLOCKED result is equally deterministic", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const input = { scenarioId: "C02", mechanism: "B" };
    const first = await runChaosPrecheck(input);
    const second = await runChaosPrecheck(input);
    expect(first).toEqual(second);
  });
});

describe("Zero mutation / zero external network call under any outcome", () => {
  it("no mutation-shaped function exists on the mocked repository surface this module depends on", async () => {
    const repo = await import("@/lib/chaos/repository");
    const mutationLike = /^(insert|update|delete|upsert|remove|write|create)/i;
    for (const name of Object.keys(repo)) {
      expect(name).not.toMatch(mutationLike);
    }
  });

  it("the safety-gate module source contains no fetch/http-request/Razorpay-adapter call", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../lib/chaos/safety-gate.ts"),
      "utf-8",
    );
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/razorpay\/adapter/);
    expect(source).not.toMatch(/XMLHttpRequest/);
  });

  it("PRECHECK_PASSED is reached without any repository call other than the read-only ones already asserted above", async () => {
    loadC01SourceEvidenceMock.mockResolvedValue({
      webhookEventId: WEBHOOK_EVENT_ID,
      orderId: ORDER_ID,
      baseline: paidOnceBaseline(),
    });
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C01",
      mechanism: "B",
      faultType: "REPLAY_EVENT",
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
    });
    expect(result.status).toBe("PRECHECK_PASSED");
    expect(checkChaosDatabaseReachableMock).toHaveBeenCalledTimes(1);
    expect(loadC01SourceEvidenceMock).toHaveBeenCalledTimes(1);
  });
});

describe("module marks itself server-only", () => {
  it("imports the server-only marker package as its first import", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../lib/chaos/safety-gate.ts"),
      "utf-8",
    );
    expect(source).toMatch(/import\s+["']server-only["']/);
  });
});
