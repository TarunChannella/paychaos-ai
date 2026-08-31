import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 4E-R3-A — `app/api/regressions/[regressionRunId]/advance/route.ts`.
 *
 * Same harness discipline as the start-route test: mocked access gate,
 * session verifier and regression service, and nothing else. This endpoint
 * takes NO operational input, so the central proofs are that it delegates
 * exactly once on the path id alone and refuses any request that tries to
 * carry state.
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

const REGRESSION_ID = "33333333-3333-4333-8333-333333333333";
const FINDING_ID = "11111111-1111-4111-8111-111111111111";
const CHAOS_RUN_ID = "44444444-4444-4444-8444-444444444444";

function attempt() {
  return {
    findingId: FINDING_ID,
    regressionRunId: REGRESSION_ID,
    chaosRunId: CHAOS_RUN_ID,
    scenarioId: "C03",
  };
}

async function callAdvance(
  regressionRunId: string,
  options: { body?: string; secFetchSite?: string } = {},
) {
  const { POST } =
    await import("@/app/api/regressions/[regressionRunId]/advance/route");
  const { NextRequest } = await import("next/server");
  const headers: Record<string, string> = {};
  if (options.secFetchSite !== undefined)
    headers["sec-fetch-site"] = options.secFetchSite;

  const request = new NextRequest(
    `http://localhost/api/regressions/${regressionRunId}/advance`,
    {
      method: "POST",
      headers,
      ...(options.body !== undefined ? { body: options.body } : {}),
    },
  );
  return POST(request, { params: Promise.resolve({ regressionRunId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
});

describe("POST /api/regressions/[regressionRunId]/advance — input", () => {
  it("1: a valid id delegates exactly once, on the id alone", async () => {
    advanceRegressionMock.mockResolvedValue({
      kind: "IN_PROGRESS",
      attempt: attempt(),
    });

    const response = await callAdvance(REGRESSION_ID);

    expect(response.status).toBe(200);
    expect(advanceRegressionMock).toHaveBeenCalledTimes(1);
    expect(advanceRegressionMock).toHaveBeenCalledWith(REGRESSION_ID);
  });

  it("2: an empty JSON object is accepted", async () => {
    advanceRegressionMock.mockResolvedValue({
      kind: "IN_PROGRESS",
      attempt: attempt(),
    });

    const response = await callAdvance(REGRESSION_ID, { body: "{}" });

    expect(response.status).toBe(200);
    expect(advanceRegressionMock).toHaveBeenCalledWith(REGRESSION_ID);
  });

  it("3: a malformed id is rejected before the service", async () => {
    const response = await callAdvance("not-a-uuid");

    expect(response.status).toBe(400);
    expect(advanceRegressionMock).not.toHaveBeenCalled();
  });

  it("4: ANY body key is refused — this endpoint takes no input", async () => {
    for (const body of [
      { scenarioId: "C01" },
      { continuation: "C07_TEST_MODE_CHECKOUT" },
      { outcome: "PASS" },
      { result: "PASS" },
      { status: "RESOLVED" },
      { chaosRunId: CHAOS_RUN_ID },
      { findingId: FINDING_ID },
      { orderId: FINDING_ID },
      { paymentId: FINDING_ID },
      { webhookId: FINDING_ID },
      { url: "https://evil.example" },
      { payload: { anything: true } },
    ]) {
      vi.clearAllMocks();
      getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
      const response = await callAdvance(REGRESSION_ID, {
        body: JSON.stringify(body),
      });
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(advanceRegressionMock).not.toHaveBeenCalled();
    }
  });

  it("5: malformed JSON and non-object bodies are refused", async () => {
    for (const body of ["{not json", "[]", '"a string"', "42"]) {
      vi.clearAllMocks();
      getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
      const response = await callAdvance(REGRESSION_ID, { body });
      expect(response.status, body).toBe(400);
      expect(advanceRegressionMock).not.toHaveBeenCalled();
    }
  });
});

describe("POST /api/regressions/[regressionRunId]/advance — results", () => {
  it("6: COMPLETED is serialized with its verdict", async () => {
    advanceRegressionMock.mockResolvedValue({
      kind: "COMPLETED",
      attempt: attempt(),
      regressionStatus: "STILL_FAILING",
      findingAction: "MARK_STILL_FAILING",
      decisionReason: "SCENARIO_CRITERIA_FAILED",
    });

    const response = await callAdvance(REGRESSION_ID);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.kind).toBe("COMPLETED");
    expect(payload.regressionStatus).toBe("STILL_FAILING");
    expect(payload.findingAction).toBe("MARK_STILL_FAILING");
  });

  it("7: AWAITING_EXTERNAL_ACTION is serialized safely", async () => {
    advanceRegressionMock.mockResolvedValue({
      kind: "AWAITING_EXTERNAL_ACTION",
      attempt: { ...attempt(), scenarioId: "C11" },
      continuation: "C11_A_TEST_MODE_FAILED_PAYMENT",
    });

    const response = await callAdvance(REGRESSION_ID);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.continuation).toBe("C11_A_TEST_MODE_FAILED_PAYMENT");
  });

  it("8: IN_PROGRESS exposes only the attempt identifiers", async () => {
    advanceRegressionMock.mockResolvedValue({
      kind: "IN_PROGRESS",
      attempt: attempt(),
    });

    const payload = await (await callAdvance(REGRESSION_ID)).json();

    expect(Object.keys(payload).sort()).toEqual([
      "chaosRunId",
      "findingId",
      "kind",
      "regressionRunId",
      "scenarioId",
    ]);
  });

  it("9: SUPERSEDED is serialized with its reason", async () => {
    advanceRegressionMock.mockResolvedValue({
      kind: "SUPERSEDED",
      attempt: attempt(),
      regressionStatus: "RESOLVED",
      reason: "NEWER_REGRESSION_EXISTS",
    });

    const response = await callAdvance(REGRESSION_ID);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      kind: "SUPERSEDED",
      findingId: FINDING_ID,
      regressionRunId: REGRESSION_ID,
      chaosRunId: CHAOS_RUN_ID,
      scenarioId: "C03",
      regressionStatus: "RESOLVED",
      reason: "NEWER_REGRESSION_EXISTS",
    });
  });

  it("10: ERRORED carries only the safe reason and precheck id", async () => {
    advanceRegressionMock.mockResolvedValue({
      kind: "ERRORED",
      attempt: attempt(),
      reason: "CHAOS_RUN_BLOCKED",
      failedPrecheckId: "PRECHECK-08",
    });

    const response = await callAdvance(REGRESSION_ID);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.kind).toBe("ERRORED");
    expect(payload.reason).toBe("CHAOS_RUN_BLOCKED");
    expect(payload.failedPrecheckId).toBe("PRECHECK-08");
  });

  it("11: an unknown regression maps to the safe not-found response", async () => {
    advanceRegressionMock.mockRejectedValue(
      Object.assign(new Error("No regression exists with that identifier."), {
        code: "REGRESSION_SERVICE_RUN_NOT_FOUND",
      }),
    );

    const response = await callAdvance(REGRESSION_ID);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: "Regression not found." });
  });

  it("12: raw exception wording never reaches the client", async () => {
    advanceRegressionMock.mockRejectedValue(
      Object.assign(new Error("PGRST301: JWT expired at row 7"), {
        details: "internal detail",
        hint: "rotate the key",
      }),
    );

    const response = await callAdvance(REGRESSION_ID);
    const text = await response.text();

    expect(response.status).toBe(500);
    for (const forbidden of [
      "PGRST",
      "JWT",
      "internal detail",
      "rotate the key",
      "row 7",
      "at Object",
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });
});

describe("POST /api/regressions/[regressionRunId]/advance — access", () => {
  it("13: a known cross-origin request is refused before the service", async () => {
    const response = await callAdvance(REGRESSION_ID, {
      secFetchSite: "cross-site",
    });

    expect(response.status).toBe(403);
    expect(advanceRegressionMock).not.toHaveBeenCalled();
  });

  it("14: an enabled gate without a valid session refuses", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      sessionSecret: "fake-session-secret-not-real-" + "x".repeat(10),
    });
    verifySessionTokenMock.mockReturnValue(false);

    const response = await callAdvance(REGRESSION_ID);

    expect(response.status).toBe(401);
    expect(advanceRegressionMock).not.toHaveBeenCalled();
  });

  it("15: a misconfigured gate fails closed", async () => {
    getAccessGateEnvMock.mockImplementation(() => {
      throw new Error("missing PAYCHAOS_SESSION_SECRET");
    });

    const response = await callAdvance(REGRESSION_ID);

    expect(response.status).toBe(503);
    expect(advanceRegressionMock).not.toHaveBeenCalled();
  });
});
