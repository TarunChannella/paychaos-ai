import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 4F-R3 — `app/api/reliability/route.ts`.
 *
 * Same harness discipline as the Phase 4E route tests: mocked access gate,
 * session verifier and reliability service, and nothing else. This endpoint
 * takes NO input at all, so the central proofs are that it delegates exactly
 * once, that the gate is enforced before the service is reached, and that a
 * read failure can never be dressed up as a score.
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

const getCurrentReliabilityScoreMock = vi.fn();
vi.mock("@/lib/reliability/service", () => ({
  getCurrentReliabilityScore: (...args: unknown[]) =>
    getCurrentReliabilityScoreMock(...args),
}));

/** The real error class, so `instanceof` is exercised genuinely. */
class ReliabilityRepositoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ReliabilityRepositoryError";
    this.code = code;
  }
}
vi.mock("@/lib/reliability/repository", () => ({
  ReliabilityRepositoryError,
}));

const logEventMock = vi.fn();
vi.mock("@/lib/security/logger", () => ({ logEvent: logEventMock }));

function model() {
  return {
    score: {
      algorithmVersion: "RELIABILITY-V1",
      selectionVersion: "LATEST_SELECTION_V1",
      score: 85,
      totalDeduction: 15,
      scenarioBreakdown: [
        { scenarioId: "C01", state: "UNKNOWN", deduction: 15 },
        { scenarioId: "C03", state: "PASS", deduction: 0 },
        { scenarioId: "C07", state: "PASS", deduction: 0 },
        { scenarioId: "C11", state: "PASS", deduction: 0 },
      ],
    },
    selectionDiagnostics: [
      { scenarioId: "C01", selectionReason: "LATEST_ELIGIBLE_RUN" },
      { scenarioId: "C03", selectionReason: "LATEST_ELIGIBLE_RUN" },
      { scenarioId: "C07", selectionReason: "LATEST_ELIGIBLE_RUN" },
      { scenarioId: "C11", selectionReason: "LATEST_ELIGIBLE_RUN" },
    ],
  };
}

async function callGet(
  options: { url?: string; secFetchSite?: string; origin?: string } = {},
) {
  const { GET } = await import("@/app/api/reliability/route");
  const { NextRequest } = await import("next/server");
  const headers: Record<string, string> = {};
  if (options.secFetchSite !== undefined)
    headers["sec-fetch-site"] = options.secFetchSite;
  if (options.origin !== undefined) headers["origin"] = options.origin;

  const request = new NextRequest(
    options.url ?? "http://localhost/api/reliability",
    { method: "GET", headers },
  );
  return GET(request);
}

beforeEach(() => {
  vi.clearAllMocks();
  getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
});

describe("GET /api/reliability — success", () => {
  it("1: delegates to the service exactly once, with no arguments", async () => {
    getCurrentReliabilityScoreMock.mockResolvedValue(model());

    const response = await callGet();

    expect(response.status).toBe(200);
    expect(getCurrentReliabilityScoreMock).toHaveBeenCalledTimes(1);
    expect(getCurrentReliabilityScoreMock).toHaveBeenCalledWith();
  });

  it("2: returns the trusted read model unchanged", async () => {
    const expected = model();
    getCurrentReliabilityScoreMock.mockResolvedValue(expected);

    const payload = await (await callGet()).json();

    expect(payload).toEqual(expected);
    expect(payload.score.algorithmVersion).toBe("RELIABILITY-V1");
    expect(payload.score.selectionVersion).toBe("LATEST_SELECTION_V1");
  });

  it("3: no query string can influence the calculation", async () => {
    getCurrentReliabilityScoreMock.mockResolvedValue(model());

    await callGet({
      url: "http://localhost/api/reliability?scenario=C03&score=100&algorithm=X&threshold=0",
    });

    // The service takes no argument, so a caller cannot steer it at all.
    expect(getCurrentReliabilityScoreMock).toHaveBeenCalledWith();
  });

  it("4: only GET is exported — there is no mutation surface", async () => {
    const route = await import("@/app/api/reliability/route");

    expect(typeof route.GET).toBe("function");
    for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(route, verb).not.toHaveProperty(verb);
    }
  });
});

describe("GET /api/reliability — access", () => {
  it("5: a known cross-origin request is refused before the service", async () => {
    const response = await callGet({ secFetchSite: "cross-site" });

    expect(response.status).toBe(403);
    expect(getCurrentReliabilityScoreMock).not.toHaveBeenCalled();
  });

  it("6: a foreign Origin header is refused before the service", async () => {
    const response = await callGet({ origin: "https://evil.example" });

    expect(response.status).toBe(403);
    expect(getCurrentReliabilityScoreMock).not.toHaveBeenCalled();
  });

  it("7: an enabled gate without a valid session refuses", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      sessionSecret: "fake-session-secret-not-real-" + "x".repeat(10),
    });
    verifySessionTokenMock.mockReturnValue(false);

    const response = await callGet();

    expect(response.status).toBe(401);
    expect(getCurrentReliabilityScoreMock).not.toHaveBeenCalled();
  });

  it("8: a misconfigured gate fails closed and never names the reason", async () => {
    getAccessGateEnvMock.mockImplementation(() => {
      throw new Error("missing PAYCHAOS_SESSION_SECRET");
    });

    const response = await callGet();
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(getCurrentReliabilityScoreMock).not.toHaveBeenCalled();
    for (const forbidden of [
      "PAYCHAOS_SESSION_SECRET",
      "PAYCHAOS_ACCESS_TOKEN",
      "SUPABASE",
      "missing",
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });
});

describe("GET /api/reliability — READ FAILURE IS NOT ABSENCE", () => {
  it("9: a repository read failure is a 503 carrying only its stable code", async () => {
    getCurrentReliabilityScoreMock.mockRejectedValue(
      new ReliabilityRepositoryError(
        "CHAOS_RUN_READ_FAILED",
        "The chaos runs required by the reliability score could not be read.",
      ),
    );

    const response = await callGet();
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.code).toBe("CHAOS_RUN_READ_FAILED");
  });

  it("10: the invariant-result failure code is reported distinctly", async () => {
    getCurrentReliabilityScoreMock.mockRejectedValue(
      new ReliabilityRepositoryError("INVARIANT_RESULT_READ_FAILED", "safe"),
    );

    const payload = await (await callGet()).json();

    expect(payload.code).toBe("INVARIANT_RESULT_READ_FAILED");
  });

  it("11: a read failure NEVER returns a score", async () => {
    // The whole point: an outage must not become four NOT_RUN rows and a
    // confident 40. There must be no score-shaped field at all.
    getCurrentReliabilityScoreMock.mockRejectedValue(
      new ReliabilityRepositoryError("CHAOS_RUN_READ_FAILED", "safe"),
    );

    const payload = await (await callGet()).json();

    expect(payload).not.toHaveProperty("score");
    expect(payload).not.toHaveProperty("selectionDiagnostics");
    expect(JSON.stringify(payload)).not.toContain("NOT_RUN");
    expect(JSON.stringify(payload)).not.toContain("40");
  });

  it("12: an unexpected error is a generic 500 with no raw wording", async () => {
    getCurrentReliabilityScoreMock.mockRejectedValue(
      Object.assign(new Error("PGRST301: JWT expired at row 7"), {
        details: "internal detail",
        hint: "rotate the key",
      }),
    );

    const response = await callGet();
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
