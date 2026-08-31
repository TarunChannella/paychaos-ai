import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 4E-R3-A — `app/api/findings/[findingId]/regressions/route.ts`.
 *
 * Exercised against a mocked access gate, session verifier and regression
 * service — no real cookies, no real Supabase, no chaos execution. Proves
 * only the route's own job: validate the path and body shape, reject a known
 * cross-origin request, enforce the access gate, delegate ONCE to the trusted
 * service, and map its typed result to a safe response. Mirrors
 * `tests/unit/api/chaos-c03-route.test.ts`'s structure.
 */

const getAccessGateEnvMock = vi.fn();
vi.mock("@/lib/config/access-env", () => ({
  getAccessGateEnv: getAccessGateEnvMock,
}));

const verifySessionTokenMock = vi.fn();
vi.mock("@/lib/access/session", () => ({
  ACCESS_SESSION_COOKIE_NAME: "paychaos_session",
  verifySessionToken: verifySessionTokenMock,
}));

const startRegressionMock = vi.fn();
const advanceRegressionMock = vi.fn();
vi.mock("@/lib/regression/service", () => ({
  startRegression: (...args: unknown[]) => startRegressionMock(...args),
  advanceRegression: (...args: unknown[]) => advanceRegressionMock(...args),
}));

const logEventMock = vi.fn();
vi.mock("@/lib/security/logger", () => ({ logEvent: logEventMock }));

const FINDING_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const REGRESSION_ID = "33333333-3333-4333-8333-333333333333";
const CHAOS_RUN_ID = "44444444-4444-4444-8444-444444444444";

function attempt() {
  return {
    findingId: FINDING_ID,
    regressionRunId: REGRESSION_ID,
    chaosRunId: CHAOS_RUN_ID,
    scenarioId: "C03",
  };
}

