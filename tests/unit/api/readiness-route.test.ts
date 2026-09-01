import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 4G — `app/api/readiness/route.ts`.
 *
 * The same harness discipline as the Phase 4F reliability route test: mocked
 * access gate, session verifier and readiness service, and nothing else. The
 * endpoint takes NO input, so the proofs that matter are that it delegates
 * exactly once, that the gate is enforced BEFORE the service is reached, and
 * that a read failure can never be dressed up as a readiness verdict.
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

const getCurrentGoLiveReadinessMock = vi.fn();
vi.mock("@/lib/readiness/service", () => ({
  getCurrentGoLiveReadiness: (...args: unknown[]) =>
    getCurrentGoLiveReadinessMock(...args),
}));

/** The real shapes, so `instanceof` is exercised genuinely. */
class ReadinessRepositoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ReadinessRepositoryError";
    this.code = code;
  }
}
vi.mock("@/lib/readiness/repository", () => ({ ReadinessRepositoryError }));

class ReliabilityRepositoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ReliabilityRepositoryError";
    this.code = code;
  }
}
vi.mock("@/lib/reliability/repository", () => ({ ReliabilityRepositoryError }));

const logEventMock = vi.fn();
vi.mock("@/lib/security/logger", () => ({ logEvent: logEventMock }));

function model() {
  return {
    readiness: {
      version: "GO-LIVE-READINESS-V1",
      status: "NEEDS ATTENTION",
      blockingReasons: [],
      attentionReasons: [
        {
          code: "NA_REQUIRED_VERIFICATION_INCOMPLETE",
          subject: "BUILD_VERIFICATION",
          text: "A required verification is incomplete.",
        },
      ],
      gates: [
        {
          gateId: "TEST_MODE_SECURITY",
          state: "PASS",
          detail: "Razorpay Test Mode configuration is enforced.",
        },
      ],
      disclaimer: "This is an engineering assessment, not an approval.",
    },
    reliability: {
      score: { algorithmVersion: "RELIABILITY-V1", score: 85 },
      selectionDiagnostics: [],
    },
  };
}

async function callGet(
  options: { url?: string; secFetchSite?: string; origin?: string } = {},
) {
  const { GET } = await import("@/app/api/readiness/route");
  const { NextRequest } = await import("next/server");
  const headers: Record<string, string> = {};
  if (options.secFetchSite !== undefined)
    headers["sec-fetch-site"] = options.secFetchSite;
  if (options.origin !== undefined) headers["origin"] = options.origin;

  const request = new NextRequest(
    options.url ?? "http://localhost/api/readiness",
    { method: "GET", headers },
  );
  return GET(request);
}

beforeEach(() => {
  vi.clearAllMocks();
  getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
});

describe("GET /api/readiness — success", () => {
  it("1: delegates to the service exactly once, with no arguments", async () => {
    getCurrentGoLiveReadinessMock.mockResolvedValue(model());

    const response = await callGet();

    expect(response.status).toBe(200);
    expect(getCurrentGoLiveReadinessMock).toHaveBeenCalledTimes(1);
    expect(getCurrentGoLiveReadinessMock).toHaveBeenCalledWith();
  });

  it("2: returns the trusted read model unchanged", async () => {
    getCurrentGoLiveReadinessMock.mockResolvedValue(model());

    const body = await (await callGet()).json();

    // The route re-decides nothing: no recomputed status, no re-ranked reason.
    expect(body).toEqual(model());
  });

  it("3: no query string can influence the assessment", async () => {
    getCurrentGoLiveReadinessMock.mockResolvedValue(model());

    const body = await (
      await callGet({
        url: "http://localhost/api/readiness?status=READY&force=1&gate=PASS",
      })
    ).json();

    expect(getCurrentGoLiveReadinessMock).toHaveBeenCalledWith();
    expect(body.readiness.status).toBe("NEEDS ATTENTION");
  });

  it("4: only GET is exported — there is no mutation surface", async () => {
    const route = await import("@/app/api/readiness/route");

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(route, method).not.toHaveProperty(method);
    }
    expect(typeof route.GET).toBe("function");
  });

  it("5: the response is never cached", async () => {
    // A cached readiness verdict is a stale readiness verdict.
    const route = await import("@/app/api/readiness/route");
    expect(route.dynamic).toBe("force-dynamic");
  });
});

