import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 3D-E: the three C11-A routes
// (start-c11-a/reconcile-c11-a/cancel-c11-a) exercised against mocked
// `lib/config/access-env.ts`, `lib/access/session.ts`, and
// `lib/chaos/c11-execution-service.ts` — no real cookies-from-a-browser, no
// real Supabase. Mirrors tests/unit/api/chaos-c11-route.test.ts (C11-B) and
// the C07 route tests exactly: validate the runId shape, reject a known
// cross-origin request, enforce the access gate, delegate to the trusted
// service, and map its typed result to a safe response.

const getAccessGateEnvMock = vi.fn();
vi.mock("@/lib/config/access-env", () => ({
  getAccessGateEnv: getAccessGateEnvMock,
}));

const verifySessionTokenMock = vi.fn();
vi.mock("@/lib/access/session", () => ({
  ACCESS_SESSION_COOKIE_NAME: "paychaos_session",
  verifySessionToken: verifySessionTokenMock,
}));

const startC11AFailureObservationMock = vi.fn();
const reconcileC11AFailedPaymentObservationMock = vi.fn();
const cancelRunningC11AObservationMock = vi.fn();
vi.mock("@/lib/chaos/c11-execution-service", () => ({
  startC11AFailureObservation: (...args: unknown[]) =>
    startC11AFailureObservationMock(...args),
  reconcileC11AFailedPaymentObservation: (...args: unknown[]) =>
    reconcileC11AFailedPaymentObservationMock(...args),
  cancelRunningC11AObservation: (...args: unknown[]) =>
    cancelRunningC11AObservationMock(...args),
}));

const logEventMock = vi.fn();
vi.mock("@/lib/security/logger", () => ({ logEvent: logEventMock }));

const VALID_RUN_ID = "55555555-5555-5555-5555-555555555555";
const FAKE_SECRET = "fake-session-secret-not-real-" + "x".repeat(10);

beforeEach(() => {
  vi.clearAllMocks();
});

interface RouteFixture {
  readonly name: string;
  readonly path: string;
  readonly importPath: string;
  readonly serviceMock: ReturnType<typeof vi.fn>;
  readonly happyResult: Record<string, unknown>;
}

const routes: RouteFixture[] = [
  {
    name: "start-c11-a",
    path: "start-c11-a",
    importPath: "@/app/api/chaos/runs/[runId]/start-c11-a/route",
    serviceMock: startC11AFailureObservationMock,
    happyResult: { kind: "OBSERVING", chaosRunId: VALID_RUN_ID },
  },
  {
    name: "reconcile-c11-a",
    path: "reconcile-c11-a",
    importPath: "@/app/api/chaos/runs/[runId]/reconcile-c11-a/route",
    serviceMock: reconcileC11AFailedPaymentObservationMock,
    happyResult: { kind: "COMPLETED", chaosRunId: VALID_RUN_ID },
  },
  {
    name: "cancel-c11-a",
    path: "cancel-c11-a",
    importPath: "@/app/api/chaos/runs/[runId]/cancel-c11-a/route",
    serviceMock: cancelRunningC11AObservationMock,
    happyResult: { kind: "CANCELLED", chaosRunId: VALID_RUN_ID },
  },
];

async function callRoute(
  route: RouteFixture,
  runId: string,
  options: {
    cookie?: string;
    origin?: string;
    secFetchSite?: string;
    body?: string;
  } = {},
) {
  const { POST } = await import(route.importPath);
  const { NextRequest } = await import("next/server");
  const headers: Record<string, string> = {};
  if (options.cookie !== undefined) headers.cookie = options.cookie;
  if (options.origin !== undefined) headers.origin = options.origin;
  if (options.secFetchSite !== undefined)
    headers["sec-fetch-site"] = options.secFetchSite;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const request = new NextRequest(
    `http://localhost/api/chaos/runs/${runId}/${route.path}`,
    { method: "POST", headers, body: options.body },
  );
  return (
    POST as (
      req: unknown,
      ctx: { params: Promise<{ runId: string }> },
    ) => Promise<Response>
  )(request, { params: Promise.resolve({ runId }) });
}

describe.each(routes)(
  "POST /api/chaos/runs/[runId]/$name — input shape",
  (route) => {
    it("returns 400 for a malformed runId and never calls the service", async () => {
      getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
      const response = await callRoute(route, "not-a-uuid");
      expect(response.status).toBe(400);
      expect(route.serviceMock).not.toHaveBeenCalled();
    });
  },
);

