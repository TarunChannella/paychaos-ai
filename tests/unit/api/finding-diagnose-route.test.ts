import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 4H-0 — `POST /api/findings/[findingId]/diagnose`.
 *
 * The route is an ADAPTER to the frozen Phase 4C/4D services, so these tests
 * are about the boundary rather than about classification: that the gate runs
 * before any service is reached, that exactly one frozen entry point is
 * called, that no request input can influence the result, and that nothing
 * outside the advisory diagnosis columns can be mutated from here.
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

const recommendFindingMock = vi.fn();
vi.mock("@/lib/diagnosis/recommendation-service", () => ({
  recommendFinding: (...args: unknown[]) => recommendFindingMock(...args),
}));

const logEventMock = vi.fn();
vi.mock("@/lib/security/logger", () => ({ logEvent: logEventMock }));

const FINDING_ID = "11111111-1111-4111-8111-111111111111";

function result() {
  return {
    diagnosis: {
      persistence: {
        kind: "CREATED",
        diagnosisCode: "RC-001",
        diagnosisStrength: "STRONG_EVIDENCE",
        diagnosedAt: "2026-09-02T00:00:00.000Z",
        updatedAt: "2026-09-02T00:00:00.000Z",
      },
    },
    recommendation: {},
    persistence: {
      kind: "CREATED",
      diagnosisSummary:
        "A duplicate processing path executed the effect twice.",
      recommendationCode: "FIX-EVENT-IDEMPOTENCY",
      recommendationText: "Enforce event-id idempotency.",
      updatedAt: "2026-09-02T00:00:00.000Z",
    },
  };
}

async function callPost(
  options: {
    findingId?: string;
    url?: string;
    secFetchSite?: string;
    origin?: string;
    body?: string;
  } = {},
) {
  const { POST } =
    await import("@/app/api/findings/[findingId]/diagnose/route");
  const { NextRequest } = await import("next/server");
  const headers: Record<string, string> = {};
  if (options.secFetchSite !== undefined)
    headers["sec-fetch-site"] = options.secFetchSite;
  if (options.origin !== undefined) headers["origin"] = options.origin;

  const findingId = options.findingId ?? FINDING_ID;
  const request = new NextRequest(
    options.url ?? `http://localhost/api/findings/${findingId}/diagnose`,
    { method: "POST", headers, body: options.body },
  );
  return POST(request, { params: Promise.resolve({ findingId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
  recommendFindingMock.mockResolvedValue(result());
});

describe("diagnose route — it delegates and decides nothing", () => {
  it("1: calls the single frozen entry point exactly once, with the id only", async () => {
    const response = await callPost();

    expect(response.status).toBe(200);
    // recommendFinding invokes diagnoseFinding internally; calling both here
    // would run the diagnosis twice.
    expect(recommendFindingMock).toHaveBeenCalledTimes(1);
    expect(recommendFindingMock).toHaveBeenCalledWith(FINDING_ID);
  });

  it("2: returns only service-level vocabulary", async () => {
    const body = await (await callPost()).json();

    expect(body).toEqual({
      findingId: FINDING_ID,
      diagnosisCode: "RC-001",
      diagnosisStrength: "STRONG_EVIDENCE",
      recommendationCode: "FIX-EVENT-IDEMPOTENCY",
    });
  });

  it("3: no request body can influence the classification", async () => {
    await callPost({
      body: JSON.stringify({ diagnosisCode: "RC-999", strength: "STRONG" }),
    });

    expect(recommendFindingMock).toHaveBeenCalledWith(FINDING_ID);
  });

  it("4: no query string can influence the classification", async () => {
    await callPost({
      url: `http://localhost/api/findings/${FINDING_ID}/diagnose?code=RC-999`,
    });

    expect(recommendFindingMock).toHaveBeenCalledWith(FINDING_ID);
  });

  it("5: a malformed finding id is rejected before any service call", async () => {
    const response = await callPost({ findingId: "not-a-uuid" });

    expect(response.status).toBe(400);
    expect(recommendFindingMock).not.toHaveBeenCalled();
  });

  it("6: repeated invocation is safe — the route adds no guard of its own", async () => {
    // The frozen services perform guarded writes and return the original
    // timestamp, so idempotency is theirs to own, not the route's.
    recommendFindingMock.mockResolvedValue({
      ...result(),
      persistence: { ...result().persistence, kind: "REUSED" },
    });

    const first = await callPost();
    const second = await callPost();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(recommendFindingMock).toHaveBeenCalledTimes(2);
  });

  it("7: only POST is exported", async () => {
    const route = await import("@/app/api/findings/[findingId]/diagnose/route");
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
      expect(route, method).not.toHaveProperty(method);
    }
    expect(typeof route.POST).toBe("function");
    expect(route.dynamic).toBe("force-dynamic");
  });
});

describe("diagnose route — access is enforced first", () => {
  it("8: a cross-origin request never reaches the service", async () => {
    const response = await callPost({ secFetchSite: "cross-site" });

    expect(response.status).toBe(403);
    expect(recommendFindingMock).not.toHaveBeenCalled();
  });

  it("9: a foreign Origin never reaches the service", async () => {
    const response = await callPost({ origin: "https://evil.example" });

    expect(response.status).toBe(403);
    expect(recommendFindingMock).not.toHaveBeenCalled();
  });

  it("10: an enabled gate without a valid session refuses", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      sessionSecret: "s",
    });
    verifySessionTokenMock.mockReturnValue(false);

    const response = await callPost();

    expect(response.status).toBe(401);
    expect(recommendFindingMock).not.toHaveBeenCalled();
  });

  it("11: a misconfigured gate fails closed and names no reason", async () => {
    getAccessGateEnvMock.mockImplementation(() => {
      throw new Error("PAYCHAOS_SESSION_SECRET is missing");
    });

    const response = await callPost();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(recommendFindingMock).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("PAYCHAOS_SESSION_SECRET");
  });
});