describe("GET /api/readiness — access", () => {
  it("6: a known cross-origin request is refused before the service", async () => {
    const response = await callGet({ secFetchSite: "cross-site" });

    expect(response.status).toBe(403);
    expect(getCurrentGoLiveReadinessMock).not.toHaveBeenCalled();
  });

  it("7: a foreign Origin header is refused before the service", async () => {
    const response = await callGet({ origin: "https://evil.example" });

    expect(response.status).toBe(403);
    expect(getCurrentGoLiveReadinessMock).not.toHaveBeenCalled();
  });

  it("8: an enabled gate without a valid session refuses", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      sessionSecret: "s",
    });
    verifySessionTokenMock.mockReturnValue(false);

    const response = await callGet();

    expect(response.status).toBe(401);
    expect(getCurrentGoLiveReadinessMock).not.toHaveBeenCalled();
  });

  it("9: a misconfigured gate fails closed and never names the reason", async () => {
    getAccessGateEnvMock.mockImplementation(() => {
      throw new Error("PAYCHAOS_SESSION_SECRET is missing from the deployment");
    });

    const response = await callGet();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(getCurrentGoLiveReadinessMock).not.toHaveBeenCalled();
    for (const leaked of ["PAYCHAOS_SESSION_SECRET", "missing", "deployment"]) {
      expect(JSON.stringify(body), leaked).not.toContain(leaked);
    }
  });
});

describe("GET /api/readiness — READ FAILURE IS NOT A CLEAN STATE", () => {
  it("10: a readiness read failure is a 503 carrying only its stable code", async () => {
    getCurrentGoLiveReadinessMock.mockRejectedValue(
      new ReadinessRepositoryError(
        "FINDING_READ_FAILED",
        'relation "findings" does not exist',
      ),
    );

    const response = await callGet();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe("FINDING_READ_FAILED");
    for (const leaked of ["relation", "does not exist"]) {
      expect(JSON.stringify(body), leaked).not.toContain(leaked);
    }
  });

  it("11: a reliability read failure is reported the same way", async () => {
    getCurrentGoLiveReadinessMock.mockRejectedValue(
      new ReliabilityRepositoryError("CHAOS_RUN_READ_FAILED", "raw detail"),
    );

    const response = await callGet();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe("CHAOS_RUN_READ_FAILED");
    expect(JSON.stringify(body)).not.toContain("raw detail");
  });

  it("12: a read failure NEVER returns a readiness status", async () => {
    // The single most dangerous failure mode of this phase: an outage
    // rendered as a verdict, and above all as READY.
    for (const error of [
      new ReadinessRepositoryError("FINDING_READ_FAILED", "x"),
      new ReadinessRepositoryError("INVARIANT_RESULT_READ_FAILED", "x"),
      new ReliabilityRepositoryError("CHAOS_RUN_READ_FAILED", "x"),
    ]) {
      getCurrentGoLiveReadinessMock.mockRejectedValue(error);

      const body = await (await callGet()).json();
      const serialized = JSON.stringify(body);

      expect(body).not.toHaveProperty("readiness");
      expect(serialized).not.toContain("READY");
      expect(serialized).not.toContain("NEEDS ATTENTION");
      expect(body).not.toHaveProperty("reliability");
    }
  });

  it("13: an unexpected error is a generic 500 with no raw wording", async () => {
    getCurrentGoLiveReadinessMock.mockRejectedValue(
      new Error("connect ECONNREFUSED 10.0.0.4:5432"),
    );

    const response = await callGet();
    const body = await response.json();

    expect(response.status).toBe(500);
    for (const leaked of ["ECONNREFUSED", "10.0.0.4", "5432"]) {
      expect(JSON.stringify(body), leaked).not.toContain(leaked);
    }
  });

  it("14: no log line carries a raw database message", async () => {
    getCurrentGoLiveReadinessMock.mockRejectedValue(
      new ReadinessRepositoryError(
        "FINDING_READ_FAILED",
        'relation "findings" does not exist',
      ),
    );

    await callGet();

    const logged = JSON.stringify(logEventMock.mock.calls);
    expect(logged).toContain("FINDING_READ_FAILED");
    expect(logged).not.toContain("does not exist");
  });
});