describe.each(routes)(
  "POST /api/chaos/runs/[runId]/$name — cross-origin rejection",
  (route) => {
    it("returns 403 when Sec-Fetch-Site is cross-site", async () => {
      getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
      const response = await callRoute(route, VALID_RUN_ID, {
        secFetchSite: "cross-site",
        origin: "http://localhost",
      });
      expect(response.status).toBe(403);
      expect(route.serviceMock).not.toHaveBeenCalled();
    });

    it("returns 403 when the Origin header does not match the request's own origin", async () => {
      getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
      const response = await callRoute(route, VALID_RUN_ID, {
        origin: "https://evil.example.com",
      });
      expect(response.status).toBe(403);
      expect(route.serviceMock).not.toHaveBeenCalled();
    });

    it("proceeds when Origin matches the request's own origin", async () => {
      getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
      route.serviceMock.mockResolvedValue(route.happyResult);
      const response = await callRoute(route, VALID_RUN_ID, {
        origin: "http://localhost",
      });
      expect(response.status).toBe(200);
    });

    it("proceeds when neither Origin nor Sec-Fetch-Site is present (same-origin server/test call)", async () => {
      getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
      route.serviceMock.mockResolvedValue(route.happyResult);
      const response = await callRoute(route, VALID_RUN_ID);
      expect(response.status).toBe(200);
    });
  },
);

describe.each(routes)(
  "POST /api/chaos/runs/[runId]/$name — access gate",
  (route) => {
    it("returns 503 when the gate is misconfigured, and never calls the service", async () => {
      getAccessGateEnvMock.mockImplementation(() => {
        throw new Error("misconfigured");
      });
      const response = await callRoute(route, VALID_RUN_ID);
      expect(response.status).toBe(503);
      expect(route.serviceMock).not.toHaveBeenCalled();
    });

    it("returns 401 when the gate is enabled and no session cookie is present", async () => {
      getAccessGateEnvMock.mockReturnValue({
        mode: "enabled",
        sessionSecret: FAKE_SECRET,
      });
      const response = await callRoute(route, VALID_RUN_ID);
      expect(response.status).toBe(401);
      expect(route.serviceMock).not.toHaveBeenCalled();
    });

    it("returns 401 when the gate is enabled and the session cookie is invalid", async () => {
      getAccessGateEnvMock.mockReturnValue({
        mode: "enabled",
        sessionSecret: FAKE_SECRET,
      });
      verifySessionTokenMock.mockReturnValue(false);
      const response = await callRoute(route, VALID_RUN_ID, {
        cookie: "paychaos_session=forged.value",
      });
      expect(response.status).toBe(401);
      expect(route.serviceMock).not.toHaveBeenCalled();
    });

    it("never accepts a caller-supplied 'authorized' claim — only a verified session cookie", async () => {
      getAccessGateEnvMock.mockReturnValue({
        mode: "enabled",
        sessionSecret: FAKE_SECRET,
      });
      verifySessionTokenMock.mockReturnValue(false);
      const response = await callRoute(route, VALID_RUN_ID, {
        body: JSON.stringify({ authorized: true }),
      });
      expect(response.status).toBe(401);
      expect(route.serviceMock).not.toHaveBeenCalled();
    });

    it("proceeds when the gate is enabled and the session cookie verifies", async () => {
      getAccessGateEnvMock.mockReturnValue({
        mode: "enabled",
        sessionSecret: FAKE_SECRET,
      });
      verifySessionTokenMock.mockReturnValue(true);
      route.serviceMock.mockResolvedValue(route.happyResult);
      const response = await callRoute(route, VALID_RUN_ID, {
        cookie: "paychaos_session=valid.token",
      });
      expect(response.status).toBe(200);
      expect(route.serviceMock).toHaveBeenCalledWith(VALID_RUN_ID);
    });

    it("proceeds without any cookie when the gate is disabled (existing access-gate semantics)", async () => {
      getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
      route.serviceMock.mockResolvedValue(route.happyResult);
      const response = await callRoute(route, VALID_RUN_ID);
      expect(response.status).toBe(200);
    });
  },
);

