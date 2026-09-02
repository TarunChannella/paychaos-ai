import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 5B — `POST /api/demo/reset`.
 *
 * The only destructive endpoint in the product. These tests assert the
 * properties that keep it from becoming a generic database-deletion surface:
 * POST only, gated before the service is reached, and no request input of any
 * kind reaching `runDemoReset()`.
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

const runDemoResetMock = vi.fn();
vi.mock("@/lib/demo-reset/service", () => ({
  runDemoReset: (...args: unknown[]) => runDemoResetMock(...args),
}));

const logEventMock = vi.fn();
vi.mock("@/lib/security/logger", () => ({ logEvent: logEventMock }));

/** Row counts the atomic reset reports on success. */
const DELETED_COUNTS = {
  fulfilments: 1,
  regression_runs: 2,
  event_processing_attempts: 3,
  findings: 4,
  invariant_results: 5,
  chaos_runs: 6,
  webhook_events: 7,
  payments: 8,
  payment_attempts: 9,
  orders: 10,
};

async function callPost(
  options: {
    url?: string;
    secFetchSite?: string;
    origin?: string;
    body?: string;
  } = {},
) {
  const { POST } = await import("@/app/api/demo/reset/route");
  const { NextRequest } = await import("next/server");
  const headers: Record<string, string> = {};
  if (options.secFetchSite !== undefined)
    headers["sec-fetch-site"] = options.secFetchSite;
  if (options.origin !== undefined) headers["origin"] = options.origin;

  const request = new NextRequest(
    options.url ?? "http://localhost/api/demo/reset",
    { method: "POST", headers, body: options.body },
  );
  return POST(request);
}

beforeEach(() => {
  vi.clearAllMocks();
  getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
  runDemoResetMock.mockResolvedValue({
    ok: true,
    resetApplied: true,
    deletedCounts: DELETED_COUNTS,
  });
});

describe("POST /api/demo/reset — success", () => {
  it("1: delegates to the service exactly once, with no arguments", async () => {
    const response = await callPost();

    expect(response.status).toBe(200);
    expect(runDemoResetMock).toHaveBeenCalledTimes(1);
    // The caller cannot name a table, a predicate or a scope.
    expect(runDemoResetMock).toHaveBeenCalledWith();
  });

  it("2: reports that the reset was applied, with row counts", async () => {
    const body = await (await callPost()).json();

    expect(body.ok).toBe(true);
    expect(body.resetApplied).toBe(true);
    expect(body.deletedCounts).toEqual(DELETED_COUNTS);
  });

  it("3: a request body cannot influence the reset", async () => {
    await callPost({
      body: JSON.stringify({ tables: ["users"], truncate: true }),
    });

    expect(runDemoResetMock).toHaveBeenCalledWith();
  });

  it("4: a query string cannot influence the reset", async () => {
    await callPost({
      url: "http://localhost/api/demo/reset?table=users&all=1",
    });

    expect(runDemoResetMock).toHaveBeenCalledWith();
  });
});

describe("POST /api/demo/reset — it is not reachable by navigation", () => {
  it("5: no GET is exported", async () => {
    const route = await import("@/app/api/demo/reset/route");

    // A destructive action behind GET could fire from a prefetch, a crawler
    // or an <img> tag.
    expect(route).not.toHaveProperty("GET");
    for (const method of ["PUT", "PATCH", "DELETE", "HEAD"]) {
      expect(route, method).not.toHaveProperty(method);
    }
    expect(typeof route.POST).toBe("function");
  });

  it("6: it is never cached", async () => {
    const route = await import("@/app/api/demo/reset/route");
    expect(route.dynamic).toBe("force-dynamic");
  });
});

describe("POST /api/demo/reset — access", () => {
  it("7: a cross-origin request is refused before the service", async () => {
    const response = await callPost({ secFetchSite: "cross-site" });

    expect(response.status).toBe(403);
    expect(runDemoResetMock).not.toHaveBeenCalled();
  });

  it("8: a foreign Origin is refused before the service", async () => {
    const response = await callPost({ origin: "https://evil.example" });

    expect(response.status).toBe(403);
    expect(runDemoResetMock).not.toHaveBeenCalled();
  });

  it("9: an enabled gate without a valid session refuses", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      sessionSecret: "s",
    });
    verifySessionTokenMock.mockReturnValue(false);

    const response = await callPost();

    expect(response.status).toBe(401);
    expect(runDemoResetMock).not.toHaveBeenCalled();
  });

  it("10: a misconfigured gate fails closed and deletes nothing", async () => {
    getAccessGateEnvMock.mockImplementation(() => {
      throw new Error("PAYCHAOS_SESSION_SECRET is missing");
    });

    const response = await callPost();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(runDemoResetMock).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("PAYCHAOS_SESSION_SECRET");
  });
});

describe("POST /api/demo/reset — failure is never reported as success", () => {
  it("11: a failure is a 500 stating that NOTHING was applied", async () => {
    // ADVANCED, NOT LOOSENED. This previously asserted the 500 named the
    // table the reset "stopped at" and listed the tables already cleared.
    // That described a partial reset, which the atomic implementation can no
    // longer produce — so asserting it would now pin a falsehood into the
    // contract. The stronger property is that failure says nothing changed.
    runDemoResetMock.mockResolvedValue({
      ok: false,
      resetApplied: false,
      deletedCounts: null,
    });

    const response = await callPost();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.resetApplied).toBe(false);
    expect(body).not.toHaveProperty("ok");

    // No vocabulary that could describe a half-finished reset survives.
    for (const banned of ["clearedTables", "failedTable", "stopped at"]) {
      expect(JSON.stringify(body), banned).not.toContain(banned);
    }
  });

  it("12: a thrown error is a generic 500 with no raw wording", async () => {
    runDemoResetMock.mockRejectedValue(
      new Error("connect ECONNREFUSED 10.0.0.4:5432"),
    );

    const response = await callPost();
    const body = await response.json();

    expect(response.status).toBe(500);
    for (const leaked of ["ECONNREFUSED", "10.0.0.4", "5432"]) {
      expect(JSON.stringify(body), leaked).not.toContain(leaked);
    }
  });
});
