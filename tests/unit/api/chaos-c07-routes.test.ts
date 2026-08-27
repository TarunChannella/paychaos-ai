import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 3D-B: the three C07 routes exercised against mocked
// `lib/config/access-env.ts`, `lib/access/session.ts`, and
// `lib/chaos/c07-execution-service.ts` — no real cookies-from-a-browser, no
// real Supabase. Mirrors tests/unit/api/chaos-c03-route.test.ts's structure
// exactly, extended to cover all three routes (arm/reconcile/cancel).

const getAccessGateEnvMock = vi.fn();
vi.mock("@/lib/config/access-env", () => ({
  getAccessGateEnv: getAccessGateEnvMock,
}));

const verifySessionTokenMock = vi.fn();
vi.mock("@/lib/access/session", () => ({
  ACCESS_SESSION_COOKIE_NAME: "paychaos_session",
  verifySessionToken: verifySessionTokenMock,
}));

const armC07Mock = vi.fn();
const reconcileC07Mock = vi.fn();
const cancelC07Mock = vi.fn();
vi.mock("@/lib/chaos/c07-execution-service", () => ({
  armC07ClientConfirmationDrop: (...args: unknown[]) => armC07Mock(...args),
  reconcileC07ClientConfirmationDrop: (...args: unknown[]) =>
    reconcileC07Mock(...args),
  cancelRunningC07Fault: (...args: unknown[]) => cancelC07Mock(...args),
}));

const logEventMock = vi.fn();
vi.mock("@/lib/security/logger", () => ({ logEvent: logEventMock }));

const VALID_RUN_ID = "77777777-7777-7777-7777-777777777777";
const FAKE_SECRET = "fake-session-secret-not-real-" + "x".repeat(10);

const ROUTES: ReadonlyArray<{
  name: string;
  modulePath: string;
  urlSuffix: string;
  mock: ReturnType<typeof vi.fn>;
}> = [
  {
    name: "arm-c07",
    modulePath: "@/app/api/chaos/runs/[runId]/arm-c07/route",
    urlSuffix: "arm-c07",
    mock: armC07Mock,
  },
  {
    name: "reconcile-c07",
    modulePath: "@/app/api/chaos/runs/[runId]/reconcile-c07/route",
    urlSuffix: "reconcile-c07",
    mock: reconcileC07Mock,
  },
  {
    name: "cancel-c07",
    modulePath: "@/app/api/chaos/runs/[runId]/cancel-c07/route",
    urlSuffix: "cancel-c07",
    mock: cancelC07Mock,
  },
];