describe("POST /api/chaos/runs/[runId]/start-c11-a — service result mapping", () => {
  beforeEach(() => {
    getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
  });

  it("maps OBSERVING to 200", async () => {
    startC11AFailureObservationMock.mockResolvedValue({
      kind: "OBSERVING",
      chaosRunId: VALID_RUN_ID,
    });
    const response = await callRoute(routes[0]!, VALID_RUN_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ chaosRunId: VALID_RUN_ID, status: "RUNNING" });
  });

  it("maps BLOCKED_PRE_SEC_007 to 200 with a safe BLOCKED body", async () => {
    startC11AFailureObservationMock.mockResolvedValue({
      kind: "BLOCKED_PRE_SEC_007",
      chaosRunId: VALID_RUN_ID,
    });
    const response = await callRoute(routes[0]!, VALID_RUN_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      chaosRunId: VALID_RUN_ID,
      status: "COMPLETED",
      outcome: "BLOCKED",
      executionBlockCode: "PRE-SEC-007",
    });
  });

  it("maps BLOCK_PERSISTENCE_FAILED to a safe 500", async () => {
    startC11AFailureObservationMock.mockResolvedValue({
      kind: "BLOCK_PERSISTENCE_FAILED",
      chaosRunId: VALID_RUN_ID,
    });
    const response = await callRoute(routes[0]!, VALID_RUN_ID);
    expect(response.status).toBe(500);
  });

  it("maps NOT_STARTABLE to 409 without leaking the reason category", async () => {
    startC11AFailureObservationMock.mockResolvedValue({
      kind: "NOT_STARTABLE",
      reasonCategory: "BASELINE_NOT_FRESH",
    });
    const response = await callRoute(routes[0]!, VALID_RUN_ID);
    expect(response.status).toBe(409);
    const text = await response.clone().text();
    expect(text).not.toContain("BASELINE_NOT_FRESH");
  });

  it("maps a thrown error to a safe 500, never exposing the error message", async () => {
    startC11AFailureObservationMock.mockRejectedValue(
      new Error("raw-postgres-detail-that-must-never-leak"),
    );
    const response = await callRoute(routes[0]!, VALID_RUN_ID);
    expect(response.status).toBe(500);
    const text = await response.clone().text();
    expect(text).not.toContain("raw-postgres-detail-that-must-never-leak");
  });
});

describe("POST /api/chaos/runs/[runId]/reconcile-c11-a — service result mapping", () => {
  beforeEach(() => {
    getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
  });

  it("maps COMPLETED to 200 with outcome UNKNOWN", async () => {
    reconcileC11AFailedPaymentObservationMock.mockResolvedValue({
      kind: "COMPLETED",
      chaosRunId: VALID_RUN_ID,
    });
    const response = await callRoute(routes[1]!, VALID_RUN_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      chaosRunId: VALID_RUN_ID,
      status: "COMPLETED",
      outcome: "UNKNOWN",
    });
  });

  it("maps NOT_YET_CONVERGED to 200 (safe to poll repeatedly)", async () => {
    reconcileC11AFailedPaymentObservationMock.mockResolvedValue({
      kind: "NOT_YET_CONVERGED",
      chaosRunId: VALID_RUN_ID,
    });
    const response = await callRoute(routes[1]!, VALID_RUN_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      chaosRunId: VALID_RUN_ID,
      status: "NOT_YET_CONVERGED",
    });
  });

  it("maps FAILED to 500 without leaking the reason category", async () => {
    reconcileC11AFailedPaymentObservationMock.mockResolvedValue({
      kind: "FAILED",
      chaosRunId: VALID_RUN_ID,
      reasonCategory: "AMBIGUOUS_EVIDENCE",
    });
    const response = await callRoute(routes[1]!, VALID_RUN_ID);
    expect(response.status).toBe(500);
    const text = await response.clone().text();
    expect(text).not.toContain("AMBIGUOUS_EVIDENCE");
  });

  it("maps COMPLETION_PERSISTENCE_FAILED to a safe 500", async () => {
    reconcileC11AFailedPaymentObservationMock.mockResolvedValue({
      kind: "COMPLETION_PERSISTENCE_FAILED",
      chaosRunId: VALID_RUN_ID,
    });
    const response = await callRoute(routes[1]!, VALID_RUN_ID);
    expect(response.status).toBe(500);
  });

  it("maps FAILURE_PERSISTENCE_FAILED to a safe generic 500, never claiming FAILED/COMPLETED or leaking any internal detail (architect correction round 1)", async () => {
    reconcileC11AFailedPaymentObservationMock.mockResolvedValue({
      kind: "FAILURE_PERSISTENCE_FAILED",
      chaosRunId: VALID_RUN_ID,
    });
    const response = await callRoute(routes[1]!, VALID_RUN_ID);
    expect(response.status).toBe(500);
    const text = await response.clone().text();
    expect(text).not.toContain("FAILED");
    expect(text).not.toContain("ERROR");
    expect(text).not.toContain("FAILURE_PERSISTENCE_FAILED");
    expect(text).not.toContain("reasonCategory");
    const body = await response.json();
    expect(body).toEqual({
      error: "Chaos reconcile request could not be processed.",
    });
  });

  it("maps NOT_RECONCILABLE to 409 without leaking the reason category", async () => {
    reconcileC11AFailedPaymentObservationMock.mockResolvedValue({
      kind: "NOT_RECONCILABLE",
      reasonCategory: "RUN_NOT_ELIGIBLE",
    });
    const response = await callRoute(routes[1]!, VALID_RUN_ID);
    expect(response.status).toBe(409);
    const text = await response.clone().text();
    expect(text).not.toContain("RUN_NOT_ELIGIBLE");
  });

  it("maps a thrown error to a safe 500", async () => {
    reconcileC11AFailedPaymentObservationMock.mockRejectedValue(
      new Error("raw-detail"),
    );
    const response = await callRoute(routes[1]!, VALID_RUN_ID);
    expect(response.status).toBe(500);
  });
});