async function callStart(
  findingId: string,
  options: {
    body?: string;
    origin?: string;
    secFetchSite?: string;
  } = {},
) {
  const { POST } =
    await import("@/app/api/findings/[findingId]/regressions/route");
  const { NextRequest } = await import("next/server");
  const headers: Record<string, string> = {};
  if (options.origin !== undefined) headers.origin = options.origin;
  if (options.secFetchSite !== undefined)
    headers["sec-fetch-site"] = options.secFetchSite;

  const request = new NextRequest(
    `http://localhost/api/findings/${findingId}/regressions`,
    {
      method: "POST",
      headers,
      ...(options.body !== undefined ? { body: options.body } : {}),
    },
  );
  return POST(request, { params: Promise.resolve({ findingId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
});

// ============================================================================
// INPUT VALIDATION
// ============================================================================

describe("POST /api/findings/[findingId]/regressions — input", () => {
  it("1: a valid id with an empty body calls startRegression exactly once", async () => {
    startRegressionMock.mockResolvedValue({
      kind: "COMPLETED",
      attempt: attempt(),
      regressionStatus: "RESOLVED",
      findingAction: "RESOLVE",
      decisionReason: "SCENARIO_CRITERIA_PASSED",
    });

    const response = await callStart(FINDING_ID, { body: "{}" });

    expect(response.status).toBe(200);
    expect(startRegressionMock).toHaveBeenCalledTimes(1);
    expect(startRegressionMock).toHaveBeenCalledWith({ findingId: FINDING_ID });
  });

  it("2: a valid freshOrderId is passed through exactly", async () => {
    startRegressionMock.mockResolvedValue({
      kind: "AWAITING_EXTERNAL_ACTION",
      attempt: { ...attempt(), scenarioId: "C07" },
      continuation: "C07_TEST_MODE_CHECKOUT",
    });

    await callStart(FINDING_ID, {
      body: JSON.stringify({ freshOrderId: ORDER_ID }),
    });

    expect(startRegressionMock).toHaveBeenCalledWith({
      findingId: FINDING_ID,
      freshOrderId: ORDER_ID,
    });
  });

  it("3: a malformed finding id is rejected before the service", async () => {
    const response = await callStart("not-a-uuid", { body: "{}" });

    expect(response.status).toBe(400);
    expect(startRegressionMock).not.toHaveBeenCalled();
  });

  it("4: malformed JSON is rejected before the service", async () => {
    const response = await callStart(FINDING_ID, { body: "{not json" });

    expect(response.status).toBe(400);
    expect(startRegressionMock).not.toHaveBeenCalled();
  });

  it("5: an array body is rejected", async () => {
    const response = await callStart(FINDING_ID, { body: "[]" });

    expect(response.status).toBe(400);
    expect(startRegressionMock).not.toHaveBeenCalled();
  });

  it("6: an unknown key is rejected rather than ignored", async () => {
    const response = await callStart(FINDING_ID, {
      body: JSON.stringify({ freshOrderId: ORDER_ID, extra: "x" }),
    });

    expect(response.status).toBe(400);
    expect(startRegressionMock).not.toHaveBeenCalled();
  });

  it("7: a non-UUID or non-string freshOrderId is rejected", async () => {
    for (const value of ["nope", 42, null, { id: ORDER_ID }, [ORDER_ID]]) {
      vi.clearAllMocks();
      getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
      const response = await callStart(FINDING_ID, {
        body: JSON.stringify({ freshOrderId: value }),
      });
      expect(response.status, JSON.stringify(value)).toBe(400);
      expect(startRegressionMock).not.toHaveBeenCalled();
    }
  });

  it("8: the caller cannot choose the scenario", async () => {
    const response = await callStart(FINDING_ID, {
      body: JSON.stringify({ scenarioId: "C01" }),
    });

    expect(response.status).toBe(400);
    expect(startRegressionMock).not.toHaveBeenCalled();
  });

  it("9: the caller cannot choose the invariant set", async () => {
    for (const body of [
      { invariantId: "INV-005" },
      { invariantIds: ["INV-004"] },
      { requiredInvariantIds: ["INV-005"] },
    ]) {
      vi.clearAllMocks();
      getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
      const response = await callStart(FINDING_ID, {
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      expect(startRegressionMock).not.toHaveBeenCalled();
    }
  });

  it("10: the caller cannot supply any network target", async () => {
    for (const body of [
      { url: "https://evil.example" },
      { host: "evil.example" },
      { endpoint: "/x" },
      { callback: "https://evil.example" },
      { webhookUrl: "https://evil.example" },
      { ip: "1.2.3.4" },
      { command: "rm -rf /" },
      { script: "drop table findings" },
      { payload: { anything: true } },
      { chaosRunId: CHAOS_RUN_ID },
      { sourceWebhookEventId: CHAOS_RUN_ID },
      { failureEvidence: { kind: "TEST_FIXTURE", fixtureId: "x" } },
      { result: "PASS" },
      { status: "RESOLVED" },
      { diagnosis: "anything" },
      { recommendation: "anything" },
    ]) {
      vi.clearAllMocks();
      getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
      const response = await callStart(FINDING_ID, {
        body: JSON.stringify(body),
      });
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(startRegressionMock).not.toHaveBeenCalled();
    }
  });
});

// ============================================================================
// RESULT SERIALIZATION
// ============================================================================

describe("POST /api/findings/[findingId]/regressions — results", () => {
  it("11: COMPLETED is serialized with its verdict", async () => {
    startRegressionMock.mockResolvedValue({
      kind: "COMPLETED",
      attempt: attempt(),
      regressionStatus: "RESOLVED",
      findingAction: "RESOLVE",
      decisionReason: "SCENARIO_CRITERIA_PASSED",
    });

    const response = await callStart(FINDING_ID, { body: "{}" });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      kind: "COMPLETED",
      findingId: FINDING_ID,
      regressionRunId: REGRESSION_ID,
      chaosRunId: CHAOS_RUN_ID,
      scenarioId: "C03",
      regressionStatus: "RESOLVED",
      findingAction: "RESOLVE",
      decisionReason: "SCENARIO_CRITERIA_PASSED",
    });
  });

  it("12: AWAITING_EXTERNAL_ACTION carries only the closed continuation", async () => {
    startRegressionMock.mockResolvedValue({
      kind: "AWAITING_EXTERNAL_ACTION",
      attempt: { ...attempt(), scenarioId: "C07" },
      continuation: "C07_TEST_MODE_CHECKOUT",
    });

    const response = await callStart(FINDING_ID, { body: "{}" });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.kind).toBe("AWAITING_EXTERNAL_ACTION");
    expect(payload.continuation).toBe("C07_TEST_MODE_CHECKOUT");
    // Never a Checkout URL, key, order payload or provider instruction.
    expect(JSON.stringify(payload)).not.toContain("http");
  });

  it("13: IN_PROGRESS exposes only the attempt identifiers", async () => {
    startRegressionMock.mockResolvedValue({
      kind: "IN_PROGRESS",
      attempt: attempt(),
    });

    const response = await callStart(FINDING_ID, { body: "{}" });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(payload).sort()).toEqual([
      "chaosRunId",
      "findingId",
      "kind",
      "regressionRunId",
      "scenarioId",
    ]);
  });

  it("14: a domain refusal is a deterministic conflict, not a 500", async () => {
    startRegressionMock.mockResolvedValue({
      kind: "NOT_STARTED",
      findingId: FINDING_ID,
      reason: "FRESH_ORDER_REUSE_FORBIDDEN",
      ineligibility: null,
    });

    const response = await callStart(FINDING_ID, { body: "{}" });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      kind: "NOT_STARTED",
      findingId: FINDING_ID,
      reason: "FRESH_ORDER_REUSE_FORBIDDEN",
      ineligibility: null,
    });
  });

  it("15: ORPHAN_START is reported safely without executing anything", async () => {
    startRegressionMock.mockResolvedValue({
      kind: "ORPHAN_START",
      findingId: FINDING_ID,
      chaosRunId: CHAOS_RUN_ID,
      scenarioId: "C03",
      reason: "ACTIVE_RACE_LOST",
    });

    const response = await callStart(FINDING_ID, { body: "{}" });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.kind).toBe("ORPHAN_START");
    expect(payload.reason).toBe("ACTIVE_RACE_LOST");
  });

  it("16: an unexpected failure is a generic safe 500", async () => {
    startRegressionMock.mockRejectedValue(
      new Error("PGRST116: relation findings does not exist"),
    );

    const response = await callStart(FINDING_ID, { body: "{}" });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      error: "Regression request could not be processed.",
    });
  });

  it("17: raw service or database wording never reaches the client", async () => {
    startRegressionMock.mockRejectedValue(
      Object.assign(
        new Error("duplicate key value violates unique constraint"),
        {
          details: "Key (finding_id)=(...) already exists.",
          hint: "check the row",
          code: "23505",
        },
      ),
    );

    const response = await callStart(FINDING_ID, { body: "{}" });
    const text = await response.text();

    for (const forbidden of [
      "duplicate key",
      "unique constraint",
      "Key (finding_id)",
      "check the row",
      "23505",
      "PGRST",
      "at Object",
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });
});

// ============================================================================
// ACCESS BOUNDARY
// ============================================================================

describe("POST /api/findings/[findingId]/regressions — access", () => {
  it("18: a known cross-origin request is refused before the service", async () => {
    const response = await callStart(FINDING_ID, {
      body: "{}",
      secFetchSite: "cross-site",
    });

    expect(response.status).toBe(403);
    expect(startRegressionMock).not.toHaveBeenCalled();
  });

  it("19: an enabled gate without a valid session refuses", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      sessionSecret: "fake-session-secret-not-real-" + "x".repeat(10),
    });
    verifySessionTokenMock.mockReturnValue(false);

    const response = await callStart(FINDING_ID, { body: "{}" });

    expect(response.status).toBe(401);
    expect(startRegressionMock).not.toHaveBeenCalled();
  });

  it("20: a misconfigured gate fails closed rather than open", async () => {
    getAccessGateEnvMock.mockImplementation(() => {
      throw new Error("missing PAYCHAOS_SESSION_SECRET");
    });

    const response = await callStart(FINDING_ID, { body: "{}" });
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(startRegressionMock).not.toHaveBeenCalled();
    // The misconfiguration reason is never echoed.
    expect(text).not.toContain("SESSION_SECRET");
  });
});