describe("diagnose route — refusals and failures are honest", () => {
  it("12: a domain refusal returns its stable code, not a diagnosis", async () => {
    const error = Object.assign(new Error("raw internal text"), {
      code: "EVIDENCE_PACK_INVARIANT_NOT_FAILED",
    });
    recommendFindingMock.mockRejectedValue(error);

    const response = await callPost();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("EVIDENCE_PACK_INVARIANT_NOT_FAILED");
    expect(body).not.toHaveProperty("diagnosisCode");
    expect(JSON.stringify(body)).not.toContain("raw internal text");
  });

  it("13: insufficient evidence is a refusal, never an invented diagnosis", async () => {
    recommendFindingMock.mockRejectedValue(
      Object.assign(new Error("x"), { code: "EVIDENCE_PACK_READ_FAILED" }),
    );

    const body = await (await callPost()).json();

    expect(body).not.toHaveProperty("diagnosisCode");
    expect(body.code).toBe("EVIDENCE_PACK_READ_FAILED");
  });

  it("14: an unexpected error is a generic 500 with no raw wording", async () => {
    recommendFindingMock.mockRejectedValue(
      new Error("connect ECONNREFUSED 10.0.0.4:5432"),
    );

    const response = await callPost();
    const body = await response.json();

    expect(response.status).toBe(500);
    for (const leaked of ["ECONNREFUSED", "10.0.0.4", "5432"]) {
      expect(JSON.stringify(body), leaked).not.toContain(leaked);
    }
  });

  it("15: no log line carries raw error text", async () => {
    recommendFindingMock.mockRejectedValue(
      Object.assign(new Error("relation does not exist"), {
        code: "EVIDENCE_PACK_READ_FAILED",
      }),
    );

    await callPost();

    const logged = JSON.stringify(logEventMock.mock.calls);
    expect(logged).toContain("EVIDENCE_PACK_READ_FAILED");
    expect(logged).not.toContain("relation does not exist");
  });
});

describe("diagnose route — it mutates nothing beyond diagnosis", () => {
  it("16: no lifecycle, regression, chaos or payment surface is reachable", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(
        process.cwd(),
        "app",
        "api",
        "findings",
        "[findingId]",
        "diagnose",
        "route.ts",
      ),
      "utf8",
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(String.fromCharCode(10))
      .filter((line) => !line.trimStart().startsWith("//"))
      .join(String.fromCharCode(10));

    for (const forbidden of [
      "resolveFindingAfterRegression",
      "markFindingStillFailingAfterRegression",
      "startRegression",
      "advanceRegression",
      "insertPendingRegressionRun",
      "createChaosRun",
      "evaluateChaosRun",
      "evaluateInvariant",
      "persistInvariantResult",
      "processMerchantWebhookEvent",
      "getSupabaseServerClient",
      ".from(",
      ".update(",
      ".insert(",
      ".delete(",
      // Finding LIFECYCLE values, not HTTP status codes: the route
      // legitimately passes `{ status: 400 }` to NextResponse.json, so the
      // ban targets the vocabulary that would actually change a finding.
      'status: "OPEN"',
      'status: "RESOLVED"',
      'status: "STILL_FAILING"',
      "resolved_at",
      // No second engine, and no model of any kind.
      "classifyRootCause",
      "buildRecommendation",
      "openai",
      "anthropic",
      "ollama",
      "fetch(",
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});