describe("POST /api/chaos/runs/[runId]/cancel-c11-a — service result mapping", () => {
  beforeEach(() => {
    getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
  });

  it("maps CANCELLED to 200 with status FAILED/outcome ERROR", async () => {
    cancelRunningC11AObservationMock.mockResolvedValue({
      kind: "CANCELLED",
      chaosRunId: VALID_RUN_ID,
    });
    const response = await callRoute(routes[2]!, VALID_RUN_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      chaosRunId: VALID_RUN_ID,
      status: "FAILED",
      outcome: "ERROR",
    });
  });

  it("maps CANCEL_PERSISTENCE_FAILED to a safe 500", async () => {
    cancelRunningC11AObservationMock.mockResolvedValue({
      kind: "CANCEL_PERSISTENCE_FAILED",
      chaosRunId: VALID_RUN_ID,
    });
    const response = await callRoute(routes[2]!, VALID_RUN_ID);
    expect(response.status).toBe(500);
  });

  it("maps NOT_CANCELLABLE to 409 without leaking the reason category", async () => {
    cancelRunningC11AObservationMock.mockResolvedValue({
      kind: "NOT_CANCELLABLE",
      reasonCategory: "RUN_NOT_RUNNING",
    });
    const response = await callRoute(routes[2]!, VALID_RUN_ID);
    expect(response.status).toBe(409);
    const text = await response.clone().text();
    expect(text).not.toContain("RUN_NOT_RUNNING");
  });

  it("maps a thrown error to a safe 500", async () => {
    cancelRunningC11AObservationMock.mockRejectedValue(new Error("raw-detail"));
    const response = await callRoute(routes[2]!, VALID_RUN_ID);
    expect(response.status).toBe(500);
  });
});

describe.each(routes)(
  "app/api/chaos/runs/[runId]/$path/route.ts — module surface",
  (route) => {
    it("never reads a request body (no request.json()/request.text() call anywhere)", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const source = fs.readFileSync(
        path.resolve(
          import.meta.dirname,
          `../../../app/api/chaos/runs/[runId]/${route.path}/route.ts`,
        ),
        "utf-8",
      );
      expect(source).not.toMatch(/request\.json\(/);
      expect(source).not.toMatch(/request\.text\(/);
      expect(source).not.toMatch(/request\.arrayBuffer\(/);
    });

    it("has no arbitrary target/authorization/scenario/mechanism field name in the functional code", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const source = fs.readFileSync(
        path.resolve(
          import.meta.dirname,
          `../../../app/api/chaos/runs/[runId]/${route.path}/route.ts`,
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
      for (const forbidden of [
        "targetUrl",
        "targetHost",
        "endpoint",
        "faultString",
        "scenarioId",
        "mechanism",
        "authorized:",
      ]) {
        expect(functionalSource).not.toContain(forbidden);
      }
    });
  },
);