async function callRoute(
  route: (typeof ROUTES)[number],
  runId: string,
  options: { cookie?: string; origin?: string; secFetchSite?: string } = {},
) {
  const { POST } = await import(route.modulePath);
  const { NextRequest } = await import("next/server");
  const headers: Record<string, string> = {};
  if (options.cookie !== undefined) headers.cookie = options.cookie;
  if (options.origin !== undefined) headers.origin = options.origin;
  if (options.secFetchSite !== undefined)
    headers["sec-fetch-site"] = options.secFetchSite;

  const request = new NextRequest(
    `http://localhost/api/chaos/runs/${runId}/${route.urlSuffix}`,
    { method: "POST", headers },
  );
  return POST(request, { params: Promise.resolve({ runId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each(ROUTES)(
  "POST /api/chaos/runs/[runId]/$name — shared protections",
  (route) => {
    it("returns 400 for a malformed runId and never calls the service", async () => {
      getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
      const response = await callRoute(route, "not-a-uuid");
      expect(response.status).toBe(400);
      expect(route.mock).not.toHaveBeenCalled();
    }, 20_000);

    it("returns 403 when Sec-Fetch-Site is cross-site", async () => {
      getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
      const response = await callRoute(route, VALID_RUN_ID, {
        secFetchSite: "cross-site",
      });
      expect(response.status).toBe(403);
      expect(route.mock).not.toHaveBeenCalled();
    });

    it("returns 403 when Origin does not match the request's own origin", async () => {
      getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
      const response = await callRoute(route, VALID_RUN_ID, {
        origin: "https://evil.example.com",
      });
      expect(response.status).toBe(403);
      expect(route.mock).not.toHaveBeenCalled();
    });

    it("returns 503 when the access gate is misconfigured, and never calls the service", async () => {
      getAccessGateEnvMock.mockImplementation(() => {
        throw new Error("misconfigured");
      });
      const response = await callRoute(route, VALID_RUN_ID);
      expect(response.status).toBe(503);
      expect(route.mock).not.toHaveBeenCalled();
    });

    it("returns 401 when the gate is enabled and no session cookie is present", async () => {
      getAccessGateEnvMock.mockReturnValue({
        mode: "enabled",
        sessionSecret: FAKE_SECRET,
      });
      const response = await callRoute(route, VALID_RUN_ID);
      expect(response.status).toBe(401);
      expect(route.mock).not.toHaveBeenCalled();
    });

    it("returns 401 when the session cookie is invalid", async () => {
      getAccessGateEnvMock.mockReturnValue({
        mode: "enabled",
        sessionSecret: FAKE_SECRET,
      });
      verifySessionTokenMock.mockReturnValue(false);
      const response = await callRoute(route, VALID_RUN_ID, {
        cookie: "paychaos_session=forged.value",
      });
      expect(response.status).toBe(401);
      expect(route.mock).not.toHaveBeenCalled();
    });

    it("never reads a request body", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const source = fs.readFileSync(
        path.resolve(
          import.meta.dirname,
          `../../../app/api/chaos/runs/[runId]/${route.urlSuffix}/route.ts`,
        ),
        "utf-8",
      );
      expect(source).not.toMatch(/request\.json\(/);
      expect(source).not.toMatch(/request\.text\(/);
      expect(source).not.toMatch(/request\.arrayBuffer\(/);
    });

    it("maps a thrown error to a safe 500, never exposing the error message", async () => {
      getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
      route.mock.mockRejectedValue(
        new Error("raw-postgres-detail-that-must-never-leak"),
      );
      const response = await callRoute(route, VALID_RUN_ID);
      expect(response.status).toBe(500);
      const text = await response.clone().text();
      expect(text).not.toContain("raw-postgres-detail-that-must-never-leak");
    });

    it("proceeds when the gate is enabled and the session verifies", async () => {
      getAccessGateEnvMock.mockReturnValue({
        mode: "enabled",
        sessionSecret: FAKE_SECRET,
      });
      verifySessionTokenMock.mockReturnValue(true);
      route.mock.mockResolvedValue({ kind: "__unused__" });
      await callRoute(route, VALID_RUN_ID, {
        cookie: "paychaos_session=valid",
      });
      expect(route.mock).toHaveBeenCalledWith(VALID_RUN_ID);
    });
  },
);

describe("POST /api/chaos/runs/[runId]/arm-c07 — result mapping", () => {
  beforeEach(() => {
    getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
  });

  it("maps ARMED to 200 with the fixed fault_state shape", async () => {
    armC07Mock.mockResolvedValue({ kind: "ARMED", chaosRunId: VALID_RUN_ID });
    const response = await callRoute(ROUTES[0]!, VALID_RUN_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      chaosRunId: VALID_RUN_ID,
      status: "RUNNING",
      faultState: { armed: true, consumed: false },
    });
  });

  it("maps BLOCKED_PRE_SEC_007 to 200 with a truthful BLOCKED body", async () => {
    armC07Mock.mockResolvedValue({
      kind: "BLOCKED_PRE_SEC_007",
      chaosRunId: VALID_RUN_ID,
    });
    const response = await callRoute(ROUTES[0]!, VALID_RUN_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      chaosRunId: VALID_RUN_ID,
      status: "COMPLETED",
      outcome: "BLOCKED",
      executionBlockCode: "PRE-SEC-007",
    });
  });

  it("maps BLOCK_PERSISTENCE_FAILED to a generic safe 500 — never outcome=BLOCKED", async () => {
    armC07Mock.mockResolvedValue({
      kind: "BLOCK_PERSISTENCE_FAILED",
      chaosRunId: VALID_RUN_ID,
    });
    const response = await callRoute(ROUTES[0]!, VALID_RUN_ID);
    expect(response.status).toBe(500);
    const text = await response.clone().text();
    expect(text).not.toContain("BLOCKED");
  });

  it("maps NOT_STARTABLE to 409 without leaking the reason category", async () => {
    armC07Mock.mockResolvedValue({
      kind: "NOT_STARTABLE",
      reasonCategory: "ALREADY_ARMED_FOR_ORDER",
    });
    const response = await callRoute(ROUTES[0]!, VALID_RUN_ID);
    expect(response.status).toBe(409);
    const text = await response.clone().text();
    expect(text).not.toContain("ALREADY_ARMED_FOR_ORDER");
  });
});

describe("POST /api/chaos/runs/[runId]/reconcile-c07 — result mapping", () => {
  beforeEach(() => {
    getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
  });

  it("maps COMPLETED to 200/COMPLETED/UNKNOWN", async () => {
    reconcileC07Mock.mockResolvedValue({
      kind: "COMPLETED",
      chaosRunId: VALID_RUN_ID,
    });
    const response = await callRoute(ROUTES[1]!, VALID_RUN_ID);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      chaosRunId: VALID_RUN_ID,
      status: "COMPLETED",
      outcome: "UNKNOWN",
    });
  });

  it("maps NOT_YET_CONVERGED to 200 with a narrow safe status, never PASS/FAIL", async () => {
    reconcileC07Mock.mockResolvedValue({
      kind: "NOT_YET_CONVERGED",
      chaosRunId: VALID_RUN_ID,
    });
    const response = await callRoute(ROUTES[1]!, VALID_RUN_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("NOT_YET_CONVERGED");
    expect(JSON.stringify(body)).not.toMatch(/PASS|FAIL(?!URE)/);
  });

  it("maps FAULT_NOT_CONSUMED to 200 without completing", async () => {
    reconcileC07Mock.mockResolvedValue({
      kind: "FAULT_NOT_CONSUMED",
      chaosRunId: VALID_RUN_ID,
    });
    const response = await callRoute(ROUTES[1]!, VALID_RUN_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("FAULT_NOT_CONSUMED");
  });

  it("maps COMPLETION_PERSISTENCE_FAILED to a generic safe 500 — never claims COMPLETED", async () => {
    reconcileC07Mock.mockResolvedValue({
      kind: "COMPLETION_PERSISTENCE_FAILED",
      chaosRunId: VALID_RUN_ID,
    });
    const response = await callRoute(ROUTES[1]!, VALID_RUN_ID);
    expect(response.status).toBe(500);
    const text = await response.clone().text();
    expect(text).not.toContain("COMPLETED");
  });

  it("maps NOT_RECONCILABLE to 409", async () => {
    reconcileC07Mock.mockResolvedValue({
      kind: "NOT_RECONCILABLE",
      reasonCategory: "RUN_NOT_ELIGIBLE",
    });
    const response = await callRoute(ROUTES[1]!, VALID_RUN_ID);
    expect(response.status).toBe(409);
  });
});

describe("POST /api/chaos/runs/[runId]/cancel-c07 — result mapping", () => {
  beforeEach(() => {
    getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
  });

  it("maps CANCELLED to 200/FAILED/ERROR", async () => {
    cancelC07Mock.mockResolvedValue({
      kind: "CANCELLED",
      chaosRunId: VALID_RUN_ID,
    });
    const response = await callRoute(ROUTES[2]!, VALID_RUN_ID);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      chaosRunId: VALID_RUN_ID,
      status: "FAILED",
      outcome: "ERROR",
    });
  });

  it("maps NOT_CANCELLABLE to 409 without leaking the reason category", async () => {
    cancelC07Mock.mockResolvedValue({
      kind: "NOT_CANCELLABLE",
      reasonCategory: "RUN_NOT_RUNNING",
    });
    const response = await callRoute(ROUTES[2]!, VALID_RUN_ID);
    expect(response.status).toBe(409);
    const text = await response.clone().text();
    expect(text).not.toContain("RUN_NOT_RUNNING");
  });

  it("Blocker 4: maps CANCEL_PERSISTENCE_FAILED to a generic safe 500 — never claims CANCELLED", async () => {
    cancelC07Mock.mockResolvedValue({
      kind: "CANCEL_PERSISTENCE_FAILED",
      chaosRunId: VALID_RUN_ID,
    });
    const response = await callRoute(ROUTES[2]!, VALID_RUN_ID);
    expect(response.status).toBe(500);
    const text = await response.clone().text();
    expect(text).not.toContain("CANCELLED");
    expect(text).not.toContain(VALID_RUN_ID);
  });
});
